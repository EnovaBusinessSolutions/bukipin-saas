// backend/routes/productosEgresos.js
const express = require("express");
const router = express.Router();
const ensureAuth = require("../middleware/ensureAuth");

// ✅ Endpoint mínimo para que el frontend deje de recibir 404
// GET /api/productos-egresos?activo=true
router.get("/", ensureAuth, async (req, res) => {
  try {
    // Mientras conectamos el modelo real, devolvemos compat:
    // - items: []
    // - data: []
    // - costos/gastos: [] (por si la UI lo espera separado)
    return res.json({
      ok: true,
      data: [],
      items: [],
      costos: [],
      gastos: [],
    });
  } catch (err) {
    console.error("GET /api/productos-egresos error:", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

module.exports = router;
