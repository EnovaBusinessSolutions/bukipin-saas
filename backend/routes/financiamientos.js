// backend/routes/financiamientos.js
const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const ensureAuth = require("../middleware/ensureAuth");

// =========================
// Model (safe/fallback)
// =========================
function getTarjetaModel() {
  if (mongoose.models.TarjetaCredito) return mongoose.models.TarjetaCredito;
  if (mongoose.models.CreditCard) return mongoose.models.CreditCard;

  const TarjetaSchema = new mongoose.Schema(
    {
      owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },

      nombre: { type: String, required: true, trim: true }, // "BBVA Azul"
      banco: { type: String, trim: true, default: "" },

      // opcional: si quieres mostrar "**** 1234"
      ultimos4: { type: String, trim: true, default: "" },

      linea_credito: { type: Number, default: 0 },
      saldo_actual: { type: Number, default: 0 },

      activo: { type: Boolean, default: true, index: true },
    },
    { timestamps: true }
  );

  TarjetaSchema.index({ owner: 1, activo: 1 });

  return mongoose.model("TarjetaCredito", TarjetaSchema);
}

const TarjetaCredito = getTarjetaModel();

// =========================
// Helpers
// =========================
function asTrim(v, def = "") {
  if (v === undefined || v === null) return def;
  return String(v).trim();
}
function asBool(v, def = null) {
  if (v === undefined || v === null || v === "") return def;
  const s = String(v).trim().toLowerCase();
  if (["true", "1", "yes", "y", "si"].includes(s)) return true;
  if (["false", "0", "no", "n"].includes(s)) return false;
  return def;
}
function toNum(v, def = 0) {
  const n = Number(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : def;
}

function mapTarjetaForUI(doc) {
  const d = doc?.toObject ? doc.toObject() : doc;

  return {
    id: String(d._id),
    _id: d._id,

    nombre: d.nombre || "",
    banco: d.banco || "",
    ultimos4: d.ultimos4 || "",

    linea_credito: toNum(d.linea_credito, 0),
    saldo_actual: toNum(d.saldo_actual, 0),

    activo: !!d.activo,

    created_at: d.createdAt || null,
    updated_at: d.updatedAt || null,

    // compat camelCase
    createdAt: d.createdAt || null,
    updatedAt: d.updatedAt || null,
  };
}

// =========================
// Routes
// =========================

/**
 * GET /api/financiamientos/tarjetas-credito?activo=true
 * ✅ Devuelve ARRAY (para el FE)
 * Soporta wrap=1 => {ok,data}
 */
router.get("/tarjetas-credito", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;
    const wrap = String(req.query.wrap || "").trim() === "1";

    const activo = asBool(req.query.activo, null);

    const filter = { owner };
    if (activo !== null) filter.activo = activo;

    const docs = await TarjetaCredito.find(filter).sort({ createdAt: -1 }).lean();
    const items = docs.map(mapTarjetaForUI);

    if (!wrap) return res.json(items);
    return res.json({ ok: true, data: items, items });
  } catch (err) {
    console.error("GET /api/financiamientos/tarjetas-credito error:", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

/**
 * POST /api/financiamientos/tarjetas-credito
 */
router.post("/tarjetas-credito", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;

    const nombre = asTrim(req.body?.nombre);
    const banco = asTrim(req.body?.banco, "");
    const ultimos4 = asTrim(req.body?.ultimos4, "");

    const linea_credito = toNum(req.body?.linea_credito, 0);
    const saldo_actual = toNum(req.body?.saldo_actual, 0);

    const activo = asBool(req.body?.activo, true);

    if (!nombre) {
      return res.status(400).json({ ok: false, error: "VALIDATION", message: "nombre es requerido." });
    }

    const created = await TarjetaCredito.create({
      owner,
      nombre,
      banco,
      ultimos4,
      linea_credito,
      saldo_actual,
      activo: activo !== null ? activo : true,
    });

    const item = mapTarjetaForUI(created);
    return res.status(201).json({ ok: true, data: item, item, ...item });
  } catch (err) {
    console.error("POST /api/financiamientos/tarjetas-credito error:", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR", message: err?.message || "SERVER_ERROR" });
  }
});

/**
 * PATCH /api/financiamientos/tarjetas-credito/:id
 */
router.patch("/tarjetas-credito/:id", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;
    const id = asTrim(req.params.id, "");

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ ok: false, error: "VALIDATION", message: "id inválido" });
    }

    const patch = {};
    if (req.body?.nombre !== undefined) patch.nombre = asTrim(req.body?.nombre, "");
    if (req.body?.banco !== undefined) patch.banco = asTrim(req.body?.banco, "");
    if (req.body?.ultimos4 !== undefined) patch.ultimos4 = asTrim(req.body?.ultimos4, "");

    if (req.body?.linea_credito !== undefined) patch.linea_credito = toNum(req.body?.linea_credito, 0);
    if (req.body?.saldo_actual !== undefined) patch.saldo_actual = toNum(req.body?.saldo_actual, 0);

    if (req.body?.activo !== undefined) patch.activo = asBool(req.body?.activo, true);

    if (patch.nombre !== undefined && !patch.nombre) {
      return res.status(400).json({ ok: false, error: "VALIDATION", message: "nombre no puede ir vacío." });
    }

    const updated = await TarjetaCredito.findOneAndUpdate({ _id: id, owner }, patch, { new: true }).lean();
    if (!updated) return res.status(404).json({ ok: false, error: "NOT_FOUND" });

    const item = mapTarjetaForUI(updated);
    return res.json({ ok: true, data: item, item, ...item });
  } catch (err) {
    console.error("PATCH /api/financiamientos/tarjetas-credito/:id error:", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR", message: err?.message || "SERVER_ERROR" });
  }
});

/**
 * DELETE /api/financiamientos/tarjetas-credito/:id
 * (hard delete; si prefieres soft delete usa PATCH activo:false)
 */
router.delete("/tarjetas-credito/:id", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;
    const id = asTrim(req.params.id, "");

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ ok: false, error: "VALIDATION", message: "id inválido" });
    }

    const deleted = await TarjetaCredito.findOneAndDelete({ _id: id, owner }).lean();
    if (!deleted) return res.status(404).json({ ok: false, error: "NOT_FOUND" });

    return res.json({ ok: true, data: { id }, id });
  } catch (err) {
    console.error("DELETE /api/financiamientos/tarjetas-credito/:id error:", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

module.exports = router;
