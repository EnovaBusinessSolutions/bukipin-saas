// backend/models/ExpenseProduct.js
const mongoose = require("mongoose");

const ExpenseProductSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },

    nombre: { type: String, required: true, trim: true },
    tipo: { type: String, enum: ["costo", "gasto"], required: true, index: true },

    descripcion: { type: String, default: "", trim: true },

    // contabilidad
    cuentaCodigo: { type: String, default: "", trim: true },
    subcuentaId: { type: mongoose.Schema.Types.ObjectId, ref: "Account", default: null },

    activo: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

ExpenseProductSchema.index({ owner: 1, tipo: 1, nombre: 1 });

module.exports = mongoose.model("ExpenseProduct", ExpenseProductSchema);
