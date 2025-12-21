// backend/routes/clientes.js
const express = require("express");
const router = express.Router();

const ensureAuth = require("../middleware/ensureAuth");
const Client = require("../models/Client");

function boolFromQuery(v) {
  if (typeof v === "undefined") return undefined;
  const s = String(v).toLowerCase();
  return s === "true" || s === "1" || s === "yes";
}

/**
 * GET /api/clientes
 * Query opcional:
 * - q=texto (busca por nombre/email/rfc)
 * - activo=true|false
 * - limit=500
 */
router.get("/", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;

    const qText = req.query.q ? String(req.query.q).trim() : "";
    const activo = boolFromQuery(req.query.activo);
    const limit = Math.min(2000, Number(req.query.limit || 500));

    const q = { owner };

    if (typeof activo !== "undefined") {
      // soporta activo o isActive dependiendo de tu schema
      q.$or = [{ activo }, { isActive: activo }];
    }

    if (qText) {
      q.$and = q.$and || [];
      q.$and.push({
        $or: [
          { nombre: { $regex: qText, $options: "i" } },
          { name: { $regex: qText, $options: "i" } },
          { email: { $regex: qText, $options: "i" } },
          { rfc: { $regex: qText, $options: "i" } },
          { telefono: { $regex: qText, $options: "i" } },
          { phone: { $regex: qText, $options: "i" } },
        ],
      });
    }

    const items = await Client.find(q).sort({ createdAt: -1 }).limit(limit).lean();
    return res.json({ ok: true, data: items });
  } catch (err) {
    console.error("GET /api/clientes error:", err);
    return res.status(500).json({ ok: false, message: "Error cargando clientes" });
  }
});

/**
 * POST /api/clientes
 * Body mínimo:
 * - nombre
 * Opcional:
 * - email, rfc, telefono, direccion, activo
 */
router.post("/", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;

    const nombre = (req.body?.nombre ?? req.body?.name ?? "").toString().trim();
    const email = (req.body?.email ?? "").toString().trim();
    const rfc = (req.body?.rfc ?? "").toString().trim();
    const telefono = (req.body?.telefono ?? req.body?.phone ?? "").toString().trim();
    const direccion = (req.body?.direccion ?? req.body?.address ?? "").toString();

    const activoRaw = req.body?.activo ?? req.body?.isActive;
    const activo = typeof activoRaw === "undefined" ? true : Boolean(activoRaw);

    if (!nombre) {
      return res.status(400).json({ ok: false, message: "El nombre es requerido." });
    }

    const created = await Client.create({
      owner,
      nombre,
      email,
      rfc,
      telefono,
      direccion,
      activo,
    });

    return res.status(201).json({ ok: true, data: created });
  } catch (err) {
    if (err && err.code === 11000) {
      return res.status(409).json({
        ok: false,
        message: "Ya existe un cliente con ese RFC/email para este usuario.",
      });
    }
    console.error("POST /api/clientes error:", err);
    return res.status(500).json({ ok: false, message: "Error creando cliente" });
  }
});

/**
 * PUT /api/clientes/:id
 */
router.put("/:id", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;
    const { id } = req.params;

    const allowed = ["nombre", "email", "rfc", "telefono", "direccion", "activo"];
    const patch = {};

    for (const k of allowed) {
      if (typeof req.body?.[k] !== "undefined") patch[k] = req.body[k];
    }

    if (typeof patch.nombre !== "undefined") patch.nombre = String(patch.nombre).trim();
    if (typeof patch.email !== "undefined") patch.email = String(patch.email).trim();
    if (typeof patch.rfc !== "undefined") patch.rfc = String(patch.rfc).trim();
    if (typeof patch.telefono !== "undefined") patch.telefono = String(patch.telefono).trim();

    const updated = await Client.findOneAndUpdate(
      { _id: id, owner },
      { $set: patch },
      { new: true }
    ).lean();

    if (!updated) {
      return res.status(404).json({ ok: false, message: "Cliente no encontrado." });
    }

    return res.json({ ok: true, data: updated });
  } catch (err) {
    if (err && err.code === 11000) {
      return res.status(409).json({
        ok: false,
        message: "Conflicto: cliente duplicado para este usuario.",
      });
    }
    console.error("PUT /api/clientes/:id error:", err);
    return res.status(500).json({ ok: false, message: "Error actualizando cliente" });
  }
});

/**
 * DELETE /api/clientes/:id
 */
router.delete("/:id", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;
    const { id } = req.params;

    const deleted = await Client.findOneAndDelete({ _id: id, owner }).lean();
    if (!deleted) {
      return res.status(404).json({ ok: false, message: "Cliente no encontrado." });
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/clientes/:id error:", err);
    return res.status(500).json({ ok: false, message: "Error eliminando cliente" });
  }
});

module.exports = router;
