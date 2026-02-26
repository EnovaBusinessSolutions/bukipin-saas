// backend/models/IncomeTransaction.js
const mongoose = require("mongoose");

/**
 * ✅ Items de venta (para inventario / precargados / multi-producto)
 * - Mantiene compat con tu esquema actual
 * - Agrega costo (para COGS) y snapshots útiles para UI/reportes
 */
const incomeItemSchema = new mongoose.Schema(
  {
    // Compat: algunas UIs mandan productoId y otras producto_id / productId
    productoId: { type: mongoose.Schema.Types.ObjectId, ref: "Product", default: null },
    productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product", default: null },

    // Snapshot del nombre (aunque cambie el catálogo)
    nombre: { type: String, default: "" },
    productName: { type: String, default: "" },

    // Cantidad
    cantidad: { type: Number, default: 0 },
    qty: { type: Number, default: 0 },

    // Precio de venta
    precioUnitario: { type: Number, default: 0 },
    precio_unitario: { type: Number, default: 0 },

    subtotal: { type: Number, default: 0 },

    // ✅ Costo inventario (para trazabilidad / auditoría)
    costoUnitario: { type: Number, default: 0 },
    costo_unitario: { type: Number, default: 0 },
    costoTotal: { type: Number, default: 0 },
    costo_total: { type: Number, default: 0 },
  },
  { _id: false }
);

const incomeTransactionSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },

    fecha: { type: Date, default: Date.now, index: true },

    // ✅ NUEVO (CANÓNICO): fecha límite / vencimiento (para CxC)
    // - NO adivinar nombres: este es el nombre oficial a usar en backend+frontend
    fechaLimite: { type: Date, default: null, index: true },

    // precargados | inventariados | general | otros
    tipoIngreso: { type: String, default: "general", trim: true, index: true },

    descripcion: { type: String, default: "Ingreso", trim: true },

    montoTotal: { type: Number, default: 0 },
    montoDescuento: { type: Number, default: 0 },
    montoNeto: { type: Number, default: 0 },

    metodoPago: { type: String, default: "efectivo", trim: true }, // efectivo | bancos
    tipoPago: { type: String, default: "contado", trim: true }, // contado | parcial | credito
    montoPagado: { type: Number, default: 0 },

    // ✅ Saldo pendiente (CxC) — regla: siempre a 1003 en asientos cuando aplique
    saldoPendiente: { type: Number, default: 0, index: true },

    // Compat extra (a veces UI/legacy usa estos nombres)
    montoPendiente: { type: Number, default: 0 },
    pendiente: { type: Number, default: 0 },

    // Cuenta principal (Ventas u otros ingresos)
    cuentaCodigo: { type: String, default: "4001", trim: true, index: true },

    // ✅ aliases que usa el backend en algunos puntos
    cuentaPrincipalCodigo: { type: String, default: null, trim: true, index: true },

    // Subcuenta (puede ser por id o por código; guardamos ambos)
    subcuentaId: { type: mongoose.Schema.Types.ObjectId, ref: "Account", default: null, index: true },
    subcuentaCodigo: { type: String, default: null, trim: true, index: true },

    // Cliente
    clienteId: { type: mongoose.Schema.Types.ObjectId, ref: "Client", default: null, index: true },

    // ✅ Link contable (para abrir modal y trazabilidad)
    asientoId: { type: mongoose.Schema.Types.ObjectId, ref: "JournalEntry", default: null, index: true },
    journalEntryId: { type: mongoose.Schema.Types.ObjectId, ref: "JournalEntry", default: null, index: true },
    numeroAsiento: { type: String, default: null, trim: true, index: true },

    // Para ventas con productos (multi-producto / inventario)
    items: { type: [incomeItemSchema], default: [] },

    // Compat legacy: algunas pantallas guardan un productId simple
    productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product", default: null, index: true },

    // Cantidad total (si aplica)
    cantidad: { type: Number, default: 0 },
    qty: { type: Number, default: 0 },
    unidades: { type: Number, default: 0 },

    // UI espera poder “cancelar”
    estado: { type: String, default: "activo", enum: ["activo", "cancelado"], index: true },
    canceladoAt: { type: Date, default: null },
    canceladoReason: { type: String, default: "" },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform: (_doc, ret) => {
        // id / timestamps estilo Supabase
        ret.id = String(ret._id);
        ret.created_at = ret.createdAt ? new Date(ret.createdAt).toISOString() : null;
        ret.updated_at = ret.updatedAt ? new Date(ret.updatedAt).toISOString() : null;

        // user_id compat
        ret.user_id = ret.owner ? String(ret.owner) : null;

        // snake_case aliases (compat UI)
        ret.tipo_ingreso = ret.tipoIngreso;

        ret.monto_total = ret.montoTotal;
        ret.monto_descuento = ret.montoDescuento;
        ret.monto_neto = ret.montoNeto;

        ret.metodo_pago = ret.metodoPago;
        ret.tipo_pago = ret.tipoPago;
        ret.monto_pagado = ret.montoPagado;

        // ✅ fecha límite (aliases para UI/legacy)
        // - canónico: fechaLimite
        // - compat: fecha_limite / fecha_vencimiento
        ret.fecha_limite = ret.fechaLimite ? new Date(ret.fechaLimite).toISOString() : null;
        ret.fecha_vencimiento = ret.fechaLimite ? new Date(ret.fechaLimite).toISOString() : null;

        // pendientes (todas las variantes)
        ret.saldo_pendiente = ret.saldoPendiente;
        ret.monto_pendiente = typeof ret.montoPendiente === "number" ? ret.montoPendiente : ret.saldoPendiente;
        ret.pendiente = typeof ret.pendiente === "number" ? ret.pendiente : ret.saldoPendiente;

        // cuenta/subcuenta
        ret.cuenta_codigo = ret.cuentaCodigo;
        ret.cuenta_principal_codigo = ret.cuentaPrincipalCodigo || ret.cuentaCodigo;

        ret.subcuenta_id = ret.subcuentaId ? String(ret.subcuentaId) : null;
        ret.subcuenta_codigo = ret.subcuentaCodigo || null;

        // cliente
        ret.cliente_id = ret.clienteId ? String(ret.clienteId) : null;

        // link contable
        ret.asiento_id = ret.asientoId ? String(ret.asientoId) : null;
        ret.journal_entry_id = ret.journalEntryId ? String(ret.journalEntryId) : null;
        ret.numero_asiento = ret.numeroAsiento || null;

        // items: agregamos aliases básicos sin romper
        if (Array.isArray(ret.items)) {
          ret.items = ret.items.map((it) => {
            const productoId = it.productoId || it.productId || null;
            const nombre = it.nombre || it.productName || "";
            const cantidad = Number(it.cantidad || it.qty || 0);
            const precioUnitario = Number(it.precioUnitario || it.precio_unitario || 0);
            const subtotal = Number(it.subtotal || 0);

            const costoUnitario = Number(it.costoUnitario || it.costo_unitario || 0);
            const costoTotal = Number(it.costoTotal || it.costo_total || 0);

            return {
              ...it,
              productoId: productoId ? String(productoId) : null,
              productId: productoId ? String(productoId) : null,
              nombre,
              productName: nombre,

              cantidad,
              qty: cantidad,

              precioUnitario,
              precio_unitario: precioUnitario,

              subtotal,

              costoUnitario,
              costo_unitario: costoUnitario,
              costoTotal,
              costo_total: costoTotal,
            };
          });
        }

        // limpia basura mongoose
        delete ret._id;
        delete ret.__v;
        delete ret.createdAt;
        delete ret.updatedAt;

        return ret;
      },
    },
    toObject: { virtuals: true },
  }
);

