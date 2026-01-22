// backend/routes/movimientosInventario.js
const express = require("express");
const router = express.Router();

const ensureAuth = require("../middleware/ensureAuth");

// Modelos
let InventoryMovement = null;
let JournalEntry = null;
let Account = null;
let Product = null;

try {
  InventoryMovement = require("../models/InventoryMovement");
} catch (e) {
  InventoryMovement = null;
}

try {
  JournalEntry = require("../models/JournalEntry");
} catch (_) {
  JournalEntry = null;
}

try {
  Account = require("../models/Account");
} catch (_) {
  Account = null;
}

try {
  Product = require("../models/Product");
} catch (_) {
  Product = null;
}

// --------------------
// Helpers
// --------------------
function num(v, def = 0) {
  if (v === null || v === undefined) return def;
  const s = String(v).trim();
  if (!s) return def;
  const cleaned = s.replace(/[$,\s]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : def;
}

function numOrNaN(v) {
  if (v === null || v === undefined) return NaN;
  const s = String(v).trim();
  if (!s) return NaN;
  const cleaned = s.replace(/[$,\s]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : NaN;
}

function isValidObjectId(str) {
  return typeof str === "string" && /^[a-f\d]{24}$/i.test(str);
}

function accCode(acc) {
  if (!acc) return "";
  return String(acc.code ?? acc.codigo ?? acc.accountCode ?? acc.cuentaCodigo ?? "").trim();
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
  const order = String(orderRaw || "fecha:desc").trim();
  const [field, dir] = order.split(":");
  const key = (field || "fecha").trim();
  const direction = String(dir || "desc").toLowerCase() === "asc" ? 1 : -1;
  return { [key]: direction, createdAt: -1 };
}

function pickTipo(m) {
  return String(m?.tipo_movimiento ?? m?.tipoMovimiento ?? m?.tipo ?? m?.type ?? "")
    .toLowerCase()
    .trim();
}

function pickEstado(m) {
  return String(m?.estado ?? m?.status ?? "activo").toLowerCase().trim();
}

function isEntrada(tipo) {
  const t = String(tipo || "").toLowerCase().trim();
  return t === "entrada" || t === "compra" || t === "ajuste_entrada";
}
function isSalida(tipo) {
  const t = String(tipo || "").toLowerCase().trim();
  return t === "salida" || t === "venta" || t === "ajuste_salida";
}

// --------------------
// Contabilidad (resolver cuentas)
// --------------------
async function findAccountByCode(owner, code) {
  if (!Account || !code) return null;
  const c = String(code).trim();
  return await Account.findOne({
    owner,
    $or: [{ code: c }, { codigo: c }, { cuentaCodigo: c }, { accountCode: c }],
  }).lean();
}

async function findAccountByName(owner, nameRegex, type) {
  if (!Account) return null;
  const q = { owner, name: { $regex: nameRegex, $options: "i" } };
  if (type) q.type = type;
  return await Account.findOne(q).lean();
}

/**
 * Resuelve cuentas con fallback:
 * - Inventario: 1201
 * - Proveedores/CxP: 2001
 * - Caja: 1001
 * - Bancos: 1002
 */
async function resolveInventoryAccounts(owner) {
  const inv =
    (await findAccountByCode(owner, "1201")) ||
    (await findAccountByName(owner, "inventario", "activo")) ||
    (await findAccountByName(owner, "inventario", null));

  const caja =
    (await findAccountByCode(owner, "1001")) ||
    (await findAccountByName(owner, "caja", "activo")) ||
    (await findAccountByName(owner, "caja", null));

  const bancos =
    (await findAccountByCode(owner, "1002")) ||
    (await findAccountByName(owner, "banco", "activo")) ||
    (await findAccountByName(owner, "banco", null));

  const proveedores =
    (await findAccountByCode(owner, "2001")) ||
    (await findAccountByName(owner, "proveedor", "pasivo")) ||
    (await findAccountByName(owner, "cuentas por pagar", "pasivo")) ||
    (await findAccountByName(owner, "por pagar", "pasivo"));

  return { inv, caja, bancos, proveedores };
}

// --------------------
// Pagos (para asiento compra)
// --------------------
function parseMetodoPago(body) {
  const raw =
    body?.metodoPago ??
    body?.metodo_pago ??
    body?.paymentMethod ??
    body?.metodo ??
    body?.medioPago ??
    body?.medio_pago ??
    "";
  return String(raw).toLowerCase().trim();
}

function parseTipoPago(body) {
  const raw =
    body?.tipoPago ??
    body?.tipo_pago ??
    body?.estadoPago ??
    body?.estado_pago ??
    body?.paymentType ??
    "";
  return String(raw).toLowerCase().trim();
}

function isCredito(tipoPago) {
  return tipoPago.includes("credito") || tipoPago.includes("crédito") || tipoPago.includes("pendiente");
}

// --------------------
// Mapper UI (NO rompe front)
// --------------------
function mapMovementForUI(m) {
  const fecha = m.fecha || m.date || m.createdAt || m.created_at || m.updatedAt;

  // Fuente de verdad: qty/unitCost/total
  const cantidad = num(m.qty ?? m.cantidad ?? m.quantity ?? m.unidades ?? m.units, 0);

  let costoUnitario = num(
    m.unitCost ??
      m.costo_unitario ??
      m.costoUnitario ??
      m.unit_cost ??
      m.precio_unitario ??
      m.unitPrice ??
      0,
    0
  );

  let costoTotal = num(m.total ?? m.costo_total ?? m.costoTotal ?? m.monto_total ?? m.montoTotal ?? 0, 0);

  if (!costoTotal && costoUnitario && cantidad) costoTotal = costoUnitario * cantidad;
  if (!costoUnitario && costoTotal && cantidad) costoUnitario = costoTotal / cantidad;

  const prodObj = m.productId || m.productoId || m.producto_id || m.producto || m.product || null;

  const prodId =
    prodObj && typeof prodObj === "object"
      ? String(prodObj._id || prodObj.id || "")
      : prodObj
      ? String(prodObj)
      : (m.productId ? String(m.productId) : null);

  const prodNombre =
    prodObj && typeof prodObj === "object"
      ? prodObj.nombre ?? prodObj.name ?? prodObj.descripcion ?? prodObj.title ?? null
      : null;

  const prodImg =
    prodObj && typeof prodObj === "object"
      ? prodObj.imagen_url ?? prodObj.imagenUrl ?? prodObj.image ?? null
      : null;

  const tipo = pickTipo(m) || String(m.tipo || "ajuste").toLowerCase();
  const estado = pickEstado(m) || "activo";

  const asientoId = m.asientoId || m.asiento_id || m.journalEntryId || m.journal_entry_id || null;

  return {
    id: String(m._id),
    _id: m._id,

    fecha,
    tipo_movimiento: tipo,
    tipo,
    estado,

    // compat front
    producto_id: prodId,
    productoId: prodId,

    productos: {
      nombre: prodNombre || "Producto",
      imagen_url: prodImg || undefined,
    },
    producto: prodId ? { id: prodId, nombre: prodNombre || "Producto", imagen_url: prodImg || undefined } : null,

    cantidad,
    costo_unitario: costoUnitario,
    costoUnitario,
    costo_total: costoTotal,
    costoTotal,

    descripcion: m.descripcion ?? m.memo ?? m.concepto ?? m.nota ?? "",
    referencia: m.referencia ?? m.ref ?? "",

    asientoId: asientoId ? String(asientoId) : null,
    asiento_id: asientoId ? String(asientoId) : null,
    journalEntryId: asientoId ? String(asientoId) : null,

    created_at: m.createdAt,
    updated_at: m.updatedAt,
  };
}

// --------------------
// GET /api/movimientos-inventario
// ✅ FIX: populate SIEMPRE por productId (campo real)
// --------------------
router.get("/", ensureAuth, async (req, res) => {
  try {
    if (!InventoryMovement) {
      return res.status(500).json({
        ok: false,
        message: "No se encontró el modelo InventoryMovement. Verifica backend/models/InventoryMovement.js",
      });
    }

    const owner = req.user._id;

    const estadoRaw = req.query.estado ? String(req.query.estado).trim().toLowerCase() : null;
    const tipoRaw = req.query.tipo ? String(req.query.tipo).trim().toLowerCase() : null;

    const start = parseStartDate(req.query.start || req.query.from);
    const end = parseEndDate(req.query.end || req.query.to);

    const productoId = String(req.query.productoId || req.query.producto_id || req.query.productId || "").trim();

    const limit = Math.min(5000, Number(req.query.limit || 500));
    const sort = parseOrder(req.query.order);

    const and = [{ owner }];

    if (estadoRaw && estadoRaw !== "todos") {
      if (estadoRaw === "activo") {
        and.push({
          $or: [{ status: "activo" }, { status: { $exists: false } }, { status: null }],
        });
      } else {
        and.push({ status: estadoRaw });
      }
    }

    if (tipoRaw && tipoRaw !== "todos") {
      and.push({
        $or: [{ tipo: tipoRaw }, { type: tipoRaw }, { tipo_movimiento: tipoRaw }, { tipoMovimiento: tipoRaw }],
      });
    }

    if (start && end) and.push({ fecha: { $gte: start, $lte: end } });
    else if (start && !end) and.push({ fecha: { $gte: start } });
    else if (!start && end) and.push({ fecha: { $lte: end } });

    if (productoId) {
      and.push({ productId: productoId }); // ✅ campo real
    }

    const filter = and.length > 1 ? { $and: and } : and[0];

    const rows = await InventoryMovement.find(filter)
      .sort(sort)
      .limit(limit)
      .setOptions({ strictPopulate: false })
      .populate(
        "productId",
        "nombre name imagen_url imagenUrl image sku codigo code costoCompra costo_compra precio price"
      )
      .lean();

    const items = (rows || []).map(mapMovementForUI);

    return res.json({
      ok: true,
      data: { items, count: items.length },
      items,
      count: items.length,
    });
  } catch (err) {
    console.error("GET /api/movimientos-inventario error:", err);
    return res.status(500).json({ ok: false, message: "Error cargando movimientos de inventario" });
  }
});

// --------------------
// POST /api/movimientos-inventario
// ✅ FIX E2E: persistir en campos CANÓNICOS (qty, unitCost, total, productId)
// --------------------
router.post("/", ensureAuth, async (req, res) => {
  try {
    if (!InventoryMovement) {
      return res.status(500).json({
        ok: false,
        message: "No se encontró el modelo InventoryMovement. Verifica backend/models/InventoryMovement.js",
      });
    }

    const owner = req.user._id;

    const tipo = String(req.body?.tipo ?? req.body?.tipo_movimiento ?? "ajuste").trim().toLowerCase();
    const estado = String(req.body?.estado ?? "activo").trim().toLowerCase();

    const productoIdRaw = req.body?.productoId ?? req.body?.producto_id ?? req.body?.productId ?? null;
    const productoId = productoIdRaw ? String(productoIdRaw).trim() : "";

    const cantidad = num(req.body?.cantidad ?? req.body?.qty ?? req.body?.quantity ?? req.body?.unidades ?? 0, NaN);

    const costoUnitarioRaw =
      req.body?.costoUnitario ??
      req.body?.costo_unitario ??
      req.body?.unitCost ??
      req.body?.precio_unitario ??
      req.body?.precioUnitario ??
      null;

    const costoTotalRaw =
      req.body?.costoTotal ?? req.body?.costo_total ?? req.body?.total ?? req.body?.monto_total ?? null;

    let costoUnitario = numOrNaN(costoUnitarioRaw);
    let costoTotal = numOrNaN(costoTotalRaw);

    const descripcion = String(req.body?.descripcion || "").trim();
    const referencia = String(req.body?.referencia || "").trim();

    const fecha = req.body?.fecha ? new Date(req.body.fecha) : new Date();
    if (Number.isNaN(fecha.getTime())) {
      return res.status(400).json({ ok: false, message: "fecha inválida." });
    }

    if (!productoId) return res.status(400).json({ ok: false, message: "productoId es requerido." });
    if (!isValidObjectId(productoId)) return res.status(400).json({ ok: false, message: "productoId inválido." });

    if (!Number.isFinite(cantidad) || cantidad === 0) {
      return res.status(400).json({ ok: false, message: "cantidad es requerida y no puede ser 0." });
    }

    // ✅ 1) si no vino costoUnitario, tomarlo del producto
    if ((!Number.isFinite(costoUnitario) || costoUnitario <= 0) && Product) {
      const prod = await Product.findOne({ _id: productoId, owner })
        .select("costoCompra costo_compra precio price")
        .lean();

      const fallback =
        numOrNaN(prod?.costoCompra) ||
        numOrNaN(prod?.costo_compra) ||
        numOrNaN(prod?.precio) ||
        numOrNaN(prod?.price);

      if (Number.isFinite(fallback) && fallback > 0) costoUnitario = fallback;
    }

    if (!Number.isFinite(costoUnitario) || costoUnitario < 0) costoUnitario = 0;

    // ✅ 2) total como fuente de verdad
    if (!Number.isFinite(costoTotal) || costoTotal <= 0) {
      costoTotal = Math.abs(cantidad) * Math.abs(costoUnitario);
    } else {
      costoTotal = Math.abs(costoTotal);
      if (costoUnitario === 0 && cantidad) costoUnitario = costoTotal / Math.abs(cantidad);
    }

    // --------------------
    // ✅ Payload CANÓNICO (esto es lo que Atlas debe mostrar)
    // --------------------
    const payload = {
      owner,
      fecha,

      // Canon del modelo InventoryMovement
      tipo,
      status: estado,

      productId: productoId,
      qty: cantidad,
      unitCost: costoUnitario,
      total: costoTotal,

      nota: descripcion || "",
      source: "ui",
      sourceId: null,

      // Aliases de compat (por si alguna UI vieja los usa)
      type: tipo,
      tipo_movimiento: tipo,
      tipoMovimiento: tipo,

      productoId,
      producto_id: productoId,

      cantidad,
      costoUnitario,
      costo_unitario: costoUnitario,

      costoTotal,
      costo_total: costoTotal,

      descripcion,
      referencia,
    };

    const created = await InventoryMovement.create(payload);

    // --------------------
    // ✅ Asiento contable (NO rompe si falla)
    // --------------------
    let asientoId = null;
    let asientoWarning = null;

    const debeGenerarAsiento = (isEntrada(tipo) || isSalida(tipo)) && costoTotal > 0;

    if (debeGenerarAsiento && JournalEntry && Account) {
      try {
        const { inv, caja, bancos, proveedores } = await resolveInventoryAccounts(owner);

        const invCode = accCode(inv);
        const cajaCode = accCode(caja);
        const bancosCode = accCode(bancos);
        const provCode = accCode(proveedores);

        if (!invCode) {
          asientoWarning = "No se pudo generar asiento: cuenta 1201 Inventario sin code/codigo.";
        } else {
          const metodoPago = parseMetodoPago(req.body);
          const tipoPago = parseTipoPago(req.body);

          const usarProveedores = isEntrada(tipo) && isCredito(tipoPago);
          const usarBancos =
            metodoPago.includes("banco") ||
            metodoPago.includes("transfer") ||
            metodoPago.includes("tarjeta") ||
            metodoPago.includes("tdd") ||
            metodoPago.includes("tdc");

          const contraCode = usarProveedores ? provCode : (usarBancos ? bancosCode : cajaCode);

          if (!contraCode) {
            asientoWarning = "No se pudo generar asiento: falta Caja/Bancos/Proveedores.";
          } else {
            const lines = [];

            if (isEntrada(tipo)) {
              lines.push({ accountCodigo: invCode, debit: Math.abs(costoTotal), credit: 0, memo: "Entrada inventario" });
              lines.push({
                accountCodigo: contraCode,
                debit: 0,
                credit: Math.abs(costoTotal),
                memo: usarProveedores ? "Compra a crédito (proveedores)" : "Pago compra inventario",
              });
            } else if (isSalida(tipo)) {
              lines.push({ accountCodigo: invCode, debit: 0, credit: Math.abs(costoTotal), memo: "Salida inventario" });
              lines.push({
                accountCodigo: contraCode,
                debit: Math.abs(costoTotal),
                credit: 0,
                memo: "Salida por venta (costo)",
              });
            }

            if (lines.length >= 2) {
              const je = await JournalEntry.create({
                owner,
                fecha,
                descripcion: descripcion || `Movimiento inventario (${tipo})`,
                lines,
                referencia: referencia || "",
                source: "inventario",
                source_id: String(created._id),
              });

              asientoId = String(je._id);

              created.asientoId = asientoId;
              created.asiento_id = asientoId;
              created.journalEntryId = asientoId;
              created.journal_entry_id = asientoId;

              await created.save();
            }
          }
        }
      } catch (e) {
        console.error("Asiento inventario error (no rompe movimiento):", e);
        asientoWarning = e?.message || "Error generando asiento contable";
      }
    }

    // ✅ Re-fetch con populate para response consistente
    const fresh = await InventoryMovement.findOne({ _id: created._id, owner })
      .populate(
        "productId",
        "nombre name imagen_url imagenUrl image sku codigo code costoCompra costo_compra precio price"
      )
      .lean();

    return res.status(201).json({
      ok: true,
      data: mapMovementForUI(fresh || created),
      asientoId: asientoId || null,
      warning: asientoWarning || null,
    });
  } catch (err) {
    console.error("POST /api/movimientos-inventario error:", err);

    if (err?.name === "ValidationError") {
      return res.status(400).json({ ok: false, message: err.message, details: err.errors || null });
    }
    if (err?.name === "CastError") {
      return res.status(400).json({ ok: false, message: `CastError: ${err.message}` });
    }

    return res.status(500).json({ ok: false, message: err?.message || "Error creando movimiento de inventario" });
  }
});

// --------------------
// DELETE /api/movimientos-inventario/:id
// --------------------
router.delete("/:id", ensureAuth, async (req, res) => {
  try {
    if (!InventoryMovement) {
      return res.status(500).json({
        ok: false,
        message: "No se encontró el modelo InventoryMovement. Verifica backend/models/InventoryMovement.js",
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
