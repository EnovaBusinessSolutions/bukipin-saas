// backend/routes/cxp.js
const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const ensureAuth = require("../middleware/ensureAuth");

const ExpenseTransaction = require("../models/ExpenseTransaction");

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

function normalizeTipoPago(v) {
  const s = asTrim(v).toLowerCase();
  if (["credito", "crédito"].includes(s)) return "credito";
  if (["parcial", "parciales"].includes(s)) return "parcial";
  if (["contado", "total", "pago_total"].includes(s)) return "contado";
  return s;
}

function normalizeEstado(v) {
  const s = asTrim(v).toLowerCase();
  if (!s) return "";
  if (["activo", "activa", "active"].includes(s)) return "activo";
  if (["cancelado", "cancelada", "canceled"].includes(s)) return "cancelado";
  return s;
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

  // rango por fecha del egreso
  if (start || end) {
    filter.fecha = {};
    if (start) filter.fecha.$gte = start;
    if (end) filter.fecha.$lte = endOfDay(end);
  }

  // estado
  filter.estado = { $ne: "cancelado" };

  if (pendientesOnly) {
    // tipoPago credito/parcial (soporta esquema camelCase y algún legacy)
    filter.$and = [
      {
        $or: [
          { tipoPago: { $in: ["credito", "parcial"] } },
          { tipo_pago: { $in: ["credito", "parcial"] } },
        ],
      },
      {
        $or: [
          { montoPendiente: { $gt: 0 } },
          { monto_pendiente: { $gt: 0 } },
        ],
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

  // comparar solo por día
  const a = new Date(now); a.setHours(0,0,0,0);
  const b = new Date(fv);  b.setHours(0,0,0,0);

  const diffDays = Math.round((a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24)); // >0 = vencida

  if (diffDays > 0) return { status: "vencida", dias: diffDays };
  if (diffDays === 0) return { status: "vence_hoy", dias: 0 };
  return { status: "por_vencer", dias: Math.abs(diffDays) };
}

/**
 * GET /api/cxp/egresos?pendientes=1&start&end&limit=200
 * Lista de egresos, filtrable a pendientes.
 */
router.get("/egresos", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;

    const pendientesOnly = String(req.query.pendientes ?? "0").trim() === "1";
    const start = isoDateOrNull(req.query.start);
    const end = isoDateOrNull(req.query.end);

    const limitRaw = Number(req.query.limit ?? 300);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 1000) : 300;

    const filter = buildPendientesFilter({ owner, start, end, pendientesOnly });

    const docs = await ExpenseTransaction.find(filter)
      .sort({ fecha: -1, createdAt: -1 })
      .limit(limit)
      .lean();

    const items = docs.map(mapTxForCxP);

    return res.json({ ok: true, data: items, items, meta: { pendientesOnly, limit } });
  } catch (err) {
    console.error("GET /api/cxp/egresos error:", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR", message: err?.message || "SERVER_ERROR" });
  }
});

/**
 * GET /api/cxp/transacciones
 * Alias compatible (tu FE está llamando esto).
 * Por defecto devuelve pendientes=1 si no se especifica.
 */
router.get("/transacciones", ensureAuth, async (req, res) => {
  // compat: si FE no manda pendientes, asumimos 1 porque CxP típicamente muestra pendientes
  const pendientes = req.query.pendientes ?? "1";
  req.query.pendientes = pendientes;
  return router.handle(req, res, () => {});
}, (req, res) => res.status(500).json({ ok:false, error:"SERVER_ERROR" }));

/**
 * GET /api/cxp/detalle?pendientes=1&start&end
 * Regresa “cuentas” listas para la UI (con status vencida/por_vencer/etc.)
 * Aquí puedes sumar KPIs/analytics del panel si quieres.
 */
router.get("/detalle", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;

    const pendientesOnly = String(req.query.pendientes ?? "0").trim() === "1";
    const start = isoDateOrNull(req.query.start);
    const end = isoDateOrNull(req.query.end);

    const limitRaw = Number(req.query.limit ?? 2000);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 5000) : 2000;

    const filter = buildPendientesFilter({ owner, start, end, pendientesOnly });

    const docs = await ExpenseTransaction.find(filter)
      .sort({ fecha: -1, createdAt: -1 })
      .limit(limit)
      .lean();

    const now = new Date();

    const cuentas = docs.map((d) => {
      const tx = mapTxForCxP(d);
      const due = computeDueMeta(tx, now);

      return {
        // shape “cuenta” (mantenlo simple para FE)
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

    // KPIs rápidos (útiles para cards)
    const totalPorPagar = cuentas.reduce((acc, c) => acc + toNum(c.saldo_pendiente, 0), 0);
    const vencidas = cuentas.filter((c) => c.vencimiento_status === "vencida");
    const porVencer = cuentas.filter((c) => c.vencimiento_status === "por_vencer" || c.vencimiento_status === "vence_hoy");

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