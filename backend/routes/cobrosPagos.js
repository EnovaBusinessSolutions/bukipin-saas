// backend/routes/cobrosPagos.js
const express = require("express");
const router = express.Router();

const mongoose = require("mongoose");
const ensureAuth = require("../middleware/ensureAuth");

// ✅ JournalEntry (fallback E2E si no existe CobroPago guardado)
let JournalEntry = null;
try {
  JournalEntry = require("../models/JournalEntry");
} catch (_) {}

// =========================
// Modelo: CobroPago (simple)
// =========================
function getCobroPagoModel() {
  if (mongoose.models.CobroPago) return mongoose.models.CobroPago;

  const schema = new mongoose.Schema(
    {
      owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },

      // cobro | pago
      tipo: { type: String, default: "cobro", trim: true, index: true },

      // "ingreso" (para CxC) - en el futuro podría ser capex/egreso/etc.
      referencia_tipo: { type: String, default: "ingreso", trim: true, index: true },

      referencia_id: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },

      fecha: { type: Date, default: Date.now, index: true },

      metodoPago: { type: String, default: "efectivo", trim: true }, // efectivo|bancos|otros
      monto: { type: Number, default: 0 },

      nota: { type: String, default: "", trim: true },

      // vínculo al asiento si aplica
      asientoId: { type: mongoose.Schema.Types.ObjectId, ref: "JournalEntry", default: null, index: true },
      numeroAsiento: { type: String, default: "", trim: true },

      estado: { type: String, default: "activo", enum: ["activo", "cancelado"], index: true },
      canceladoAt: { type: Date, default: null },
      canceladoReason: { type: String, default: "" },
    },
    {
      timestamps: true,
      toJSON: {
        virtuals: true,
        transform: (_doc, ret) => {
          ret.id = String(ret._id);

          // ISO
          ret.created_at = ret.createdAt ? new Date(ret.createdAt).toISOString() : null;
          ret.updated_at = ret.updatedAt ? new Date(ret.updatedAt).toISOString() : null;

          // compat snake_case
          ret.referencia_id = ret.referencia_id ? String(ret.referencia_id) : null;
          ret.asiento_id = ret.asientoId ? String(ret.asientoId) : null;
          ret.numero_asiento = ret.numeroAsiento || null;
          ret.metodo_pago = ret.metodoPago || null;

          // ✅ compat adicional (frontend CxC suele leer "descripcion")
          ret.descripcion = ret.nota || "";
          ret.concepto = ret.nota || "";
          ret.tipo_transaccion = ret.tipo || "cobro";

          delete ret._id;
          delete ret.__v;
          delete ret.createdAt;
          delete ret.updatedAt;
          return ret;
        },
      },
      toObject: { virtuals: true },
    }
  );

  schema.index({ owner: 1, referencia_id: 1, fecha: -1 });

  return mongoose.model("CobroPago", schema);
}

