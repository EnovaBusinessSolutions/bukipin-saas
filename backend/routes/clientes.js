// backend/routes/clientes.js
const express = require("express");
const router = express.Router();

const ensureAuth = require("../middleware/ensureAuth");
const Client = require("../models/Client");

function boolFromAny(v, defaultValue = undefined) {
  if (typeof v === "undefined" || v === null) return defaultValue;
  if (typeof v === "boolean") return v;

  const s = String(v).toLowerCase().trim();
  if (["true", "1", "yes", "y", "si", "sí"].includes(s)) return true;
  if (["false", "0", "no", "n"].includes(s)) return false;

  return defaultValue;
}

function cleanStr(v) {
  const s = (v ?? "").toString().trim();
  return s ? s : undefined;
}

// ✅ Detecta si el schema tiene un campo (para NO guardar cosas que no existen)
function hasField(field) {
  try {
    return !!Client?.schema?.paths?.[field];
  } catch {
    return false;
  }
}

// ✅ Normaliza respuesta para que el frontend tenga SIEMPRE alias en español + id estable
function normalizeCliente(doc) {
  if (!doc) return doc;

  // doc viene de .lean() (obj) o documento mongoose
  const d = doc?.toObject ? doc.toObject() : doc;

  const id = d?._id ? String(d._id) : String(d?.id ?? "");
  const nombre = d.name ?? d.nombre ?? "";
  const telefono = d.phone ?? d.telefono ?? "";
  const activo = typeof d.isActive !== "undefined" ? d.isActive : (typeof d.activo !== "undefined" ? d.activo : true);

  const createdAt = d.createdAt ?? d.created_at ?? null;
  const updatedAt = d.updatedAt ?? d.updated_at ?? null;

  const out = {
    ...d,

    // ✅ Id canónico para frontend
    id,

    // Canónicos (schema real)
    name: d.name,
    email: d.email,
    phone: d.phone,
    isActive: d.isActive,

    // Aliases para compat con UI
    nombre,
    telefono,
    activo,

    // timestamps compat
    created_at: createdAt,
    updated_at: updatedAt,
  };

  // Campos opcionales (solo si existen en el schema o vienen del doc)
  if (typeof d.rfc !== "undefined") out.rfc = d.rfc;
  if (typeof d.direccion !== "undefined") out.direccion = d.direccion;
  if (typeof d.ciudad !== "undefined") out.ciudad = d.ciudad;
  if (typeof d.estado !== "undefined") out.estado = d.estado;
  if (typeof d.codigo_postal !== "undefined") out.codigo_postal = d.codigo_postal;
  if (typeof d.codigoPostal !== "undefined" && typeof out.codigo_postal === "undefined") out.codigo_postal = d.codigoPostal;

  return out;
}

/**
 * GET /api/clientes
 * Query opcional:
 * - q=texto (busca por nombre/email/phone/rfc si existe)
 * - activo=true|false
 * - limit=500
 */
router.get("/", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;

    const qText = req.query.q ? String(req.query.q).trim() : "";
    const activo = boolFromAny(req.query.activo, undefined);
    const limit = Math.min(2000, Number(req.query.limit || 500));

    const q = { owner };

    // ✅ En schema real solo existe isActive
    if (typeof activo !== "undefined") {
      q.isActive = activo;
    }

    if (qText) {
      const or = [
        { name: { $regex: qText, $options: "i" } },
        { email: { $regex: qText, $options: "i" } },
        { phone: { $regex: qText, $options: "i" } },
      ];

      // ✅ si existe rfc en schema, también buscar
      if (hasField("rfc")) {
        or.push({ rfc: { $regex: qText, $options: "i" } });
      }

      q.$and = q.$and || [];
      q.$and.push({ $or: or });
    }

    const items = await Client.find(q).sort({ createdAt: -1 }).limit(limit).lean();
    const data = (items || []).map(normalizeCliente);

    return res.json({ ok: true, data });
  } catch (err) {
    console.error("GET /api/clientes error:", err);
    return res.status(500).json({ ok: false, message: "Error cargando clientes" });
  }
});

