// backend/routes/cuentas.js
const express = require("express");
const router = express.Router();

const ensureAuth = require("../middleware/ensureAuth");
const Account = require("../models/Account");

/**
 * GET /api/cuentas
 * Lista cuentas contables del usuario (owner)
 * Query opcional:
 *  - active=true|false  (o activo=true|false) filtra por isActive
 */
router.get("/", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;

    const q = { owner };

    const activeParam =
      typeof req.query.active !== "undefined"
        ? req.query.active
        : typeof req.query.activo !== "undefined"
          ? req.query.activo
          : undefined;

    if (typeof activeParam !== "undefined") {
      q.isActive = String(activeParam) === "true";
    }

    const items = await Account.find(q).sort({ code: 1 }).lean();

    // Alias para compat con UI vieja (codigo/nombre)
    const data = items.map((a) => ({
      ...a,
      codigo: a.code,
      nombre: a.name,
    }));

    return res.json({ ok: true, data });
  } catch (err) {
    console.error("GET /api/cuentas error:", err);
    return res.status(500).json({
      ok: false,
      message: "Error cargando cuentas",
    });
  }
});

/**
 * POST /api/cuentas
 * Crea una cuenta contable custom (no sembrada)
 * Body (compat):
 *  - code | codigo
 *  - name | nombre
 *  - type
 *  - category?
 *  - parentCode? (o parent_code?)
 */
router.post("/", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;

    const body = req.body || {};

    const codeRaw = body.code ?? body.codigo;
    const nameRaw = body.name ?? body.nombre;

    const typeRaw = body.type;
    const categoryRaw = body.category;
    const parentCodeRaw = body.parentCode ?? body.parent_code ?? null;

    if (!codeRaw || !String(codeRaw).trim()) {
      return res.status(400).json({ ok: false, message: "Falta 'code' (o 'codigo')." });
    }
    if (!nameRaw || !String(nameRaw).trim()) {
      return res.status(400).json({ ok: false, message: "Falta 'name' (o 'nombre')." });
    }
    if (!typeRaw || !String(typeRaw).trim()) {
      return res.status(400).json({ ok: false, message: "Falta 'type'." });
    }

    const doc = await Account.create({
      owner,
      code: String(codeRaw).trim(),
      name: String(nameRaw).trim(),
      type: String(typeRaw).trim(),
      category: categoryRaw ? String(categoryRaw).trim() : "general",
      parentCode: parentCodeRaw ? String(parentCodeRaw).trim() : null,
      isDefault: false,
      isActive: true,
    });

    return res.status(201).json({
      ok: true,
      data: { ...doc.toObject(), codigo: doc.code, nombre: doc.name },
    });
  } catch (err) {
    if (err && err.code === 11000) {
      return res.status(409).json({
        ok: false,
        message: "Ya existe una cuenta con ese código para este usuario.",
      });
    }

    console.error("POST /api/cuentas error:", err);
    return res.status(500).json({
      ok: false,
      message: "Error creando cuenta",
    });
  }
});

/**
 * PUT /api/cuentas/:id
 * Actualiza una cuenta del usuario (owner)
 */
router.put("/:id", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;
    const { id } = req.params;

    const allowed = ["code", "name", "type", "category", "parentCode", "isActive"];
    const patch = {};

    for (const k of allowed) {
      if (typeof req.body?.[k] !== "undefined") patch[k] = req.body[k];
    }

    // Compat si frontend manda "codigo/nombre"
    if (typeof req.body?.codigo !== "undefined") patch.code = req.body.codigo;
    if (typeof req.body?.nombre !== "undefined") patch.name = req.body.nombre;

    if (typeof patch.code !== "undefined") patch.code = String(patch.code).trim();
    if (typeof patch.name !== "undefined") patch.name = String(patch.name).trim();
    if (typeof patch.type !== "undefined") patch.type = String(patch.type).trim();
    if (typeof patch.category !== "undefined") patch.category = String(patch.category).trim();
    if (typeof patch.parentCode !== "undefined") {
      patch.parentCode = patch.parentCode ? String(patch.parentCode).trim() : null;
    }

    const updated = await Account.findOneAndUpdate(
      { _id: id, owner },
      { $set: patch },
      { new: true }
    ).lean();

    if (!updated) {
      return res.status(404).json({ ok: false, message: "Cuenta no encontrada." });
    }

    return res.json({
      ok: true,
      data: { ...updated, codigo: updated.code, nombre: updated.name },
    });
  } catch (err) {
    if (err && err.code === 11000) {
      return res.status(409).json({
        ok: false,
        message: "Ya existe una cuenta con ese código para este usuario.",
      });
    }

    console.error("PUT /api/cuentas/:id error:", err);
    return res.status(500).json({ ok: false, message: "Error actualizando cuenta" });
  }
});

/**
 * DELETE /api/cuentas/:id
 * (Recomendado) No borrar default. Si quieres, cambia a soft-delete.
 */
router.delete("/:id", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;
    const { id } = req.params;

    const found = await Account.findOne({ _id: id, owner }).lean();
    if (!found) {
      return res.status(404).json({ ok: false, message: "Cuenta no encontrada." });
    }

    if (found.isDefault) {
      return res.status(400).json({
        ok: false,
        message: "No puedes eliminar una cuenta por defecto del sistema.",
      });
    }

    await Account.deleteOne({ _id: id, owner });
    return res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/cuentas/:id error:", err);
    return res.status(500).json({ ok: false, message: "Error eliminando cuenta" });
  }
});

module.exports = router;
