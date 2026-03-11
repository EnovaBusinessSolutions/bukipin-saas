// backend/models/FinancingMovement.js
const mongoose = require("mongoose");

const { Schema } = mongoose;

function num(v, def = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

const financingMovementSchema = new Schema(
  {
    owner: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    financingId: {
      type: Schema.Types.ObjectId,
      ref: "Financing",
      required: true,
      index: true,
    },

    // Tipo de movimiento del panel
    tipo: {
      type: String,
      required: true,
      trim: true,
      enum: [
        "apertura",
        "disposicion",
        "amortizacion",
        "cargo_intereses",
        "pago_intereses",
        "cargo_comision",
        "pago_comision",
        "cargo_moratorio",
        "ajuste",
        "cancelacion",
        "refinanciamiento",
        "otro",
      ],
      index: true,
    },

    subtipo: {
      type: String,
      trim: true,
      default: "",
    },

    estatus: {
      type: String,
      trim: true,
      enum: ["aplicado", "pendiente", "cancelado"],
      default: "aplicado",
      index: true,
    },

    fecha: {
      type: Date,
      required: true,
      index: true,
    },

    // Monto principal del movimiento
    monto: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },

    moneda: {
      type: String,
      trim: true,
      default: "MXN",
      uppercase: true,
    },
    tipo_cambio: {
      type: Number,
      default: 1,
      min: 0,
    },

    // Desglose contable/financiero del movimiento
    monto_capital: {
      type: Number,
      default: 0,
      min: 0,
    },
    monto_intereses: {
      type: Number,
      default: 0,
      min: 0,
    },
    monto_moratorios: {
      type: Number,
      default: 0,
      min: 0,
    },
    monto_comisiones: {
      type: Number,
      default: 0,
      min: 0,
    },
    monto_iva: {
      type: Number,
      default: 0,
      min: 0,
    },

    // Método / canal
    metodo_pago: {
      type: String,
      trim: true,
      default: "",
    },
    cuenta_destino: {
      type: String,
      trim: true,
      default: "",
    },
    referencia: {
      type: String,
      trim: true,
      default: "",
      index: true,
    },

    // Contrapartes
    beneficiario: {
      type: String,
      trim: true,
      default: "",
    },
    institucion: {
      type: String,
      trim: true,
      default: "",
    },

    // Relación contable
    journalEntryId: {
      type: Schema.Types.ObjectId,
      ref: "JournalEntry",
      default: null,
      index: true,
    },
    source: {
      type: String,
      trim: true,
      default: "financiamiento",
      index: true,
    },
    sourceId: {
      type: Schema.Types.ObjectId,
      default: null,
      index: true,
    },

    // Snapshot posterior al movimiento
    snapshot_after: {
      saldo_dispuesto_actual: { type: Number, default: 0, min: 0 },
      saldo_capital_actual: { type: Number, default: 0, min: 0 },
      saldo_intereses_actual: { type: Number, default: 0, min: 0 },
      saldo_moratorios_actual: { type: Number, default: 0, min: 0 },
      saldo_comisiones_actual: { type: Number, default: 0, min: 0 },
      saldo_total_actual: { type: Number, default: 0, min: 0 },
      disponible_actual: { type: Number, default: 0, min: 0 },
    },

    descripcion: {
      type: String,
      trim: true,
      default: "",
    },
    notas: {
      type: String,
      trim: true,
      default: "",
    },

    // Para UI / filtros / compat
    tags: {
      type: [String],
      default: [],
    },
    meta: {
      type: Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
    minimize: false,
  }
);

financingMovementSchema.index({ owner: 1, financingId: 1, fecha: -1 });
financingMovementSchema.index({ owner: 1, tipo: 1, fecha: -1 });
financingMovementSchema.index({ financingId: 1, createdAt: -1 });
financingMovementSchema.index({ journalEntryId: 1 });
financingMovementSchema.index({ source: 1, sourceId: 1 });

financingMovementSchema.pre("validate", function (next) {
  this.monto = Math.max(0, num(this.monto, 0));
  this.monto_capital = Math.max(0, num(this.monto_capital, 0));
  this.monto_intereses = Math.max(0, num(this.monto_intereses, 0));
  this.monto_moratorios = Math.max(0, num(this.monto_moratorios, 0));
  this.monto_comisiones = Math.max(0, num(this.monto_comisiones, 0));
  this.monto_iva = Math.max(0, num(this.monto_iva, 0));

  if (!this.fecha) this.fecha = new Date();

  const snap = this.snapshot_after || {};
  snap.saldo_dispuesto_actual = Math.max(0, num(snap.saldo_dispuesto_actual, 0));
  snap.saldo_capital_actual = Math.max(0, num(snap.saldo_capital_actual, 0));
  snap.saldo_intereses_actual = Math.max(0, num(snap.saldo_intereses_actual, 0));
  snap.saldo_moratorios_actual = Math.max(0, num(snap.saldo_moratorios_actual, 0));
  snap.saldo_comisiones_actual = Math.max(0, num(snap.saldo_comisiones_actual, 0));

  snap.saldo_total_actual =
    Math.max(0, num(snap.saldo_capital_actual, 0)) +
    Math.max(0, num(snap.saldo_intereses_actual, 0)) +
    Math.max(0, num(snap.saldo_moratorios_actual, 0)) +
    Math.max(0, num(snap.saldo_comisiones_actual, 0));

  snap.disponible_actual = Math.max(0, num(snap.disponible_actual, 0));

  this.snapshot_after = snap;

  next();
});

module.exports =
  mongoose.models.FinancingMovement ||
  mongoose.model("FinancingMovement", financingMovementSchema);