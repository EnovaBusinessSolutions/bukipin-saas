// backend/routes/impuestos.js
const express = require("express");
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");

const ensureAuth = require("../middleware/ensureAuth");
const TaxAuthority = require("../models/TaxAuthority");
const TaxISRRecord = require("../models/TaxISRRecord");
const JournalEntry = require("../models/JournalEntry");
const Account = require("../models/Account");

let Counter = null;
try {
  Counter = require("../models/Counter");
} catch (_) {}

const router = express.Router();

function asTrim(v, def = "") {
  if (v === undefined || v === null) return def;
  return String(v).trim();
}

function toNum(v, def = 0) {
  const n = Number(String(v ?? "").replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : def;
}

function toInt(v, def = 0) {
  const n = Math.trunc(toNum(v, def));
  return Number.isFinite(n) ? n : def;
}

function asDateOrNull(v) {
  if (!v) return null;
  const s = String(v).trim();
  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(s);
  const d = new Date(isDateOnly ? `${s}T00:00:00` : s);
  return Number.isNaN(d.getTime()) ? null : d;
}

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

function toYMD(v) {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function isObjectId(v) {
  return !!v && mongoose.Types.ObjectId.isValid(String(v));
}

function normalizeTipoPago(v) {
  const s = asTrim(v).toLowerCase();
  if (["total", "contado"].includes(s)) return "total";
  if (s === "parcial") return "parcial";
  if (["credito", "crédito"].includes(s)) return "credito";
  return "";
}

function normalizeMetodoPago(v) {
  const s = asTrim(v).toLowerCase();
  if (s === "transferencia") return "transferencia";
  if (s === "efectivo") return "efectivo";
  return "";
}

function formatAuthority(doc) {
  if (!doc) return null;
  const row = typeof doc.toJSON === "function" ? doc.toJSON() : doc;

  return {
    id: row.id ? String(row.id) : String(row._id || ""),
    nombre: asTrim(row.nombre),
    rfc: asTrim(row.rfc),
    logo_url: asTrim(row.logo_url || row.logoUrl),
    pais: asTrim(row.pais, "México"),
    telefono: asTrim(row.telefono),
    email: asTrim(row.email),
    sitio_web: asTrim(row.sitio_web || row.sitioWeb),
    direccion: asTrim(row.direccion),
    cuenta_bancaria: asTrim(row.cuenta_bancaria || row.cuentaBancaria),
    notas: asTrim(row.notas),
    createdAt: row.createdAt || row.created_at || null,
    updatedAt: row.updatedAt || row.updated_at || null,
  };
}

function formatTaxRecord(doc) {
  if (!doc) return null;
  const row = typeof doc.toJSON === "function" ? doc.toJSON() : doc;

  const isrReal = toNum(row.isr_real ?? row.isrRealTotal, 0);
  const montoPagado = toNum(row.monto_pagado ?? row.montoPagado, 0);
  const saldoPendiente = toNum(row.saldo_pendiente ?? row.saldoPendiente ?? row.monto_pendiente, 0);
  const tipoPago = normalizeTipoPago(row.tipo_pago ?? row.tipoPago);

  return {
    id: row.id ? String(row.id) : String(row._id || ""),
    mes: toInt(row.mes, 0),
    ano: toInt(row.ano, 0),

    utilidad_antes_impuestos: toNum(row.utilidad_antes_impuestos ?? row.utilidadAntesImpuestos, 0),
    tasa_isr: toNum(row.tasa_isr ?? row.tasaISR, 0),
    isr_calculado: toNum(row.isr_calculado ?? row.isrCalculado, 0),
    isr_real: isrReal,
    isr_real_total: isrReal,

    tipo_pago: tipoPago,
    metodo_pago: asTrim(row.metodo_pago ?? row.metodoPago) || null,
    monto_pagado: montoPagado,
    monto_pendiente: saldoPendiente,
    saldo_pendiente: saldoPendiente,

    fecha_vencimiento: row.fecha_vencimiento || (row.fechaVencimiento ? toYMD(row.fechaVencimiento) : null),
    autoridad_id: row.autoridad_id ? String(row.autoridad_id) : row.autoridadId ? String(row.autoridadId) : null,
    autoridad_nombre: asTrim(row.autoridad_nombre ?? row.autoridadNombreSnapshot),
    observaciones: row.observaciones == null ? null : asTrim(row.observaciones),
    pago_index: toInt(row.pago_index ?? row.pagoIndex, 1),
    estado: asTrim(row.estado),
    journalEntryId: row.journalEntryId ? String(row.journalEntryId) : null,

    createdAt: row.createdAt || row.created_at || null,
    created_at: row.created_at || row.createdAt || null,
    updatedAt: row.updatedAt || row.updated_at || null,
    updated_at: row.updated_at || row.updatedAt || null,
  };
}

function pickEntryDate(entry) {
  return (
    entry?.date ??
    entry?.fecha ??
    entry?.entryDate ??
    entry?.createdAt ??
    entry?.created_at ??
    null
  );
}

function pickEntryNumero(entry) {
  return entry?.numeroAsiento ?? entry?.numero_asiento ?? entry?.numero ?? entry?.folio ?? null;
}

function pickEntryConcept(entry) {
  return entry?.concept ?? entry?.concepto ?? entry?.descripcion ?? entry?.memo ?? "";
}

async function getAccountMaps(owner, rawLines) {
  const lines = Array.isArray(rawLines) ? rawLines : [];
  const codes = [];
  const ids = [];

  for (const l of lines) {
    const code =
      l?.accountCodigo ??
      l?.accountCode ??
      l?.cuentaCodigo ??
      l?.cuenta_codigo ??
      l?.code ??
      null;

    if (code) codes.push(String(code).trim());

    const idCandidate =
      l?.accountId ??
      l?.account_id ??
      l?.cuentaId ??
      l?.cuenta_id ??
      null;

    if (idCandidate && mongoose.Types.ObjectId.isValid(String(idCandidate))) {
      ids.push(new mongoose.Types.ObjectId(String(idCandidate)));
    }
  }

  const uniqueCodes = Array.from(new Set(codes.filter(Boolean)));
  const uniqueIds = Array.from(new Set(ids.map((x) => String(x)))).map((x) => new mongoose.Types.ObjectId(x));

  if (!uniqueCodes.length && !uniqueIds.length) {
    return { byCode: {}, byId: {} };
  }

  const or = [];
  if (uniqueCodes.length) or.push({ code: { $in: uniqueCodes } });
  if (uniqueIds.length) or.push({ _id: { $in: uniqueIds } });

  const rows = await Account.find({ owner, $or: or }).select("_id code name").lean();

  const byCode = {};
  const byId = {};

  for (const r of rows) {
    const code = asTrim(r.code);
    const name = asTrim(r.name);
    if (code) byCode[code] = name;
    if (r._id) byId[String(r._id)] = { code, name };
  }

  return { byCode, byId };
}

function mapEntryForUI(entry, accountMapsOrNameMap = {}) {
  const byCode = accountMapsOrNameMap?.byCode ? accountMapsOrNameMap.byCode : accountMapsOrNameMap;
  const byId = accountMapsOrNameMap?.byId ? accountMapsOrNameMap.byId : {};

  const rawLines = entry.lines || entry.detalle_asientos || entry.detalles_asiento || [];

  const detalle_asientos = (rawLines || []).map((l, idx) => {
    let cuentaCodigo =
      l?.accountCodigo ??
      l?.accountCode ??
      l?.cuentaCodigo ??
      l?.cuenta_codigo ??
      l?.code ??
      "";

    cuentaCodigo = cuentaCodigo ? String(cuentaCodigo).trim() : "";

    const accountId =
      l?.accountId ??
      l?.account_id ??
      l?.cuentaId ??
      l?.cuenta_id ??
      null;

    const accountIdStr = accountId ? String(accountId).trim() : "";

    if (!cuentaCodigo && accountIdStr && byId[accountIdStr]?.code) {
      cuentaCodigo = String(byId[accountIdStr].code || "").trim();
    }

    const cuentaNombre =
      l?.accountName ??
      l?.cuenta_nombre ??
      l?.cuentaNombre ??
      l?.name ??
      (cuentaCodigo ? byCode[cuentaCodigo] || null : accountIdStr && byId[accountIdStr]?.name ? byId[accountIdStr].name : null);

    const debe = toNum(l?.debit ?? l?.debe, 0);
    const haber = toNum(l?.credit ?? l?.haber, 0);
    const descripcion = asTrim(l?.memo ?? l?.descripcion ?? l?.concepto ?? "");

    return {
      id: `${entry?._id || entry?.id || "line"}-${idx}`,
      cuenta_codigo: cuentaCodigo || null,
      descripcion,
      debe,
      haber,
      cuentas: cuentaCodigo
        ? {
            codigo: cuentaCodigo,
            nombre: cuentaNombre || null,
          }
        : null,
    };
  });

  const fecha = pickEntryDate(entry);
  const numeroAsiento = pickEntryNumero(entry);
  const descripcion = pickEntryConcept(entry);

  return {
    id: String(entry._id || entry.id || ""),
    numero_asiento: numeroAsiento || null,
    descripcion: descripcion || "",
    fecha: fecha ? toYMD(fecha) : null,
    detalle_asientos,
  };
}

async function ensureNumeroAsiento(owner, journalEntryId) {
  try {
    if (!Counter || !JournalEntry || !journalEntryId) return null;

    const current = await JournalEntry.findOne({ _id: journalEntryId, owner }).lean();
    if (!current) return null;

    const existing = current?.numeroAsiento ?? current?.numero_asiento ?? current?.numero ?? null;
    if (existing) return existing;

    const d = current?.date || current?.fecha || new Date();
    const year = new Date(d).getFullYear();
    const key = `journal-${year}`;

    const counterDoc = await Counter.findOneAndUpdate(
      { owner, key },
      { $inc: { seq: 1 } },
      { new: true, upsert: true }
    ).lean();

    const seq = counterDoc?.seq || 1;
    const numeroAsiento = `${year}-${String(seq).padStart(4, "0")}`;

    await JournalEntry.updateOne(
      { _id: journalEntryId, owner },
      {
        $set: {
          numeroAsiento,
          numero_asiento: numeroAsiento,
          numero: numeroAsiento,
        },
      }
    );

    return numeroAsiento;
  } catch (err) {
    console.error("ensureNumeroAsiento impuestos error:", err?.message || err);
    return null;
  }
}

async function findAccountByCode(owner, code) {
  if (!code) return null;
  return Account.findOne({ owner, code: String(code).trim(), isActive: { $ne: false } }).lean();
}

async function findAccountByRegex(owner, regex, type = null) {
  const filter = {
    owner,
    name: regex,
    isActive: { $ne: false },
  };
  if (type) filter.type = type;
  return Account.findOne(filter).sort({ isDefault: -1, code: 1 }).lean();
}

async function resolveISRExpenseAccount(owner) {
  return (
    (await findAccountByCode(owner, "6001")) ||
    (await findAccountByRegex(owner, /impuesto sobre la renta|gasto por isr|^isr$/i, "gasto")) ||
    (await findAccountByRegex(owner, /impuestos/i, "gasto")) ||
    null
  );
}

async function resolveISRPayableAccount(owner) {
  return (
    (await findAccountByRegex(owner, /isr por pagar/i, "pasivo")) ||
    (await findAccountByRegex(owner, /impuestos por pagar/i, "pasivo")) ||
    (await findAccountByRegex(owner, /acreedor fiscal/i, "pasivo")) ||
    null
  );
}

async function resolvePaymentAccount(owner, metodoPago) {
  if (metodoPago === "efectivo") {
    return (
      (await findAccountByCode(owner, "1001")) ||
      (await findAccountByRegex(owner, /caja|efectivo/i, "activo")) ||
      null
    );
  }

  return (
    (await findAccountByCode(owner, "1002")) ||
    (await findAccountByRegex(owner, /bancos|banco/i, "activo")) ||
    null
  );
}

function buildJournalLines({ isrAccount, payableAccount, paymentAccount, tipoPago, metodoPago, totalISR, montoPagado, saldoPendiente, concept }) {
  const lines = [];

  lines.push({
    accountCode: isrAccount.code,
    accountCodigo: isrAccount.code,
    accountName: isrAccount.name,
    debit: totalISR,
    credit: 0,
    memo: concept,
  });

  if (tipoPago === "total") {
    lines.push({
      accountCode: paymentAccount.code,
      accountCodigo: paymentAccount.code,
      accountName: paymentAccount.name,
      debit: 0,
      credit: totalISR,
      memo: concept,
    });
  } else if (tipoPago === "credito") {
    lines.push({
      accountCode: payableAccount.code,
      accountCodigo: payableAccount.code,
      accountName: payableAccount.name,
      debit: 0,
      credit: totalISR,
      memo: concept,
    });
  } else if (tipoPago === "parcial") {
    if (montoPagado > 0) {
      lines.push({
        accountCode: paymentAccount.code,
        accountCodigo: paymentAccount.code,
        accountName: paymentAccount.name,
        debit: 0,
        credit: montoPagado,
        memo: `${concept} | Pago parcial`,
      });
    }

    if (saldoPendiente > 0) {
      lines.push({
        accountCode: payableAccount.code,
        accountCodigo: payableAccount.code,
        accountName: payableAccount.name,
        debit: 0,
        credit: saldoPendiente,
        memo: `${concept} | Saldo pendiente`,
      });
    }
  }

  return lines;
}

async function createJournalEntryBestEffort({ owner, taxRecord }) {
  try {
    const isrAccount = await resolveISRExpenseAccount(owner);
    if (!isrAccount) {
      return {
        journalEntryId: null,
        numeroAsiento: null,
        warning: "No se encontró la cuenta contable del ISR. Busca una cuenta 6001 o con nombre ISR/Impuesto sobre la renta.",
      };
    }

    const tipoPago = normalizeTipoPago(taxRecord.tipoPago);
    const metodoPago = normalizeMetodoPago(taxRecord.metodoPago);

    const totalISR = Math.max(0, toNum(taxRecord.isrRealTotal, 0));
    const montoPagado = Math.max(0, toNum(taxRecord.montoPagado, 0));
    const saldoPendiente = Math.max(0, toNum(taxRecord.saldoPendiente, 0));

    let paymentAccount = null;
    let payableAccount = null;

    if (tipoPago === "total" || tipoPago === "parcial") {
      paymentAccount = await resolvePaymentAccount(owner, metodoPago || "transferencia");
      if (!paymentAccount) {
        return {
          journalEntryId: null,
          numeroAsiento: null,
          warning: "No se encontró la cuenta de pago (banco/caja).",
        };
      }
    }

    if (tipoPago === "credito" || (tipoPago === "parcial" && saldoPendiente > 0)) {
      payableAccount = await resolveISRPayableAccount(owner);
      if (!payableAccount) {
        return {
          journalEntryId: null,
          numeroAsiento: null,
          warning: "No se encontró la cuenta de ISR por pagar / impuestos por pagar.",
        };
      }
    }

    const conceptoBase = `Registro ISR ${taxRecord.mes}/${taxRecord.ano} - ${taxRecord.autoridadNombreSnapshot || "Autoridad fiscal"}`;

    const lines = buildJournalLines({
      isrAccount,
      payableAccount,
      paymentAccount,
      tipoPago,
      metodoPago,
      totalISR,
      montoPagado,
      saldoPendiente,
      concept: conceptoBase,
    });

    if (!lines.length) {
      return {
        journalEntryId: null,
        numeroAsiento: null,
        warning: "No se pudieron construir las líneas contables del ISR.",
      };
    }

    const je = await JournalEntry.create({
      owner,
      source: "impuesto_isr",
      sourceId: taxRecord._id,
      transaccionId: taxRecord._id,
      concept: conceptoBase,
      concepto: conceptoBase,
      descripcion: conceptoBase,
      date: new Date(),
      referencia: `isr_${taxRecord.ano}_${String(taxRecord.mes).padStart(2, "0")}_${taxRecord.pagoIndex || 1}`,
      lines,
      detalle_asientos: lines,
      references: [
        { source: "impuesto_isr", id: String(taxRecord._id) },
        { source: "autoridad_fiscal", id: String(taxRecord.autoridadId || "") },
      ],
    });

    const journalEntryId = je?._id ? String(je._id) : null;
    const numeroAsiento = journalEntryId ? await ensureNumeroAsiento(owner, je._id) : null;

    return { journalEntryId, numeroAsiento, warning: null };
  } catch (err) {
    console.error("createJournalEntryBestEffort impuestos error:", err?.message || err);
    return {
      journalEntryId: null,
      numeroAsiento: null,
      warning: "No se pudo crear el asiento contable del ISR.",
    };
  }
}

/**
 * =========================================
 * AUTORIDADES FISCALES
 * =========================================
 */

router.get("/autoridades-fiscales", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;
    const docs = await TaxAuthority.find({ owner }).sort({ nombre: 1, createdAt: -1 });

    const items = docs.map(formatAuthority).filter(Boolean);
    return res.json({ ok: true, data: items, autoridades: items, items });
  } catch (err) {
    console.error("GET /api/impuestos/autoridades-fiscales error:", err);
    return res.status(500).json({ ok: false, message: "Error cargando autoridades fiscales" });
  }
});

