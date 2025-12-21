const mongoose = require("mongoose");

const incomeTransactionSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },

    fecha: { type: Date, default: Date.now, index: true },

    tipoIngreso: { type: String, default: "general" }, // precargados | inventariados | general | otros
    descripcion: { type: String, default: "Ingreso", trim: true },

    montoTotal: { type: Number, default: 0 },
    montoDescuento: { type: Number, default: 0 },
    montoNeto: { type: Number, default: 0 },

    metodoPago: { type: String, default: "efectivo" }, // efectivo | bancos
    tipoPago: { type: String, default: "contado" }, // contado | parcial | credito
    montoPagado: { type: Number, default: 0 },

    cuentaCodigo: { type: String, default: "4001" },
    subcuentaId: { type: mongoose.Schema.Types.ObjectId, ref: "Account", default: null },

    clienteId: { type: mongoose.Schema.Types.ObjectId, ref: "Client", default: null },
  },
  { timestamps: true }
);

incomeTransactionSchema.index({ owner: 1, fecha: -1 });

module.exports = mongoose.model("IncomeTransaction", incomeTransactionSchema);
