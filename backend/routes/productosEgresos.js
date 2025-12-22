// backend/routes/productosEgresos.js
const express = require("express");
const router = express.Router();
const ensureAuth = require("../middleware/ensureAuth");

// ✅ Endpoint E2E para que el frontend NO truene con `.filter()`.
// GET /api/productos-egresos?activo=true
//
// IMPORTANTE:
// - Por defecto devolvemos ARRAY ([]) para que la UI pueda hacer .filter().
// - Si necesitas el wrapper legacy, usa ?wrap=1 y regresamos {ok,data,items,costos,gastos}.
//
// Cuando conectes el modelo real, solo reemplazas "items = []" por la consulta a Mongo
// y dejas intacta la forma de respuesta.
router.get("/", ensureAuth, async (req, res) => {
  try {
    const wrap = String(req.query.wrap || "").trim() === "1";

    // ✅ HOY (sin modelo real): lista vacía, pero con forma correcta
    const items = [];

    // ✅ Forma que tu frontend espera (ARRAY en la raíz)
    if (!wrap) {
      return res.json(items);
    }

    // ✅ Compat opcional (si otra vista lo usa así)
    const costos = items.filter((x) => String(x.tipo || "").toLowerCase() === "costo");
    const gastos = items.filter((x) => String(x.tipo || "").toLowerCase() === "gasto");

    return res.json({
      ok: true,
      data: items,
      items,
      costos,
      gastos,
    });
  } catch (err) {
    console.error("GET /api/productos-egresos error:", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

module.exports = router;
