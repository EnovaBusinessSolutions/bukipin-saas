// backend/routes/cobrosPagos.js
const express = require("express");
const router = express.Router();

const mongoose = require("mongoose");
const ensureAuth = require("../middleware/ensureAuth");

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

      // "ingreso" (para CxC)
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
          ret.created_at = ret.createdAt ? new Date(ret.createdAt).toISOString() : null;
          ret.updated_at = ret.updatedAt ? new Date(ret.updatedAt).toISOString() : null;

          // snake_case compat
          ret.referencia_id = ret.referencia_id ? String(ret.referencia_id) : null;
          ret.asiento_id = ret.asientoId ? String(ret.asientoId) : null;
          ret.numero_asiento = ret.numeroAsiento || null;
          ret.metodo_pago = ret.metodoPago || null;

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
    const limit = Math.min(5000, Number(req.query.limit || 200));

    const CobroPago = getCobroPagoModel();

    const rows = await CobroPago.find({
      owner,
      tipo: tipo || "cobro",
      referencia_id: new mongoose.Types.ObjectId(String(referenciaId)),
      estado: { $ne: "cancelado" },
    })
      .sort({ fecha: -1, createdAt: -1 })
      .limit(limit)
      .lean();

    // compat
    const data = (rows || []).map((r) => ({
      ...r,
      id: String(r._id),
      referencia_id: r.referencia_id ? String(r.referencia_id) : null,
      asiento_id: r.asientoId ? String(r.asientoId) : null,
      numero_asiento: r.numeroAsiento || null,
      metodo_pago: r.metodoPago || null,
      monto: num(r.monto, 0),
      created_at: r.createdAt ? new Date(r.createdAt).toISOString() : null,
    }));

    return res.json({ ok: true, data, items: data });
  } catch (err) {
    console.error("GET /api/cobros-pagos/historial error:", err);
    return res.status(500).json({ ok: false, message: "Error cargando historial" });
  }
});

/**
 * (Opcional) POST /api/cobros-pagos/registrar
 * Si luego quieres guardar historial formalmente desde el frontend.
 * Body:
 * - tipo: cobro|pago
 * - referencia_id
 * - monto
 * - metodoPago
 * - fecha
 * - nota
 * - asientoId / numeroAsiento (opcionales)
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

    const metodoPago = String(req.body?.metodoPago ?? req.body?.metodo_pago ?? "efectivo").trim();
    const fecha = req.body?.fecha ? new Date(req.body.fecha) : new Date();
    const nota = String(req.body?.nota ?? "").trim();

    const asientoIdRaw = req.body?.asientoId ?? req.body?.asiento_id ?? null;
    const asientoId = asientoIdRaw && mongoose.Types.ObjectId.isValid(String(asientoIdRaw))
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

    return res.status(201).json({ ok: true, data: doc.toJSON() });
  } catch (err) {
    console.error("POST /api/cobros-pagos/registrar error:", err);
    return res.status(500).json({ ok: false, message: "Error registrando historial" });
  }
});

module.exports = router;
