// backend/routes/productosEgresos.js
const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const ensureAuth = require("../middleware/ensureAuth");

/**
 * ✅ Objetivo:
 * - GET por defecto devuelve ARRAY (para que la UI haga .filter()).
 * - Si pasas ?wrap=1 => regresa { ok, data, items, costos, gastos } (legacy/compat).
 * - POST/PATCH/DELETE habilitados para que el catálogo funcione E2E.
 *
 * ✅ Persistencia:
 * - Si existe un modelo real ../models/ProductoEgreso lo usamos.
 * - Si NO existe, creamos un schema mínimo (collection: productos_egresos).
 */

let ProductoEgreso = null;

function getProductoEgresoModel() {
  if (ProductoEgreso) return ProductoEgreso;

  // 1) Intenta usar un modelo real si lo tienes
  try {
    ProductoEgreso = require("../models/ProductoEgreso");
    return ProductoEgreso;
  } catch (_) {}

  // 2) Fallback: modelo mínimo para que funcione E2E hoy
  const schema = new mongoose.Schema(
    {
      owner: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        index: true,
        required: true,
      },

      nombre: { type: String, required: true, trim: true },

      // UI manda "Costo"/"Gasto" -> normalizamos a "costo"/"gasto"
      tipo: {
        type: String,
        required: true,
        enum: ["costo", "gasto"],
        index: true,
      },

      descripcion: { type: String, default: "" },

      // Ej: 5001 (Costos) / 5101 (Gastos)
      cuentaCodigo: { type: String, default: "" },

      // Por compat, lo guardamos como string (puede venir id o nombre)
      subcuentaId: { type: String, default: null },

      activo: { type: Boolean, default: true, index: true },
    },
    { timestamps: true, collection: "productos_egresos" }
  );

  ProductoEgreso =
    mongoose.models.ProductoEgreso || mongoose.model("ProductoEgreso", schema);

  return ProductoEgreso;
}

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
  return v; // si llega raro, lo validamos arriba
}

function mapForUI(doc) {
  const d = doc?.toObject ? doc.toObject() : doc;

  const item = {
    id: String(d._id),
    _id: d._id,

    nombre: d.nombre ?? "",
    tipo: d.tipo ?? "",

    descripcion: d.descripcion ?? "",
    cuentaCodigo: d.cuentaCodigo ?? "",
    subcuentaId: d.subcuentaId ?? null,

    activo: !!d.activo,

    created_at: d.createdAt,
    updated_at: d.updatedAt,
  };

  // compat snake_case (por si la UI lo usa en algún lado)
  item.cuenta_codigo = item.cuentaCodigo;
  item.subcuenta_id = item.subcuentaId;

  return item;
}

/**
 * GET /api/productos-egresos?activo=true&tipo=costo|gasto
 *
 * ✅ Por defecto: regresa ARRAY (items[])
 * ✅ Si ?wrap=1: regresa wrapper {ok,data,items,costos,gastos}
 */
router.get("/", ensureAuth, async (req, res) => {
  try {
    const wrap = String(req.query.wrap || "").trim() === "1";
    const Model = getProductoEgresoModel();
    const owner = req.user._id;

    const activo = asBool(req.query.activo, null);
    const tipo = normalizeTipo(req.query.tipo);

    const filter = { owner };
    if (activo !== null) filter.activo = activo;
    if (tipo && ["costo", "gasto"].includes(tipo)) filter.tipo = tipo;

    const docs = await Model.find(filter).sort({ createdAt: -1 }).lean();
    const items = docs.map(mapForUI);

    // ✅ Forma que tu UI (Lovable) suele necesitar: ARRAY directo
    if (!wrap) {
      return res.json(items);
    }

    // ✅ Wrapper opcional
    const costos = items.filter((x) => x.tipo === "costo");
    const gastos = items.filter((x) => x.tipo === "gasto");

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

/**
 * POST /api/productos-egresos
 * ✅ Esto corrige el error que viste al “Agregar Gasto/Costo” (POST 404).
 */
router.post("/", ensureAuth, async (req, res) => {
  try {
    const Model = getProductoEgresoModel();
    const owner = req.user._id;

    const nombre = String(req.body?.nombre ?? "").trim();
    const tipo = normalizeTipo(req.body?.tipo);

    if (!nombre) {
      return res.status(400).json({
        ok: false,
        error: "VALIDATION",
        message: "nombre es requerido.",
      });
    }

    if (!["costo", "gasto"].includes(tipo)) {
      return res.status(400).json({
        ok: false,
        error: "VALIDATION",
        message: "tipo inválido. Usa 'costo' o 'gasto'.",
      });
    }

    const descripcion = String(req.body?.descripcion ?? "").trim();
    const cuentaCodigo = req.body?.cuentaCodigo
      ? String(req.body.cuentaCodigo).trim()
      : "";

    const subcuentaId =
      req.body?.subcuentaId !== undefined &&
      req.body?.subcuentaId !== null &&
      String(req.body.subcuentaId).trim() !== ""
        ? String(req.body.subcuentaId).trim()
        : null;

    const activo = asBool(req.body?.activo, true);

    const created = await Model.create({
      owner,
      nombre,
      tipo,
      descripcion,
      cuentaCodigo,
      subcuentaId,
      activo,
    });

    const item = mapForUI(created);

    return res.status(201).json({
      ok: true,
      data: item,
      item,
    });
  } catch (err) {
    console.error("POST /api/productos-egresos error:", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

/**
 * PATCH /api/productos-egresos/:id
 * (edición / activar / desactivar)
 */
router.patch("/:id", ensureAuth, async (req, res) => {
  try {
    const Model = getProductoEgresoModel();
    const owner = req.user._id;
    const id = String(req.params.id || "").trim();

    const patch = {};

    if (req.body?.nombre !== undefined) patch.nombre = String(req.body.nombre || "").trim();
    if (req.body?.tipo !== undefined) patch.tipo = normalizeTipo(req.body.tipo);
    if (req.body?.descripcion !== undefined) patch.descripcion = String(req.body.descripcion || "").trim();
    if (req.body?.cuentaCodigo !== undefined) patch.cuentaCodigo = String(req.body.cuentaCodigo || "").trim();
    if (req.body?.subcuentaId !== undefined) {
      patch.subcuentaId =
        req.body.subcuentaId === null || String(req.body.subcuentaId).trim() === ""
          ? null
          : String(req.body.subcuentaId).trim();
    }
    if (req.body?.activo !== undefined) patch.activo = asBool(req.body.activo, true);

    if (patch.tipo && !["costo", "gasto"].includes(patch.tipo)) {
      return res.status(400).json({
        ok: false,
        error: "VALIDATION",
        message: "tipo inválido.",
      });
    }

    const updated = await Model.findOneAndUpdate(
      { _id: id, owner },
      patch,
      { new: true }
    ).lean();

    if (!updated) return res.status(404).json({ ok: false, error: "NOT_FOUND" });

    return res.json({ ok: true, data: mapForUI(updated) });
  } catch (err) {
    console.error("PATCH /api/productos-egresos/:id error:", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

/**
 * DELETE /api/productos-egresos/:id
 */
router.delete("/:id", ensureAuth, async (req, res) => {
  try {
    const Model = getProductoEgresoModel();
    const owner = req.user._id;
    const id = String(req.params.id || "").trim();

    const deleted = await Model.findOneAndDelete({ _id: id, owner }).lean();
    if (!deleted) return res.status(404).json({ ok: false, error: "NOT_FOUND" });

    return res.json({ ok: true, data: { id } });
  } catch (err) {
    console.error("DELETE /api/productos-egresos/:id error:", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

module.exports = router;
