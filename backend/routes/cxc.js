// backend/routes/cxc.js
const express = require("express");
const router = express.Router();

const mongoose = require("mongoose");
const ensureAuth = require("../middleware/ensureAuth");

const IncomeTransaction = require("../models/IncomeTransaction");
const JournalEntry = require("../models/JournalEntry");
const Account = require("../models/Account");
const Counter = require("../models/Counter");

// =========================
// Helpers
// =========================
const TZ_OFFSET_MINUTES = Number(process.env.APP_TZ_OFFSET_MINUTES ?? -360); // CDMX -06

function num(v, def = 0) {
  if (v === null || typeof v === "undefined") return def;
  if (typeof v === "number") return Number.isFinite(v) ? v : def;
  const s = String(v).trim();
  if (!s) return def;
  const cleaned = s.replace(/[$,\s]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : def;
}

function lower(v) {
  return String(v ?? "").trim().toLowerCase();
}

function isObjectId(v) {
  return !!v && mongoose.Types.ObjectId.isValid(String(v));
}

function isDateOnly(str) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(str || "").trim());
}

function dateOnlyToUtc(str, hh = 0, mm = 0, ss = 0, ms = 0) {
  const s = String(str || "").trim();
  if (!isDateOnly(s)) return null;
  const [y, m, d] = s.split("-").map((x) => Number(x));
  if (!y || !m || !d) return null;
  const utcMillis = Date.UTC(y, m - 1, d, hh, mm, ss, ms);
  return new Date(utcMillis - TZ_OFFSET_MINUTES * 60 * 1000);
}

function parseTxDateSmart(raw, now = new Date()) {
  if (!raw) return now;
  const str = String(raw).trim();
  if (!str) return now;

  if (!isDateOnly(str)) {
    const d = new Date(str);
    return Number.isNaN(d.getTime()) ? now : d;
  }

  // date-only: tomamos hora actual local (CDMX) y la convertimos a UTC
  const partsLocal = new Date(now.getTime() + TZ_OFFSET_MINUTES * 60 * 1000);
  const hh = partsLocal.getUTCHours();
  const mm = partsLocal.getUTCMinutes();
  const ss = partsLocal.getUTCSeconds();
  const ms = partsLocal.getUTCMilliseconds();
  return dateOnlyToUtc(str, hh, mm, ss, ms) || now;
}

function normalizeMetodoPago(raw) {
  const v = lower(raw);
  if (["tarjeta", "transferencia", "spei", "banco", "bancos"].includes(v)) return "bancos";
  if (["efectivo", "cash", "caja"].includes(v)) return "efectivo";
  if (!v) return "efectivo";
  return v;
}

async function nextJournalNumber(owner, dateObj) {
  const year = new Date(dateObj).getFullYear();
  const key = `journal-${year}`;
  const doc = await Counter.findOneAndUpdate(
    { owner, key },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  ).lean();
  const seq = doc?.seq || 1;
  return `${year}-${String(seq).padStart(4, "0")}`;
}

async function buildLine(owner, { code, debit = 0, credit = 0, memo = "" }) {
  const c = String(code ?? "").trim();
  if (!c) {
    const err = new Error("buildLine requiere code/codigo válido.");
    err.statusCode = 400;
    throw err;
  }

  const base = {
    debit: num(debit, 0),
    credit: num(credit, 0),
    memo: memo || "",
    // guardamos code en variantes comunes
    accountCodigo: c,
    accountCode: c,
    cuenta_codigo: c,
    cuentaCodigo: c,
  };

  const acc = await Account.findOne({
    owner,
    $or: [{ code: c }, { codigo: c }],
  })
    .select("_id code codigo name nombre")
    .lean();

  if (acc?._id) {
    const id = acc._id;
    return { ...base, accountId: id, cuenta_id: id, account: id };
  }

  return base;
}

