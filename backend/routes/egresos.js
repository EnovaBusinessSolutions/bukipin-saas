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

function num(v, def = 0) {
  const n = Number(String(v ?? "").replace(/,/g, ""));
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
  };
}

/** -----------------------------
 * Helpers para JournalEntry -> UI
 * ----------------------------- */
function lineAccountCode(l) {
  return String(
    l?.accountCodigo ??
      l?.accountCode ??
      l?.cuenta_codigo ??
      l?.cuentaCodigo ??
      l?.code ??
      ""
  ).trim();
}

function lineDebit(l) {
  // soporta: debit / debe / monto+side
  const side = String(l?.side || "").toLowerCase();
  if (side === "debit") return num(l?.monto, 0);
  return num(l?.debit ?? l?.debe ?? 0, 0);
}

function lineCredit(l) {
  const side = String(l?.side || "").toLowerCase();
  if (side === "credit") return num(l?.monto, 0);
  return num(l?.credit ?? l?.haber ?? 0, 0);
}

function lineMemo(l) {
  return String(l?.memo ?? l?.descripcion ?? l?.concepto ?? l?.description ?? "").trim();
}

function mapJournalEntryDetails(lines) {
  const arr = Array.isArray(lines) ? lines : [];
  return arr.map((l) => ({
    cuenta_codigo: lineAccountCode(l),
    cuenta_nombre: l?.accountNombre ?? l?.cuenta_nombre ?? l?.cuentaNombre ?? undefined,
    descripcion: lineMemo(l),
    debe: lineDebit(l),
    haber: lineCredit(l),
  }));
}

