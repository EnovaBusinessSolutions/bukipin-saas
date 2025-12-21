// backend/routes/productos.js
const express = require("express");
const router = express.Router();

const ensureAuth = require("../middleware/ensureAuth");
const Product = require("../models/Product");

// Opcional: si quieres implementar include_subcuentas de verdad (solo si existe Account)
let Account = null;
try {
  Account = require("../models/Account");
} catch (_) {}

/**
 * Helpers
 */
function boolFromQuery(v) {
  if (typeof v === "undefined") return undefined;
  const s = String(v).toLowerCase();
  return s === "true" || s === "1" || s === "yes";
}

function numOrZero(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * GET /api/productos
 * Query:
 * - activo=true|false
 * - cuenta_codigo=4001
 * - include_subcuentas=true|false   (si existe Account y tu Product guarda cuentaCodigo)
 * - q=texto (búsqueda por nombre/descripcion) [opcional]
 * - limit=500 [opcional]
 */
router.get("/", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;

    const activo = boolFromQuery(req.query.activo);
    const cuentaCodigo = req.query.cuenta_codigo ? String(req.query.cuenta_codigo).trim() : null;
    const includeSubcuentas = boolFromQuery(req.query.include_subcuentas);
    const qText = req.query.q ? String(req.query.q).trim() : "";
    const limit = Math.min(2000, Number(req.query.limit || 500));

    const q = { owner };

    // Soportar ambos: activo (tu diseño actual) o isActive (si tu modelo usa ese)
    if (typeof activo !== "undefined") {
      // intentamos aplicar en el campo más probable
      q.$or = [{ activo }, { isActive: activo }];
    }

    if (cuentaCodigo) {
      // Si include_subcuentas y existe Account, expandimos a subcuentas (por parentCode)
      if (includeSubcuentas && Account) {
        const children = await Account.find({
          owner,
          parentCode: cuentaCodigo,
        }).select("code").lean();

        const codes = [cuentaCodigo, ...children.map((a) => a.code)];
        // Productos podrían guardar cuentaCodigo o accountCode dependiendo del modelo
        q.$and = q.$and || [];
        q.$and.push({
          $or: [
            { cuentaCodigo: { $in: codes } },
            { accountCode: { $in: codes } },
          ],
        });
      } else {
        q.$and = q.$and || [];
        q.$and.push({
          $or: [{ cuentaCodigo }, { accountCode: cuentaCodigo }],
        });
      }
    }

    // Búsqueda simple (opcional)
    if (qText) {
      q.$and = q.$and || [];
      q.$and.push({
        $or: [
          { nombre: { $regex: qText, $options: "i" } },
          { name: { $regex: qText, $options: "i" } },
          { descripcion: { $regex: qText, $options: "i" } },
          { description: { $regex: qText, $options: "i" } },
        ],
      });
    }

    const items = await Product.find(q)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    return res.json({ ok: true, data: items });
  } catch (err) {
    console.error("GET /api/productos error:", err);
    return res.status(500).json({ ok: false, message: "Error cargando productos" });
  }
});

/**
 * POST /api/productos
 * Body (mínimo):
 * - nombre
 * Opcional:
 * - descripcion
 * - precio
 * - cuentaCodigo (default 4001)
 * - subcuentaId
 * - activo
 */
router.post("/", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;

    const nombre = (req.body?.nombre ?? req.body?.name ?? "").toString().trim();
    const descripcion = (req.body?.descripcion ?? req.body?.description ?? "").toString();
    const precio = numOrZero(req.body?.precio ?? req.body?.price);

    const cuentaCodigo = (req.body?.cuentaCodigo ?? req.body?.accountCode ?? "4001").toString().trim();
    const subcuentaId = req.body?.subcuentaId ?? null;

    const activoRaw = req.body?.activo ?? req.body?.isActive;
    const activo = typeof activoRaw === "undefined" ? true : Boolean(activoRaw);

    if (!nombre) {
      return res.status(400).json({ ok: false, message: "El nombre es requerido." });
    }

    const created = await Product.create({
      owner,
      // soportar nombres ES/EN según tu schema
      nombre,
      descripcion,
      precio,
      cuentaCodigo,
      subcuentaId,
      activo,
    });

    return res.status(201).json({ ok: true, data: created });
  } catch (err) {
    if (err && err.code === 11000) {
      return res.status(409).json({
        ok: false,
        message: "Ya existe un producto con esa clave/nombre para este usuario.",
      });
    }
    console.error("POST /api/productos error:", err);
    return res.status(500).json({ ok: false, message: "Error creando producto" });
  }
});

/**
 * PUT /api/productos/:id
 * Actualiza campos permitidos (whitelist)
 */
router.put("/:id", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;
    const { id } = req.params;

    const allowed = ["nombre", "descripcion", "precio", "cuentaCodigo", "subcuentaId", "activo"];
    const patch = {};

    for (const k of allowed) {
      if (typeof req.body?.[k] !== "undefined") patch[k] = req.body[k];
    }

    if (typeof patch.nombre !== "undefined") patch.nombre = String(patch.nombre).trim();
    if (typeof patch.cuentaCodigo !== "undefined") patch.cuentaCodigo = String(patch.cuentaCodigo).trim();
    if (typeof patch.precio !== "undefined") patch.precio = numOrZero(patch.precio);

    const updated = await Product.findOneAndUpdate(
      { _id: id, owner },
      { $set: patch },
      { new: true }
    ).lean();

    if (!updated) {
      return res.status(404).json({ ok: false, message: "Producto no encontrado." });
    }

    return res.json({ ok: true, data: updated });
  } catch (err) {
    if (err && err.code === 11000) {
      return res.status(409).json({
        ok: false,
        message: "Conflicto: producto duplicado para este usuario.",
      });
    }
    console.error("PUT /api/productos/:id error:", err);
    return res.status(500).json({ ok: false, message: "Error actualizando producto" });
  }
});

/**
 * DELETE /api/productos/:id
 */
router.delete("/:id", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;
    const { id } = req.params;

    const deleted = await Product.findOneAndDelete({ _id: id, owner }).lean();
    if (!deleted) {
      return res.status(404).json({ ok: false, message: "Producto no encontrado." });
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/productos/:id error:", err);
    return res.status(500).json({ ok: false, message: "Error eliminando producto" });
  }
});

module.exports = router;
