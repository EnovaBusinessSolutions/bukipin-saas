// backend/routes/cxp.js
const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const ensureAuth = require("../middleware/ensureAuth");

const ExpenseTransaction = require("../models/ExpenseTransaction");

// ✅ Opcional: asientos contables (para /api/cxp/asientos y para pagos)
let JournalEntry = null;
try {
  // eslint-disable-next-line global-require
  JournalEntry = require("../models/JournalEntry");
} catch (e) {
  JournalEntry = null;
}

// Helpers
function toNum(v, def = 0) {
  const n = Number(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : def;
}
function asStr(v, def = "") {
  if (v === undefined || v === null) return def;
  return String(v);
}
function asTrim(v, def = "") {
  return asStr(v, def).trim();
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

function normalizeMetodoPago(v) {
  const s = asTrim(v).toLowerCase();
  if (!s) return "";
  // compat FE
  if (s === "transferencia" || s === "tarjeta-transferencia") return "bancos";
  return s; // efectivo | bancos | tarjeta_credito_*
}

function resolveCreditAccountByMetodoPago(metodoPago) {
  const CASH = process.env.CTA_EFECTIVO || "1001";
  const BANK = process.env.CTA_BANCOS || "1002";

  if (!metodoPago) return { tipo: "unknown", cuentaCodigo: BANK, meta: {} };
  if (metodoPago === "efectivo") return { tipo: "cash", cuentaCodigo: CASH, meta: {} };
  if (metodoPago === "bancos") return { tipo: "bank", cuentaCodigo: BANK, meta: {} };

  if (metodoPago.startsWith("tarjeta_credito_")) {
    const CC = process.env.CTA_TARJETAS_CREDITO || "2101";
    return { tipo: "credit_card", cuentaCodigo: CC, meta: { tarjetaId: metodoPago.replace("tarjeta_credito_", "") } };
  }

  return { tipo: "other", cuentaCodigo: BANK, meta: {} };
}

function isOtrosGastosFromTx(tx) {
  const s = String(tx?.subtipoEgreso ?? tx?.subtipo_egreso ?? "").toLowerCase().trim();
  const t = String(tx?.tipoEgreso ?? tx?.tipo_egreso ?? tx?.tipo ?? "").toLowerCase().trim();
  return s === "otros_gastos" || t === "otro";
}

function pickLines(entry) {
  return entry?.lines || entry?.detalle_asientos || entry?.detalles_asiento || [];
}
function pickCode(line) {
  return String(
    line?.accountCodigo ??
      line?.accountCode ??
      line?.cuentaCodigo ??
      line?.cuenta_codigo ??
      line?.code ??
      line?.cuenta?.code ??
      line?.cuenta?.codigo ??
      line?.account?.code ??
      line?.account?.codigo ??
      ""
  ).trim();
}
function pickDebe(line) {
  const side = String(line?.side || "").toLowerCase().trim();
  const monto = toNum(line?.monto ?? line?.amount ?? line?.importe ?? line?.valor ?? 0, 0);
  return toNum(line?.debit ?? line?.debe ?? 0, 0) || (side === "debit" ? monto : 0);
}
function pickHaber(line) {
  const side = String(line?.side || "").toLowerCase().trim();
  const monto = toNum(line?.monto ?? line?.amount ?? line?.importe ?? line?.valor ?? 0, 0);
  return toNum(line?.credit ?? line?.haber ?? 0, 0) || (side === "credit" ? monto : 0);
}
function pickMemo(line) {
  return String(line?.memo ?? line?.descripcion ?? line?.concepto ?? line?.description ?? "").trim();
}
function pickEntryDate(entry) {
  return entry?.date || entry?.fecha || entry?.entryDate || entry?.createdAt || entry?.created_at || null;
}
function pickEntryNumero(entry) {
  return entry?.numeroAsiento ?? entry?.numero_asiento ?? entry?.numero ?? entry?.folio ?? String(entry?._id || "");
}

/**
 * Mapeo consistente para FE (snake_case + espejo camelCase)
 * Similar a mapTxForUI pero acotado a lo que CxP necesita.
 */
function mapTxForCxP(doc) {
  const d = doc?.toObject ? doc.toObject() : doc;

  const item = {
    id: String(d._id),
    _id: d._id,

    descripcion: d.descripcion ?? "",

    tipo_pago: d.tipoPago ?? d.tipo_pago ?? "",
    metodo_pago: d.metodoPago ?? d.metodo_pago ?? "",

    monto_total: toNum(d.montoTotal ?? d.monto_total ?? d.total ?? 0, 0),
    monto_pagado: toNum(d.montoPagado ?? d.monto_pagado ?? 0, 0),
    saldo_pendiente: toNum(d.montoPendiente ?? d.monto_pendiente ?? 0, 0),

    fecha: d.fecha ? new Date(d.fecha).toISOString() : d.createdAt ? new Date(d.createdAt).toISOString() : null,

    // ✅ fecha límite CxP
    fecha_vencimiento: d.fechaVencimiento
      ? new Date(d.fechaVencimiento).toISOString()
      : d.fecha_vencimiento
      ? new Date(d.fecha_vencimiento).toISOString()
      : null,

    proveedor_id: d.proveedorId ? String(d.proveedorId) : d.proveedor_id ? String(d.proveedor_id) : null,
    proveedor_nombre: d.proveedorNombre ?? d.proveedor_nombre ?? null,

    cuenta_codigo: d.cuentaCodigo ?? d.cuenta_codigo ?? "",
    subcuenta_id: d.subcuentaId ? String(d.subcuentaId) : d.subcuenta_id ? String(d.subcuenta_id) : null,

    asiento_id: d.asientoId ? String(d.asientoId) : d.asiento_id ? String(d.asiento_id) : null,

    estado: d.estado ?? d.status ?? "activo",

    // para lógica de CxP
    subtipo_egreso: d.subtipoEgreso ?? d.subtipo_egreso ?? null,

    created_at: d.createdAt ?? d.created_at ?? null,
    updated_at: d.updatedAt ?? d.updated_at ?? null,
  };

  // espejo camelCase
  item.tipoPago = item.tipo_pago;
  item.metodoPago = item.metodo_pago;
  item.montoTotal = item.monto_total;
  item.montoPagado = item.monto_pagado;
  item.montoPendiente = item.saldo_pendiente;
  item.fechaVencimiento = item.fecha_vencimiento;
  item.proveedorId = item.proveedor_id;
  item.proveedorNombre = item.proveedor_nombre;
  item.cuentaCodigo = item.cuenta_codigo;
  item.subcuentaId = item.subcuenta_id;
  item.asientoId = item.asiento_id;

  return item;
}

/**
 * Construye filtro robusto para “pendientes”
 * - tipoPago: credito/parcial
 * - montoPendiente > 0
 * - estado != cancelado
 */
function buildPendientesFilter({ owner, start, end, pendientesOnly }) {
  const filter = { owner };

  if (start || end) {
    filter.fecha = {};
    if (start) filter.fecha.$gte = start;
    if (end) filter.fecha.$lte = endOfDay(end);
  }

  filter.estado = { $ne: "cancelado" };

  if (pendientesOnly) {
    filter.$and = [
      {
        $or: [{ tipoPago: { $in: ["credito", "parcial"] } }, { tipo_pago: { $in: ["credito", "parcial"] } }],
      },
      {
        $or: [{ montoPendiente: { $gt: 0 } }, { monto_pendiente: { $gt: 0 } }],
      },
    ];
  }

  return filter;
}

/**
 * Calcula status de vencimiento para UI
 */
function computeDueMeta(tx, now = new Date()) {
  const saldo = toNum(tx.saldo_pendiente ?? tx.montoPendiente, 0);
  const fv = tx.fecha_vencimiento ? new Date(tx.fecha_vencimiento) : null;

  if (!(saldo > 0)) return { status: "pagada", dias: 0 };
  if (!fv || Number.isNaN(fv.getTime())) return { status: "sin_fecha", dias: 0 };

  const a = new Date(now);
  a.setHours(0, 0, 0, 0);
  const b = new Date(fv);
  b.setHours(0, 0, 0, 0);

  const diffDays = Math.round((a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays > 0) return { status: "vencida", dias: diffDays };
  if (diffDays === 0) return { status: "vence_hoy", dias: 0 };
  return { status: "por_vencer", dias: Math.abs(diffDays) };
}

/**
 * Helper central para listar egresos CxP
 */
async function listEgresosCxP({ owner, pendientesOnly, start, end, limit }) {
  const filter = buildPendientesFilter({ owner, start, end, pendientesOnly });
  const docs = await ExpenseTransaction.find(filter).sort({ fecha: -1, createdAt: -1 }).limit(limit).lean();
  return docs.map(mapTxForCxP);
}

/**
 * ✅ COMPAT: /api/cxp/inversiones
 */
router.get("/inversiones", ensureAuth, async (req, res) => {
  try {
    const pendientesOnly = String(req.query.pendientes ?? "0").trim() === "1";
    const start = isoDateOrNull(req.query.start);
    const end = isoDateOrNull(req.query.end);

    return res.json({
      ok: true,
      data: [],
      items: [],
      meta: { pendientesOnly, start: start ? start.toISOString() : null, end: end ? end.toISOString() : null },
    });
  } catch (err) {
    console.error("GET /api/cxp/inversiones error:", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR", message: err?.message || "SERVER_ERROR" });
  }
});

/**
 * ✅ GET /api/cxp/facturas/:id/pagos?source=egreso|capex
 * Por ahora: implementado SOLO para source=egreso usando JournalEntry source="pago_cxp" y sourceId=facturaId
 */
router.get("/facturas/:id/pagos", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;
    const facturaId = String(req.params.id || "").trim();
    const source = String(req.query.source || "egreso").trim().toLowerCase();

    if (!JournalEntry) {
      return res.json({ ok: true, data: [], items: [], meta: { reason: "JournalEntry model not found" } });
    }
    if (!mongoose.Types.ObjectId.isValid(facturaId)) {
      return res.status(400).json({ ok: false, error: "VALIDATION", message: "facturaId inválido" });
    }
    if (source !== "egreso") {
      return res.status(400).json({ ok: false, error: "NOT_SUPPORTED", message: "Solo soporta source=egreso por ahora." });
    }

    const oid = new mongoose.Types.ObjectId(facturaId);

    const pagos = await JournalEntry.find({
      owner,
      source: { $in: ["pago_cxp", "pagos_cxp", "pago"] },
      $or: [{ sourceId: oid }, { transaccionId: oid }, { source_id: oid }],
    })
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();

    const items = (pagos || []).map((e) => {
      const fecha = pickEntryDate(e) ? new Date(pickEntryDate(e)).toISOString() : new Date().toISOString();
      const numero = pickEntryNumero(e);

      const lines = pickLines(e);
      // monto: tomar el HABER (caja/bancos) si existe, si no el DEBE
      let monto = 0;
      let metodo = "";

      for (const l of lines) {
        const code = pickCode(l);
        const haber = pickHaber(l);
        const debe = pickDebe(l);

        if (haber > 0 && (code === "1001" || code === "1002" || code === "2101" || String(code).startsWith("10"))) {
          monto = haber;
        }
        if (!monto && debe > 0 && (code === "2001" || code === "2003" || String(code).startsWith("20"))) {
          monto = debe;
        }
      }

      // inferir método por la cuenta de salida
      for (const l of lines) {
        const code = pickCode(l);
        const haber = pickHaber(l);
        if (haber > 0 && code === (process.env.CTA_EFECTIVO || "1001")) metodo = "efectivo";
        if (haber > 0 && code === (process.env.CTA_BANCOS || "1002")) metodo = "bancos";
      }

      return {
        id: String(e._id),
        fecha,
        monto: Math.round(toNum(monto, 0) * 100) / 100,
        metodo_pago: metodo || null,
        descripcion: String(e.concept ?? e.concepto ?? e.descripcion ?? e.memo ?? "").trim() || `Pago CxP ${numero || ""}`,
        es_pago_inicial: false,
      };
    });

    return res.json({ ok: true, data: items, items, meta: { count: items.length } });
  } catch (err) {
    console.error("GET /api/cxp/facturas/:id/pagos error:", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR", message: err?.message || "SERVER_ERROR" });
  }
});

/**
 * ✅ POST /api/cxp/pagos
 * body: { facturaId, source:"egreso"|"capex", monto, metodo }
 *
 * Por ahora: SOLO source="egreso"
 * - crea JournalEntry source="pago_cxp" con sourceId=facturaId
 * - Debe: 2001 (Proveedores) o 2003 (Acreedores) según subtipoEgreso
 * - Haber: 1001/1002 según método
 * - actualiza montoPagado/montoPendiente en ExpenseTransaction
 */
router.post("/pagos", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;

    if (!JournalEntry) {
      return res.status(500).json({ ok: false, error: "MISSING_MODEL", message: "JournalEntry model not found" });
    }

    const facturaId = String(req.body?.facturaId || "").trim();
    const source = String(req.body?.source || "egreso").trim().toLowerCase();
    const monto = toNum(req.body?.monto, 0);
    const metodoPagoRaw = String(req.body?.metodo || req.body?.metodo_pago || req.body?.metodoPago || "").trim();

    if (!mongoose.Types.ObjectId.isValid(facturaId)) {
      return res.status(400).json({ ok: false, error: "VALIDATION", message: "facturaId inválido" });
    }
    if (source !== "egreso") {
      return res.status(400).json({ ok: false, error: "NOT_SUPPORTED", message: "Solo soporta source=egreso por ahora." });
    }
    if (!(monto > 0)) {
      return res.status(400).json({ ok: false, error: "VALIDATION", message: "monto debe ser > 0" });
    }

    const metodoPago = normalizeMetodoPago(metodoPagoRaw);
    if (!metodoPago) {
      return res.status(400).json({ ok: false, error: "VALIDATION", message: "metodo es requerido" });
    }

    const tx = await ExpenseTransaction.findOne({ owner, _id: new mongoose.Types.ObjectId(facturaId) });
    if (!tx) return res.status(404).json({ ok: false, error: "NOT_FOUND", message: "Factura (egreso) no encontrada" });

    if (String(tx.estado || "").toLowerCase() === "cancelado") {
      return res.status(400).json({ ok: false, error: "VALIDATION", message: "No se puede pagar un egreso cancelado" });
    }

    const pendienteActual = toNum(tx.montoPendiente, 0);
    if (!(pendienteActual > 0)) {
      return res.status(400).json({ ok: false, error: "VALIDATION", message: "Esta factura ya no tiene saldo pendiente" });
    }
    if (monto > pendienteActual) {
      return res.status(400).json({ ok: false, error: "VALIDATION", message: "El monto no puede ser mayor al saldo pendiente" });
    }

    // ✅ Cuenta pendiente según subtipo (otros_gastos => 2003, si no 2001)
    const PROVEEDORES_2001 = process.env.CTA_CXP || "2001";
    const OTROS_ACREEDORES_2003 = process.env.CTA_OTROS_ACREEDORES || "2003";
    const cuentaPendiente = isOtrosGastosFromTx(tx) ? OTROS_ACREEDORES_2003 : PROVEEDORES_2001;

    const creditInfo = resolveCreditAccountByMetodoPago(metodoPago);

    const conceptText = `Pago CxP: ${tx.descripcion || "Egreso"} (${metodoPago})`;

    const lines = [
      {
        accountCodigo: String(cuentaPendiente),
        debit: monto,
        credit: 0,
        memo: `Aplicación a ${cuentaPendiente} (${isOtrosGastosFromTx(tx) ? "Acreedores" : "Proveedores"})`,
      },
      {
        accountCodigo: String(creditInfo.cuentaCodigo),
        debit: 0,
        credit: monto,
        memo: `Salida por ${creditInfo.tipo}`,
      },
    ];

    const asiento = await JournalEntry.create({
      owner,
      date: new Date(),
      concept: conceptText,
      source: "pago_cxp",
      sourceId: tx._id,
      transaccionId: tx._id,
      source_id: tx._id,
      lines,
      references: [
        {
          source: "egreso",
          id: String(tx._id),
          numero: String(tx.numeroAsiento || ""),
        },
      ],
    });

    // ✅ Actualizar factura
    const nuevoPagado = toNum(tx.montoPagado, 0) + monto;
    tx.montoPagado = nuevoPagado;
    // El pre-validate del modelo recalcula pendiente correctamente, pero lo seteo explícito por claridad:
    tx.montoPendiente = Math.max(0, toNum(tx.montoTotal, 0) - nuevoPagado);

    // si ya quedó en 0, lo marcamos como contado (opcional)
    if (tx.montoPendiente <= 0) {
      tx.tipoPago = "contado";
      tx.metodoPago = metodoPago; // último método usado
    } else {
      tx.tipoPago = "parcial"; // sigue siendo parcial
      tx.metodoPago = metodoPago;
    }

    await tx.save();

    return res.json({
      ok: true,
      pago_id: String(asiento._id),
      asiento_id: String(asiento._id),
      factura_id: String(tx._id),
      data: { ok: true },
    });
  } catch (err) {
    console.error("POST /api/cxp/pagos error:", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR", message: err?.message || "SERVER_ERROR" });
  }
});

/**
 * ✅ GET /api/cxp/asientos?cuentas=2001,2002&start&end&limit=500
 */
router.get("/asientos", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;

    if (!JournalEntry) {
      return res.json({ ok: true, data: [], items: [], meta: { reason: "JournalEntry model not found" } });
    }

    const cuentasParam = String(req.query.cuentas ?? "").trim();
    const cuentas = cuentasParam
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const start = isoDateOrNull(req.query.start);
    const end = isoDateOrNull(req.query.end);

    const limitRaw = Number(req.query.limit ?? 500);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 2000) : 500;

    if (!cuentas.length) {
      return res.json({ ok: true, data: [], items: [], meta: { cuentas: [], limit } });
    }

    const match = { owner };
    if (start || end) {
      const dateFilter = {};
      if (start) dateFilter.$gte = start;
      if (end) dateFilter.$lte = endOfDay(end);

      match.$or = [
        { date: dateFilter },
        { fecha: dateFilter },
        { entryDate: dateFilter },
        { createdAt: dateFilter },
        { created_at: dateFilter },
      ];
    }

    const docs = await JournalEntry.find({
      ...match,
      $or: [
        { "lines.accountCodigo": { $in: cuentas } },
        { "lines.cuentaCodigo": { $in: cuentas } },
        { "detalle_asientos.accountCodigo": { $in: cuentas } },
        { "detalle_asientos.cuentaCodigo": { $in: cuentas } },
        { "detalles_asiento.accountCodigo": { $in: cuentas } },
        { "detalles_asiento.cuentaCodigo": { $in: cuentas } },
      ],
    })
      .select(
        "date fecha entryDate createdAt created_at concept concepto descripcion memo numeroAsiento numero_asiento numero folio source fuente sourceId source_id transaccionId transaccion_id lines detalle_asientos detalles_asiento"
      )
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    const items = (docs || []).map((e) => {
      const fecha = pickEntryDate(e);
      const numero = pickEntryNumero(e);
      const concept = String(e.concept ?? e.concepto ?? e.descripcion ?? e.memo ?? "").trim();

      const lines = pickLines(e)
        .map((l) => {
          const code = pickCode(l) || null;
          return {
            cuenta_codigo: code,
            debe: pickDebe(l),
            haber: pickHaber(l),
            descripcion: pickMemo(l) || null,
          };
        })
        .filter((l) => (l.cuenta_codigo ? cuentas.includes(l.cuenta_codigo) : false));

      return {
        id: String(e._id),
        _id: e._id,
        numero_asiento: String(numero || ""),
        concept: concept || null,
        fecha: fecha ? new Date(fecha).toISOString() : null,
        source: e.source ?? e.fuente ?? null,
        source_id: e.sourceId ?? e.source_id ?? e.transaccionId ?? e.transaccion_id ?? null,
        lines,
      };
    });

    return res.json({ ok: true, data: items, items, meta: { cuentas, limit } });
  } catch (err) {
    console.error("GET /api/cxp/asientos error:", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR", message: err?.message || "SERVER_ERROR" });
  }
});