async function buildAccountMaps(owner, entries) {
  const codes = new Set();
  const ids = new Set();

  for (const e of entries || []) {
    for (const l of e.lines || []) {
      const c = l.accountCodigo ?? l.accountCode ?? l.cuenta_codigo ?? l.cuentaCodigo ?? null;
      if (c) codes.add(String(c).trim());
      const aid = l.accountId ?? l.cuenta_id ?? l.account ?? null;
      if (aid && mongoose.Types.ObjectId.isValid(String(aid))) ids.add(String(aid));
    }
  }

  if (!codes.size && !ids.size) return { nameByCode: {}, codeById: {}, nameById: {} };

  const query = { owner, $or: [] };
  if (codes.size) query.$or.push({ $or: [{ code: { $in: [...codes] } }, { codigo: { $in: [...codes] } }] });
  if (ids.size) query.$or.push({ _id: { $in: [...ids].map((x) => new mongoose.Types.ObjectId(x)) } });

  const rows = await Account.find(query).select("_id code codigo name nombre").lean();

  const nameByCode = {};
  const codeById = {};
  const nameById = {};

  for (const r of rows) {
    const id = String(r._id);
    const code = String(r.code ?? r.codigo ?? "").trim();
    const name = r.name ?? r.nombre ?? "";

    if (id) {
      nameById[id] = name;
      if (code) codeById[id] = code;
    }
    if (code) nameByCode[code] = name;
  }

  return { nameByCode, codeById, nameById };
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

function mapEntryForUI(entry, accountMaps = {}) {
  const nameByCode = accountMaps?.nameByCode || {};
  const codeById = accountMaps?.codeById || {};
  const nameById = accountMaps?.nameById || {};

  const rawLines = entry.lines || entry.detalle_asientos || [];

  const detalle_asientos = (rawLines || []).map((l) => {
    let cuenta_codigo = String(
      l.accountCodigo ?? l.accountCode ?? l.cuenta_codigo ?? l.cuentaCodigo ?? ""
    ).trim();

    if (!cuenta_codigo) {
      const aid = l.accountId ?? l.cuenta_id ?? l.account ?? null;
      if (aid) {
        const sid = String(aid);
        if (codeById[sid]) cuenta_codigo = String(codeById[sid]).trim();
      }
    }

    const aid2 = l.accountId ?? l.cuenta_id ?? l.account ?? null;
    const sid2 = aid2 ? String(aid2) : null;

    const cuenta_nombre =
      (cuenta_codigo ? (nameByCode[cuenta_codigo] || null) : null) ||
      (sid2 ? (nameById[sid2] || null) : null);

    const memo = l.memo ?? l.descripcion ?? "";

    return {
      cuenta_codigo: cuenta_codigo || null,
      cuenta_nombre,
      debe: num(l.debit ?? l.debe, 0),
      haber: num(l.credit ?? l.haber, 0),
      memo,
    };
  });

  const detalles = detalle_asientos.map((d) => ({
    cuenta_codigo: d.cuenta_codigo,
    cuenta_nombre: d.cuenta_nombre,
    descripcion: d.memo || "",
    debe: d.debe,
    haber: d.haber,
  }));

  const concepto = entry.concept ?? entry.concepto ?? "";
  const numeroAsiento = entry.numeroAsiento ?? entry.numero_asiento ?? null;
  const fecha = entry.date ?? entry.fecha ?? entry.createdAt ?? null;

  return {
    id: String(entry._id),
    _id: entry._id,

    numeroAsiento,
    numero_asiento: numeroAsiento,

    asiento_fecha: fecha ? toYMDLocal(fecha) : null,
    fecha,

    descripcion: concepto,
    concepto,

    source: entry.source ?? "",
    sourceId: entry.sourceId ? String(entry.sourceId) : null,

    detalle_asientos,
    detalles,

    created_at: entry.createdAt,
    updated_at: entry.updatedAt,
  };
}

function computeMontosTx(tx) {
  const total = num(tx?.montoTotal ?? tx?.monto_total ?? tx?.total, 0);
  const descuento = num(tx?.montoDescuento ?? tx?.monto_descuento ?? tx?.descuento, 0);
  const neto = num(tx?.montoNeto ?? tx?.monto_neto ?? tx?.neto, Math.max(0, total - Math.max(0, descuento)));
  const pagado = num(tx?.montoPagado ?? tx?.monto_pagado ?? tx?.pagado, 0);
  const pendienteSaved = num(tx?.saldoPendiente ?? tx?.saldo_pendiente ?? tx?.monto_pendiente, NaN);
  const pendiente = Number.isFinite(pendienteSaved) ? pendienteSaved : Math.max(0, Number((neto - pagado).toFixed(2)));
  return { total, descuento, neto, pagado, pendiente };
}

function mapTxForUI(tx) {
  const montos = computeMontosTx(tx);

  const cuentaCodigo =
    tx.cuentaCodigo ??
    tx.cuenta_codigo ??
    tx.cuentaPrincipalCodigo ??
    tx.cuenta_principal_codigo ??
    null;

  const subcuentaId = tx.subcuentaId ?? tx.subcuenta_id ?? null;

  return {
    ...tx,
    id: tx._id ? String(tx._id) : tx.id,

    fecha: tx.fecha ?? null,
    fecha_ymd: tx.fecha ? toYMDLocal(tx.fecha) : null,

    montoTotal: montos.total,
    montoDescuento: montos.descuento,
    montoNeto: montos.neto,
    montoPagado: montos.pagado,
    saldoPendiente: montos.pendiente,

    monto_total: montos.total,
    monto_descuento: montos.descuento,
    monto_neto: montos.neto,
    monto_pagado: montos.pagado,
    saldo_pendiente: montos.pendiente,
    monto_pendiente: montos.pendiente,

    cuentaCodigo: cuentaCodigo ?? null,
    cuenta_codigo: cuentaCodigo ?? null,

    subcuentaId: subcuentaId ? String(subcuentaId) : null,
    subcuenta_id: subcuentaId ? String(subcuentaId) : null,

    clienteId: tx.clienteId ?? tx.clientId ?? tx.cliente_id ?? tx.client_id ?? null,
    cliente_id: tx.cliente_id ?? tx.clienteId ?? tx.clientId ?? tx.client_id ?? null,

    metodoPago: tx.metodoPago ?? tx.metodo_pago ?? null,
    tipoPago: tx.tipoPago ?? tx.tipo_pago ?? null,

    metodo_pago: tx.metodoPago ?? tx.metodo_pago ?? null,
    tipo_pago: tx.tipoPago ?? tx.tipo_pago ?? null,
  };
}

// =========================
// Endpoints
// =========================

/**
 * GET /api/cxc/detalle?pendientes=1&limit=2000
 * (útil para debug / y te sirve si después mueves el panel a /api/cxc)
 */
router.get("/detalle", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;
    const limit = Math.min(5000, Number(req.query.limit || 2000));
    const pendientes =
      String(req.query.pendientes ?? "").toLowerCase() === "1" ||
      String(req.query.pendientes ?? "").toLowerCase() === "true";

    const query = { owner };
    if (pendientes) {
      query.$or = [
        { saldoPendiente: { $gt: 0 } },
        { saldo_pendiente: { $gt: 0 } },
        { monto_pendiente: { $gt: 0 } },
      ];
    }

    const rows = await IncomeTransaction.find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    const items = rows.map(mapTxForUI);

    return res.json({ ok: true, data: items, items });
  } catch (err) {
    console.error("GET /api/cxc/detalle error:", err);
    return res.status(500).json({ ok: false, message: "Error cargando CxC" });
  }
});

