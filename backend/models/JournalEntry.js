// backend/models/JournalEntry.js
const mongoose = require("mongoose");

function isObjectId(v) {
  return !!v && mongoose.Types.ObjectId.isValid(String(v));
}

const journalLineSchema = new mongoose.Schema(
  {
    // =========================
    // ✅ Canonical actual (MVP)
    // =========================
    accountCodigo: { type: String, default: "" }, // MVP por código

    // =========================
    // ✅ Soportar guardar por ID de cuenta
    // =========================
    accountId: { type: mongoose.Schema.Types.ObjectId, ref: "Account", default: null, index: true },

    // =========================
    // ✅ Compat: variantes
    // =========================
    accountCode: { type: String, default: "" },
    cuentaCodigo: { type: String, default: "" },
    cuenta_codigo: { type: String, default: "" },

    // =========================
    // ✅ Montos
    // =========================
    debit: { type: Number, default: 0 },
    credit: { type: Number, default: 0 },

    // =========================
    // ✅ Compat: side + monto
    // =========================
    side: { type: String, enum: ["debit", "credit", ""], default: "" },
    monto: { type: Number, default: 0 },

    // =========================
    // ✅ Texto
    // =========================
    memo: { type: String, default: "" },
    descripcion: { type: String, default: "" },
  },
  { _id: false }
);

const journalEntrySchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },

    // ✅ Canonical
    date: { type: Date, default: Date.now, index: true, alias: "fecha" },

    // ✅ Canonical
    concept: { type: String, default: "", trim: true, alias: "descripcion" },

    /**
     * ✅ IMPORTANTÍSIMO:
     * No usar default: null aquí, porque con índice sparse/unique o parcial,
     * si se guarda explícitamente null puede causar duplicados.
     * Lo dejamos como undefined por defecto.
     */
    numeroAsiento: { type: String, default: undefined, index: true, alias: "numero_asiento" },

    source: { type: String, default: "", index: true },

    sourceId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },

    referencia: { type: String, default: "", trim: true, index: true },

    // ==========================================================
    // ✅ COMPAT
    // ==========================================================
    transaccionId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
    source_id: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },

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
// ✅ Virtuals útiles para UI
// =============================
journalEntrySchema.virtual("fecha").get(function () {
  return this.date;
});

journalEntrySchema.virtual("descripcion").get(function () {
  return this.concept;
});

journalEntrySchema.virtual("numero_asiento").get(function () {
  return this.numeroAsiento;
});

journalEntrySchema.virtual("total_debe").get(function () {
  const lines = Array.isArray(this.lines) ? this.lines : [];
  return lines.reduce((acc, l) => acc + (Number(l?.debit || 0) || 0), 0);
});

journalEntrySchema.virtual("total_haber").get(function () {
  const lines = Array.isArray(this.lines) ? this.lines : [];
  return lines.reduce((acc, l) => acc + (Number(l?.credit || 0) || 0), 0);
});

// =============================
// ✅ Normalizaciones automáticas
// =============================
journalEntrySchema.pre("validate", function (next) {
  try {
    const entry = this;

    // ✅ compat: espejar sourceId
    if (!entry.sourceId && entry.transaccionId) entry.sourceId = entry.transaccionId;
    if (!entry.sourceId && entry.source_id) entry.sourceId = entry.source_id;

    if (entry.sourceId) {
      if (!entry.transaccionId) entry.transaccionId = entry.sourceId;
      if (!entry.source_id) entry.source_id = entry.sourceId;
    }

    // ✅ normalizar strings principales
    if (typeof entry.concept === "string") entry.concept = entry.concept.trim();
    if (typeof entry.referencia === "string") entry.referencia = entry.referencia.trim();

    // ✅ numeroAsiento: si viene null/"" => eliminarlo (undefined)
    if (entry.numeroAsiento === null) entry.numeroAsiento = undefined;
    if (typeof entry.numeroAsiento === "string") {
      const v = entry.numeroAsiento.trim();
      entry.numeroAsiento = v ? v : undefined;
    }

    // ✅ normalizar líneas
    if (Array.isArray(entry.lines)) {
      entry.lines = entry.lines.map((l) => {
        const line = l || {};

        // 1) asegurar memo
        if (!line.memo && line.descripcion) line.memo = String(line.descripcion || "");

        // 2) normalizar accountId
        if (line.accountId && !isObjectId(line.accountId)) {
          // si llegó basura, limpiarlo
          line.accountId = null;
        }

        // 3) normalizar código:
        //    - si existe accountId válido, NO forzamos accountCodigo
        //    - si NO existe accountId, aseguramos accountCodigo desde aliases
        if (!line.accountId) {
          const current = String(line.accountCodigo || "").trim();
          if (!current) {
            const candidate = line.accountCode || line.cuentaCodigo || line.cuenta_codigo || "";
            if (candidate) line.accountCodigo = String(candidate).trim();
          } else {
            line.accountCodigo = current;
          }
        } else {
          // si trae accountId, al menos limpiamos el string si existe
          if (line.accountCodigo) line.accountCodigo = String(line.accountCodigo || "").trim();
        }

        // 4) side+monto -> debit/credit si no existen
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

        // 5) compat inversa
        if (!line.side) {
          if (Number(line.debit || 0) > 0) line.side = "debit";
          else if (Number(line.credit || 0) > 0) line.side = "credit";
        }
        if (!line.monto) {
          line.monto =
            Number(line.debit || 0) > 0 ? Number(line.debit || 0) : Number(line.credit || 0) || 0;
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

/**
 * ✅ CRÍTICO: Índice ÚNICO PARCIAL (en vez de sparse con null)
 * Solo aplica si numeroAsiento es string y no vacío.
 */
journalEntrySchema.index(
  { owner: 1, numeroAsiento: 1 },
  {
    unique: true,
    partialFilterExpression: {
      numeroAsiento: { $type: "string" },
    },
  }
);

module.exports = mongoose.model("JournalEntry", journalEntrySchema);
