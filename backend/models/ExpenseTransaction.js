// backend/models/ExpenseTransaction.js
const mongoose = require("mongoose");

const ExpenseTransactionSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },

    productoId: { type: mongoose.Schema.Types.ObjectId, ref: "ExpenseProduct", required: true, index: true },
    tipo: { type: String, enum: ["costo", "gasto"], required: true, index: true },

    fecha: { type: Date, required: true, index: true },

    cantidad: { type: Number, default: 1 },
    precioUnitario: { type: Number, default: 0 },
    total: { type: Number, default: 0 },

    descripcion: { type: String, default: "", trim: true },
  },
  { timestamps: true }
);

ExpenseTransactionSchema.index({ owner: 1, productoId: 1, fecha: -1 });

module.exports = mongoose.model("ExpenseTransaction", ExpenseTransactionSchema);
