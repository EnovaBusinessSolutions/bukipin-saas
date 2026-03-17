const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const ensureAuth = require("../middleware/ensureAuth");
const JournalEntry = require("../models/JournalEntry");

// ✅ Intentar cargar un modelo de CAPEX si existe
let CapexModel = null;
const tryModels = ["Capex", "CAPEX", "Investment", "Inversion", "InversionCapex", "CapexTransaction"];
for (const name of tryModels) {
  try {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    CapexModel = require(`../models/${name}`);
    if (CapexModel) break;
  } catch (_) {}
}

function toNum(v, def = 0) {
  const n = Number(String(v ?? "").replace(/[$,\s,]/g, ""));
  return Number.isFinite(n) ? n : def;
}

function asStr(v, def = "") {
  if (v === undefined || v === null) return def;
  return String(v);
}

function asTrim(v, def = "") {
  return asStr(v, def).trim();
}

function isObjectId(v) {
  return !!v && mongoose.Types.ObjectId.isValid(String(v));
}

function isoDateOrNull(v) {
  const s = asTrim(v);
  if (!s) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(`${s}T00:00:00`);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function endOfDay(d) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function toISO(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function toYMD(v) {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function monthLabelEs(v) {
  if (!v) return "";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("es-MX", { month: "long", year: "numeric" });
}

function normalizeTipoPago(v) {
  const s = asTrim(v).toLowerCase();
  if (["contado", "total", "pago_total"].includes(s)) return "contado";
  if (["credito", "crédito"].includes(s)) return "credito";
  if (["parcial", "parciales"].includes(s)) return "parcial";
  return s || "contado";
}

function normalizeMetodoPago(v) {
  const s = asTrim(v).toLowerCase();
  if (!s) return "";
  if (["transferencia", "bancos", "tarjeta-transferencia"].includes(s)) return "bancos";
  if (s === "efectivo") return "efectivo";
  return s;
}

function normalizeEstado(v) {
  const s = asTrim(v).toLowerCase();
  if (!s) return "activo";
  if (["activo", "activa", "active"].includes(s)) return "activo";
  if (["dado_de_baja", "baja", "dado de baja"].includes(s)) return "dado_de_baja";
  if (["vendido", "venta"].includes(s)) return "vendido";
  if (["cancelado", "cancelada", "canceled"].includes(s)) return "cancelado";
  return s;
}

function pickId(d) {
  return String(d?.id ?? d?._id ?? "");
}

function ownerFilter(owner) {
  return {
    $or: [{ owner }, { user: owner }, { userId: owner }, { createdBy: owner }],
  };
}

function mapCapexForUI(doc) {
  const d = doc?.toObject ? doc.toObject() : doc;

  const montoTotal = toNum(d?.valor_total ?? d?.monto_total ?? d?.montoTotal ?? d?.total ?? 0, 0);
  const montoPagado = toNum(d?.monto_pagado ?? d?.montoPagado ?? 0, 0);
  const montoPendiente = toNum(
    d?.monto_pendiente ?? d?.montoPendiente ?? Math.max(0, montoTotal - montoPagado),
    0
  );

  return {
    id: pickId(d),
    user_id: d?.user_id ?? (d?.owner ? String(d.owner) : null),

    producto_nombre: d?.producto_nombre ?? d?.nombre ?? d?.descripcion ?? "CAPEX",
    descripcion: d?.descripcion ?? "",
    imagen_url: d?.imagen_url ?? "",

    valor_total: montoTotal,
    monto_pagado: montoPagado,
    monto_pendiente: montoPendiente,

    tipo_pago: normalizeTipoPago(d?.tipo_pago ?? d?.tipoPago ?? ""),
    metodo_pago: normalizeMetodoPago(d?.metodo_pago ?? d?.metodoPago ?? d?.metodo ?? ""),

    anos_depreciacion: parseInt(String(d?.anos_depreciacion ?? d?.anosDepreciacion ?? 0), 10) || 0,
    valor_depreciacion_anual: toNum(d?.valor_depreciacion_anual ?? d?.valorDepreciacionAnual ?? 0, 0),
    valor_depreciacion_mensual: toNum(d?.valor_depreciacion_mensual ?? d?.valorDepreciacionMensual ?? 0, 0),

    fecha_adquisicion: toISO(d?.fecha_adquisicion ?? d?.fechaAdquisicion ?? d?.fecha ?? d?.createdAt ?? d?.created_at),
    fecha_inicio_depreciacion: toISO(d?.fecha_inicio_depreciacion ?? d?.fechaInicioDepreciacion ?? null),

    proveedor_nombre: d?.proveedor_nombre ?? d?.proveedorNombre ?? d?.proveedor ?? "",
    proveedor_email: d?.proveedor_email ?? d?.proveedorEmail ?? "",
    proveedor_telefono: d?.proveedor_telefono ?? d?.proveedorTelefono ?? "",
    proveedor_rfc: d?.proveedor_rfc ?? d?.proveedorRfc ?? "",

    categoria_activo: d?.categoria_activo ?? d?.categoriaActivo ?? "otro",
    subcuenta_id: d?.subcuenta_id ? String(d.subcuenta_id) : d?.subcuentaId ? String(d.subcuentaId) : null,
    cuenta_codigo: d?.cuenta_codigo ?? d?.cuentaCodigo ?? "",

    comentarios: d?.comentarios ?? "",

    estado: normalizeEstado(d?.estado ?? d?.status ?? "activo"),
    fecha_baja: toISO(d?.fecha_baja ?? d?.fechaBaja ?? null),
    valor_venta: toNum(d?.valor_venta ?? d?.valorVenta ?? 0, 0),
    motivo_baja: d?.motivo_baja ?? d?.motivoBaja ?? "",

    metodo_pago_venta: normalizeMetodoPago(d?.metodo_pago_venta ?? d?.metodoPagoVenta ?? ""),
    tipo_pago_venta: normalizeTipoPago(d?.tipo_pago_venta ?? d?.tipoPagoVenta ?? ""),
    monto_pagado_venta: toNum(d?.monto_pagado_venta ?? d?.montoPagadoVenta ?? 0, 0),
    monto_pendiente_venta: toNum(d?.monto_pendiente_venta ?? d?.montoPendienteVenta ?? 0, 0),
    fecha_vencimiento_venta: toISO(d?.fecha_vencimiento_venta ?? d?.fechaVencimientoVenta ?? null),

    comprador_nombre: d?.comprador_nombre ?? d?.compradorNombre ?? "",
    comprador_rfc: d?.comprador_rfc ?? d?.compradorRfc ?? "",
    comprador_telefono: d?.comprador_telefono ?? d?.compradorTelefono ?? "",
    comprador_email: d?.comprador_email ?? d?.compradorEmail ?? "",

    journalEntryId: d?.journalEntryId ? String(d.journalEntryId) : null,

    created_at: toISO(d?.created_at ?? d?.createdAt),
    updated_at: toISO(d?.updated_at ?? d?.updatedAt),
  };
}

function buildCreatePayload(body = {}) {
  return {
    producto_nombre: asTrim(body.producto_nombre || body.nombre),
    descripcion: asTrim(body.descripcion),
    imagen_url: asTrim(body.imagen_url),

    valor_total: toNum(body.valor_total, 0),
    monto_pagado: toNum(body.monto_pagado, 0),
    monto_pendiente:
      body.monto_pendiente !== undefined
        ? toNum(body.monto_pendiente, 0)
        : Math.max(0, toNum(body.valor_total, 0) - toNum(body.monto_pagado, 0)),

    tipo_pago: normalizeTipoPago(body.tipo_pago),
    metodo_pago: normalizeMetodoPago(body.metodo_pago),
    fecha_vencimiento: isoDateOrNull(body.fecha_vencimiento),

    anos_depreciacion: parseInt(String(body.anos_depreciacion ?? 0), 10) || 0,
    valor_depreciacion_anual: toNum(body.valor_depreciacion_anual, 0),
    valor_depreciacion_mensual: toNum(body.valor_depreciacion_mensual, 0),
    fecha_adquisicion: isoDateOrNull(body.fecha_adquisicion) || new Date(),
    fecha_inicio_depreciacion: isoDateOrNull(body.fecha_inicio_depreciacion),

    proveedor_nombre: asTrim(body.proveedor_nombre),
    proveedor_email: asTrim(body.proveedor_email),
    proveedor_telefono: asTrim(body.proveedor_telefono),
    proveedor_rfc: asTrim(body.proveedor_rfc),

    categoria_activo: asTrim(body.categoria_activo || "otro").toLowerCase() || "otro",
    subcuenta_id: isObjectId(body.subcuenta_id) ? body.subcuenta_id : null,
    cuenta_codigo: asTrim(body.cuenta_codigo),
    comentarios: asTrim(body.comentarios),

    estado: normalizeEstado(body.estado || "activo"),
    fecha_baja: isoDateOrNull(body.fecha_baja),
    valor_venta: toNum(body.valor_venta, 0),
    motivo_baja: asTrim(body.motivo_baja),

    metodo_pago_venta: normalizeMetodoPago(body.metodo_pago_venta),
    tipo_pago_venta: normalizeTipoPago(body.tipo_pago_venta),
    monto_pagado_venta: toNum(body.monto_pagado_venta, 0),
    monto_pendiente_venta:
      body.monto_pendiente_venta !== undefined
        ? toNum(body.monto_pendiente_venta, 0)
        : Math.max(0, toNum(body.valor_venta, 0) - toNum(body.monto_pagado_venta, 0)),
    fecha_vencimiento_venta: isoDateOrNull(body.fecha_vencimiento_venta),

    comprador_nombre: asTrim(body.comprador_nombre),
    comprador_rfc: asTrim(body.comprador_rfc),
    comprador_telefono: asTrim(body.comprador_telefono),
    comprador_email: asTrim(body.comprador_email),
  };
}

function buildPatchPayload(body = {}) {
  const patch = {};

  const maybeSet = (key, value) => {
    if (value !== undefined) patch[key] = value;
  };

  maybeSet("producto_nombre", body.producto_nombre !== undefined ? asTrim(body.producto_nombre) : undefined);
  maybeSet("descripcion", body.descripcion !== undefined ? asTrim(body.descripcion) : undefined);
  maybeSet("imagen_url", body.imagen_url !== undefined ? asTrim(body.imagen_url) : undefined);

  maybeSet("valor_total", body.valor_total !== undefined ? toNum(body.valor_total, 0) : undefined);
  maybeSet("monto_pagado", body.monto_pagado !== undefined ? toNum(body.monto_pagado, 0) : undefined);
  maybeSet("monto_pendiente", body.monto_pendiente !== undefined ? toNum(body.monto_pendiente, 0) : undefined);

  maybeSet("tipo_pago", body.tipo_pago !== undefined ? normalizeTipoPago(body.tipo_pago) : undefined);
  maybeSet("metodo_pago", body.metodo_pago !== undefined ? normalizeMetodoPago(body.metodo_pago) : undefined);
  maybeSet("fecha_vencimiento", body.fecha_vencimiento !== undefined ? isoDateOrNull(body.fecha_vencimiento) : undefined);

  maybeSet(
    "anos_depreciacion",
    body.anos_depreciacion !== undefined ? parseInt(String(body.anos_depreciacion), 10) || 0 : undefined
  );
  maybeSet(
    "valor_depreciacion_anual",
    body.valor_depreciacion_anual !== undefined ? toNum(body.valor_depreciacion_anual, 0) : undefined
  );
  maybeSet(
    "valor_depreciacion_mensual",
    body.valor_depreciacion_mensual !== undefined ? toNum(body.valor_depreciacion_mensual, 0) : undefined
  );
  maybeSet(
    "fecha_adquisicion",
    body.fecha_adquisicion !== undefined ? isoDateOrNull(body.fecha_adquisicion) : undefined
  );
  maybeSet(
    "fecha_inicio_depreciacion",
    body.fecha_inicio_depreciacion !== undefined ? isoDateOrNull(body.fecha_inicio_depreciacion) : undefined
  );

  maybeSet("proveedor_nombre", body.proveedor_nombre !== undefined ? asTrim(body.proveedor_nombre) : undefined);
  maybeSet("proveedor_email", body.proveedor_email !== undefined ? asTrim(body.proveedor_email) : undefined);
  maybeSet("proveedor_telefono", body.proveedor_telefono !== undefined ? asTrim(body.proveedor_telefono) : undefined);
  maybeSet("proveedor_rfc", body.proveedor_rfc !== undefined ? asTrim(body.proveedor_rfc) : undefined);

  maybeSet(
    "categoria_activo",
    body.categoria_activo !== undefined ? asTrim(body.categoria_activo).toLowerCase() : undefined
  );
  maybeSet(
    "subcuenta_id",
    body.subcuenta_id !== undefined ? (isObjectId(body.subcuenta_id) ? body.subcuenta_id : null) : undefined
  );
  maybeSet("cuenta_codigo", body.cuenta_codigo !== undefined ? asTrim(body.cuenta_codigo) : undefined);
  maybeSet("comentarios", body.comentarios !== undefined ? asTrim(body.comentarios) : undefined);

  maybeSet("estado", body.estado !== undefined ? normalizeEstado(body.estado) : undefined);
  maybeSet("fecha_baja", body.fecha_baja !== undefined ? isoDateOrNull(body.fecha_baja) : undefined);
  maybeSet("valor_venta", body.valor_venta !== undefined ? toNum(body.valor_venta, 0) : undefined);
  maybeSet("motivo_baja", body.motivo_baja !== undefined ? asTrim(body.motivo_baja) : undefined);

  maybeSet(
    "metodo_pago_venta",
    body.metodo_pago_venta !== undefined ? normalizeMetodoPago(body.metodo_pago_venta) : undefined
  );
  maybeSet(
    "tipo_pago_venta",
    body.tipo_pago_venta !== undefined ? normalizeTipoPago(body.tipo_pago_venta) : undefined
  );
  maybeSet(
    "monto_pagado_venta",
    body.monto_pagado_venta !== undefined ? toNum(body.monto_pagado_venta, 0) : undefined
  );
  maybeSet(
    "monto_pendiente_venta",
    body.monto_pendiente_venta !== undefined ? toNum(body.monto_pendiente_venta, 0) : undefined
  );
  maybeSet(
    "fecha_vencimiento_venta",
    body.fecha_vencimiento_venta !== undefined ? isoDateOrNull(body.fecha_vencimiento_venta) : undefined
  );

  maybeSet("comprador_nombre", body.comprador_nombre !== undefined ? asTrim(body.comprador_nombre) : undefined);
  maybeSet("comprador_rfc", body.comprador_rfc !== undefined ? asTrim(body.comprador_rfc) : undefined);
  maybeSet(
    "comprador_telefono",
    body.comprador_telefono !== undefined ? asTrim(body.comprador_telefono) : undefined
  );
  maybeSet("comprador_email", body.comprador_email !== undefined ? asTrim(body.comprador_email) : undefined);

  return patch;
}

function inferDepreciationAmount(entry) {
  const lines = entry?.lines || entry?.detalle_asientos || [];
  if (!Array.isArray(lines)) return 0;

  const code5109 = lines
    .filter((l) => {
      const code =
        l?.accountCodigo ??
        l?.accountCode ??
        l?.cuentaCodigo ??
        l?.cuenta_codigo ??
        l?.cuenta?.codigo ??
        l?.account?.codigo ??
        "";
      return String(code).trim() === "5109";
    })
    .reduce((sum, l) => {
      const debe = toNum(l?.debit ?? l?.debe ?? 0, 0);
      return sum + debe;
    }, 0);

  if (code5109 > 0) return code5109;

  const firstDebit = lines.reduce((sum, l) => {
    const debe = toNum(l?.debit ?? l?.debe ?? 0, 0);
    return sum + debe;
  }, 0);

  return firstDebit;
}

/**
 * GET /api/inversiones
 */
router.get("/", ensureAuth, async (req, res) => {
  try {
    if (!CapexModel) {
      return res.json({ ok: true, data: [], items: [] });
    }

    const owner = req.user._id;
    const docs = await CapexModel.find(ownerFilter(owner))
      .sort({ fecha_adquisicion: -1, createdAt: -1, _id: -1 })
      .lean();

    const items = (docs || []).map(mapCapexForUI);
    return res.json({ ok: true, data: items, items });
  } catch (err) {
    console.error("GET /api/inversiones error:", err);
    return res.status(500).json({
      ok: false,
      error: "SERVER_ERROR",
      message: err?.message || "SERVER_ERROR",
    });
  }
});

/**
 * POST /api/inversiones
 */
router.post("/", ensureAuth, async (req, res) => {
  try {
    if (!CapexModel) {
      return res.status(500).json({
        ok: false,
        error: "MODEL_NOT_AVAILABLE",
        message: "Capex model no disponible",
      });
    }

    const owner = req.user._id;
    const payload = buildCreatePayload(req.body || {});

    if (!payload.producto_nombre) {
      return res.status(400).json({
        ok: false,
        error: "VALIDATION",
        message: "producto_nombre es requerido",
      });
    }

    if (payload.valor_total <= 0) {
      return res.status(400).json({
        ok: false,
        error: "VALIDATION",
        message: "valor_total debe ser mayor a 0",
      });
    }

    const doc = await CapexModel.create({
      owner,
      ...payload,
    });

    const item = mapCapexForUI(doc);
    return res.status(201).json({ ok: true, data: item, item });
  } catch (err) {
    console.error("POST /api/inversiones error:", err);
    return res.status(500).json({
      ok: false,
      error: "SERVER_ERROR",
      message: err?.message || "SERVER_ERROR",
    });
  }
});

/**
 * GET /api/inversiones/transacciones
 * ✅ Devuelve historial ya normalizado:
 * - alta
 * - baja
 * - venta
 * - depreciaciones
 */
router.get("/transacciones", ensureAuth, async (req, res) => {
  try {
    if (!CapexModel) {
      return res.json({ ok: true, data: [], items: [] });
    }

    const owner = req.user._id;

    const inversionesDocs = await CapexModel.find(ownerFilter(owner))
      .sort({ fecha_adquisicion: -1, createdAt: -1, _id: -1 })
      .lean();

    const inversiones = (inversionesDocs || []).map(mapCapexForUI);
    const inversionIds = inversiones.map((i) => i.id).filter(Boolean);

    const depDocs = inversionIds.length
      ? await JournalEntry.find({
          owner,
          $or: [
            { source: "depreciacion_inversion", sourceId: { $in: inversionIds.filter(isObjectId) } },
            { source: "inversion_depreciacion", sourceId: { $in: inversionIds.filter(isObjectId) } },
            { source: "depreciacion_inversion", transaccionId: { $in: inversionIds.filter(isObjectId) } },
            { source: "inversion_depreciacion", transaccionId: { $in: inversionIds.filter(isObjectId) } },
            { "references.source": { $in: ["inversion", "capex"] }, "references.id": { $in: inversionIds } },
          ],
        })
          .sort({ date: -1, createdAt: -1 })
          .lean()
      : [];

    const depByInversionId = new Map();
    for (const dep of depDocs || []) {
      const sourceId = dep?.sourceId ? String(dep.sourceId) : dep?.transaccionId ? String(dep.transaccionId) : null;
      let invId = sourceId;

      if (!invId && Array.isArray(dep?.references)) {
        const ref = dep.references.find((r) => ["inversion", "capex"].includes(String(r?.source || "").toLowerCase()));
        if (ref?.id) invId = String(ref.id);
      }

      if (!invId) continue;
      if (!depByInversionId.has(invId)) depByInversionId.set(invId, []);
      depByInversionId.get(invId).push(dep);
    }

    const resultado = [];

    for (const inversion of inversiones) {
      resultado.push({
        id: `alta-${inversion.id}`,
        tipo: "alta",
        fecha: inversion.fecha_adquisicion,
        activo: inversion.producto_nombre,
        categoria: inversion.categoria_activo,
        monto: inversion.valor_total,
        descripcion: inversion.descripcion || "",
        inversion_id: inversion.id,
        inversion,
      });

      const deps = depByInversionId.get(inversion.id) || [];
      for (const dep of deps) {
        const fecha = dep?.date || dep?.fecha || dep?.createdAt || dep?.created_at || null;
        const numero_asiento =
          dep?.numeroAsiento || dep?.numero_asiento || dep?.numero || dep?.folio || null;

        resultado.push({
          id: `dep-${String(dep._id)}`,
          tipo: "depreciacion",
          fecha: toISO(fecha),
          activo: inversion.producto_nombre,
          categoria: inversion.categoria_activo,
          monto: inferDepreciationAmount(dep),
          descripcion: dep?.concept || dep?.descripcion || "Depreciación",
          numero_asiento,
          mes_ano: monthLabelEs(fecha),
          inversion_id: inversion.id,
          inversion,
          journalEntryId: String(dep._id),
        });
      }

      if (inversion.estado === "dado_de_baja" && inversion.fecha_baja) {
        resultado.push({
          id: `baja-${inversion.id}`,
          tipo: "baja",
          fecha: inversion.fecha_baja,
          activo: inversion.producto_nombre,
          categoria: inversion.categoria_activo,
          motivo: inversion.motivo_baja || "",
          inversion_id: inversion.id,
          inversion,
        });
      }

      if (inversion.estado === "vendido" && inversion.fecha_baja) {
        resultado.push({
          id: `venta-${inversion.id}`,
          tipo: "venta",
          fecha: inversion.fecha_baja,
          activo: inversion.producto_nombre,
          categoria: inversion.categoria_activo,
          valor_venta: inversion.valor_venta || 0,
          motivo: inversion.motivo_baja || "",
          inversion_id: inversion.id,
          inversion,
        });
      }
    }

    resultado.sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime());

    return res.json({ ok: true, data: resultado, items: resultado });
  } catch (err) {
    console.error("GET /api/inversiones/transacciones error:", err);
    return res.status(500).json({
      ok: false,
      error: "SERVER_ERROR",
      message: err?.message || "SERVER_ERROR",
    });
  }
});

/**
 * GET /api/inversiones/asientos/bulk
 * ✅ Devuelve ids de inversiones que sí tienen asiento
 */
router.get("/asientos/bulk", ensureAuth, async (req, res) => {
  try {
    if (!CapexModel) {
      return res.json({ ok: true, data: [], items: [] });
    }

    const owner = req.user._id;

    const docs = await JournalEntry.find({
      owner,
      $or: [
        { source: "inversion", sourceId: { $ne: null } },
        { source: "capex", sourceId: { $ne: null } },
        { source: "inversion_alta", sourceId: { $ne: null } },
        { source: "inversion", transaccionId: { $ne: null } },
        { source: "capex", transaccionId: { $ne: null } },
        { source: "inversion_alta", transaccionId: { $ne: null } },
        { "references.source": { $in: ["inversion", "capex"] }, "references.id": { $exists: true, $ne: "" } },
      ],
    })
      .select("_id source sourceId transaccionId references")
      .lean();

    const ids = new Set();

    for (const doc of docs || []) {
      if (doc?.sourceId) ids.add(String(doc.sourceId));
      if (doc?.transaccionId) ids.add(String(doc.transaccionId));

      if (Array.isArray(doc?.references)) {
        doc.references.forEach((r) => {
          const src = String(r?.source || "").toLowerCase();
          const id = String(r?.id || "").trim();
          if (["inversion", "capex"].includes(src) && id) ids.add(id);
        });
      }
    }

    const data = Array.from(ids);
    return res.json({ ok: true, data, items: data });
  } catch (err) {
    console.error("GET /api/inversiones/asientos/bulk error:", err);
    return res.status(500).json({
      ok: false,
      error: "SERVER_ERROR",
      message: err?.message || "SERVER_ERROR",
    });
  }
});

/**
 * PATCH /api/inversiones/:id
 */
router.patch("/:id", ensureAuth, async (req, res) => {
  try {
    if (!CapexModel) {
      return res.status(500).json({
        ok: false,
        error: "MODEL_NOT_AVAILABLE",
        message: "Capex model no disponible",
      });
    }

    const owner = req.user._id;
    const id = String(req.params.id || "").trim();

    if (!isObjectId(id)) {
      return res.status(400).json({
        ok: false,
        error: "VALIDATION",
        message: "id inválido",
      });
    }

    const patch = buildPatchPayload(req.body || {});
    const doc = await CapexModel.findOneAndUpdate(
      { _id: new mongoose.Types.ObjectId(id), ...ownerFilter(owner) },
      { $set: patch },
      { new: true, runValidators: true }
    ).lean();

    if (!doc) {
      return res.status(404).json({
        ok: false,
        error: "NOT_FOUND",
        message: "Inversión no encontrada",
      });
    }

    const item = mapCapexForUI(doc);
    return res.json({ ok: true, data: item, item });
  } catch (err) {
    console.error("PATCH /api/inversiones/:id error:", err);
    return res.status(500).json({
      ok: false,
      error: "SERVER_ERROR",
      message: err?.message || "SERVER_ERROR",
    });
  }
});

/**
 * DELETE /api/inversiones/:id
 */
router.delete("/:id", ensureAuth, async (req, res) => {
  try {
    if (!CapexModel) {
      return res.status(500).json({
        ok: false,
        error: "MODEL_NOT_AVAILABLE",
        message: "Capex model no disponible",
      });
    }

    const owner = req.user._id;
    const id = String(req.params.id || "").trim();

    if (!isObjectId(id)) {
      return res.status(400).json({
        ok: false,
        error: "VALIDATION",
        message: "id inválido",
      });
    }

    const doc = await CapexModel.findOneAndDelete({
      _id: new mongoose.Types.ObjectId(id),
      ...ownerFilter(owner),
    }).lean();

    if (!doc) {
      return res.status(404).json({
        ok: false,
        error: "NOT_FOUND",
        message: "Inversión no encontrada",
      });
    }

    return res.json({ ok: true, deleted: true, id });
  } catch (err) {
    console.error("DELETE /api/inversiones/:id error:", err);
    return res.status(500).json({
      ok: false,
      error: "SERVER_ERROR",
      message: err?.message || "SERVER_ERROR",
    });
  }
});

/**
 * GET /api/inversiones/capex?pendiente_gt=0&estado=activo&start=YYYY-MM-DD&end=YYYY-MM-DD&limit=500
 * ✅ Compat legacy
 */
router.get("/capex", ensureAuth, async (req, res) => {
  try {
    if (!CapexModel) {
      return res.json({ ok: true, data: [], items: [], meta: { hasModel: false } });
    }

    const owner = req.user._id;

    const pendienteGtRaw = req.query.pendiente_gt ?? req.query.pendienteGt ?? null;
    const pendienteGt =
      pendienteGtRaw === null || pendienteGtRaw === undefined || asTrim(pendienteGtRaw) === ""
        ? null
        : toNum(pendienteGtRaw, 0);

    const estado = asTrim(req.query.estado ?? "").toLowerCase();
    const start = isoDateOrNull(req.query.start);
    const end = isoDateOrNull(req.query.end);

    const limitRaw = Number(req.query.limit ?? 500);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 2000) : 500;

    const filter = ownerFilter(owner);

    if (estado === "activo") {
      filter.estado = { $ne: "cancelado" };
    } else if (estado) {
      filter.estado = normalizeEstado(estado);
    }

    if (start || end) {
      filter.$and = [
        ...(filter.$and || []),
        {
          fecha_adquisicion: {
            ...(start ? { $gte: start } : {}),
            ...(end ? { $lte: endOfDay(end) } : {}),
          },
        },
      ];
    }

    const docs = await CapexModel.find(filter)
      .sort({ fecha_adquisicion: -1, createdAt: -1, _id: -1 })
      .limit(limit)
      .lean();

    const items = (docs || [])
      .map(mapCapexForUI)
      .filter((x) => (pendienteGt === null ? true : toNum(x.monto_pendiente, 0) > pendienteGt));

    return res.json({
      ok: true,
      data: items,
      items,
      meta: { pendiente_gt: pendienteGt, hasModel: true, limit },
    });
  } catch (err) {
    console.error("GET /api/inversiones/capex error:", err);
    return res.status(500).json({
      ok: false,
      error: "SERVER_ERROR",
      message: err?.message || "SERVER_ERROR",
    });
  }
});

module.exports = router;