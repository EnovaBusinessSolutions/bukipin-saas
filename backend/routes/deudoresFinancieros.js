const express = require("express");
const mongoose = require("mongoose");
const ensureAuth = require("../middleware/ensureAuth");
const LoanDebtor = require("../models/LoanDebtor");

const router = express.Router();

function asTrim(v, def = "") {
  if (v === undefined || v === null) return def;
  return String(v).trim();
}

function asBool(v, def = null) {
  if (v === undefined || v === null || v === "") return def;
  if (typeof v === "boolean") return v;
  const s = String(v).trim().toLowerCase();
  if (["true", "1", "si", "sí", "yes"].includes(s)) return true;
  if (["false", "0", "no"].includes(s)) return false;
  return def;
}

function isValidObjectId(v) {
  return mongoose.Types.ObjectId.isValid(asTrim(v, ""));
}

function normalizeTipo(v) {
  const s = asTrim(v, "").toLowerCase();
  return s === "empresa" ? "empresa" : "persona";
}

function mapDebtor(doc) {
  const d = doc?.toObject ? doc.toObject() : doc || {};
  return {
    id: String(d._id || ""),
    _id: d._id || null,
    nombre: d.nombre || "",
    rfc: d.rfc || "",
    tipo: d.tipo || "persona",
    contacto: d.contacto || "",
    telefono: d.telefono || "",
    email: d.email || "",
    comentarios: d.comentarios || "",
    activo: d.activo !== false,
    owner: d.owner || null,
    createdAt: d.createdAt || null,
    updatedAt: d.updatedAt || null,
  };
}

router.get("/", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;
    const q = asTrim(req.query.q, "");
    const activo = asBool(req.query.activo, null);
    const filter = { owner };
    if (activo !== null) filter.activo = activo;
    if (q) {
      filter.$or = [
        { nombre: { $regex: q, $options: "i" } },
        { rfc: { $regex: q, $options: "i" } },
        { contacto: { $regex: q, $options: "i" } },
      ];
    }
    const docs = await LoanDebtor.find(filter).sort({ nombre: 1, createdAt: -1 }).lean();
    const items = docs.map(mapDebtor);
    return res.json({ ok: true, data: items, items });
  } catch (err) {
    console.error("GET /api/deudores-financieros error:", err);
    return res.status(500).json({ ok: false, message: err?.message || "SERVER_ERROR" });
  }
});

router.post("/", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;
    const nombre = asTrim(req.body?.nombre);
    if (!nombre) {
      return res.status(400).json({ ok: false, message: "nombre es requerido." });
    }
    const doc = await LoanDebtor.create({
      owner,
      nombre,
      rfc: asTrim(req.body?.rfc, "").toUpperCase(),
      tipo: normalizeTipo(req.body?.tipo),
      contacto: asTrim(req.body?.contacto, ""),
      telefono: asTrim(req.body?.telefono, ""),
      email: asTrim(req.body?.email, "").toLowerCase(),
      comentarios: asTrim(req.body?.comentarios, ""),
      activo: asBool(req.body?.activo, true) !== false,
    });
    const item = mapDebtor(doc);
    return res.status(201).json({ ok: true, data: item, item });
  } catch (err) {
    console.error("POST /api/deudores-financieros error:", err);
    return res.status(500).json({ ok: false, message: err?.message || "SERVER_ERROR" });
  }
});

router.patch("/:id", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;
    const id = asTrim(req.params.id, "");
    if (!isValidObjectId(id)) {
      return res.status(400).json({ ok: false, message: "id inválido" });
    }
    const patch = {};
    if (req.body?.nombre !== undefined) patch.nombre = asTrim(req.body.nombre);
    if (req.body?.rfc !== undefined) patch.rfc = asTrim(req.body.rfc).toUpperCase();
    if (req.body?.tipo !== undefined) patch.tipo = normalizeTipo(req.body.tipo);
    if (req.body?.contacto !== undefined) patch.contacto = asTrim(req.body.contacto);
    if (req.body?.telefono !== undefined) patch.telefono = asTrim(req.body.telefono);
    if (req.body?.email !== undefined) patch.email = asTrim(req.body.email).toLowerCase();
    if (req.body?.comentarios !== undefined) patch.comentarios = asTrim(req.body.comentarios);
    if (req.body?.activo !== undefined) patch.activo = asBool(req.body.activo, true) !== false;

    const updated = await LoanDebtor.findOneAndUpdate({ _id: id, owner }, { $set: patch }, { new: true }).lean();
    if (!updated) return res.status(404).json({ ok: false, message: "NOT_FOUND" });
    const item = mapDebtor(updated);
    return res.json({ ok: true, data: item, item });
  } catch (err) {
    console.error("PATCH /api/deudores-financieros/:id error:", err);
    return res.status(500).json({ ok: false, message: err?.message || "SERVER_ERROR" });
  }
});

module.exports = router;