router.post("/autoridades-fiscales", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;

    const nombre = asTrim(req.body?.nombre);
    if (!nombre) {
      return res.status(400).json({ ok: false, message: "nombre es requerido" });
    }

    const doc = await TaxAuthority.create({
      owner,
      nombre,
      rfc: asTrim(req.body?.rfc),
      logoUrl: asTrim(req.body?.logo_url || req.body?.logoUrl),
      pais: asTrim(req.body?.pais, "México"),
      telefono: asTrim(req.body?.telefono),
      email: asTrim(req.body?.email),
      sitioWeb: asTrim(req.body?.sitio_web || req.body?.sitioWeb),
      direccion: asTrim(req.body?.direccion),
      cuentaBancaria: asTrim(req.body?.cuenta_bancaria || req.body?.cuentaBancaria),
      notas: asTrim(req.body?.notas),
    });

    const item = formatAuthority(doc);
    return res.status(201).json({ ok: true, data: item, item });
  } catch (err) {
    console.error("POST /api/impuestos/autoridades-fiscales error:", err);
    return res.status(500).json({ ok: false, message: err?.message || "Error creando autoridad fiscal" });
  }
});

router.put("/autoridades-fiscales/:id", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;
    const id = asTrim(req.params.id);

    if (!isObjectId(id)) {
      return res.status(400).json({ ok: false, message: "id inválido" });
    }

    const update = {
      nombre: asTrim(req.body?.nombre),
      rfc: asTrim(req.body?.rfc),
      logoUrl: asTrim(req.body?.logo_url || req.body?.logoUrl),
      pais: asTrim(req.body?.pais, "México"),
      telefono: asTrim(req.body?.telefono),
      email: asTrim(req.body?.email),
      sitioWeb: asTrim(req.body?.sitio_web || req.body?.sitioWeb),
      direccion: asTrim(req.body?.direccion),
      cuentaBancaria: asTrim(req.body?.cuenta_bancaria || req.body?.cuentaBancaria),
      notas: asTrim(req.body?.notas),
    };

    if (!update.nombre) {
      return res.status(400).json({ ok: false, message: "nombre es requerido" });
    }

    const doc = await TaxAuthority.findOneAndUpdate(
      { _id: id, owner },
      { $set: update },
      { new: true }
    );

    if (!doc) {
      return res.status(404).json({ ok: false, message: "Autoridad fiscal no encontrada" });
    }

    const item = formatAuthority(doc);
    return res.json({ ok: true, data: item, item });
  } catch (err) {
    console.error("PUT /api/impuestos/autoridades-fiscales/:id error:", err);
    return res.status(500).json({ ok: false, message: err?.message || "Error actualizando autoridad fiscal" });
  }
});

