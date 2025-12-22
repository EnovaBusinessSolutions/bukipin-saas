const express = require("express");
const router = express.Router();
const JournalEntry = require("../models/JournalEntry"); // ajusta ruta/nombre si difiere
const ensureAuthenticated = require("../middleware/ensureAuthenticated"); // ajusta si se llama distinto

// GET /api/asientos/by-transaccion?source=ingresos&id=XXXXXXXX
router.get("/by-transaccion", ensureAuthenticated, async (req, res) => {
  try {
    const { source, id } = req.query;
    if (!source || !id) {
      return res.status(400).json({ ok: false, error: "MISSING_PARAMS", details: "source e id son requeridos" });
    }

    // Multi-tenant
    const owner = req.user._id;

    // 👇 AJUSTA estos campos al schema real de JournalEntry.
    // Intentamos cubrir varias formas comunes:
    const asiento =
      (await JournalEntry.findOne({ owner, source, transaccionId: id }).sort({ createdAt: -1 })) ||
      (await JournalEntry.findOne({ owner, source, transaccion_id: id }).sort({ createdAt: -1 })) ||
      (await JournalEntry.findOne({ owner, "references.source": source, "references.id": id }).sort({ createdAt: -1 }));

    if (!asiento) {
      // Si no hay asiento aún, devolvemos 404 "limpio"
      return res.status(404).json({ ok: false, error: "NOT_FOUND" });
    }

    return res.json({ ok: true, data: asiento });
  } catch (e) {
    console.error("GET /api/asientos/by-transaccion error:", e);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

module.exports = router;