incomeTransactionSchema.index({ owner: 1, fecha: -1 });
incomeTransactionSchema.index({ owner: 1, estado: 1, fecha: -1 });
incomeTransactionSchema.index({ owner: 1, clienteId: 1, fecha: -1 });

// ✅ NUEVO: index útil para queries por vencimiento
incomeTransactionSchema.index({ owner: 1, fechaLimite: 1, estado: 1 });

// ✅ Asegurar consistencia: si vienen variantes, las espejeamos
incomeTransactionSchema.pre("save", function (next) {
  // cuenta principal
  if (!this.cuentaPrincipalCodigo && this.cuentaCodigo) this.cuentaPrincipalCodigo = this.cuentaCodigo;
  if (!this.cuentaCodigo && this.cuentaPrincipalCodigo) this.cuentaCodigo = this.cuentaPrincipalCodigo;

  // ✅ fecha límite: aceptar asignaciones legacy internas si algún flujo las setea
  // (nota: Mongo SOLO guarda lo que el backend le mande; esto no "inventará" fechas)
  if (!this.fechaLimite) {
    const raw = this.fecha_limite || this.fecha_vencimiento || null; // por si algún flujo lo setea así en memoria
    if (raw) {
      const d = new Date(raw);
      if (!Number.isNaN(d.getTime())) this.fechaLimite = d;
    }
  }

  // pendientes
  if (typeof this.saldoPendiente === "number") {
    if (typeof this.montoPendiente !== "number" || this.montoPendiente === 0) this.montoPendiente = this.saldoPendiente;
    if (typeof this.pendiente !== "number" || this.pendiente === 0) this.pendiente = this.saldoPendiente;
  } else {
    const p = Number(this.montoPendiente || this.pendiente || 0);
    this.saldoPendiente = Number.isFinite(p) ? p : 0;
  }

  // items: si qty viene y cantidad no, o viceversa
  if (Array.isArray(this.items)) {
    this.items = this.items.map((it) => {
      const cantidad = Number(it.cantidad || it.qty || 0);
      it.cantidad = cantidad;
      it.qty = cantidad;

      // productoId espejo
      if (!it.productoId && it.productId) it.productoId = it.productId;
      if (!it.productId && it.productoId) it.productId = it.productoId;

      // nombre espejo
      if (!it.nombre && it.productName) it.nombre = it.productName;
      if (!it.productName && it.nombre) it.productName = it.nombre;

      // precio espejo
      if (!it.precioUnitario && it.precio_unitario) it.precioUnitario = it.precio_unitario;
      if (!it.precio_unitario && it.precioUnitario) it.precio_unitario = it.precioUnitario;

      // costo espejo
      if (!it.costoUnitario && it.costo_unitario) it.costoUnitario = it.costo_unitario;
      if (!it.costo_unitario && it.costoUnitario) it.costo_unitario = it.costoUnitario;
      if (!it.costoTotal && it.costo_total) it.costoTotal = it.costo_total;
      if (!it.costo_total && it.costoTotal) it.costo_total = it.costoTotal;

      return it;
    });
  }

  next();
});

module.exports = mongoose.model("IncomeTransaction", incomeTransactionSchema);