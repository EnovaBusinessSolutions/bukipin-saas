// backend/routes/egresos.js
const express = require("express");
const router = express.Router();

// Reusamos tu router actual
const transaccionesEgresosRouter = require("./transaccionesEgresos");

// ✅ /api/egresos/transacciones  -> (GET/POST)
// ✅ /api/egresos/transacciones/:id -> (GET)
router.use("/transacciones", transaccionesEgresosRouter);

module.exports = router;
