// backend/routes/movimientosInventario.js
const express = require("express");
const router = express.Router();

const ensureAuth = require("../middleware/ensureAuth");

// Intentamos cargar el modelo real del proyecto
let InventoryMovement = null;
try {
  InventoryMovement = require("../models/InventoryMovement");
} catch (e) {
  // Si no existe, devolvemos errores claros
  InventoryMovement = null;
}

function num(v, def = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

/**
 * Fechas (evitar UTC con YYYY-MM-DD)
 */
function parseStartDate(s) {
  if (!s) return null;
  const str = String(s).trim();
  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(str);
  const d = new Date(isDateOnly ? `${str}T00:00:00` : str);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseEndDate(s) {
  if (!s) return null;
  const str = String(s).trim();
  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(str);
  const d = new Date(isDateOnly ? `${str}T23:59:59.999` : str);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseOrder(orderRaw) {
  // order esperado: "fecha:desc" | "fecha:asc" | "createdAt:desc" etc.
  const order = String(orderRaw || "fecha:desc").trim();
  const [field, dir] = order.split(":");
  const key = (field || "fecha").trim();
  const direction = String(dir || "desc").toLowerCase() === "asc" ? 1 : -1;
  return { [key]: direction, createdAt: -1 };
}

function mapMovementForUI(m) {
  const fecha = m.fecha || m.date || m.createdAt;

  const cantidad = num(m.cantidad ?? m.qty ?? m.quantity, 0);
  const costoUnitario = num(m.costoUnitario ?? m.costo_unitario ?? m.unitCost, 0);
  const total = cantidad * costoUnitario;

  // productoId puede venir populated o como ObjectId
  const prod = m.productoId || m.product || null;
  const prodId =
    prod && typeof prod === "object" ? String(prod._id || prod.id) : prod ? String(prod) : null;

  const prodNombre =
    prod && typeof prod === "object"
      ? prod.nombre ?? prod.name ?? prod.descripcion ?? prod.title ?? null
      : null;

  return {
    id: String(m._id),
    _id: m._id,

    fecha,
    tipo: m.tipo ?? m.type ?? "ajuste",
    estado: m.estado ?? m.status ?? "activo",

    producto_id: prodId,
    producto: prodId
      ? {
          id: prodId,
          nombre: prodNombre || "Producto",
        }
      : null,

    cantidad,
    costo_unitario: costoUnitario,
    total,

    descripcion: m.descripcion ?? m.memo ?? m.concepto ?? "",
    referencia: m.referencia ?? m.ref ?? "",

    created_at: m.createdAt,
    updated_at: m.updatedAt,
  };
}

/**
 * GET /api/movimientos-inventario?estado=activo&order=fecha:desc&limit=200
 * Opcionales:
 * - start/end (o from/to)
 * - tipo
 * - productoId / producto_id
 */
router.get("/", ensureAuth, async (req, res) => {
  try {
    if (!InventoryMovement) {
      return res.status(500).json({
        ok: false,
        message:
          "No se encontró el modelo InventoryMovement. Verifica backend/models/InventoryMovement.js",
      });
    }

    const owner = req.user._id;

    const estado = req.query.estado ? String(req.query.estado).trim() : null;
    const tipo = req.query.tipo ? String(req.query.tipo).trim() : null;

    const start = parseStartDate(req.query.start || req.query.from);
    const end = parseEndDate(req.query.end || req.query.to);

    const productoId = req.query.productoId || req.query.producto_id || null;

    const limit = Math.min(5000, Number(req.query.limit || 500));
    const sort = parseOrder(req.query.order);

    const filter = { owner };

    if (estado) filter.estado = estado;
    if (tipo) filter.tipo = tipo;

    if (start && end) filter.fecha = { $gte: start, $lte: end };

    if (productoId) {
      // soporta string id
      filter.productoId = productoId;
    }

    // populate opcional si existe ese path en el schema
    let q = InventoryMovement.find(filter).sort(sort).limit(limit);

    try {
      const hasProductoId =
        InventoryMovement.schema?.path("productoId") ||
        InventoryMovement.schema?.path("productId") ||
        InventoryMovement.schema?.path("producto");
      if (hasProductoId) {
        q = q.populate("productoId", "nombre name sku codigo code precio price costoUnitario");
      }
    } catch (_) {}

    const rows = await q.lean();
    const items = rows.map(mapMovementForUI);

    return res.json({
      ok: true,
      data: {
        items,
        count: items.length,
      },
      // compat legacy por si la UI lo busca plano
      items,
    });
  } catch (err) {
    console.error("GET /api/movimientos-inventario error:", err);
    return res.status(500).json({ ok: false, message: "Error cargando movimientos de inventario" });
  }
});

/**
 * POST /api/movimientos-inventario
 * Body típico:
 * {
 *   fecha,
 *   tipo: "venta" | "compra" | "ajuste",
 *   productoId,
 *   cantidad,
 *   costoUnitario,
 *   estado: "activo",
 *   descripcion,
 *   referencia
 * }
 */
router.post("/", ensureAuth, async (req, res) => {
  try {
    if (!InventoryMovement) {
      return res.status(500).json({
        ok: false,
        message:
          "No se encontró el modelo InventoryMovement. Verifica backend/models/InventoryMovement.js",
      });
    }

    const owner = req.user._id;

    const tipo = String(req.body?.tipo || "ajuste").trim();
    const estado = String(req.body?.estado || "activo").trim();

    const productoId = req.body?.productoId ?? req.body?.producto_id ?? null;

    const cantidad = num(req.body?.cantidad ?? req.body?.qty ?? req.body?.quantity, NaN);
    const costoUnitario = num(req.body?.costoUnitario ?? req.body?.costo_unitario ?? 0, 0);

    const descripcion = String(req.body?.descripcion || "").trim();
    const referencia = String(req.body?.referencia || "").trim();

    const fecha = req.body?.fecha ? new Date(req.body.fecha) : new Date();
    if (Number.isNaN(fecha.getTime())) {
      return res.status(400).json({ ok: false, message: "fecha inválida." });
    }

    if (!productoId) {
      return res.status(400).json({ ok: false, message: "productoId es requerido." });
    }
    if (!Number.isFinite(cantidad) || cantidad === 0) {
      return res.status(400).json({ ok: false, message: "cantidad es requerida y no puede ser 0." });
    }

    const payload = {
      owner,
      fecha,
      tipo,
      estado,
      productoId,
      cantidad,
      costoUnitario,
      descripcion,
      referencia,
    };

    const created = await InventoryMovement.create(payload);

    return res.status(201).json({
      ok: true,
      data: mapMovementForUI(created.toObject ? created.toObject() : created),
    });
  } catch (err) {
    console.error("POST /api/movimientos-inventario error:", err);
    return res.status(500).json({ ok: false, message: "Error creando movimiento de inventario" });
  }
});

/**
 * DELETE /api/movimientos-inventario/:id
 * (útil para UI legacy si llega a existir “eliminar movimiento”)
 */
router.delete("/:id", ensureAuth, async (req, res) => {
  try {
    if (!InventoryMovement) {
      return res.status(500).json({
        ok: false,
        message:
          "No se encontró el modelo InventoryMovement. Verifica backend/models/InventoryMovement.js",
      });
    }

    const owner = req.user._id;
    const { id } = req.params;

    const found = await InventoryMovement.findOne({ _id: id, owner });
    if (!found) return res.status(404).json({ ok: false, message: "Movimiento no encontrado." });

    await InventoryMovement.deleteOne({ _id: id, owner });

    return res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/movimientos-inventario/:id error:", err);
    return res.status(500).json({ ok: false, message: "Error eliminando movimiento" });
  }
});

module.exports = router;
