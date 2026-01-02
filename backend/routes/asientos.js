// backend/routes/asientos.js
const express = require("express");
const router = express.Router();

const mongoose = require("mongoose");
const JournalEntry = require("../models/JournalEntry");
const Account = require("../models/Account");
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

async function getAccountNameMap(owner, codes) {
  const unique = Array.from(new Set((codes || []).filter(Boolean).map((c) => String(c).trim())));
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

/**
 * ✅ Shape EXACTO que RegistroIngresos.tsx espera:
 * currentAsientos.descripcion
 * currentAsientos.detalles[] = { cuenta_codigo, cuenta_nombre, descripcion, debe, haber }
 */
function mapEntryForUI(entry, accountNameMap = {}) {
  const rawLines = entry.lines || entry.detalle_asientos || [];
  const detalle_asientos = (rawLines || []).map((l) => {
    const cuentaCodigo =
      l.accountCodigo ?? l.accountCode ?? l.cuenta_codigo ?? l.code ?? "";
    const cuenta_codigo = cuentaCodigo ? String(cuentaCodigo).trim() : "";

    return {
      cuenta_codigo: cuenta_codigo || null,
      cuenta_nombre: cuenta_codigo ? (accountNameMap[cuenta_codigo] || null) : null,
      debe: num(l.debit ?? l.debe, 0),
      haber: num(l.credit ?? l.haber, 0),
      memo: l.memo ?? l.descripcion ?? "",
    };
  });

  // 👇 UI pinta currentAsientos.detalles (NO detalle_asientos)
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

    // ✅ la UI usa currentAsientos.descripcion
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

    const sourceAliases = new Set([source.toLowerCase()]);
    if (source.toLowerCase() === "ingresos") sourceAliases.add("ingreso");
    if (source.toLowerCase() === "ingreso") sourceAliases.add("ingresos");

    const owner = req.user._id;

    const sourceIdCandidates = [id];
    if (mongoose.Types.ObjectId.isValid(id)) {
      sourceIdCandidates.push(new mongoose.Types.ObjectId(id));
    }

    const asiento =
      (await JournalEntry.findOne({
        owner,
        source: { $in: Array.from(sourceAliases) },
        sourceId: { $in: sourceIdCandidates },
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

    if (!asiento) return res.status(404).json({ ok: false, error: "NOT_FOUND" });

    // ✅ Enriquecer nombres de cuentas por code
    const codes = (asiento.lines || [])
      .map((l) => l.accountCodigo ?? l.accountCode ?? l.cuenta_codigo ?? null)
      .filter(Boolean)
      .map(String);

    const accountNameMap = await getAccountNameMap(owner, codes);

    const asientoUI = mapEntryForUI(asiento, accountNameMap);

    // ✅ numeroAsiento “real” si existe; si no, fallback a _id
    const numeroAsiento = asientoUI.numeroAsiento || String(asiento._id);

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
