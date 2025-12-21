const mongoose = require("mongoose");

const incomeItemSchema = new mongoose.Schema(
  {
    productoId: { type: mongoose.Schema.Types.ObjectId, ref: "Product", default: null },
    nombre: { type: String, default: "" }, // snapshot del nombre (útil aunque cambie el catálogo)
    cantidad: { type: Number, default: 0 },
    precioUnitario: { type: Number, default: 0 },
    subtotal: { type: Number, default: 0 },
  },
  { _id: false }
);

const incomeTransactionSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },

    fecha: { type: Date, default: Date.now, index: true },

    // precargados | inventariados | general | otros
    tipoIngreso: { type: String, default: "general", trim: true, index: true },

    descripcion: { type: String, default: "Ingreso", trim: true },

    montoTotal: { type: Number, default: 0 },
    montoDescuento: { type: Number, default: 0 },
    montoNeto: { type: Number, default: 0 },

    metodoPago: { type: String, default: "efectivo", trim: true }, // efectivo | bancos
    tipoPago: { type: String, default: "contado", trim: true }, // contado | parcial | credito
    montoPagado: { type: Number, default: 0 },

    // 👇 IMPORTANTÍSIMO: antes NO existía y se perdía
    saldoPendiente: { type: Number, default: 0 },

    cuentaCodigo: { type: String, default: "4001", trim: true, index: true },
    subcuentaId: { type: mongoose.Schema.Types.ObjectId, ref: "Account", default: null },

    clienteId: { type: mongoose.Schema.Types.ObjectId, ref: "Client", default: null },

    // Para futuro / ventas con productos (no rompe nada si la UI no lo usa aún)
    items: { type: [incomeItemSchema], default: [] },

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

        ret.saldo_pendiente = ret.saldoPendiente;

        ret.cuenta_codigo = ret.cuentaCodigo;
        ret.subcuenta_id = ret.subcuentaId ? String(ret.subcuentaId) : null;
        ret.cliente_id = ret.clienteId ? String(ret.clienteId) : null;

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

module.exports = mongoose.model("IncomeTransaction", incomeTransactionSchema);
