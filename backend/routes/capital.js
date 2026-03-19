// backend/routes/capital.js
const express = require("express");
const mongoose = require("mongoose");
const ensureAuth = require("../middleware/ensureAuth");

const CapitalTransaction = require("../models/CapitalTransaction");
const Shareholder = require("../models/Shareholder");

let JournalEntry = null;
try {
  JournalEntry = require("../models/JournalEntry");
} catch (_) {}

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

function asDateOrNull(v) {
  if (!v) return null;
  const d = new Date(v);
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

function isValidObjectId(v) {
  return mongoose.Types.ObjectId.isValid(asTrim(v, ""));
}

function normalizeTipoMovimiento(v) {
  const s = asTrim(v, "").toLowerCase();
  const aliases = {
    aportacion: "aportacion",
    aportación: "aportacion",
    capital: "aportacion",
    dividendo: "dividendo",
    dividendos: "dividendo",
  };
  return aliases[s] || "";
}

/**
 * ✅ CLAVE:
 * soporta docs mongoose y objetos lean()
 */
function normalizeItem(doc) {
  if (!doc) return null;

  if (typeof doc.toJSON === "function") {
    return doc.toJSON();
  }

  return {
    id: doc._id ? String(doc._id) : String(doc.id ?? ""),
    user_id: doc.owner ? String(doc.owner) : "",

    tipo_movimiento: asTrim(doc.tipo_movimiento, ""),
    fecha: doc.fecha ? toYMD(doc.fecha) : null,
    monto: toNum(doc.monto, 0),
    socio: asTrim(doc.socio, ""),
    accionista_id: doc.accionista_id ? String(doc.accionista_id) : null,
    descripcion:
      doc.descripcion === null || doc.descripcion === undefined
        ? null
        : asTrim(doc.descripcion, ""),
    estado: asTrim(doc.estado, "activo"),

    fecha_cancelacion: doc.fecha_cancelacion ? toYMD(doc.fecha_cancelacion) : null,
    motivo_cancelacion:
      doc.motivo_cancelacion === null || doc.motivo_cancelacion === undefined
        ? null
        : asTrim(doc.motivo_cancelacion, ""),

    transaccion_cancelacion_id: doc.transaccion_cancelacion_id
      ? String(doc.transaccion_cancelacion_id)
      : null,

    journalEntryId: doc.journalEntryId ? String(doc.journalEntryId) : null,
    reversalJournalEntryId: doc.reversalJournalEntryId
      ? String(doc.reversalJournalEntryId)
      : null,

    created_at: doc.createdAt ? new Date(doc.createdAt).toISOString() : null,
    updated_at: doc.updatedAt ? new Date(doc.updatedAt).toISOString() : null,
  };
}

function getDefaultAccounts(tipoMovimiento) {
  const bank = { code: "1002", name: "Bancos" };
  const capital = { code: "3001", name: "Capital Social" };
  const retained = { code: "3102", name: "Utilidades Retenidas" };

  if (tipoMovimiento === "aportacion") {
    return {
      debit: bank,
      credit: capital,
    };
  }

  return {
    debit: retained,
    credit: bank,
  };
}

function buildJournalEntryPayload({ owner, tx, reversal = false, motivoCancelacion = "" }) {
  const baseAccounts = getDefaultAccounts(tx.tipo_movimiento);
  const monto = Math.max(0, toNum(tx.monto, 0));
  const socio = asTrim(tx.socio, "Socio");
  const fecha = tx.fecha || new Date();

  if (monto <= 0) return null;

  const originalConcept =
    tx.tipo_movimiento === "aportacion"
      ? `Aportación de capital - ${socio}`
      : `Pago de dividendo - ${socio}`;

  const concept = reversal
    ? `Reversión ${originalConcept}${motivoCancelacion ? ` | Motivo: ${motivoCancelacion}` : ""}`
    : originalConcept;

  let lines = [];

  if (!reversal) {
    lines = [
      {
        accountCode: baseAccounts.debit.code,
        accountCodigo: baseAccounts.debit.code,
        accountName: baseAccounts.debit.name,
        debit: monto,
        credit: 0,
        memo: concept,
      },
      {
        accountCode: baseAccounts.credit.code,
        accountCodigo: baseAccounts.credit.code,
        accountName: baseAccounts.credit.name,
        debit: 0,
        credit: monto,
        memo: concept,
      },
    ];
  } else {
    lines = [
      {
        accountCode: baseAccounts.credit.code,
        accountCodigo: baseAccounts.credit.code,
        accountName: baseAccounts.credit.name,
        debit: monto,
        credit: 0,
        memo: concept,
      },
      {
        accountCode: baseAccounts.debit.code,
        accountCodigo: baseAccounts.debit.code,
        accountName: baseAccounts.debit.name,
        debit: 0,
        credit: monto,
        memo: concept,
      },
    ];
  }

  return {
    owner,
    source: reversal ? "capital_cancelacion" : "capital",
    sourceId: tx._id,
    transaccionId: tx._id,
    concept,
    concepto: concept,
    descripcion: concept,
    date: fecha,
    fecha,
    referencia: reversal
      ? `capital_cancelacion_${tx.tipo_movimiento}`
      : `capital_${tx.tipo_movimiento}`,
    lines,
    detalle_asientos: lines,
    references: [
      { source: "capital", id: String(tx._id) },
      { source: "accionista", id: tx.accionista_id ? String(tx.accionista_id) : "" },
      ...(tx.journalEntryId
        ? [{ source: "journal_entry_original", id: String(tx.journalEntryId) }]
        : []),
    ],
  };
}

async function ensureNumeroAsiento(owner, journalEntryId) {
  try {
    if (!Counter || !JournalEntry || !journalEntryId) return null;

    const current = await JournalEntry.findOne({ _id: journalEntryId, owner }).lean();
    if (!current) return null;

    const existing =
      current?.numeroAsiento ?? current?.numero_asiento ?? current?.numero ?? null;
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
    console.error("ensureNumeroAsiento capital error:", err?.message || err);
    return null;
  }
}

async function createJournalEntryBestEffort({ owner, tx, reversal = false, motivoCancelacion = "" }) {
  try {
    if (!JournalEntry) return { journalEntryId: null, numeroAsiento: null };

    const payload = buildJournalEntryPayload({
      owner,
      tx,
      reversal,
      motivoCancelacion,
    });

    if (!payload) return { journalEntryId: null, numeroAsiento: null };

    const je = await JournalEntry.create(payload);
    const journalEntryId = je?._id ? String(je._id) : null;
    const numeroAsiento = journalEntryId ? await ensureNumeroAsiento(owner, je._id) : null;

    return { journalEntryId, numeroAsiento };
  } catch (err) {
    console.error("createJournalEntryBestEffort capital error:", err?.message || err);
    return { journalEntryId: null, numeroAsiento: null };
  }
}

/**
 * GET /api/capital/transacciones
 */
router.get("/transacciones", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;
    const wrap = String(req.query.wrap || "").trim() === "1";

    const accionistaId = asTrim(
      req.query.accionista_id || req.query.accionistaId || "",
      ""
    );
    const tipo = normalizeTipoMovimiento(req.query.tipo_movimiento || req.query.tipo || "");
    const estado = asTrim(req.query.estado, "");
    const from = asDateOrNull(req.query.from || req.query.start || req.query.fechaInicio);
    const to = asDateOrNull(req.query.to || req.query.end || req.query.fechaFin);
    const limit = Math.max(1, Math.min(1000, Math.trunc(toNum(req.query.limit, 500))));

    const filter = { owner };

    if (accionistaId && isValidObjectId(accionistaId)) {
      filter.accionista_id = accionistaId;
    }
    if (tipo) filter.tipo_movimiento = tipo;
    if (estado) filter.estado = estado;
    if (from || to) {
      filter.fecha = {};
      if (from) filter.fecha.$gte = from;
      if (to) filter.fecha.$lte = to;
    }

    const docs = await CapitalTransaction.find(filter)
      .sort({ fecha: -1, createdAt: -1 })
      .limit(limit)
      .lean();

    const items = docs.map(normalizeItem).filter(Boolean);

    if (!wrap) return res.json(items);
    return res.json({ ok: true, data: items, items });
  } catch (err) {
    console.error("GET /api/capital/transacciones error:", err);
    return res.status(500).json({
      ok: false,
      error: "SERVER_ERROR",
      message: err?.message || "SERVER_ERROR",
    });
  }
});

