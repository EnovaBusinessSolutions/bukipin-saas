// backend/routes/inversiones.js
const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const ensureAuth = require("../middleware/ensureAuth");

// ✅ Intentar cargar un modelo de CAPEX si existe (best-effort)
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
  if (["contado", "total", "pago_total"].includes(s)) return "contado";
  if (["credito", "crédito"].includes(s)) return "credito";
  if (["parcial", "parciales"].includes(s)) return "parcial";
  return s;
}

function normalizeMetodoPago(v) {
  const s = asTrim(v).toLowerCase();
  if (!s) return null;
  if (s === "transferencia" || s === "bancos" || s === "tarjeta-transferencia") return "bancos";
  if (s === "efectivo") return "efectivo";
  return s;
}

function normalizeEstado(v) {
  const s = asTrim(v).toLowerCase();
  if (!s) return "activo";
  if (["activo", "activa", "active"].includes(s)) return "activo";
  if (["cancelado", "cancelada", "canceled"].includes(s)) return "cancelado";
  return s;
}

function pickFechaVencimiento(d) {
  const v =
    d?.fecha_vencimiento ??
    d?.fechaVencimiento ??
    d?.fechaLimite ??
    d?.fecha_limite ??
    d?.dueDate ??
    null;
  if (!v) return null;
  const dt = new Date(v);
  return Number.isNaN(dt.getTime()) ? null : dt.toISOString();
}

function pickCreatedAt(d) {
  const v = d?.created_at ?? d?.createdAt ?? d?.fecha ?? d?.date ?? null;
  if (!v) return new Date().toISOString();
  const dt = new Date(v);
  return Number.isNaN(dt.getTime()) ? new Date().toISOString() : dt.toISOString();
}

function pickId(d) {
  return String(d?.id ?? d?._id ?? "");
}

function mapCapexForUI(doc) {
  const d = doc?.toObject ? doc.toObject() : doc;

  const montoTotal = toNum(d?.valor_total ?? d?.monto_total ?? d?.montoTotal ?? d?.total ?? 0, 0);
  const montoPagado = toNum(d?.monto_pagado ?? d?.montoPagado ?? 0, 0);
  const montoPendiente = toNum(d?.monto_pendiente ?? d?.montoPendiente ?? (montoTotal - montoPagado) ?? 0, 0);

  const item = {
    id: pickId(d),
    descripcion: d?.descripcion ?? d?.producto_nombre ?? d?.nombre ?? "CAPEX",
    valor_total: montoTotal, // compat
    monto_total: montoTotal,
    monto_pagado: montoPagado,
    monto_pendiente: montoPendiente,
    fecha_vencimiento: pickFechaVencimiento(d),
    created_at: pickCreatedAt(d),
    tipo_pago: normalizeTipoPago(d?.tipo_pago ?? d?.tipoPago ?? ""),
    metodo_pago: normalizeMetodoPago(d?.metodo_pago ?? d?.metodoPago ?? d?.metodo ?? null),
    estado: normalizeEstado(d?.estado ?? d?.status ?? "activo"),

    proveedor_nombre: d?.proveedor_nombre ?? d?.proveedorNombre ?? d?.proveedor ?? null,
    proveedor_email: d?.proveedor_email ?? d?.proveedorEmail ?? null,
    proveedor_telefono: d?.proveedor_telefono ?? d?.proveedorTelefono ?? null,
    proveedor_rfc: d?.proveedor_rfc ?? d?.proveedorRfc ?? null,
  };

  return item;
}

/**
 * GET /api/inversiones/capex?pendiente_gt=0&estado=activo&start=YYYY-MM-DD&end=YYYY-MM-DD&limit=500
 * ✅ Devuelve CAPEX (si existe modelo), si no existe -> [] (sin 404)
 */
router.get("/capex", ensureAuth, async (req, res) => {
  try {
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

    // Si no hay implementación, devolvemos vacío (pero OK)
    if (!CapexModel) {
      return res.json({ ok: true, data: [], items: [], meta: { pendiente_gt: pendienteGt, hasModel: false } });
    }

    // Filtro best-effort (owner/userId/createdBy)
    const filter = {
      $or: [{ owner }, { user: owner }, { userId: owner }, { createdBy: owner }],
    };

    // estado (best-effort)
    if (estado === "activo") filter.estado = { $ne: "cancelado" };
    if (estado === "cancelado") filter.estado = "cancelado";

    // fechas (best-effort)
    if (start || end) {
      const dateFilter = {};
      if (start) dateFilter.$gte = start;
      if (end) dateFilter.$lte = endOfDay(end);

      filter.$and = [
        ...(filter.$and || []),
        {
          $or: [{ fecha: dateFilter }, { date: dateFilter }, { createdAt: dateFilter }, { created_at: dateFilter }],
        },
      ];
    }

    // pendiente_gt (best-effort sobre montoPendiente/monto_pendiente)
    if (pendienteGt !== null) {
      filter.$and = [
        ...(filter.$and || []),
        {
          $or: [{ montoPendiente: { $gt: pendienteGt } }, { monto_pendiente: { $gt: pendienteGt } }],
        },
      ];
    }

    const docs = await CapexModel.find(filter).sort({ createdAt: -1, created_at: -1, _id: -1 }).limit(limit).lean();

    const items = (docs || [])
      .map(mapCapexForUI)
      // si el modelo no tiene monto_pendiente en BD, igual filtramos a nivel JS
      .filter((x) => (pendienteGt === null ? true : toNum(x.monto_pendiente, 0) > pendienteGt));

    return res.json({ ok: true, data: items, items, meta: { pendiente_gt: pendienteGt, hasModel: true, limit } });
  } catch (err) {
    console.error("GET /api/inversiones/capex error:", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR", message: err?.message || "SERVER_ERROR" });
  }
});

module.exports = router;