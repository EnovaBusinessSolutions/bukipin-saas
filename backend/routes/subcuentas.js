// backend/routes/subcuentas.js
const express = require("express");
const router = express.Router();

const ensureAuth = require("../middleware/ensureAuth");
const Account = require("../models/Account");

// Helper: normaliza strings
const s = (v) => (typeof v === "string" ? v.trim() : v);

/**
 * GET /api/subcuentas
 * Query opcional:
 *  - parentCode=XXXX
 *  - active=true|false
 */
router.get("/", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;

    const q = {
      owner,
      parentCode: { $exists: true, $ne: null },
    };

    if (req.query.parentCode) q.parentCode = s(String(req.query.parentCode));
    if (typeof req.query.active !== "undefined") {
      q.isActive = String(req.query.active) === "true";
    }

    const items = await Account.find(q).sort({ code: 1 }).lean();
    return res.json({ ok: true, data: items });
  } catch (err) {
    console.error("GET /api/subcuentas error:", err);
    return res.status(500).json({ ok: false, message: "Error cargando subcuentas" });
  }
});

/**
 * POST /api/subcuentas
 * Body:
 *  - code: string
 *  - name: string
 *  - type: string (ej "ingreso"|"gasto"|...)
 *  - parentCode: string (obligatorio)
 *  - category?: string
 */
router.post("/", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;

    const code = s(String(req.body?.code || ""));
    const name = s(String(req.body?.name || ""));
    const type = s(String(req.body?.type || ""));
    const parentCode = s(String(req.body?.parentCode || ""));
    const category = req.body?.category ? s(String(req.body.category)) : "general";

    if (!code) return res.status(400).json({ ok: false, message: "Falta 'code'." });
    if (!name) return res.status(400).json({ ok: false, message: "Falta 'name'." });
    if (!type) return res.status(400).json({ ok: false, message: "Falta 'type'." });
    if (!parentCode) return res.status(400).json({ ok: false, message: "Falta 'parentCode'." });

    // Validar que exista la cuenta padre del mismo usuario
    const parent = await Account.findOne({ owner, code: parentCode }).lean();
    if (!parent) {
      return res.status(404).json({
        ok: false,
        message: `No existe la cuenta padre con code='${parentCode}' para este usuario.`,
      });
    }

    const created = await Account.create({
      owner,
      code,
      name,
      type,
      category,
      parentCode,
      isDefault: false,
      isActive: true,
    });

    return res.status(201).json({ ok: true, data: created });
  } catch (err) {
    if (err && err.code === 11000) {
      return res.status(409).json({
        ok: false,
        message: "Ya existe una subcuenta con ese código para este usuario.",
      });
    }
    console.error("POST /api/subcuentas error:", err);
    return res.status(500).json({ ok: false, message: "Error creando subcuenta" });
  }
});

/**
 * PUT /api/subcuentas/:id
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

    if (typeof patch.code !== "undefined") patch.code = s(String(patch.code));
    if (typeof patch.name !== "undefined") patch.name = s(String(patch.name));
    if (typeof patch.type !== "undefined") patch.type = s(String(patch.type));
    if (typeof patch.category !== "undefined") patch.category = s(String(patch.category));
    if (typeof patch.parentCode !== "undefined") patch.parentCode = patch.parentCode ? s(String(patch.parentCode)) : null;

    // Si te cambian parentCode, valida que exista
    if (typeof patch.parentCode !== "undefined" && patch.parentCode) {
      const parent = await Account.findOne({ owner, code: patch.parentCode }).lean();
      if (!parent) {
        return res.status(404).json({
          ok: false,
          message: `No existe la cuenta padre con code='${patch.parentCode}' para este usuario.`,
        });
      }
    }

    // Aseguramos que siga siendo subcuenta (parentCode no null)
    const updated = await Account.findOneAndUpdate(
      { _id: id, owner, parentCode: { $exists: true, $ne: null } },
      { $set: patch },
      { new: true }
    ).lean();

    if (!updated) {
      return res.status(404).json({ ok: false, message: "Subcuenta no encontrada." });
    }

    return res.json({ ok: true, data: updated });
  } catch (err) {
    if (err && err.code === 11000) {
      return res.status(409).json({
        ok: false,
        message: "Ya existe una subcuenta con ese código para este usuario.",
      });
    }
    console.error("PUT /api/subcuentas/:id error:", err);
    return res.status(500).json({ ok: false, message: "Error actualizando subcuenta" });
  }
});

/**
 * DELETE /api/subcuentas/:id
 * (Luego lo podemos convertir a soft-delete si lo necesitas)
 */
router.delete("/:id", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;
    const { id } = req.params;

    const deleted = await Account.findOneAndDelete({
      _id: id,
      owner,
      parentCode: { $exists: true, $ne: null },
    }).lean();

    if (!deleted) {
      return res.status(404).json({ ok: false, message: "Subcuenta no encontrada." });
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/subcuentas/:id error:", err);
    return res.status(500).json({ ok: false, message: "Error eliminando subcuenta" });
  }
});

module.exports = router;
