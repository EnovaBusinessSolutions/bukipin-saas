// backend/routes/cxc.js
const express = require("express");
const router = express.Router();

const mongoose = require("mongoose");
const ensureAuth = require("../middleware/ensureAuth");

const IncomeTransaction = require("../models/IncomeTransaction");
const JournalEntry = require("../models/JournalEntry");
const Account = require("../models/Account");

// ✅ Client opcional (si existe, enriquecemos cliente_nombre; si no, no rompe)
let Client = null;
try {
  Client = require("../models/Client");
} catch (_) {}

// ✅ Counter opcional (si no existe, no debe tumbar el server)
let Counter = null;
try {
  Counter = require("../models/Counter");
} catch (_) {}

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

function asValidDate(v) {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function isDateOnly(str) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(str || "").trim());
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
 * ✅ FIX TZ (como en transacciones.js):
 * Si tx.fecha viene en 00:00:00.000Z, el navegador -06 la mueve al día anterior.
 * Solución: mantenemos el día de fecha, pero usamos la hora real de createdAt.
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

function dateOnlyToUtc(str, hh = 0, mm = 0, ss = 0, ms = 0) {
  const s = String(str || "").trim();
  if (!isDateOnly(s)) return null;
  const [y, m, d] = s.split("-").map((x) => Number(x));
  if (!y || !m || !d) return null;
  const utcMillis = Date.UTC(y, m - 1, d, hh, mm, ss, ms);
  // Ajuste por offset para representar "hora local" en UTC
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

function parseOrder(order) {
  const o = String(order || "").trim().toLowerCase();
  if (!o) return { createdAt: -1 };
  if (o === "created_at_desc") return { createdAt: -1 };
  if (o === "created_at_asc") return { createdAt: 1 };
  if (o === "fecha_desc") return { fecha: -1, createdAt: -1 };
  if (o === "fecha_asc") return { fecha: 1, createdAt: 1 };
  return { createdAt: -1 };
}

async function nextJournalNumber(owner, dateObj) {
  // Si no hay Counter, devolvemos algo estable (no romper UI)
  if (!Counter) {
    const y = new Date(dateObj || new Date()).getFullYear();
    return `${y}-0000`;
  }

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

/**
 * ✅ FIX: query $or plano (sin $or dentro de $or)
 */
async function buildAccountMaps(owner, entries) {
  const codes = new Set();
  const ids = new Set();

  for (const e of entries || []) {
    const lines = e.lines || e.detalle_asientos || e.detalles_asiento || [];
    for (const l of lines || []) {
      const c = l.accountCodigo ?? l.accountCode ?? l.cuenta_codigo ?? l.cuentaCodigo ?? null;
      if (c) codes.add(String(c).trim());

      const aid = l.accountId ?? l.cuenta_id ?? l.account ?? null;
      if (aid && mongoose.Types.ObjectId.isValid(String(aid))) ids.add(String(aid));
    }
  }

  if (!codes.size && !ids.size) return { nameByCode: {}, codeById: {}, nameById: {} };

  const or = [];
  if (codes.size) {
    or.push({ code: { $in: [...codes] } });
    or.push({ codigo: { $in: [...codes] } });
  }
  if (ids.size) {
    or.push({ _id: { $in: [...ids].map((x) => new mongoose.Types.ObjectId(x)) } });
  }

  const rows = await Account.find({ owner, $or: or }).select("_id code codigo name nombre").lean();

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

function mapEntryForUI(entry, accountMaps = {}) {
  const nameByCode = accountMaps?.nameByCode || {};
  const codeById = accountMaps?.codeById || {};
  const nameById = accountMaps?.nameById || {};

  const rawLines = entry.lines || entry.detalle_asientos || entry.detalles_asiento || [];

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

    const memo = l.memo ?? l.descripcion ?? l.concepto ?? "";

    return {
      cuenta_codigo: cuenta_codigo || null,
      cuenta_nombre,
      debe: num(l.debit ?? l.debe, 0),
      haber: num(l.credit ?? l.haber, 0),
      memo,
      descripcion: memo,
    };
  });

  const detalles = detalle_asientos.map((d) => ({
    cuenta_codigo: d.cuenta_codigo,
    cuenta_nombre: d.cuenta_nombre,
    descripcion: d.descripcion || d.memo || "",
    debe: d.debe,
    haber: d.haber,
  }));

  const concepto = entry.concept ?? entry.concepto ?? entry.descripcion ?? "";
  const numeroAsiento = entry.numeroAsiento ?? entry.numero_asiento ?? entry.numero ?? entry.folio ?? null;

  const fecha = entry.date ?? entry.fecha ?? entry.entryDate ?? entry.createdAt ?? null;

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
    sourceId: entry.sourceId ? String(entry.sourceId) : (entry.transaccionId ? String(entry.transaccionId) : null),

    detalle_asientos,
    detalles,

    created_at: entry.createdAt,
    updated_at: entry.updatedAt,
  };
}

