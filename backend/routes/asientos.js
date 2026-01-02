// backend/routes/asientos.js
const express = require("express");
const router = express.Router();

const mongoose = require("mongoose");
const JournalEntry = require("../models/JournalEntry");
const ensureAuth = require("../middleware/ensureAuth");

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
 * ✅ Mapeo compat con RegistroIngresos.tsx
 * - detalle_asientos (legacy)
 * - detalles (lo que el modal usa para la tabla)
 * - numeroAsiento / numero_asiento
 */
function mapEntryForUI(entry) {
  const rawLines = entry.lines || entry.detalle_asientos || [];

  const detalle_asientos = (rawLines || []).map((l) => ({
    cuenta_codigo: l.accountCodigo ?? l.accountCode ?? l.cuenta_codigo ?? null,
    debe: num(l.debit ?? l.debe, 0),
    haber: num(l.credit ?? l.haber, 0),
    memo: l.memo ?? l.descripcion ?? "",
  }));

  const detalles = detalle_asientos.map((d) => ({
    cuenta: d.cuenta_codigo,
    descripcion: d.memo || "",
    debe: d.debe,
    haber: d.haber,
  }));

  return {
    id: String(entry._id),
    _id: entry._id,

    // ✅ folio/número (nuevo)
    numeroAsiento: entry.numeroAsiento ?? null,
    numero_asiento: entry.numeroAsiento ?? null,

    asiento_fecha: toYMD(entry.date),
    fecha: entry.date,

    concepto: entry.concept ?? entry.concepto ?? "",
    source: entry.source ?? "",
    transaccion_ingreso_id: entry.sourceId ? String(entry.sourceId) : null,

    detalle_asientos,
    detalles,

    created_at: entry.createdAt ?? null,
    updated_at: entry.updatedAt ?? null,
  };
}

// GET /api/asientos/by-transaccion?source=ingreso&id=XXXXXXXX
router.get("/by-transaccion", ensureAuth, async (req, res) => {
  try {
    let { source, id } = req.query;

    source = String(source || "").trim().toLowerCase();
    id = String(id || "").trim();

    if (!source || !id) {
      return res.status(400).json({
        ok: false,
        error: "MISSING_PARAMS",
        details: "source e id son requeridos",
      });
    }

    // ✅ alias robustos
    const sourceAliases = new Set([source]);
    if (source === "ingresos") sourceAliases.add("ingreso");
    if (source === "ingreso") sourceAliases.add("ingresos");

    const owner = req.user._id;

    // ✅ soporta sourceId string u ObjectId
    const sourceIdCandidates = [id];
    if (mongoose.Types.ObjectId.isValid(id)) {
      sourceIdCandidates.push(new mongoose.Types.ObjectId(id));
    }

    // 1) canónico: sourceId
    let asiento = await JournalEntry.findOne({
      owner,
      source: { $in: Array.from(sourceAliases) },
      sourceId: { $in: sourceIdCandidates },
    })
      .sort({ createdAt: -1 })
      .lean();

    // 2) legacy fallbacks por si tuvieras campos viejos
    if (!asiento) {
      asiento =
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
    }

    if (!asiento) {
      return res.status(404).json({ ok: false, error: "NOT_FOUND" });
    }

    const asientoUI = mapEntryForUI(asiento);

    // ✅ numeroAsiento preferido; fallback al _id
    const numeroAsiento = asientoUI.numeroAsiento || asientoUI.numero_asiento || String(asiento._id);

    return res.json({
      ok: true,
      data: {
        asiento: asientoUI,
        numeroAsiento,
        raw: asiento,
      },
      asiento: asientoUI,
      numeroAsiento,
      asientos: [asientoUI],
    });
  } catch (e) {
    console.error("GET /api/asientos/by-transaccion error:", e);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

module.exports = router;
