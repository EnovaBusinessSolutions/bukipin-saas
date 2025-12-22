// backend/routes/transaccionesEgresos.js
const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const ensureAuth = require("../middleware/ensureAuth");

const ExpenseTransaction = require("../models/ExpenseTransaction");
const ExpenseProduct = require("../models/ExpenseProduct");

// ✅ Opcional: si existe en tu proyecto, lo usamos para crear el asiento contable
let JournalEntry = null;
try {
  // Ajusta el nombre si tu modelo se llama distinto (Asiento, JournalEntry, Poliza, etc.)
  // eslint-disable-next-line global-require
  JournalEntry = require("../models/JournalEntry");
} catch (e) {
  JournalEntry = null;
}

function toNum(v, def = 0) {
  const n = Number(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : def;
}
function asStr(v, def = "") {
  if (v === undefined || v === null) return def;
  return String(v);
}
function asTrim(v, def = "") {
  const s = asStr(v, def);
  return s.trim();
}
function normalizeTipoEgreso(v) {
  const s = asTrim(v).toLowerCase();
  if (["costo", "costos"].includes(s)) return "costo";
  if (["gasto", "gastos"].includes(s)) return "gasto";
  return s;
}
function normalizeTipoPago(v) {
  const s = asTrim(v).toLowerCase();
  if (["contado", "total", "pago_total"].includes(s)) return "contado";
  if (["credito", "crédito"].includes(s)) return "credito";
  if (["parcial", "parciales"].includes(s)) return "parcial";
  return s;
}
function normalizeMetodoPago(v) {
  const s = asTrim(v).toLowerCase();
  // frontend usa: efectivo | tarjeta-transferencia | tarjeta_credito_<id>
  if (!s) return "";
  if (s === "bancos" || s === "transferencia" || s === "tarjeta-transferencia") return "tarjeta-transferencia";
  return s;
}
function toObjectIdOrNull(v) {
  if (v === undefined || v === null) return null;
  if (v instanceof mongoose.Types.ObjectId) return v;
  const s = String(v).trim();
  if (!s) return null;
  return mongoose.Types.ObjectId.isValid(s) ? new mongoose.Types.ObjectId(s) : null;
}
function isoDateOrNull(v) {
  const s = asTrim(v);
  if (!s) return null;
  // soporta YYYY-MM-DD o ISO
  const d = new Date(s);
  // invalid date
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

// ✅ Detecta campo en schema de ExpenseTransaction para ligar el producto (productoId/productId/producto_egreso_id…)
let _txProductField = null;
function getTxProductField() {
  if (_txProductField) return _txProductField;
  const paths = ExpenseTransaction?.schema?.paths || {};
  if (paths.productoId) _txProductField = "productoId";
  else if (paths.productId) _txProductField = "productId";
  else if (paths.producto_egreso_id) _txProductField = "producto_egreso_id";
  else _txProductField = "productoId"; // fallback
  return _txProductField;
}

// ✅ Mapea tx a UI (snake_case + camelCase)
function mapTxForUI(doc) {
  const d = doc?.toObject ? doc.toObject() : doc;

  const item = {
    id: String(d._id),
    _id: d._id,

    tipo_egreso: d.tipoEgreso ?? d.tipo_egreso ?? "",
    subtipo_egreso: d.subtipoEgreso ?? d.subtipo_egreso ?? "",

    descripcion: d.descripcion ?? "",

    cuenta_codigo: d.cuentaCodigo ?? d.cuenta_codigo ?? "",
    subcuenta_id: d.subcuentaId ? String(d.subcuentaId) : (d.subcuenta_id ? String(d.subcuenta_id) : null),

    monto_total: toNum(d.montoTotal ?? d.monto_total, 0),
    cantidad: toNum(d.cantidad, 0),
    precio_unitario: toNum(d.precioUnitario ?? d.precio_unitario, 0),

    tipo_pago: d.tipoPago ?? d.tipo_pago ?? "",
    metodo_pago: d.metodoPago ?? d.metodo_pago ?? "",

    monto_pagado: toNum(d.montoPagado ?? d.monto_pagado, 0),
    monto_pendiente: toNum(d.montoPendiente ?? d.monto_pendiente, 0),

    fecha: d.fecha ? new Date(d.fecha).toISOString() : (d.createdAt ? new Date(d.createdAt).toISOString() : null),
    fecha_vencimiento: d.fechaVencimiento
      ? new Date(d.fechaVencimiento).toISOString()
      : (d.fecha_vencimiento ? new Date(d.fecha_vencimiento).toISOString() : null),

    proveedor_id: d.proveedorId ? String(d.proveedorId) : (d.proveedor_id ? String(d.proveedor_id) : null),
    proveedor_nombre: d.proveedorNombre ?? d.proveedor_nombre ?? null,
    proveedor_telefono: d.proveedorTelefono ?? d.proveedor_telefono ?? null,
    proveedor_email: d.proveedorEmail ?? d.proveedor_email ?? null,
    proveedor_rfc: d.proveedorRfc ?? d.proveedor_rfc ?? null,

    producto_egreso_id: d.productoEgresoId
      ? String(d.productoEgresoId)
      : (d.producto_egreso_id ? String(d.producto_egreso_id) : (d.productoId ? String(d.productoId) : (d.productId ? String(d.productId) : null))),

    comentarios: d.comentarios ?? null,

    numero_asiento: d.numeroAsiento ?? d.numero_asiento ?? null,

    created_at: d.createdAt ?? d.created_at ?? null,
    updated_at: d.updatedAt ?? d.updated_at ?? null,
  };

  // espejo camelCase por compat (si lo necesitas)
  item.tipoEgreso = item.tipo_egreso;
  item.subtipoEgreso = item.subtipo_egreso;
  item.cuentaCodigo = item.cuenta_codigo;
  item.subcuentaId = item.subcuenta_id;
  item.montoTotal = item.monto_total;
  item.precioUnitario = item.precio_unitario;
  item.tipoPago = item.tipo_pago;
  item.metodoPago = item.metodo_pago;
  item.montoPagado = item.monto_pagado;
  item.montoPendiente = item.monto_pendiente;
  item.fechaVencimiento = item.fecha_vencimiento;
  item.proveedorId = item.proveedor_id;
  item.productoId = item.producto_egreso_id;

  return item;
}

/**
 * Genera un número de asiento “humano” sin depender de counters.
 * Si ya tienes un contador real, reemplaza esta función por tu implementación.
 */
function genNumeroAsiento(ownerId) {
  const ymd = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const rand = Math.random().toString(36).slice(2, 7).toUpperCase();
  const tail = String(ownerId).slice(-4).toUpperCase();
  return `EGR-${ymd}-${tail}-${rand}`;
}

/**
 * Resuelve cuenta contra la que acreditas según método de pago.
 * Ajusta estos códigos a tu catálogo contable real si ya lo tienes.
 */
function resolveCreditAccountByMetodoPago(metodoPago) {
  // Defaults (puedes moverlos a ENV):
  const CASH = process.env.CTA_EFECTIVO || "1001";
  const BANK = process.env.CTA_BANCOS || "1002";
  const CXP = process.env.CTA_CXP || "2001"; // Cuentas por pagar / Proveedores

  if (!metodoPago) return { tipo: "unknown", cuentaCodigo: BANK, meta: {} };

  if (metodoPago === "efectivo") return { tipo: "cash", cuentaCodigo: CASH, meta: {} };
  if (metodoPago === "tarjeta-transferencia") return { tipo: "bank", cuentaCodigo: BANK, meta: {} };

  // tarjeta_credito_<id>
  if (metodoPago.startsWith("tarjeta_credito_")) {
    // Puedes mapear a una cuenta puente o “tarjetas por pagar”
    const CC = process.env.CTA_TARJETAS_CREDITO || "2101";
    return { tipo: "credit_card", cuentaCodigo: CC, meta: { tarjetaId: metodoPago.replace("tarjeta_credito_", "") } };
  }

  return { tipo: "other", cuentaCodigo: BANK, meta: {} };
}

/**
 * POST /api/transacciones/egresos
 * Crea la transacción de egreso y (si existe el modelo) su asiento contable.
 *
 * Devuelve:
 * { ok:true, egreso_id, numero_asiento, data:{...} }
 */
router.post("/", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;

    // Acepta snake_case (frontend) y camelCase (por compat)
    const tipoEgreso = normalizeTipoEgreso(req.body?.tipo_egreso ?? req.body?.tipoEgreso);
    const subtipoEgreso = asTrim(req.body?.subtipo_egreso ?? req.body?.subtipoEgreso ?? "precargado");
    const descripcion = asTrim(req.body?.descripcion);

    const cuentaCodigo = asTrim(req.body?.cuenta_codigo ?? req.body?.cuentaCodigo);
    const subcuentaId = toObjectIdOrNull(req.body?.subcuenta_id ?? req.body?.subcuentaId);

    const montoTotal = toNum(req.body?.monto_total ?? req.body?.montoTotal, 0);
    const cantidad = toNum(req.body?.cantidad, 0);
    const precioUnitario = toNum(req.body?.precio_unitario ?? req.body?.precioUnitario, 0);

    const tipoPago = normalizeTipoPago(req.body?.tipo_pago ?? req.body?.tipoPago);
    const metodoPago = normalizeMetodoPago(req.body?.metodo_pago ?? req.body?.metodoPago);

    const montoPagado = toNum(req.body?.monto_pagado ?? req.body?.montoPagado, 0);
    const montoPendiente = toNum(req.body?.monto_pendiente ?? req.body?.montoPendiente, 0);

    const fechaVencimiento = isoDateOrNull(req.body?.fecha_vencimiento ?? req.body?.fechaVencimiento);
    const fecha = isoDateOrNull(req.body?.fecha) || new Date();

    const proveedorId = toObjectIdOrNull(req.body?.proveedor_id ?? req.body?.proveedorId);
    const proveedorNombre = asTrim(req.body?.proveedor_nombre ?? req.body?.proveedorNombre ?? req.body?.proveedor ?? "");
    const proveedorTelefono = asTrim(req.body?.proveedor_telefono ?? req.body?.proveedorTelefono ?? "");
    const proveedorEmail = asTrim(req.body?.proveedor_email ?? req.body?.proveedorEmail ?? "");
    const proveedorRfc = asTrim(req.body?.proveedor_rfc ?? req.body?.proveedorRfc ?? "");

    const productoEgresoIdRaw = req.body?.producto_egreso_id ?? req.body?.productoEgresoId ?? req.body?.productoId ?? req.body?.productId;
    const productoEgresoId = toObjectIdOrNull(productoEgresoIdRaw);

    const comentarios = asTrim(req.body?.comentarios ?? "");

    // ✅ Validaciones “E2E”
    if (!["costo", "gasto"].includes(tipoEgreso)) {
      return res.status(400).json({ ok: false, error: "VALIDATION", message: "tipo_egreso inválido (usa costo|gasto)." });
    }
    if (!descripcion) {
      return res.status(400).json({ ok: false, error: "VALIDATION", message: "descripcion es requerida." });
    }
    if (!cuentaCodigo) {
      return res.status(400).json({ ok: false, error: "VALIDATION", message: "cuenta_codigo es requerida." });
    }
    if (!(montoTotal > 0)) {
      return res.status(400).json({ ok: false, error: "VALIDATION", message: "monto_total debe ser > 0." });
    }
    if (!(cantidad > 0)) {
      return res.status(400).json({ ok: false, error: "VALIDATION", message: "cantidad debe ser > 0." });
    }
    if (!(precioUnitario > 0)) {
      return res.status(400).json({ ok: false, error: "VALIDATION", message: "precio_unitario debe ser > 0." });
    }
    if (!["contado", "credito", "parcial"].includes(tipoPago)) {
      return res.status(400).json({ ok: false, error: "VALIDATION", message: "tipo_pago inválido (contado|credito|parcial)." });
    }

    if (tipoPago === "contado") {
      if (!metodoPago) {
        return res.status(400).json({ ok: false, error: "VALIDATION", message: "metodo_pago es requerido para contado." });
      }
      // En contado pagas todo
      if (Math.abs(montoPagado - montoTotal) > 0.01 && montoPagado !== 0) {
        // Permitimos que venga 0 y lo corregimos; si viene distinto, lo normalizamos
      }
    }

    if (tipoPago === "parcial") {
      if (!metodoPago) {
        return res.status(400).json({ ok: false, error: "VALIDATION", message: "metodo_pago es requerido para pago parcial." });
      }
      if (!(montoPagado > 0) || !(montoPagado < montoTotal)) {
        return res.status(400).json({
          ok: false,
          error: "VALIDATION",
          message: "En parcial, monto_pagado debe ser > 0 y < monto_total.",
        });
      }
    }

    if (tipoPago === "credito") {
      // crédito: normalmente no hay pago inicial
      // due date recomendado pero no obligatorio
    }

    // ✅ Validar que el producto exista y pertenezca al owner (si viene)
    let productDoc = null;
    if (productoEgresoId) {
      productDoc = await ExpenseProduct.findOne({ _id: productoEgresoId, owner }).lean();
      if (!productDoc) {
        return res.status(404).json({
          ok: false,
          error: "NOT_FOUND",
          message: "producto_egreso_id no existe o no pertenece al usuario.",
        });
      }
    }

    // ✅ Normalizaciones finales
    const fixedMontoPagado =
      tipoPago === "contado" ? montoTotal : tipoPago === "parcial" ? montoPagado : 0;

    const fixedMontoPendiente =
      tipoPago === "contado" ? 0 : tipoPago === "parcial" ? Math.max(0, montoTotal - fixedMontoPagado) : montoTotal;

    const numeroAsiento = genNumeroAsiento(owner);

    // ✅ Construcción del documento según tu schema real (camelCase como canonical)
    const txPayload = {
      owner,

      tipoEgreso,
      subtipoEgreso,
      descripcion,

      cuentaCodigo,
      subcuentaId,

      montoTotal,
      cantidad,
      precioUnitario,

      tipoPago,
      metodoPago: metodoPago || null,

      montoPagado: fixedMontoPagado,
      montoPendiente: fixedMontoPendiente,

      fecha,
      fechaVencimiento: (tipoPago === "credito" || tipoPago === "parcial") ? (fechaVencimiento || null) : null,

      proveedorId,
      proveedorNombre: proveedorNombre || null,
      proveedorTelefono: proveedorTelefono || null,
      proveedorEmail: proveedorEmail || null,
      proveedorRfc: proveedorRfc || null,

      comentarios: comentarios || null,

      numeroAsiento,
    };

    // ✅ Ligar producto en el campo correcto del schema
    const txProductField = getTxProductField();
    if (productoEgresoId) {
      txPayload[txProductField] = productoEgresoId;
    }

    const created = await ExpenseTransaction.create(txPayload);

    // ✅ Crear asiento contable (si existe modelo)
    // Reglas:
    // - Debe (debit): cuenta del gasto/costo por montoTotal
    // - Haber (credit):
    //   - contado: caja/banco/tarjeta por montoTotal
    //   - crédito: CXP por montoTotal
    //   - parcial: caja/banco/tarjeta por montoPagado + CXP por montoPendiente
    let asiento = null;
    if (JournalEntry) {
      const CXP = process.env.CTA_CXP || "2001";
      const creditInfo = resolveCreditAccountByMetodoPago(metodoPago);

      const lines = [];

      // DEBE: gasto/costo
      lines.push({
        side: "debit",
        cuentaCodigo,
        subcuentaId: subcuentaId || null,
        monto: montoTotal,
        descripcion: `Egreso (${tipoEgreso}) - ${descripcion}`,
      });

      // HABER: según tipo de pago
      if (tipoPago === "contado") {
        lines.push({
          side: "credit",
          cuentaCodigo: creditInfo.cuentaCodigo,
          subcuentaId: null,
          monto: montoTotal,
          descripcion: `Pago contado (${creditInfo.tipo})`,
          meta: creditInfo.meta || {},
        });
      } else if (tipoPago === "credito") {
        lines.push({
          side: "credit",
          cuentaCodigo: CXP,
          subcuentaId: null,
          monto: montoTotal,
          descripcion: `Egreso a crédito (CXP)`,
        });
      } else if (tipoPago === "parcial") {
        if (fixedMontoPagado > 0) {
          lines.push({
            side: "credit",
            cuentaCodigo: creditInfo.cuentaCodigo,
            subcuentaId: null,
            monto: fixedMontoPagado,
            descripcion: `Pago parcial (${creditInfo.tipo})`,
            meta: creditInfo.meta || {},
          });
        }
        if (fixedMontoPendiente > 0) {
          lines.push({
            side: "credit",
            cuentaCodigo: CXP,
            subcuentaId: null,
            monto: fixedMontoPendiente,
            descripcion: `Saldo pendiente (CXP)`,
          });
        }
      }

      // Guardar asiento (adaptable)
      // Nota: si tu schema de JournalEntry es diferente, ajusta keys aquí.
      asiento = await JournalEntry.create({
        owner,
        fuente: "egreso",
        source: "egreso",
        transaccionId: created._id,
        source_id: created._id,
        numero: numeroAsiento,
        numeroAsiento,
        fecha,
        descripcion: `Egreso: ${descripcion}`,
        proveedorId: proveedorId || null,
        proveedorNombre: proveedorNombre || null,
        lines,
        totalDebe: montoTotal,
        totalHaber: montoTotal,
        meta: {
          tipoEgreso,
          subtipoEgreso,
          tipoPago,
          metodoPago: metodoPago || null,
          productoEgresoId: productoEgresoId ? String(productoEgresoId) : null,
        },
      });
    }

    const item = mapTxForUI(created);

    return res.status(201).json({
      ok: true,
      egreso_id: String(created._id),
      numero_asiento: numeroAsiento,
      asiento_id: asiento ? String(asiento._id) : null,
      data: item,
      item,
      ...item, // root (por compat con tu frontend que a veces lee root)
    });
  } catch (err) {
    console.error("POST /api/transacciones/egresos error:", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

/**
 * GET /api/transacciones/egresos?start=YYYY-MM-DD&end=YYYY-MM-DD&tipo=costo|gasto
 * Devuelve lista (array) por defecto; wrap=1 => {ok,data}
 */
router.get("/", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;
    const wrap = String(req.query.wrap || "").trim() === "1";

    const start = isoDateOrNull(req.query.start);
    const end = isoDateOrNull(req.query.end);
    const tipo = normalizeTipoEgreso(req.query.tipo);

    const filter = { owner };
    if (start || end) {
      filter.fecha = {};
      if (start) filter.fecha.$gte = start;
      if (end) {
        // end inclusivo si viene YYYY-MM-DD
        const e = new Date(end);
        e.setHours(23, 59, 59, 999);
        filter.fecha.$lte = e;
      }
    }
    if (tipo && ["costo", "gasto"].includes(tipo)) filter.tipoEgreso = tipo;

    const docs = await ExpenseTransaction.find(filter).sort({ fecha: -1, createdAt: -1 }).lean();
    const items = docs.map(mapTxForUI);

    if (!wrap) return res.json(items);
    return res.json({ ok: true, data: items, items });
  } catch (err) {
    console.error("GET /api/transacciones/egresos error:", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

/**
 * GET /api/transacciones/egresos/:id
 */
router.get("/:id", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;
    const id = String(req.params.id || "").trim();

    const doc = await ExpenseTransaction.findOne({ _id: id, owner }).lean();
    if (!doc) return res.status(404).json({ ok: false, error: "NOT_FOUND" });

    const item = mapTxForUI(doc);
    return res.json({ ok: true, data: item, item, ...item });
  } catch (err) {
    console.error("GET /api/transacciones/egresos/:id error:", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

module.exports = router;
