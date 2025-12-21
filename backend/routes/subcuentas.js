// backend/routes/subcuentas.js
const express = require("express");
const router = express.Router();

const ensureAuth = require("../middleware/ensureAuth");
const Account = require("../models/Account");

/**
 * GET /api/subcuentas
 * Devuelve las subcuentas del usuario (owner)
 *
 * Query opcional:
 *  - parentCode=XXXX  -> filtra subcuentas de una cuenta padre específica
 *  - active=true|false -> filtra por isActive
 */
router.get("/", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;

    const q = {
      owner,
      // subcuenta = tiene parentCode
      parentCode: { $exists: true, $ne: null },
    };

    if (req.query.parentCode) {
      q.parentCode = String(req.query.parentCode).trim();
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

module.exports = router;
