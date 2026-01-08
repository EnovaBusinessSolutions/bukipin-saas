// backend/routes/ingresos.js
const express = require("express");
const router = express.Router();

const mongoose = require("mongoose");
const ensureAuth = require("../middleware/ensureAuth");
const IncomeTransaction = require("../models/IncomeTransaction");
const JournalEntry = require("../models/JournalEntry");
const Account = require("../models/Account");
const Counter = require("../models/Counter");

// Opcional
let Client = null;
try {
  Client = require("../models/Client");
} catch (_) {}

// ✅ Opcional: modelo de productos/catálogo (para inferir subcuenta)
let Product = null;
try {
  Product = require("../models/Product");
} catch (_) {
  try {
    Product = require("../models/Producto");
  } catch (_) {
    try {
      Product = require("../models/CatalogProduct");
    } catch (_) {
      try {
        Product = require("../models/InventoryItem");
      } catch (_) {}
    }
  }
}

/**
 * =========================
 * ✅ TIMEZONE / FECHA E2E
 * =========================
 */
const TZ_OFFSET_MINUTES = Number(process.env.APP_TZ_OFFSET_MINUTES ?? -360); // CDMX estándar (-06)

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

function getLocalPartsFromUtc(dateObj) {
  const d = new Date(dateObj);
  if (Number.isNaN(d.getTime())) return null;
  const local = new Date(d.getTime() + TZ_OFFSET_MINUTES * 60 * 1000);
  return {
    hh: local.getUTCHours(),
    mm: local.getUTCMinutes(),
    ss: local.getUTCSeconds(),
    ms: local.getUTCMilliseconds(),
  };
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

function parseStartDate(s) {
  if (!s) return null;
  const str = String(s).trim();
  if (isDateOnly(str)) return dateOnlyToUtc(str, 0, 0, 0, 0);
  const d = new Date(str);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseEndDate(s) {
  if (!s) return null;
  const str = String(s).trim();
  if (isDateOnly(str)) return dateOnlyToUtc(str, 23, 59, 59, 999);
  const d = new Date(str);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseTxDateSmart(raw, now = new Date()) {
  if (!raw) return now;
  const str = String(raw).trim();
  if (!str) return now;

  if (!isDateOnly(str)) {
    const d = new Date(str);
    return Number.isNaN(d.getTime()) ? now : d;
  }

  const parts = getLocalPartsFromUtc(now);
  if (!parts) return now;

  const d2 = dateOnlyToUtc(str, parts.hh, parts.mm, parts.ss, parts.ms);
  return d2 || now;
}

function fixFechaWithCreatedAt(tx) {
  const f = tx?.fecha ? new Date(tx.fecha) : null;
  const c = tx?.createdAt ? new Date(tx.createdAt) : null;

  if (!f && c && !Number.isNaN(c.getTime())) return c;
  if (!f || Number.isNaN(f.getTime())) return null;

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

function num(v, def = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function lower(v) {
  return String(v ?? "").trim().toLowerCase();
}

function isObjectId(v) {
  return !!v && mongoose.Types.ObjectId.isValid(String(v));
}

function toIdString(v) {
  if (!v) return null;
  try {
    return String(v);
  } catch {
    return null;
  }
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

/**
 * ======= ENRIQUECIMIENTOS =======
 */
function computeMontos(tx) {
  const total = num(tx?.montoTotal ?? tx?.monto_total ?? tx?.total, 0);
  const descuento = num(tx?.montoDescuento ?? tx?.monto_descuento ?? tx?.descuento, 0);

  const neto = num(
    tx?.montoNeto ?? tx?.monto_neto ?? tx?.neto,
    Math.max(0, total - Math.max(0, descuento))
  );

  const pagado = num(tx?.montoPagado ?? tx?.monto_pagado ?? tx?.pagado, 0);
  const tipoPago = lower(tx?.tipoPago ?? tx?.tipo_pago);

  const pendiente =
    tipoPago === "contado" ? 0 : Math.max(0, Number((neto - pagado).toFixed(2)));

  return { total, descuento, neto, pagado, pendiente, tipoPago };
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
        it.cuenta_codigo ??
        it.cuentaCodigo ??
        it.cuentaPrincipalCodigo ??
        it.cuenta_principal_codigo ??
        it.cuenta_principal ??
        null
    )
    .filter(Boolean)
    .map(String);

  const accountNameMap = await getAccountNameMap(owner, codes);

  return items.map((it) => {
    const code = String(
      it.cuenta_codigo ??
        it.cuentaCodigo ??
        it.cuentaPrincipalCodigo ??
        it.cuenta_principal_codigo ??
        ""
    ).trim();

    if (!code) return it;

    const nombre = accountNameMap[code] || it.cuenta_nombre || it.cuentaName || null;
    const display = nombre ? `${code} - ${nombre}` : code;

    return {
      ...it,
      cuenta_codigo: it.cuenta_codigo ?? code,
      cuenta_nombre: it.cuenta_nombre ?? nombre,

      cuentaPrincipalCodigo: it.cuentaPrincipalCodigo ?? code,
      cuentaPrincipalNombre: it.cuentaPrincipalNombre ?? nombre,
      cuentaPrincipal: it.cuentaPrincipal ?? display,

      cuenta_principal_codigo: it.cuenta_principal_codigo ?? code,
      cuenta_principal_nombre: it.cuenta_principal_nombre ?? nombre,
      cuenta_principal: it.cuenta_principal ?? display,
    };
  });
}

/**
 * ✅ Resolver subcuenta a (id + code) desde ref (ObjectId o code)
 */
async function resolveAccountFromRef(owner, ref) {
  if (!ref) return { id: null, code: null };

  const s = String(ref).trim();
  if (!s) return { id: null, code: null };

  // si es ObjectId: buscamos cuenta para obtener code
  if (isObjectId(s)) {
    const acc = await Account.findOne({
      owner,
      _id: new mongoose.Types.ObjectId(s),
    })
      .select("_id code codigo")
      .lean();

    if (!acc) return { id: s, code: null };
    const code = String(acc.code ?? acc.codigo ?? "").trim() || null;
    return { id: String(acc._id), code };
  }

  // si es code: buscamos cuenta para obtener _id
  const acc = await Account.findOne({
    owner,
    $or: [{ code: s }, { codigo: s }],
  })
    .select("_id code codigo")
    .lean();

  if (!acc) return { id: null, code: s };
  const code = String(acc.code ?? acc.codigo ?? "").trim() || s;
  return { id: String(acc._id), code };
}

// ✅ Enriquecer subcuenta (para que el UI no diga “sin subcuenta”)
async function attachSubcuentaInfo(owner, items) {
  if (!items?.length) return items;

  const refs = Array.from(
    new Set(
      items
        .map(
          (it) =>
            it.subcuentaId ??
            it.subcuenta_id ??
            it.subcuentaCodigo ??
            it.subcuenta_codigo ??
            null
        )
        .filter(Boolean)
        .map((v) => String(v))
    )
  );

  if (!refs.length) return items;

  const ids = refs.filter((v) => mongoose.Types.ObjectId.isValid(v));
  const codes = refs.filter((v) => !mongoose.Types.ObjectId.isValid(v));

  const or = [];
  if (ids.length) {
    or.push({ _id: { $in: ids.map((x) => new mongoose.Types.ObjectId(x)) } });
  }
  if (codes.length) {
    or.push({ $or: [{ code: { $in: codes } }, { codigo: { $in: codes } }] });
  }
  if (!or.length) return items;

  const rows = await Account.find({ owner, $or: or })
    .select("_id code codigo name nombre")
    .lean();

  const byId = new Map(rows.map((r) => [String(r._id), r]));
  const byCode = new Map(
    rows
      .map((r) => [String(r.code ?? r.codigo ?? "").trim(), r])
      .filter(([k]) => !!k)
  );

  return items.map((it) => {
    const ref =
      it.subcuentaId ??
      it.subcuenta_id ??
      it.subcuentaCodigo ??
      it.subcuenta_codigo ??
      null;

    if (!ref) return it;

    const r = mongoose.Types.ObjectId.isValid(String(ref))
      ? byId.get(String(ref))
      : byCode.get(String(ref).trim());

    if (!r) return it;

    const id = String(r._id);
    const code = String(r.code ?? r.codigo ?? "").trim();
    const name = r.name ?? r.nombre ?? "";

    // ✅ AQUÍ ESTÁ LA CLAVE: poner también el id (lo que el frontend filtra)
    return {
      ...it,
      subcuentaId: it.subcuentaId ?? id,
      subcuenta_id: it.subcuenta_id ?? id,

      subcuentaCodigo: it.subcuentaCodigo ?? code,
      subcuenta_codigo: it.subcuenta_codigo ?? code,

      subcuentaNombre: it.subcuentaNombre ?? name,
      subcuenta_nombre: it.subcuenta_nombre ?? name,

      subcuenta: it.subcuenta ?? (name ? `${code} - ${name}` : code),
    };
  });
}

// ✅ Inferir subcuenta desde Product cuando la tx no la trae
async function attachSubcuentaFromProduct(owner, items) {
  if (!Product || !items?.length) return items;

  const getPid = (it) =>
    it.productId ??
    it.product_id ??
    it.productoId ??
    it.producto_id ??
    it.itemId ??
    it.item_id ??
    null;

  const need = items
    .map((it, idx) => ({ it, idx, pid: getPid(it) }))
    .filter(
      ({ it, pid }) =>
        !!pid &&
        isObjectId(pid) &&
        !(it.subcuentaId || it.subcuenta_id || it.subcuentaCodigo || it.subcuenta_codigo)
    );

  if (!need.length) return items;

  const ids = Array.from(new Set(need.map((x) => String(x.pid))));
  const rows = await Product.find({
    owner,
    _id: { $in: ids.map((x) => new mongoose.Types.ObjectId(x)) },
  })
    .select("subcuentaId subcuenta_id subcuenta subcuentaCodigo subcuenta_codigo")
    .lean();

  const map = new Map(
    rows.map((p) => {
      const subRef =
        p.subcuentaId ??
        p.subcuenta_id ??
        p.subcuenta ??
        p.subcuentaCodigo ??
        p.subcuenta_codigo ??
        null;

      return [String(p._id), subRef ? String(subRef) : null];
    })
  );

  return items.map((it) => {
    const pid = getPid(it);
    if (!pid || !isObjectId(pid)) return it;
    const subRef = map.get(String(pid));
    if (!subRef) return it;

    // guardamos "ref" en tx para que luego attachSubcuentaInfo resuelva id/nombre
    return {
      ...it,
      subcuentaId: it.subcuentaId ?? subRef,
      subcuenta_id: it.subcuenta_id ?? subRef,
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
            it.clienteId ||
            it.clientId ||
            it.cliente_id ||
            it.client_id ||
            it.clienteID ||
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
    const cidRaw =
      it.clienteId || it.clientId || it.cliente_id || it.client_id || it.clienteID || "";
    const cid = cidRaw ? String(cidRaw) : "";
    const c = cid ? map.get(cid) : null;
    if (!c) return it;

    return {
      ...it,
      cliente_nombre: it.cliente_nombre ?? c.nombre,
      cliente_email: it.cliente_email ?? c.email,
      cliente_telefono: it.cliente_telefono ?? c.telefono,
      cliente_rfc: it.cliente_rfc ?? c.rfc,

      clienteNombre: it.clienteNombre ?? c.nombre,
      clienteEmail: it.clienteEmail ?? c.email,
      clienteTelefono: it.clienteTelefono ?? c.telefono,
      clienteRfc: it.clienteRfc ?? c.rfc,
    };
  });
}

/**
 * ✅ Mapeo transacción para UI (con fecha FIXED)
 * ✅ subcuenta_id/subcuentaId siempre string (si existe)
 */
function mapTxForUI(tx) {
  const fechaFixed = fixFechaWithCreatedAt(tx);
  const fecha = fechaFixed ? new Date(fechaFixed) : tx?.fecha ? new Date(tx.fecha) : null;

  const montos = computeMontos(tx);

  const cuentaCodigo =
    tx.cuentaCodigo ??
    tx.cuenta_codigo ??
    tx.cuentaPrincipalCodigo ??
    tx.cuenta_principal_codigo ??
    null;

  // ✅ subcuenta: aquí NO mezcles "subcuenta" display con id
  const rawSubId = tx.subcuentaId ?? tx.subcuenta_id ?? null;
  const rawSubCode = tx.subcuentaCodigo ?? tx.subcuenta_codigo ?? null;

  const subcuentaId = rawSubId ? toIdString(rawSubId) : null;
  const subcuentaCodigo = rawSubCode ? String(rawSubCode).trim() : null;

  return {
    ...tx,
    id: tx._id ? String(tx._id) : tx.id,

    fecha,
    fecha_fixed: fecha ? fecha.toISOString() : null,
    fecha_ymd: fecha ? toYMDLocal(fecha) : null,

    montoTotal: montos.total,
    montoDescuento: montos.descuento,
    montoNeto: montos.neto,
    montoPagado: montos.pagado,

    montoPendiente: montos.pendiente,
    saldoPendiente: montos.pendiente,

    monto_total: montos.total,
    monto_descuento: montos.descuento,
    monto_neto: montos.neto,
    monto_pagado: montos.pagado,
    monto_pendiente: montos.pendiente,
    saldo_pendiente: montos.pendiente,

    total: montos.total,
    descuento: montos.descuento,
    neto: montos.neto,
    pagado: montos.pagado,
    pendiente: montos.pendiente,

    metodoPago: tx.metodoPago ?? tx.metodo_pago ?? null,
    tipoPago: tx.tipoPago ?? tx.tipo_pago ?? montos.tipoPago ?? null,

    metodo_pago: tx.metodoPago ?? tx.metodo_pago ?? null,
    tipo_pago: tx.tipoPago ?? tx.tipo_pago ?? montos.tipoPago ?? null,

    cuentaCodigo: cuentaCodigo ?? null,
    cuenta_codigo: cuentaCodigo ?? null,
    cuentaPrincipalCodigo:
      tx.cuentaPrincipalCodigo ?? tx.cuenta_principal_codigo ?? cuentaCodigo ?? null,
    cuenta_principal_codigo:
      tx.cuenta_principal_codigo ?? tx.cuentaPrincipalCodigo ?? cuentaCodigo ?? null,

    // ✅ subcuenta canonical
    subcuentaId: subcuentaId ?? null,
    subcuenta_id: subcuentaId ?? null,
    subcuentaCodigo: subcuentaCodigo ?? null,
    subcuenta_codigo: subcuentaCodigo ?? null,

    clienteId: tx.clienteId ?? tx.clientId ?? tx.cliente_id ?? tx.client_id ?? null,
    clientId: tx.clientId ?? tx.clienteId ?? tx.cliente_id ?? tx.client_id ?? null,
    cliente_id: tx.cliente_id ?? tx.clienteId ?? tx.clientId ?? tx.client_id ?? null,
    client_id: tx.client_id ?? tx.clientId ?? tx.clienteId ?? tx.cliente_id ?? null,

    cliente_nombre: tx.cliente_nombre ?? null,
    cliente_email: tx.cliente_email ?? null,
    cliente_telefono: tx.cliente_telefono ?? null,
    cliente_rfc: tx.cliente_rfc ?? null,

    created_at: tx.createdAt ?? tx.created_at ?? null,
    updated_at: tx.updatedAt ?? tx.updated_at ?? null,
  };
}

/**
 * Journal line mode
 */
function journalLineMode() {
  const schema = JournalEntry?.schema;
  if (!schema) return "code";

  const hasAccountId =
    schema.path("lines.accountId") ||
    schema.path("lines.$.accountId") ||
    schema.path("lines.0.accountId");
  if (hasAccountId) return "id";

  const hasAccountCodigo =
    schema.path("lines.accountCodigo") ||
    schema.path("lines.$.accountCodigo") ||
    schema.path("lines.0.accountCodigo");
  if (hasAccountCodigo) return "code";

  return "code";
}

async function accountIdByCode(owner, code) {
  const c = String(code).trim();
  const acc = await Account.findOne({
    owner,
    $or: [{ code: c }, { codigo: c }],
  })
    .select("_id code codigo name nombre")
    .lean();
  return acc?._id || null;
}

async function buildLine(owner, { code, debit = 0, credit = 0, memo = "" }) {
  const mode = journalLineMode();

  const base = {
    debit: num(debit, 0),
    credit: num(credit, 0),
    memo: memo || "",
  };

  if (mode === "id") {
    const id = await accountIdByCode(owner, code);
    if (!id) {
      const err = new Error(
        `No existe la cuenta contable con code/codigo="${String(code).trim()}" para este usuario. Asegúrate de que el seed la haya creado.`
      );
      err.statusCode = 400;
      throw err;
    }
    return { ...base, accountId: id };
  }

  return { ...base, accountCodigo: String(code).trim() };
}

function mapEntryForUI(entry, accountNameMap = {}) {
  const rawLines = entry.lines || entry.detalle_asientos || [];

  const detalle_asientos = (rawLines || []).map((l) => {
    const cuentaCodigo = l.accountCodigo ?? l.accountCode ?? l.cuenta_codigo ?? "";
    const cuenta_codigo = cuentaCodigo ? String(cuentaCodigo).trim() : "";

    return {
      cuenta_codigo: cuenta_codigo || null,
      cuenta_nombre: cuenta_codigo ? (accountNameMap[cuenta_codigo] || null) : null,
      debe: num(l.debit ?? l.debe, 0),
      haber: num(l.credit ?? l.haber, 0),
      memo: l.memo ?? "",
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

  return {
    id: String(entry._id),
    _id: entry._id,

    numeroAsiento,
    numero_asiento: numeroAsiento,

    asiento_fecha: toYMDLocal(entry.date),
    fecha: entry.date,

    descripcion: concepto,
    concepto,

    source: entry.source ?? "",
    transaccion_ingreso_id: entry.sourceId ? String(entry.sourceId) : null,

    detalle_asientos,
    detalles,

    created_at: entry.createdAt,
    updated_at: entry.updatedAt,
  };
}

function flattenDetalles(entries, accountMaps = null) {
  const detalles = [];

  const getCodeFromLine = (l) => {
    const code =
      l.accountCodigo ??
      l.accountCode ??
      l.cuenta_codigo ??
      l.cuentaCodigo ??
      null;

    if (code) return String(code).trim();

    const aid = l.accountId ?? l.cuenta_id ?? l.account ?? null;
    if (aid && accountMaps?.codeById) {
      const resolved = accountMaps.codeById[String(aid)];
      if (resolved) return String(resolved).trim();
    }

    return null;
  };

  for (const e of entries) {
    const asientoFecha = toYMDLocal(e.date);
    for (const l of e.lines || []) {
      const cuenta_codigo = getCodeFromLine(l);

      detalles.push({
        cuenta_codigo,
        debe: num(l.debit ?? l.debe, 0),
        haber: num(l.credit ?? l.haber, 0),
        asiento_fecha: asientoFecha,
        asiento_id: String(e._id),
        concepto: e.concept ?? e.concepto ?? "",
        transaccion_ingreso_id: e.sourceId ? String(e.sourceId) : null,
      });
    }
  }

  return detalles;
}

function normalizeMetodoPago(raw) {
  let v = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (["tarjeta", "transferencia", "spei", "banco", "bancos"].includes(v)) return "bancos";
  if (["efectivo", "cash", "caja"].includes(v)) return "efectivo";
  if (!v) return "efectivo";
  return v;
}

function normalizeTipoPago(raw) {
  let v = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (!v) return "contado";
  return v;
}

/**
 * GET /api/ingresos/clientes-min?q=...&limit=200
 */
router.get("/clientes-min", ensureAuth, async (req, res) => {
  try {
    if (!Client) return res.json({ ok: true, data: [] });

    const owner = req.user._id;
    const q = (req.query.q ? String(req.query.q) : "").trim();
    const limit = Math.min(2000, Number(req.query.limit || 200));

    const filter = { owner };
    if (q) {
      filter.$or = [
        { nombre: { $regex: q, $options: "i" } },
        { name: { $regex: q, $options: "i" } },
        { rfc: { $regex: q, $options: "i" } },
      ];
    }

    const items = await Client.find(filter)
      .select("_id nombre name")
      .sort({ nombre: 1, name: 1 })
      .limit(limit)
      .lean();

    const data = items.map((c) => ({
      id: String(c._id),
      nombre: c.nombre ?? c.name ?? "Sin nombre",
    }));

    return res.json({ ok: true, data });
  } catch (err) {
    console.error("GET /api/ingresos/clientes-min error:", err);
    return res.status(500).json({ ok: false, message: "Error cargando clientes" });
  }
});

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

  if (!codes.size && !ids.size) {
    return { nameByCode: {}, codeById: {}, nameById: {} };
  }

  const query = { owner, $or: [] };
  if (codes.size)
    query.$or.push({ $or: [{ code: { $in: [...codes] } }, { codigo: { $in: [...codes] } }] });
  if (ids.size)
    query.$or.push({ _id: { $in: [...ids].map((x) => new mongoose.Types.ObjectId(x)) } });

  const rows = await Account.find(query)
    .select("_id code codigo name nombre")
    .lean();

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

/**
 * GET /api/ingresos/asientos?start=YYYY-MM-DD&end=YYYY-MM-DD
 */
router.get("/asientos", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;

    const start = parseStartDate(req.query.start || req.query.from);
    const end = parseEndDate(req.query.end || req.query.to);

    if (!start || !end) {
      return res.status(400).json({
        ok: false,
        message: "start/end (o from/to) son requeridos.",
      });
    }

    const entries = await JournalEntry.find({
      owner,
      date: { $gte: start, $lte: end },
      source: { $in: ["ingreso", "ingreso_directo"] },
    })
      .sort({ date: -1, createdAt: -1 })
      .lean();

    const accountMaps = await buildAccountMaps(owner, entries);

    const asientos = entries.map((e) => mapEntryForUI(e, accountMaps.nameByCode));
    const detalles = flattenDetalles(entries, accountMaps);

    return res.json({
      ok: true,
      data: { asientos, detalles },
      asientos,
      detalles,
    });
  } catch (err) {
    console.error("GET /api/ingresos/asientos error:", err);
    return res.status(500).json({ ok: false, message: "Error cargando asientos" });
  }
});

/**
 * GET /api/ingresos/detalles?start=YYYY-MM-DD&end=YYYY-MM-DD
 */
router.get("/detalles", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;

    const start = parseStartDate(req.query.start || req.query.from);
    const end = parseEndDate(req.query.end || req.query.to);

    if (!start || !end) {
      return res.status(400).json({
        ok: false,
        message: "start/end (o from/to) son requeridos.",
      });
    }

    const entries = await JournalEntry.find({
      owner,
      date: { $gte: start, $lte: end },
      source: { $in: ["ingreso", "ingreso_directo"] },
    })
      .sort({ date: -1, createdAt: -1 })
      .lean();

    const detalles = flattenDetalles(entries);

    const itemsRaw = await IncomeTransaction.find({
      owner,
      fecha: { $gte: start, $lte: end },
    })
      .sort({ fecha: -1, createdAt: -1 })
      .lean();

    let items = itemsRaw.map(mapTxForUI);

    items = await attachAccountInfo(owner, items);
    items = await attachSubcuentaFromProduct(owner, items); // ✅ inferencia por producto
    items = await attachSubcuentaInfo(owner, items); // ✅ ahora sí mete subcuenta_id + nombre
    items = await attachClientInfo(owner, items);

    const total = itemsRaw.reduce((acc, it) => {
      const m = computeMontos(it);
      return acc + num(m.neto, 0);
    }, 0);

    return res.json({
      ok: true,
      data: { detalles, items, resumen: { total, count: itemsRaw.length } },
      detalles,
      items,
      resumen: { total, count: itemsRaw.length },
    });
  } catch (err) {
    console.error("GET /api/ingresos/detalles error:", err);
    return res.status(500).json({ ok: false, message: "Error cargando detalles" });
  }
});

/**
 * GET /api/ingresos/asientos-directos?limit=300&start=...&end=...
 */
router.get("/asientos-directos", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;
    const limit = Math.min(2000, Number(req.query.limit || 300));

    const start = parseStartDate(req.query.start || req.query.from);
    const end = parseEndDate(req.query.end || req.query.to);

    const filter = {
      owner,
      source: { $in: ["ingreso", "ingreso_directo"] },
      $or: [{ sourceId: null }, { sourceId: { $exists: false } }],
    };

    if (start && end) filter.date = { $gte: start, $lte: end };

    const entries = await JournalEntry.find(filter)
      .sort({ date: -1, createdAt: -1 })
      .limit(limit)
      .lean();

    const allCodes = entries
      .flatMap((e) => (e.lines || []).map((l) => l.accountCodigo ?? l.accountCode ?? null))
      .filter(Boolean)
      .map(String);

    const accountNameMap = await getAccountNameMap(owner, allCodes);
    const asientos = entries.map((e) => mapEntryForUI(e, accountNameMap));

    return res.json({ ok: true, data: { asientos }, asientos });
  } catch (err) {
    console.error("GET /api/ingresos/asientos-directos error:", err);
    return res.status(500).json({ ok: false, message: "Error cargando asientos" });
  }
});

/**
 * GET /api/ingresos/recientes?limit=1000
 */
router.get("/recientes", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;
    const limit = Math.min(2000, Number(req.query.limit || 1000));

    const itemsRaw = await IncomeTransaction.find({ owner })
      .sort({ fecha: -1, createdAt: -1 })
      .limit(limit)
      .lean();

    let items = itemsRaw.map(mapTxForUI);
    items = await attachAccountInfo(owner, items);
    items = await attachSubcuentaFromProduct(owner, items);
    items = await attachSubcuentaInfo(owner, items);
    items = await attachClientInfo(owner, items);

    return res.json({ ok: true, data: items, items });
  } catch (err) {
    console.error("GET /api/ingresos/recientes error:", err);
    return res.status(500).json({ ok: false, message: "Error cargando ingresos recientes" });
  }
});

/**
 * POST /api/ingresos/:id/cancelar
 */
router.post("/:id/cancelar", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;
    const { id } = req.params;

    const tx = await IncomeTransaction.findOne({ _id: id, owner });
    if (!tx) return res.status(404).json({ ok: false, message: "Ingreso no encontrado." });

    const linked = await JournalEntry.findOne({
      owner,
      source: "ingreso",
      sourceId: tx._id,
    })
      .select("_id numeroAsiento")
      .lean();

    const numeroAsientoCancelado = linked?.numeroAsiento || (linked ? String(linked._id) : null);

    await JournalEntry.deleteMany({ owner, source: "ingreso", sourceId: tx._id });
    await IncomeTransaction.deleteOne({ _id: tx._id, owner });

    return res.json({
      ok: true,
      numeroAsientoCancelado,
      data: { numeroAsientoCancelado },
    });
  } catch (err) {
    console.error("POST /api/ingresos/:id/cancelar error:", err);
    return res.status(500).json({ ok: false, message: "Error cancelando ingreso" });
  }
});

