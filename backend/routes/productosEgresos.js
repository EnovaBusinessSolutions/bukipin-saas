// backend/routes/productosEgresos.js
const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const ensureAuth = require("../middleware/ensureAuth");

const ExpenseProduct = require("../models/ExpenseProduct");
const ExpenseTransaction = require("../models/ExpenseTransaction");

function asBool(v, def = null) {
  if (v === undefined || v === null || v === "") return def;
  const s = String(v).trim().toLowerCase();
  if (["true", "1", "yes", "y", "si"].includes(s)) return true;
  if (["false", "0", "no", "n"].includes(s)) return false;
  return def;
}

function normalizeTipo(raw) {
  const v = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (!v) return "";
  if (["costo", "costos"].includes(v)) return "costo";
  if (["gasto", "gastos"].includes(v)) return "gasto";
  return v;
}

function toNum(v, def = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function toObjectIdOrNull(v) {
  if (v === undefined || v === null) return null;
  if (v instanceof mongoose.Types.ObjectId) return v;

  const s = String(v).trim();
  if (!s) return null;

  return mongoose.Types.ObjectId.isValid(s) ? new mongoose.Types.ObjectId(s) : null;
}

// ✅ Detecta si tu modelo de transacciones usa "productoId" o "productId"
let _txProductField = null;
function getTxProductField() {
  if (_txProductField) return _txProductField;

  const schemaPaths = ExpenseTransaction?.schema?.paths || {};
  if (schemaPaths.productoId) _txProductField = "productoId";
  else if (schemaPaths.productId) _txProductField = "productId";
  else _txProductField = "productoId"; // fallback por compat

  return _txProductField;
}

function mapForUI(doc, stats = null) {
  const d = doc?.toObject ? doc.toObject() : doc;

  const transacciones = stats?.transacciones ? Number(stats.transacciones) : 0;
  const precioPromedio = stats?.precioPromedio ? toNum(stats.precioPromedio, 0) : 0;
  const variacionPrecio = stats?.variacionPrecio ? toNum(stats.variacionPrecio, 0) : 0;
  const ultimaCompra = stats?.ultimaCompra ? new Date(stats.ultimaCompra).toISOString() : null;

  // Campos extra si ya los tienes en ExpenseProduct (si no existen, no pasa nada)
  const unidadMedida = d.unidadMedida ?? d.unidad_medida ?? d.unidad ?? "";
  const proveedorPrincipal = d.proveedorPrincipal ?? d.proveedor_principal ?? d.proveedor ?? "";
  const imagenUrl = d.imagenUrl ?? d.imageUrl ?? d.imagen_url ?? "";

  const item = {
    id: String(d._id),
    _id: d._id,

    // ✅ root + compat (para que el frontend no diga undefined)
    nombre: d.nombre ?? "",
    name: d.nombre ?? "",

    tipo: d.tipo ?? "",
    type: d.tipo ?? "",

    descripcion: d.descripcion ?? "",
    cuentaCodigo: d.cuentaCodigo ?? "",
    subcuentaId: d.subcuentaId ? String(d.subcuentaId) : null,

    unidadMedida,
    proveedorPrincipal,
    imagenUrl,

    activo: !!d.activo,

    // ✅ métricas (la UI las muestra en cards)
    transacciones,
    precioPromedio,
    variacionPrecio,
    ultimaCompra,

    created_at: d.createdAt,
    updated_at: d.updatedAt,
  };

  // compat snake_case (Lovable suele mezclar)
  item.cuenta_codigo = item.cuentaCodigo;
  item.subcuenta_id = item.subcuentaId;
  item.precio_promedio = item.precioPromedio;
  item.variacion_precio = item.variacionPrecio;
  item.ultima_compra = item.ultimaCompra;

  item.unidad_medida = item.unidadMedida;
  item.proveedor_principal = item.proveedorPrincipal;
  item.imagen_url = item.imagenUrl;

  return item;
}

/**
 * ✅ Calcula stats reales desde ExpenseTransaction:
 * - transacciones (count)
 * - precioPromedio (avg precioUnitario)
 * - ultimaCompra (max fecha)
 * - variacionPrecio (% del último vs anterior) si hay >=2
 */
async function buildStats(owner, productIds) {
  const txField = getTxProductField();
  const ownerId = owner instanceof mongoose.Types.ObjectId ? owner : new mongoose.Types.ObjectId(owner);

  if (!productIds?.length) return new Map();

  // 1) stats base
  const baseAgg = await ExpenseTransaction.aggregate([
    { $match: { owner: ownerId, [txField]: { $in: productIds } } },
    {
      $group: {
        _id: `$${txField}`,
        transacciones: { $sum: 1 },
        precioPromedio: { $avg: "$precioUnitario" },
        ultimaCompra: { $max: "$fecha" },
      },
    },
  ]);

  const map = new Map(baseAgg.map((s) => [String(s._id), { ...s, variacionPrecio: 0 }]));

  // 2) variación: último vs anterior
  const lastTwoAgg = await ExpenseTransaction.aggregate([
    { $match: { owner: ownerId, [txField]: { $in: productIds } } },
    { $sort: { fecha: -1 } },
    {
      $group: {
        _id: `$${txField}`,
        precios: { $push: "$precioUnitario" },
      },
    },
    { $project: { precios: { $slice: ["$precios", 2] } } },
  ]);

  for (const row of lastTwoAgg) {
    const id = String(row._id);
    const precios = row.precios || [];
    if (precios.length >= 2) {
      const last = toNum(precios[0], 0);
      const prev = toNum(precios[1], 0);
      const variacion = prev > 0 ? ((last - prev) / prev) * 100 : 0;

      const cur = map.get(id) || { _id: row._id, transacciones: 0, precioPromedio: 0, ultimaCompra: null };
      map.set(id, { ...cur, variacionPrecio: variacion });
    }
  }

  return map;
}

/**
 * GET /api/productos-egresos?activo=true&tipo=costo|gasto
 *
 * ✅ Por defecto: ARRAY
 * ✅ ?wrap=1: wrapper {ok,data,items,costos,gastos}
 */
router.get("/", ensureAuth, async (req, res) => {
  try {
    const wrap = String(req.query.wrap || "").trim() === "1";
    const owner = req.user._id;

    const activo = asBool(req.query.activo, null);
    const tipo = normalizeTipo(req.query.tipo);

    const filter = { owner };
    if (activo !== null) filter.activo = activo;
    if (tipo && ["costo", "gasto"].includes(tipo)) filter.tipo = tipo;

    const docs = await ExpenseProduct.find(filter).sort({ createdAt: -1 }).lean();

    if (!docs.length) {
      if (!wrap) return res.json([]);
      return res.json({ ok: true, data: [], items: [], costos: [], gastos: [] });
    }

    const ids = docs.map((d) => d._id);
    const statsById = await buildStats(owner, ids);

    const items = docs.map((d) => mapForUI(d, statsById.get(String(d._id)) || null));

    if (!wrap) return res.json(items);

    const costos = items.filter((x) => x.tipo === "costo");
    const gastos = items.filter((x) => x.tipo === "gasto");

    return res.json({ ok: true, data: items, items, costos, gastos });
  } catch (err) {
    console.error("GET /api/productos-egresos error:", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

/**
 * ✅ NECESARIO para el modal "Editar"
 * GET /api/productos-egresos/:id
 */
router.get("/:id", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;
    const id = String(req.params.id || "").trim();

    const doc = await ExpenseProduct.findOne({ _id: id, owner }).lean();
    if (!doc) return res.status(404).json({ ok: false, error: "NOT_FOUND" });

    const statsById = await buildStats(owner, [doc._id]);
    const item = mapForUI(doc, statsById.get(String(doc._id)) || null);

    // ✅ compat: root + wrapper
    return res.json({ ok: true, ...item, data: item, item });
  } catch (err) {
    console.error("GET /api/productos-egresos/:id error:", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

/**
 * POST /api/productos-egresos
 * ✅ Corrige el toast "undefined" devolviendo item en ROOT también.
 */
router.post("/", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;

    const nombre = String(req.body?.nombre ?? req.body?.name ?? "").trim();
    const tipo = normalizeTipo(req.body?.tipo ?? req.body?.type);

    if (!nombre) {
      return res.status(400).json({ ok: false, error: "VALIDATION", message: "nombre es requerido." });
    }
    if (!["costo", "gasto"].includes(tipo)) {
      return res.status(400).json({ ok: false, error: "VALIDATION", message: "tipo inválido. Usa 'costo' o 'gasto'." });
    }

    const descripcion = String(req.body?.descripcion ?? "").trim();
    const cuentaCodigo = req.body?.cuentaCodigo ? String(req.body.cuentaCodigo).trim() : "";

    // subcuentaId puede venir como string id
    const subcuentaId = toObjectIdOrNull(req.body?.subcuentaId ?? req.body?.subcuenta_id);

    const activo = asBool(req.body?.activo, true);

    // Opcionales si ya los tienes en tu modelo ExpenseProduct
    const unidadMedida = String(req.body?.unidadMedida ?? req.body?.unidad_medida ?? req.body?.unidad ?? "").trim();
    const proveedorPrincipal = String(req.body?.proveedorPrincipal ?? req.body?.proveedor_principal ?? req.body?.proveedor ?? "").trim();
    const imagenUrl = String(req.body?.imagenUrl ?? req.body?.imageUrl ?? req.body?.imagen_url ?? "").trim();

    const payload = {
      owner,
      nombre,
      tipo,
      descripcion,
      cuentaCodigo,
      subcuentaId,
      activo,
    };

    // solo asignar si el schema los soporta (para no romper si aún no existen)
    const sp = ExpenseProduct.schema?.paths || {};
    if (sp.unidadMedida) payload.unidadMedida = unidadMedida;
    if (sp.proveedorPrincipal) payload.proveedorPrincipal = proveedorPrincipal;
    if (sp.imagenUrl) payload.imagenUrl = imagenUrl;

    const created = await ExpenseProduct.create(payload);

    const item = mapForUI(created);

    // ✅ root + wrapper (mata "undefined")
    return res.status(201).json({ ok: true, ...item, data: item, item });
  } catch (err) {
    console.error("POST /api/productos-egresos error:", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

/**
 * PATCH /api/productos-egresos/:id
 */
router.patch("/:id", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;
    const id = String(req.params.id || "").trim();

    const patch = {};

    if (req.body?.nombre !== undefined || req.body?.name !== undefined) {
      patch.nombre = String(req.body?.nombre ?? req.body?.name ?? "").trim();
    }

    if (req.body?.tipo !== undefined || req.body?.type !== undefined) {
      patch.tipo = normalizeTipo(req.body?.tipo ?? req.body?.type);
      if (patch.tipo && !["costo", "gasto"].includes(patch.tipo)) {
        return res.status(400).json({ ok: false, error: "VALIDATION", message: "tipo inválido." });
      }
    }

    if (req.body?.descripcion !== undefined) patch.descripcion = String(req.body.descripcion || "").trim();
    if (req.body?.cuentaCodigo !== undefined || req.body?.cuenta_codigo !== undefined) {
      patch.cuentaCodigo = String(req.body?.cuentaCodigo ?? req.body?.cuenta_codigo ?? "").trim();
    }

    if (req.body?.subcuentaId !== undefined || req.body?.subcuenta_id !== undefined) {
      patch.subcuentaId = toObjectIdOrNull(req.body?.subcuentaId ?? req.body?.subcuenta_id);
    }

    if (req.body?.activo !== undefined) patch.activo = asBool(req.body.activo, true);

    // opcionales si existen en schema
    const sp = ExpenseProduct.schema?.paths || {};
    if (sp.unidadMedida && (req.body?.unidadMedida !== undefined || req.body?.unidad_medida !== undefined || req.body?.unidad !== undefined)) {
      patch.unidadMedida = String(req.body?.unidadMedida ?? req.body?.unidad_medida ?? req.body?.unidad ?? "").trim();
    }
    if (sp.proveedorPrincipal && (req.body?.proveedorPrincipal !== undefined || req.body?.proveedor_principal !== undefined || req.body?.proveedor !== undefined)) {
      patch.proveedorPrincipal = String(req.body?.proveedorPrincipal ?? req.body?.proveedor_principal ?? req.body?.proveedor ?? "").trim();
    }
    if (sp.imagenUrl && (req.body?.imagenUrl !== undefined || req.body?.imageUrl !== undefined || req.body?.imagen_url !== undefined)) {
      patch.imagenUrl = String(req.body?.imagenUrl ?? req.body?.imageUrl ?? req.body?.imagen_url ?? "").trim();
    }

    const updated = await ExpenseProduct.findOneAndUpdate({ _id: id, owner }, patch, { new: true }).lean();
    if (!updated) return res.status(404).json({ ok: false, error: "NOT_FOUND" });

    // ✅ stats actualizadas del producto
    const statsById = await buildStats(owner, [updated._id]);
    const item = mapForUI(updated, statsById.get(String(updated._id)) || null);

    return res.json({ ok: true, ...item, data: item, item });
  } catch (err) {
    console.error("PATCH /api/productos-egresos/:id error:", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

/**
 * DELETE /api/productos-egresos/:id
 * Borra producto del catálogo y también sus transacciones ligadas.
 */
router.delete("/:id", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;
    const id = String(req.params.id || "").trim();

    const deleted = await ExpenseProduct.findOneAndDelete({ _id: id, owner }).lean();
    if (!deleted) return res.status(404).json({ ok: false, error: "NOT_FOUND" });

    const txField = getTxProductField();
    await ExpenseTransaction.deleteMany({ owner, [txField]: deleted._id });

    return res.json({ ok: true, data: { id }, id });
  } catch (err) {
    console.error("DELETE /api/productos-egresos/:id error:", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

module.exports = router;
