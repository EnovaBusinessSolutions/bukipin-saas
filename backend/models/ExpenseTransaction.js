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
    total: { type: Number, default: 0 },

    // ✅ Contabilidad (para generar asiento / analítica)
    cuentaCodigo: { type: String, default: "", trim: true, index: true },
    subcuentaId: { type: mongoose.Schema.Types.ObjectId, ref: "Account", default: null, index: true },
    numeroAsiento: { type: String, default: null, index: true },

    // ✅ Link directo al asiento (CLAVE para que “Registros Contables” funcione E2E)
    asientoId: { type: mongoose.Schema.Types.ObjectId, ref: "JournalEntry", default: null, index: true },

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

    // ==========================================================
    // ✅ CANCELACIÓN (CRÍTICO para que “Cancelar transacción” funcione)
    // ==========================================================
    estado: { type: String, enum: ["activo", "cancelado"], default: "activo", index: true },
    motivoCancelacion: { type: String, default: "", trim: true },
    canceladoAt: { type: Date, default: null },

    // ✅ Para ligar la reversión contable creada al cancelar
    numeroAsientoReversion: { type: String, default: null, trim: true, index: true },
  },
  { timestamps: true }
);

// =============================
// ✅ Índices recomendados
// =============================
ExpenseTransactionSchema.index({ owner: 1, fecha: -1 });
ExpenseTransactionSchema.index({ owner: 1, estado: 1, fecha: -1 }); // 🔥 listado por estado
ExpenseTransactionSchema.index({ owner: 1, tipo: 1, fecha: -1 });
ExpenseTransactionSchema.index({ owner: 1, productoId: 1, fecha: -1 });
ExpenseTransactionSchema.index({ owner: 1, numeroAsiento: 1 }, { unique: true, sparse: true });
ExpenseTransactionSchema.index({ owner: 1, numeroAsientoReversion: 1 }, { sparse: true });

// ✅ Index extra (lookup directo del asiento desde la transacción)
ExpenseTransactionSchema.index({ owner: 1, asientoId: 1 });

// =============================
// ✅ Normalizaciones automáticas
// =============================
ExpenseTransactionSchema.pre("validate", function (next) {
  try {
    // Mantener tipoEgreso consistente si viene vacío
    if (!this.tipoEgreso && this.tipo) this.tipoEgreso = this.tipo;

    // Normalizar números
    const total = Number(this.montoTotal || 0);
    let pagado = Number(this.montoPagado || 0);
    let pendiente = Number(this.montoPendiente || 0);

    // Calcular montoTotal si no viene pero sí cantidad/precioUnitario
    if (!(total > 0)) {
      const computed = Number(this.cantidad || 0) * Number(this.precioUnitario || 0);
      if (computed > 0) this.montoTotal = computed;
    }

    // Legacy total: espejo de montoTotal (para compat)
    if (!(Number(this.total || 0) > 0) && Number(this.montoTotal || 0) > 0) this.total = this.montoTotal;

    // Releer total por si se calculó arriba
    const total2 = Number(this.montoTotal || 0);

    // ✅ Blindajes: pagado/pendiente no negativos
    if (!Number.isFinite(pagado) || pagado < 0) pagado = 0;
    if (!Number.isFinite(pendiente) || pendiente < 0) pendiente = 0;

    // ✅ Si es contado: forzar pagado=total y pendiente=0
    if (this.tipoPago === "contado") {
      this.montoPagado = total2;
      this.montoPendiente = 0;
      return next();
    }

    // ✅ Si NO es contado: recalcular pendiente de forma consistente si tenemos total
    // (Esto hace que los pagos siempre cuadren sin depender de quien setee montoPendiente)
    if (total2 > 0) {
      // cap pagado a total
      if (pagado > total2) pagado = total2;

      this.montoPagado = pagado;
      this.montoPendiente = Math.max(0, total2 - pagado);
    } else {
      // si no hay total, respetar lo que venga (pero no negativo)
      this.montoPagado = pagado;
      this.montoPendiente = Math.max(0, pendiente);
    }

    next();
  } catch (e) {
    next(e);
  }
});

module.exports = mongoose.model("ExpenseTransaction", ExpenseTransactionSchema);
