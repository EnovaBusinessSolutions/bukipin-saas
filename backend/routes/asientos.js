// backend/routes/asientos.js
const express = require("express");
const router = express.Router();

const mongoose = require("mongoose");
const JournalEntry = require("../models/JournalEntry"); // ajusta ruta/nombre si difiere
const ensureAuth = require("../middleware/ensureAuth"); // ✅ tu middleware real

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

/**
 * Map mínimo compatible con tu UI (igual al de ingresos.js)
 * - NO altera datos, solo los expone en el shape "legacy"
 */
function mapEntryForUI(entry) {
  const lines = entry.lines || entry.detalle_asientos || [];

  const detalle_asientos = (lines || []).map((l) => ({
    cuenta_codigo: l.accountCodigo ?? l.accountCode ?? l.cuenta_codigo ?? null,
    debe: num(l.debit ?? l.debe, 0),
    haber: num(l.credit ?? l.haber, 0),
    memo: l.memo ?? "",
  }));

  return {
    id: String(entry._id),
    _id: entry._id,

    asiento_fecha: toYMD(entry.date),
    fecha: entry.date,

    concepto: entry.concept ?? entry.concepto ?? "",
    source: entry.source ?? "",
    transaccion_ingreso_id: entry.sourceId ? String(entry.sourceId) : null,

    detalle_asientos,

    created_at: entry.createdAt,
    updated_at: entry.updatedAt,
  };
}

// GET /api/asientos/by-transaccion?source=ingreso&id=XXXXXXXX
router.get("/by-transaccion", ensureAuth, async (req, res) => {
  try {
    let { source, id } = req.query;

    source = String(source || "").trim();
    id = String(id || "").trim();

    if (!source || !id) {
      return res.status(400).json({
        ok: false,
        error: "MISSING_PARAMS",
        details: "source e id son requeridos",
      });
    }

    // ✅ Alias mínimo: la UI suele mandar "ingreso"
    // pero si llega "ingresos", lo convertimos.
    // También buscamos ambas variantes para no romper nada.
    const sourceAliases = new Set([source.toLowerCase()]);
    if (source.toLowerCase() === "ingresos") sourceAliases.add("ingreso");
    if (source.toLowerCase() === "ingreso") sourceAliases.add("ingresos");

    // Multi-tenant
    const owner = req.user._id;

    // ✅ Soporte a sourceId como string u ObjectId (sin romper)
    const sourceIdCandidates = [id];
    if (mongoose.Types.ObjectId.isValid(id)) {
      sourceIdCandidates.push(new mongoose.Types.ObjectId(id));
    }

    // 👇 Mantenemos tu lógica existente y SOLO la hacemos robusta:
    // 1) canónico: sourceId (string/ObjectId)
    // 2) legacy: transaccionId/transaccion_id
    // 3) references
    const asiento =
      (await JournalEntry.findOne({
        owner,
        source: { $in: Array.from(sourceAliases) },
        sourceId: { $in: sourceIdCandidates }, // ✅ robusto
      })
        .sort({ createdAt: -1 })
        .lean()) ||

      (await JournalEntry.findOne({
        owner,
        source: { $in: Array.from(sourceAliases) },
        transaccionId: id,
      })
        .sort({ createdAt: -1 })
        .lean()) ||

      (await JournalEntry.findOne({
        owner,
        source: { $in: Array.from(sourceAliases) },
        transaccion_id: id,
      })
        .sort({ createdAt: -1 })
        .lean()) ||

      (await JournalEntry.findOne({
        owner,
        "references.source": { $in: Array.from(sourceAliases) },
        "references.id": id,
      })
        .sort({ createdAt: -1 })
        .lean());

    if (!asiento) {
      // 404 limpio
      return res.status(404).json({ ok: false, error: "NOT_FOUND" });
    }

    // ✅ Respuesta compatible con UI (legacy + raw)
    const asientoUI = mapEntryForUI(asiento);
    const numeroAsiento = String(asiento._id);

    return res.json({
      ok: true,

      // compat "data"
      data: {
        asiento: asientoUI,
        numeroAsiento,
        raw: asiento,
      },

      // compat extra (por si en algún lado lo consumen directo)
      asiento: asientoUI,
      numeroAsiento,

      // compat array
      asientos: [asientoUI],
    });
  } catch (e) {
    console.error("GET /api/asientos/by-transaccion error:", e);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

module.exports = router;
