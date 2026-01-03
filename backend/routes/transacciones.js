// backend/routes/transacciones.js
const express = require("express");
const router = express.Router();

const mongoose = require("mongoose");
const ensureAuth = require("../middleware/ensureAuth");
const IncomeTransaction = require("../models/IncomeTransaction");
const Account = require("../models/Account");

// Opcional: Client (si existe en tu proyecto)
let Client = null;
try {
  Client = require("../models/Client");
} catch (_) {}

const TZ_OFFSET_MINUTES = Number(process.env.APP_TZ_OFFSET_MINUTES ?? -360);

function num(v, def = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function toYMDLocal(d) {
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return null;
  const local = new Date(dt.getTime() + TZ_OFFSET_MINUTES * 60 * 1000);
  const y = local.getUTCFullYear();
  const m = String(local.getUTCMonth() + 1).padStart(2, "0");
  const day = String(local.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * ✅ FIX FECHA/HORA (TZ issue)
 * Si `fecha` viene guardada como 00:00:00.000Z, el navegador (-06)
 * la mueve a 18:00 del día anterior.
 *
 * Solución: mantener el día de `fecha` pero tomar la hora real desde `createdAt`.
 */
function fixFechaWithCreatedAt(tx) {
  const f = tx?.fecha ? new Date(tx.fecha) : null;
  const c = tx?.createdAt ? new Date(tx.createdAt) : null;

  if (!f && c) return c;
  if (!f) return null;

  const isMidnightUTC =
    f.getUTCHours() === 0 &&
    f.getUTCMinutes() === 0 &&
    f.getUTCSeconds() === 0 &&
    f.getUTCMilliseconds() === 0;

  if (!isMidnightUTC) return f;
  if (!c || Number.isNaN(c.getTime())) return f;

  return new Date(
    Date.UTC(
      f.getUTCFullYear(),
      f.getUTCMonth(),
      f.getUTCDate(),
      c.getUTCHours(),
      c.getUTCMinutes(),
      c.getUTCSeconds(),
      c.getUTCMilliseconds()
    )
  );
}

async function getAccountNameMap(owner, codes) {
  const unique = Array.from(
    new Set((codes || []).filter(Boolean).map((c) => String(c).trim()))
  );
  if (!unique.length) return {};

  const rows = await Account.find({
    owner,
    $or: [{ code: { $in: unique } }, { codigo: { $in: unique } }],
  })
    .select("code codigo name nombre")
    .lean();

  const map = {};
  for (const r of rows) {
    const code = String(r.code ?? r.codigo ?? "").trim();
    if (!code) continue;
    map[code] = r.name ?? r.nombre ?? "";
  }
  return map;
}

async function attachAccountInfo(owner, items) {
  if (!items?.length) return items;

  const codes = items
    .map(
      (it) =>
        it.cuentaCodigo ??
        it.cuenta_codigo ??
        it.cuentaPrincipalCodigo ??
        it.cuenta_principal_codigo ??
        null
    )
    .filter(Boolean)
    .map(String);

  const nameMap = await getAccountNameMap(owner, codes);

  return items.map((it) => {
    const code = String(
      it.cuentaCodigo ??
        it.cuenta_codigo ??
        it.cuentaPrincipalCodigo ??
        it.cuenta_principal_codigo ??
        ""
    ).trim();

    if (!code) return it;

    const nombre =
      nameMap[code] ||
      it.cuenta_nombre ||
      it.cuenta_principal_nombre ||
      null;

    const display = nombre ? `${code} - ${nombre}` : code;

    return {
      ...it,
      cuentaCodigo: it.cuentaCodigo ?? code,
      cuenta_codigo: it.cuenta_codigo ?? code,
      cuenta_nombre: it.cuenta_nombre ?? nombre,
      cuenta_principal_codigo: it.cuenta_principal_codigo ?? code,
      cuenta_principal_nombre: it.cuenta_principal_nombre ?? nombre,
      cuenta_principal: it.cuenta_principal ?? display,
      cuentaPrincipal: it.cuentaPrincipal ?? display,
    };
  });
}

async function attachClientInfo(owner, items) {
  if (!Client || !items?.length) return items;

  const ids = Array.from(
    new Set(
      items
        .map(
          (it) =>
            it.clienteId ??
            it.clientId ??
            it.cliente_id ??
            it.client_id ??
            it.clienteID ??
            null
        )
        .filter(Boolean)
        .map((v) => String(v))
        .filter((v) => mongoose.Types.ObjectId.isValid(v))
    )
  );

  if (!ids.length) return items;

  const clients = await Client.find({
    owner,
    _id: { $in: ids.map((id) => new mongoose.Types.ObjectId(id)) },
  })
    .select("nombre name email telefono phone rfc")
    .lean();

  const map = new Map(
    clients.map((c) => [
      String(c._id),
      {
        nombre: c.nombre ?? c.name ?? "",
        email: c.email ?? "",
        telefono: c.telefono ?? c.phone ?? "",
        rfc: c.rfc ?? "",
      },
    ])
  );

  return items.map((it) => {
    const cid = String(
      it.clienteId ?? it.clientId ?? it.cliente_id ?? it.client_id ?? it.clienteID ?? ""
    );
    const c = cid ? map.get(cid) : null;
    if (!c) return it;

    return {
      ...it,
      cliente_nombre: it.cliente_nombre ?? c.nombre,
      cliente_email: it.cliente_email ?? c.email,
      cliente_telefono: it.cliente_telefono ?? c.telefono,
      cliente_rfc: it.cliente_rfc ?? c.rfc,
    };
  });
}

function mapTxCompat(tx) {
  const fechaFixed = fixFechaWithCreatedAt(tx);

  const montoTotal = num(tx.montoTotal ?? tx.monto_total ?? 0);
  const montoDescuento = num(tx.montoDescuento ?? tx.monto_descuento ?? 0);

  const montoNeto = num(
    tx.montoNeto ?? tx.monto_neto ?? Math.max(0, montoTotal - Math.max(0, montoDescuento)),
    0
  );

  const montoPagado = num(tx.montoPagado ?? tx.monto_pagado ?? 0);

  const saldoPendienteSaved = num(
    tx.saldoPendiente ?? tx.saldo_pendiente ?? tx.monto_pendiente,
    NaN
  );

  const saldoPendiente = Number.isFinite(saldoPendienteSaved)
    ? saldoPendienteSaved
    : Math.max(0, montoNeto - montoPagado);

  const cuentaCodigo =
    tx.cuentaCodigo ??
    tx.cuenta_codigo ??
    tx.cuentaPrincipalCodigo ??
    tx.cuenta_principal_codigo ??
    null;

  const fechaFinal = fechaFixed || tx.fecha || null;

  return {
    ...tx,
    id: String(tx._id ?? tx.id),

    fecha: fechaFinal,
    fecha_fixed: fechaFixed ? fechaFixed.toISOString() : null,
    fecha_ymd: fechaFinal ? toYMDLocal(fechaFinal) : null,

    montoTotal,
    montoDescuento,
    montoNeto,
    montoPagado,
    saldoPendiente,

    monto_total: montoTotal,
    monto_descuento: montoDescuento,
    monto_neto: montoNeto,
    monto_pagado: montoPagado,

    monto_pendiente: saldoPendiente,
    saldo_pendiente: saldoPendiente,
    pendiente: saldoPendiente,

    metodo_pago: tx.metodoPago ?? tx.metodo_pago ?? null,
    tipo_pago: tx.tipoPago ?? tx.tipo_pago ?? null,

    cuentaCodigo: cuentaCodigo ?? tx.cuentaCodigo ?? null,
    cuenta_codigo: cuentaCodigo ?? tx.cuenta_codigo ?? null,
    cuenta_principal_codigo: cuentaCodigo ?? tx.cuenta_principal_codigo ?? null,

    clienteId: tx.clienteId ?? tx.clientId ?? tx.cliente_id ?? tx.client_id ?? tx.clienteID ?? null,
  };
}

/**
 * GET /api/transacciones/ingresos/recientes?limit=1000
 */
router.get("/ingresos/recientes", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;
    const limit = Math.min(2000, Number(req.query.limit || 1000));

    const rows = await IncomeTransaction.find({ owner })
      .sort({ fecha: -1, createdAt: -1 })
      .limit(limit)
      .lean();

    let items = rows.map(mapTxCompat);
    items = await attachAccountInfo(owner, items);
    items = await attachClientInfo(owner, items);

    return res.json({ ok: true, data: items, items });
  } catch (err) {
    console.error("GET /api/transacciones/ingresos/recientes error:", err);
    return res.status(500).json({
      ok: false,
      message: "Error cargando transacciones recientes",
    });
  }
});

module.exports = router;
