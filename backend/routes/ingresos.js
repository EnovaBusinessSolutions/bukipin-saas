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

function parseStartDate(s) {
  if (!s) return null;
  const str = String(s).trim();
  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(str);
  const d = new Date(isDateOnly ? `${str}T00:00:00` : str);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseEndDate(s) {
  if (!s) return null;
  const str = String(s).trim();
  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(str);
  const d = new Date(isDateOnly ? `${str}T23:59:59.999` : str);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseTxDate(s) {
  if (!s) return null;
  const str = String(s).trim();
  if (!str) return null;
  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(str);
  const d = new Date(isDateOnly ? `${str}T00:00:00` : str);
  return Number.isNaN(d.getTime()) ? null : d;
}

function num(v, def = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function toYMD(d) {
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return null;
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const day = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
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
 * ======= ENRIQUECIMIENTOS (clave para que el modal se vea como Bukipin 2) =======
 */

async function getAccountNameMap(owner, codes) {
  const unique = Array.from(
    new Set((codes || []).filter(Boolean).map((c) => String(c).trim()))
  );
  if (!unique.length) return {};

  const rows = await Account.find({ owner, code: { $in: unique } })
    .select("code name nombre")
    .lean();

  const map = {};
  for (const r of rows) {
    map[String(r.code)] = r.name ?? r.nombre ?? "";
  }
  return map;
}

async function attachAccountInfo(owner, items) {
  if (!items?.length) return items;

  const codes = items
    .map((it) => it.cuenta_codigo ?? it.cuentaCodigo ?? it.cuentaPrincipalCodigo ?? null)
    .filter(Boolean)
    .map(String);

  const accountNameMap = await getAccountNameMap(owner, codes);

  return items.map((it) => {
    const code = String(it.cuenta_codigo ?? it.cuentaCodigo ?? it.cuentaPrincipalCodigo ?? "").trim();
    if (!code) return it;

    const nombre = accountNameMap[code] || it.cuenta_nombre || it.cuentaName || null;
    const display = nombre ? `${code} - ${nombre}` : code;

    return {
      ...it,
      cuenta_codigo: it.cuenta_codigo ?? code,
      cuenta_nombre: it.cuenta_nombre ?? nombre,

      // Aliases para UI/legacy (por si los usa)
      cuenta_principal_codigo: it.cuenta_principal_codigo ?? code,
      cuenta_principal_nombre: it.cuenta_principal_nombre ?? nombre,
      cuenta_principal: it.cuenta_principal ?? display,
      cuentaPrincipal: it.cuentaPrincipal ?? display,
    };
  });
}

/**
 * ✅ Enriquecer transacciones con datos del cliente (para el modal)
 */
async function attachClientInfo(owner, items) {
  if (!Client || !items?.length) return items;

  const ids = Array.from(
    new Set(
      items
        .map((it) => it.clienteId || it.clientId || it.cliente_id || it.clienteID)
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
      it.clienteId || it.clientId || it.cliente_id || it.clienteID || "";
    const cid = cidRaw ? String(cidRaw) : "";
    const c = cid ? map.get(cid) : null;
    if (!c) return it;

    return {
      ...it,
      // Campos que tu UI espera para el modal:
      cliente_nombre: it.cliente_nombre ?? c.nombre,
      cliente_email: it.cliente_email ?? c.email,
      cliente_telefono: it.cliente_telefono ?? c.telefono,
      cliente_rfc: it.cliente_rfc ?? c.rfc,
    };
  });
}

/**
 * ✅ Mapeo compat para UI Lovable (transacciones)
 */
function mapTxForUI(tx) {
  const fecha = tx.fecha ? new Date(tx.fecha) : null;
  const saldoPendiente = tx.saldoPendiente ?? tx.saldo_pendiente ?? 0;

  const cuentaCodigo = tx.cuentaCodigo ?? tx.cuenta_codigo ?? tx.cuentaPrincipalCodigo ?? null;

  return {
    ...tx,
    id: tx._id ? String(tx._id) : tx.id,

    // fecha
    fecha,
    fecha_ymd: fecha ? toYMD(fecha) : null,

    // montos (aliases)
    monto_total: tx.montoTotal ?? tx.monto_total ?? 0,
    monto_descuento: tx.montoDescuento ?? tx.monto_descuento ?? 0,
    monto_neto: tx.montoNeto ?? tx.monto_neto ?? 0,
    monto_pagado: tx.montoPagado ?? tx.monto_pagado ?? 0,

    // UI usa monto_pendiente
    monto_pendiente: tx.monto_pendiente ?? saldoPendiente,
    saldo_pendiente: saldoPendiente,

    // pagos
    metodo_pago: tx.metodoPago ?? tx.metodo_pago ?? null,
    tipo_pago: tx.tipoPago ?? tx.tipo_pago ?? null,

    // cuenta
    cuenta_codigo: cuentaCodigo ?? null,

    // cliente (si viene enriquecido)
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
  const acc = await Account.findOne({ owner, code: String(code).trim() })
    .select("_id code name")
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
        `No existe la cuenta contable con code="${String(code).trim()}" para este usuario. Asegúrate de que el seed la haya creado.`
      );
      err.statusCode = 400;
      throw err;
    }
    return { ...base, accountId: id };
  }

  return { ...base, accountCodigo: String(code).trim() };
}

/**
 * ✅ Mapeo del asiento (para UI)
 * IMPORTANTE: RegistroIngresos.tsx pinta:
 * - currentAsientos.descripcion
 * - currentAsientos.detalles[] = { cuenta_codigo, cuenta_nombre, descripcion, debe, haber }
 */
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

    asiento_fecha: toYMD(entry.date),
    fecha: entry.date,

    // ✅ la UI usa "descripcion"
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

/**
 * Aplanar asientos (analítica)
 */
function flattenDetalles(entries) {
  const detalles = [];
  for (const e of entries) {
    const asientoFecha = toYMD(e.date);
    for (const l of e.lines || []) {
      detalles.push({
        cuenta_codigo: l.accountCodigo ?? l.accountCode ?? null,
        debe: num(l.debit, 0),
        haber: num(l.credit, 0),
        asiento_fecha: asientoFecha,
        asiento_id: String(e._id),
        concepto: e.concept ?? "",
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

    // ✅ accountNameMap para cuenta_nombre en cada línea
    const allCodes = entries
      .flatMap((e) => (e.lines || []).map((l) => l.accountCodigo ?? l.accountCode ?? null))
      .filter(Boolean)
      .map(String);

    const accountNameMap = await getAccountNameMap(owner, allCodes);
    const asientos = entries.map((e) => mapEntryForUI(e, accountNameMap));

    return res.json({ ok: true, data: { asientos }, asientos });
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

    // ✅ 1) cuenta con nombre (para "Cuenta principal")
    items = await attachAccountInfo(owner, items);

    // ✅ 2) cliente (para el modal)
    items = await attachClientInfo(owner, items);

    const total = itemsRaw.reduce(
      (acc, it) => acc + num(it.montoNeto ?? it.montoTotal ?? 0),
      0
    );

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

    const subcuentaId = req.body?.subcuentaId ?? null;

    let fecha = req.body?.fecha ? parseTxDate(req.body.fecha) : new Date();
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
    const COD_CLIENTES = "1101";
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
      subcuentaId,
      saldoPendiente,
    };

    const clienteId = req.body?.clienteId ?? req.body?.clientId ?? req.body?.cliente_id ?? null;
    if (clienteId) txPayload.clienteId = clienteId;

    tx = await IncomeTransaction.create(txPayload);

    const lines = [];

    if (descuento > 0) {
      lines.push(
        await buildLine(owner, { code: COD_DESCUENTOS, debit: descuento, credit: 0, memo: "Descuento" })
      );
    }

    if (tipoPago === "contado") {
      lines.push(
        await buildLine(owner, { code: codCobro, debit: neto, credit: 0, memo: "Cobro contado" })
      );
    } else {
      if (montoPagado > 0) {
        lines.push(
          await buildLine(owner, { code: codCobro, debit: montoPagado, credit: 0, memo: "Cobro" })
        );
      }
      if (saldoPendiente > 0) {
        lines.push(
          await buildLine(owner, { code: COD_CLIENTES, debit: saldoPendiente, credit: 0, memo: "Saldo pendiente" })
        );
      }
    }

    const haberIngresos = descuento > 0 ? total : neto;
    lines.push(
      await buildLine(owner, { code: cuentaCodigo, debit: 0, credit: haberIngresos, memo: "Ingreso" })
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

    // ✅ Asiento enriquecido con cuenta_nombre
    const entryCodes = (entry.lines || [])
      .map((l) => l.accountCodigo ?? l.accountCode ?? null)
      .filter(Boolean)
      .map(String);

    const accountNameMap = await getAccountNameMap(owner, entryCodes);
    const asiento = mapEntryForUI(entry, accountNameMap);

    // ✅ Transacción enriquecida con cliente + cuenta para el modal
    let txUI = mapTxForUI(tx.toObject ? tx.toObject() : tx);
    txUI = (await attachAccountInfo(owner, [txUI]))[0];
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

module.exports = router;