function computeMontosTx(tx) {
  const total = num(tx?.montoTotal ?? tx?.monto_total ?? tx?.total, 0);
  const descuento = num(tx?.montoDescuento ?? tx?.monto_descuento ?? tx?.descuento, 0);
  const neto = num(
    tx?.montoNeto ?? tx?.monto_neto ?? tx?.neto,
    Math.max(0, total - Math.max(0, descuento))
  );
  const pagado = num(tx?.montoPagado ?? tx?.monto_pagado ?? tx?.pagado, 0);
  const pendienteSaved = num(tx?.saldoPendiente ?? tx?.saldo_pendiente ?? tx?.monto_pendiente, NaN);
  const pendiente = Number.isFinite(pendienteSaved)
    ? pendienteSaved
    : Math.max(0, Number((neto - pagado).toFixed(2)));
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

  // ✅ FIX FECHA: evita invalid time value en el front
  const fechaFixed = fixFechaWithCreatedAt(tx);
  const fechaFinal = fechaFixed || asValidDate(tx.fecha) || asValidDate(tx.createdAt) || null;

  return {
    ...tx,
    id: tx._id ? String(tx._id) : tx.id,

    fecha: fechaFinal, // Date -> JSON la convierte a ISO
    fecha_fixed: fechaFixed ? fechaFixed.toISOString() : null,
    fecha_ymd: fechaFinal ? toYMDLocal(fechaFinal) : null,

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
    pendiente: montos.pendiente,

    cuentaCodigo: cuentaCodigo ?? null,
    cuenta_codigo: cuentaCodigo ?? null,

    subcuentaId: subcuentaId ? String(subcuentaId) : null,
    subcuenta_id: subcuentaId ? String(subcuentaId) : null,

    clienteId: tx.clienteId ?? tx.clientId ?? tx.cliente_id ?? tx.client_id ?? null,
    cliente_id: tx.cliente_id ?? tx.clienteId ?? tx.clientId ?? tx.client_id ?? null,

    // si ya existe en doc, lo respetamos
    cliente_nombre: tx.cliente_nombre ?? tx.clienteNombre ?? tx.cliente_name ?? null,

    metodoPago: tx.metodoPago ?? tx.metodo_pago ?? null,
    tipoPago: tx.tipoPago ?? tx.tipo_pago ?? null,

    metodo_pago: tx.metodoPago ?? tx.metodo_pago ?? null,
    tipo_pago: tx.tipoPago ?? tx.tipo_pago ?? null,
  };
}

// =========================
// Helpers para /asientos (histórico real CxC)
// =========================
function pickEntryDate(entry) {
  return (
    entry?.date ??
    entry?.fecha ??
    entry?.entryDate ??
    entry?.asiento_fecha ??
    entry?.createdAt ??
    entry?.created_at ??
    null
  );
}

function lineAccountCode(line) {
  return (
    line?.accountCodigo ??
    line?.accountCode ??
    line?.cuenta_codigo ??
    line?.cuentaCodigo ??
    line?.account?.codigo ??
    line?.cuentas?.codigo ??
    null
  );
}

function lineDebe(line) {
  return num(line?.debe ?? line?.debit ?? line?.debitAmount ?? line?.debit_amount, 0);
}

function lineHaber(line) {
  return num(line?.haber ?? line?.credit ?? line?.creditAmount ?? line?.credit_amount, 0);
}

