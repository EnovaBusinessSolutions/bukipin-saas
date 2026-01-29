// backend/models/JournalEntry.js
const mongoose = require("mongoose");

function isObjectId(v) {
  return !!v && mongoose.Types.ObjectId.isValid(String(v));
}

function num(v, def = 0) {
  const n = Number(String(v ?? "").replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : def;
}

const journalLineSchema = new mongoose.Schema(
  {
    // =========================
    // ✅ Canonical
    // =========================
    accountCodigo: { type: String, default: "" }, // por código

    // ✅ Soportar guardar por ID de cuenta (algunas rutas pueden usarlo)
    accountId: { type: mongoose.Schema.Types.ObjectId, ref: "Account", default: null, index: true },

    // =========================
    // ✅ Compat: variantes
    // =========================
    accountCode: { type: String, default: "" },
    cuentaCodigo: { type: String, default: "" },
    cuenta_codigo: { type: String, default: "" },

    // =========================
    // ✅ Montos (canonical)
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
  {
    _id: false,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// =============================
// ✅ Virtuals de línea para compat UI
// (la UI suele leer cuenta_codigo / debe / haber)
// =============================
journalLineSchema.virtual("debe").get(function () {
  return Number(this.debit || 0) || 0;
});
journalLineSchema.virtual("haber").get(function () {
  return Number(this.credit || 0) || 0;
});
journalLineSchema.virtual("cuenta").get(function () {
  const c =
    (this.accountCodigo || this.accountCode || this.cuentaCodigo || this.cuenta_codigo || "")
      .toString()
      .trim();
  return c || null;
});
journalLineSchema.virtual("cuenta_codigo").get(function () {
  return this.cuenta || null;
});
journalLineSchema.virtual("cuentaCodigo").get(function () {
  return this.cuenta || null;
});

const journalEntrySchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },

    // ✅ Canonical
    date: { type: Date, default: Date.now, index: true, alias: "fecha" },

    // ✅ Canonical
    concept: { type: String, default: "", trim: true, alias: "descripcion" },

    /**
     * ✅ IMPORTANTÍSIMO:
     * No usar default: null aquí
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

    // Canonical storage
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

        // mantenemos compat (muchas pantallas usan esto)
        // detalle_asientos y detalles se generan como virtuals abajo

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

/**
 * ✅ CRÍTICO: Virtuals que tu UI espera:
 * - detalle_asientos: [{ cuenta_codigo, cuenta_nombre, debe, haber, memo }]
 * - detalles: [{ cuenta_codigo, cuenta_nombre, descripcion, debe, haber }]
 *
 * OJO: cuenta_nombre aquí va null (porque resolverlo requiere lookup).
 * Tus rutas (como /api/contabilidad/asientos) pueden enriquecerlo con Account,
 * pero este virtual evita que el panel se “rompa” si no lo enriquecen.
 */
journalEntrySchema.virtual("detalle_asientos").get(function () {
  const lines = Array.isArray(this.lines) ? this.lines : [];
  return lines.map((l) => {
    const code =
      (l?.accountCodigo || l?.accountCode || l?.cuentaCodigo || l?.cuenta_codigo || "")
        .toString()
        .trim() || null;

    return {
      cuenta_codigo: code,
      cuenta_nombre: null,
      debe: Number(l?.debit || 0) || 0,
      haber: Number(l?.credit || 0) || 0,
      memo: (l?.memo || l?.descripcion || "").toString(),
    };
  });
});

journalEntrySchema.virtual("detalles").get(function () {
  const det = this.detalle_asientos || [];
  return det.map((d) => ({
    cuenta_codigo: d.cuenta_codigo,
    cuenta_nombre: d.cuenta_nombre,
    descripcion: d.memo || "",
    debe: d.debe,
    haber: d.haber,
  }));
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

    // ✅ normalizar líneas (BLINDAJE TOTAL)
    if (Array.isArray(entry.lines)) {
      entry.lines = entry.lines.map((l) => {
        const line = l || {};

        // 0) normalizar memo
        if (!line.memo && line.descripcion) line.memo = String(line.descripcion || "");
        if (typeof line.memo === "string") line.memo = line.memo.trim();

        // 1) accountId válido o null
        if (line.accountId && !isObjectId(line.accountId)) line.accountId = null;

        // 2) tomar code de cualquier alias
        const codeCandidate = String(
          line.accountCodigo || line.accountCode || line.cuentaCodigo || line.cuenta_codigo || ""
        ).trim();

        // si no hay code y tampoco accountId -> esto es basura (evitamos guardar y luego “se rompe” UI)
        if (!codeCandidate && !line.accountId) {
          const err = new Error("JournalEntry.lines: cada línea debe tener accountCodigo (o accountId).");
          err.statusCode = 400;
          throw err;
        }

        // 3) normalizar y espejar códigos (compat)
        if (codeCandidate) {
          line.accountCodigo = codeCandidate;
          if (!line.accountCode) line.accountCode = codeCandidate;
          if (!line.cuentaCodigo) line.cuentaCodigo = codeCandidate;
          if (!line.cuenta_codigo) line.cuenta_codigo = codeCandidate;
        } else {
          // si no hay codeCandidate pero sí accountId, al menos limpiamos strings
          if (line.accountCodigo) line.accountCodigo = String(line.accountCodigo || "").trim();
          if (line.accountCode) line.accountCode = String(line.accountCode || "").trim();
          if (line.cuentaCodigo) line.cuentaCodigo = String(line.cuentaCodigo || "").trim();
          if (line.cuenta_codigo) line.cuenta_codigo = String(line.cuenta_codigo || "").trim();
        }

        // 4) normalizar montos (acepta variantes "debe/haber" aunque no estén en schema)
        const debit = num(line.debit ?? line.debe, 0);
        const credit = num(line.credit ?? line.haber, 0);

        line.debit = debit;
        line.credit = credit;

        // 5) side+monto -> debit/credit si no existen
        const side = String(line.side || "").toLowerCase().trim();
        const monto = num(line.monto, 0);

        const hasDebitCredit = (Number(line.debit || 0) !== 0) || (Number(line.credit || 0) !== 0);

        if (!hasDebitCredit && monto > 0 && (side === "debit" || side === "credit")) {
          if (side === "debit") {
            line.debit = monto;
            line.credit = 0;
          } else {
            line.credit = monto;
            line.debit = 0;
          }
        }

        // 6) compat inversa: side/monto desde debit/credit
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

/**
 * ✅ CRÍTICO: Índice ÚNICO PARCIAL
 * Solo aplica si numeroAsiento es string y no vacío.
 */
journalEntrySchema.index(
  { owner: 1, numeroAsiento: 1 },
  {
    unique: true,
    partialFilterExpression: {
      numeroAsiento: { $type: "string", $ne: "" },
    },
  }
);

module.exports = mongoose.model("JournalEntry", journalEntrySchema);