router.delete("/autoridades-fiscales/:id", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;
    const id = asTrim(req.params.id);

    if (!isObjectId(id)) {
      return res.status(400).json({ ok: false, message: "id inválido" });
    }

    const doc = await TaxAuthority.findOneAndDelete({ _id: id, owner });
    if (!doc) {
      return res.status(404).json({ ok: false, message: "Autoridad fiscal no encontrada" });
    }

    return res.json({ ok: true, message: "Autoridad fiscal eliminada" });
  } catch (err) {
    console.error("DELETE /api/impuestos/autoridades-fiscales/:id error:", err);
    return res.status(500).json({ ok: false, message: "Error eliminando autoridad fiscal" });
  }
});

/**
 * =========================================
 * ISR REGISTROS
 * =========================================
 */

router.get("/isr/registros", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;
    const mes = toInt(req.query.mes, 0);
    const ano = toInt(req.query.ano, 0);

    if (!(mes >= 1 && mes <= 12) || !(ano >= 2000)) {
      return res.status(400).json({ ok: false, message: "mes y ano son requeridos" });
    }

    const docs = await TaxISRRecord.find({ owner, mes, ano }).sort({ createdAt: -1, _id: -1 });
    const items = docs.map(formatTaxRecord).filter(Boolean);

    return res.json({ ok: true, data: items, items });
  } catch (err) {
    console.error("GET /api/impuestos/isr/registros error:", err);
    return res.status(500).json({ ok: false, message: "Error cargando registros ISR" });
  }
});

