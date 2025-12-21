// backend/routes/subcuentas.js
const express = require("express");
const router = express.Router();

const ensureAuth = require("../middleware/ensureAuth");
const Account = require("../models/Account");

function normalizeAccountOut(doc) {
  return {
    id: doc._id,
    codigo: doc.codigo ?? doc.code ?? null,
    nombre: doc.nombre ?? doc.name ?? null,
    type: doc.type ?? null,
    category: doc.category ?? "general",
    parentCode: doc.parentCode ?? null,
    isActive: typeof doc.isActive === "boolean" ? doc.isActive : true,
    isDefault: typeof doc.isDefault === "boolean" ? doc.isDefault : false,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

// Soporta montajes:
//  - app.use("/api/subcuentas", router) => GET /
//  - app.use("/api", router)           => GET /subcuentas
const GET_PATHS = ["/", "/subcuentas"];

/**
 * GET /api/subcuentas
 * Query opcional:
 *  - parentCode=XXXX  -> filtra subcuentas de una cuenta padre
 *  - active=true|false -> filtra por isActive
 */
router.get(GET_PATHS, ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;

    const q = {
      owner,
      parentCode: { $exists: true, $ne: null },
    };

    if (req.query.parentCode) q.parentCode = String(req.query.parentCode).trim();

    if (typeof req.query.active !== "undefined") {
      q.isActive = String(req.query.active) === "true";
    }

    const items = await Account.find(q).sort({ codigo: 1, code: 1 }).lean();
    return res.json({ ok: true, data: items.map(normalizeAccountOut) });
  } catch (err) {
    console.error("GET /api/subcuentas error:", err);
    return res.status(500).json({ ok: false, message: "Error cargando subcuentas" });
  }
});

module.exports = router;