// =========================
// Handlers compartidos (para aliases limpios)
// =========================
async function handleListIngresos(req, res) {
  try {
    const owner = req.user._id;
    const limit = Math.min(5000, Number(req.query.limit || 2000));
    const order = parseOrder(req.query.order);

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

    const rows = await IncomeTransaction.find(query).sort(order).limit(limit).lean();
    let items = (rows || []).map(mapTxForUI);

    // ✅ Enriquecer cliente_nombre best-effort si existe Client y viene clienteId
    if (Client) {
      const ids = [...new Set(items.map((x) => x.clienteId || x.cliente_id).filter(isObjectId).map(String))];
      if (ids.length) {
        const clients = await Client.find({
          owner,
          _id: { $in: ids.map((x) => new mongoose.Types.ObjectId(x)) },
        })
          .select("_id nombre name razonSocial razon_social")
          .lean();

        const nameById = {};
        for (const c of clients || []) {
          const id = String(c._id);
          const n = c.nombre ?? c.name ?? c.razonSocial ?? c.razon_social ?? null;
          if (id && n) nameById[id] = n;
        }

        items = items.map((it) => {
          const cid = String(it.clienteId || it.cliente_id || "");
          if (!it.cliente_nombre && cid && nameById[cid]) {
            return { ...it, cliente_nombre: nameById[cid] };
          }
          return it;
        });
      }
    }

    return res.json({ ok: true, data: items, items });
  } catch (err) {
    console.error("GET /api/cxc/ingresos error:", err);
    return res.status(500).json({ ok: false, message: "Error cargando CxC (ingresos)" });
  }
}

async function handleGetIngresoById(req, res) {
  try {
    const owner = req.user._id;
    const { id } = req.params;

    if (!isObjectId(id)) {
      return res.status(400).json({ ok: false, message: "ID inválido." });
    }

    const row = await IncomeTransaction.findOne({
      owner,
      _id: new mongoose.Types.ObjectId(String(id)),
    }).lean();

    if (!row) {
      return res.status(404).json({ ok: false, message: "Ingreso no encontrado." });
    }

    let item = mapTxForUI(row);

    // ✅ Enriquecer cliente_nombre best-effort
    if (Client) {
      const cid = item.clienteId || item.cliente_id;
      if (cid && isObjectId(cid) && !item.cliente_nombre) {
        const c = await Client.findOne({
          owner,
          _id: new mongoose.Types.ObjectId(String(cid)),
        })
          .select("_id nombre name razonSocial razon_social")
          .lean();

        const n = c?.nombre ?? c?.name ?? c?.razonSocial ?? c?.razon_social ?? null;
        if (n) item = { ...item, cliente_nombre: n };
      }
    }

    return res.json({ ok: true, data: item, item });
  } catch (err) {
    console.error("GET /api/cxc/ingresos/:id error:", err);
    return res.status(500).json({ ok: false, message: "Error cargando el detalle del ingreso" });
  }
}

// =========================
// Handler real para registrar pago (reusable por alias)
// =========================
async function handleRegistrarPago(req, res) {
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

    // ✅ Transacción si está disponible (si no, sigue sin romper)
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

    // ✅ Actualizar tx
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

    if (saldoNew <= 0) {
      tx.tipoPago = "contado";
      tx.tipo_pago = "contado";
    } else {
      tx.tipoPago = "parcial";
      tx.tipo_pago = "parcial";
    }

    tx.metodoPago = tx.metodoPago ?? metodoPago;
    tx.metodo_pago = tx.metodo_pago ?? metodoPago;

    await tx.save({ session: session || undefined });

    // ✅ Crear asiento del cobro
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

    const created = await JournalEntry.create(
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
          detalles_asiento: lines,

          numeroAsiento,
          numero_asiento: numeroAsiento,
        },
      ],
      session ? { session } : undefined
    );

    const entryDoc = Array.isArray(created) ? created[0] : created;

    // ✅ Guardar referencia (best-effort)
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

    const entryPlain = entryDoc?.toObject ? entryDoc.toObject() : entryDoc;
    const accountMaps = await buildAccountMaps(owner, [entryPlain]);
    const asiento = mapEntryForUI(entryPlain, accountMaps);

    const txUI = mapTxForUI(tx?.toObject ? tx.toObject() : tx);

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
}

// =========================
// Endpoints
// =========================

/**
 * ✅ ESTE es el endpoint que está pidiendo tu frontend en el panel:
 * GET /api/cxc/ingresos?pendientes=1&order=created_at_desc&limit=2000
 */