router.post("/isr/registros", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;

    const mes = toInt(req.body?.mes, 0);
    const ano = toInt(req.body?.ano, 0);

    const utilidadAntesImpuestos = toNum(req.body?.utilidad_antes_impuestos, 0);
    const tasaISR = toNum(req.body?.tasa_isr, 0);
    const isrCalculado = toNum(req.body?.isr_calculado, 0);
    const isrRealTotal = Math.max(0, toNum(req.body?.isr_real_total, 0));

    const tipoPago = normalizeTipoPago(req.body?.tipo_pago);
    const metodoPago = normalizeMetodoPago(req.body?.metodo_pago);

    const montoPagadoInput = Math.max(0, toNum(req.body?.monto_pagado, 0));
    const fechaVencimiento = asDateOrNull(req.body?.fecha_vencimiento);
    const autoridadId = asTrim(req.body?.autoridad_id);
    const observaciones = req.body?.observaciones == null ? "" : asTrim(req.body?.observaciones);
    const pagoIndex = Math.max(1, toInt(req.body?.pago_index, 1));

    if (!(mes >= 1 && mes <= 12)) {
      return res.status(400).json({ ok: false, message: "mes inválido" });
    }

    if (!(ano >= 2000)) {
      return res.status(400).json({ ok: false, message: "ano inválido" });
    }

    if (!tipoPago) {
      return res.status(400).json({ ok: false, message: "tipo_pago inválido" });
    }

    if (!isObjectId(autoridadId)) {
      return res.status(400).json({ ok: false, message: "autoridad_id inválido" });
    }

    const autoridad = await TaxAuthority.findOne({ _id: autoridadId, owner });
    if (!autoridad) {
      return res.status(404).json({ ok: false, message: "Autoridad fiscal no encontrada" });
    }

    if (isrRealTotal < 0) {
      return res.status(400).json({ ok: false, message: "isr_real_total inválido" });
    }

    if (tipoPago === "credito" && !fechaVencimiento) {
      return res.status(400).json({ ok: false, message: "fecha_vencimiento es requerida para pago a crédito" });
    }

    if ((tipoPago === "total" || tipoPago === "parcial") && !metodoPago) {
      return res.status(400).json({ ok: false, message: "metodo_pago es requerido" });
    }

    if (tipoPago === "parcial") {
      if (!(montoPagadoInput > 0)) {
        return res.status(400).json({ ok: false, message: "monto_pagado debe ser mayor a 0 para pago parcial" });
      }
      if (montoPagadoInput > isrRealTotal) {
        return res.status(400).json({ ok: false, message: "monto_pagado no puede ser mayor al ISR total" });
      }
      if (!fechaVencimiento) {
        return res.status(400).json({ ok: false, message: "fecha_vencimiento es requerida para pago parcial" });
      }
    }

    const montoPagado =
      tipoPago === "total"
        ? isrRealTotal
        : tipoPago === "parcial"
          ? montoPagadoInput
          : 0;

    const saldoPendiente =
      tipoPago === "credito"
        ? isrRealTotal
        : Math.max(0, isrRealTotal - montoPagado);

    const estado =
      saldoPendiente <= 0 ? "pagado" : montoPagado > 0 ? "parcial" : "pendiente";

    let taxRecord = await TaxISRRecord.create({
      owner,
      mes,
      ano,
      utilidadAntesImpuestos,
      tasaISR,
      isrCalculado,
      isrRealTotal,
      tipoPago,
      metodoPago: tipoPago === "credito" ? "" : metodoPago,
      montoPagado,
      saldoPendiente,
      fechaVencimiento: fechaVencimiento || null,
      autoridadId: autoridad._id,
      autoridadNombreSnapshot: autoridad.nombre,
      observaciones,
      pagoIndex,
      estado,
    });

    const { journalEntryId, numeroAsiento, warning } = await createJournalEntryBestEffort({
      owner,
      taxRecord,
    });

    if (journalEntryId) {
      taxRecord = await TaxISRRecord.findOneAndUpdate(
        { _id: taxRecord._id, owner },
        { $set: { journalEntryId: new mongoose.Types.ObjectId(journalEntryId) } },
        { new: true }
      );
    }

    const item = formatTaxRecord(taxRecord);

    return res.status(201).json({
      ok: true,
      data: item,
      item,
      numeroAsiento: numeroAsiento || null,
      numero_asiento: numeroAsiento || null,
      asientoId: journalEntryId || null,
      warning: warning || null,
    });
  } catch (err) {
    console.error("POST /api/impuestos/isr/registros error:", err);
    return res.status(500).json({
      ok: false,
      message: err?.message || "Error creando registro ISR",
    });
  }
});

