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
  const s = String(v).trim();
  if (!s) return null;
  return mongoose.Types.ObjectId.isValid(s) ? new mongoose.Types.ObjectId(s) : null;
}

function mapForUI(doc, stats = null) {
  const d = doc?.toObject ? doc.toObject() : doc;

  const transacciones = stats?.transacciones ? Number(stats.transacciones) : 0;
  const precioPromedio = stats?.precioPromedio ? toNum(stats.precioPromedio, 0) : 0;
  const ultimaCompra = stats?.ultimaCompra ? new Date(stats.ultimaCompra).toISOString() : null;

  const item = {
    id: String(d._id),
    _id: d._id,

    nombre: d.nombre ?? "",
    tipo: d.tipo ?? "",

    descripcion: d.descripcion ?? "",
    cuentaCodigo: d.cuentaCodigo ?? "",
    subcuentaId: d.subcuentaId ?? null,

    activo: !!d.activo,

    // ✅ métricas (la UI las muestra en cards)
    transacciones,
    precioPromedio,
    variacionPrecio: 0, // (luego la calculamos real cuando ya haya transacciones)
    ultimaCompra,

    created_at: d.createdAt,
    updated_at: d.updatedAt,
  };

  // compat snake_case (por si en algún lado Lovable lo usa)
  item.cuenta_codigo = item.cuentaCodigo;
  item.subcuenta_id = item.subcuentaId;
  item.precio_promedio = item.precioPromedio;
  item.variacion_precio = item.variacionPrecio;
  item.ultima_compra = item.ultimaCompra;

  return item;
}

/**
 * GET /api/productos-egresos?activo=true&tipo=costo|gasto
 *
 * ✅ Por defecto: regresa ARRAY (items[])
 * ✅ Si ?wrap=1: regresa wrapper {ok,data,items,costos,gastos}
 *
 * Incluye métricas desde ExpenseTransaction:
 * - transacciones
 * - precioPromedio
 * - ultimaCompra
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

    // métricas agrupadas por productoId
    const statsAgg = await ExpenseTransaction.aggregate([
      { $match: { owner, productoId: { $in: ids } } },
      {
        $group: {
          _id: "$productoId",
          transacciones: { $sum: 1 },
          precioPromedio: { $avg: "$precioUnitario" },
          ultimaCompra: { $max: "$fecha" },
        },
      },
    ]);

    const statsById = new Map(statsAgg.map((s) => [String(s._id), s]));

    const items = docs.map((d) => mapForUI(d, statsById.get(String(d._id))));

    if (!wrap) {
      // ✅ Forma que tu UI necesita: ARRAY directo
      return res.json(items);
    }

    const costos = items.filter((x) => x.tipo === "costo");
    const gastos = items.filter((x) => x.tipo === "gasto");

    return res.json({ ok: true, data: items, items, costos, gastos });
  } catch (err) {
    console.error("GET /api/productos-egresos error:", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

/**
 * POST /api/productos-egresos
 * Crea item del catálogo (costo/gasto)
 */
router.post("/", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;

    const nombre = String(req.body?.nombre ?? "").trim();
    const tipo = normalizeTipo(req.body?.tipo);

    if (!nombre) {
      return res.status(400).json({ ok: false, error: "VALIDATION", message: "nombre es requerido." });
    }
    if (!["costo", "gasto"].includes(tipo)) {
      return res.status(400).json({ ok: false, error: "VALIDATION", message: "tipo inválido. Usa 'costo' o 'gasto'." });
    }

    const descripcion = String(req.body?.descripcion ?? "").trim();
    const cuentaCodigo = req.body?.cuentaCodigo ? String(req.body.cuentaCodigo).trim() : "";

    // subcuentaId en tu modelo es ObjectId ref Account
    // si viene algo raro, lo guardamos null para no romper
    const subcuentaId = toObjectIdOrNull(req.body?.subcuentaId);

    const activo = asBool(req.body?.activo, true);

    const created = await ExpenseProduct.create({
      owner,
      nombre,
      tipo,
      descripcion,
      cuentaCodigo,
      subcuentaId,
      activo,
    });

    return res.status(201).json({ ok: true, data: mapForUI(created) });
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

    if (req.body?.nombre !== undefined) patch.nombre = String(req.body.nombre || "").trim();
    if (req.body?.tipo !== undefined) patch.tipo = normalizeTipo(req.body.tipo);
    if (req.body?.descripcion !== undefined) patch.descripcion = String(req.body.descripcion || "").trim();
    if (req.body?.cuentaCodigo !== undefined) patch.cuentaCodigo = String(req.body.cuentaCodigo || "").trim();

    if (req.body?.subcuentaId !== undefined) {
      patch.subcuentaId = toObjectIdOrNull(req.body.subcuentaId);
    }

    if (req.body?.activo !== undefined) patch.activo = asBool(req.body.activo, true);

    if (patch.tipo && !["costo", "gasto"].includes(patch.tipo)) {
      return res.status(400).json({ ok: false, error: "VALIDATION", message: "tipo inválido." });
    }

    const updated = await ExpenseProduct.findOneAndUpdate({ _id: id, owner }, patch, { new: true }).lean();
    if (!updated) return res.status(404).json({ ok: false, error: "NOT_FOUND" });

    // recalcular métricas de ese producto
    const stats = await ExpenseTransaction.aggregate([
      { $match: { owner, productoId: updated._id } },
      {
        $group: {
          _id: "$productoId",
          transacciones: { $sum: 1 },
          precioPromedio: { $avg: "$precioUnitario" },
          ultimaCompra: { $max: "$fecha" },
        },
      },
    ]);

    return res.json({ ok: true, data: mapForUI(updated, stats[0] || null) });
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

    await ExpenseTransaction.deleteMany({ owner, productoId: deleted._id });

    return res.json({ ok: true, data: { id } });
  } catch (err) {
    console.error("DELETE /api/productos-egresos/:id error:", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

module.exports = router;
