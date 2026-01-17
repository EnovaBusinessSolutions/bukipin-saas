// backend/models/ExpenseProduct.js
const mongoose = require("mongoose");

const ExpenseProductSchema = new mongoose.Schema(
  {
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    nombre: { type: String, required: true, trim: true },
    tipo: { type: String, enum: ["costo", "gasto"], required: true, index: true },

    descripcion: { type: String, default: "", trim: true },

    /**
     * ✅ Catálogo (E2E con UI)
     * Estos campos son los que el frontend muestra y el backend ya intenta guardar.
     */
    unidad: { type: String, default: "", trim: true }, // ej. "kg", "piezas", "servicios"
    proveedor_principal: { type: String, default: "", trim: true },
    es_recurrente: { type: Boolean, default: false },

    /**
     * ✅ Imagen (opcional)
     * Guardamos URL pública relativa: /uploads/egresos/archivo.jpg
     */
    imagen_url: { type: String, default: null, trim: true },

    /**
     * ✅ Contabilidad
     * - cuentaCodigo ya existe y lo dejamos por compat (tu backend lo usa).
     * - cuenta_contable es el nombre snake_case que tu UI/hooks usan.
     *
     * Nota: puedes usar solo uno, pero mantener ambos evita romper código legacy.
     */
    cuentaCodigo: { type: String, default: "", trim: true },       // legacy/camel
    cuenta_contable: { type: String, default: "", trim: true },    // snake_case (UI)

    /**
     * ✅ Subcuenta
     * - subcuentaId ya existe y lo dejamos.
     * - subcuenta_id es el nombre snake_case que UI/hooks usan.
     */
    subcuentaId: { type: mongoose.Schema.Types.ObjectId, ref: "Account", default: null },
    subcuenta_id: { type: mongoose.Schema.Types.ObjectId, ref: "Account", default: null },

    activo: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

ExpenseProductSchema.index({ owner: 1, tipo: 1, nombre: 1 });

/**
 * ✅ Mantener consistencia entre campos duplicados (compat)
 * Si se setea uno, espejamos al otro.
 */
ExpenseProductSchema.pre("save", function (next) {
  // cuenta
  if (!this.cuenta_contable && this.cuentaCodigo) this.cuenta_contable = this.cuentaCodigo;
  if (!this.cuentaCodigo && this.cuenta_contable) this.cuentaCodigo = this.cuenta_contable;

  // subcuenta
  if (!this.subcuenta_id && this.subcuentaId) this.subcuenta_id = this.subcuentaId;
  if (!this.subcuentaId && this.subcuenta_id) this.subcuentaId = this.subcuenta_id;

  next();
});

module.exports = mongoose.model("ExpenseProduct", ExpenseProductSchema);
