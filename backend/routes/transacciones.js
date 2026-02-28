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
  if (v === null || typeof v === "undefined") return def;
  if (typeof v === "number") return Number.isFinite(v) ? v : def;
  const s = String(v).trim();
  if (!s) return def;
  const cleaned = s.replace(/[$,\s]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : def;
}

function asValidDate(v) {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toYMDLocal(d) {
  const dt = asValidDate(d);
  if (!dt) return null;
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
  const f = asValidDate(tx?.fecha);
  const c = asValidDate(tx?.createdAt);

  if (!f && c) return c;
  if (!f) return null;

  const isMidnightUTC =
    f.getUTCHours() === 0 &&
    f.getUTCMinutes() === 0 &&
    f.getUTCSeconds() === 0 &&
    f.getUTCMilliseconds() === 0;

  if (!isMidnightUTC) return f;
  if (!c) return f;

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
  const unique = Array.from(new Set((codes || []).filter(Boolean).map((c) => String(c).trim())));
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

    const nombre = nameMap[code] || it.cuenta_nombre || it.cuenta_principal_nombre || null;
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
    : Math.max(0, Number((montoNeto - montoPagado).toFixed(2)));

  const cuentaCodigo =
    tx.cuentaCodigo ??
    tx.cuenta_codigo ??
    tx.cuentaPrincipalCodigo ??
    tx.cuenta_principal_codigo ??
    null;

  // ✅ normaliza fecha FINAL para evitar strings raras / Invalid Date
  const fechaFinal =
    asValidDate(fechaFixed) || asValidDate(tx.fecha) || asValidDate(tx.createdAt) || null;

  // ✅ Fecha límite / vencimiento (CxC)
  const fechaLimiteFinal =
    asValidDate(tx.fechaLimite) ||
    asValidDate(tx.fecha_limite) ||
    asValidDate(tx.fecha_vencimiento) ||
    asValidDate(tx.fechaVencimiento) ||
    null;

  const fechaLimiteISO = fechaLimiteFinal ? fechaLimiteFinal.toISOString() : null;
  const fechaLimiteYMD = fechaLimiteFinal ? toYMDLocal(fechaLimiteFinal) : null;

  // ✅ Subcuenta (E2E)
  const subcuentaIdAny =
    tx.subcuentaId ??
    tx.subcuenta_id ??
    tx.subCuentaId ??
    tx.sub_cuenta_id ??
    null;

  const subcuentaCodigoAny =
    tx.subcuentaCodigo ??
    tx.subcuenta_codigo ??
    tx.subCuentaCodigo ??
    tx.sub_cuenta_codigo ??
    null;

  const subcuentaNombreAny =
    tx.subcuentaNombre ??
    tx.subcuenta_nombre ??
    tx.subCuentaNombre ??
    tx.sub_cuenta_nombre ??
    null;

  // ✅ Tipo de ingreso (E2E)
  const tipoIngresoAny =
    tx.tipoIngreso ??
    tx.tipo_ingreso ??
    tx.incomeType ??
    tx.income_type ??
    "";

  const metodoPago = tx.metodoPago ?? tx.metodo_pago ?? null;
  const tipoPago = tx.tipoPago ?? tx.tipo_pago ?? null;

  return {
    ...tx,
    id: String(tx._id ?? tx.id),

    fecha: fechaFinal,
    fecha_fixed: fechaFixed ? fechaFixed.toISOString() : null,
    fecha_ymd: fechaFinal ? toYMDLocal(fechaFinal) : null,

    // ✅ E2E: fecha límite/vencimiento
    fechaLimite: fechaLimiteISO,
    fecha_limite: fechaLimiteISO,
    fecha_vencimiento: fechaLimiteYMD,
    fechaVencimiento: fechaLimiteYMD,

    // ✅ E2E: subcuenta
    subcuentaId: subcuentaIdAny ? String(subcuentaIdAny) : null,
    subcuenta_id: subcuentaIdAny ? String(subcuentaIdAny) : null,
    subcuentaCodigo: subcuentaCodigoAny ? String(subcuentaCodigoAny) : null,
    subcuenta_codigo: subcuentaCodigoAny ? String(subcuentaCodigoAny) : null,
    subcuentaNombre: subcuentaNombreAny ? String(subcuentaNombreAny) : null,
    subcuenta_nombre: subcuentaNombreAny ? String(subcuentaNombreAny) : null,

    // ✅ E2E: tipo (para que el modal no quede vacío)
    tipoIngreso: tipoIngresoAny || null,
    tipo_ingreso: tipoIngresoAny || null,

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

    metodoPago,
    tipoPago,
    metodo_pago: metodoPago,
    tipo_pago: tipoPago,

    cuentaCodigo: cuentaCodigo ?? tx.cuentaCodigo ?? null,
    cuenta_codigo: cuentaCodigo ?? tx.cuenta_codigo ?? null,
    cuenta_principal_codigo: cuentaCodigo ?? tx.cuenta_principal_codigo ?? null,

    clienteId: tx.clienteId ?? tx.clientId ?? tx.cliente_id ?? tx.client_id ?? tx.clienteID ?? null,
  };
}

function parseOrder(order) {
  const o = String(order || "").trim().toLowerCase();

  // defaults pensados para CxC: último creado primero
  if (!o) return { createdAt: -1 };

  if (o === "created_at_desc") return { createdAt: -1 };
  if (o === "created_at_asc") return { createdAt: 1 };

  // fecha + fallback createdAt
  if (o === "fecha_desc") return { fecha: -1, createdAt: -1 };
  if (o === "fecha_asc") return { fecha: 1, createdAt: 1 };

  // compat por si llega algo raro
  return { createdAt: -1 };
}

// ✅ projection ligera (evita regresar payload enorme)
// 👇 IMPORTANTE: incluir fechaLimite + subcuenta* + tipoIngreso para que se devuelva en /recientes y /ingresos
const TX_SELECT =
  "fecha fechaLimite createdAt updatedAt descripcion concept concepto " +
  "tipoIngreso tipo_ingreso " +
  "montoTotal monto_total montoDescuento monto_descuento montoNeto monto_neto " +
  "montoPagado monto_pagado saldoPendiente saldo_pendiente monto_pendiente " +
  "cuentaCodigo cuenta_codigo cuentaPrincipalCodigo cuenta_principal_codigo " +
  "subcuentaId subcuenta_id subcuentaCodigo subcuenta_codigo subcuentaNombre subcuenta_nombre " +
  "clienteId clientId cliente_id client_id clienteID " +
  "metodoPago metodo_pago tipoPago tipo_pago";

/**
 * GET /api/transacciones/ingresos?include_all=true&order=created_at_desc&limit=2000&pendientes=1
 */
router.get("/ingresos", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;

    const limit = Math.min(5000, Number(req.query.limit || 2000));
    const order = parseOrder(req.query.order);

    const includeAll =
      String(req.query.include_all ?? "").toLowerCase() === "true" ||
      String(req.query.includeAll ?? "").toLowerCase() === "true";

    const pendientesFlag =
      String(req.query.pendientes ?? "").toLowerCase() === "1" ||
      String(req.query.pendientes ?? "").toLowerCase() === "true";

    const query = { owner };

    // ✅ lógica clara:
    // - si pendientes=1 => filtra pendientes
    // - si NO pendientes=1 => solo filtra pendientes cuando include_all NO es true
    if (pendientesFlag || !includeAll) {
      query.$or = [
        { saldoPendiente: { $gt: 0 } },
        { saldo_pendiente: { $gt: 0 } },
        { monto_pendiente: { $gt: 0 } },
      ];
    }

    const rows = await IncomeTransaction.find(query)
      .select(TX_SELECT)
      .sort(order)
      .limit(limit)
      .lean();

    let items = rows.map(mapTxCompat);
    items = await attachAccountInfo(owner, items);
    items = await attachClientInfo(owner, items);

    return res.json({ ok: true, data: items, items });
  } catch (err) {
    console.error("GET /api/transacciones/ingresos error:", err);
    return res.status(500).json({ ok: false, message: "Error cargando transacciones de ingresos" });
  }
});