/**
 * POST /api/cxc/registrar-pago
 * Body:
 * - ingresoId | transaccion_id | referencia_id
 * - monto (required)
 * - metodoPago: efectivo|bancos
 * - fecha (opcional)
 * - nota (opcional)
 *
 * Contabilidad:
 *   Debe 1001/1002
 *   Haber 1003
 */
router.post("/registrar-pago", ensureAuth, async (req, res) => {
  let session = null;

  try {
    const owner = req.user._id;

    const ingresoIdRaw =
      req.body?.ingresoId ??
      req.body?.ingreso_id ??
      req.body?.transaccion_id ??
      req.body?.transaccionId ??
      req.body?.referencia_id ??
      req.body?.referenciaId ??
      req.body?.id ??
      null;

    if (!ingresoIdRaw || !isObjectId(ingresoIdRaw)) {
      return res.status(400).json({ ok: false, message: "ingresoId/referencia_id inválido." });
    }

    const monto = num(req.body?.monto ?? req.body?.amount, 0);
    if (!(monto > 0)) {
      return res.status(400).json({ ok: false, message: "monto debe ser > 0." });
    }

    const metodoPago = normalizeMetodoPago(req.body?.metodoPago ?? req.body?.metodo_pago);
    if (!["efectivo", "bancos"].includes(metodoPago)) {
      return res.status(400).json({ ok: false, message: "metodoPago inválido (efectivo|bancos)." });
    }

    const fecha = parseTxDateSmart(req.body?.fecha, new Date());
    const nota = String(req.body?.nota ?? req.body?.concepto ?? req.body?.descripcion ?? "").trim();

    const COD_CAJA = "1001";
    const COD_BANCOS = "1002";
    const COD_CXC = "1003";

    const codCobro = metodoPago === "bancos" ? COD_BANCOS : COD_CAJA;

    // ✅ Usamos transacción (Mongo session) si está disponible
    // Si por tu cluster no soporta transactions, se cae a modo normal sin romper.
    try {
      session = await mongoose.startSession();
      session.startTransaction();
    } catch (_) {
      session = null;
    }

    const tx = await IncomeTransaction.findOne({
      owner,
      _id: new mongoose.Types.ObjectId(String(ingresoIdRaw)),
    }).session(session || undefined);

    if (!tx) {
      if (session) await session.abortTransaction().catch(() => {});
      return res.status(404).json({ ok: false, message: "Ingreso no encontrado." });
    }

    const montos = computeMontosTx(tx);
    const pendiente = num(montos.pendiente, 0);

    if (!(pendiente > 0)) {
      if (session) await session.abortTransaction().catch(() => {});
      return res.status(400).json({ ok: false, message: "Este ingreso no tiene saldo pendiente." });
    }

    if (monto > pendiente) {
      if (session) await session.abortTransaction().catch(() => {});
      return res.status(400).json({
        ok: false,
        message: `El monto del cobro (${monto}) no puede ser mayor al saldo pendiente (${pendiente}).`,
      });
    }

    // ✅ Actualizar tx (montoPagado + saldoPendiente)
    const neto = num(montos.neto, 0);
    const pagadoPrev = num(tx.montoPagado ?? tx.monto_pagado, 0);
    const pagadoNew = Number((pagadoPrev + monto).toFixed(2));
    const saldoNew = Math.max(0, Number((neto - pagadoNew).toFixed(2)));

    tx.montoPagado = pagadoNew;
    tx.monto_pagado = pagadoNew;

    tx.saldoPendiente = saldoNew;
    tx.saldo_pendiente = saldoNew;
    tx.montoPendiente = saldoNew;
    tx.monto_pendiente = saldoNew;

    // tipoPago: si ya quedó en 0, lo dejamos como contado (para UI)
    // si no, parcial
    if (saldoNew <= 0) {
      tx.tipoPago = "contado";
      tx.tipo_pago = "contado";
    } else {
      tx.tipoPago = "parcial";
      tx.tipo_pago = "parcial";
    }

    // metodoPago del cobro actual (no necesariamente el original)
    tx.metodoPago = tx.metodoPago ?? metodoPago;
    tx.metodo_pago = tx.metodo_pago ?? metodoPago;

    await tx.save({ session: session || undefined });

    // ✅ Crear asiento del cobro (reduce CxC)
    const lines = [
      await buildLine(owner, {
        code: codCobro,
        debit: monto,
        credit: 0,
        memo: "Cobro de cliente",
      }),
      await buildLine(owner, {
        code: COD_CXC,
        debit: 0,
        credit: monto,
        memo: "Aplicación a Cuentas por Cobrar",
      }),
    ];

    const numeroAsiento = await nextJournalNumber(owner, fecha);

    const entry = await JournalEntry.create(
      [
        {
          owner,
          date: fecha,
          concept: `Cobro CxC: ${tx.descripcion || "Ingreso"}`,
          source: "cobro_cxc",
          sourceId: tx._id,
          transaccionId: tx._id,
          source_id: tx._id,

          lines,
          detalle_asientos: lines,

          numeroAsiento,
        },
      ],
      session ? { session } : undefined
    );

    const entryDoc = Array.isArray(entry) ? entry[0] : entry;

    // ✅ Guardamos referencia del asiento en la transacción (best-effort)
    try {
      tx.asientoCobroId = tx.asientoCobroId ?? entryDoc._id;
      tx.asiento_cobro_id = tx.asiento_cobro_id ?? entryDoc._id;
      tx.ultimoCobroNumeroAsiento = tx.ultimoCobroNumeroAsiento ?? numeroAsiento;
      await tx.save({ session: session || undefined }).catch(() => {});
    } catch (_) {}

    if (session) {
      await session.commitTransaction().catch(() => {});
      await session.endSession().catch(() => {});
      session = null;
    }

    // ✅ Respuesta UI
    const accountMaps = await buildAccountMaps(owner, [entryDoc.toObject ? entryDoc.toObject() : entryDoc]);
    const asiento = mapEntryForUI(entryDoc.toObject ? entryDoc.toObject() : entryDoc, accountMaps);

    const txUI = mapTxForUI(tx.toObject ? tx.toObject() : tx);

    return res.status(201).json({
      ok: true,
      data: {
        transaction: txUI,
        asiento,
        numeroAsiento,
        cobro: {
          referencia_id: String(tx._id),
          tipo: "cobro",
          monto,
          metodoPago,
          fecha,
          nota: nota || "",
        },
      },
      transaction: txUI,
      asiento,
      numeroAsiento,
    });
  } catch (err) {
    try {
      if (session) {
        await session.abortTransaction().catch(() => {});
        await session.endSession().catch(() => {});
      }
    } catch (_) {}

    console.error("POST /api/cxc/registrar-pago error:", err);
    const status = err?.statusCode || 500;
    return res.status(status).json({ ok: false, message: err?.message || "Error registrando cobro" });
  }
});

module.exports = router;