router.get("/isr/resumen", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;
    const ano = toInt(req.query.ano, 0);
    const mes = req.query.mes != null ? toInt(req.query.mes, 0) : null;

    if (!(ano >= 2000)) {
      return res.status(400).json({ ok: false, message: "ano es requerido" });
    }

    const filter = { owner, ano };
    if (mes && mes >= 1 && mes <= 12) filter.mes = mes;

    const docs = await TaxISRRecord.find(filter).sort({ createdAt: -1, _id: -1 });

    const items = docs.map((doc) => {
      const row = formatTaxRecord(doc);
      const diferencia = toNum(row.isr_real, 0) - toNum(row.isr_calculado, 0);

      return {
        id: row.id,
        mes: row.mes,
        ano: row.ano,
        utilidad_antes_impuestos: row.utilidad_antes_impuestos,
        tasa_isr: row.tasa_isr,
        isr_calculado: row.isr_calculado,
        isr_real: row.isr_real,
        diferencia,
        observaciones: row.observaciones,
        created_at: row.created_at,
        egreso: {
          tipo_pago:
            row.tipo_pago === "total"
              ? "contado"
              : row.tipo_pago === "credito"
                ? "credito"
                : "parcial",
          metodo_pago: row.metodo_pago || null,
          monto_pagado: row.monto_pagado,
          monto_pendiente: row.saldo_pendiente,
          cuenta_codigo:
            row.tipo_pago === "credito" || row.saldo_pendiente > 0
              ? "ISR_POR_PAGAR"
              : row.metodo_pago === "efectivo"
                ? "1001"
                : "1002",
        },
      };
    });

    return res.json({ ok: true, data: items, items });
  } catch (err) {
    console.error("GET /api/impuestos/isr/resumen error:", err);
    return res.status(500).json({ ok: false, message: "Error cargando resumen ISR" });
  }
});

