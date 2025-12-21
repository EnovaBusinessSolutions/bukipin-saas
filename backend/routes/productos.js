// backend/routes/productos.js
const express = require("express");
const router = express.Router();

const ensureAuth = require("../middleware/ensureAuth");
const Product = require("../models/Product");

// Opcional: validación contra Account si existe
let Account = null;
try {
  Account = require("../models/Account");
} catch (_) {}

/**
 * Helpers
 */
const s = (v) => (typeof v === "string" ? v.trim() : v);

function boolFromQuery(v) {
  if (typeof v === "undefined") return undefined;
  const str = String(v).toLowerCase().trim();
  return str === "true" || str === "1" || str === "yes";
}

function numOrNull(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const n = Number(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function toBool(v, fallback = true) {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v === 1;
  if (typeof v === "string") {
    const str = v.toLowerCase().trim();
    if (["true", "1", "yes", "y"].includes(str)) return true;
    if (["false", "0", "no", "n"].includes(str)) return false;
  }
  return fallback;
}

function normalizeOut(doc) {
  return {
    id: String(doc._id),
    nombre: doc.nombre ?? doc.name ?? "",
    descripcion: doc.descripcion ?? doc.description ?? "",
    precio: typeof doc.precio === "number" ? doc.precio : Number(doc.precio || 0),
    cuentaCodigo: doc.cuentaCodigo ?? doc.accountCode ?? null,
    subcuentaId: doc.subcuentaId ? String(doc.subcuentaId) : null,
    activo:
      typeof doc.activo === "boolean"
        ? doc.activo
        : typeof doc.isActive === "boolean"
          ? doc.isActive
          : true,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

/**
 * Extrae subcuentaId con aliases + sanitiza:
 * - undefined => undefined (no tocar en PUT)
 * - "" => null
 */
function readSubcuentaId(body) {
  if (!body) return undefined;

  // si viene explícito en cualquiera
  const raw =
    typeof body.subcuentaId !== "undefined"
      ? body.subcuentaId
      : typeof body.subcuenta_id !== "undefined"
        ? body.subcuenta_id
        : typeof body.subcuentaID !== "undefined"
          ? body.subcuentaID
          : undefined;

  if (typeof raw === "undefined") return undefined;
  if (raw === null) return null;

  const v = String(raw).trim();
  return v ? v : null; // "" => null
}

/**
 * Valida subcuenta (si Account existe)
 * Reglas:
 * - Debe existir y pertenecer al owner
 * - Debe ser subcuenta (parentCode != null)
 * - parentCode debe coincidir con cuentaCodigo
 */
async function validateSubcuenta({ owner, cuentaCodigo, subcuentaId }) {
  if (!Account) return null; // si no hay modelo Account, no validamos
  if (!subcuentaId) return null;

  const sub = await Account.findOne({
    _id: subcuentaId,
    owner,
    parentCode: { $exists: true, $ne: null },
  })
    .select("code codigo parentCode")
    .lean();

  if (!sub) {
    return {
      status: 404,
      message: "La subcuenta seleccionada no existe o no te pertenece.",
    };
  }

  if (String(sub.parentCode) !== String(cuentaCodigo)) {
    return {
      status: 400,
      message: `La subcuenta no pertenece a la cuenta ${cuentaCodigo}.`,
    };
  }

  return null;
}

/**
 * GET /api/productos
 * Query:
 * - activo=true|false
 * - cuenta_codigo=4001
 * - include_subcuentas=true|false (legacy: incluye productos con cuentaCodigo igual a hijos)
 * - q=texto (búsqueda)
 * - limit=500
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
    const and = [];

    // activo
    if (typeof activo !== "undefined") {
      and.push({ $or: [{ activo }, { isActive: activo }] });
    }

    // cuentaCodigo (incluye legacy por include_subcuentas)
    if (cuentaCodigo) {
      if (includeSubcuentas && Account) {
        const children = await Account.find({
          owner,
          parentCode: cuentaCodigo,
        })
          .select("code codigo")
          .lean();

        const childCodes = children.map((a) => String(a.code ?? a.codigo ?? "").trim()).filter(Boolean);
        const codes = [cuentaCodigo, ...childCodes];

        and.push({
          $or: [
            { cuentaCodigo: { $in: codes } },
            { accountCode: { $in: codes } },
          ],
        });
      } else {
        and.push({
          $or: [{ cuentaCodigo }, { accountCode: cuentaCodigo }],
        });
      }
    }

    // búsqueda simple
    if (qText) {
      and.push({
        $or: [
          { nombre: { $regex: qText, $options: "i" } },
          { name: { $regex: qText, $options: "i" } },
          { descripcion: { $regex: qText, $options: "i" } },
          { description: { $regex: qText, $options: "i" } },
        ],
      });
    }

    if (and.length) q.$and = and;

    const items = await Product.find(q).sort({ createdAt: -1 }).limit(limit).lean();
    return res.json({ ok: true, data: items.map(normalizeOut) });
  } catch (err) {
    console.error("GET /api/productos error:", err);
    return res.status(500).json({ ok: false, message: "Error cargando productos" });
  }
});

/**
 * POST /api/productos
 * Body mínimo:
 * - nombre
 * Opcional:
 * - descripcion, precio, cuentaCodigo (default 4001), subcuentaId, activo
 */
router.post("/", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;

    const nombre = s((req.body?.nombre ?? req.body?.name ?? "").toString());
    const descripcion = (req.body?.descripcion ?? req.body?.description ?? "").toString();
    const precio = numOrNull(req.body?.precio ?? req.body?.price);

    const cuentaCodigo = s((req.body?.cuentaCodigo ?? req.body?.accountCode ?? "4001").toString());
    const subcuentaId = readSubcuentaId(req.body) ?? null;

    const activo = toBool(req.body?.activo ?? req.body?.isActive, true);

    if (!nombre) return res.status(400).json({ ok: false, message: "El nombre es requerido." });
    if (precio === null) return res.status(400).json({ ok: false, message: "Precio inválido." });
    if (!cuentaCodigo) return res.status(400).json({ ok: false, message: "Falta cuentaCodigo." });

    // ✅ valida subcuenta si viene
    const subErr = await validateSubcuenta({ owner, cuentaCodigo, subcuentaId });
    if (subErr) return res.status(subErr.status).json({ ok: false, message: subErr.message });

    const created = await Product.create({
      owner,
      nombre,
      descripcion,
      precio,
      cuentaCodigo,
      subcuentaId,
      activo,
    });

    return res.status(201).json({ ok: true, data: normalizeOut(created.toObject?.() || created) });
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
 * ✅ Soporta subcuentaId (null para quitarla)
 */
router.put("/:id", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;
    const { id } = req.params;

    const allowed = ["nombre", "descripcion", "precio", "cuentaCodigo", "activo"];
    const patch = {};

    for (const k of allowed) {
      if (typeof req.body?.[k] !== "undefined") patch[k] = req.body[k];
    }

    // subcuentaId con aliases y null permitido
    const incomingSubcuentaId = readSubcuentaId(req.body);
    if (typeof incomingSubcuentaId !== "undefined") {
      patch.subcuentaId = incomingSubcuentaId; // puede ser string o null
    }

    if (typeof patch.nombre !== "undefined") patch.nombre = String(patch.nombre).trim();
    if (typeof patch.cuentaCodigo !== "undefined") patch.cuentaCodigo = String(patch.cuentaCodigo).trim();

    if (typeof patch.precio !== "undefined") {
      const precio = numOrNull(patch.precio);
      if (precio === null) return res.status(400).json({ ok: false, message: "Precio inválido." });
      patch.precio = precio;
    }

    if (typeof patch.activo !== "undefined") patch.activo = toBool(patch.activo, true);

    // Para validar subcuentaId necesitamos el cuentaCodigo final
    if (typeof patch.subcuentaId !== "undefined") {
      const current = await Product.findOne({ _id: id, owner }).select("cuentaCodigo accountCode").lean();
      if (!current) return res.status(404).json({ ok: false, message: "Producto no encontrado." });

      const finalCuenta = patch.cuentaCodigo ?? current.cuentaCodigo ?? current.accountCode ?? null;
      if (!finalCuenta) return res.status(400).json({ ok: false, message: "El producto no tiene cuentaCodigo." });

      const subErr = await validateSubcuenta({
        owner,
        cuentaCodigo: String(finalCuenta),
        subcuentaId: patch.subcuentaId,
      });
      if (subErr) return res.status(subErr.status).json({ ok: false, message: subErr.message });
    }

    const updated = await Product.findOneAndUpdate(
      { _id: id, owner },
      { $set: patch },
      { new: true }
    ).lean();

    if (!updated) return res.status(404).json({ ok: false, message: "Producto no encontrado." });

    return res.json({ ok: true, data: normalizeOut(updated) });
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
    if (!deleted) return res.status(404).json({ ok: false, message: "Producto no encontrado." });

    return res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/productos/:id error:", err);
    return res.status(500).json({ ok: false, message: "Error eliminando producto" });
  }
});

module.exports = router;
