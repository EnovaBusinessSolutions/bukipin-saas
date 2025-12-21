// backend/routes/subcuentas.js
const express = require("express");
const router = express.Router();

const ensureAuth = require("../middleware/ensureAuth");
const Account = require("../models/Account");

function normStr(v) {
  return String(v ?? "").trim();
}

function isDigits(str) {
  return /^\d+$/.test(str);
}

/**
 * GET /api/subcuentas
 * Devuelve las subcuentas del usuario (owner)
 *
 * Query opcional:
 *  - parentCode=XXXX   -> filtra subcuentas de una cuenta padre específica
 *  - active=true|false -> filtra por isActive
 */
router.get("/subcuentas", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;

    const q = {
      owner,
      // subcuenta = tiene parentCode
      parentCode: { $exists: true, $ne: null },
    };

    const parentCode = req.query.parentCode ? normStr(req.query.parentCode) : null;
    if (parentCode) {
      if (!isDigits(parentCode)) {
        return res.status(400).json({
          ok: false,
          message: "'parentCode' debe contener solo dígitos (ej: 4001).",
        });
      }

      // Validar que exista esa cuenta padre y sea del mismo owner
      const parent = await Account.findOne({ owner, code: parentCode }).lean();
      if (!parent) {
        return res.status(400).json({
          ok: false,
          message: "parentCode no existe para este usuario.",
        });
      }

      q.parentCode = parentCode;
    }

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
 * GET /api/subcuentas/:id
 * Devuelve una subcuenta específica del usuario
 */
router.get("/subcuentas/:id", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;
    const { id } = req.params;

    const doc = await Account.findOne({
      _id: id,
      owner,
      parentCode: { $exists: true, $ne: null },
    }).lean();

    if (!doc) return res.status(404).json({ ok: false, message: "Subcuenta no encontrada." });

    return res.json({ ok: true, data: doc });
  } catch (err) {
    console.error("GET /api/subcuentas/:id error:", err);
    return res.status(500).json({ ok: false, message: "Error cargando subcuenta" });
  }
});

module.exports = router;