/**
 * POST /api/capital/transacciones
 */
router.post("/transacciones", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;

    const tipo_movimiento = normalizeTipoMovimiento(req.body?.tipo_movimiento);
    const fecha = asDateOrNull(req.body?.fecha);
    const monto = Math.max(0, toNum(req.body?.monto, 0));
    const socio = asTrim(req.body?.socio, "");
    const accionistaId = asTrim(req.body?.accionista_id || req.body?.accionistaId, "");
    const descripcion =
      req.body?.descripcion === null || req.body?.descripcion === undefined
        ? null
        : asTrim(req.body?.descripcion, "");

    if (!tipo_movimiento) {
      return res.status(400).json({
        ok: false,
        error: "VALIDATION",
        message: "tipo_movimiento inválido.",
      });
    }

    if (!fecha) {
      return res.status(400).json({
        ok: false,
        error: "VALIDATION",
        message: "fecha inválida.",
      });
    }

    if (!(monto > 0)) {
      return res.status(400).json({
        ok: false,
        error: "VALIDATION",
        message: "monto debe ser mayor a 0.",
      });
    }

    let accionista = null;
    if (accionistaId) {
      if (!isValidObjectId(accionistaId)) {
        return res.status(400).json({
          ok: false,
          error: "VALIDATION",
          message: "accionista_id inválido.",
        });
      }

      accionista = await Shareholder.findOne({ _id: accionistaId, owner });
      if (!accionista) {
        return res.status(404).json({
          ok: false,
          error: "NOT_FOUND",
          message: "Accionista no encontrado.",
        });
      }
    }

    const socioSnapshot = socio || accionista?.nombre || "Socio";

    let tx = await CapitalTransaction.create({
      owner,
      tipo_movimiento,
      fecha,
      monto,
      socio: socioSnapshot,
      accionista_id: accionista ? accionista._id : null,
      descripcion: descripcion || null,
      estado: "activo",
    });

    const { journalEntryId, numeroAsiento } = await createJournalEntryBestEffort({
      owner,
      tx,
      reversal: false,
    });

    if (journalEntryId) {
      tx = await CapitalTransaction.findOneAndUpdate(
        { _id: tx._id, owner },
        { $set: { journalEntryId: new mongoose.Types.ObjectId(journalEntryId) } },
        { new: true }
      );
    }

    const item = normalizeItem(tx);
    return res.status(201).json({
      ok: true,
      data: item,
      item,
      numeroAsiento: numeroAsiento || null,
      numero_asiento: numeroAsiento || null,
      asientoId: journalEntryId || null,
    });
  } catch (err) {
    console.error("POST /api/capital/transacciones error:", err);
    return res.status(500).json({
      ok: false,
      error: "SERVER_ERROR",
      message: err?.message || "SERVER_ERROR",
    });
  }
});

