// backend/routes/subcuentas.js
const express = require("express");
const router = express.Router();

const ensureAuth = require("../middleware/ensureAuth");
const Account = require("../models/Account");

/**
 * GET /api/subcuentas
 * Query opcional:
 *  - parentCode=XXXX (o parent_code=XXXX)
 *  - active=true|false (o activo=true|false)
 */
router.get("/", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;

    const parentCodeParam = req.query.parentCode ?? req.query.parent_code;

    const q = {
      owner,
      parentCode: { $exists: true, $ne: null },
    };

    if (parentCodeParam) {
      q.parentCode = String(parentCodeParam).trim();
    }

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

    const data = items.map((a) => ({
      ...a,
      codigo: a.code,
      nombre: a.name,
    }));

    return res.json({ ok: true, data });
  } catch (err) {
    console.error("GET /api/subcuentas error:", err);
    return res.status(500).json({ ok: false, message: "Error cargando subcuentas" });
  }
});

module.exports = router;