/**
 * ✅ IMPORTANTE: esta ruta DEBE ir ANTES de /ingresos/:id
 * porque si no, "/ingresos/recientes" se interpreta como id="recientes".
 *
 * GET /api/transacciones/ingresos/recientes?limit=1000
 */
router.get("/ingresos/recientes", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;
    const limit = Math.min(2000, Number(req.query.limit || 1000));

    const rows = await IncomeTransaction.find({ owner })
      .select(TX_SELECT)
      .sort({ fecha: -1, createdAt: -1 })
      .limit(limit)
      .lean();

    let items = rows.map(mapTxCompat);
    items = await attachAccountInfo(owner, items);
    items = await attachClientInfo(owner, items);

    return res.json({ ok: true, data: items, items });
  } catch (err) {
    console.error("GET /api/transacciones/ingresos/recientes error:", err);
    return res.status(500).json({ ok: false, message: "Error cargando transacciones recientes" });
  }
});

/**
 * GET /api/transacciones/ingresos/:id
 */
router.get("/ingresos/:id", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ ok: false, message: "ID inválido" });
    }

    const row = await IncomeTransaction.findOne({
      owner,
      _id: new mongoose.Types.ObjectId(id),
    })
      .select(TX_SELECT)
      .lean();

    if (!row) {
      return res.status(404).json({ ok: false, message: "Transacción no encontrada" });
    }

    let item = mapTxCompat(row);
    item = (await attachAccountInfo(owner, [item]))[0];
    item = (await attachClientInfo(owner, [item]))[0];

    return res.json({ ok: true, data: item, item });
  } catch (err) {
    console.error("GET /api/transacciones/ingresos/:id error:", err);
    return res.status(500).json({ ok: false, message: "Error cargando el detalle de la transacción" });
  }
});

module.exports = router;