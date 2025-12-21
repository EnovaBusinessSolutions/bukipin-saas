const express = require("express");
const router = express.Router();
const ensureAuth = require("../middleware/ensureAuth");

// Estos endpoints hoy NO existen todavía.
// Los devolvemos vacíos para que el frontend no reviente mientras migramos.
router.get("/inversiones", ensureAuth, (req, res) => res.json({ ok: true, data: [] }));
router.get("/recomendaciones-depreciacion", ensureAuth, (req, res) => res.json({ ok: true, data: [] }));
router.get("/asientos/depreciaciones", ensureAuth, (req, res) => res.json({ ok: true, data: [] }));

module.exports = router;
