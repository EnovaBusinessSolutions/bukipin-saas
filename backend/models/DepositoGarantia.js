// backend/models/DepositoGarantia.js
const mongoose = require("mongoose");

const { Schema } = mongoose;

const depositoGarantiaSchema = new Schema(
  {
    owner: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // "recibido" = Pasivo (alguien nos dejó dinero, lo debemos regresar)
    // "realizado" = Activo (nosotros dimos dinero, nos lo tienen que regresar)
    tipo: {
      type: String,
      enum: ["recibido", "realizado"],
      required: true,
      index: true,
    },

    // Datos de la contraparte (deudor o acreedor)
    entidad_nombre: {
      type: String,
      required: true,
      trim: true,
    },
    entidad_rfc: {
      type: String,
      trim: true,
      default: "",
    },
    entidad_tipo: {
      type: String,
      enum: ["empresa", "persona"],
      default: "empresa",
    },

    // Saldo vigente (se actualiza con cada movimiento)
    saldo_actual: {
      type: Number,
      default: 0,
    },

    // Fecha del depósito inicial
    fecha_inicio: {
      type: Date,
      default: null,
    },

    referencia: {
      type: String,
      trim: true,
      default: "",
    },

    // "activo" mientras haya saldo pendiente, "liquidado" cuando saldo = 0
    estado: {
      type: String,
      enum: ["activo", "liquidado"],
      default: "activo",
      index: true,
    },
  },
  { timestamps: true }
);

depositoGarantiaSchema.index({ owner: 1, tipo: 1, estado: 1 });
depositoGarantiaSchema.index({ owner: 1, entidad_nombre: 1 });

module.exports =
  mongoose.models.DepositoGarantia ||
  mongoose.model("DepositoGarantia", depositoGarantiaSchema);
