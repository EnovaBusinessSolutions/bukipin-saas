const mongoose = require("mongoose");

const productSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },

    nombre: { type: String, required: true, trim: true },
    descripcion: { type: String, default: "", trim: true },

    precio: { type: Number, default: 0 },

    // contabilidad
    cuentaCodigo: { type: String, default: "4001" },
    subcuentaId: { type: mongoose.Schema.Types.ObjectId, ref: "Account", default: null },

    activo: { type: Boolean, default: true },
  },
  { timestamps: true }
);

productSchema.index({ owner: 1, nombre: 1 });

module.exports = mongoose.model("Product", productSchema);
