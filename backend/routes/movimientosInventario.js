// backend/routes/movimientosInventario.js
const express = require("express");
const router = express.Router();

const ensureAuth = require("../middleware/ensureAuth");

// Modelos
let InventoryMovement = null;
let JournalEntry = null;
let Account = null;

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

function pickProductoId(m) {
  return String(
    m?.producto_id ??
      m?.productoId ??
      m?.productId ??
      (typeof m?.producto === "string" ? m.producto : "") ??
      (typeof m?.product === "string" ? m.product : "") ??
      ""
  ).trim();
}

function pickTipo(m) {
  return String(m?.tipo_movimiento ?? m?.tipoMovimiento ?? m?.tipo ?? m?.type ?? "")
    .toLowerCase()
    .trim();
}

function pickEstado(m) {
  return String(m?.estado ?? m?.status ?? "activo").toLowerCase().trim();
}

function asId(v) {
  if (!v) return "";
  if (typeof v === "object" && (v._id || v.id)) return String(v._id || v.id);
  return String(v);
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
  return await Account.findOne({ owner, code: String(code) }).lean();
}

async function findAccountByName(owner, nameRegex, type) {
  if (!Account) return null;
  const q = { owner, name: { $regex: nameRegex, $options: "i" } };
  if (type) q.type = type;
  return await Account.findOne(q).lean();
}

/**
 * Resuelve cuentas con fallback:
 * - Inventario: intenta 1201, si no existe busca por nombre "Inventario"
 * - Proveedores/CxP: intenta 2001, si no existe busca "Proveedores" / "Cuentas por pagar"
 * - Caja: 1001, Bancos: 1002
 */
async function resolveInventoryAccounts(owner) {
  const inv =
    (await findAccountByCode(owner, "1201")) ||
    (await findAccountByName(owner, "inventario", "activo")) ||
    (await findAccountByName(owner, "inventario", null));

  const caja = (await findAccountByCode(owner, "1001")) || (await findAccountByName(owner, "caja", "activo"));
  const bancos = (await findAccountByCode(owner, "1002")) || (await findAccountByName(owner, "banco", "activo"));

  const proveedores =
    (await findAccountByCode(owner, "2001")) ||
    (await findAccountByName(owner, "proveedor", "pasivo")) ||
    (await findAccountByName(owner, "cuentas por pagar", "pasivo")) ||
    (await findAccountByName(owner, "por pagar", "pasivo"));

  return { inv, caja, bancos, proveedores };
}

/**
 * Determina cuenta de salida (crédito) para compras / y cuenta de entrada (débito) para ventas
 * - método: efectivo | bancos | transferencia | tarjeta => bancos
 * - crédito/pendiente => proveedores (2001)
 */
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
  // Ej: "pago total" | "credito" | "pago parcial" | "pendiente"
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

function isParcial(tipoPago) {
  return tipoPago.includes("parcial");
}

