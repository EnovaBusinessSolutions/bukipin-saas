// backend/routes/productosEgresos.js
const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const path = require("path");
const fs = require("fs");
const ensureAuth = require("../middleware/ensureAuth");

const ExpenseProduct = require("../models/ExpenseProduct");
const ExpenseTransaction = require("../models/ExpenseTransaction");

// ✅ Multer (para FormData con imagen)
let multer = null;
try {
  multer = require("multer");
} catch (_) {}

const upload = multer
  ? multer({
      storage: multer.memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
    })
  : null;

// ---- helpers base ----
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

function schemaHas(pathName) {
  return !!ExpenseProduct?.schema?.paths?.[pathName];
}

// 🔁 lee el body soportando snake_case o camelCase
function pickBody(req, keys, def = undefined) {
  for (const k of keys) {
    if (req.body && req.body[k] !== undefined) return req.body[k];
  }
  return def;
}

/**
 * ✅ Set robusto:
 * - Si el schema tiene 1+ nombres equivalentes, seteamos TODOS los que existan.
 * - Si no existe ninguno, seteamos el primer candidato (por si strict=false / legacy).
 */
function setBySchema(payload, candidates, value) {
  let setAny = false;
  for (const key of candidates) {
    if (schemaHas(key)) {
      payload[key] = value;
      setAny = true;
    }
  }
  if (!setAny && candidates?.length) {
    payload[candidates[0]] = value;
  }
}

// ✅ Detecta si ExpenseTransaction usa "productoId" o "productId"
let _txProductField = null;
function getTxProductField() {
  if (_txProductField) return _txProductField;
  const schemaPaths = ExpenseTransaction?.schema?.paths || {};
  if (schemaPaths.productoId) _txProductField = "productoId";
  else if (schemaPaths.productId) _txProductField = "productId";
  else _txProductField = "productoId";
  return _txProductField;
}

// ✅ Guardar imagen en /public/uploads/egresos (si existe publicRoot servido por express.static)
function saveImageIfAny(file) {
  if (!file) return null;

  const uploadsDir = path.join(process.cwd(), "public", "uploads", "egresos");
  fs.mkdirSync(uploadsDir, { recursive: true });

  const safeBase =
    Date.now().toString(36) +
    "-" +
    Math.random().toString(36).slice(2, 9) +
    "-" +
    (file.originalname || "img").replace(/[^a-zA-Z0-9.\-_]/g, "_");

  const outPath = path.join(uploadsDir, safeBase);
  fs.writeFileSync(outPath, file.buffer);

  // URL pública relativa (tu server debe servir /public como estático)
  return `/uploads/egresos/${safeBase}`;
}

function mapForUI(doc, stats = null) {
  const d = doc?.toObject ? doc.toObject() : doc;

  // métricas
  const total_transacciones = stats?.transacciones ? Number(stats.transacciones) : 0;
  const precio_promedio = stats?.precioPromedio ? toNum(stats.precioPromedio, 0) : 0;
  const variacion_precio = stats?.variacionPrecio ? toNum(stats.variacionPrecio, 0) : 0;
  const ultima_compra = stats?.ultimaCompra ? new Date(stats.ultimaCompra).toISOString() : null;

  // campos catálogo (normalizamos)
  const unidad =
    d.unidad ??
    d.unidadMedida ??
    d.unidad_medida ??
    "";

  const proveedor_principal =
    d.proveedor_principal ??
    d.proveedorPrincipal ??
    d.proveedor ??
    "";

  const es_recurrente =
    d.es_recurrente ??
    d.esRecurrente ??
    false;

  const cuenta_contable =
    d.cuenta_contable ??
    d.cuentaContable ??
    d.cuentaCodigo ??
    d.cuenta_codigo ??
    "";

  const subcuenta_id = d.subcuentaId
    ? String(d.subcuentaId)
    : (d.subcuenta_id ? String(d.subcuenta_id) : null);

  const imagen_url =
    d.imagen_url ??
    d.imagenUrl ??
    d.imageUrl ??
    null;

  // ✅ objeto final: lo que consume CatalogoProductos.tsx + hooks
  const item = {
    id: String(d._id),
    _id: d._id,

    nombre: d.nombre ?? "",
    descripcion: d.descripcion ?? "",
    tipo: d.tipo ?? "",

    unidad,
    proveedor_principal,
    es_recurrente: !!es_recurrente,

    subcuenta_id,
    cuenta_contable,

    imagen_url,

    // métricas (snake_case)
    precio_promedio,
    variacion_precio,
    total_transacciones,
    ultima_compra,

    activo: !!d.activo,

    created_at: d.createdAt,
    updated_at: d.updatedAt,

    // ✅ extras compat (por si algún lado usa camelCase)
    cuentaCodigo: cuenta_contable,
    subcuentaId: subcuenta_id,
    precioPromedio: precio_promedio,
    variacionPrecio: variacion_precio,
    transacciones: total_transacciones,
    ultimaCompra: ultima_compra,
    unidadMedida: unidad,
    unidad_medida: unidad,
    proveedorPrincipal: proveedor_principal,
    imagenUrl: imagen_url,
    cuenta_codigo: cuenta_contable,
  };

  return item;
}