router.get("/ingresos", ensureAuth, handleListIngresos);

/**
 * ✅ Detalle por ID (útil para modal/detalle si el front lo usa)
 * GET /api/cxc/ingresos/:id
 */
router.get("/ingresos/:id", ensureAuth, handleGetIngresoById);

/**
 * ✅ Hook: useCuentasPorCobrarDetalle pide esto:
 * GET /api/cxc/detalle?pendientes=1
 *
 * Por ahora devolvemos los ingresos (CxC) tal cual; si luego conectas ventas-activos,
 * aquí lo combinamos para que sea realmente "detalle combinado".
 */
router.get("/detalle", ensureAuth, handleListIngresos);

/**
 * ✅ FIX CRÍTICO: el hook también pide esto
 * GET /api/cxc/ventas-activos?pendientes=1
 *
 * Por ahora lo devolvemos vacío (para NO romper el panel).
 * Cuando tengas el modelo/colección real, lo conectamos.
 */
router.get("/ventas-activos", ensureAuth, async (req, res) => {
  return res.json({ ok: true, data: [], items: [] });
});

/**
 * ✅ FIX CRÍTICO: el hook pide esto para histórico real
 * GET /api/cxc/asientos?cuenta_codigo=1003
 *
 * Devuelve rows tipo: { fecha: ISO, debe: number, haber: number }
 */
router.get("/asientos", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;

    const cuentaCodigo = String(req.query.cuenta_codigo || "").trim();
    if (!cuentaCodigo) {
      return res.status(400).json({ ok: false, message: "Falta cuenta_codigo" });
    }

    const start = req.query.start ? asValidDate(String(req.query.start)) : null;
    const end = req.query.end ? asValidDate(String(req.query.end)) : null;

    if (req.query.start && !start) return res.status(400).json({ ok: false, message: "start inválido" });
    if (req.query.end && !end) return res.status(400).json({ ok: false, message: "end inválido" });

    const endInclusive = end ? new Date(end.getTime()) : null;
    if (endInclusive) endInclusive.setHours(23, 59, 59, 999);

    // Traemos asientos del owner (si tu schema tiene date, esto ya te sirve)
    const entries = await JournalEntry.find({ owner }).sort({ createdAt: 1 }).lean();

    const out = [];
    for (const e of entries || []) {
      const fechaRaw = pickEntryDate(e);
      const fecha = asValidDate(fechaRaw);
      if (!fecha) continue;

      if (start && fecha < start) continue;
      if (endInclusive && fecha > endInclusive) continue;

      const lines = Array.isArray(e.lines)
        ? e.lines
        : Array.isArray(e.detalle_asientos)
          ? e.detalle_asientos
          : Array.isArray(e.detalles_asiento)
            ? e.detalles_asiento
            : [];

      if (!lines.length) continue;

      let debe = 0;
      let haber = 0;

      for (const ln of lines) {
        const code = String(lineAccountCode(ln) || "").trim();
        if (code !== cuentaCodigo) continue;
        debe += lineDebe(ln);
        haber += lineHaber(ln);
      }

      if (debe === 0 && haber === 0) continue;

      out.push({
        fecha: fecha.toISOString(),
        debe,
        haber,
      });
    }

    return res.json({ ok: true, data: out, items: out });
  } catch (err) {
    console.error("GET /api/cxc/asientos error:", err);
    return res.status(500).json({ ok: false, message: "Error cargando asientos CxC" });
  }
});

/**
 * POST /api/cxc/registrar-pago
 * Contabilidad:
 *   Debe 1001/1002
 *   Haber 1003
 */
router.post("/registrar-pago", ensureAuth, handleRegistrarPago);

/**
 * ✅ Alias interno (MISMO router) sin hacks de req.url:
 * POST /api/cxc/cuentas-por-cobrar/registrar-pago
 *
 * Esto SOLO sirve si el frontend pega a /api/cxc/...
 * Si tu frontend usa /api/cuentas-por-cobrar/registrar-pago,
 * lo correcto es MONTAR el router también en "/api/cuentas-por-cobrar" (ver nota abajo).
 */
router.post("/cuentas-por-cobrar/registrar-pago", ensureAuth, handleRegistrarPago);

module.exports = router;
