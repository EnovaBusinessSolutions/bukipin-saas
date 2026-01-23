// backend/routes/movimientosInventario.js
const express = require("express");
const router = express.Router();

const mongoose = require("mongoose");
const ensureAuth = require("../middleware/ensureAuth");

// Modelos
let InventoryMovement = null;
let JournalEntry = null;
let Account = null;
let Product = null;
let Counter = null;

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

try {
  Counter = require("../models/Counter");
} catch (_) {
  Counter = null;
}

// --------------------
// Helpers
// --------------------
function num(v, def = 0) {
  if (v === null || v === undefined) return def;
  if (typeof v === "number") return Number.isFinite(v) ? v : def;
  const s = String(v).trim();
  if (!s) return def;
  const cleaned = s.replace(/[$,\s]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : def;
}

function numOrNaN(v) {
  if (v === null || v === undefined) return NaN;
  if (typeof v === "number") return Number.isFinite(v) ? v : NaN;
  const s = String(v).trim();
  if (!s) return NaN;
  const cleaned = s.replace(/[$,\s]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : NaN;
}

function isValidObjectId(str) {
  return mongoose.Types.ObjectId.isValid(String(str || ""));
}

function toObjectId(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (!isValidObjectId(s)) return null;
  return new mongoose.Types.ObjectId(s);
}

function toYMD(d) {
  if (!d) return null;
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return null;
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const day = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
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
  const q = {
    owner,
    $or: [
      { name: { $regex: nameRegex, $options: "i" } },
      { nombre: { $regex: nameRegex, $options: "i" } },
    ],
  };
  if (type) q.type = type;
  return await Account.findOne(q).lean();
}

async function resolveInventoryAccounts(owner) {
  const inv =
    (await findAccountByCode(owner, "1005")) ||
    (await findAccountByName(owner, "inventario de mercanc", "activo")) ||
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

  const costoVentasInv =
    (await findAccountByCode(owner, "5002")) ||
    (await findAccountByName(owner, "costo de ventas invent", "gasto")) ||
    (await findAccountByName(owner, "costo de ventas", "gasto")) ||
    (await findAccountByName(owner, "costo de ventas", null));

  return { inv, caja, bancos, proveedores, costoVentasInv };
}

// --------------------
// Pagos (solo para compras/entradas)
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
  const t = String(tipoPago || "").toLowerCase();
  return (
    t.includes("credito") ||
    t.includes("crédito") ||
    t.includes("pendiente") ||
    t.includes("por_pagar") ||
    t.includes("por pagar")
  );
}

function pickAsientoIdFromBody(body) {
  const raw =
    body?.asientoId ??
    body?.asiento_id ??
    body?.journalEntryId ??
    body?.journal_entry_id ??
    body?.idAsiento ??
    null;
  if (!raw) return null;
  return String(raw).trim();
}

function pickNumeroAsientoFromBody(body) {
  const raw = body?.numeroAsiento ?? body?.numero_asiento ?? body?.folioAsiento ?? null;
  if (!raw) return null;
  const s = String(raw).trim();
  return s || null;
}

// --------------------
// ✅ JournalEntry helpers
// --------------------
async function accountByCode(owner, code) {
  if (!Account || !code) return null;
  const c = String(code).trim();
  return await Account.findOne({
    owner,
    $or: [{ code: c }, { codigo: c }, { cuentaCodigo: c }, { accountCode: c }],
  })
    .select("_id code name nombre")
    .lean();
}

async function buildLine(owner, { code, debit = 0, credit = 0, memo = "" }) {
  const c = String(code || "").trim();
  if (!c) {
    const err = new Error("buildLine: code inválido.");
    err.statusCode = 400;
    throw err;
  }

  const acc = await accountByCode(owner, c);

  return {
    accountCodigo: c,
    accountCode: c,
    cuentaCodigo: c,
    cuenta_codigo: c,
    ...(acc?._id ? { accountId: acc._id } : {}),
    debit: num(debit, 0),
    credit: num(credit, 0),
    memo: memo || "",
  };
}

async function nextJournalNumber(owner, dateObj) {
  if (!Counter) return null;
  const year = new Date(dateObj).getFullYear();
  const key = `journal-${year}`;

  const doc = await Counter.findOneAndUpdate(
    { owner, key },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  ).lean();

  const seq = doc?.seq || 1;
  return `${year}-${String(seq).padStart(4, "0")}`;
}

/**
 * ✅ NUEVO: resolver nombres por code y por id (para asiento completo)
 */
async function getAccountMaps(owner, rawLines) {
  const byCode = {};
  const byId = {};
  const lines = Array.isArray(rawLines) ? rawLines : [];
  const codes = [];
  const ids = [];

  for (const l of lines) {
    const code =
      l?.accountCodigo ??
      l?.accountCode ??
      l?.cuentaCodigo ??
      l?.cuenta_codigo ??
      l?.code ??
      l?.cuenta?.code ??
      l?.cuenta?.codigo ??
      l?.account?.code ??
      l?.account?.codigo ??
      null;

    if (code) codes.push(String(code).trim());

    const idCandidate =
      l?.accountId ??
      l?.account_id ??
      l?.accountID ??
      l?.cuentaId ??
      l?.cuenta_id ??
      l?.account?._id ??
      l?.cuenta?._id ??
      null;

    if (idCandidate) {
      const sid = String(idCandidate).trim();
      if (mongoose.Types.ObjectId.isValid(sid)) ids.push(new mongoose.Types.ObjectId(sid));
    }
  }

  const uniqueCodes = Array.from(new Set(codes.filter(Boolean)));
  const uniqueIds = Array.from(new Set(ids.map((x) => String(x)))).map((x) => new mongoose.Types.ObjectId(x));

  if (!uniqueCodes.length && !uniqueIds.length) return { byCode, byId };

  const or = [];
  if (uniqueCodes.length) or.push({ code: { $in: uniqueCodes } });
  if (uniqueIds.length) or.push({ _id: { $in: uniqueIds } });

  const rows = await Account.find({ owner, $or: or }).select("_id code name nombre").lean();

  for (const r of rows) {
    const code = String(r.code || "").trim();
    const name = r.name ?? r.nombre ?? "";
    if (code) byCode[code] = name;

    const id = String(r._id || "").trim();
    if (id) byId[id] = { code: code || null, name: name || null };
  }

  return { byCode, byId };
}

function mapJournalForUI(entry, accountMaps = { byCode: {}, byId: {} }) {
  if (!entry) return null;

  const byCode = accountMaps.byCode || {};
  const byId = accountMaps.byId || {};

  const numeroAsiento = entry.numeroAsiento ?? entry.numero_asiento ?? entry.numero ?? null;
  const fechaReal = entry.date ?? entry.fecha ?? entry.createdAt ?? entry.created_at ?? null;

  const concepto =
    entry.concept ??
    entry.concepto ??
    entry.descripcion ??
    entry.memo ??
    entry.detalle ??
    "";

  const rawLines = entry.lines || entry.detalle_asientos || entry.detalles_asiento || [];

  const detalle_asientos = (rawLines || []).map((l) => {
    let cuenta_codigo =
      l?.accountCodigo ??
      l?.accountCode ??
      l?.cuentaCodigo ??
      l?.cuenta_codigo ??
      l?.code ??
      l?.cuenta?.code ??
      l?.cuenta?.codigo ??
      l?.account?.code ??
      l?.account?.codigo ??
      "";

    cuenta_codigo = cuenta_codigo ? String(cuenta_codigo).trim() : "";

    const idCandidate =
      l?.accountId ??
      l?.account_id ??
      l?.accountID ??
      l?.cuentaId ??
      l?.cuenta_id ??
      l?.account?._id ??
      l?.cuenta?._id ??
      null;

    const sid = idCandidate ? String(idCandidate).trim() : "";

    if (!cuenta_codigo && sid && byId[sid]?.code) {
      cuenta_codigo = String(byId[sid].code || "").trim();
    }

    const nameFromLine =
      l?.cuenta_nombre ??
      l?.cuentaNombre ??
      l?.accountName ??
      l?.account_name ??
      l?.cuenta?.name ??
      l?.cuenta?.nombre ??
      l?.account?.name ??
      l?.account?.nombre ??
      null;

    const cuenta_nombre =
      nameFromLine != null && String(nameFromLine).trim()
        ? String(nameFromLine).trim()
        : cuenta_codigo
        ? byCode[cuenta_codigo] || (sid && byId[sid]?.name ? byId[sid].name : null)
        : sid && byId[sid]?.name
        ? byId[sid].name
        : null;

    const side = String(l?.side || "").toLowerCase().trim();

    const monto =
      num(l?.monto, 0) ||
      num(l?.amount, 0) ||
      num(l?.importe, 0) ||
      num(l?.valor, 0) ||
      0;

    const debe = num(l?.debit, 0) || num(l?.debe, 0) || (side === "debit" ? monto : 0);
    const haber = num(l?.credit, 0) || num(l?.haber, 0) || (side === "credit" ? monto : 0);

    const memo = l?.memo ?? l?.descripcion ?? l?.concepto ?? l?.description ?? "";

    return {
      cuenta_codigo: cuenta_codigo || null,
      cuenta_nombre: cuenta_nombre || null,
      debe,
      haber,
      descripcion: memo || "",
      memo: memo || "",
    };
  });

  return {
    id: String(entry._id),
    _id: entry._id,
    numeroAsiento: numeroAsiento || null,
    numero_asiento: numeroAsiento || null,
    fecha: fechaReal,
    asiento_fecha: fechaReal ? toYMD(fechaReal) : null,
    descripcion: concepto || "",
    concepto: concepto || "",
    detalle_asientos,
    detalles: detalle_asientos.map((d) => ({
      cuenta_codigo: d.cuenta_codigo,
      cuenta_nombre: d.cuenta_nombre,
      descripcion: d.descripcion || "",
      debe: d.debe,
      haber: d.haber,
    })),
    source: entry.source ?? entry.fuente ?? "",
    sourceId: entry.sourceId ?? entry.source_id ?? null,
  };
}

// --------------------
// Mapper UI (NO rompe front)
// --------------------
function mapMovementForUI(m) {
  const fecha = m.fecha || m.date || m.createdAt || m.created_at || m.updatedAt;

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
  const numeroAsiento = m.numeroAsiento || m.numero_asiento || null;

  return {
    id: String(m._id),
    _id: m._id,

    fecha,
    tipo_movimiento: tipo,
    tipo,
    estado,

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

    numeroAsiento: numeroAsiento || null,
    numero_asiento: numeroAsiento || null,

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

    const productoId = String(req.query.productoId || req.query.producto_id || req.query.productId || "").trim();

    const limit = Math.min(5000, Number(req.query.limit || 500));
    const sort = parseOrder(req.query.order);

    const includeAsiento = String(req.query.include_asiento || req.query.includeAsiento || "0").trim() === "1";

    const and = [{ owner }];

    if (estadoRaw && estadoRaw !== "todos") {
      if (estadoRaw === "activo") {
        and.push({
          $or: [
            { status: "activo" },
            { status: { $exists: false } },
            { status: null },
            { estado: "activo" },
            { estado: { $exists: false } },
            { estado: null },
          ],
        });
      } else {
        and.push({ $or: [{ status: estadoRaw }, { estado: estadoRaw }] });
      }
    }

    if (tipoRaw && tipoRaw !== "todos") {
      and.push({
        $or: [{ tipo: tipoRaw }, { type: tipoRaw }, { tipo_movimiento: tipoRaw }, { tipoMovimiento: tipoRaw }],
      });
    }

    if (start && end)
      and.push({ $or: [{ fecha: { $gte: start, $lte: end } }, { date: { $gte: start, $lte: end } }] });
    else if (start && !end) and.push({ $or: [{ fecha: { $gte: start } }, { date: { $gte: start } }] });
    else if (!start && end) and.push({ $or: [{ fecha: { $lte: end } }, { date: { $lte: end } }] });

    if (productoId) {
      const oid = toObjectId(productoId);
      if (oid) {
        and.push({
          $or: [{ productId: oid }, { productoId: oid }, { producto_id: oid }],
        });
      } else {
        and.push({ $or: [{ productId: productoId }, { productoId: productoId }, { producto_id: productoId }] });
      }
    }

    const filter = and.length > 1 ? { $and: and } : and[0];

    const rows = await InventoryMovement.find(filter)
      .sort(sort)
      .limit(limit)
      .setOptions({ strictPopulate: false })
      .populate("productId", "nombre name imagen_url imagenUrl image sku codigo code costoCompra costo_compra precio price")
      .lean();

    let items = (rows || []).map(mapMovementForUI);

    // ✅ OPCIONAL: enriquecer con numero/concepto del asiento (para que UI no muestre ObjectId)
    if (includeAsiento && JournalEntry) {
      const ids = [];
      for (const it of items) {
        const aid = it.asientoId || it.asiento_id || it.journalEntryId;
        if (aid && isValidObjectId(aid)) ids.push(new mongoose.Types.ObjectId(aid));
      }
      const uniqueIds = Array.from(new Set(ids.map((x) => String(x)))).map((x) => new mongoose.Types.ObjectId(x));

      if (uniqueIds.length) {
        const jes = await JournalEntry.find({ owner, _id: { $in: uniqueIds } })
          .select("_id numeroAsiento numero_asiento numero concept concepto descripcion memo date fecha createdAt lines detalle_asientos detalles_asiento")
          .lean();

        const mapById = {};
        for (const je of jes) mapById[String(je._id)] = je;

        // Para resolver nombres de cuentas en resumen si lo quisieras después
        // (aquí solo ponemos numero y concepto)
        items = items.map((it) => {
          const aid = it.asientoId || it.asiento_id || it.journalEntryId || null;
          const je = aid ? mapById[String(aid)] : null;
          if (!je) return it;

          const numero =
            je.numeroAsiento ?? je.numero_asiento ?? je.numero ?? it.numeroAsiento ?? it.numero_asiento ?? null;

          const concepto =
            je.concept ?? je.concepto ?? je.descripcion ?? je.memo ?? "";

          return {
            ...it,
            asiento_numero: numero || null,
            asiento_concepto: concepto || null,
          };
        });
      }
    }

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
// ✅ NUEVO: GET /api/movimientos-inventario/:id?include_asiento=1
// Devuelve movimiento + asiento completo (como Bukipin prototipo CAP 2)
// --------------------
router.get("/:id", ensureAuth, async (req, res) => {
  try {
    if (!InventoryMovement) {
      return res.status(500).json({
        ok: false,
        message: "No se encontró el modelo InventoryMovement. Verifica backend/models/InventoryMovement.js",
      });
    }

    const owner = req.user._id;
    const id = String(req.params.id || "").trim();

    if (!isValidObjectId(id)) {
      return res.status(400).json({ ok: false, message: "id inválido" });
    }

    const includeAsiento = String(req.query.include_asiento || req.query.includeAsiento || "1").trim() !== "0";

    const mov = await InventoryMovement.findOne({ _id: new mongoose.Types.ObjectId(id), owner })
      .setOptions({ strictPopulate: false })
      .populate("productId", "nombre name imagen_url imagenUrl image sku codigo code costoCompra costo_compra precio price")
      .lean();

    if (!mov) return res.status(404).json({ ok: false, message: "Movimiento no encontrado." });

    const movimiento = mapMovementForUI(mov);

    let asiento = null;

    if (includeAsiento && JournalEntry) {
      const asientoId =
        mov.asientoId || mov.asiento_id || mov.journalEntryId || mov.journal_entry_id || null;

      // 1) Si tengo asientoId, lo cargo directo
      if (asientoId && isValidObjectId(asientoId)) {
        const je = await JournalEntry.findOne({ _id: new mongoose.Types.ObjectId(asientoId), owner }).lean();
        if (je) {
          const rawLines = je.lines || je.detalle_asientos || je.detalles_asiento || [];
          const accountMaps = await getAccountMaps(owner, rawLines);
          asiento = mapJournalForUI(je, accountMaps);
        }
      }

      // 2) Si NO tengo asientoId, intento buscar por source=inventario + sourceId=movimiento
      if (!asiento) {
        const je =
          (await JournalEntry.findOne({ owner, source: "inventario", sourceId: mov._id }).sort({ createdAt: -1 }).lean()) ||
          null;

        if (je) {
          const rawLines = je.lines || je.detalle_asientos || je.detalles_asiento || [];
          const accountMaps = await getAccountMaps(owner, rawLines);
          asiento = mapJournalForUI(je, accountMaps);
        }
      }

      // 3) Si el movimiento trae numeroAsiento pero el asiento viene sin numero, lo relleno
      if (asiento && !asiento.numeroAsiento && (mov.numeroAsiento || mov.numero_asiento)) {
        asiento.numeroAsiento = mov.numeroAsiento || mov.numero_asiento;
        asiento.numero_asiento = mov.numeroAsiento || mov.numero_asiento;
      }
    }

    return res.json({
      ok: true,
      data: { movimiento, asiento },
      movimiento,
      asiento,
    });
  } catch (err) {
    console.error("GET /api/movimientos-inventario/:id error:", err);
    return res.status(500).json({ ok: false, message: "Error leyendo movimiento" });
  }
});

// --------------------
// POST /api/movimientos-inventario
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
    const estado = String(req.body?.estado ?? req.body?.status ?? "activo").trim().toLowerCase();

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
      req.body?.costoTotal ??
      req.body?.costo_total ??
      req.body?.total ??
      req.body?.monto_total ??
      null;

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

    // ✅ 1) fallback costo del producto
    if ((!Number.isFinite(costoUnitario) || costoUnitario <= 0) && Product) {
      const prod = await Product.findOne({ _id: new mongoose.Types.ObjectId(productoId), owner })
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

    const qtyCanon = Math.abs(cantidad);

    const asientoIdExterno = pickAsientoIdFromBody(req.body) || null;
    const numeroAsientoExterno = pickNumeroAsientoFromBody(req.body) || null;

    const prodOid = new mongoose.Types.ObjectId(productoId);

    const payload = {
      owner,
      fecha,
      date: fecha,

      tipo,
      status: estado,
      estado: estado,

      productId: prodOid,
      qty: qtyCanon,
      unitCost: costoUnitario,
      total: costoTotal,

      nota: descripcion || "",
      source: req.body?.source ? String(req.body.source) : "ui",
      sourceId: req.body?.sourceId ? String(req.body.sourceId) : null,

      // compat
      type: tipo,
      tipo_movimiento: tipo,
      tipoMovimiento: tipo,

      productoId: prodOid,
      producto_id: prodOid,

      cantidad: qtyCanon,
      costoUnitario,
      costo_unitario: costoUnitario,

      costoTotal,
      costo_total: costoTotal,

      descripcion,
      referencia,

      // si viene asiento externo (ventas)
      asientoId: asientoIdExterno || undefined,
      asiento_id: asientoIdExterno || undefined,
      journalEntryId: asientoIdExterno || undefined,
      journal_entry_id: asientoIdExterno || undefined,

      numeroAsiento: numeroAsientoExterno || undefined,
      numero_asiento: numeroAsientoExterno || undefined,
    };

    const created = await InventoryMovement.create(payload);

    // --------------------
    // ✅ Asiento contable
    // --------------------
    let asientoId = asientoIdExterno || null;
    let numeroAsiento = numeroAsientoExterno || null;
    let asientoWarning = null;

    const debeGenerarAsiento = !asientoIdExterno && (isEntrada(tipo) || isSalida(tipo)) && costoTotal > 0;

    if (debeGenerarAsiento && JournalEntry && Account) {
      try {
        const { inv, caja, bancos, proveedores, costoVentasInv } = await resolveInventoryAccounts(owner);

        const invCode = accCode(inv); // 1005
        const cajaCode = accCode(caja); // 1001
        const bancosCode = accCode(bancos); // 1002
        const provCode = accCode(proveedores); // 2001
        const cogsCode = accCode(costoVentasInv); // 5002

        if (!invCode) {
          asientoWarning = "No se pudo generar asiento: falta cuenta 1005 Inventario de Mercancías.";
        } else {
          const lines = [];

          // ENTRADA
          if (isEntrada(tipo)) {
            const metodoPago = parseMetodoPago(req.body);
            const tipoPago = parseTipoPago(req.body);

            const usarProveedores = isCredito(tipoPago);
            const usarBancos =
              metodoPago.includes("banco") ||
              metodoPago.includes("transfer") ||
              metodoPago.includes("tarjeta") ||
              metodoPago.includes("tdd") ||
              metodoPago.includes("tdc");

            const contraCode = usarProveedores ? provCode : usarBancos ? bancosCode : cajaCode;

            if (!contraCode) {
              asientoWarning = "No se pudo generar asiento de compra: falta Caja/Bancos/Proveedores.";
            } else {
              lines.push(
                await buildLine(owner, {
                  code: invCode,
                  debit: Math.abs(costoTotal),
                  credit: 0,
                  memo: "Compra / Entrada a inventario",
                })
              );

              lines.push(
                await buildLine(owner, {
                  code: contraCode,
                  debit: 0,
                  credit: Math.abs(costoTotal),
                  memo: usarProveedores ? "Compra a crédito (Proveedores)" : "Pago compra inventario",
                })
              );
            }
          }

          // SALIDA
          if (isSalida(tipo)) {
            if (!cogsCode) {
              asientoWarning = "No se pudo generar asiento de salida: falta cuenta 5002 Costo de Ventas Inventario.";
            } else {
              lines.push(
                await buildLine(owner, {
                  code: cogsCode,
                  debit: Math.abs(costoTotal),
                  credit: 0,
                  memo: "Salida inventario (Costo)",
                })
              );

              lines.push(
                await buildLine(owner, {
                  code: invCode,
                  debit: 0,
                  credit: Math.abs(costoTotal),
                  memo: "Salida inventario (Reduce stock)",
                })
              );
            }
          }

          if (lines.length >= 2) {
            numeroAsiento = (await nextJournalNumber(owner, fecha)) || null;

            const je = await JournalEntry.create({
              owner,
              date: fecha,
              concept: descripcion || `Movimiento inventario (${tipo})`,
              referencia: referencia || "",
              source: "inventario",
              sourceId: created._id,
              lines,
              ...(numeroAsiento ? { numeroAsiento } : {}),
            });

            asientoId = String(je._id);

            created.asientoId = asientoId;
            created.asiento_id = asientoId;
            created.journalEntryId = asientoId;
            created.journal_entry_id = asientoId;

            if (numeroAsiento) {
              created.numeroAsiento = numeroAsiento;
              created.numero_asiento = numeroAsiento;
            }

            await created.save();
          }
        }
      } catch (e) {
        console.error("Asiento inventario error (no rompe movimiento):", e);
        asientoWarning = e?.message || "Error generando asiento contable";
      }
    }

    const fresh = await InventoryMovement.findOne({ _id: created._id, owner })
      .populate("productId", "nombre name imagen_url imagenUrl image sku codigo code costoCompra costo_compra precio price")
      .lean();

    return res.status(201).json({
      ok: true,
      data: mapMovementForUI(fresh || created),
      asientoId: asientoId || null,
      numeroAsiento: numeroAsiento || null,
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
// Soft cancel + reversa si el asiento fue creado por inventario
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

    const hard = String(req.query.hard || "").trim() === "1";

    const found = await InventoryMovement.findOne({ _id: id, owner });
    if (!found) return res.status(404).json({ ok: false, message: "Movimiento no encontrado." });

    if (hard) {
      await InventoryMovement.deleteOne({ _id: id, owner });
      return res.json({ ok: true, hard: true });
    }

    found.status = "cancelado";
    found.estado = "cancelado";

    let reversalId = null;
    let warning = null;

    const asientoId =
      found.asientoId || found.asiento_id || found.journalEntryId || found.journal_entry_id || null;

    if (asientoId && JournalEntry) {
      try {
        const je = await JournalEntry.findOne({ _id: asientoId, owner }).lean();

        const isFromThisModule =
          je &&
          String(je.source || "") === "inventario" &&
          String(je.sourceId || "") === String(found._id);

        if (isFromThisModule) {
          const originalLines = Array.isArray(je.lines) ? je.lines : [];

          const reversedLines = originalLines.map((ln) => {
            const code =
              (ln.accountCodigo ?? ln.accountCode ?? ln.cuentaCodigo ?? ln.cuenta_codigo ?? "").toString().trim();

            return {
              ...(code ? { accountCodigo: code, accountCode: code, cuentaCodigo: code, cuenta_codigo: code } : {}),
              ...(ln.accountId ? { accountId: ln.accountId } : {}),
              debit: num(ln.credit, 0),
              credit: num(ln.debit, 0),
              memo: `Reversa: ${ln.memo || "Movimiento inventario"}`,
            };
          });

          const numeroAsiento = (await nextJournalNumber(owner, new Date())) || null;

          const rev = await JournalEntry.create({
            owner,
            date: new Date(),
            concept: `REVERSA - ${je.concept ?? je.concepto ?? je.descripcion ?? "Asiento inventario"}`,
            referencia: `REV-${je.referencia || ""}`.trim(),
            source: "inventario_reversal",
            sourceId: found._id,
            lines: reversedLines,
            reversal_of: String(je._id),
            ...(numeroAsiento ? { numeroAsiento } : {}),
          });

          reversalId = String(rev._id);
        }
      } catch (e) {
        console.error("Cancelar movimiento inventario: error reversando asiento:", e);
        warning = e?.message || "Error creando reversa contable";
      }
    }

    await found.save();

    return res.json({
      ok: true,
      canceled: true,
      reversalId: reversalId || null,
      warning: warning || null,
    });
  } catch (err) {
    console.error("DELETE /api/movimientos-inventario/:id error:", err);
    return res.status(500).json({ ok: false, message: "Error cancelando movimiento" });
  }
});

module.exports = router;