/**
 * Stats reales desde ExpenseTransaction:
 * - transacciones (count)
 * - precioPromedio (avg precioUnitario)
 * - ultimaCompra (max fecha)
 * - variacionPrecio (% ultimo vs anterior) si hay >=2
 */
async function buildStats(owner, productIds) {
  const txField = getTxProductField();
  const ownerId = owner instanceof mongoose.Types.ObjectId ? owner : new mongoose.Types.ObjectId(owner);
  if (!productIds?.length) return new Map();

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

// -------------------- ROUTES --------------------

/**
 * GET /api/productos-egresos?activo=true&tipo=costo|gasto
 * ✅ devuelve ARRAY (lo que tu hook espera)
 */
router.get("/", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;

    const activo = asBool(req.query.activo, null);
    const tipo = normalizeTipo(req.query.tipo);

    const filter = { owner };
    if (activo !== null) filter.activo = activo;
    if (tipo && ["costo", "gasto"].includes(tipo)) filter.tipo = tipo;

    const docs = await ExpenseProduct.find(filter).sort({ createdAt: -1 }).lean();
    if (!docs.length) return res.json([]);

    const ids = docs.map((d) => d._id);
    const statsById = await buildStats(owner, ids);

    const items = docs.map((d) => mapForUI(d, statsById.get(String(d._id)) || null));
    return res.json(items);
  } catch (err) {
    console.error("GET /api/productos-egresos error:", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

/**
 * GET /api/productos-egresos/:id
 * ✅ necesario para editar / ver detalle
 */
router.get("/:id", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;
    const id = String(req.params.id || "").trim();

    const doc = await ExpenseProduct.findOne({ _id: id, owner }).lean();
    if (!doc) return res.status(404).json({ ok: false, error: "NOT_FOUND" });

    const statsById = await buildStats(owner, [doc._id]);
    const item = mapForUI(doc, statsById.get(String(doc._id)) || null);

    // devolvemos root + wrapper por compat
    return res.json({ ok: true, data: item, item, ...item });
  } catch (err) {
    console.error("GET /api/productos-egresos/:id error:", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

/**
 * POST /api/productos-egresos
 * ✅ soporta JSON y multipart(FormData)
 */
router.post(
  "/",
  ensureAuth,
  upload ? upload.single("imagen") : (req, res, next) => next(),
  async (req, res) => {
    try {
      // Si no hay multer instalado y llega multipart => req.body vacío.
      if (!upload && req.headers["content-type"]?.includes("multipart/form-data")) {
        return res.status(400).json({
          ok: false,
          error: "MULTER_MISSING",
          message: "Falta instalar multer en el backend para soportar imagen (FormData).",
        });
      }

      const owner = req.user._id;

      const nombre = String(pickBody(req, ["nombre", "name"], "")).trim();
      const tipo = normalizeTipo(pickBody(req, ["tipo", "type"], ""));

      const descripcion = String(pickBody(req, ["descripcion"], "")).trim();

      // ✅ OJO: soportar unidad_medida también
      const unidad = String(pickBody(req, ["unidad", "unidadMedida", "unidad_medida"], "")).trim();
      const proveedor_principal = String(
        pickBody(req, ["proveedor_principal", "proveedorPrincipal", "proveedor"], "")
      ).trim();

      const es_recurrente = asBool(pickBody(req, ["es_recurrente", "esRecurrente"], false), false);

      const subcuenta_id = pickBody(req, ["subcuenta_id", "subcuentaId"], null);
      const subcuentaId = toObjectIdOrNull(subcuenta_id);

      // ✅ OJO: soportar cuenta_codigo también
      const cuenta_contable = String(
        pickBody(req, ["cuenta_contable", "cuentaContable", "cuentaCodigo", "cuenta_codigo"], "")
      ).trim();

      const activo = asBool(pickBody(req, ["activo"], true), true);

      if (!nombre) {
        return res.status(400).json({ ok: false, error: "VALIDATION", message: "nombre es requerido." });
      }
      if (!["costo", "gasto"].includes(tipo)) {
        return res.status(400).json({ ok: false, error: "VALIDATION", message: "tipo inválido. Usa 'costo' o 'gasto'." });
      }
      if (!unidad) {
        return res.status(400).json({ ok: false, error: "VALIDATION", message: "unidad es requerida." });
      }
      if (tipo === "gasto" && !cuenta_contable) {
        return res.status(400).json({ ok: false, error: "VALIDATION", message: "cuenta_contable es requerida para gasto." });
      }
      if (tipo === "costo" && !subcuentaId) {
        return res.status(400).json({ ok: false, error: "VALIDATION", message: "subcuenta_id es requerida para costo." });
      }

      // ✅ imagen (si viene)
      const imagen_url = saveImageIfAny(req.file);

      // payload base
      const payload = {
        owner,
        nombre,
        tipo,
        descripcion,
        activo,
      };

      // ✅ cuenta contable (incluye cuenta_codigo)
      setBySchema(payload, ["cuenta_contable", "cuentaContable", "cuentaCodigo", "cuenta_codigo"], cuenta_contable);

      // ✅ subcuenta
      setBySchema(payload, ["subcuentaId", "subcuenta_id"], subcuentaId);

      // ✅ unidad (incluye unidad_medida)
      setBySchema(payload, ["unidad", "unidadMedida", "unidad_medida"], unidad);

      // ✅ proveedor
      setBySchema(payload, ["proveedor_principal", "proveedorPrincipal", "proveedor"], proveedor_principal);

      // ✅ recurrente
      setBySchema(payload, ["es_recurrente", "esRecurrente"], !!es_recurrente);

      // ✅ imagen
      if (imagen_url) {
        setBySchema(payload, ["imagen_url", "imagenUrl", "imageUrl"], imagen_url);
      }

      const created = await ExpenseProduct.create(payload);

      const item = mapForUI(created, null);
      return res.status(201).json({ ok: true, data: item, item, ...item });
    } catch (err) {
      console.error("POST /api/productos-egresos error:", err);
      return res.status(500).json({ ok: false, error: "SERVER_ERROR", message: err?.message || "SERVER_ERROR" });
    }
  }
);

/**
 * PATCH /api/productos-egresos/:id
 * ✅ soporta JSON y multipart(FormData)
 */
router.patch(
  "/:id",
  ensureAuth,
  upload ? upload.single("imagen") : (req, res, next) => next(),
  async (req, res) => {
    try {
      if (!upload && req.headers["content-type"]?.includes("multipart/form-data")) {
        return res.status(400).json({
          ok: false,
          error: "MULTER_MISSING",
          message: "Falta instalar multer en el backend para soportar imagen (FormData).",
        });
      }

      const owner = req.user._id;
      const id = String(req.params.id || "").trim();

      const patch = {};

      // nombre
      const nombreRaw = pickBody(req, ["nombre", "name"], undefined);
      if (nombreRaw !== undefined) patch.nombre = String(nombreRaw || "").trim();

      // tipo
      const tipoRaw = pickBody(req, ["tipo", "type"], undefined);
      if (tipoRaw !== undefined) {
        const t = normalizeTipo(tipoRaw);
        if (t && !["costo", "gasto"].includes(t)) {
          return res.status(400).json({ ok: false, error: "VALIDATION", message: "tipo inválido." });
        }
        patch.tipo = t;
      }

      // descripcion
      const descripcionRaw = pickBody(req, ["descripcion"], undefined);
      if (descripcionRaw !== undefined) patch.descripcion = String(descripcionRaw || "").trim();

      // ✅ unidad (incluye unidad_medida)
      const unidadRaw = pickBody(req, ["unidad", "unidadMedida", "unidad_medida"], undefined);
      if (unidadRaw !== undefined) {
        const unidad = String(unidadRaw || "").trim();
        // seteamos TODOS los nombres que existan en schema
        for (const k of ["unidad", "unidadMedida", "unidad_medida"]) {
          if (schemaHas(k)) patch[k] = unidad;
        }
        // fallback por si ninguno existe (legacy)
        if (!schemaHas("unidad") && !schemaHas("unidadMedida") && !schemaHas("unidad_medida")) {
          patch.unidad = unidad;
        }
      }

      // proveedor
      const provRaw = pickBody(req, ["proveedor_principal", "proveedorPrincipal", "proveedor"], undefined);
      if (provRaw !== undefined) {
        const prov = String(provRaw || "").trim();
        for (const k of ["proveedor_principal", "proveedorPrincipal", "proveedor"]) {
          if (schemaHas(k)) patch[k] = prov;
        }
        if (!schemaHas("proveedor_principal") && !schemaHas("proveedorPrincipal") && !schemaHas("proveedor")) {
          patch.proveedor_principal = prov;
        }
      }

      // recurrente
      const recRaw = pickBody(req, ["es_recurrente", "esRecurrente"], undefined);
      if (recRaw !== undefined) {
        const rec = asBool(recRaw, false);
        for (const k of ["es_recurrente", "esRecurrente"]) {
          if (schemaHas(k)) patch[k] = !!rec;
        }
        if (!schemaHas("es_recurrente") && !schemaHas("esRecurrente")) {
          patch.es_recurrente = !!rec;
        }
      }

      // ✅ cuenta contable (incluye cuenta_codigo)
      const ccRaw = pickBody(req, ["cuenta_contable", "cuentaContable", "cuentaCodigo", "cuenta_codigo"], undefined);
      if (ccRaw !== undefined) {
        const cc = String(ccRaw || "").trim();
        for (const k of ["cuenta_contable", "cuentaContable", "cuentaCodigo", "cuenta_codigo"]) {
          if (schemaHas(k)) patch[k] = cc;
        }
        if (
          !schemaHas("cuenta_contable") &&
          !schemaHas("cuentaContable") &&
          !schemaHas("cuentaCodigo") &&
          !schemaHas("cuenta_codigo")
        ) {
          patch.cuenta_contable = cc;
        }
      }

      // subcuenta
      const subRaw = pickBody(req, ["subcuenta_id", "subcuentaId"], undefined);
      if (subRaw !== undefined) {
        const subId = toObjectIdOrNull(subRaw);
        for (const k of ["subcuentaId", "subcuenta_id"]) {
          if (schemaHas(k)) patch[k] = subId;
        }
        if (!schemaHas("subcuentaId") && !schemaHas("subcuenta_id")) {
          patch.subcuentaId = subId;
        }
      }

      // activo
      const activoRaw = pickBody(req, ["activo"], undefined);
      if (activoRaw !== undefined) patch.activo = asBool(activoRaw, true);

      // imagen
      const imgUrl = saveImageIfAny(req.file);
      if (imgUrl) {
        for (const k of ["imagen_url", "imagenUrl", "imageUrl"]) {
          if (schemaHas(k)) patch[k] = imgUrl;
        }
        if (!schemaHas("imagen_url") && !schemaHas("imagenUrl") && !schemaHas("imageUrl")) {
          patch.imagen_url = imgUrl;
        }
      }

      const updated = await ExpenseProduct.findOneAndUpdate({ _id: id, owner }, patch, { new: true }).lean();
      if (!updated) return res.status(404).json({ ok: false, error: "NOT_FOUND" });

      const statsById = await buildStats(owner, [updated._id]);
      const item = mapForUI(updated, statsById.get(String(updated._id)) || null);

      return res.json({ ok: true, data: item, item, ...item });
    } catch (err) {
      console.error("PATCH /api/productos-egresos/:id error:", err);
      return res.status(500).json({ ok: false, error: "SERVER_ERROR", message: err?.message || "SERVER_ERROR" });
    }
  }
);

/**
 * DELETE /api/productos-egresos/:id
 * (tu UI usa borrado lógico, pero dejamos delete real por si lo ocupas)
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
