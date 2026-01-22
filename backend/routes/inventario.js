// backend/routes/inventario.js
const express = require("express");
const router = express.Router();

const ensureAuth = require("../middleware/ensureAuth");

// Modelos (opcionales)
let InventoryMovement = null;
let JournalEntry = null;
let Account = null;

try {
  InventoryMovement = require("../models/InventoryMovement");
} catch (_) {}

try {
  JournalEntry = require("../models/JournalEntry");
} catch (_) {}

try {
  Account = require("../models/Account");
} catch (_) {}

// --------------------
// Helpers robustos
// --------------------
function num(v, def = 0) {
  if (v === null || v === undefined) return def;
  const s = String(v).trim();
  if (!s) return def;
  const cleaned = s.replace(/[$,\s]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : def;
}

// Fechas seguras para YYYY-MM-DD (sin shift raro UTC)
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

function asId(v) {
  if (!v) return "";
  if (typeof v === "object" && (v._id || v.id)) return String(v._id || v.id);
  return String(v);
}

function getMovementAsientoId(m) {
  return (
    m?.asientoId ||
    m?.asiento_id ||
    m?.journalEntryId ||
    m?.journal_entry_id ||
    m?.asiento ||
    null
  );
}

function parseOrder(orderRaw) {
  const order = String(orderRaw || "fecha:desc").trim();
  const [field, dir] = order.split(":");
  const key = (field || "fecha").trim();
  const direction = String(dir || "desc").toLowerCase() === "asc" ? 1 : -1;
  return { [key]: direction, createdAt: -1 };
}

function normalizeMovement(m) {
  const cantidad = num(m?.qty ?? m?.cantidad ?? m?.quantity ?? m?.unidades ?? m?.units, 0);

  let costoUnit = num(
    m?.unitCost ??
      m?.costo_unitario ??
      m?.costoUnitario ??
      m?.costoUnit ??
      m?.precio_unitario ??
      m?.precioUnitario ??
      m?.unitPrice ??
      0,
    0
  );

  let costoTotal = num(
    m?.total ??
      m?.costo_total ??
      m?.costoTotal ??
      m?.monto_total ??
      m?.montoTotal ??
      m?.importe_total ??
      m?.importeTotal ??
      m?.amount ??
      m?.monto ??
      m?.importe ??
      0,
    0
  );

  // Derivación E2E
  if (!costoTotal && costoUnit && cantidad) costoTotal = costoUnit * cantidad;
  if (!costoUnit && costoTotal && cantidad) costoUnit = costoTotal / cantidad;

  // ✅ El producto real SIEMPRE es productId
  const prodObj = m?.productId && typeof m.productId === "object" ? m.productId : null;

  const prodId =
    prodObj ? asId(prodObj._id || prodObj.id) : asId(m?.productId ?? m?.productoId ?? m?.producto_id ?? "");

  const productos = prodObj
    ? {
        nombre: String(prodObj?.nombre ?? prodObj?.name ?? "Producto"),
        imagen_url: prodObj?.imagen_url ?? prodObj?.imagenUrl ?? prodObj?.image ?? undefined,
      }
    : { nombre: "Producto eliminado" };

  const tipo =
    String(m?.tipo_movimiento ?? m?.tipoMovimiento ?? m?.tipo ?? m?.type ?? "")
      .toLowerCase()
      .trim() || "entrada";

  const estado = String(m?.status ?? m?.estado ?? "activo").toLowerCase().trim();

  const fecha =
    m?.fecha ?? m?.date ?? m?.createdAt ?? m?.created_at ?? m?.updatedAt ?? m?.updated_at ?? null;

  return {
    ...m,
    id: asId(m?.id ?? m?._id),

    // compat front
    producto_id: prodId,
    productoId: prodId,

    tipo_movimiento: tipo,
    tipo,
    estado,

    cantidad,
    costo_unitario: costoUnit,
    costoUnitario: costoUnit,

    costo_total: costoTotal,
    costoTotal: costoTotal,

    fecha,
    descripcion: m?.descripcion ?? m?.nota ?? "",
    referencia: m?.referencia ?? "",

    motivo_cancelacion: m?.motivo_cancelacion ?? null,
    fecha_cancelacion: m?.fecha_cancelacion ?? null,
    movimiento_reversion_id: m?.movimiento_reversion_id ?? null,

    productos,
  };
}

async function mapJournalEntryForUI(entry, owner) {
  if (!entry) return null;

  const lines = Array.isArray(entry.lines) ? entry.lines : Array.isArray(entry.detalles) ? entry.detalles : [];

  const accountCodes = lines
    .map((l) => String(l.accountCodigo ?? l.cuenta_codigo ?? l.accountCode ?? l.codigo ?? "").trim())
    .filter(Boolean);

  let byCode = {};
  if (Account && accountCodes.length) {
    const accs = await Account.find({ owner, code: { $in: accountCodes } })
      .select("code name")
      .lean();
    byCode = Object.fromEntries(accs.map((a) => [String(a.code), a]));
  }

  const detalle_asientos = lines.map((l, idx) => {
    const codigo = String(l.accountCodigo ?? l.cuenta_codigo ?? l.accountCode ?? l.codigo ?? "").trim();
    const debe = num(l.debit ?? l.debe, 0);
    const haber = num(l.credit ?? l.haber, 0);
    const descripcion = String(l.memo ?? l.descripcion ?? "").trim();

    return {
      id: String(l._id ?? idx),
      cuenta_codigo: codigo || "-",
      debe,
      haber,
      descripcion,
      cuentas: { nombre: byCode[codigo]?.name ?? "" },
    };
  });

  return {
    id: asId(entry._id),
    numero_asiento: String(entry.numero_asiento ?? entry.numero ?? entry.folio ?? entry._id),
    descripcion: String(entry.descripcion ?? entry.memo ?? ""),
    fecha: entry.fecha ?? entry.date ?? entry.createdAt ?? null,
    detalle_asientos,
  };
}

// --------------------
// GET movimientos
// --------------------
/**
 * GET /api/inventario/movimientos?tipo=compra&estado=activo&order=fecha:desc&limit=5000&start=YYYY-MM-DD&end=YYYY-MM-DD
 * Soporta también from/to.
 */
router.get("/movimientos", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;

    const tipoRaw = String(req.query.tipo ?? "").trim().toLowerCase();
    const estadoRaw = String(req.query.estado ?? "").trim().toLowerCase();
    const order = parseOrder(req.query.order);
    const limit = Math.min(5000, Number(req.query.limit || 2000));

    const start = parseStartDate(req.query.start || req.query.from);
    const end = parseEndDate(req.query.end || req.query.to);

    const allowedTipos = new Set([
      "compra",
      "venta",
      "ajuste",
      "entrada",
      "salida",
      "ajuste_entrada",
      "ajuste_salida",
    ]);
    const tipoValido = allowedTipos.has(tipoRaw) ? tipoRaw : null;

    if (!InventoryMovement) {
      return res.json({
        ok: true,
        data: {
          items: [],
          meta: {
            tipo: tipoValido || "todos",
            estado: estadoRaw || "todos",
            start: start ? start.toISOString() : null,
            end: end ? end.toISOString() : null,
            note: "InventoryMovement model no existe aún",
          },
        },
      });
    }

    const q = { owner };

    if (tipoValido) q.tipo = tipoValido;

    // ✅ status/estado robusto
    if (estadoRaw && estadoRaw !== "todos") {
      if (estadoRaw === "activo") {
        q.$or = [{ status: "activo" }, { status: { $exists: false } }, { status: null }];
      } else {
        q.status = estadoRaw;
      }
    }

    if (start && end) q.fecha = { $gte: start, $lte: end };
    else if (start && !end) q.fecha = { $gte: start };
    else if (!start && end) q.fecha = { $lte: end };

    // ✅ IMPORTANTE:
    // Solo populate por productId (campo real). NO tocar productoId/producto_id para evitar el 500.
    const itemsRaw = await InventoryMovement.find(q)
      .sort(order)
      .limit(limit)
      .setOptions({ strictPopulate: false })
      .populate({ path: "productId", select: "nombre name imagen_url imagenUrl image", strictPopulate: false })
      .lean();

    const items = (itemsRaw || []).map(normalizeMovement);

    return res.json({
      ok: true,
      data: {
        items,
        meta: {
          tipo: tipoValido || "todos",
          estado: estadoRaw || "todos",
          start: start ? start.toISOString() : null,
          end: end ? end.toISOString() : null,
        },
      },
    });
  } catch (err) {
    console.error("GET /api/inventario/movimientos error:", err);
    return res.status(500).json({ ok: false, message: "Error cargando movimientos" });
  }
});

