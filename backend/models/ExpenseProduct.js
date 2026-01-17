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
     */
    unidad: { type: String, default: "", trim: true }, // ej. "kg", "piezas", "servicios"
    proveedor_principal: { type: String, default: "", trim: true },
    es_recurrente: { type: Boolean, default: false },

    /**
     * ✅ Imagen (opcional)
     */
    imagen_url: { type: String, default: null, trim: true },

    /**
     * ✅ Contabilidad (compat camel + snake)
     */
    cuentaCodigo: { type: String, default: "", trim: true }, // legacy/camel
    cuenta_contable: { type: String, default: "", trim: true }, // snake_case (UI)

    /**
     * ✅ Subcuenta (compat camel + snake)
     */
    subcuentaId: { type: mongoose.Schema.Types.ObjectId, ref: "Account", default: null },
    subcuenta_id: { type: mongoose.Schema.Types.ObjectId, ref: "Account", default: null },

    activo: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

// ✅ Índices (catálogo típico: owner + tipo + activo + nombre)
ExpenseProductSchema.index({ owner: 1, tipo: 1, activo: 1, nombre: 1 });

// ✅ Helper interno para espejar campos
function mirrorCompat(doc) {
  // cuenta
  if (!doc.cuenta_contable && doc.cuentaCodigo) doc.cuenta_contable = doc.cuentaCodigo;
  if (!doc.cuentaCodigo && doc.cuenta_contable) doc.cuentaCodigo = doc.cuenta_contable;

  // subcuenta
  if (!doc.subcuenta_id && doc.subcuentaId) doc.subcuenta_id = doc.subcuentaId;
  if (!doc.subcuentaId && doc.subcuenta_id) doc.subcuentaId = doc.subcuenta_id;
}

/**
 * ✅ Mantener consistencia entre campos duplicados (compat)
 * - validate: cubre create/save con validación
 * - save: deja todo persistido correctamente
 */
ExpenseProductSchema.pre("validate", function (next) {
  mirrorCompat(this);
  next();
});

ExpenseProductSchema.pre("save", function (next) {
  mirrorCompat(this);
  next();
});

module.exports = mongoose.model("ExpenseProduct", ExpenseProductSchema);
