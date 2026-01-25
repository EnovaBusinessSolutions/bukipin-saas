// backend/routes/egresos.js
const express = require("express");
const router = express.Router();

const mongoose = require("mongoose");
const ensureAuth = require("../middleware/ensureAuth");

// Reusamos tu router actual
const transaccionesEgresosRouter = require("./transaccionesEgresos");

// Modelos
const ExpenseTransaction = require("../models/ExpenseTransaction");
const JournalEntry = require("../models/JournalEntry");
const Account = require("../models/Account"); // ✅ OK

function num(v, def = 0) {
  const n = Number(String(v ?? "").replace(/,/g, "").replace(/\$/g, "").trim());
  return Number.isFinite(n) ? n : def;
}

function parseYMD(s) {
  const str = String(s || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return null;
  const d = new Date(`${str}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function endOfDay(d) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function toYMDLocal(d) {
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return null;
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const day = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function mapEgresoForUI(doc) {
  const t = doc?._doc || doc || {};
  const id = String(t._id || t.id || "");

  return {
    id,
    tipo_egreso: String(t.tipo_egreso ?? t.tipoEgreso ?? t.tipo ?? ""),
    subtipo_egreso:
      t.subtipo_egreso != null
        ? String(t.subtipo_egreso)
        : t.subtipoEgreso != null
        ? String(t.subtipoEgreso)
        : null,

    descripcion: String(t.descripcion ?? t.concepto ?? t.memo ?? ""),
    concepto: t.concepto != null ? String(t.concepto) : null,

    // ✅ extras para COGS (no rompen UI si no se usan)
    producto_nombre: t.producto_nombre != null ? String(t.producto_nombre) : null,
    producto_imagen: t.producto_imagen != null ? String(t.producto_imagen) : null,

    monto_total: num(t.monto_total ?? t.montoTotal ?? t.total ?? 0),
    monto_pagado: num(t.monto_pagado ?? t.montoPagado ?? 0),
    monto_pendiente: num(t.monto_pendiente ?? t.montoPendiente ?? 0),

    tipo_pago: String(t.tipo_pago ?? t.tipoPago ?? ""),
    metodo_pago:
      t.metodo_pago != null
        ? String(t.metodo_pago)
        : t.metodoPago != null
        ? String(t.metodoPago)
        : null,

    proveedor_nombre:
      t.proveedor_nombre != null
        ? String(t.proveedor_nombre)
        : t.proveedorNombre != null
        ? String(t.proveedorNombre)
        : null,
    proveedor_telefono:
      t.proveedor_telefono != null
        ? String(t.proveedor_telefono)
        : t.proveedorTelefono != null
        ? String(t.proveedorTelefono)
        : null,
    proveedor_email:
      t.proveedor_email != null
        ? String(t.proveedor_email)
        : t.proveedorEmail != null
        ? String(t.proveedorEmail)
        : null,
    proveedor_rfc:
      t.proveedor_rfc != null
        ? String(t.proveedor_rfc)
        : t.proveedorRfc != null
        ? String(t.proveedorRfc)
        : null,

    cantidad: t.cantidad != null ? num(t.cantidad, 0) : null,
    precio_unitario:
      t.precio_unitario != null
        ? num(t.precio_unitario, 0)
        : t.precioUnitario != null
        ? num(t.precioUnitario, 0)
        : null,

    created_at: new Date(t.created_at ?? t.createdAt ?? t.fecha ?? new Date()).toISOString(),
    comentarios: t.comentarios != null ? String(t.comentarios) : null,
    fecha_vencimiento:
      t.fecha_vencimiento != null
        ? String(t.fecha_vencimiento)
        : t.fechaVencimiento != null
        ? String(t.fechaVencimiento)
        : null,

    imagen_comprobante:
      t.imagen_comprobante != null
        ? String(t.imagen_comprobante)
        : t.imagenComprobante != null
        ? String(t.imagenComprobante)
        : null,

    cuenta_codigo:
      t.cuenta_codigo != null
        ? String(t.cuenta_codigo)
        : t.cuentaCodigo != null
        ? String(t.cuentaCodigo)
        : null,
    subcuenta_id:
      t.subcuenta_id != null
        ? String(t.subcuenta_id)
        : t.subcuentaId != null
        ? String(t.subcuentaId)
        : null,

    estado: String(t.estado ?? "activo"),

    // Extras (no rompen UI)
    source: t.source ?? null,
    asiento_numero: t.asiento_numero ?? null,

    // ✅ si viene desde COGS, guardamos el detalle completo
    detalles_asiento: t.detalles_asiento ?? t.detalle_asientos ?? null,
  };
}

/** -----------------------------
 * Helpers: JournalEntry lines
 * ----------------------------- */

function isCode5002(code) {
  const c = String(code || "").trim();
  return c === "5002" || c.startsWith("5002 ");
}

function matchCode5002Value(v) {
  // acepta "5002", 5002, "5002 - algo", etc.
  const s = String(v ?? "").trim();
  return s === "5002" || s.startsWith("5002");
}

function buildLineElemMatch5002() {
  // regex para atrapar "5002", "5002 -", "5002 ", etc.
  const rx = /^5002\b/;

  return {
    $or: [
      { accountCodigo: { $regex: rx } },
      { accountCode: { $regex: rx } },
      { cuentaCodigo: { $regex: rx } },
      { cuenta_codigo: { $regex: rx } },
      { code: { $regex: rx } },

      // por si guardaste números
      { accountCodigo: 5002 },
      { accountCode: 5002 },
      { cuentaCodigo: 5002 },
      { cuenta_codigo: 5002 },
      { code: 5002 },
    ],
  };
}

function pickLines(e) {
  return e?.lines || e?.detalle_asientos || e?.detalles_asiento || [];
}

function pickCode(l) {
  return String(
    l?.accountCodigo ??
      l?.accountCode ??
      l?.cuentaCodigo ??
      l?.cuenta_codigo ??
      l?.code ??
      l?.cuenta?.code ??
      l?.cuenta?.codigo ??
      l?.account?.code ??
      l?.account?.codigo ??
      ""
  ).trim();
}

function pickDebe(l) {
  const side = String(l?.side || "").toLowerCase().trim();
  const monto = num(l?.monto ?? l?.amount ?? l?.importe ?? l?.valor ?? 0, 0);
  return num(l?.debit ?? l?.debe ?? 0, 0) || (side === "debit" ? monto : 0);
}

function pickHaber(l) {
  const side = String(l?.side || "").toLowerCase().trim();
  const monto = num(l?.monto ?? l?.amount ?? l?.importe ?? l?.valor ?? 0, 0);
  return num(l?.credit ?? l?.haber ?? 0, 0) || (side === "credit" ? monto : 0);
}

function pickMemo(l) {
  return String(l?.memo ?? l?.descripcion ?? l?.concepto ?? l?.description ?? "").trim();
}

function pickEntryDate(e) {
  // ✅ súper robusto: usa el que exista
  return e?.date || e?.fecha || e?.entryDate || e?.createdAt || e?.created_at || new Date();
}

function pickEntryNumero(e) {
  return e?.numeroAsiento ?? e?.numero_asiento ?? e?.numero ?? e?.folio ?? String(e?._id || "");
}

function extractNameQtyFromText(text) {
  const s = String(text || "").trim();
  if (!s) return { producto_nombre: "", cantidad: null };

  const m = s.match(/-\s*(.+?)\s*\((\d+)\s*unidades?\)/i);
  if (m) return { producto_nombre: String(m[1] || "").trim(), cantidad: num(m[2], 0) };

  const m2 = s.match(/inventario\s*-\s*(.+?)\s*\((\d+)\s*unidades?\)/i);
  if (m2) return { producto_nombre: String(m2[1] || "").trim(), cantidad: num(m2[2], 0) };

  return { producto_nombre: "", cantidad: null };
}

function buildJournalDateOrFilter(start, end) {
  if (!start && !end) return null;

  const dateFilter = {};
  if (start) dateFilter.$gte = start;
  if (end) dateFilter.$lte = endOfDay(end);

  // ✅ NO elegir 1 campo: usar OR entre todos los posibles
  return [
    { date: dateFilter },
    { fecha: dateFilter },
    { entryDate: dateFilter },
    { createdAt: dateFilter },
    { created_at: dateFilter },
  ];
}

async function buildCogsItemsFromJournal({ owner, start, end, limit = 500 }) {
  const and = [{ owner }];

  // ✅ filtro de fechas (OR entre campos posibles)
  const orDates = buildJournalDateOrFilter(start, end);
  if (orDates) and.push({ $or: orDates });

  // ✅ filtro REAL: solo asientos que tengan 5002 en cualquier arreglo de líneas
  const elem5002 = buildLineElemMatch5002();
  and.push({
    $or: [
      { lines: { $elemMatch: elem5002 } },
      { detalle_asientos: { $elemMatch: elem5002 } },
      { detalles_asiento: { $elemMatch: elem5002 } },
    ],
  });

  const match = and.length > 1 ? { $and: and } : and[0];

  const docs = await JournalEntry.find(match)
    .select(
      "date fecha entryDate createdAt created_at concept concepto descripcion memo numeroAsiento numero_asiento numero folio lines detalle_asientos detalles_asiento"
    )
    .sort({ date: -1, fecha: -1, createdAt: -1, created_at: -1 })
    .limit(Math.min(Math.max(limit, 1), 2000))
    .lean();

  if (!docs?.length) return [];


  // Resolver nombres de cuentas (opcional)
  const allLines = [];
  for (const e of docs) {
    const lines = pickLines(e);
    if (Array.isArray(lines)) allLines.push(...lines);
  }
  const codes = Array.from(new Set(allLines.map(pickCode).filter(Boolean)));

  let nameMap = new Map();
  if (codes.length) {
    const accRows = await Account.find({
      owner,
      $or: [{ code: { $in: codes } }, { codigo: { $in: codes } }],
    })
      .select("code codigo name nombre")
      .lean();

    nameMap = new Map(
      (accRows || []).map((a) => [String(a.code ?? a.codigo).trim(), a.name ?? a.nombre ?? ""])
    );
  }

  const out = [];

  for (const e of docs) {
    const lines = pickLines(e);
    if (!Array.isArray(lines) || !lines.length) continue;

    // suma debe de 5002
    let debe5002 = 0;
    let refText = "";
    for (const l of lines) {
  const code = pickCode(l);
  if (matchCode5002Value(code)) {
    const d = pickDebe(l);
    debe5002 += d;
    if (!refText) refText = pickMemo(l);
  }
}
    if (!(debe5002 > 0)) continue;

    const fecha = pickEntryDate(e);
    const numero = pickEntryNumero(e);
    const concepto = String(e.concept ?? e.concepto ?? e.descripcion ?? e.memo ?? "").trim();

    const { producto_nombre, cantidad } = extractNameQtyFromText(refText || concepto);

    const detalles_asiento = lines.map((l) => {
      const code = pickCode(l) || null;
      return {
        cuenta_codigo: code,
        cuenta_nombre: code ? nameMap.get(code) || null : null,
        debe: pickDebe(l),
        haber: pickHaber(l),
        descripcion: pickMemo(l) || null,
      };
    });

    out.push(
      mapEgresoForUI({
        id: `cogs_${String(e._id)}`,
        tipo_egreso: "costo_inventario",
        subtipo_egreso: "costo_venta_inventario",

        descripcion:
          concepto ||
          `Costo de venta inventario${producto_nombre ? ` - ${producto_nombre}` : ""}`,
        concepto: concepto || null,

        producto_nombre: producto_nombre || null,
        producto_imagen: null,

        monto_total: Math.round(debe5002 * 100) / 100,
        monto_pagado: Math.round(debe5002 * 100) / 100,
        monto_pendiente: 0,

        tipo_pago: "contado",
        metodo_pago: "cogs",

        cantidad: cantidad ?? null,
        precio_unitario: null,

        // ✅ importante: usar fecha del asiento, no “now”
        created_at: new Date(fecha).toISOString(),

        cuenta_codigo: "5002",
        subcuenta_id: null,

        estado: "activo",

        source: "cogs_journal",
        asiento_numero: String(numero),

        detalles_asiento,
      })
    );
  }

  return out;
}

/**
 * ✅ ENDPOINT LEGACY REAL (sin rewrite)
 * GET /api/egresos?estado=activo&start=YYYY-MM-DD&end=YYYY-MM-DD&limit=...
 * ✅ incluye COGS por default (include_cogs=0 lo apaga)
 */
router.get("/", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;

    const estado = String(req.query.estado || "activo").trim();
    const limit = Math.min(Math.max(parseInt(String(req.query.limit || "200"), 10) || 200, 1), 1000);

    const start = parseYMD(req.query.start);
    const end = parseYMD(req.query.end);

    const includeCogs = String(req.query.include_cogs ?? "1") !== "0";

    const q = { owner };
    if (estado) q.estado = estado;

    if (start || end) {
      const dateFilter = {};
      if (start) dateFilter.$gte = start;
      if (end) dateFilter.$lte = endOfDay(end);
      q.$or = [{ fecha: dateFilter }, { createdAt: dateFilter }, { created_at: dateFilter }];
    }

    const rows = await ExpenseTransaction.find(q)
      .sort({ fecha: -1, createdAt: -1, created_at: -1 })
      .limit(limit)
      .lean();

    let items = rows.map(mapEgresoForUI);

    if (includeCogs) {
      const cogs = await buildCogsItemsFromJournal({ owner, start, end, limit: 2000 });
      items = items.concat(cogs).sort((a, b) => {
        const da = new Date(a.created_at || 0).getTime();
        const db = new Date(b.created_at || 0).getTime();
        return db - da;
      });
      items = items.slice(0, limit);
    }

    return res.json({ ok: true, data: items, items });
  } catch (e) {
    console.error("GET /api/egresos error:", e);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

// ✅ COGS especializado
// GET /api/egresos/costos-venta-inventario?start=YYYY-MM-DD&end=YYYY-MM-DD
router.get("/costos-venta-inventario", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;

    const start = parseYMD(req.query.start);
    const end = parseYMD(req.query.end);

    const rows = await buildCogsItemsFromJournal({ owner, start, end, limit: 5000 });

    const out = rows.map((x) => ({
      id: x.id,
      fecha: toYMDLocal(x.created_at),
      descripcion: x.descripcion,
      monto: x.monto_total,
      numero_asiento: x.asiento_numero ?? null,
      producto_nombre: x.producto_nombre ?? null,
      cantidad: x.cantidad ?? null,
      detalles_asiento: x.detalles_asiento ?? null,
    }));

    return res.json({ ok: true, data: out, items: out });
  } catch (e) {
    console.error("GET /api/egresos/costos-venta-inventario error:", e);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

/**
 * ✅ CLAVE DEL FIX:
 * Tu UI está consumiendo /api/egresos/transacciones?... para el Resumen.
 * Ese endpoint venía del router secundario y NO incluía COGS.
 *
 * Aquí lo interceptamos y devolvemos el merge (ExpenseTransaction + COGS)
 * SIN tocar tu frontend.
 */
router.get("/transacciones", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;

    const estado = String(req.query.estado || "activo").trim();
    const limitRaw = req.query.limit ?? req.query.take ?? "200";
    const limit = Math.min(Math.max(parseInt(String(limitRaw), 10) || 200, 1), 1000);

    const start = parseYMD(req.query.start);
    const end = parseYMD(req.query.end);

    const includeCogs = String(req.query.include_cogs ?? "1") !== "0";

    const q = { owner };
    if (estado) q.estado = estado;

    if (start || end) {
      const dateFilter = {};
      if (start) dateFilter.$gte = start;
      if (end) dateFilter.$lte = endOfDay(end);
      q.$or = [{ fecha: dateFilter }, { createdAt: dateFilter }, { created_at: dateFilter }];
    }

    const rows = await ExpenseTransaction.find(q)
      .sort({ fecha: -1, createdAt: -1, created_at: -1 })
      .limit(limit)
      .lean();

    let items = rows.map(mapEgresoForUI);

    if (includeCogs) {
      const cogs = await buildCogsItemsFromJournal({ owner, start, end, limit: 5000 });
      items = items.concat(cogs).sort((a, b) => {
        const da = new Date(a.created_at || 0).getTime();
        const db = new Date(b.created_at || 0).getTime();
        return db - da;
      });
      items = items.slice(0, limit);
    }

    return res.json({ ok: true, data: items, items });
  } catch (e) {
    console.error("GET /api/egresos/transacciones (merged) error:", e);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

/**
 * ✅ Guardar URL del comprobante
 * PATCH /api/egresos/:id/comprobante
 */
router.patch("/:id/comprobante", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;
    const id = String(req.params.id || "").trim();

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ ok: false, error: "VALIDATION", message: "ID inválido" });
    }

    const imagen_comprobante = String(req.body?.imagen_comprobante || "").trim();
    if (!imagen_comprobante) {
      return res
        .status(400)
        .json({ ok: false, error: "VALIDATION", message: "imagen_comprobante es requerido" });
    }

    const tx = await ExpenseTransaction.findOneAndUpdate(
      { owner, _id: id },
      { $set: { imagen_comprobante } },
      { new: true }
    ).lean();

    if (!tx) {
      return res
        .status(404)
        .json({ ok: false, error: "NOT_FOUND", message: "No se encontró la transacción" });
    }

    return res.json({ ok: true, data: mapEgresoForUI(tx) });
  } catch (e) {
    console.error("PATCH /api/egresos/:id/comprobante error:", e);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

/**
 * ✅ CANCELAR EGRESO + (si existe) CREAR ASIENTO DE REVERSIÓN
 * POST /api/egresos/:id/cancel
 */
router.post("/:id/cancel", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;
    const id = String(req.params.id || "").trim();

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ ok: false, error: "VALIDATION", message: "ID inválido" });
    }

    const motivoCancelacion = String(req.body?.motivoCancelacion || "").trim();
    if (!motivoCancelacion) {
      return res.status(400).json({
        ok: false,
        error: "VALIDATION",
        message: "motivoCancelacion es requerido",
      });
    }

    const tx = await ExpenseTransaction.findOne({ owner, _id: id });
    if (!tx) {
      return res.status(404).json({
        ok: false,
        error: "NOT_FOUND",
        message: "No se encontró la transacción",
      });
    }

    if (String(tx.estado || "activo") === "cancelado") {
      return res.json({ ok: true, data: { alreadyCanceled: true, transaccion: mapEgresoForUI(tx) } });
    }

    const originalNumero = tx.numeroAsiento || tx.numero_asiento || tx.numeroAsientoEgreso || null;

    let originalEntry = null;

    if (originalNumero) {
      originalEntry =
        (await JournalEntry.findOne({ owner, numeroAsiento: String(originalNumero) }).sort({ createdAt: -1 }).lean()) ||
        (await JournalEntry.findOne({ owner, numero_asiento: String(originalNumero) }).sort({ createdAt: -1 }).lean());
    }

    if (!originalEntry) {
      const idCandidates = [id];
      idCandidates.push(new mongoose.Types.ObjectId(id));

      const sourceAliases = ["egreso", "egresos", "expense", "expenses"];

      originalEntry =
        (await JournalEntry.findOne({
          owner,
          source: { $in: sourceAliases },
          sourceId: { $in: idCandidates },
        })
          .sort({ createdAt: -1 })
          .lean()) ||
        (await JournalEntry.findOne({
          owner,
          source: { $in: sourceAliases },
          transaccionId: id,
        })
          .sort({ createdAt: -1 })
          .lean()) ||
        (await JournalEntry.findOne({
          owner,
          source: { $in: sourceAliases },
          transaccion_id: id,
        })
          .sort({ createdAt: -1 })
          .lean());
    }

    let asientoReversion = null;

    if (originalEntry && Array.isArray(originalEntry.lines) && originalEntry.lines.length) {
      const origLines = originalEntry.lines;

      const reversedLines = origLines.map((l) => {
        const code = String(l.accountCodigo || l.accountCode || l.cuenta_codigo || l.code || "").trim();

        return {
          accountCodigo: code,
          accountCode: code,
          cuenta_codigo: code,

          debit: num(l.credit ?? l.haber ?? 0, 0),
          credit: num(l.debit ?? l.debe ?? 0, 0),

          debe: num(l.haber ?? l.credit ?? 0, 0),
          haber: num(l.debe ?? l.debit ?? 0, 0),

          memo: `Reversión: ${String(l.memo || l.descripcion || "").trim()}`.trim(),
          descripcion: `Reversión: ${String(l.memo || l.descripcion || "").trim()}`.trim(),
        };
      });

      const revNumero = `EGR-REV-${String(
        originalEntry.numeroAsiento || originalEntry.numero_asiento || originalEntry._id
      )}-${Date.now()}`;

      const revEntry = await JournalEntry.create({
        owner,
        date: new Date(),
        concept: `Reversión egreso: ${tx.descripcion || ""} | Motivo: ${motivoCancelacion}`.trim(),
        numeroAsiento: revNumero,
        numero_asiento: revNumero,
        source: "egreso_cancel",
        sourceId: tx._id,
        transaccionId: String(tx._id),
        lines: reversedLines,
      });

      asientoReversion = revEntry?.numeroAsiento || revEntry?.numero_asiento || String(revEntry?._id || "");
      tx.numeroAsientoReversion = asientoReversion;
    }

    tx.estado = "cancelado";
    tx.motivoCancelacion = motivoCancelacion;
    tx.canceladoAt = new Date();
    await tx.save();

    return res.json({
      ok: true,
      data: {
        transaccionId: String(tx._id),
        transaccion: mapEgresoForUI(tx),
        asiento_original: originalEntry
          ? originalEntry.numeroAsiento || originalEntry.numero_asiento || String(originalEntry._id)
          : null,
        asiento_reversion: asientoReversion,
      },
    });
  } catch (e) {
    console.error("POST /api/egresos/:id/cancel error:", e);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

// ✅ Importante: dejamos el router secundario para POST /transacciones, GET /transacciones/:id, etc.
router.use("/transacciones", transaccionesEgresosRouter);

module.exports = router;
