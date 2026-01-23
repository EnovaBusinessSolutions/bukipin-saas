// backend/routes/productos.js
const express = require("express");
const router = express.Router();

const ensureAuth = require("../middleware/ensureAuth");
const Product = require("../models/Product");

// ✅ Movimientos de inventario (nuevo backend)
let InventoryMovement = null;
try {
  // nombre probable
  InventoryMovement = require("../models/InventoryMovement");
} catch (_) {
  try {
    // nombre alterno común
    InventoryMovement = require("../models/MovimientoInventario");
  } catch (_) {
    InventoryMovement = null;
  }
}

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

// ✅ Evita regex injection y fallos por caracteres especiales
function escapeRegex(str) {
  return String(str || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Lee precio venta desde cualquier alias
 */
function readPrecioVenta(body) {
  if (!body) return undefined;

  const raw =
    typeof body.precioVenta !== "undefined"
      ? body.precioVenta
      : typeof body.precio_venta !== "undefined"
        ? body.precio_venta
        : typeof body.precioVentaSugerido !== "undefined"
          ? body.precioVentaSugerido
          : typeof body.precio_venta_sugerido !== "undefined"
            ? body.precio_venta_sugerido
            : undefined;

  if (typeof raw === "undefined") return undefined;
  const n = numOrNull(raw);
  return n === null ? undefined : n;
}

/**
 * Lee costo compra desde cualquier alias
 */
function readCostoCompra(body) {
  if (!body) return undefined;

  const raw =
    typeof body.costoCompra !== "undefined"
      ? body.costoCompra
      : typeof body.costo_compra !== "undefined"
        ? body.costo_compra
        : undefined;

  if (typeof raw === "undefined") return undefined;
  const n = numOrNull(raw);
  return n === null ? undefined : n;
}

function normalizeOut(doc) {
  const precio = typeof doc.precio === "number" ? doc.precio : Number(doc.precio || 0);

  const costoCompra =
    typeof doc.costoCompra === "number"
      ? doc.costoCompra
      : typeof doc.costo_compra === "number"
        ? doc.costo_compra
        : precio; // compat: precio = costo

  const precioVenta =
    typeof doc.precioVenta === "number"
      ? doc.precioVenta
      : typeof doc.precio_venta === "number"
        ? doc.precio_venta
        : 0;

  return {
    id: String(doc._id),
    nombre: doc.nombre ?? doc.name ?? "",
    descripcion: doc.descripcion ?? doc.description ?? "",

    // ✅ compat actual (tu UI lo usa como costo legacy)
    precio,

    // ✅ inventario (camel + snake)
    costoCompra,
    costo_compra: costoCompra,

    precioVenta,
    precio_venta: precioVenta,

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
  return v ? v : null;
}

/**
 * Valida subcuenta (si Account existe)
 */
async function validateSubcuenta({ owner, cuentaCodigo, subcuentaId }) {
  if (!Account) return null;
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
 * ✅ Inventario: calcula métricas por producto desde movimientos
 * Retorna un Map(productIdString -> metrics)
 */
async function buildInventoryMetricsMap({ owner, productIds }) {
  const map = new Map();

  if (!InventoryMovement) return map;
  if (!Array.isArray(productIds) || productIds.length === 0) return map;

  // convertir ids a ObjectId cuando aplique (sin romper si alguno no lo es)
  const mongoose = require("mongoose");
  const oid = (v) => {
    try {
      return new mongoose.Types.ObjectId(String(v));
    } catch (_) {
      return null;
    }
  };

  const oids = productIds.map(oid).filter(Boolean);

  // Si por algún motivo no se pudo convertir ninguno, no hacemos nada
  if (!oids.length) return map;

  const cancelledStatuses = ["cancelado", "canceled", "cancelled", "anulado"];

  // Pipeline robusto: detecta pid/tipo/qty/costos por aliases
  const pipeline = [
    {
      $match: {
        owner,
        $or: [
          { productoId: { $in: oids } },
          { productId: { $in: oids } },
          { producto_id: { $in: oids } },
          { product_id: { $in: oids } },
        ],
        $nor: [
          { cancelado: true },
          { canceled: true },
          { cancelled: true },
          { isCanceled: true },
          { isCancelled: true },
          { isCanceled: true },
          { isCancelled: true },
          { estado: { $in: cancelledStatuses } },
          { status: { $in: cancelledStatuses } },
        ],
      },
    },
    {
      $addFields: {
        _pid: {
          $toString: {
            $ifNull: [
              "$productoId",
              { $ifNull: ["$productId", { $ifNull: ["$producto_id", "$product_id"] }] },
            ],
          },
        },
        _tipo: {
          $toLower: {
            $trim: {
              input: {
                $ifNull: [
                  "$tipo_movimiento",
                  { $ifNull: ["$tipoMovimiento", { $ifNull: ["$tipo", "$type"] }] },
                ],
              },
            },
          },
        },
        _qty: {
          $toDouble: {
            $ifNull: [
              "$cantidad",
              {
                $ifNull: [
                  "$qty",
                  { $ifNull: ["$quantity", { $ifNull: ["$unidades", "$units"] }] },
                ],
              },
            ],
          },
        },
        _costoUnit: {
          $toDouble: {
            $ifNull: [
              "$costo_unitario",
              {
                $ifNull: [
                  "$costoUnitario",
                  {
                    $ifNull: [
                      "$unitCost",
                      {
                        $ifNull: [
                          "$costoCompra",
                          { $ifNull: ["$costo_compra", { $ifNull: ["$precio_unitario", "$precioUnitario"] }] },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        },
        _costoTotal: {
          $toDouble: {
            $ifNull: [
              "$costo_total",
              {
                $ifNull: [
                  "$costoTotal",
                  { $ifNull: ["$total", { $ifNull: ["$monto_total", "$montoTotal"] }] },
                ],
              },
            ],
          },
        },
        _fecha: {
          $ifNull: ["$fecha", { $ifNull: ["$createdAt", "$created_at"] }],
        },
      },
    },
    {
      $addFields: {
        _unitEff: {
          $cond: [
            { $gt: ["$_costoUnit", 0] },
            "$_costoUnit",
            {
              $cond: [
                { $and: [{ $gt: ["$_costoTotal", 0] }, { $gt: ["$_qty", 0] }] },
                { $divide: ["$_costoTotal", "$_qty"] },
                0,
              ],
            },
          ],
        },
      },
    },
    {
      $addFields: {
        _isEntrada: { $in: ["$_tipo", ["entrada", "compra"]] },
        _isSalida: { $in: ["$_tipo", ["salida", "venta"]] },
        _isAjuste: { $eq: ["$_tipo", "ajuste"] },
      },
    },
    {
      $group: {
        _id: "$_pid",
        entradasQty: { $sum: { $cond: ["$_isEntrada", "$_qty", 0] } },
        salidasQty: { $sum: { $cond: ["$_isSalida", "$_qty", 0] } },
        ajustesQty: { $sum: { $cond: ["$_isAjuste", "$_qty", 0] } },
        costSum: {
          $sum: {
            $cond: ["$_isEntrada", { $multiply: ["$_unitEff", "$_qty"] }, 0],
          },
        },
        costQty: { $sum: { $cond: ["$_isEntrada", "$_qty", 0] } },
        lastDate: { $max: "$_fecha" },
      },
    },
  ];

  const rows = await InventoryMovement.aggregate(pipeline).exec();

  for (const r of rows) {
    const entradas = Number(r.entradasQty || 0);
    const salidas = Number(r.salidasQty || 0);
    const ajustes = Number(r.ajustesQty || 0);

    const costQty = Number(r.costQty || 0);
    const costSum = Number(r.costSum || 0);

    const costo_unitario = costQty > 0 ? costSum / costQty : 0;

    const cantidad_stock = entradas - salidas + ajustes;

    map.set(String(r._id), {
      cantidad_comprada: entradas,
      cantidad_vendida: salidas,
      cantidad_stock,
      costo_unitario,
      valor_total_inventario: cantidad_stock * costo_unitario,
      ultimo_movimiento: r.lastDate ? new Date(r.lastDate).toISOString() : null,
    });
  }

  return map;
}

/**
 * GET /api/productos
 * ✅ Ahora soporta inventario=1 para devolver métricas calculadas desde movimientos
 */
router.get("/", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;

    const activo = boolFromQuery(req.query.activo);
    const cuentaCodigo = req.query.cuenta_codigo ? String(req.query.cuenta_codigo).trim() : null;
    const includeSubcuentas = boolFromQuery(req.query.include_subcuentas);

    // ✅ NUEVO: inventario=1 (preferido por tu UI)
    const inventario = boolFromQuery(req.query.inventario);

    const qText = req.query.q ? String(req.query.q).trim() : "";

    let limit = Number(req.query.limit || 500);
    if (!Number.isFinite(limit) || limit <= 0) limit = 500;
    limit = Math.min(2000, limit);

    const q = { owner };
    const and = [];

    if (typeof activo !== "undefined") {
      and.push({ $or: [{ activo }, { isActive: activo }] });
    }

    // ✅ Si inventario=1, forzamos cuenta 1005
    // (esto evita que el endpoint mezcle productos no inventariados)
    const effectiveCuenta = inventario ? "1005" : cuentaCodigo;

    if (effectiveCuenta) {
      if (includeSubcuentas && Account) {
        const children = await Account.find({
          owner,
          parentCode: effectiveCuenta,
        })
          .select("code codigo")
          .lean();

        const childCodes = children
          .map((a) => String(a.code ?? a.codigo ?? "").trim())
          .filter(Boolean);

        const codes = [effectiveCuenta, ...childCodes];

        and.push({
          $or: [{ cuentaCodigo: { $in: codes } }, { accountCode: { $in: codes } }],
        });
      } else {
        and.push({
          $or: [{ cuentaCodigo: effectiveCuenta }, { accountCode: effectiveCuenta }],
        });
      }
    }

    if (qText) {
      const rx = new RegExp(escapeRegex(qText), "i");
      and.push({
        $or: [{ nombre: rx }, { name: rx }, { descripcion: rx }, { description: rx }],
      });
    }

    if (and.length) q.$and = and;

    const items = await Product.find(q).sort({ createdAt: -1 }).limit(limit).lean();

    // ✅ si NO es inventario, respuesta legacy igual que antes
    if (!inventario) {
      return res.json({ ok: true, data: items.map(normalizeOut) });
    }

    // ✅ inventario=1: calcular métricas desde movimientos
    const productIds = items.map((p) => String(p._id));
    const metricsMap = await buildInventoryMetricsMap({ owner, productIds });

    const out = items.map((doc) => {
      const base = normalizeOut(doc);
      const m = metricsMap.get(base.id) || {
        cantidad_comprada: 0,
        cantidad_vendida: 0,
        cantidad_stock: 0,
        costo_unitario: 0,
        valor_total_inventario: 0,
        ultimo_movimiento: null,
      };

      return {
        ...base,

        // ✅ métricas E2E para inventario (lo que tu frontend necesita)
        cantidad_comprada: m.cantidad_comprada,
        cantidad_vendida: m.cantidad_vendida,
        cantidad_stock: m.cantidad_stock,
        costo_unitario: m.costo_unitario,
        valor_total_inventario: m.valor_total_inventario,
        ultimo_movimiento: m.ultimo_movimiento,
      };
    });

    return res.json({ ok: true, data: out });
  } catch (err) {
    console.error("GET /api/productos error:", err);
    return res.status(500).json({ ok: false, message: "Error cargando productos" });
  }
});

/**
 * GET /api/productos/lookup?nombre=...
 */
router.get("/lookup", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;

    const nombre = req.query.nombre ? String(req.query.nombre).trim() : "";
    const name = req.query.name ? String(req.query.name).trim() : "";
    const finalName = nombre || name;

    if (!finalName) {
      return res.status(400).json({ ok: false, message: "Falta el parámetro nombre." });
    }

    const rxExact = new RegExp(`^\\s*${escapeRegex(finalName)}\\s*$`, "i");

    const doc = await Product.findOne({
      owner,
      $or: [{ nombre: rxExact }, { name: rxExact }],
    }).lean();

    return res.json({ ok: true, data: doc ? normalizeOut(doc) : null });
  } catch (err) {
    console.error("GET /api/productos/lookup error:", err);
    return res.status(500).json({ ok: false, message: "Error buscando producto" });
  }
});

/**
 * POST /api/productos
 * Ahora soporta inventario:
 * - precio (compat costo)
 * - costoCompra/costo_compra
 * - precioVenta/precio_venta
 */
router.post("/", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;

    const nombre = s((req.body?.nombre ?? req.body?.name ?? "").toString());
    const descripcion = (req.body?.descripcion ?? req.body?.description ?? "").toString();

    // ✅ compat: precio = costo unitario si inventario
    const precio = numOrNull(req.body?.precio ?? req.body?.price);

    const cuentaCodigo = s((req.body?.cuentaCodigo ?? req.body?.accountCode ?? "4001").toString());
    const subcuentaId = readSubcuentaId(req.body) ?? null;

    const activo = toBool(req.body?.activo ?? req.body?.isActive, true);

    // ✅ nuevos campos inventario
    const precioVenta = readPrecioVenta(req.body);
    const costoCompra = readCostoCompra(req.body);

    if (!nombre) return res.status(400).json({ ok: false, message: "El nombre es requerido." });
    if (precio === null) return res.status(400).json({ ok: false, message: "Precio inválido." });
    if (!cuentaCodigo) return res.status(400).json({ ok: false, message: "Falta cuentaCodigo." });

    const subErr = await validateSubcuenta({ owner, cuentaCodigo, subcuentaId });
    if (subErr) return res.status(subErr.status).json({ ok: false, message: subErr.message });

    const payload = {
      owner,
      nombre,
      descripcion,
      precio, // compat: costo
      cuentaCodigo,
      subcuentaId,
      activo,
    };

    // Si vienen inventario fields, los guardamos
    if (typeof costoCompra !== "undefined") {
      payload.costoCompra = costoCompra;
      payload.costo_compra = costoCompra;
    } else {
      // espejo por default
      payload.costoCompra = precio;
      payload.costo_compra = precio;
    }

    if (typeof precioVenta !== "undefined") {
      payload.precioVenta = precioVenta;
      payload.precio_venta = precioVenta;
    }

    const created = await Product.create(payload);

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
 * ✅ soporta actualizar precios de inventario:
 * - precio (compat costo)
 * - costoCompra/costo_compra
 * - precioVenta/precio_venta
 */
router.put("/:id", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;
    const { id } = req.params;

    const patch = {};

    // whitelist base (legacy)
    const allowed = ["nombre", "descripcion", "precio", "cuentaCodigo", "activo"];
    for (const k of allowed) {
      if (typeof req.body?.[k] !== "undefined") patch[k] = req.body[k];
    }

    // subcuentaId con aliases y null permitido
    const incomingSubcuentaId = readSubcuentaId(req.body);
    if (typeof incomingSubcuentaId !== "undefined") {
      patch.subcuentaId = incomingSubcuentaId;
    }

    // ✅ inventario fields
    const incomingPrecioVenta = readPrecioVenta(req.body);
    if (typeof incomingPrecioVenta !== "undefined") {
      patch.precioVenta = incomingPrecioVenta;
      patch.precio_venta = incomingPrecioVenta;
    }

    const incomingCostoCompra = readCostoCompra(req.body);
    if (typeof incomingCostoCompra !== "undefined") {
      patch.costoCompra = incomingCostoCompra;
      patch.costo_compra = incomingCostoCompra;
    }

    if (typeof patch.nombre !== "undefined") patch.nombre = String(patch.nombre).trim();
    if (typeof patch.cuentaCodigo !== "undefined") patch.cuentaCodigo = String(patch.cuentaCodigo).trim();

    if (typeof patch.precio !== "undefined") {
      const precio = numOrNull(patch.precio);
      if (precio === null) return res.status(400).json({ ok: false, message: "Precio inválido." });
      patch.precio = precio;

      // espejo default si no mandan costoCompra explícito
      if (typeof patch.costoCompra === "undefined") {
        patch.costoCompra = precio;
        patch.costo_compra = precio;
      }
    }

    if (typeof patch.activo !== "undefined") patch.activo = toBool(patch.activo, true);

    // validar subcuenta contra cuenta final
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

    const updated = await Product.findOneAndUpdate({ _id: id, owner }, { $set: patch }, { new: true }).lean();
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
