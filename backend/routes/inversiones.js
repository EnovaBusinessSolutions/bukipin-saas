// backend/routes/inversiones.js
const express = require("express");
const router = express.Router();
const ensureAuth = require("../middleware/ensureAuth");

router.get("/capex", ensureAuth, async (req, res) => {
  try {
    // Compat: si no hay implementación aún, devuelve vacío (sin 404)
    return res.json({ ok: true, data: [], items: [], meta: { pendiente_gt: req.query.pendiente_gt ?? null } });
  } catch (err) {
    console.error("GET /api/inversiones/capex error:", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

module.exports = router;