router.get("/isr/asiento", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;

    const recordId = asTrim(req.query.id || req.query.transaccion_id || "");
    const mes = toInt(req.query.mes, 0);
    const ano = toInt(req.query.ano, 0);

    let taxRecord = null;

    if (recordId && isObjectId(recordId)) {
      taxRecord = await TaxISRRecord.findOne({ _id: recordId, owner }).lean();
    }

    if (!taxRecord && mes >= 1 && mes <= 12 && ano >= 2000) {
      taxRecord = await TaxISRRecord.findOne({ owner, mes, ano }).sort({ createdAt: -1, _id: -1 }).lean();
    }

    if (!taxRecord) {
      return res.json({ ok: true, data: null, asiento: null });
    }

    let asiento = null;

    if (taxRecord.journalEntryId && isObjectId(taxRecord.journalEntryId)) {
      asiento = await JournalEntry.findOne({
        _id: taxRecord.journalEntryId,
        owner,
      }).lean();
    }

    if (!asiento) {
      asiento = await JournalEntry.findOne({
        owner,
        source: "impuesto_isr",
        sourceId: taxRecord._id,
      })
        .sort({ createdAt: -1 })
        .lean();
    }

    if (!asiento) {
      return res.json({ ok: true, data: null, asiento: null });
    }

    const rawLines = asiento.lines || asiento.detalle_asientos || asiento.detalles_asiento || [];
    const accountMaps = await getAccountMaps(owner, rawLines);
    const asientoUI = mapEntryForUI(asiento, accountMaps);

    return res.json({
      ok: true,
      data: asientoUI,
      asiento: asientoUI,
      item: asientoUI,
      ...asientoUI,
    });
  } catch (err) {
    console.error("GET /api/impuestos/isr/asiento error:", err);
    return res.status(500).json({ ok: false, message: "Error cargando asiento de ISR" });
  }
});

router.get("/transacciones", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;
    const year = req.query.year != null ? toInt(req.query.year, 0) : null;
    const startYear = req.query.startYear != null ? toInt(req.query.startYear, 0) : null;
    const endYear = req.query.endYear != null ? toInt(req.query.endYear, 0) : null;

    const filter = { owner };

    if (year && year >= 2000) {
      filter.ano = year;
    } else if (startYear && endYear && startYear >= 2000 && endYear >= startYear) {
      filter.ano = { $gte: startYear, $lte: endYear };
    }

    const docs = await TaxISRRecord.find(filter).sort({ ano: 1, mes: 1, createdAt: 1, _id: 1 });

    const transacciones = docs.map((doc) => {
      const row = formatTaxRecord(doc);
      return {
        id: row.id,
        ano: row.ano,
        mes: row.mes,
        isr_calculado: row.isr_calculado,
        isr_real: row.isr_real,
      };
    });

    return res.json({
      ok: true,
      data: { transacciones },
      transacciones,
    });
  } catch (err) {
    console.error("GET /api/impuestos/transacciones error:", err);
    return res.status(500).json({ ok: false, message: "Error cargando transacciones ISR" });
  }
});

module.exports = router;