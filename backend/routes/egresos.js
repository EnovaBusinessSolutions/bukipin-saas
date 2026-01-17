// backend/routes/egresos.js
const express = require("express");
const router = express.Router();

const mongoose = require("mongoose");
const ensureAuth = require("../middleware/ensureAuth");

// Reusamos tu router actual
const transaccionesEgresosRouter = require("./transaccionesEgresos");

// Modelos (ajusta los paths/nombres si en tu proyecto difieren)
const ExpenseTransaction = require("../models/ExpenseTransaction");
const JournalEntry = require("../models/JournalEntry");

// ✅ /api/egresos/transacciones  -> (GET/POST)
// ✅ /api/egresos/transacciones/:id -> (GET)
router.use("/transacciones", transaccionesEgresosRouter);

/**
 * ✅ ALIAS LEGACY
 * Tu UI (o bundle viejo) todavía hace:
 *   GET /api/egresos?estado=activo&start=...&end=...&limit=...
 * Lo redirigimos a /api/egresos/transacciones para eliminar 404.
 */
router.get("/", ensureAuth, async (req, res, next) => {
  // “Reescribe” el request para que lo maneje el router de transacciones
  req.url = "/transacciones" + (req._parsedUrl?.search || "");
  return transaccionesEgresosRouter(req, res, next);
});

function num(v, def = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

/**
 * ✅ CANCELAR EGRESO + CREAR ASIENTO DE REVERSIÓN
 * UI llama:
 *   POST /api/egresos/:id/cancel
 *   body: { motivoCancelacion: string }
 */
router.post("/:id/cancel", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;
    const id = String(req.params.id || "").trim();

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ ok: false, error: "VALIDATION", message: "ID inválido" });
    }

    const motivoCancelacion = String(req.body?.motivoCancelacion || "").trim();
    if (!motivoCancelacion) {
      return res.status(400).json({
        ok: false,
        error: "VALIDATION",
        message: "motivoCancelacion es requerido",
      });
    }

    // 1) Buscar transacción
    const tx = await ExpenseTransaction.findOne({ owner, _id: id });
    if (!tx) {
      return res.status(404).json({
        ok: false,
        error: "NOT_FOUND",
        message: "No se encontró la transacción",
      });
    }

    // ya cancelada
    if (String(tx.estado || "activo") === "cancelado") {
      return res.json({ ok: true, data: { alreadyCanceled: true } });
    }

    // 2) Buscar asiento original asociado (prioridad: numeroAsiento)
    const originalNumero = tx.numeroAsiento || tx.numero_asiento || tx.numeroAsientoEgreso || null;

    let originalEntry = null;

    if (originalNumero) {
      originalEntry = await JournalEntry.findOne({ owner, numeroAsiento: String(originalNumero) }).lean();
    }

    // fallbacks por source / sourceId / transaccionId
    if (!originalEntry) {
      const idCandidates = [id];
      if (mongoose.Types.ObjectId.isValid(id)) idCandidates.push(new mongoose.Types.ObjectId(id));

      originalEntry =
        (await JournalEntry.findOne({
          owner,
          source: { $in: ["egreso", "egresos"] },
          sourceId: { $in: idCandidates },
        })
          .sort({ createdAt: -1 })
          .lean()) ||
        (await JournalEntry.findOne({
          owner,
          source: { $in: ["egreso", "egresos"] },
          transaccionId: id,
        })
          .sort({ createdAt: -1 })
          .lean()) ||
        (await JournalEntry.findOne({
          owner,
          source: { $in: ["egreso", "egresos"] },
          transaccion_id: id,
        })
          .sort({ createdAt: -1 })
          .lean());
    }

    // Si NO hay asiento, devolvemos conflicto (porque tu UI dice “creará un asiento de reversión”)
    if (!originalEntry) {
      return res.status(409).json({
        ok: false,
        error: "NO_JOURNAL_ENTRY",
        message:
          "No se encontró el asiento contable original para reversar. Revisa numeroAsiento/sourceId/transaccionId en JournalEntry.",
      });
    }

    // 3) Crear reversión invirtiendo líneas
    const origLines = Array.isArray(originalEntry.lines) ? originalEntry.lines : [];
    const reversedLines = origLines.map((l) => ({
      accountCodigo: String(l.accountCodigo || l.accountCode || l.cuenta_codigo || l.code || "").trim(),
      debit: num(l.credit ?? l.haber ?? 0, 0),
      credit: num(l.debit ?? l.debe ?? 0, 0),
      memo: `Reversión: ${String(l.memo || l.descripcion || "").trim()}`.trim(),
    }));

    const revNumero = `REV-${String(originalEntry.numeroAsiento || originalEntry._id)}-${Date.now()}`;

    const revEntry = await JournalEntry.create({
      owner,
      date: new Date(),
      concept: `Reversión egreso: ${tx.descripcion || ""} | Motivo: ${motivoCancelacion}`.trim(),
      numeroAsiento: revNumero,
      source: "egreso_cancel",
      sourceId: tx._id,
      lines: reversedLines,
    });

    // 4) Marcar transacción cancelada
    tx.estado = "cancelado";
    tx.motivoCancelacion = motivoCancelacion;
    tx.canceladoAt = new Date();
    tx.numeroAsientoReversion = revNumero;
    await tx.save();

    return res.json({
      ok: true,
      data: {
        transaccionId: String(tx._id),
        asiento_original: originalEntry.numeroAsiento || String(originalEntry._id),
        asiento_reversion: revEntry.numeroAsiento,
      },
    });
  } catch (e) {
    console.error("POST /api/egresos/:id/cancel error:", e);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

module.exports = router;
