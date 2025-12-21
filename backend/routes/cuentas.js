// backend/routes/cuentas.js
const express = require("express");
const router = express.Router();

const ensureAuth = require("../middleware/ensureAuth");
const Account = require("../models/Account");

/**
 * GET /api/cuentas
 * Lista cuentas contables del usuario (owner)
 * Query opcional:
 *  - active=true|false (filtra por isActive)
 */
router.get("/", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;

    const q = { owner };
    if (typeof req.query.active !== "undefined") {
      q.isActive = String(req.query.active) === "true";
    }

    // Orden por code (ej: "4001", "1001", etc.)
    const items = await Account.find(q).sort({ code: 1 }).lean();

    return res.json({ ok: true, data: items });
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
 * Body:
 *  - code: string (ej "4001")
 *  - name: string (ej "Ventas")
 *  - type: "activo"|"pasivo"|"capital"|"ingreso"|"gasto"|"orden"
 *  - category?: string
 *  - parentCode?: string|null
 */
router.post("/", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;

    const { code, name, type, category, parentCode } = req.body || {};

    // Validaciones mínimas
    if (!code || !String(code).trim()) {
      return res.status(400).json({ ok: false, message: "Falta 'code'." });
    }
    if (!name || !String(name).trim()) {
      return res.status(400).json({ ok: false, message: "Falta 'name'." });
    }
    if (!type || !String(type).trim()) {
      return res.status(400).json({ ok: false, message: "Falta 'type'." });
    }

    const doc = await Account.create({
      owner,
      code: String(code).trim(),
      name: String(name).trim(),
      type: String(type).trim(),
      category: category ? String(category).trim() : "general",
      parentCode: parentCode ? String(parentCode).trim() : null,
      isDefault: false,
      isActive: true,
    });

    return res.status(201).json({ ok: true, data: doc });
  } catch (err) {
    // Manejo de duplicados por índice unique {owner, code}
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

    return res.json({ ok: true, data: updated });
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
 * Elimina una cuenta del usuario (owner)
 * (Nota: si después quieres integridad contable, aquí se cambia a soft-delete)
 */
router.delete("/:id", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;
    const { id } = req.params;

    const deleted = await Account.findOneAndDelete({ _id: id, owner }).lean();
    if (!deleted) {
      return res.status(404).json({ ok: false, message: "Cuenta no encontrada." });
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/cuentas/:id error:", err);
    return res.status(500).json({ ok: false, message: "Error eliminando cuenta" });
  }
});

module.exports = router;