/**
 * POST /api/capital/cancelar
 * body: { transaccionId, motivoCancelacion }
 */
router.post("/cancelar", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;
    const transaccionId = asTrim(req.body?.transaccionId, "");
    const motivoCancelacion = asTrim(req.body?.motivoCancelacion, "");

    if (!transaccionId || !isValidObjectId(transaccionId)) {
      return res.status(400).json({
        ok: false,
        error: "VALIDATION",
        message: "transaccionId inválido.",
      });
    }

    if (!motivoCancelacion) {
      return res.status(400).json({
        ok: false,
        error: "VALIDATION",
        message: "motivoCancelacion es requerido.",
      });
    }

    const tx = await CapitalTransaction.findOne({ _id: transaccionId, owner });
    if (!tx) {
      return res.status(404).json({
        ok: false,
        error: "NOT_FOUND",
        message: "Transacción no encontrada.",
      });
    }

    if (tx.estado === "cancelado") {
      return res.status(400).json({
        ok: false,
        error: "VALIDATION",
        message: "La transacción ya está cancelada.",
      });
    }

    const { journalEntryId, numeroAsiento } = await createJournalEntryBestEffort({
      owner,
      tx,
      reversal: true,
      motivoCancelacion,
    });

    const updated = await CapitalTransaction.findOneAndUpdate(
      { _id: tx._id, owner },
      {
        $set: {
          estado: "cancelado",
          fecha_cancelacion: new Date(),
          motivo_cancelacion: motivoCancelacion,
          reversalJournalEntryId: journalEntryId
            ? new mongoose.Types.ObjectId(journalEntryId)
            : null,
          transaccion_cancelacion_id: journalEntryId
            ? new mongoose.Types.ObjectId(journalEntryId)
            : null,
        },
      },
      { new: true }
    );

    const item = normalizeItem(updated);

    return res.json({
      ok: true,
      data: item,
      item,
      numeroAsientoReversion: numeroAsiento || null,
      numero_asiento_reversion: numeroAsiento || null,
      reversalJournalEntryId: journalEntryId || null,
    });
  } catch (err) {
    console.error("POST /api/capital/cancelar error:", err);
    return res.status(500).json({
      ok: false,
      error: "SERVER_ERROR",
      message: err?.message || "SERVER_ERROR",
    });
  }
});

module.exports = router;