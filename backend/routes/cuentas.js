// backend/routes/cuentas.js
const express = require("express");
const router = express.Router();

const ensureAuth = require("../middleware/ensureAuth");
const Account = require("../models/Account");

const ALLOWED_TYPES = new Set(["activo", "pasivo", "capital", "ingreso", "gasto", "orden"]);

function normStr(v) {
  return String(v ?? "").trim();
}

function isDigits(str) {
  return /^\d+$/.test(str);
}

/**
 * GET /api/cuentas
 * Lista cuentas contables del usuario (owner)
 * Query opcional:
 *  - active=true|false (filtra por isActive)
 */
router.get("/cuentas", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;

    const q = { owner };
    if (typeof req.query.active !== "undefined") {
      q.isActive = String(req.query.active) === "true";
    }

    const items = await Account.find(q).sort({ code: 1 }).lean();
    return res.json({ ok: true, data: items });
  } catch (err) {
    console.error("GET /api/cuentas error:", err);
    return res.status(500).json({ ok: false, message: "Error cargando cuentas" });
  }
});

/**
 * GET /api/cuentas/:id
 * Devuelve una cuenta del usuario
 */
router.get("/cuentas/:id", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;
    const { id } = req.params;

    const doc = await Account.findOne({ _id: id, owner }).lean();
    if (!doc) return res.status(404).json({ ok: false, message: "Cuenta no encontrada." });

    return res.json({ ok: true, data: doc });
  } catch (err) {
    console.error("GET /api/cuentas/:id error:", err);
    return res.status(500).json({ ok: false, message: "Error cargando cuenta" });
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
router.post("/cuentas", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;

    const code = normStr(req.body?.code);
    const name = normStr(req.body?.name);
    const type = normStr(req.body?.type);
    const category = normStr(req.body?.category) || "general";
    const parentCodeRaw = req.body?.parentCode;

    if (!code) return res.status(400).json({ ok: false, message: "Falta 'code'." });
    if (!isDigits(code)) {
      return res.status(400).json({ ok: false, message: "'code' debe contener solo dígitos (ej: 4001)." });
    }

    if (!name) return res.status(400).json({ ok: false, message: "Falta 'name'." });

    if (!type) return res.status(400).json({ ok: false, message: "Falta 'type'." });
    if (!ALLOWED_TYPES.has(type)) {
      return res.status(400).json({
        ok: false,
        message: `Tipo inválido. Usa: ${Array.from(ALLOWED_TYPES).join(", ")}.`,
      });
    }

    const parentCode = parentCodeRaw ? normStr(parentCodeRaw) : null;

    // Si mandan parentCode, validamos que exista y sea del mismo owner
    if (parentCode) {
      if (!isDigits(parentCode)) {
        return res.status(400).json({ ok: false, message: "'parentCode' debe contener solo dígitos." });
      }
      const parent = await Account.findOne({ owner, code: parentCode }).lean();
      if (!parent) {
        return res.status(400).json({ ok: false, message: "parentCode no existe para este usuario." });
      }
    }

    const doc = await Account.create({
      owner,
      code,
      name,
      type,
      category,
      parentCode,
      isDefault: false,
      isActive: true,
    });

    return res.status(201).json({ ok: true, data: doc });
  } catch (err) {
    if (err && err.code === 11000) {
      return res.status(409).json({
        ok: false,
        message: "Ya existe una cuenta con ese código para este usuario.",
      });
    }

    console.error("POST /api/cuentas error:", err);
    return res.status(500).json({ ok: false, message: "Error creando cuenta" });
  }
});

/**
 * PUT /api/cuentas/:id
 * Actualiza una cuenta del usuario (owner)
 * Nota: no permitimos modificar isDefault aquí.
 */
router.put("/cuentas/:id", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;
    const { id } = req.params;

    const allowed = ["code", "name", "type", "category", "parentCode", "isActive"];
    const patch = {};

    for (const k of allowed) {
      if (typeof req.body?.[k] !== "undefined") patch[k] = req.body[k];
    }

    if (typeof patch.code !== "undefined") {
      patch.code = normStr(patch.code);
      if (!patch.code) return res.status(400).json({ ok: false, message: "'code' no puede ir vacío." });
      if (!isDigits(patch.code)) {
        return res.status(400).json({ ok: false, message: "'code' debe contener solo dígitos." });
      }
    }

    if (typeof patch.name !== "undefined") {
      patch.name = normStr(patch.name);
      if (!patch.name) return res.status(400).json({ ok: false, message: "'name' no puede ir vacío." });
    }

    if (typeof patch.type !== "undefined") {
      patch.type = normStr(patch.type);
      if (!ALLOWED_TYPES.has(patch.type)) {
        return res.status(400).json({
          ok: false,
          message: `Tipo inválido. Usa: ${Array.from(ALLOWED_TYPES).join(", ")}.`,
        });
      }
    }

    if (typeof patch.category !== "undefined") {
      patch.category = normStr(patch.category) || "general";
    }

    if (typeof patch.parentCode !== "undefined") {
      patch.parentCode = patch.parentCode ? normStr(patch.parentCode) : null;

      if (patch.parentCode) {
        if (!isDigits(patch.parentCode)) {
          return res.status(400).json({ ok: false, message: "'parentCode' debe contener solo dígitos." });
        }
        const parent = await Account.findOne({ owner, code: patch.parentCode }).lean();
        if (!parent) {
          return res.status(400).json({ ok: false, message: "parentCode no existe para este usuario." });
        }
      }
    }

    const updated = await Account.findOneAndUpdate(
      { _id: id, owner },
      { $set: patch },
      { new: true }
    ).lean();

    if (!updated) return res.status(404).json({ ok: false, message: "Cuenta no encontrada." });

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
 * Recomendación: evitar borrar cuentas default (sembradas)
 */
router.delete("/cuentas/:id", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;
    const { id } = req.params;

    const doc = await Account.findOne({ _id: id, owner }).lean();
    if (!doc) return res.status(404).json({ ok: false, message: "Cuenta no encontrada." });

    if (doc.isDefault) {
      return res.status(400).json({
        ok: false,
        message: "No puedes eliminar una cuenta del sistema (isDefault=true). Desactívala en su lugar.",
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