// --------------------
// Mapper UI
// --------------------
function mapMovementForUI(m) {
  const fecha = m.fecha || m.date || m.createdAt || m.created_at || m.updatedAt;

  const cantidad = num(m.cantidad ?? m.qty ?? m.quantity ?? m.unidades ?? m.units, 0);

  let costoUnitario = num(
    m.costo_unitario ?? m.costoUnitario ?? m.unitCost ?? m.costo_unit ?? m.precio_unitario ?? m.unitPrice ?? 0,
    0
  );

  let costoTotal = num(m.costo_total ?? m.costoTotal ?? m.total ?? m.monto_total ?? m.montoTotal ?? 0, 0);

  // ✅ derivación robusta
  if (!costoTotal && costoUnitario && cantidad) costoTotal = costoUnitario * cantidad;
  if (!costoUnitario && costoTotal && cantidad) costoUnitario = costoTotal / cantidad;

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

  const prodImg =
    prodObj && typeof prodObj === "object"
      ? prodObj.imagen_url ?? prodObj.imagenUrl ?? prodObj.image ?? null
      : null;

  const tipo = pickTipo(m) || "ajuste";
  const estado = pickEstado(m) || "activo";

  const asientoId = m.asientoId || m.asiento_id || m.journalEntryId || m.journal_entry_id || null;

  return {
    id: String(m._id),
    _id: m._id,

    fecha,
    tipo_movimiento: tipo,
    tipo, // compat
    estado,

    producto_id: prodId,
    productoId: prodId, // compat

    // ✅ Para que tu frontend NO muestre “Producto eliminado”
    productos: {
      nombre: prodNombre || "Producto",
      imagen_url: prodImg || undefined,
    },
    producto: prodId
      ? {
          id: prodId,
          nombre: prodNombre || "Producto",
          imagen_url: prodImg || undefined,
        }
      : null,

    cantidad,
    costo_unitario: costoUnitario,
    costoUnitario: costoUnitario,
    costo_total: costoTotal,
    costoTotal: costoTotal,

    descripcion: m.descripcion ?? m.memo ?? m.concepto ?? "",
    referencia: m.referencia ?? m.ref ?? "",

    // ✅ vínculo contable E2E
    asientoId: asientoId ? String(asientoId) : null,
    asiento_id: asientoId ? String(asientoId) : null,
    journalEntryId: asientoId ? String(asientoId) : null,

    created_at: m.createdAt,
    updated_at: m.updatedAt,
  };
}

