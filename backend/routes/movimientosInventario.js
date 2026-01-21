// backend/routes/movimientosInventario.js
const express = require("express");
const router = express.Router();

const ensureAuth = require("../middleware/ensureAuth");

// Intentamos cargar el modelo real del proyecto
let InventoryMovement = null;
try {
  InventoryMovement = require("../models/InventoryMovement");
} catch (e) {
  InventoryMovement = null;
}

function num(v, def = 0) {
  const n = Number(v ?? def);
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

function pickProductoId(m) {
  return String(
    m?.producto_id ??
      m?.productoId ??
      m?.productId ??
      (typeof m?.producto === "string" ? m.producto : "") ??
      (typeof m?.product === "string" ? m.product : "") ??
      ""
  );
}

function pickTipo(m) {
  return String(m?.tipo_movimiento ?? m?.tipoMovimiento ?? m?.tipo ?? m?.type ?? "")
    .toLowerCase()
    .trim();
}

function pickEstado(m) {
  return String(m?.estado ?? m?.status ?? "activo").toLowerCase().trim();
}

function mapMovementForUI(m) {
  const fecha = m.fecha || m.date || m.createdAt || m.created_at || m.updatedAt;

  const cantidad = num(m.cantidad ?? m.qty ?? m.quantity, 0);

  const costoUnitario = num(
    m.costo_unitario ?? m.costoUnitario ?? m.unitCost ?? m.costo_unit ?? 0,
    0
  );

  const costoTotal = num(
    m.costo_total ?? m.costoTotal ?? m.total ?? m.monto_total ?? 0,
    0
  );

  const finalCostoTotal = costoTotal > 0 ? costoTotal : cantidad * costoUnitario;

  // producto puede venir populated o como id
  const prodObj = m.productoId || m.producto_id || m.productId || m.producto || m.product || null;

  const prodId =
    prodObj && typeof prodObj === "object"
      ? String(prodObj._id || prodObj.id || "")
      : prodObj
      ? String(prodObj)
      : pickProductoId(m) || null;

  const prodNombre =
    prodObj && typeof prodObj === "object"
      ? prodObj.nombre ?? prodObj.name ?? prodObj.descripcion ?? prodObj.title ?? null
      : null;

  const tipo = pickTipo(m) || "ajuste";
  const estado = pickEstado(m) || "activo";

  return {
    id: String(m._id),
    _id: m._id,

    // ✅ campos que tu frontend ya entiende (snake + compat)
    fecha,
    tipo_movimiento: tipo,
    tipo, // compat
    estado,

    producto_id: prodId,
    productoId: prodId, // compat
    producto: prodId
      ? {
          id: prodId,
          nombre: prodNombre || "Producto",
        }
      : null,

    cantidad,
    costo_unitario: costoUnitario,
    costoUnitario: costoUnitario, // compat
    costo_total: finalCostoTotal,
    costoTotal: finalCostoTotal, // compat

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
 * - tipo (o tipo_movimiento)
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

    const estadoRaw = req.query.estado ? String(req.query.estado).trim().toLowerCase() : null;
    const tipoRaw = req.query.tipo ? String(req.query.tipo).trim().toLowerCase() : null;

    const start = parseStartDate(req.query.start || req.query.from);
    const end = parseEndDate(req.query.end || req.query.to);

    const productoId = String(req.query.productoId || req.query.producto_id || "").trim();

    const limit = Math.min(5000, Number(req.query.limit || 500));
    const sort = parseOrder(req.query.order);

    // ✅ Construimos filtros robustos
    const and = [{ owner }];

    // estado (si es "activo", incluimos docs sin estado/status)
    if (estadoRaw && estadoRaw !== "todos") {
      if (estadoRaw === "activo") {
        and.push({
          $or: [
            { estado: "activo" },
            { status: "activo" },
            { estado: { $exists: false } },
            { status: { $exists: false } },
            { estado: null },
            { status: null },
          ],
        });
      } else {
        and.push({ $or: [{ estado: estadoRaw }, { status: estadoRaw }] });
      }
    }

    // tipo
    if (tipoRaw && tipoRaw !== "todos") {
      and.push({
        $or: [
          { tipo: tipoRaw },
          { type: tipoRaw },
          { tipo_movimiento: tipoRaw },
          { tipoMovimiento: tipoRaw },
        ],
      });
    }

    // fechas
    if (start && end) {
      and.push({ fecha: { $gte: start, $lte: end } });
    }

    // producto
    if (productoId) {
      and.push({
        $or: [
          { productoId },
          { producto_id: productoId },
          { productId: productoId },
          { producto: productoId },
          { product: productoId },
        ],
      });
    }

    const filter = and.length > 1 ? { $and: and } : and[0];

    // populate: intentamos con varios paths (según schema)
    let q = InventoryMovement.find(filter).sort(sort).limit(limit);

    const paths = ["productoId", "producto_id", "productId", "producto", "product"];
    for (const p of paths) {
      try {
        if (InventoryMovement.schema?.path(p)) {
          q = q.populate(p, "nombre name sku codigo code precio price costoUnitario costo_unitario");
          break;
        }
      } catch (_) {}
    }

    const rows = await q.lean();
    const items = rows.map(mapMovementForUI);

    return res.json({
      ok: true,
      data: {
        items,
        count: items.length,
      },
      // compat legacy
      items,
      count: items.length,
    });
  } catch (err) {
    console.error("GET /api/movimientos-inventario error:", err);
    return res.status(500).json({ ok: false, message: "Error cargando movimientos de inventario" });
  }
});

/**
 * POST /api/movimientos-inventario
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

    const tipo = String(req.body?.tipo ?? req.body?.tipo_movimiento ?? "ajuste").trim().toLowerCase();
    const estado = String(req.body?.estado ?? "activo").trim().toLowerCase();

    const productoId = req.body?.productoId ?? req.body?.producto_id ?? req.body?.productId ?? null;

    const cantidad = num(req.body?.cantidad ?? req.body?.qty ?? req.body?.quantity, NaN);
    const costoUnitario = num(req.body?.costoUnitario ?? req.body?.costo_unitario ?? 0, 0);

    const descripcion = String(req.body?.descripcion || "").trim();
    const referencia = String(req.body?.referencia || "").trim();

    const fecha = req.body?.fecha ? new Date(req.body.fecha) : new Date();
    if (Number.isNaN(fecha.getTime())) {
      return res.status(400).json({ ok: false, message: "fecha inválida." });
    }

    if (!productoId) return res.status(400).json({ ok: false, message: "productoId es requerido." });
    if (!Number.isFinite(cantidad) || cantidad === 0) {
      return res.status(400).json({ ok: false, message: "cantidad es requerida y no puede ser 0." });
    }

    // ✅ Guardamos en el mayor número de variantes para compat (evita “0 stock” por mismatches)
    const payload = {
      owner,
      fecha,
      estado,
      status: estado,

      tipo,
      type: tipo,
      tipo_movimiento: tipo,
      tipoMovimiento: tipo,

      productoId,
      producto_id: productoId,
      productId: productoId,

      cantidad,
      qty: cantidad,

      costoUnitario,
      costo_unitario: costoUnitario,

      costo_total: cantidad * costoUnitario,
      costoTotal: cantidad * costoUnitario,

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
