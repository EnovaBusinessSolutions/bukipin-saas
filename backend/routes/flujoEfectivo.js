const express = require("express");
const router = express.Router();

const { ensureAuthenticated } = require("../middleware/ensureAuthenticated");
const {
  getFlujoOperativo,
  getResumenFlujo,
  getTransaccionesFlujo,
} = require("../controllers/flujoEfectivoController");

router.get("/operativo", ensureAuthenticated, getFlujoOperativo);
router.get("/resumen", ensureAuthenticated, getResumenFlujo);
router.get("/transacciones", ensureAuthenticated, getTransaccionesFlujo);

module.exports = router;
