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
function parseDate(s) {
  if (!s) return null;
  const d = new Date(String(s));
  return Number.isNaN(d.getTime()) ? null : d;
}

function num(v, def = 0) {
  if (v === null || v === undefined) return def;
  const s = String(v).trim();
  if (!s) return def;
  const cleaned = s.replace(/[$,\s]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : def;
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

function normalizeMovement(m) {
  // Soporta campos distintos según tu modelo real
  const cantidad = num(m?.cantidad ?? m?.qty ?? m?.quantity ?? m?.unidades ?? m?.units, 0);

  let costoUnit = num(
    m?.costo_unitario ??
      m?.costoUnitario ??
      m?.unitCost ??
      m?.costoUnit ??
      m?.costoCompra ??
      m?.costo_compra ??
      m?.precio_unitario ??
      m?.precioUnitario ??
      m?.unitPrice ??
      m?.precio ??
      m?.price,
    0
  );

  let costoTotal = num(
    m?.costo_total ??
      m?.costoTotal ??
      m?.total ??
      m?.monto_total ??
      m?.montoTotal ??
      m?.importe_total ??
      m?.importeTotal ??
      m?.amount ??
      m?.monto ??
      m?.importe,
    0
  );

  // ✅ Derivación E2E
  if (!costoTotal && costoUnit && cantidad) costoTotal = costoUnit * cantidad;
  if (!costoUnit && costoTotal && cantidad) costoUnit = costoTotal / cantidad;

  // Producto (si viene populate o si fue eliminado)
  const prodObj =
    m?.productos ||
    m?.producto ||
    m?.product ||
    (m?.producto_id && typeof m.producto_id === "object" ? m.producto_id : null) ||
    (m?.productoId && typeof m.productoId === "object" ? m.productoId : null) ||
    (m?.productId && typeof m.productId === "object" ? m.productId : null) ||
    null;

  const productos = prodObj
    ? {
        nombre: String(prodObj?.nombre ?? "Producto eliminado"),
        imagen_url: prodObj?.imagen_url ?? prodObj?.imagenUrl ?? prodObj?.image ?? undefined,
      }
    : { nombre: "Producto eliminado" };

  const tipo =
    String(m?.tipo_movimiento ?? m?.tipoMovimiento ?? m?.tipo ?? m?.type ?? "")
      .toLowerCase()
      .trim() || "entrada";

  const fecha = m?.fecha ?? m?.date ?? m?.createdAt ?? m?.created_at ?? m?.updatedAt ?? m?.updated_at ?? null;

  return {
    ...m,
    id: asId(m?.id ?? m?._id),
    producto_id: asId(
      m?.producto_id ??
        m?.productoId ??
        m?.productId ??
        m?.producto ??
        m?.product ??
        m?.producto?._id ??
        m?.product?._id
    ),
    tipo_movimiento: tipo,
    cantidad,
    costo_unitario: costoUnit,
    costo_total: costoTotal,
    fecha,
    descripcion: m?.descripcion ?? "",
    estado: m?.estado ?? null,
    motivo_cancelacion: m?.motivo_cancelacion ?? null,
    fecha_cancelacion: m?.fecha_cancelacion ?? null,
    movimiento_reversion_id: m?.movimiento_reversion_id ?? null,
    productos,
  };
}

async function mapJournalEntryForUI(entry) {
  if (!entry) return null;

  const lines = Array.isArray(entry.lines) ? entry.lines : Array.isArray(entry.detalles) ? entry.detalles : [];

  // Construimos lookup de cuentas por código (si tenemos Account)
  const accountCodes = lines
    .map((l) => String(l.accountCodigo ?? l.cuenta_codigo ?? l.accountCode ?? l.codigo ?? "").trim())
    .filter(Boolean);

  let byCode = {};
  if (Account && accountCodes.length) {
    const accs = await Account.find({ code: { $in: accountCodes } }).select("code name").lean();
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
 * GET /api/inventario/movimientos?tipo=venta&start=YYYY-MM-DD&end=YYYY-MM-DD
 * Soporta también from/to.
 */
router.get("/movimientos", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;

    const tipoRaw = String(req.query.tipo ?? "").trim().toLowerCase();

    // ✅ ampliamos permitidos para no romper si guardas "entrada/salida"
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

    const start = parseDate(req.query.start || req.query.from);
    const end = parseDate(req.query.end || req.query.to);

    if (!InventoryMovement) {
      return res.json({
        ok: true,
        data: {
          items: [],
          meta: {
            tipo: tipoValido || "todos",
            start: start ? start.toISOString() : null,
            end: end ? end.toISOString() : null,
            note: "InventoryMovement model no existe aún",
          },
        },
      });
    }

    const q = { owner };

    if (tipoValido) {
      // Si te llegan "entrada/salida" y tu modelo usa "tipo" o "tipo_movimiento", lo manejamos flexible
      // Probable: tu schema usa "tipo" (como en tu filtro original)
      q.tipo = tipoValido;
    }

    if (start && end) q.fecha = { $gte: start, $lte: end };
    else if (start && !end) q.fecha = { $gte: start };
    else if (!start && end) q.fecha = { $lte: end };

    const limit = Math.min(5000, Number(req.query.limit || 2000));

    // ✅ strictPopulate false para evitar errors si la ruta no existe en schema (Mongoose 7)
    const itemsRaw = await InventoryMovement.find(q)
      .sort({ fecha: -1, createdAt: -1 })
      .limit(limit)
      .setOptions({ strictPopulate: false })
      .populate({ path: "productoId", select: "nombre imagen_url imagenUrl image", strictPopulate: false })
      .populate({ path: "productId", select: "nombre imagen_url imagenUrl image", strictPopulate: false })
      .populate({ path: "producto_id", select: "nombre imagen_url imagenUrl image", strictPopulate: false })
      .lean();

    // ✅ Normalización E2E (para que no salgan $0 por campos raros)
    const items = (itemsRaw || []).map(normalizeMovement);

    return res.json({
      ok: true,
      data: {
        items,
        meta: {
          tipo: tipoValido || "todos",
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

    if (!InventoryMovement) {
      return res.json({ ok: true, data: null });
    }

    const mov = await InventoryMovement.findOne({ _id: movimientoId, owner }).lean();
    if (!mov) return res.status(404).json({ ok: false, message: "Movimiento no encontrado" });

    if (!JournalEntry) {
      return res.json({ ok: true, data: null });
    }

    const asientoId = getMovementAsientoId(mov);
    if (!asientoId) {
      return res.json({ ok: true, data: null });
    }

    const entry = await JournalEntry.findOne({ _id: asientoId, owner }).lean();
    if (!entry) return res.json({ ok: true, data: null });

    const mapped = await mapJournalEntryForUI(entry);
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

    // Evitar doble cancelación
    const yaCancelado =
      String(mov.estado || "").toLowerCase() === "cancelado" ||
      !!mov.motivo_cancelacion ||
      !!mov.fecha_cancelacion ||
      !!mov.movimiento_reversion_id;

    if (yaCancelado) {
      return res.json({ ok: true, message: "Movimiento ya estaba cancelado" });
    }

    // Solo permitimos cancelar compras (tu UI lo usa así)
    const tipo = String(mov.tipo_movimiento ?? mov.tipo ?? "").toLowerCase().trim();
    if (tipo !== "compra") {
      return res.status(400).json({ ok: false, message: "Solo se pueden cancelar compras de inventario" });
    }

    // Marcar cancelación
    mov.estado = "cancelado";
    mov.motivo_cancelacion = motivoCancelacion;
    mov.fecha_cancelacion = new Date();

    // Si hay JournalEntry, intentamos generar reversión
    let asientoReversionId = null;
    if (JournalEntry) {
      const asientoId = getMovementAsientoId(mov);
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
          });

          asientoReversionId = String(reversed._id);
        }
      }
    }

    // Guardamos referencia si el schema lo soporta (no truena si no existe)
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