// --------------------
// GET asiento por movimiento
// (para el modal Detalle)
// --------------------
router.get("/movimientos/:id/asiento", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;
    const movimientoId = String(req.params.id);

    if (!InventoryMovement) return res.json({ ok: true, data: null });

    const mov = await InventoryMovement.findOne({ _id: movimientoId, owner }).lean();
    if (!mov) return res.status(404).json({ ok: false, message: "Movimiento no encontrado" });

    if (!JournalEntry) return res.json({ ok: true, data: null });

    // 1) Intentar por campo directo
    let asientoId = getMovementAsientoId(mov);

    // 2) Fallback fuerte: si no existe, buscar por source/source_id (porque a veces no se guarda asientoId en el schema)
    if (!asientoId) {
      const bySource = await JournalEntry.findOne({
        owner,
        $or: [
          { source: "inventario", source_id: String(mov._id) },
          { source: "inventario", sourceId: String(mov._id) },
          { source_id: String(mov._id) },
          { sourceId: String(mov._id) },
        ],
      }).lean();

      if (bySource?._id) asientoId = String(bySource._id);
    }

    if (!asientoId) return res.json({ ok: true, data: null });

    const entry = await JournalEntry.findOne({ _id: asientoId, owner }).lean();
    if (!entry) return res.json({ ok: true, data: null });

    const mapped = await mapJournalEntryForUI(entry, owner);
    return res.json({ ok: true, data: mapped });
  } catch (err) {
    console.error("GET /api/inventario/movimientos/:id/asiento error:", err);
    return res.json({ ok: true, data: null }); // ✅ no romper UI
  }
});

