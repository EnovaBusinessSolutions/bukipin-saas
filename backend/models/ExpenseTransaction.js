// backend/models/ExpenseTransaction.js
const mongoose = require("mongoose");

const ExpenseTransactionSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },

    // ✅ Producto (solo cuando viene del catálogo/precargados)
    //    Lo hacemos opcional para permitir egresos "manuales" o flujos futuros.
    productoId: { type: mongoose.Schema.Types.ObjectId, ref: "ExpenseProduct", default: null, index: true },

    // ✅ Canonical (para que NO falle el schema): "costo" | "gasto"
    tipo: { type: String, enum: ["costo", "gasto"], required: true, index: true },

    // ✅ Compat / preferencia del frontend (no requerido)
    //    Lo guardamos para que puedas depurar y para compat con implementaciones previas.
    tipoEgreso: { type: String, enum: ["costo", "gasto"], default: null, index: true },

    // ✅ Subtipo (precargado, inventariado, etc.)
    subtipoEgreso: { type: String, default: "precargado", trim: true, index: true },

    // ✅ Fechas
    fecha: { type: Date, required: true, index: true },
    fechaVencimiento: { type: Date, default: null, index: true },

    // ✅ Cantidades/Precios (útiles para precargados)
    cantidad: { type: Number, default: 1 },
    precioUnitario: { type: Number, default: 0 },

    // ✅ Totales (canonical del flujo nuevo)
    montoTotal: { type: Number, default: 0 },
    montoPagado: { type: Number, default: 0 },
    montoPendiente: { type: Number, default: 0 },

    // ✅ Legacy/compat (tu modelo viejo usaba total)
    //    Lo mantenemos para no romper lecturas viejas.
    total: { type: Number, default: 0 },

    // ✅ Contabilidad (para generar asiento / analítica)
    cuentaCodigo: { type: String, default: "", trim: true, index: true },
    subcuentaId: { type: mongoose.Schema.Types.ObjectId, ref: "Account", default: null, index: true },
    numeroAsiento: { type: String, default: null, index: true },

    // ✅ Pago
    tipoPago: { type: String, enum: ["contado", "credito", "parcial"], default: "contado", index: true },
    metodoPago: { type: String, default: null, trim: true, index: true },

    // ✅ Proveedor (opcional)
    proveedorId: { type: mongoose.Schema.Types.ObjectId, ref: "Proveedor", default: null, index: true },
    proveedorNombre: { type: String, default: null, trim: true },
    proveedorTelefono: { type: String, default: null, trim: true },
    proveedorEmail: { type: String, default: null, trim: true },
    proveedorRfc: { type: String, default: null, trim: true },

    // ✅ Texto
    descripcion: { type: String, default: "", trim: true },
    comentarios: { type: String, default: null, trim: true },
  },
  { timestamps: true }
);

// =============================
// ✅ Índices recomendados
// =============================
ExpenseTransactionSchema.index({ owner: 1, fecha: -1 });
ExpenseTransactionSchema.index({ owner: 1, tipo: 1, fecha: -1 });
ExpenseTransactionSchema.index({ owner: 1, productoId: 1, fecha: -1 });
ExpenseTransactionSchema.index({ owner: 1, numeroAsiento: 1 }, { unique: true, sparse: true });

// =============================
// ✅ Normalizaciones automáticas
// =============================
ExpenseTransactionSchema.pre("validate", function (next) {
  // Mantener tipoEgreso consistente si viene vacío
  if (!this.tipoEgreso && this.tipo) this.tipoEgreso = this.tipo;

  // Calcular montoTotal si no viene pero sí cantidad/precioUnitario
  if (!(this.montoTotal > 0)) {
    const computed = Number(this.cantidad || 0) * Number(this.precioUnitario || 0);
    if (computed > 0) this.montoTotal = computed;
  }

  // Legacy total: espejo de montoTotal (para compat)
  if (!(this.total > 0) && this.montoTotal > 0) this.total = this.montoTotal;

  // Si es contado, pendiente debe ser 0
  if (this.tipoPago === "contado") {
    this.montoPagado = this.montoTotal;
    this.montoPendiente = 0;
  }

  next();
});

module.exports = mongoose.model("ExpenseTransaction", ExpenseTransactionSchema);
