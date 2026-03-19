// backend/models/CapitalTransaction.js
const mongoose = require("mongoose");

function asTrim(v, def = "") {
  if (v === undefined || v === null) return def;
  return String(v).trim();
}

function toNum(v, def = 0) {
  const n = Number(String(v ?? "").replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : def;
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

const capitalTransactionSchema = new mongoose.Schema(
  {
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    tipo_movimiento: {
      type: String,
      enum: ["aportacion", "dividendo"],
      required: true,
      index: true,
    },

    fecha: {
      type: Date,
      required: true,
      index: true,
    },

    monto: {
      type: Number,
      required: true,
      min: 0,
    },

    socio: {
      type: String,
      required: true,
      trim: true,
      default: "",
    },

    accionista_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Shareholder",
      default: null,
      index: true,
    },

    descripcion: {
      type: String,
      default: null,
      trim: true,
    },

    estado: {
      type: String,
      enum: ["activo", "cancelado"],
      default: "activo",
      index: true,
    },

    fecha_cancelacion: {
      type: Date,
      default: null,
    },

    motivo_cancelacion: {
      type: String,
      default: null,
      trim: true,
    },

    transaccion_cancelacion_id: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      index: true,
    },

    journalEntryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "JournalEntry",
      default: null,
      index: true,
    },

    reversalJournalEntryId: {
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
        ret.user_id = ret.owner ? String(ret.owner) : "";

        ret.tipo_movimiento = asTrim(ret.tipo_movimiento, "");
        ret.fecha = toYMD(ret.fecha);
        ret.monto = toNum(ret.monto, 0);
        ret.socio = asTrim(ret.socio, "");
        ret.accionista_id = ret.accionista_id ? String(ret.accionista_id) : null;
        ret.descripcion = ret.descripcion != null ? asTrim(ret.descripcion, "") : null;
        ret.estado = asTrim(ret.estado, "activo");

        ret.fecha_cancelacion = ret.fecha_cancelacion ? toYMD(ret.fecha_cancelacion) : null;
        ret.motivo_cancelacion =
          ret.motivo_cancelacion != null ? asTrim(ret.motivo_cancelacion, "") : null;

        ret.transaccion_cancelacion_id = ret.transaccion_cancelacion_id
          ? String(ret.transaccion_cancelacion_id)
          : null;

        ret.journalEntryId = ret.journalEntryId ? String(ret.journalEntryId) : null;
        ret.reversalJournalEntryId = ret.reversalJournalEntryId
          ? String(ret.reversalJournalEntryId)
          : null;

        ret.created_at = ret.createdAt ? new Date(ret.createdAt).toISOString() : null;
        ret.updated_at = ret.updatedAt ? new Date(ret.updatedAt).toISOString() : null;

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

capitalTransactionSchema.index({ owner: 1, fecha: -1 });
capitalTransactionSchema.index({ owner: 1, tipo_movimiento: 1, fecha: -1 });
capitalTransactionSchema.index({ owner: 1, accionista_id: 1, fecha: -1 });
capitalTransactionSchema.index({ owner: 1, estado: 1, fecha: -1 });

module.exports = mongoose.model("CapitalTransaction", capitalTransactionSchema);