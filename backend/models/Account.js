// backend/models/Account.js
const mongoose = require("mongoose");

const accountSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },

    code: { type: String, required: true, trim: true },        // "4001"
    name: { type: String, required: true, trim: true },        // "Ventas"
    category: { type: String, trim: true, default: "general" },// opcional
    type: { type: String, enum: ["activo", "pasivo", "capital", "ingreso", "gasto", "orden"], required: true },

    parentCode: { type: String, trim: true, default: null },   // para subcuentas si quieres
    isDefault: { type: Boolean, default: true },               // sembradas por sistema
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// Un mismo usuario NO puede tener el mismo code duplicado
accountSchema.index({ owner: 1, code: 1 }, { unique: true });

module.exports = mongoose.model("Account", accountSchema);