/**
 * GET /api/cxp/egresos?pendientes=1&start&end&limit=200
 */
router.get("/egresos", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;

    const pendientesOnly = String(req.query.pendientes ?? "0").trim() === "1";
    const start = isoDateOrNull(req.query.start);
    const end = isoDateOrNull(req.query.end);

    const limitRaw = Number(req.query.limit ?? 300);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 1000) : 300;

    const items = await listEgresosCxP({ owner, pendientesOnly, start, end, limit });

    return res.json({ ok: true, data: items, items, meta: { pendientesOnly, limit } });
  } catch (err) {
    console.error("GET /api/cxp/egresos error:", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR", message: err?.message || "SERVER_ERROR" });
  }
});

/**
 * GET /api/cxp/transacciones
 * ✅ Ahora mezcla: egresos + pagos (pago_cxp) para que el Resumen se vea completo.
 */
router.get("/transacciones", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;

    const start = isoDateOrNull(req.query.start);
    const end = isoDateOrNull(req.query.end);

    const limitRaw = Number(req.query.limit ?? 500);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 2000) : 500;

    // 1) facturas (egresos) - incluimos pagadas también aquí porque el resumen lo requiere
    const egresos = await ExpenseTransaction.find({ owner, estado: { $ne: "cancelado" } })
      .sort({ fecha: -1, createdAt: -1 })
      .limit(limit)
      .lean();

    const facturas = egresos.map((d) => {
      const tx = mapTxForCxP(d);
      return {
        id: tx.id,
        created_at: tx.created_at || tx.fecha || new Date().toISOString(),
        fecha: tx.fecha || null,

        proveedor_nombre: tx.proveedor_nombre || "Sin proveedor",
        descripcion: tx.descripcion || "",

        tipo: isOtrosGastosFromTx(d) ? "Acreedores Diversos" : "Egreso",
        subtipo: isOtrosGastosFromTx(d) ? "otros_gastos" : String(d.subtipoEgreso ?? d.subtipo_egreso ?? ""),

        monto_total: toNum(tx.monto_total, 0),
        monto_pagado: toNum(tx.monto_pagado, 0),
        monto_pendiente: toNum(tx.saldo_pendiente, 0),

        tipo_pago: tx.tipo_pago || "",
        metodo_pago: tx.metodo_pago || "-",

        fecha_vencimiento: tx.fecha_vencimiento || null,
        estado: tx.estado || "activo",

        fuente: "egreso",
      };
    });

    // 2) pagos (JournalEntry source=pago_cxp)
    let pagos = [];
    if (JournalEntry) {
      const match = { owner, source: { $in: ["pago_cxp", "pagos_cxp", "pago"] } };

      if (start || end) {
        const dateFilter = {};
        if (start) dateFilter.$gte = start;
        if (end) dateFilter.$lte = endOfDay(end);
        match.$or = [
          { date: dateFilter },
          { fecha: dateFilter },
          { entryDate: dateFilter },
          { createdAt: dateFilter },
          { created_at: dateFilter },
        ];
      }

      const docs = await JournalEntry.find(match)
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean();

      pagos = (docs || []).map((e) => {
        const fecha = pickEntryDate(e);
        const numero = pickEntryNumero(e);

        const lines = pickLines(e);
        let monto = 0;
        let metodo = "-";

        // monto: preferimos HABER (caja/bancos)
        for (const l of lines) {
          const code = pickCode(l);
          const haber = pickHaber(l);
          const debe = pickDebe(l);

          if (haber > 0 && (code === "1001" || code === "1002" || code === "2101" || String(code).startsWith("10"))) {
            monto = haber;
          }
          if (!monto && debe > 0 && (code === "2001" || code === "2003" || String(code).startsWith("20"))) {
            monto = debe;
          }
        }

        for (const l of lines) {
          const code = pickCode(l);
          const haber = pickHaber(l);
          if (haber > 0 && code === (process.env.CTA_EFECTIVO || "1001")) metodo = "efectivo";
          if (haber > 0 && code === (process.env.CTA_BANCOS || "1002")) metodo = "bancos";
        }

        const sourceId =
          e.sourceId ? String(e.sourceId) : e.transaccionId ? String(e.transaccionId) : e.source_id ? String(e.source_id) : null;

        return {
          id: String(e._id),
          created_at: fecha ? new Date(fecha).toISOString() : new Date().toISOString(),
          fecha: fecha ? new Date(fecha).toISOString() : null,

          proveedor_nombre: "Pago CxP",
          descripcion: String(e.concept ?? e.concepto ?? e.descripcion ?? e.memo ?? "").trim() || `Pago CxP ${numero || ""}`,

          tipo: "Pago CxP",
          subtipo: sourceId ? `factura:${sourceId}` : "pago",

          monto_total: Math.round(toNum(monto, 0) * 100) / 100,
          monto_pagado: Math.round(toNum(monto, 0) * 100) / 100,
          monto_pendiente: 0,

          tipo_pago: "contado",
          metodo_pago: metodo,

          fecha_vencimiento: null,
          estado: "activo",

          fuente: "pago_cxp",
        };
      });
    }

    const out = [...facturas, ...pagos];

    // ordenar desc por created_at
    out.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    // respetar limit final
    const sliced = out.slice(0, limit);

    return res.json({ ok: true, data: sliced, items: sliced, meta: { limit, hasPayments: !!JournalEntry } });
  } catch (err) {
    console.error("GET /api/cxp/transacciones error:", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR", message: err?.message || "SERVER_ERROR" });
  }
});