// --------------------
// GET /api/movimientos-inventario
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

    const productoId = String(req.query.productoId || req.query.producto_id || "").trim();

    const limit = Math.min(5000, Number(req.query.limit || 500));
    const sort = parseOrder(req.query.order);

    const and = [{ owner }];

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

    if (tipoRaw && tipoRaw !== "todos") {
      and.push({
        $or: [{ tipo: tipoRaw }, { type: tipoRaw }, { tipo_movimiento: tipoRaw }, { tipoMovimiento: tipoRaw }],
      });
    }

    if (start && end) and.push({ fecha: { $gte: start, $lte: end } });
    else if (start && !end) and.push({ fecha: { $gte: start } });
    else if (!start && end) and.push({ fecha: { $lte: end } });

    if (productoId) {
      and.push({
        $or: [{ productoId }, { producto_id: productoId }, { productId: productoId }, { producto: productoId }, { product: productoId }],
      });
    }

    const filter = and.length > 1 ? { $and: and } : and[0];

    // populate robusto (sin romper)
    let q = InventoryMovement.find(filter).sort(sort).limit(limit).setOptions({ strictPopulate: false });

    // Intentamos varios paths comunes
    const paths = ["productoId", "producto_id", "productId", "producto", "product"];
    for (const p of paths) {
      try {
        if (InventoryMovement.schema?.path(p)) {
          q = q.populate(p, "nombre name imagen_url imagenUrl image sku codigo code");
          break;
        }
      } catch (_) {}
    }

    const rows = await q.lean();
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
// ✅ crea movimiento + (si aplica) JournalEntry y lo amarra
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

    const productoId = req.body?.productoId ?? req.body?.producto_id ?? req.body?.productId ?? null;

    const cantidad = num(req.body?.cantidad ?? req.body?.qty ?? req.body?.quantity ?? req.body?.unidades ?? 0, NaN);

    // Acepta varios nombres
    const costoUnitarioIn = num(
      req.body?.costoUnitario ??
        req.body?.costo_unitario ??
        req.body?.unitCost ??
        req.body?.precio_unitario ??
        req.body?.precioUnitario ??
        0,
      0
    );

    const costoTotalIn = num(req.body?.costoTotal ?? req.body?.costo_total ?? req.body?.total ?? req.body?.monto_total ?? 0, 0);

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

    // ✅ costos E2E
    let costoUnitario = costoUnitarioIn;
    let costoTotal = costoTotalIn;

    if (!costoTotal && costoUnitario && cantidad) costoTotal = costoUnitario * cantidad;
    if (!costoUnitario && costoTotal && cantidad) costoUnitario = costoTotal / cantidad;

    // --------------------
    // Crear movimiento base
    // --------------------
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

      costo_total: costoTotal,
      costoTotal: costoTotal,

      descripcion,
      referencia,
    };

    // Creamos primero (y luego attach asiento si aplica)
    const created = await InventoryMovement.create(payload);

    // --------------------
    // ✅ Contabilidad automática (E2E)
    // Solo si hay JournalEntry + Account + costo > 0
    // --------------------
    let asientoId = null;

    const debeGenerarAsiento = (isEntrada(tipo) || isSalida(tipo)) && costoTotal > 0;

    if (debeGenerarAsiento && JournalEntry && Account) {
      const { inv, caja, bancos, proveedores } = await resolveInventoryAccounts(owner);

      // Si no tenemos cuenta de Inventario, mejor no romper: guardamos movimiento sin asiento
      if (inv) {
        const metodoPago = parseMetodoPago(req.body);
        const tipoPago = parseTipoPago(req.body);

        // Determinar cuenta contrapartida
        // - compras: crédito a caja/bancos o proveedores
        // - ventas: débito a caja/bancos (o CxC si fuera crédito, pero eso ya lo manejas en ingresos)
        const usarProveedores = isEntrada(tipo) && isCredito(tipoPago);
        const usarBancos =
          metodoPago.includes("banco") ||
          metodoPago.includes("transfer") ||
          metodoPago.includes("tarjeta") ||
          metodoPago.includes("tdd") ||
          metodoPago.includes("tdc");

        const cuentaCajaOBancos = usarBancos ? bancos : caja;

        // fallback final: si no hay caja/bancos, no generamos
        if (!usarProveedores && !cuentaCajaOBancos) {
          // skip asiento
        } else if (usarProveedores && !proveedores) {
          // skip asiento
        } else {
          // Construir líneas
          // Compra/Entrada: Debe Inventario, Haber Caja/Bancos o Proveedores
          // Venta/Salida: Haber Inventario, Debe Caja/Bancos (esto es "salida por venta")
          const lines = [];

          if (isEntrada(tipo)) {
            lines.push({
              accountCodigo: inv.code,
              debit: Math.abs(costoTotal),
              credit: 0,
              memo: "Entrada inventario",
            });

            if (usarProveedores) {
              lines.push({
                accountCodigo: proveedores.code,
                debit: 0,
                credit: Math.abs(costoTotal),
                memo: "Compra a crédito (proveedores)",
              });
            } else {
              lines.push({
                accountCodigo: cuentaCajaOBancos.code,
                debit: 0,
                credit: Math.abs(costoTotal),
                memo: "Pago compra inventario",
              });
            }
          } else if (isSalida(tipo)) {
            // Nota: esto representa salida del costo (no el ingreso). Tu ingreso/venta ya se registra en /ingresos.
            lines.push({
              accountCodigo: inv.code,
              debit: 0,
              credit: Math.abs(costoTotal),
              memo: "Salida inventario",
            });

            if (cuentaCajaOBancos) {
              lines.push({
                accountCodigo: cuentaCajaOBancos.code,
                debit: Math.abs(costoTotal),
                credit: 0,
                memo: "Salida por venta (costo)",
              });
            }
          }

          if (lines.length >= 2) {
            const je = await JournalEntry.create({
              owner,
              fecha,
              descripcion: descripcion || `Movimiento inventario (${tipo})`,
              lines,
              // Puedes guardar referencia si tu schema lo soporta
              referencia: referencia || "",
              source: "inventario",
              source_id: String(created._id),
            });

            asientoId = String(je._id);

            // Guardamos en múltiples campos para compat
            created.asientoId = asientoId;
            created.asiento_id = asientoId;
            created.journalEntryId = asientoId;
            created.journal_entry_id = asientoId;

            await created.save();
          }
        }
      }
    }

    // Volvemos a leer con populate si quieres (opcional). Aquí devolvemos lo creado.
    const out = created.toObject ? created.toObject() : created;
    return res.status(201).json({
      ok: true,
      data: mapMovementForUI(out),
      asientoId: asientoId || null,
    });
  } catch (err) {
    console.error("POST /api/movimientos-inventario error:", err);
    return res.status(500).json({ ok: false, message: "Error creando movimiento de inventario" });
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