/**
 * POST /api/ingresos
 */
router.post("/", ensureAuth, async (req, res) => {
  const owner = req.user._id;
  let tx = null;

  try {
    const tipoIngreso = String(req.body?.tipoIngreso || "general");
    const descripcion = String(req.body?.descripcion || "Ingreso").trim();

    const total = num(req.body?.montoTotal ?? req.body?.total, 0);
    const descuento = num(req.body?.montoDescuento ?? req.body?.descuento, 0);
    const neto = Math.max(0, total - Math.max(0, descuento));

    const metodoPago = normalizeMetodoPago(req.body?.metodoPago);
    const tipoPago = normalizeTipoPago(req.body?.tipoPago);

    const cuentaCodigo = String(
      req.body?.cuentaCodigo || req.body?.cuentaPrincipalCodigo || "4001"
    ).trim();

    // ✅ subcuenta puede venir por body o inferirse por producto
    let subcuentaRef =
      req.body?.subcuentaId ??
      req.body?.subcuenta_id ??
      req.body?.subcuentaCodigo ??
      req.body?.subcuenta_codigo ??
      null;

    const productIdRaw =
      req.body?.productId ??
      req.body?.productoId ??
      req.body?.product_id ??
      req.body?.producto_id ??
      req.body?.itemId ??
      req.body?.item_id ??
      null;

    if (!subcuentaRef && productIdRaw) {
      // inferir desde producto
      const p = await Product?.findOne({
        owner,
        _id: new mongoose.Types.ObjectId(String(productIdRaw)),
      })
        .select("subcuentaId subcuenta_id subcuenta subcuentaCodigo subcuenta_codigo")
        .lean()
        .catch(() => null);

      subcuentaRef =
        p?.subcuentaId ??
        p?.subcuenta_id ??
        p?.subcuenta ??
        p?.subcuentaCodigo ??
        p?.subcuenta_codigo ??
        null;
    }

    // ✅ resolver a id+code
    const { id: subcuentaIdResolved, code: subcuentaCodigoResolved } = await resolveAccountFromRef(
      owner,
      subcuentaRef
    );

    const now = new Date();
    let fecha = parseTxDateSmart(req.body?.fecha, now);
    if (!fecha) return res.status(400).json({ ok: false, message: "fecha inválida." });

    const montoPagadoRaw = num(req.body?.montoPagado ?? req.body?.pagado, 0);

    if (!total || total <= 0) {
      return res.status(400).json({ ok: false, message: "montoTotal debe ser > 0." });
    }
    if (descuento < 0) {
      return res.status(400).json({ ok: false, message: "montoDescuento no puede ser negativo." });
    }

    if (!["efectivo", "bancos"].includes(metodoPago)) {
      return res.status(400).json({ ok: false, message: "metodoPago inválido (efectivo|bancos)." });
    }
    if (!["contado", "parcial", "credito"].includes(tipoPago)) {
      return res.status(400).json({ ok: false, message: "tipoPago inválido (contado|parcial|credito)." });
    }
    if (tipoPago === "parcial" && (montoPagadoRaw < 0 || montoPagadoRaw > neto)) {
      return res.status(400).json({ ok: false, message: "montoPagado debe estar entre 0 y montoNeto." });
    }

    const montoPagado =
      tipoPago === "contado" ? neto : Math.min(Math.max(montoPagadoRaw, 0), neto);
    const saldoPendiente = tipoPago === "contado" ? 0 : Math.max(0, neto - montoPagado);

    const COD_CAJA = "1001";
    const COD_BANCOS = "1002";
    const COD_CXC = "1003"; // ✅ SIEMPRE aquí van los saldos pendientes
    const COD_DESCUENTOS = "4002";
    const codCobro = metodoPago === "bancos" ? COD_BANCOS : COD_CAJA;

    const txPayload = {
      owner,
      fecha,
      tipoIngreso,
      descripcion,

      montoTotal: total,
      montoDescuento: descuento,
      montoNeto: neto,
      metodoPago,
      tipoPago,
      montoPagado,

      cuentaCodigo,
      cuentaPrincipalCodigo: cuentaCodigo,
      cuenta_principal_codigo: cuentaCodigo,

      // ✅ guardamos id + code (canonical)
      subcuentaId: subcuentaIdResolved ?? null,
      subcuenta_id: subcuentaIdResolved ?? null,
      subcuentaCodigo: subcuentaCodigoResolved ?? null,
      subcuenta_codigo: subcuentaCodigoResolved ?? null,

      // trazabilidad (si venía por producto)
      productId: productIdRaw ?? null,
      product_id: productIdRaw ?? null,

      saldoPendiente,
      saldo_pendiente: saldoPendiente,
      montoPendiente: saldoPendiente,
      monto_pendiente: saldoPendiente,
    };

    const clienteIdRaw =
      req.body?.clienteId ??
      req.body?.clientId ??
      req.body?.cliente_id ??
      req.body?.client_id ??
      null;

    if (clienteIdRaw) {
      txPayload.clienteId = clienteIdRaw;
      txPayload.clientId = clienteIdRaw;
      txPayload.cliente_id = clienteIdRaw;
      txPayload.client_id = clienteIdRaw;
    }

    tx = await IncomeTransaction.create(txPayload);

    const lines = [];

    if (descuento > 0) {
      lines.push(
        await buildLine(owner, {
          code: COD_DESCUENTOS,
          debit: descuento,
          credit: 0,
          memo: "Descuento",
        })
      );
    }

    if (tipoPago === "contado") {
  lines.push(
    await buildLine(owner, {
      code: codCobro,
      debit: neto,
      credit: 0,
      memo: "Cobro contado",
    })
  );
} else {
  if (montoPagado > 0) {
    lines.push(
      await buildLine(owner, {
        code: codCobro,
        debit: montoPagado,
        credit: 0,
        memo: "Cobro",
      })
    );
  }

  // ✅ SIEMPRE: saldo pendiente a 1003 (Cuentas por Cobrar Clientes)
  if (saldoPendiente > 0) {
    lines.push(
      await buildLine(owner, {
        code: COD_CXC,
        debit: saldoPendiente,
        credit: 0,
        memo: "Saldo pendiente (Cuentas por Cobrar)",
      })
    );
  }
} // ✅ <-- ESTA LLAVE TE FALTABA (cierra el else)

// ✅ CLAVE: el haber del ingreso debe caer en subcuenta si existe
const haberIngresos = descuento > 0 ? total : neto;
const codeIngreso = subcuentaCodigoResolved || cuentaCodigo;

lines.push(
  await buildLine(owner, {
    code: codeIngreso,
    debit: 0,
    credit: haberIngresos,
    memo: subcuentaCodigoResolved ? "Ingreso (subcuenta)" : "Ingreso",
  })
);

    const numeroAsiento = await nextJournalNumber(owner, tx.fecha);

    const entry = await JournalEntry.create({
      owner,
      date: tx.fecha,
      concept: `Ingreso: ${tx.descripcion}`,
      source: "ingreso",
      sourceId: tx._id,
      lines,
      numeroAsiento,
    });

    const entryCodes = (entry.lines || [])
      .map((l) => l.accountCodigo ?? l.accountCode ?? null)
      .filter(Boolean)
      .map(String);

    const accountNameMap = await getAccountNameMap(owner, entryCodes);
    const asiento = mapEntryForUI(entry, accountNameMap);

    let txUI = mapTxForUI(tx.toObject ? tx.toObject() : tx);
    txUI = (await attachAccountInfo(owner, [txUI]))[0];
    txUI = (await attachSubcuentaInfo(owner, [txUI]))[0];
    txUI = (await attachClientInfo(owner, [txUI]))[0];

    return res.status(201).json({
      ok: true,
      numeroAsiento,
      asiento,
      transaction: txUI,
      data: {
        transaction: txUI,
        asiento,
        numeroAsiento,
        journalEntryId: String(entry._id),
      },
    });
  } catch (err) {
    if (tx?._id) {
      await IncomeTransaction.deleteOne({ _id: tx._id, owner }).catch(() => {});
    }
    const status = err?.statusCode || 500;
    console.error("POST /api/ingresos error:", err);
    return res.status(status).json({ ok: false, message: err?.message || "Error creando ingreso" });
  }
});

