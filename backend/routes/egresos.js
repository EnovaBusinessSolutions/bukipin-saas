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
  const n = Number(v);
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
    subtipo_egreso: t.subtipo_egreso != null ? String(t.subtipo_egreso) : (t.subtipoEgreso != null ? String(t.subtipoEgreso) : null),

    descripcion: String(t.descripcion ?? t.concepto ?? t.memo ?? ""),
    concepto: t.concepto != null ? String(t.concepto) : null,

    monto_total: num(t.monto_total ?? t.montoTotal ?? t.total ?? 0),
    monto_pagado: num(t.monto_pagado ?? t.montoPagado ?? 0),
    monto_pendiente: num(t.monto_pendiente ?? t.montoPendiente ?? 0),

    tipo_pago: String(t.tipo_pago ?? t.tipoPago ?? ""),
    metodo_pago: t.metodo_pago != null ? String(t.metodo_pago) : (t.metodoPago != null ? String(t.metodoPago) : null),

    proveedor_nombre: t.proveedor_nombre != null ? String(t.proveedor_nombre) : (t.proveedorNombre != null ? String(t.proveedorNombre) : null),
    proveedor_telefono: t.proveedor_telefono != null ? String(t.proveedor_telefono) : (t.proveedorTelefono != null ? String(t.proveedorTelefono) : null),
    proveedor_email: t.proveedor_email != null ? String(t.proveedor_email) : (t.proveedorEmail != null ? String(t.proveedorEmail) : null),
    proveedor_rfc: t.proveedor_rfc != null ? String(t.proveedor_rfc) : (t.proveedorRfc != null ? String(t.proveedorRfc) : null),

    cantidad: t.cantidad != null ? num(t.cantidad, 0) : null,
    precio_unitario: t.precio_unitario != null ? num(t.precio_unitario, 0) : (t.precioUnitario != null ? num(t.precioUnitario, 0) : null),

    created_at: new Date(t.created_at ?? t.createdAt ?? t.fecha ?? new Date()).toISOString(),
    comentarios: t.comentarios != null ? String(t.comentarios) : null,
    fecha_vencimiento: t.fecha_vencimiento != null ? String(t.fecha_vencimiento) : (t.fechaVencimiento != null ? String(t.fechaVencimiento) : null),

    imagen_comprobante: t.imagen_comprobante != null ? String(t.imagen_comprobante) : (t.imagenComprobante != null ? String(t.imagenComprobante) : null),

    cuenta_codigo: t.cuenta_codigo != null ? String(t.cuenta_codigo) : (t.cuentaCodigo != null ? String(t.cuentaCodigo) : null),
    subcuenta_id: t.subcuenta_id != null ? String(t.subcuenta_id) : (t.subcuentaId != null ? String(t.subcuentaId) : null),

    estado: String(t.estado ?? "activo"),
  };
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
        asiento_original: originalEntry ? (originalEntry.numeroAsiento || originalEntry.numero_asiento || String(originalEntry._id)) : null,
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
