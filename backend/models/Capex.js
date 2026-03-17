const mongoose = require("mongoose");

function num(v, def = 0) {
  const n = Number(String(v ?? "").replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : def;
}

function asTrim(v, def = "") {
  if (v === undefined || v === null) return def;
  return String(v).trim();
}

const capexSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },

    // =========================
    // Datos principales del activo
    // =========================
    producto_nombre: { type: String, required: true, trim: true, default: "" },
    descripcion: { type: String, trim: true, default: "" },
    imagen_url: { type: String, trim: true, default: "" },

    categoria_activo: { type: String, trim: true, default: "otro", index: true },

    subcuenta_id: { type: mongoose.Schema.Types.ObjectId, ref: "Account", default: null, index: true },
    cuenta_codigo: { type: String, trim: true, default: "" },

    comentarios: { type: String, trim: true, default: "" },

    // =========================
    // Montos compra / adquisición
    // =========================
    valor_total: { type: Number, required: true, default: 0 },
    monto_pagado: { type: Number, default: 0 },
    monto_pendiente: { type: Number, default: 0 },

    tipo_pago: { type: String, trim: true, default: "contado", index: true },
    metodo_pago: { type: String, trim: true, default: "" },
    fecha_vencimiento: { type: Date, default: null },

    // =========================
    // Depreciación
    // =========================
    anos_depreciacion: { type: Number, default: 0 },
    valor_depreciacion_anual: { type: Number, default: 0 },
    valor_depreciacion_mensual: { type: Number, default: 0 },

    fecha_adquisicion: { type: Date, required: true, default: Date.now, index: true },
    fecha_inicio_depreciacion: { type: Date, default: null },

    // =========================
    // Proveedor
    // =========================
    proveedor_nombre: { type: String, trim: true, default: "" },
    proveedor_email: { type: String, trim: true, default: "" },
    proveedor_telefono: { type: String, trim: true, default: "" },
    proveedor_rfc: { type: String, trim: true, default: "" },

    // =========================
    // Estado del activo
    // =========================
    estado: {
      type: String,
      trim: true,
      default: "activo",
      enum: ["activo", "dado_de_baja", "vendido", "cancelado"],
      index: true,
    },

    fecha_baja: { type: Date, default: null },
    valor_venta: { type: Number, default: 0 },
    motivo_baja: { type: String, trim: true, default: "" },

    // =========================
    // Datos de venta
    // =========================
    metodo_pago_venta: { type: String, trim: true, default: "" },
    tipo_pago_venta: { type: String, trim: true, default: "" },
    monto_pagado_venta: { type: Number, default: 0 },
    monto_pendiente_venta: { type: Number, default: 0 },
    fecha_vencimiento_venta: { type: Date, default: null },

    comprador_nombre: { type: String, trim: true, default: "" },
    comprador_rfc: { type: String, trim: true, default: "" },
    comprador_telefono: { type: String, trim: true, default: "" },
    comprador_email: { type: String, trim: true, default: "" },

    // =========================
    // Relación contable opcional
    // =========================
    journalEntryId: { type: mongoose.Schema.Types.ObjectId, ref: "JournalEntry", default: null, index: true },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform: (_doc, ret) => {
        ret.id = String(ret._id);
        ret.user_id = ret.owner ? String(ret.owner) : null;

        ret.created_at = ret.createdAt ? new Date(ret.createdAt).toISOString() : null;
        ret.updated_at = ret.updatedAt ? new Date(ret.updatedAt).toISOString() : null;

        ret.fecha_adquisicion = ret.fecha_adquisicion ? new Date(ret.fecha_adquisicion).toISOString() : null;
        ret.fecha_inicio_depreciacion = ret.fecha_inicio_depreciacion
          ? new Date(ret.fecha_inicio_depreciacion).toISOString()
          : null;
        ret.fecha_baja = ret.fecha_baja ? new Date(ret.fecha_baja).toISOString() : null;
        ret.fecha_vencimiento = ret.fecha_vencimiento ? new Date(ret.fecha_vencimiento).toISOString() : null;
        ret.fecha_vencimiento_venta = ret.fecha_vencimiento_venta
          ? new Date(ret.fecha_vencimiento_venta).toISOString()
          : null;

        if (ret.subcuenta_id) ret.subcuenta_id = String(ret.subcuenta_id);
        if (ret.journalEntryId) ret.journalEntryId = String(ret.journalEntryId);

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

capexSchema.pre("validate", function (next) {
  try {
    const doc = this;

    doc.producto_nombre = asTrim(doc.producto_nombre);
    doc.descripcion = asTrim(doc.descripcion);
    doc.imagen_url = asTrim(doc.imagen_url);
    doc.categoria_activo = asTrim(doc.categoria_activo || "otro") || "otro";
    doc.cuenta_codigo = asTrim(doc.cuenta_codigo);
    doc.comentarios = asTrim(doc.comentarios);

    doc.tipo_pago = asTrim(doc.tipo_pago || "contado").toLowerCase() || "contado";
    doc.metodo_pago = asTrim(doc.metodo_pago).toLowerCase();

    doc.proveedor_nombre = asTrim(doc.proveedor_nombre);
    doc.proveedor_email = asTrim(doc.proveedor_email);
    doc.proveedor_telefono = asTrim(doc.proveedor_telefono);
    doc.proveedor_rfc = asTrim(doc.proveedor_rfc);

    doc.estado = asTrim(doc.estado || "activo").toLowerCase() || "activo";
    if (!["activo", "dado_de_baja", "vendido", "cancelado"].includes(doc.estado)) {
      doc.estado = "activo";
    }

    doc.motivo_baja = asTrim(doc.motivo_baja);

    doc.metodo_pago_venta = asTrim(doc.metodo_pago_venta).toLowerCase();
    doc.tipo_pago_venta = asTrim(doc.tipo_pago_venta).toLowerCase();

    doc.comprador_nombre = asTrim(doc.comprador_nombre);
    doc.comprador_rfc = asTrim(doc.comprador_rfc);
    doc.comprador_telefono = asTrim(doc.comprador_telefono);
    doc.comprador_email = asTrim(doc.comprador_email);

    doc.valor_total = num(doc.valor_total, 0);
    doc.monto_pagado = num(doc.monto_pagado, 0);
    doc.monto_pendiente = num(
      doc.monto_pendiente,
      Math.max(0, num(doc.valor_total, 0) - num(doc.monto_pagado, 0))
    );

    doc.anos_depreciacion = Math.max(0, parseInt(String(doc.anos_depreciacion ?? 0), 10) || 0);

    if (!doc.valor_depreciacion_anual && doc.anos_depreciacion > 0 && doc.valor_total > 0) {
      doc.valor_depreciacion_anual = num(doc.valor_total, 0) / doc.anos_depreciacion;
    } else {
      doc.valor_depreciacion_anual = num(doc.valor_depreciacion_anual, 0);
    }

    if (!doc.valor_depreciacion_mensual && doc.valor_depreciacion_anual > 0) {
      doc.valor_depreciacion_mensual = num(doc.valor_depreciacion_anual, 0) / 12;
    } else {
      doc.valor_depreciacion_mensual = num(doc.valor_depreciacion_mensual, 0);
    }

    doc.valor_venta = num(doc.valor_venta, 0);
    doc.monto_pagado_venta = num(doc.monto_pagado_venta, 0);
    doc.monto_pendiente_venta = num(
      doc.monto_pendiente_venta,
      Math.max(0, num(doc.valor_venta, 0) - num(doc.monto_pagado_venta, 0))
    );

    if (doc.estado === "activo") {
      doc.fecha_baja = null;
      doc.valor_venta = 0;
      doc.motivo_baja = "";
      doc.metodo_pago_venta = "";
      doc.tipo_pago_venta = "";
      doc.monto_pagado_venta = 0;
      doc.monto_pendiente_venta = 0;
      doc.fecha_vencimiento_venta = null;
      doc.comprador_nombre = "";
      doc.comprador_rfc = "";
      doc.comprador_telefono = "";
      doc.comprador_email = "";
    }

    next();
  } catch (err) {
    next(err);
  }
});

capexSchema.index({ owner: 1, fecha_adquisicion: -1 });
capexSchema.index({ owner: 1, estado: 1, fecha_adquisicion: -1 });
capexSchema.index({ owner: 1, categoria_activo: 1 });
capexSchema.index({ owner: 1, producto_nombre: 1 });

module.exports = mongoose.model("Capex", capexSchema);