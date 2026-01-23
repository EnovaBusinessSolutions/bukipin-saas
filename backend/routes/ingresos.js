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

// ✅ Opcional: modelo de movimientos/transacciones de inventario (para que aparezca en “Resumen de Transacciones”)
let InventoryMovement = null;
try {
  InventoryMovement = require("../models/InventoryMovement");
} catch (_) {
  try {
    InventoryMovement = require("../models/InventoryTransaction");
  } catch (_) {
    try {
      InventoryMovement = require("../models/InventarioMovimiento");
    } catch (_) {
      try {
        InventoryMovement = require("../models/StockMovement");
      } catch (_) {
        try {
          InventoryMovement = require("../models/MovimientoInventario");
        } catch (_) {}
      }
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

/**
 * ✅ num robusto (soporta "$1,200" / "1,200")
 */
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

/**
 * ✅ Mapper JournalEntry → UI (soporta líneas por code o por accountId)
 */
function mapEntryForUI(entry, accountMaps = {}) {
  const nameByCode = accountMaps?.nameByCode || {};
  const codeById = accountMaps?.codeById || {};
  const nameById = accountMaps?.nameById || {};

  const rawLines = entry.lines || entry.detalle_asientos || [];

  const detalle_asientos = (rawLines || []).map((l) => {
    let cuenta_codigo = String(
      l.accountCodigo ??
        l.accountCode ??
        l.cuenta_codigo ??
        l.cuentaCodigo ??
        ""
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
    const asientoFecha = toYMDLocal(e.date ?? e.fecha ?? e.createdAt ?? null);
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
 * ✅ Inventario helpers (E2E real)
 */
function normalizeTipoIngresoInventario(tipoIngresoRaw) {
  const t = lower(tipoIngresoRaw);
  return (
    t === "inventariado" ||
    t === "inventariados" ||
    t === "producto_inventariado" ||
    t === "producto inventariado" ||
    t === "inventario" ||
    t === "stock"
  );
}

function pickQty(body) {
  const q =
    body?.cantidad ??
    body?.qty ??
    body?.quantity ??
    body?.unidades ??
    body?.units ??
    body?.cantidadProducto ??
    body?.cantidad_producto ??
    null;

  const n = num(q, 0);
  return n > 0 ? n : 1;
}

function pickProductId(body) {
  return (
    body?.productId ??
    body?.productoId ??
    body?.product_id ??
    body?.producto_id ??
    body?.itemId ??
    body?.item_id ??
    null
  );
}

/**
 * ✅ NUEVO (CRÍTICO): detectar arrays de productos en la venta.
 * Esto arregla tu caso: vendes 15, pero el backend tomaba qty=1 porque estaba ignorando el array.
 */
function extractSaleItems(body) {
  const candidates = [
    body?.items,
    body?.productos,
    body?.products,
    body?.productosVenta,
    body?.productos_venta,
    body?.productos_en_venta,
    body?.lineItems,
    body?.line_items,
    body?.detalleProductos,
    body?.detalle_productos,
    body?.detalles,
  ];

  const arr = candidates.find((v) => Array.isArray(v)) || null;
  if (!arr) return [];

  const out = [];
  for (const it of arr) {
    if (!it || typeof it !== "object") continue;

    const pid =
      it.productId ??
      it.product_id ??
      it.productoId ??
      it.producto_id ??
      it.itemId ??
      it.item_id ??
      it._id ??
      it.id ??
      null;

    const qty = num(
      it.cantidad ??
        it.qty ??
        it.quantity ??
        it.unidades ??
        it.units ??
        it.cant ??
        it.cantidadVender ??
        it.cantidad_vender ??
        it.cantidad_producto ??
        0,
      0
    );

    // si no hay pid o qty válido, lo ignoramos
    if (!pid) continue;

    out.push({
      raw: it,
      productId: pid,
      qty: qty > 0 ? qty : 1,
      // hints para inventariado
      tipo: it.tipo ?? it.tipoIngreso ?? it.tipo_ingreso ?? it.tipoProducto ?? it.productoTipo ?? null,
      isInventariado:
        it.isInventariado === true ||
        it.forceInventario === true ||
        normalizeTipoIngresoInventario(it.tipo ?? it.tipoIngreso ?? it.tipoProducto ?? it.productoTipo ?? ""),
    });
  }

  return out;
}

/**
 * ✅ NUEVO (CRÍTICO): leer costo desde “cualquier objeto” (item o body)
 */
function getCostFromAny(obj, qty) {
  const q = Math.max(1, num(qty, 1));

  const costTotalRaw =
    obj?.costoTotal ??
    obj?.costo_total ??
    obj?.costTotal ??
    obj?.cost_total ??
    obj?.totalCosto ??
    obj?.total_costo ??
    null;

  const costTotal = num(costTotalRaw, 0);
  if (costTotal > 0) {
    const costUnit = Number((costTotal / q).toFixed(6));
    return { costUnit, costTotal };
  }

  const costUnitRaw =
    obj?.costoUnitario ??
    obj?.costo_unitario ??
    obj?.costUnitario ??
    obj?.cost_unitario ??
    obj?.unitCost ??
    obj?.unit_cost ??
    obj?.costoCompra ??
    obj?.costo_compra ??
    obj?.purchaseCost ??
    obj?.purchase_cost ??
    null;

  const costUnit = num(costUnitRaw, 0);
  if (costUnit > 0) {
    return { costUnit, costTotal: Number((costUnit * q).toFixed(2)) };
  }

  return { costUnit: 0, costTotal: 0 };
}

/**
 * ✅ ACTUALIZADO (CRÍTICO): detectar costo unitario del producto en MUCHAS variantes
 */
function getProductCostUnit(p) {
  if (!p) return 0;

  const candidates = [
    p.costoUnitario,
    p.costo_unitario,
    p.costUnitario,
    p.cost_unitario,
    p.costoPromedio,
    p.costo_promedio,
    p.costoPromedioPonderado,
    p.costo_promedio_ponderado,
    p.costo,
    p.cost,
    p.precioCompra,
    p.precio_compra,
    p.purchasePrice,
    p.purchase_price,

    p.costoDeCompra,
    p.costo_de_compra,
    p.costoCompra,
    p.costo_compra,
    p.costPrice,
    p.cost_price,
    p.unitCost,
    p.unit_cost,
    p.unit_cost_price,
    p.lastCost,
    p.last_cost,
    p.ultimoCosto,
    p.ultimo_costo,
    p.ultimoCostoUnitario,
    p.ultimo_costo_unitario,

    p.costoProm,
    p.costo_prom,
    p.avgCost,
    p.avg_cost,
    p.averageCost,
    p.average_cost,
  ];

  for (const v of candidates) {
    const n = num(v, NaN);
    if (Number.isFinite(n) && n > 0) return n;
  }

  const nested = [
    p.costos?.unitario,
    p.costos?.costoUnitario,
    p.costos?.costo_unitario,
    p.costs?.unit,
    p.costs?.unit_cost,
    p.pricing?.cost,
    p.pricing?.unitCost,
  ];

  for (const v of nested) {
    const n = num(v, NaN);
    if (Number.isFinite(n) && n > 0) return n;
  }

  return 0;
}

function getProductName(p) {
  return p?.nombre ?? p?.name ?? p?.title ?? p?.producto ?? p?.descripcion ?? "Producto";
}

// ✅ Elegir SOLO una llave de stock (evita decrementar varias a la vez)
function pickStockKey(productDoc) {
  const candidates = [
    "stock",
    "stockActual",
    "stock_actual",
    "existencia",
    "existencias",
    "cantidad",
    "cantidad_actual",
    "cantidadActual",
  ];
  for (const k of candidates) {
    if (Object.prototype.hasOwnProperty.call(productDoc || {}, k)) return k;
  }
  return "stock";
}

/**
 * ✅ NUEVO: si el producto no trae costo, intentamos tomarlo del último movimiento ENTRADA/COMPRA.
 */
async function getCostUnitFromLastEntrada(owner, productIdRaw) {
  if (!InventoryMovement) return 0;
  if (!productIdRaw) return 0;

  const pidStr = String(productIdRaw).trim();
  const pidObj = isObjectId(pidStr) ? new mongoose.Types.ObjectId(pidStr) : null;

  const or = [];
  if (pidObj) {
    or.push(
      { productId: pidObj },
      { productoId: pidObj },
      { product_id: pidObj },
      { producto_id: pidObj },
      { product: pidObj },
      { producto: pidObj }
    );
  }
  or.push(
    { productId: pidStr },
    { productoId: pidStr },
    { product_id: pidStr },
    { producto_id: pidStr }
  );

  const rows = await InventoryMovement.find({
    owner,
    cancelado: { $ne: true },
    $or: or,
  })
    .select(
      "tipo tipo_movimiento tipoMovimiento estado status createdAt fecha date costoUnitario costo_unitario costoTotal costo_total cantidad qty quantity"
    )
    .sort({ date: -1, fecha: -1, createdAt: -1 })
    .lean()
    .catch(() => []);

  for (const r of rows || []) {
    const tipo = lower(r.tipo ?? r.tipo_movimiento ?? r.tipoMovimiento ?? "");
    const estado = lower(r.estado ?? r.status ?? "activo");
    if (estado === "cancelado") continue;
    if (!["entrada", "compra", "ajuste_entrada", "ingreso"].includes(tipo)) continue;

    const cu = num(r.costoUnitario ?? r.costo_unitario, 0);
    if (cu > 0) return cu;

    const ct = num(r.costoTotal ?? r.costo_total, 0);
    const q = num(r.cantidad ?? r.qty ?? r.quantity, 0);
    if (ct > 0 && q > 0) return Number((ct / q).toFixed(6));
  }

  return 0;
}

/**
 * ✅ NUEVO: calcular stock REAL por movimientos (entradas - salidas).
 */
async function getStockByMovements(owner, productIdRaw) {
  if (!InventoryMovement) return null;
  if (!productIdRaw) return null;

  const pidStr = String(productIdRaw).trim();
  const pidObj = isObjectId(pidStr) ? new mongoose.Types.ObjectId(pidStr) : null;

  const or = [];
  if (pidObj) {
    or.push(
      { productId: pidObj },
      { productoId: pidObj },
      { product_id: pidObj },
      { producto_id: pidObj },
      { product: pidObj },
      { producto: pidObj }
    );
  }
  or.push(
    { productId: pidStr },
    { productoId: pidStr },
    { product_id: pidStr },
    { producto_id: pidStr }
  );

  const match = {
    owner,
    cancelado: { $ne: true },
    $or: or,
  };

  const rows = await InventoryMovement.aggregate([
    { $match: match },
    {
      $project: {
        tipo: {
          $toLower: {
            $ifNull: ["$tipo", { $ifNull: ["$tipo_movimiento", { $ifNull: ["$tipoMovimiento", ""] }] }],
          },
        },
        cantidad: {
          $toDouble: { $ifNull: ["$cantidad", { $ifNull: ["$qty", { $ifNull: ["$quantity", 0] }] }] },
        },
        estado: { $toLower: { $ifNull: ["$estado", { $ifNull: ["$status", "activo"] }] } },
      },
    },
    { $match: { estado: { $ne: "cancelado" } } },
    {
      $group: {
        _id: null,
        entradas: {
          $sum: {
            $cond: [
              { $in: ["$tipo", ["entrada", "compra", "ajuste_entrada", "ingreso"]] },
              "$cantidad",
              0,
            ],
          },
        },
        salidas: {
          $sum: {
            $cond: [
              { $in: ["$tipo", ["salida", "venta", "ajuste_salida", "egreso"]] },
              "$cantidad",
              0,
            ],
          },
        },
      },
    },
  ]);

  const entradas = num(rows?.[0]?.entradas, 0);
  const salidas = num(rows?.[0]?.salidas, 0);
  const stock = Number((entradas - salidas).toFixed(6));
  return Number.isFinite(stock) ? stock : 0;
}

/**
 * ✅ NUEVO: sincronizar campo stock del producto (best-effort)
 */
async function syncProductStockBestEffort(owner, productId, stockKey, newStock) {
  if (!Product || !productId || !stockKey) return;
  const n = num(newStock, null);
  if (n === null) return;

  try {
    await Product.updateOne(
      { owner, _id: new mongoose.Types.ObjectId(String(productId)) },
      { $set: { [stockKey]: n } }
    ).catch(() => {});
  } catch (_) {}
}

async function updateProductStockAtomic(owner, productId, stockKey, qtyToDecrement) {
  if (!Product || !productId || !stockKey || !qtyToDecrement) return { ok: false };

  const inc = { [stockKey]: -qtyToDecrement };
  const bumpCandidates = ["totalVendido", "total_vendido", "totalUsadoVendido", "total_usado_vendido"];
  for (const k of bumpCandidates) {
    inc[k] = (inc[k] || 0) + qtyToDecrement;
    break;
  }

  const r = await Product.updateOne(
    {
      owner,
      _id: new mongoose.Types.ObjectId(String(productId)),
      [stockKey]: { $gte: qtyToDecrement },
    },
    { $inc: inc }
  ).catch(() => null);

  const matched = r?.matchedCount ?? r?.n ?? 0;
  if (!matched) return { ok: false };
  return { ok: true };
}

async function createInventorySalidaIfPossible(owner, payload) {
  if (!InventoryMovement) return null;
  try {
    const doc = await InventoryMovement.create(payload);
    return doc;
  } catch (e) {
    console.warn("⚠️ InventoryMovement.create falló (no bloqueante):", e?.message || e);
    return null;
  }
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

    const asientos = entries.map((e) => mapEntryForUI(e, accountMaps));
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

    const accountMaps = await buildAccountMaps(owner, entries);
    const detalles = flattenDetalles(entries, accountMaps);

    const itemsRaw = await IncomeTransaction.find({
      owner,
      fecha: { $gte: start, $lte: end },
    })
      .sort({ fecha: -1, createdAt: -1 })
      .lean();

    let items = itemsRaw.map(mapTxForUI);

    items = await attachAccountInfo(owner, items);
    items = await attachSubcuentaFromProduct(owner, items);
    items = await attachSubcuentaInfo(owner, items);
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

    const accountMaps = await buildAccountMaps(owner, entries);
    const asientos = entries.map((e) => mapEntryForUI(e, accountMaps));

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

    // opcional: cancelar movimientos de inventario ligados a este ingreso
    if (InventoryMovement) {
      await InventoryMovement.deleteMany({
        owner,
        $or: [
          { source: "ingreso", sourceId: tx._id },
          { source: "venta", sourceId: tx._id },
          { source: "ingreso", transaccion_ingreso_id: tx._id },
        ],
      }).catch(() => {});
    }

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
    const tipoIngreso = String(req.body?.tipoIngreso || "general").trim();
    const descripcion = String(req.body?.descripcion || "Ingreso").trim();

    const total = num(req.body?.montoTotal ?? req.body?.total, 0);
    const descuento = num(req.body?.montoDescuento ?? req.body?.descuento, 0);
    const neto = Math.max(0, total - Math.max(0, descuento));

    const metodoPago = normalizeMetodoPago(req.body?.metodoPago);
    const tipoPago = normalizeTipoPago(req.body?.tipoPago);

    const cuentaCodigo = String(
      req.body?.cuentaCodigo || req.body?.cuentaPrincipalCodigo || "4001"
    ).trim();

    // ✅ subcuenta puede venir por body (NO la inferimos por producto si hay varios)
    let subcuentaRef =
      req.body?.subcuentaId ??
      req.body?.subcuenta_id ??
      req.body?.subcuentaCodigo ??
      req.body?.subcuenta_codigo ??
      null;

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

    // ✅ Inventario
    const COD_COGS = "5002";
    const COD_INVENTARIO = "1005";

    /**
     * ============================
     * ✅ FIX PRINCIPAL:
     * Detectar productos vendidos desde arrays (items/productos/...)
     * ============================
     */
    const saleItems = extractSaleItems(req.body);

    // fallback legacy (1 producto suelto)
    const legacyProductId = pickProductId(req.body);
    const legacyQty = pickQty(req.body);

    const hasArrayItems = saleItems.length > 0;

    // inventariado: por tipoIngreso, flags, o porque trae array de productos inventariados
    const isInventariado =
      normalizeTipoIngresoInventario(tipoIngreso) ||
      lower(req.body?.tipoProducto) === "inventariado" ||
      lower(req.body?.productoTipo) === "inventariado" ||
      req.body?.isInventariado === true ||
      req.body?.forceInventario === true ||
      (hasArrayItems && saleItems.some((x) => x.isInventariado === true));

    // Meta inventario por cada item
    const invItemsMeta = []; // [{ productIdStr, productIdObj, productName, qty, costUnit, costTotal, stockKey, stockBefore, stockAfter, stockSource, raw }]
    let totalQty = 0;

    if (isInventariado) {
      if (!Product) {
        return res.status(400).json({
          ok: false,
          message: "No existe modelo Product activo; no puedo procesar inventario.",
        });
      }

      const itemsToProcess = hasArrayItems
        ? saleItems
        : legacyProductId
          ? [{ productId: legacyProductId, qty: legacyQty, raw: req.body, isInventariado: true }]
          : [];

      if (!itemsToProcess.length) {
        return res.status(400).json({
          ok: false,
          message: "Para ventas inventariadas se requiere al menos un producto (items/productId).",
        });
      }

      // Validación + cálculo por producto
      for (const it of itemsToProcess) {
        const productIdRaw = it.productId;
        const qty = Math.max(1, num(it.qty, 1));
        totalQty += qty;

        if (!productIdRaw || !isObjectId(productIdRaw)) {
          return res.status(400).json({
            ok: false,
            message: "Para ventas inventariadas se requiere productId válido en cada item.",
          });
        }

        const productDoc = await Product.findOne({
          owner,
          _id: new mongoose.Types.ObjectId(String(productIdRaw)),
        }).lean();

        if (!productDoc) {
          return res.status(404).json({ ok: false, message: "Producto inventariado no encontrado." });
        }

        const stockKey = pickStockKey(productDoc);

        const stockByMov = await getStockByMovements(owner, productDoc._id);
        const hasMovStock = typeof stockByMov === "number";
        const stockByField = num(productDoc?.[stockKey], 0);

        const stock = hasMovStock ? stockByMov : stockByField;
        const stockSource = hasMovStock ? "movements" : "product_field";

        if (stock < qty) {
          return res.status(400).json({
            ok: false,
            message: `Stock insuficiente para "${getProductName(productDoc)}". Stock actual: ${stock}. Requerido: ${qty}.`,
            code: "STOCK_INSUFICIENTE",
            meta: { stockSource, stockKey, stockByMov, stockByField, productId: String(productDoc._id) },
          });
        }

        // costo: 1) desde item, 2) desde body, 3) desde Product, 4) desde último movimiento ENTRADA
        const fromItem = getCostFromAny(it.raw, qty);
        const fromBody = getCostFromAny(req.body, qty);

        let costUnit = num(fromItem.costUnit, 0) || num(fromBody.costUnit, 0);
        let costTotal = num(fromItem.costTotal, 0) || num(fromBody.costTotal, 0);

        if (!(costUnit > 0) && !(costTotal > 0)) {
          costUnit = num(getProductCostUnit(productDoc), 0);
          costTotal = costUnit > 0 ? Number((costUnit * qty).toFixed(2)) : 0;
        }

        if (!(costUnit > 0) && !(costTotal > 0)) {
          const cuMov = await getCostUnitFromLastEntrada(owner, productDoc._id);
          if (cuMov > 0) {
            costUnit = cuMov;
            costTotal = Number((costUnit * qty).toFixed(2));
          }
        }

        // si el stock viene de movimientos, sincronizamos best-effort el campo del producto para UI
        if (stockSource === "movements") {
          await syncProductStockBestEffort(owner, String(productDoc._id), stockKey, stock);
        }

        invItemsMeta.push({
          raw: it.raw,
          productIdStr: String(productDoc._id),
          productIdObj: new mongoose.Types.ObjectId(String(productDoc._id)),
          productName: getProductName(productDoc),
          qty,
          costUnit: num(costUnit, 0),
          costTotal: num(costTotal, 0),
          stockKey,
          stockBefore: stock,
          stockAfter: Number((stock - qty).toFixed(6)),
          stockSource,
        });
      }
    }

    // ✅ resolver subcuenta a id+code (solo para la línea de ingresos)
    const { id: subcuentaIdResolved, code: subcuentaCodigoResolved } = await resolveAccountFromRef(
      owner,
      subcuentaRef
    );

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

      subcuentaId: subcuentaIdResolved ?? null,
      subcuenta_id: subcuentaIdResolved ?? null,
      subcuentaCodigo: subcuentaCodigoResolved ?? null,
      subcuenta_codigo: subcuentaCodigoResolved ?? null,

      // compat legacy
      productId: legacyProductId ?? (invItemsMeta?.[0]?.productIdStr ?? null),
      product_id: legacyProductId ?? (invItemsMeta?.[0]?.productIdStr ?? null),

      // qty total (si hubo varios productos)
      cantidad: hasArrayItems ? totalQty : legacyQty,
      qty: hasArrayItems ? totalQty : legacyQty,
      unidades: hasArrayItems ? totalQty : legacyQty,

      // guardamos items para trazabilidad (no rompe mongo aunque el schema no lo tenga)
      items: invItemsMeta.map((x) => ({
        productId: x.productIdStr,
        productName: x.productName,
        qty: x.qty,
        costUnit: x.costUnit,
        costTotal: x.costTotal,
      })),

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

    // ✅ Creamos tx
    tx = await IncomeTransaction.create(txPayload);

    /**
     * ✅ STOCK UPDATE (pre-commit seguro para product_field):
     * Si algún producto usa stock por campo, descontamos en forma atómica.
     * Si falla uno, revertimos best-effort los anteriores y abortamos.
     */
    const decremented = [];
    for (const meta of invItemsMeta) {
      if (meta.stockSource !== "product_field") continue;

      const ok = await updateProductStockAtomic(owner, meta.productIdStr, meta.stockKey, meta.qty);
      if (!ok?.ok) {
        // revertimos lo que sí descontamos
        for (const prev of decremented) {
          try {
            await Product.updateOne(
              { owner, _id: new mongoose.Types.ObjectId(prev.productIdStr) },
              { $inc: { [prev.stockKey]: prev.qty } }
            ).catch(() => {});
          } catch (_) {}
        }

        await IncomeTransaction.deleteOne({ _id: tx._id, owner }).catch(() => {});
        return res.status(400).json({
          ok: false,
          message: "No se pudo actualizar el stock (posible carrera / stock insuficiente). Intenta de nuevo.",
        });
      }

      decremented.push(meta);
    }

    // ✅ Asiento contable
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
    }

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

    /**
     * ✅ INVENTARIO (por producto)
     *   - Debe 5002 (costo de venta)
     *   - Haber 1005 (salida inventario)
     *
     * Aquí está la clave: si vendes 15, el costo total será costoUnit * 15.
     */
    if (invItemsMeta.length) {
      for (const meta of invItemsMeta) {
        const costTotalSafe = num(meta.costTotal, 0);

        lines.push(
          await buildLine(owner, {
            code: COD_COGS,
            debit: costTotalSafe,
            credit: 0,
            memo:
              costTotalSafe > 0
                ? `Costo de venta - ${meta.productName} (${meta.qty} unidades)`
                : `Costo de venta - ${meta.productName} (SIN COSTO CONFIGURADO)`,
          })
        );

        lines.push(
          await buildLine(owner, {
            code: COD_INVENTARIO,
            debit: 0,
            credit: costTotalSafe,
            memo:
              costTotalSafe > 0
                ? `Salida de inventario - ${meta.productName} (${meta.qty} unidades)`
                : `Salida de inventario - ${meta.productName} (SIN COSTO CONFIGURADO)`,
          })
        );
      }
    }

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

    // espejo en la tx
    try {
      tx.asientoId = tx.asientoId ?? entry._id;
      tx.asiento_id = tx.asiento_id ?? entry._id;
      tx.journalEntryId = tx.journalEntryId ?? entry._id;
      tx.journal_entry_id = tx.journal_entry_id ?? entry._id;

      tx.numeroAsiento = tx.numeroAsiento ?? numeroAsiento;
      tx.numero_asiento = tx.numero_asiento ?? numeroAsiento;

      await tx.save().catch(() => {});
    } catch (_) {}

    /**
     * ✅ Si el stock viene de movimientos, sincronizamos el campo stock para UI (best-effort)
     */
    for (const meta of invItemsMeta) {
      if (meta.stockSource === "movements") {
        await syncProductStockBestEffort(owner, meta.productIdStr, meta.stockKey, meta.stockAfter);
      }
    }

    /**
     * ✅ crear movimientos de inventario “SALIDA” (uno por producto)
     */
    for (const meta of invItemsMeta) {
      await createInventorySalidaIfPossible(owner, {
        owner,
        fecha: tx.fecha,
        date: tx.fecha,

        source: "ingreso",
        sourceId: tx._id,
        transaccion_ingreso_id: tx._id,

        journalEntryId: entry._id,
        journal_entry_id: entry._id,
        asientoId: entry._id,
        asiento_id: entry._id,

        numeroAsiento,
        numero_asiento: numeroAsiento,

        productId: meta.productIdObj,
        productoId: meta.productIdObj,
        product_id: meta.productIdObj,
        producto_id: meta.productIdObj,

        producto: meta.productName,
        productName: meta.productName,

        tipo: "salida",
        tipoMovimiento: "salida",
        tipo_movimiento: "salida",
        motivo: "venta",
        concept: `Venta: ${tx.descripcion}`,

        cantidad: meta.qty,
        qty: meta.qty,
        costoUnitario: meta.costUnit,
        costo_unitario: meta.costUnit,
        costoTotal: meta.costTotal,
        costo_total: meta.costTotal,

        descripcion: tx.descripcion,
        memo: tx.descripcion,

        estado: "activo",
        status: "activo",
      });
    }

    const accountMaps = await buildAccountMaps(owner, [entry]);
    const asiento = mapEntryForUI(entry, accountMaps);

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
        inventario: invItemsMeta.length ? invItemsMeta : null,
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
 */
router.get("/highlights", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;

    const pad = (n) => String(n).padStart(2, "0");
    const toYMD = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

    const nowUtc = new Date();
    const nowLocal = new Date(nowUtc.getTime() + TZ_OFFSET_MINUTES * 60 * 1000);

    const y = nowLocal.getUTCFullYear();
    const m = nowLocal.getUTCMonth();
    const d = nowLocal.getUTCDate();

    const startDay = dateOnlyToUtc(toYMD(new Date(Date.UTC(y, m, d))), 0, 0, 0, 0);
    const endDay = dateOnlyToUtc(toYMD(new Date(Date.UTC(y, m, d))), 23, 59, 59, 999);

    const startMonth = dateOnlyToUtc(`${y}-${pad(m + 1)}-01`, 0, 0, 0, 0);
    const lastDayMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const endMonth = dateOnlyToUtc(`${y}-${pad(m + 1)}-${pad(lastDayMonth)}`, 23, 59, 59, 999);

    const startYear = dateOnlyToUtc(`${y}-01-01`, 0, 0, 0, 0);
    const endYear = dateOnlyToUtc(`${y}-12-31`, 23, 59, 59, 999);

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
          t.cuenta_principal_codigo ??
            t.cuentaPrincipalCodigo ??
            t.cuentaCodigo ??
            t.cuenta_codigo ??
            ""
        ).trim();

        const total = num(t.montoTotal ?? t.monto_total ?? t.total, 0);
        const desc = num(t.montoDescuento ?? t.monto_descuento ?? t.descuento, 0);
        const neto = num(
          t.montoNeto ?? t.monto_neto ?? t.neto,
          Math.max(0, total - Math.max(0, desc))
        );

        if (cuenta === "4001") {
          ventasBrutas += total;
          descuentos += Math.max(0, desc);
          ventasNetas += neto;
        } else if (cuenta.startsWith("4") && cuenta !== "4003") {
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

    async function calcDirectTotals(start, end) {
      const entries = await JournalEntry.find({
        owner,
        date: { $gte: start, $lte: end },
        source: { $in: ["ingreso_directo"] },
      }).lean();

      let otrosIngresos = 0;

      for (const e of entries) {
        const lines = Array.isArray(e.lines) ? e.lines : [];
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
