const express = require("express");
const router = express.Router();
const JournalEntry = require("../models/JournalEntry"); // ajusta ruta/nombre si difiere
const ensureAuth = require("../middleware/ensureAuth"); // ✅ tu middleware real

// GET /api/asientos/by-transaccion?source=ingreso&id=XXXXXXXX
router.get("/by-transaccion", ensureAuth, async (req, res) => {
  try {
    let { source, id } = req.query;

    source = String(source || "").trim();
    id = String(id || "").trim();

    if (!source || !id) {
      return res.status(400).json({
        ok: false,
        error: "MISSING_PARAMS",
        details: "source e id son requeridos",
      });
    }

    // ✅ Alias mínimo: la UI suele mandar "ingreso"
    // pero si llega "ingresos", lo convertimos.
    // También buscamos ambas variantes para no romper nada.
    const sourceAliases = new Set([source]);
    if (source === "ingresos") sourceAliases.add("ingreso");
    if (source === "ingreso") sourceAliases.add("ingresos");

    // Multi-tenant
    const owner = req.user._id;

    // 👇 Mantenemos tu lógica existente y SOLO agregamos la forma real usada: sourceId
    // Buscamos primero por la forma canónica (sourceId), luego por las variantes legacy.
    const asiento =
      (await JournalEntry.findOne({
        owner,
        source: { $in: Array.from(sourceAliases) },
        sourceId: id, // ✅ principal (lo que usamos en ingresos.js)
      }).sort({ createdAt: -1 })) ||

      (await JournalEntry.findOne({
        owner,
        source: { $in: Array.from(sourceAliases) },
        transaccionId: id,
      }).sort({ createdAt: -1 })) ||

      (await JournalEntry.findOne({
        owner,
        source: { $in: Array.from(sourceAliases) },
        transaccion_id: id,
      }).sort({ createdAt: -1 })) ||

      (await JournalEntry.findOne({
        owner,
        "references.source": { $in: Array.from(sourceAliases) },
        "references.id": id,
      }).sort({ createdAt: -1 }));

    if (!asiento) {
      // 404 limpio
      return res.status(404).json({ ok: false, error: "NOT_FOUND" });
    }

    // ✅ Respuesta compatible: algunos lugares esperan array "asientos"
    return res.json({
      ok: true,
      data: asiento,
      asientos: [asiento],
    });
  } catch (e) {
    console.error("GET /api/asientos/by-transaccion error:", e);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

module.exports = router;