/**
 * GET /api/ingresos/highlights
 * Devuelve totales SOLO del día/mes/año actuales (NO depende de filtros de analítica).
 */
router.get("/highlights", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;

    // --- helpers ---
    const pad = (n) => String(n).padStart(2, "0");
    const toYMD = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

    // "hoy" en timezone de la app (usa tu TZ_OFFSET_MINUTES ya definido arriba)
    const nowUtc = new Date();
    const nowLocal = new Date(nowUtc.getTime() + TZ_OFFSET_MINUTES * 60 * 1000);

    const y = nowLocal.getUTCFullYear();
    const m = nowLocal.getUTCMonth(); // 0-11
    const d = nowLocal.getUTCDate();

    // Rangos en UTC usando tu dateOnlyToUtc (ya existe en tu archivo)
    const startDay = dateOnlyToUtc(toYMD(new Date(Date.UTC(y, m, d))), 0, 0, 0, 0);
    const endDay = dateOnlyToUtc(toYMD(new Date(Date.UTC(y, m, d))), 23, 59, 59, 999);

    const startMonth = dateOnlyToUtc(`${y}-${pad(m + 1)}-01`, 0, 0, 0, 0);
    const lastDayMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const endMonth = dateOnlyToUtc(`${y}-${pad(m + 1)}-${pad(lastDayMonth)}`, 23, 59, 59, 999);

    const startYear = dateOnlyToUtc(`${y}-01-01`, 0, 0, 0, 0);
    const endYear = dateOnlyToUtc(`${y}-12-31`, 23, 59, 59, 999);

    // --- función para calcular totales desde IncomeTransaction (tu fuente “transacciones”) ---
    async function calcTxTotals(start, end) {
      const txs = await IncomeTransaction.find({
        owner,
        fecha: { $gte: start, $lte: end },
      }).lean();

      let ventasBrutas = 0;
      let descuentos = 0;
      let ventasNetas = 0;
      let otrosIngresos = 0;

      for (const t of txs) {
        const cuenta = String(
          t.cuenta_principal_codigo ?? t.cuentaPrincipalCodigo ?? t.cuentaCodigo ?? t.cuenta_codigo ?? ""
        ).trim();

        const total = num(t.montoTotal ?? t.monto_total ?? t.total, 0);
        const desc = num(t.montoDescuento ?? t.monto_descuento ?? t.descuento, 0);
        const neto = num(t.montoNeto ?? t.monto_neto ?? t.neto, Math.max(0, total - Math.max(0, desc)));

        // ventas = 4001
        if (cuenta === "4001") {
          ventasBrutas += total;
          descuentos += Math.max(0, desc);
          ventasNetas += neto;
        } else if (cuenta.startsWith("4") && cuenta !== "4003") {
          // otros ingresos = 4XXX excepto 4001 y 4003
          otrosIngresos += neto;
        }
      }

      return {
        ventasBrutas,
        descuentos,
        ventasNetas,
        otrosIngresos,
        totalIngresos: ventasNetas + otrosIngresos,
      };
    }

    // --- Opción PRO contable: incluir ingresos_directos (JournalEntry) que NO tienen transacción ---
    async function calcDirectTotals(start, end) {
      const entries = await JournalEntry.find({
        owner,
        date: { $gte: start, $lte: end },
        source: { $in: ["ingreso_directo"] },
      }).lean();

      let otrosIngresos = 0;

      for (const e of entries) {
        const lines = Array.isArray(e.lines) ? e.lines : [];
        // tomar líneas de HABER en cuentas 4XXX (ingreso)
        for (const l of lines) {
          const code = String(l.accountCodigo ?? l.accountCode ?? "").trim();
          const haber = num(l.credit ?? l.haber, 0);
          if (haber <= 0) continue;
          if (code.startsWith("4") && code !== "4001" && code !== "4003") {
            otrosIngresos += haber;
          }
        }
      }

      return { otrosIngresos };
    }

    const diaTx = await calcTxTotals(startDay, endDay);
    const mesTx = await calcTxTotals(startMonth, endMonth);
    const anoTx = await calcTxTotals(startYear, endYear);

    const diaDir = await calcDirectTotals(startDay, endDay);
    const mesDir = await calcDirectTotals(startMonth, endMonth);
    const anoDir = await calcDirectTotals(startYear, endYear);

    // sumar directos como "otros ingresos"
    const dia = {
      ...diaTx,
      otrosIngresos: (diaTx.otrosIngresos || 0) + (diaDir.otrosIngresos || 0),
    };
    dia.totalIngresos = (dia.ventasNetas || 0) + (dia.otrosIngresos || 0);

    const mes = {
      ...mesTx,
      otrosIngresos: (mesTx.otrosIngresos || 0) + (mesDir.otrosIngresos || 0),
    };
    mes.totalIngresos = (mes.ventasNetas || 0) + (mes.otrosIngresos || 0);

    const ano = {
      ...anoTx,
      otrosIngresos: (anoTx.otrosIngresos || 0) + (anoDir.otrosIngresos || 0),
    };
    ano.totalIngresos = (ano.ventasNetas || 0) + (ano.otrosIngresos || 0);

    return res.json({
      ok: true,
      data: {
        labels: {
          dia: `${pad(d)}/${pad(m + 1)}/${y}`,
          mes: `${pad(m + 1)}/${y}`,
          ano: `${y}`,
        },
        dia,
        mes,
        ano,
      },
    });
  } catch (err) {
    console.error("GET /api/ingresos/highlights error:", err);
    return res.status(500).json({ ok: false, message: "Error cargando highlights" });
  }
});


module.exports = router;
