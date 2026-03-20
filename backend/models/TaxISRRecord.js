// backend/models/TaxISRRecord.js
const mongoose = require("mongoose");

function num(v, def = 0) {
  const n = Number(String(v ?? "").replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : def;
}

function asTrim(v, def = "") {
  if (v === undefined || v === null) return def;
  return String(v).trim();
}

function toYMD(v) {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const taxISRRecordSchema = new mongoose.Schema(
  {
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    mes: { type: Number, required: true, min: 1, max: 12, index: true },
    ano: { type: Number, required: true, min: 2000, max: 9999, index: true },

    utilidadAntesImpuestos: { type: Number, default: 0 },
    tasaISR: { type: Number, default: 30 },
    isrCalculado: { type: Number, default: 0 },
    isrRealTotal: { type: Number, default: 0 },

    tipoPago: {
      type: String,
      enum: ["total", "parcial", "credito"],
      required: true,
      index: true,
    },

    metodoPago: {
      type: String,
      enum: ["transferencia", "efectivo", ""],
      default: "",
    },

    montoPagado: { type: Number, default: 0 },
    saldoPendiente: { type: Number, default: 0 },

    fechaVencimiento: { type: Date, default: null },

    autoridadId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TaxAuthority",
      required: true,
      index: true,
    },
    autoridadNombreSnapshot: { type: String, default: "", trim: true },

    observaciones: { type: String, default: "", trim: true },

    pagoIndex: { type: Number, default: 1 },

    estado: {
      type: String,
      enum: ["pagado", "parcial", "pendiente"],
      default: "pendiente",
      index: true,
    },

    journalEntryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "JournalEntry",
      default: null,
      index: true,
    },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform: (_doc, ret) => {
        ret.id = String(ret._id);

        ret.utilidad_antes_impuestos = num(ret.utilidadAntesImpuestos, 0);
        ret.tasa_isr = num(ret.tasaISR, 0);
        ret.isr_calculado = num(ret.isrCalculado, 0);
        ret.isr_real = num(ret.isrRealTotal, 0);
        ret.isr_real_total = num(ret.isrRealTotal, 0);

        ret.tipo_pago = ret.tipoPago || "";
        ret.metodo_pago = ret.metodoPago || null;
        ret.monto_pagado = num(ret.montoPagado, 0);
        ret.monto_pendiente = num(ret.saldoPendiente, 0);
        ret.saldo_pendiente = num(ret.saldoPendiente, 0);

        ret.fecha_vencimiento = ret.fechaVencimiento ? toYMD(ret.fechaVencimiento) : null;
        ret.autoridad_id = ret.autoridadId ? String(ret.autoridadId) : null;
        ret.autoridad_nombre = ret.autoridadNombreSnapshot || "";
        ret.pago_index = num(ret.pagoIndex, 1);

        ret.created_at = ret.createdAt ? new Date(ret.createdAt).toISOString() : null;
        ret.updated_at = ret.updatedAt ? new Date(ret.updatedAt).toISOString() : null;

        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
    toObject: { virtuals: true },
  }
);

taxISRRecordSchema.pre("validate", function (next) {
  try {
    this.mes = num(this.mes, 0);
    this.ano = num(this.ano, 0);

    this.utilidadAntesImpuestos = num(this.utilidadAntesImpuestos, 0);
    this.tasaISR = num(this.tasaISR, 0);
    this.isrCalculado = num(this.isrCalculado, 0);
    this.isrRealTotal = Math.max(0, num(this.isrRealTotal, 0));

    this.tipoPago = asTrim(this.tipoPago).toLowerCase();
    this.metodoPago = asTrim(this.metodoPago).toLowerCase();

    this.montoPagado = Math.max(0, num(this.montoPagado, 0));
    this.saldoPendiente = Math.max(0, num(this.saldoPendiente, 0));

    this.autoridadNombreSnapshot = asTrim(this.autoridadNombreSnapshot);
    this.observaciones = asTrim(this.observaciones);

    this.pagoIndex = Math.max(1, Math.trunc(num(this.pagoIndex, 1)));

    if (this.tipoPago === "total") {
      this.montoPagado = this.isrRealTotal;
      this.saldoPendiente = 0;
      this.estado = "pagado";
    } else if (this.tipoPago === "parcial") {
      this.saldoPendiente = Math.max(0, this.isrRealTotal - this.montoPagado);
      this.estado = this.saldoPendiente > 0 ? "parcial" : "pagado";
    } else if (this.tipoPago === "credito") {
      this.montoPagado = 0;
      this.saldoPendiente = this.isrRealTotal;
      this.estado = this.isrRealTotal > 0 ? "pendiente" : "pagado";
    }

    if (this.tipoPago === "credito") {
      this.metodoPago = "";
    }

    next();
  } catch (err) {
    next(err);
  }
});

taxISRRecordSchema.index({ owner: 1, ano: -1, mes: -1, createdAt: -1 });
taxISRRecordSchema.index({ owner: 1, autoridadId: 1, ano: -1, mes: -1 });

module.exports = mongoose.model("TaxISRRecord", taxISRRecordSchema);