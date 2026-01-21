// backend/routes/inventario.js
const express = require("express");
const router = express.Router();

const ensureAuth = require("../middleware/ensureAuth");

// Si existe modelo, úsalo
let InventoryMovement = null;
try {
  InventoryMovement = require("../models/InventoryMovement");
} catch (_) {}

function parseDate(s) {
  if (!s) return null;
  const d = new Date(String(s));
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * GET /api/inventario/movimientos?tipo=venta&start=YYYY-MM-DD&end=YYYY-MM-DD
 * Soporta también from/to.
 *
 * Reglas:
 * - tipo=compra|venta|ajuste => filtra por ese tipo
 * - tipo=todos o sin tipo => NO filtra por tipo (trae todos)
 *
 * Nota MVP:
 * - Si aún no existe InventoryMovement, devuelve lista vacía (pero con shape estable).
 */
router.get("/movimientos", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;

    // 👇 IMPORTANTÍSIMO:
    // si no viene tipo o viene "todos", NO filtramos por tipo
    const tipoRaw = String(req.query.tipo ?? "").trim().toLowerCase();

    // Validamos tipos permitidos
    const allowedTipos = new Set(["compra", "venta", "ajuste"]);
    const tipoValido = allowedTipos.has(tipoRaw) ? tipoRaw : null;

    const start = parseDate(req.query.start || req.query.from);
    const end = parseDate(req.query.end || req.query.to);

    // Si el modelo aún no existe, respondemos vacío y listo (sin romper UI)
    if (!InventoryMovement) {
      return res.json({
        ok: true,
        data: {
          items: [],
          meta: {
            tipo: tipoValido || "todos",
            start: start ? start.toISOString() : null,
            end: end ? end.toISOString() : null,
            note: "InventoryMovement model no existe aún",
          },
        },
      });
    }

    const q = { owner };

    // ✅ SOLO filtramos cuando tipo sea compra|venta|ajuste
    if (tipoValido) q.tipo = tipoValido;

    if (start && end) {
      q.fecha = { $gte: start, $lte: end };
    } else if (start && !end) {
      q.fecha = { $gte: start };
    } else if (!start && end) {
      q.fecha = { $lte: end };
    }

    const limit = Math.min(5000, Number(req.query.limit || 2000));

    const items = await InventoryMovement.find(q)
      .sort({ fecha: -1, createdAt: -1 })
      .limit(limit)
      .lean();

    return res.json({
      ok: true,
      data: {
        items,
        meta: {
          tipo: tipoValido || "todos",
          start: start ? start.toISOString() : null,
          end: end ? end.toISOString() : null,
        },
      },
    });
  } catch (err) {
    console.error("GET /api/inventario/movimientos error:", err);
    return res.status(500).json({ ok: false, message: "Error cargando movimientos" });
  }
});

module.exports = router;
