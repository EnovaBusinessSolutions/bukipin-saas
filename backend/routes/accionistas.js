// backend/routes/accionistas.js
const express = require("express");
const mongoose = require("mongoose");
const ensureAuth = require("../middleware/ensureAuth");
const Shareholder = require("../models/Shareholder");

const router = express.Router();

function asTrim(v, def = "") {
  if (v === undefined || v === null) return def;
  return String(v).trim();
}

function toNum(v, def = 0) {
  const n = Number(String(v ?? "").replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : def;
}

function asBool(v, def = null) {
  if (v === undefined || v === null || v === "") return def;
  const s = String(v).trim().toLowerCase();
  if (["true", "1", "yes", "y", "si", "sí"].includes(s)) return true;
  if (["false", "0", "no", "n"].includes(s)) return false;
  return def;
}

function isValidObjectId(v) {
  return mongoose.Types.ObjectId.isValid(asTrim(v, ""));
}

function normalizeItem(doc) {
  return doc?.toJSON ? doc.toJSON() : doc;
}

/**
 * GET /api/accionistas
 * GET /api/accionistas?include_inactive=1
 */
router.get("/", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;
    const includeInactive =
      String(req.query.include_inactive || req.query.includeInactive || "0").trim() === "1" ||
      String(req.query.all || "0").trim() === "1";

    const q = asTrim(req.query.q, "");
    const wrap = String(req.query.wrap || "").trim() === "1";

    const filter = { owner };
    if (!includeInactive) filter.activo = true;

    if (q) {
      filter.$or = [
        { nombre: { $regex: q, $options: "i" } },
        { email: { $regex: q, $options: "i" } },
        { telefono: { $regex: q, $options: "i" } },
        { rfc: { $regex: q, $options: "i" } },
      ];
    }

    const docs = await Shareholder.find(filter).sort({ nombre: 1, createdAt: -1 });
    const items = docs.map(normalizeItem);

    if (!wrap) return res.json(items);
    return res.json({ ok: true, data: items, items });
  } catch (err) {
    console.error("GET /api/accionistas error:", err);
    return res.status(500).json({
      ok: false,
      error: "SERVER_ERROR",
      message: err?.message || "SERVER_ERROR",
    });
  }
});

/**
 * POST /api/accionistas
 */
router.post("/", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;

    const nombre = asTrim(req.body?.nombre);
    const porcentaje = Math.max(
      0,
      Math.min(
        100,
        toNum(req.body?.porcentaje_participacion ?? req.body?.porcentajeParticipacion, 0)
      )
    );

    if (!nombre) {
      return res.status(400).json({
        ok: false,
        error: "VALIDATION",
        message: "nombre es requerido.",
      });
    }

    const created = await Shareholder.create({
      owner,
      nombre,
      porcentaje_participacion: porcentaje,
      email: asTrim(req.body?.email, ""),
      telefono: asTrim(req.body?.telefono, ""),
      rfc: asTrim(req.body?.rfc, ""),
      activo: true,
    });

    const item = normalizeItem(created);
    return res.status(201).json({ ok: true, data: item, item, ...item });
  } catch (err) {
    console.error("POST /api/accionistas error:", err);
    return res.status(500).json({
      ok: false,
      error: "SERVER_ERROR",
      message: err?.message || "SERVER_ERROR",
    });
  }
});

/**
 * PATCH /api/accionistas/:id
 */
router.patch("/:id", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;
    const id = asTrim(req.params.id, "");

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        ok: false,
        error: "VALIDATION",
        message: "id inválido",
      });
    }

    const current = await Shareholder.findOne({ _id: id, owner });
    if (!current) {
      return res.status(404).json({ ok: false, error: "NOT_FOUND" });
    }

    const patch = {};

    if (req.body?.nombre !== undefined) {
      patch.nombre = asTrim(req.body?.nombre, "");
      if (!patch.nombre) {
        return res.status(400).json({
          ok: false,
          error: "VALIDATION",
          message: "nombre no puede ir vacío.",
        });
      }
    }

    if (req.body?.porcentaje_participacion !== undefined || req.body?.porcentajeParticipacion !== undefined) {
      patch.porcentaje_participacion = Math.max(
        0,
        Math.min(
          100,
          toNum(req.body?.porcentaje_participacion ?? req.body?.porcentajeParticipacion, 0)
        )
      );
    }

    if (req.body?.email !== undefined) patch.email = asTrim(req.body?.email, "");
    if (req.body?.telefono !== undefined) patch.telefono = asTrim(req.body?.telefono, "");
    if (req.body?.rfc !== undefined) patch.rfc = asTrim(req.body?.rfc, "");
    if (req.body?.activo !== undefined) patch.activo = asBool(req.body?.activo, true) !== false;

    const updated = await Shareholder.findOneAndUpdate(
      { _id: id, owner },
      { $set: patch },
      { new: true }
    );

    const item = normalizeItem(updated);
    return res.json({ ok: true, data: item, item, ...item });
  } catch (err) {
    console.error("PATCH /api/accionistas/:id error:", err);
    return res.status(500).json({
      ok: false,
      error: "SERVER_ERROR",
      message: err?.message || "SERVER_ERROR",
    });
  }
});

/**
 * DELETE /api/accionistas/:id
 * Soft delete -> activo:false
 */
router.delete("/:id", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;
    const id = asTrim(req.params.id, "");

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        ok: false,
        error: "VALIDATION",
        message: "id inválido",
      });
    }

    const updated = await Shareholder.findOneAndUpdate(
      { _id: id, owner },
      { $set: { activo: false } },
      { new: true }
    );

    if (!updated) {
      return res.status(404).json({ ok: false, error: "NOT_FOUND" });
    }

    const item = normalizeItem(updated);
    return res.json({
      ok: true,
      data: item,
      item,
      message: "Accionista dado de baja correctamente",
    });
  } catch (err) {
    console.error("DELETE /api/accionistas/:id error:", err);
    return res.status(500).json({
      ok: false,
      error: "SERVER_ERROR",
      message: err?.message || "SERVER_ERROR",
    });
  }
});

module.exports = router;