/**
 * POST /api/clientes
 * Body mínimo:
 * - nombre o name
 * Opcional:
 * - email, telefono/phone, activo/isActive
 * - rfc/direccion/ciudad/estado/codigo_postal (solo si existen en schema)
 */
router.post("/", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;

    const name = (req.body?.name ?? req.body?.nombre ?? "").toString().trim();
    const email = cleanStr(req.body?.email);
    const phone = cleanStr(req.body?.phone ?? req.body?.telefono);
    const isActive = boolFromAny(req.body?.isActive ?? req.body?.activo, true);

    if (!name) {
      return res.status(400).json({ ok: false, message: "El nombre del cliente es requerido." });
    }

    // ✅ Guarda SOLO campos existentes en el schema
    const payload = { owner, name, email, phone, isActive };

    if (hasField("rfc")) payload.rfc = cleanStr(req.body?.rfc);
    if (hasField("direccion")) payload.direccion = cleanStr(req.body?.direccion);
    if (hasField("ciudad")) payload.ciudad = cleanStr(req.body?.ciudad);
    if (hasField("estado")) payload.estado = cleanStr(req.body?.estado);
    if (hasField("codigo_postal")) payload.codigo_postal = cleanStr(req.body?.codigo_postal ?? req.body?.codigoPostal);

    const created = await Client.create(payload);

    const createdLean = created.toObject ? created.toObject() : created;
    return res.status(201).json({ ok: true, data: normalizeCliente(createdLean) });
  } catch (err) {
    if (err && err.code === 11000) {
      return res.status(409).json({
        ok: false,
        message: "Ya existe un cliente duplicado para este usuario.",
        key: err.keyValue || undefined,
      });
    }
    console.error("POST /api/clientes error:", err);
    return res.status(500).json({ ok: false, message: "Error creando cliente" });
  }
});

/**
 * PUT /api/clientes/:id
 * Permite actualizar con español/inglés pero guarda canónico
 */
router.put("/:id", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;
    const { id } = req.params;

    const patch = {};

    if (typeof req.body?.name !== "undefined" || typeof req.body?.nombre !== "undefined") {
      const n = (req.body?.name ?? req.body?.nombre ?? "").toString().trim();
      patch.name = n;
    }

    if (typeof req.body?.email !== "undefined") patch.email = cleanStr(req.body.email);

    if (typeof req.body?.phone !== "undefined" || typeof req.body?.telefono !== "undefined") {
      patch.phone = cleanStr(req.body?.phone ?? req.body?.telefono);
    }

    if (typeof req.body?.isActive !== "undefined" || typeof req.body?.activo !== "undefined") {
      patch.isActive = boolFromAny(req.body?.isActive ?? req.body?.activo, true);
    }

    // Campos opcionales (solo si existen en schema)
    if (hasField("rfc") && typeof req.body?.rfc !== "undefined") patch.rfc = cleanStr(req.body.rfc);
    if (hasField("direccion") && typeof req.body?.direccion !== "undefined") patch.direccion = cleanStr(req.body.direccion);
    if (hasField("ciudad") && typeof req.body?.ciudad !== "undefined") patch.ciudad = cleanStr(req.body.ciudad);
    if (hasField("estado") && typeof req.body?.estado !== "undefined") patch.estado = cleanStr(req.body.estado);
    if (hasField("codigo_postal") && (typeof req.body?.codigo_postal !== "undefined" || typeof req.body?.codigoPostal !== "undefined")) {
      patch.codigo_postal = cleanStr(req.body?.codigo_postal ?? req.body?.codigoPostal);
    }

    if (typeof patch.name !== "undefined" && !patch.name) {
      return res.status(400).json({ ok: false, message: "El nombre del cliente es requerido." });
    }

    const updated = await Client.findOneAndUpdate(
      { _id: id, owner },
      { $set: patch },
      { new: true }
    ).lean();

    if (!updated) {
      return res.status(404).json({ ok: false, message: "Cliente no encontrado." });
    }

    return res.json({ ok: true, data: normalizeCliente(updated) });
  } catch (err) {
    if (err && err.code === 11000) {
      return res.status(409).json({
        ok: false,
        message: "Conflicto: cliente duplicado para este usuario.",
        key: err.keyValue || undefined,
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