function pickEntryISO(entry) {
  const v = entry?.date ?? entry?.fecha ?? entry?.createdAt ?? entry?.created_at ?? null;
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function extractNameQtyFromText(text) {
  const s = String(text || "").trim();
  if (!s) return { producto_nombre: "", cantidad: 0 };

  // Ej: "Costo de venta - PRODUCTO 1 (6 unidades)"
  const m = s.match(/-\s*(.+?)\s*\((\d+)\s*unidades?\)/i);
  if (m) {
    return {
      producto_nombre: String(m[1] || "").trim(),
      cantidad: num(m[2], 0),
    };
  }

  // Ej: "Salida de inventario - PRODUCTO 1 (6 unidades)"
  const m2 = s.match(/inventario\s*-\s*(.+?)\s*\((\d+)\s*unidades?\)/i);
  if (m2) {
    return {
      producto_nombre: String(m2[1] || "").trim(),
      cantidad: num(m2[2], 0),
    };
  }

  return { producto_nombre: "", cantidad: 0 };
}

/**
 * ✅ ENDPOINT LEGACY REAL (sin rewrite)
 * Tu UI/bundle viejo pide:
 *   GET /api/egresos?estado=activo&start=YYYY-MM-DD&end=YYYY-MM-DD&limit=...
 */
router.get("/", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;

    const estado = String(req.query.estado || "activo").trim();
    const limit = Math.min(Math.max(parseInt(String(req.query.limit || "200"), 10) || 200, 1), 1000);

    const start = parseYMD(req.query.start);
    const end = parseYMD(req.query.end);

    const q = { owner };

    if (estado) q.estado = estado;

    if (start || end) {
      const dateFilter = {};
      if (start) dateFilter.$gte = start;
      if (end) dateFilter.$lte = endOfDay(end);

      // robusto: algunos guardan fecha, otros createdAt
      q.$or = [{ fecha: dateFilter }, { createdAt: dateFilter }, { created_at: dateFilter }];
    }

    const rows = await ExpenseTransaction.find(q)
      .sort({ fecha: -1, createdAt: -1, created_at: -1 })
      .limit(limit)
      .lean();

    const items = rows.map(mapEgresoForUI);

    return res.json({ ok: true, data: items, items });
  } catch (e) {
    console.error("GET /api/egresos error:", e);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

// ✅ COGS desde asientos (cuenta 5002)
// GET /api/egresos/costos-venta-inventario?start=YYYY-MM-DD&end=YYYY-MM-DD
router.get("/costos-venta-inventario", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;

    const start = parseYMD(req.query.start);
    const end = parseYMD(req.query.end);

    // Campo fecha real en JournalEntry (igual filosofía que asientos.js)
    const p = JournalEntry?.schema?.paths || {};
    const dateField = p.date ? "date" : p.fecha ? "fecha" : p.entryDate ? "entryDate" : "createdAt";

    const match = { owner };
    if (start || end) {
      match[dateField] = {};
      if (start) match[dateField].$gte = start;
      if (end) match[dateField].$lte = endOfDay(end);
    }

    // Traer asientos candidatos
    const docs = await JournalEntry.find(match)
      .select(`${dateField} concept concepto descripcion memo numeroAsiento numero_asiento numero folio lines detalle_asientos detalles_asiento`)
      .sort({ [dateField]: -1, createdAt: -1 })
      .lean();

    if (!docs?.length) return res.json({ ok: true, data: [], items: [] });

    // Helper robusto para detectar codigo y debe/haber (similar a asientos.js)
    const n = (v) => {
      if (v == null) return 0;
      if (typeof v === "number") return Number.isFinite(v) ? v : 0;
      const s = String(v).trim().replace(/[$,\s]/g, "");
      const numx = Number(s);
      return Number.isFinite(numx) ? numx : 0;
    };

    const pickCode = (l) =>
      String(
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

    const pickDebe = (l) => {
      const side = String(l?.side || "").toLowerCase().trim();
      const monto = n(l?.monto) || n(l?.amount) || n(l?.importe) || n(l?.valor) || 0;
      return n(l?.debit) || n(l?.debe) || (side === "debit" ? monto : 0);
    };

    const pickHaber = (l) => {
      const side = String(l?.side || "").toLowerCase().trim();
      const monto = n(l?.monto) || n(l?.amount) || n(l?.importe) || n(l?.valor) || 0;
      return n(l?.credit) || n(l?.haber) || (side === "credit" ? monto : 0);
    };

    // Mapa de nombres de cuentas (para detalles)
    const allLines = [];
    for (const e of docs) {
      const lines = e.lines || e.detalle_asientos || e.detalles_asiento || [];
      if (Array.isArray(lines)) allLines.push(...lines);
    }

    // Resolver nombres desde Accounts
    const codes = Array.from(new Set(allLines.map(pickCode).filter(Boolean)));
    const accRows = await Account.find({
      owner,
      $or: [{ code: { $in: codes } }, { codigo: { $in: codes } }],
    })
      .select("code codigo name nombre")
      .lean();

    const nameMap = new Map(
      (accRows || []).map((a) => [String(a.code ?? a.codigo).trim(), a.name ?? a.nombre ?? ""])
    );

    const toYMDLocal = (d) => {
      const dt = new Date(d);
      if (Number.isNaN(dt.getTime())) return null;
      const y = dt.getFullYear();
      const m = String(dt.getMonth() + 1).padStart(2, "0");
      const day = String(dt.getDate()).padStart(2, "0");
      return `${y}-${m}-${day}`;
    };

    const out = [];

    for (const e of docs) {
      const lines = e.lines || e.detalle_asientos || e.detalles_asiento || [];
      if (!Array.isArray(lines) || !lines.length) continue;

      // suma debe de 5002
      let debe5002 = 0;
      for (const l of lines) {
        if (pickCode(l) === "5002") {
          debe5002 += pickDebe(l);
        }
      }
      if (!(debe5002 > 0)) continue;

      const fecha = e?.[dateField] ?? e?.createdAt ?? e?.created_at ?? new Date();
      const numero =
        e.numeroAsiento ?? e.numero_asiento ?? e.numero ?? e.folio ?? String(e._id);

      const concepto = (e.concept ?? e.concepto ?? e.descripcion ?? e.memo ?? "").trim();

      const detalles_asiento = lines.map((l) => {
        const code = pickCode(l) || null;
        return {
          cuenta_codigo: code,
          cuenta_nombre: code ? nameMap.get(code) || null : null,
          debe: pickDebe(l),
          haber: pickHaber(l),
          descripcion: String(l?.memo ?? l?.descripcion ?? l?.concepto ?? l?.description ?? "").trim() || null,
        };
      });

      out.push({
        id: String(e._id),
        fecha: toYMDLocal(fecha),
        descripcion: concepto || "Costo de venta inventario",
        monto: Math.round(debe5002 * 100) / 100,
        numero_asiento: String(numero),
        producto_nombre: "Inventario",
        producto_imagen: null,
        cantidad: null,
        costo_unitario: null,
        detalles_asiento,
      });
    }

    return res.json({ ok: true, data: out, items: out });
  } catch (e) {
    console.error("GET /api/egresos/costos-venta-inventario error:", e);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});


/**
 * ✅ Guardar URL del comprobante (la UI lo llama tras el upload)
 * PATCH /api/egresos/:id/comprobante
 * body: { imagen_comprobante: string }
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
      return res.status(400).json({ ok: false, error: "VALIDATION", message: "imagen_comprobante es requerido" });
    }

    const tx = await ExpenseTransaction.findOneAndUpdate(
      { owner, _id: id },
      { $set: { imagen_comprobante } },
      { new: true }
    ).lean();

    if (!tx) {
      return res.status(404).json({ ok: false, error: "NOT_FOUND", message: "No se encontró la transacción" });
    }

    return res.json({ ok: true, data: mapEgresoForUI(tx) });
  } catch (e) {
    console.error("PATCH /api/egresos/:id/comprobante error:", e);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

/**
 * ✅ CANCELAR EGRESO + (si existe) CREAR ASIENTO DE REVERSIÓN
 * UI llama:
 *   POST /api/egresos/:id/cancel
 * body: { motivoCancelacion: string }
 *
 * Importante: si NO hay asiento original, igual cancelamos la tx (para E2E UI).
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

    // 1) Buscar asiento original (por numeroAsiento o por source/sourceId/transaccionId)
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

    // 2) Crear reversión solo si existe asiento original con líneas
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

      const revNumero = `EGR-REV-${String(originalEntry.numeroAsiento || originalEntry.numero_asiento || originalEntry._id)}-${Date.now()}`;

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

    // 3) Marcar transacción cancelada
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

// ✅ /api/egresos/transacciones  -> (GET/POST)
// ✅ /api/egresos/transacciones/:id -> (GET)
router.use("/transacciones", transaccionesEgresosRouter);

module.exports = router;
