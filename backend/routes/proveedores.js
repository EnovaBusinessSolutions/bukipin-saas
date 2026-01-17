// backend/routes/proveedores.js
const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const ensureAuth = require("../middleware/ensureAuth");

// =========================
// Model (safe/fallback)
// =========================
function getProveedorModel() {
  if (mongoose.models.Proveedor) return mongoose.models.Proveedor;
  if (mongoose.models.Provider) return mongoose.models.Provider;

  const ProveedorSchema = new mongoose.Schema(
    {
      owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },

      nombre: { type: String, required: true, trim: true, index: true },

      rfc: { type: String, trim: true, default: "" },
      email: { type: String, trim: true, default: "" },
      telefono: { type: String, trim: true, default: "" },

      direccion: { type: String, trim: true, default: "" },
      notas: { type: String, trim: true, default: "" },

      activo: { type: Boolean, default: true, index: true },
    },
    { timestamps: true }
  );

  ProveedorSchema.index({ owner: 1, nombre: 1 });
  ProveedorSchema.index({ owner: 1, activo: 1 });

  // Nombre de colección: "proveedors" (mongoose default) -> ok
  return mongoose.model("Proveedor", ProveedorSchema);
}

const Proveedor = getProveedorModel();

// =========================
// Helpers
// =========================
function asBool(v, def = null) {
  if (v === undefined || v === null || v === "") return def;
  const s = String(v).trim().toLowerCase();
  if (["true", "1", "yes", "y", "si"].includes(s)) return true;
  if (["false", "0", "no", "n"].includes(s)) return false;
  return def;
}

function asTrim(v, def = "") {
  if (v === undefined || v === null) return def;
  return String(v).trim();
}

function mapProveedorForUI(doc) {
  const d = doc?.toObject ? doc.toObject() : doc;

  return {
    id: String(d._id),
    _id: d._id,

    nombre: d.nombre || "",
    rfc: d.rfc || "",
    email: d.email || "",
    telefono: d.telefono || "",
    direccion: d.direccion || "",
    notas: d.notas || "",

    activo: !!d.activo,

    created_at: d.createdAt || null,
    updated_at: d.updatedAt || null,

    // compat camelCase por si algún componente lo usa
    createdAt: d.createdAt || null,
    updatedAt: d.updatedAt || null,
  };
}

// =========================
// Routes
// =========================

/**
 * GET /api/proveedores?activo=true&search=abc
 * ✅ Devuelve ARRAY (lo que típicamente espera el FE)
 * Soporta wrap=1 => {ok,data}
 */
router.get("/", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;
    const wrap = String(req.query.wrap || "").trim() === "1";

    const activo = asBool(req.query.activo, null);
    const search = asTrim(req.query.search, "");

    const filter = { owner };
    if (activo !== null) filter.activo = activo;

    if (search) {
      // búsqueda simple por nombre (case-insensitive)
      filter.nombre = { $regex: search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
    }

    const docs = await Proveedor.find(filter).sort({ nombre: 1 }).lean();
    const items = docs.map(mapProveedorForUI);

    if (!wrap) return res.json(items);
    return res.json({ ok: true, data: items, items });
  } catch (err) {
    console.error("GET /api/proveedores error:", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

/**
 * GET /api/proveedores/:id
 */
router.get("/:id", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;
    const id = asTrim(req.params.id, "");

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ ok: false, error: "VALIDATION", message: "id inválido" });
    }

    const doc = await Proveedor.findOne({ _id: id, owner }).lean();
    if (!doc) return res.status(404).json({ ok: false, error: "NOT_FOUND" });

    const item = mapProveedorForUI(doc);
    return res.json({ ok: true, data: item, item, ...item });
  } catch (err) {
    console.error("GET /api/proveedores/:id error:", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

/**
 * POST /api/proveedores
 * body: { nombre, rfc?, email?, telefono?, direccion?, notas?, activo? }
 */
router.post("/", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;

    const nombre = asTrim(req.body?.nombre);
    const rfc = asTrim(req.body?.rfc, "");
    const email = asTrim(req.body?.email, "");
    const telefono = asTrim(req.body?.telefono, "");
    const direccion = asTrim(req.body?.direccion, "");
    const notas = asTrim(req.body?.notas, "");
    const activo = asBool(req.body?.activo, true);

    if (!nombre) {
      return res.status(400).json({ ok: false, error: "VALIDATION", message: "nombre es requerido." });
    }

    const created = await Proveedor.create({
      owner,
      nombre,
      rfc,
      email,
      telefono,
      direccion,
      notas,
      activo: activo !== null ? activo : true,
    });

    const item = mapProveedorForUI(created);
    return res.status(201).json({ ok: true, data: item, item, ...item });
  } catch (err) {
    console.error("POST /api/proveedores error:", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR", message: err?.message || "SERVER_ERROR" });
  }
});

/**
 * PATCH /api/proveedores/:id
 * body: partial updates
 */
router.patch("/:id", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;
    const id = asTrim(req.params.id, "");

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ ok: false, error: "VALIDATION", message: "id inválido" });
    }

    const patch = {};

    if (req.body?.nombre !== undefined) patch.nombre = asTrim(req.body?.nombre, "");
    if (req.body?.rfc !== undefined) patch.rfc = asTrim(req.body?.rfc, "");
    if (req.body?.email !== undefined) patch.email = asTrim(req.body?.email, "");
    if (req.body?.telefono !== undefined) patch.telefono = asTrim(req.body?.telefono, "");
    if (req.body?.direccion !== undefined) patch.direccion = asTrim(req.body?.direccion, "");
    if (req.body?.notas !== undefined) patch.notas = asTrim(req.body?.notas, "");
    if (req.body?.activo !== undefined) patch.activo = asBool(req.body?.activo, true);

    if (patch.nombre !== undefined && !patch.nombre) {
      return res.status(400).json({ ok: false, error: "VALIDATION", message: "nombre no puede ir vacío." });
    }

    const updated = await Proveedor.findOneAndUpdate({ _id: id, owner }, patch, { new: true }).lean();
    if (!updated) return res.status(404).json({ ok: false, error: "NOT_FOUND" });

    const item = mapProveedorForUI(updated);
    return res.json({ ok: true, data: item, item, ...item });
  } catch (err) {
    console.error("PATCH /api/proveedores/:id error:", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR", message: err?.message || "SERVER_ERROR" });
  }
});

/**
 * DELETE /api/proveedores/:id
 * (hard delete opcional; si prefieres soft delete, usa PATCH activo:false)
 */
router.delete("/:id", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;
    const id = asTrim(req.params.id, "");

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ ok: false, error: "VALIDATION", message: "id inválido" });
    }

    const deleted = await Proveedor.findOneAndDelete({ _id: id, owner }).lean();
    if (!deleted) return res.status(404).json({ ok: false, error: "NOT_FOUND" });

    return res.json({ ok: true, data: { id }, id });
  } catch (err) {
    console.error("DELETE /api/proveedores/:id error:", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

module.exports = router;
