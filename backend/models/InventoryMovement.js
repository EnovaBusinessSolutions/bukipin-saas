const mongoose = require("mongoose");

const inventoryMovementSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },

    fecha: { type: Date, default: Date.now, index: true },
    tipo: { type: String, default: "venta" }, // venta | compra | ajuste

    productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product", default: null },

    qty: { type: Number, default: 0 },
    unitCost: { type: Number, default: 0 },
    total: { type: Number, default: 0 },

    nota: { type: String, default: "" },
    source: { type: String, default: "" },
    sourceId: { type: mongoose.Schema.Types.ObjectId, default: null },
  },
  { timestamps: true }
);

inventoryMovementSchema.index({ owner: 1, fecha: -1 });

module.exports = mongoose.model("InventoryMovement", inventoryMovementSchema);
