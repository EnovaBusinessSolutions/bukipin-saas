// backend/models/DepositoGarantiaMovimiento.js
const mongoose = require("mongoose");

const { Schema } = mongoose;

const depositoGarantiaMovimientoSchema = new Schema(
  {
    owner: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    deposito_id: {
      type: Schema.Types.ObjectId,
      ref: "DepositoGarantia",
      required: true,
      index: true,
    },

    // "nuevo"       = apertura de posición
    // "aumento"     = se incrementa el depósito existente
    // "disminucion" = devolución parcial
    // "devolucion"  = alias de disminucion (mismo flujo)
    // "liquidacion" = cierre total, saldo queda en 0
    tipo_movimiento: {
      type: String,
      enum: ["nuevo", "aumento", "disminucion", "devolucion", "liquidacion"],
      required: true,
    },

    monto: {
      type: Number,
      required: true,
      min: 0,
    },

    // Cómo se mueve el dinero
    metodo_pago: {
      type: String,
      enum: ["caja", "bancos"],
      default: "bancos",
    },

    fecha: {
      type: Date,
      default: Date.now,
    },

    referencia: {
      type: String,
      trim: true,
      default: "",
    },

    // Referencia al asiento contable generado
    journal_entry_id: {
      type: Schema.Types.ObjectId,
      ref: "JournalEntry",
      default: null,
    },
  },
  { timestamps: true }
);

depositoGarantiaMovimientoSchema.index({ owner: 1, deposito_id: 1 });
depositoGarantiaMovimientoSchema.index({ owner: 1, fecha: -1 });

module.exports =
  mongoose.models.DepositoGarantiaMovimiento ||
  mongoose.model("DepositoGarantiaMovimiento", depositoGarantiaMovimientoSchema);