// =========================
// Helpers
// =========================
function num(v, def = 0) {
  if (v === null || typeof v === "undefined") return def;
  if (typeof v === "number") return Number.isFinite(v) ? v : def;
  const s = String(v).trim();
  if (!s) return def;
  const cleaned = s.replace(/[$,\s]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : def;
}

function lower(v) {
  return String(v ?? "").trim().toLowerCase();
}

function asValidDate(v) {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function normalizeMetodoPago(raw) {
  const v = lower(raw);
  if (!v) return "efectivo";
  if (["tarjeta", "transferencia", "spei", "banco", "bancos"].includes(v)) return "bancos";
  if (["efectivo", "cash", "caja"].includes(v)) return "efectivo";
  return v;
}

function mapCobroPagoCompat(doc) {
  // doc puede venir de .toJSON() o de un objeto lean
  const _id = doc?._id ?? doc?.id ?? null;

  const referenciaId =
    doc?.referencia_id ??
    doc?.referenciaId ??
    doc?.referencia ??
    doc?.sourceId ??
    doc?.transaccionId ??
    null;

  const asientoId =
    doc?.asientoId ?? doc?.asiento_id ?? doc?.journalEntryId ?? null;

  const fecha =
    asValidDate(doc?.fecha) ||
    asValidDate(doc?.date) ||
    asValidDate(doc?.createdAt) ||
    (doc?.created_at ? asValidDate(doc.created_at) : null) ||
    new Date();

  const metodoPago = normalizeMetodoPago(doc?.metodoPago ?? doc?.metodo_pago);

  const numeroAsiento =
    doc?.numeroAsiento ?? doc?.numero_asiento ?? doc?.numero ?? doc?.folio ?? null;

  const nota = String(doc?.nota ?? doc?.concepto ?? doc?.descripcion ?? "").trim();

  const out = {
    id: _id ? String(_id) : undefined,

    tipo: doc?.tipo ?? "cobro",
    // ✅ compat para el frontend (pago inicial usa tipo_transaccion)
    tipo_transaccion: doc?.tipo_transaccion ?? doc?.tipo ?? "cobro",

    referencia_tipo: doc?.referencia_tipo ?? "ingreso",
    referencia_id: referenciaId ? String(referenciaId) : null,

    fecha: fecha.toISOString(),

    metodoPago,
    metodo_pago: metodoPago,

    monto: num(doc?.monto, 0),

    // ✅ compat: el frontend muestra "pago.descripcion"
    nota,
    descripcion: nota,
    concepto: nota,

    asientoId: asientoId ? String(asientoId) : null,
    asiento_id: asientoId ? String(asientoId) : null,

    numeroAsiento: numeroAsiento ? String(numeroAsiento) : null,
    numero_asiento: numeroAsiento ? String(numeroAsiento) : null,

    estado: doc?.estado ?? "activo",

    created_at: doc?.created_at ?? (doc?.createdAt ? new Date(doc.createdAt).toISOString() : null),
    updated_at: doc?.updated_at ?? (doc?.updatedAt ? new Date(doc.updatedAt).toISOString() : null),
  };

  return out;
}

async function fallbackHistorialFromJournalEntries(owner, referenciaId, tipo, limit) {
  // Si no existe JournalEntry, no podemos hacer fallback
  if (!JournalEntry) return [];

  // Para CxC: cobros reales están en JournalEntry con source="cobro_cxc"
  // y sourceId/transaccionId = id del ingreso (lo crea cxc.js)
  const refObjId = new mongoose.Types.ObjectId(String(referenciaId));

  const q = {
    owner,
    source: tipo === "pago" ? "pago" : "cobro_cxc",
    $or: [{ sourceId: refObjId }, { transaccionId: refObjId }, { source_id: refObjId }],
  };

  const rows = await JournalEntry.find(q)
    .select(
      "date fecha createdAt updatedAt concept concepto descripcion numeroAsiento numero_asiento numero folio source sourceId transaccionId lines detalle_asientos detalles_asiento"
    )
    .sort({ date: -1, fecha: -1, createdAt: -1 })
    .limit(limit)
    .lean();

  // Inferir monto y metodoPago desde lines:
  // Cobro CxC: Debe 1001/1002, Haber 1003/1009
  const out = (rows || []).map((e) => {
    const lines = e.lines || e.detalle_asientos || e.detalles_asiento || [];

    let debe1001 = 0;
    let debe1002 = 0;

    for (const l of lines || []) {
      const code = String(
        l.accountCodigo ?? l.accountCode ?? l.cuenta_codigo ?? l.cuentaCodigo ?? ""
      ).trim();
      const debit = num(l.debit ?? l.debe, 0);

      if (code === "1001") debe1001 += debit;
      if (code === "1002") debe1002 += debit;
    }

    const monto = Math.max(0, Number((debe1001 + debe1002).toFixed(2)));
    const metodoPago = debe1002 > 0 ? "bancos" : "efectivo";

    const conceptText = e.concept ?? e.concepto ?? e.descripcion ?? "";

    return mapCobroPagoCompat({
      _id: e._id,
      tipo,
      tipo_transaccion: tipo,
      referencia_tipo: "ingreso",
      referencia_id: referenciaId,

      fecha: e.date ?? e.fecha ?? e.createdAt,

      metodoPago,
      monto,

      nota: conceptText,
      descripcion: conceptText,
      concepto: conceptText,

      asientoId: e._id,
      numeroAsiento: e.numeroAsiento ?? e.numero_asiento ?? e.numero ?? e.folio ?? null,

      estado: "activo",

      createdAt: e.createdAt,
      updatedAt: e.updatedAt,
    });
  });

  return out;
}

// =========================
// Endpoints
// =========================

/**
 * GET /api/cobros-pagos/historial?referencia_id=...&tipo=cobro
 * - referencia_id: id de la transacción (IncomeTransaction)
 * - tipo: cobro|pago (default cobro)
 */
router.get("/historial", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;

    const referenciaId =
      req.query.referencia_id ?? req.query.referenciaId ?? req.query.id ?? null;

    if (!referenciaId || !mongoose.Types.ObjectId.isValid(String(referenciaId))) {
      return res.status(400).json({ ok: false, message: "referencia_id inválido." });
    }

    const tipo = lower(req.query.tipo || "cobro"); // cobro|pago
    if (!["cobro", "pago"].includes(tipo)) {
      return res.status(400).json({ ok: false, message: "tipo inválido (cobro|pago)." });
    }

    const limit = Math.min(5000, Number(req.query.limit || 200));

    const CobroPago = getCobroPagoModel();

    // ✅ NO usamos lean para aprovechar toJSON/transform
    const docs = await CobroPago.find({
      owner,
      tipo,
      referencia_id: new mongoose.Types.ObjectId(String(referenciaId)),
      estado: { $ne: "cancelado" },
    })
      .sort({ fecha: -1, createdAt: -1 })
      .limit(limit);

    let data = (docs || []).map((d) => mapCobroPagoCompat(d.toJSON()));

    // ✅ Fallback E2E: si no hay registros guardados, derivamos desde JournalEntry (cobro_cxc)
    if (!data.length) {
      const fallback = await fallbackHistorialFromJournalEntries(owner, referenciaId, tipo, limit);
      data = fallback;
    }

    return res.json({ ok: true, data, items: data });
  } catch (err) {
    console.error("GET /api/cobros-pagos/historial error:", err);
    return res.status(500).json({ ok: false, message: "Error cargando historial" });
  }
});

