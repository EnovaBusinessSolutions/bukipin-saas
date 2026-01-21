// backend/models/Product.js
const mongoose = require("mongoose");

const productSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },

    nombre: { type: String, required: true, trim: true },
    descripcion: { type: String, default: "", trim: true },

    /**
     * ✅ Compat / legado:
     * Hoy tu app está usando `precio` como COSTO de compra unitario para inventario.
     * Lo mantenemos para no romper pantallas/flows existentes.
     */
    precio: { type: Number, default: 0 },

    /**
     * ✅ Inventario (nuevo):
     * - costoCompra: costo unitario de compra (siempre espejo de `precio` si no viene explícito)
     * - precioVenta: precio de venta sugerido/configurado
     * Incluimos snake_case para compat con pantallas legacy.
     */
    costoCompra: { type: Number, default: 0 },
    costo_compra: { type: Number, default: 0 },

    precioVenta: { type: Number, default: 0 },
    precio_venta: { type: Number, default: 0 },

    // contabilidad
    cuentaCodigo: { type: String, default: "4001" },
    subcuentaId: { type: mongoose.Schema.Types.ObjectId, ref: "Account", default: null },

    activo: { type: Boolean, default: true },
  },
  { timestamps: true }
);

productSchema.index({ owner: 1, nombre: 1 });

/**
 * ✅ Mantener compat camel/snake y evitar datos “perdidos”
 * - Si llega precioVenta pero no precio_venta (o viceversa), espejamos
 * - Si `precio` se usa como costo, lo espejamos a costoCompra/costo_compra
 */
productSchema.pre("save", function (next) {
  // ===== PRECIO VENTA (camel <-> snake) =====
  if (typeof this.precioVenta === "number" && (!this.precio_venta || this.precio_venta === 0)) {
    this.precio_venta = this.precioVenta;
  }
  if (typeof this.precio_venta === "number" && (!this.precioVenta || this.precioVenta === 0)) {
    this.precioVenta = this.precio_venta;
  }

  // ===== COSTO COMPRA (camel <-> snake) =====
  if (typeof this.costoCompra === "number" && (!this.costo_compra || this.costo_compra === 0)) {
    this.costo_compra = this.costoCompra;
  }
  if (typeof this.costo_compra === "number" && (!this.costoCompra || this.costoCompra === 0)) {
    this.costoCompra = this.costo_compra;
  }

  // ===== COMPAT: precio = costo compra =====
  if (typeof this.precio === "number" && (this.costoCompra === 0 || typeof this.costoCompra !== "number")) {
    this.costoCompra = this.precio;
  }
  if (typeof this.precio === "number" && (this.costo_compra === 0 || typeof this.costo_compra !== "number")) {
    this.costo_compra = this.precio;
  }

  next();
});

module.exports = mongoose.model("Product", productSchema);
