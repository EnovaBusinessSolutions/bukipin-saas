// backend/models/JournalEntry.js
const mongoose = require("mongoose");

const journalLineSchema = new mongoose.Schema(
  {
    // =========================
    // ✅ Canonical actual (MVP)
    // =========================
    accountCodigo: { type: String, default: "" }, // MVP por código

    // =========================
    // ✅ NUEVO: soportar guardar por ID de cuenta
    // (si viene accountId, lo resolvemos en /api/asientos)
    // =========================
    accountId: { type: mongoose.Schema.Types.ObjectId, ref: "Account", default: null, index: true },

    // =========================
    // ✅ Compat: variantes de nombre de campo (NO rompen nada)
    // =========================
    accountCode: { type: String, default: "" },     // alias común
    cuentaCodigo: { type: String, default: "" },    // legacy/compat
    cuenta_codigo: { type: String, default: "" },   // legacy/compat

    // =========================
    // ✅ Montos (canonical)
    // =========================
    debit: { type: Number, default: 0 },
    credit: { type: Number, default: 0 },

    // =========================
    // ✅ Compat nuevo: side + monto
    // (egresos/pagos a veces guardan así)
    // =========================
    side: { type: String, enum: ["debit", "credit", ""], default: "" },
    monto: { type: Number, default: 0 },

    // =========================
    // ✅ Texto
    // =========================
    memo: { type: String, default: "" },
    descripcion: { type: String, default: "" }, // compat (algunas rutas mandan descripcion)
  },
  { _id: false }
);

const journalEntrySchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },

    date: { type: Date, default: Date.now, index: true },
    concept: { type: String, default: "", trim: true },

    // ✅ Canonical
    numeroAsiento: { type: String, default: null, index: true },

    // ✅ fuente
    source: { type: String, default: "", index: true }, // ingreso, egreso, pago_cxp, etc.

    // ✅ canonical para ligar transacción
    sourceId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },

    // ==========================================================
    // ✅ COMPAT (MUY útil para búsquedas legacy / futuras)
    // ==========================================================
    transaccionId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true }, // alias
    source_id: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },     // alias

    // referencias genéricas: [{source:"egreso", id:"...", numero:"..."}]
    references: {
      type: [
        {
          source: { type: String, default: "", trim: true },
          id: { type: String, default: "", trim: true },
          numero: { type: String, default: "", trim: true },
        },
      ],
      default: [],
    },

    // ✅ líneas
    lines: { type: [journalLineSchema], default: [] },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform: (_doc, ret) => {
        ret.id = String(ret._id);
        ret.created_at = ret.createdAt ? new Date(ret.createdAt).toISOString() : null;
        ret.updated_at = ret.updatedAt ? new Date(ret.updatedAt).toISOString() : null;

        ret.user_id = ret.owner ? String(ret.owner) : null;

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

// =============================
// ✅ Normalizaciones automáticas
// =============================
journalEntrySchema.pre("validate", function (next) {
  try {
    const entry = this;

    // ✅ compat: si usaron otro campo para sourceId, lo espejamos
    if (!entry.sourceId && entry.transaccionId) entry.sourceId = entry.transaccionId;
    if (!entry.sourceId && entry.source_id) entry.sourceId = entry.source_id;

    // ✅ normalizar líneas
    if (Array.isArray(entry.lines)) {
      entry.lines = entry.lines.map((l) => {
        const line = l || {};

        // 1) asegurar memo (si viene descripcion)
        if (!line.memo && line.descripcion) line.memo = String(line.descripcion || "");

        // 2) normalizar código: si no viene accountCodigo pero sí aliases
        if (!line.accountCodigo) {
          const candidate =
            line.accountCode ||
            line.cuentaCodigo ||
            line.cuenta_codigo ||
            "";

          if (candidate) line.accountCodigo = String(candidate).trim();
        } else {
          line.accountCodigo = String(line.accountCodigo || "").trim();
        }

        // 3) si viene side+monto, calcular debit/credit cuando no vengan
        const side = String(line.side || "").toLowerCase().trim();
        const monto = Number(line.monto || 0) || 0;

        const hasDebitCredit =
          Number(line.debit || 0) !== 0 || Number(line.credit || 0) !== 0;

        if (!hasDebitCredit && monto > 0 && (side === "debit" || side === "credit")) {
          if (side === "debit") {
            line.debit = monto;
            line.credit = 0;
          } else {
            line.credit = monto;
            line.debit = 0;
          }
        }

        // 4) si vienen debit/credit pero no side/monto, rellenar compat
        if (!line.side) {
          if (Number(line.debit || 0) > 0) line.side = "debit";
          else if (Number(line.credit || 0) > 0) line.side = "credit";
        }
        if (!line.monto) {
          line.monto = Number(line.debit || 0) > 0 ? Number(line.debit || 0) : Number(line.credit || 0) || 0;
        }

        return line;
      });
    }

    next();
  } catch (e) {
    next(e);
  }
});

// =============================
// ✅ Índices recomendados
// =============================
journalEntrySchema.index({ owner: 1, date: -1 });
journalEntrySchema.index({ owner: 1, source: 1, date: -1 });
journalEntrySchema.index({ owner: 1, source: 1, sourceId: 1 });
journalEntrySchema.index({ owner: 1, transaccionId: 1 });
journalEntrySchema.index({ owner: 1, source_id: 1 });
journalEntrySchema.index({ owner: 1, numeroAsiento: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model("JournalEntry", journalEntrySchema);