/**
 * (Opcional) POST /api/cobros-pagos/registrar
 */
router.post("/registrar", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;

    const tipo = lower(req.body?.tipo || "cobro");
    const referenciaId = req.body?.referencia_id ?? req.body?.referenciaId ?? null;

    if (!["cobro", "pago"].includes(tipo)) {
      return res.status(400).json({ ok: false, message: "tipo inválido (cobro|pago)." });
    }
    if (!referenciaId || !mongoose.Types.ObjectId.isValid(String(referenciaId))) {
      return res.status(400).json({ ok: false, message: "referencia_id inválido." });
    }

    const monto = num(req.body?.monto, 0);
    if (!(monto > 0)) return res.status(400).json({ ok: false, message: "monto debe ser > 0." });

    const metodoPago = normalizeMetodoPago(req.body?.metodoPago ?? req.body?.metodo_pago ?? "efectivo");
    const fecha = asValidDate(req.body?.fecha) || new Date();
    const nota = String(req.body?.nota ?? req.body?.descripcion ?? req.body?.concepto ?? "").trim();

    const asientoIdRaw = req.body?.asientoId ?? req.body?.asiento_id ?? null;
    const asientoId =
      asientoIdRaw && mongoose.Types.ObjectId.isValid(String(asientoIdRaw))
        ? new mongoose.Types.ObjectId(String(asientoIdRaw))
        : null;

    const numeroAsiento = String(req.body?.numeroAsiento ?? req.body?.numero_asiento ?? "").trim();

    const CobroPago = getCobroPagoModel();

    const doc = await CobroPago.create({
      owner,
      tipo,
      referencia_tipo: "ingreso",
      referencia_id: new mongoose.Types.ObjectId(String(referenciaId)),
      fecha,
      metodoPago,
      monto,
      nota,
      asientoId,
      numeroAsiento,
      estado: "activo",
    });

    return res.status(201).json({ ok: true, data: mapCobroPagoCompat(doc.toJSON()) });
  } catch (err) {
    console.error("POST /api/cobros-pagos/registrar error:", err);
    return res.status(500).json({ ok: false, message: "Error registrando historial" });
  }
});

module.exports = router;