/**
 * GET /api/cxp/detalle?pendientes=1&start&end
 */
router.get("/detalle", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;

    const pendientesOnly = String(req.query.pendientes ?? "0").trim() === "1";
    const start = isoDateOrNull(req.query.start);
    const end = isoDateOrNull(req.query.end);

    const limitRaw = Number(req.query.limit ?? 2000);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 5000) : 2000;

    const docs = await ExpenseTransaction.find(buildPendientesFilter({ owner, start, end, pendientesOnly }))
      .sort({ fecha: -1, createdAt: -1 })
      .limit(limit)
      .lean();

    const now = new Date();

    const cuentas = docs.map((d) => {
      const tx = mapTxForCxP(d);
      const due = computeDueMeta(tx, now);

      return {
        cuenta_id: tx.id,
        egreso_id: tx.id,
        transaccion_id: tx.id,

        proveedor_id: tx.proveedor_id,
        proveedor_nombre: tx.proveedor_nombre,

        descripcion: tx.descripcion,

        fecha: tx.fecha,
        fecha_vencimiento: tx.fecha_vencimiento,

        monto_total: tx.monto_total,
        monto_pagado: tx.monto_pagado,
        saldo_pendiente: tx.saldo_pendiente,

        cuenta_codigo: tx.cuenta_codigo,
        subcuenta_id: tx.subcuenta_id,

        tipo_pago: tx.tipo_pago,
        metodo_pago: tx.metodo_pago,

        asiento_id: tx.asiento_id,

        estado: tx.estado,

        vencimiento_status: due.status,
        dias_vencidos: due.status === "vencida" ? due.dias : 0,
        dias_para_vencer: due.status === "por_vencer" ? due.dias : 0,
      };
    });

    const totalPorPagar = cuentas.reduce((acc, c) => acc + toNum(c.saldo_pendiente, 0), 0);
    const vencidas = cuentas.filter((c) => c.vencimiento_status === "vencida");
    const porVencer = cuentas.filter(
      (c) => c.vencimiento_status === "por_vencer" || c.vencimiento_status === "vence_hoy"
    );

    const summary = {
      total_por_pagar: Math.round(totalPorPagar * 100) / 100,
      total_cuentas: cuentas.length,
      cuentas_vencidas: vencidas.length,
      cuentas_por_vencer: porVencer.length,
    };

    return res.json({ ok: true, data: cuentas, cuentas, summary, meta: { pendientesOnly, limit } });
  } catch (err) {
    console.error("GET /api/cxp/detalle error:", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR", message: err?.message || "SERVER_ERROR" });
  }
});

module.exports = router;