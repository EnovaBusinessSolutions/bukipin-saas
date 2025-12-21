// backend/routes/transacciones.js
const express = require("express");
const router = express.Router();

const ensureAuth = require("../middleware/ensureAuth");
const IncomeTransaction = require("../models/IncomeTransaction");

/**
 * GET /api/transacciones/ingresos/recientes?limit=1000
 */
router.get("/ingresos/recientes", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;
    const limit = Math.min(2000, Number(req.query.limit || 1000));

    // Orden robusto: primero por fecha si existe; fallback createdAt
    const items = await IncomeTransaction.find({ owner })
      .sort({ fecha: -1, createdAt: -1 })
      .limit(limit)
      .lean();

    return res.json({ ok: true, data: items });
  } catch (err) {
    console.error("GET /api/transacciones/ingresos/recientes error:", err);
    return res.status(500).json({
      ok: false,
      message: "Error cargando transacciones recientes",
    });
  }
});

module.exports = router;