// --------------------
// POST cancelar compra inventario
// (marca cancelado + genera reversión del asiento si existe)
// --------------------
router.post("/movimientos/:id/cancel", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;
    const movimientoId = String(req.params.id);
    const motivoCancelacion = String(req.body?.motivoCancelacion ?? "").trim();

    if (!motivoCancelacion) {
      return res.status(400).json({ ok: false, message: "motivoCancelacion es requerido" });
    }

    if (!InventoryMovement) {
      return res.status(400).json({ ok: false, message: "InventoryMovement no está disponible" });
    }

    const mov = await InventoryMovement.findOne({ _id: movimientoId, owner });
    if (!mov) return res.status(404).json({ ok: false, message: "Movimiento no encontrado" });

    const yaCancelado =
      String(mov.status || mov.estado || "").toLowerCase() === "cancelado" ||
      !!mov.motivo_cancelacion ||
      !!mov.fecha_cancelacion ||
      !!mov.movimiento_reversion_id;

    if (yaCancelado) {
      return res.json({ ok: true, message: "Movimiento ya estaba cancelado" });
    }

    const tipo = String(mov.tipo_movimiento ?? mov.tipo ?? "").toLowerCase().trim();
    if (tipo !== "compra") {
      return res.status(400).json({ ok: false, message: "Solo se pueden cancelar compras de inventario" });
    }

    // Marcar cancelación
    mov.status = "cancelado";
    mov.estado = "cancelado";
    mov.motivo_cancelacion = motivoCancelacion;
    mov.fecha_cancelacion = new Date();

    // Reversión asiento si existe
    let asientoReversionId = null;

    if (JournalEntry) {
      let asientoId = getMovementAsientoId(mov);

      if (!asientoId) {
        const bySource = await JournalEntry.findOne({
          owner,
          $or: [
            { source: "inventario", source_id: String(mov._id) },
            { source: "inventario", sourceId: String(mov._id) },
            { source_id: String(mov._id) },
            { sourceId: String(mov._id) },
          ],
        });
        if (bySource?._id) asientoId = String(bySource._id);
      }

      if (asientoId) {
        const original = await JournalEntry.findOne({ _id: asientoId, owner });
        if (original && Array.isArray(original.lines) && original.lines.length) {
          const reversedLines = original.lines.map((l) => ({
            accountCodigo: l.accountCodigo ?? l.cuenta_codigo ?? l.accountCode ?? l.codigo,
            debit: num(l.credit ?? l.haber, 0),
            credit: num(l.debit ?? l.debe, 0),
            memo: `Reversión: ${String(l.memo ?? l.descripcion ?? "").trim()}`,
          }));

          const reversed = await JournalEntry.create({
            owner,
            fecha: new Date(),
            descripcion: `Reversión cancelación inventario (${mov._id}) - ${motivoCancelacion}`,
            lines: reversedLines,
            source: "inventario_cancel",
            source_id: String(mov._id),
          });

          asientoReversionId = String(reversed._id);
        }
      }
    }

    mov.asiento_reversion_id = asientoReversionId || mov.asiento_reversion_id || null;
    await mov.save();

    return res.json({
      ok: true,
      message: asientoReversionId
        ? "Movimiento cancelado y asiento de reversión generado"
        : "Movimiento cancelado (sin asiento de reversión disponible)",
    });
  } catch (err) {
    console.error("POST /api/inventario/movimientos/:id/cancel error:", err);
    return res.status(500).json({ ok: false, message: "No se pudo cancelar el movimiento" });
  }
});

module.exports = router;
