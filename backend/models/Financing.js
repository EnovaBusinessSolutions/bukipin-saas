// backend/models/Financing.js
const mongoose = require("mongoose");

const { Schema } = mongoose;

function num(v, def = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

const financingSchema = new Schema(
  {
    // Dueño del registro
    owner: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // Identidad / catálogo
    nombre: {
      type: String,
      required: true,
      trim: true,
    },
    alias: {
      type: String,
      trim: true,
      default: "",
    },

    // Ej: banco, financiera, proveedor, arrendadora, fintech, etc.
    institucion: {
      type: String,
      trim: true,
      default: "",
      index: true,
    },
    institucion_id: {
      type: Schema.Types.ObjectId,
      ref: "FinancialInstitution",
      default: null,
      index: true,
    },

    // Clasificación
    tipo: {
      type: String,
      trim: true,
      enum: [
        "prestamo",
        "credito_simple",
        "linea_credito",
        "tarjeta_credito",
        "arrendamiento",
        "hipoteca",
        "factoraje",
        "otro",
      ],
      default: "prestamo",
      index: true,
    },

    subtipo: {
      type: String,
      trim: true,
      default: "",
    },

    categoria: {
      type: String,
      trim: true,
      enum: [
        "bancario",
        "proveedor",
        "accionista",
        "intercompania",
        "gobierno",
        "fintech",
        "otro",
      ],
      default: "bancario",
    },

    // Estado del financiamiento
    estatus: {
      type: String,
      trim: true,
      enum: [
        "activo",
        "liquidado",
        "vencido",
        "cancelado",
        "suspendido",
      ],
      default: "activo",
      index: true,
    },

    activo: {
      type: Boolean,
      default: true,
      index: true,
    },

    // Identificadores externos
    numero_contrato: {
      type: String,
      trim: true,
      default: "",
      index: true,
    },
    numero_cuenta: {
      type: String,
      trim: true,
      default: "",
    },
    referencia: {
      type: String,
      trim: true,
      default: "",
    },

    // Moneda
    moneda: {
      type: String,
      trim: true,
      default: "MXN",
      uppercase: true,
    },
    tipo_cambio: {
      type: Number,
      default: 1,
      min: 0,
    },

    // Fechas clave
    fecha_apertura: {
      type: Date,
      default: null,
      index: true,
    },
    fecha_inicio: {
      type: Date,
      default: null,
    },
    fecha_vencimiento: {
      type: Date,
      default: null,
      index: true,
    },
    fecha_corte: {
      type: Number,
      default: null, // útil para tarjetas o líneas
      min: 1,
      max: 31,
    },
    fecha_pago: {
      type: Number,
      default: null, // útil para tarjetas o líneas
      min: 1,
      max: 31,
    },

    // Condiciones financieras
    linea_credito: {
      type: Number,
      default: 0,
      min: 0,
    },
    monto_original: {
      type: Number,
      default: 0,
      min: 0,
    },
    monto_dispuesto_inicial: {
      type: Number,
      default: 0,
      min: 0,
    },

    tasa_interes_anual: {
      type: Number,
      default: 0,
      min: 0,
    },
    tasa_interes_mensual: {
      type: Number,
      default: 0,
      min: 0,
    },
    tasa_moratoria_anual: {
      type: Number,
      default: 0,
      min: 0,
    },

    comision_apertura: {
      type: Number,
      default: 0,
      min: 0,
    },
    comision_disposicion: {
      type: Number,
      default: 0,
      min: 0,
    },

    // Pago esperado
    plazo_meses: {
      type: Number,
      default: 0,
      min: 0,
    },
    pago_periodico_estimado: {
      type: Number,
      default: 0,
      min: 0,
    },
    periodicidad_pago: {
      type: String,
      trim: true,
      enum: [
        "semanal",
        "quincenal",
        "mensual",
        "bimestral",
        "trimestral",
        "semestral",
        "anual",
        "variable",
        "sin_definir",
      ],
      default: "mensual",
    },

    // Saldos vivos del financiamiento
    saldo_dispuesto_actual: {
      type: Number,
      default: 0,
      min: 0,
    },
    saldo_capital_actual: {
      type: Number,
      default: 0,
      min: 0,
      index: true,
    },
    saldo_intereses_actual: {
      type: Number,
      default: 0,
      min: 0,
    },
    saldo_moratorios_actual: {
      type: Number,
      default: 0,
      min: 0,
    },
    saldo_comisiones_actual: {
      type: Number,
      default: 0,
      min: 0,
    },
    saldo_total_actual: {
      type: Number,
      default: 0,
      min: 0,
      index: true,
    },

    // Disponibilidad remanente
    disponible_actual: {
      type: Number,
      default: 0,
      min: 0,
    },

    // KPIs acumulados
    total_dispuesto: {
      type: Number,
      default: 0,
      min: 0,
    },
    total_amortizado_capital: {
      type: Number,
      default: 0,
      min: 0,
    },
    total_intereses_cargados: {
      type: Number,
      default: 0,
      min: 0,
    },
    total_intereses_pagados: {
      type: Number,
      default: 0,
      min: 0,
    },
    total_comisiones_cargadas: {
      type: Number,
      default: 0,
      min: 0,
    },
    total_comisiones_pagadas: {
      type: Number,
      default: 0,
      min: 0,
    },

    // Contabilidad
    cuenta_pasivo_codigo: {
      type: String,
      trim: true,
      default: "",
    },
    cuenta_pasivo_nombre: {
      type: String,
      trim: true,
      default: "",
    },

    cuenta_intereses_codigo: {
      type: String,
      trim: true,
      default: "",
    },
    cuenta_intereses_nombre: {
      type: String,
      trim: true,
      default: "",
    },

    cuenta_bancos_codigo: {
      type: String,
      trim: true,
      default: "",
    },
    cuenta_bancos_nombre: {
      type: String,
      trim: true,
      default: "",
    },

    // Extra / UI
    descripcion: {
      type: String,
      trim: true,
      default: "",
    },
    notas: {
      type: String,
      trim: true,
      default: "",
    },
    etiquetas: {
      type: [String],
      default: [],
    },

    // Último movimiento útil para paneles
    ultimo_movimiento_at: {
      type: Date,
      default: null,
      index: true,
    },
    ultimo_movimiento_tipo: {
      type: String,
      trim: true,
      default: "",
    },
  },
  {
    timestamps: true,
    minimize: false,
  }
);

financingSchema.index({ owner: 1, activo: 1, estatus: 1, tipo: 1 });
financingSchema.index({ owner: 1, institucion: 1 });
financingSchema.index({ owner: 1, nombre: 1 });
financingSchema.index({ owner: 1, fecha_vencimiento: 1 });
financingSchema.index({ owner: 1, ultimo_movimiento_at: -1 });

financingSchema.pre("validate", function (next) {
  this.linea_credito = Math.max(0, num(this.linea_credito, 0));
  this.monto_original = Math.max(0, num(this.monto_original, 0));
  this.monto_dispuesto_inicial = Math.max(0, num(this.monto_dispuesto_inicial, 0));

  this.tasa_interes_anual = Math.max(0, num(this.tasa_interes_anual, 0));
  this.tasa_interes_mensual = Math.max(0, num(this.tasa_interes_mensual, 0));
  this.tasa_moratoria_anual = Math.max(0, num(this.tasa_moratoria_anual, 0));

  this.comision_apertura = Math.max(0, num(this.comision_apertura, 0));
  this.comision_disposicion = Math.max(0, num(this.comision_disposicion, 0));

  this.plazo_meses = Math.max(0, Math.trunc(num(this.plazo_meses, 0)));
  this.pago_periodico_estimado = Math.max(0, num(this.pago_periodico_estimado, 0));

  this.saldo_dispuesto_actual = Math.max(0, num(this.saldo_dispuesto_actual, 0));
  this.saldo_capital_actual = Math.max(0, num(this.saldo_capital_actual, 0));
  this.saldo_intereses_actual = Math.max(0, num(this.saldo_intereses_actual, 0));
  this.saldo_moratorios_actual = Math.max(0, num(this.saldo_moratorios_actual, 0));
  this.saldo_comisiones_actual = Math.max(0, num(this.saldo_comisiones_actual, 0));

  this.total_dispuesto = Math.max(0, num(this.total_dispuesto, 0));
  this.total_amortizado_capital = Math.max(0, num(this.total_amortizado_capital, 0));
  this.total_intereses_cargados = Math.max(0, num(this.total_intereses_cargados, 0));
  this.total_intereses_pagados = Math.max(0, num(this.total_intereses_pagados, 0));
  this.total_comisiones_cargadas = Math.max(0, num(this.total_comisiones_cargadas, 0));
  this.total_comisiones_pagadas = Math.max(0, num(this.total_comisiones_pagadas, 0));

  // saldo total vivo
  this.saldo_total_actual =
    Math.max(0, num(this.saldo_capital_actual, 0)) +
    Math.max(0, num(this.saldo_intereses_actual, 0)) +
    Math.max(0, num(this.saldo_moratorios_actual, 0)) +
    Math.max(0, num(this.saldo_comisiones_actual, 0));

  // disponible actual
  const linea = Math.max(0, num(this.linea_credito, 0));
  const dispuesto = Math.max(0, num(this.saldo_dispuesto_actual, 0));
  this.disponible_actual = Math.max(0, linea - dispuesto);

  // nombre requerido
  this.nombre = String(this.nombre || "").trim();

  next();
});

module.exports =
  mongoose.models.Financing || mongoose.model("Financing", financingSchema);