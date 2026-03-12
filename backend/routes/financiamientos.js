// backend/routes/financiamientos.js
const express = require("express");
const mongoose = require("mongoose");
const ensureAuth = require("../middleware/ensureAuth");

const Financing = require("../models/Financing");
const FinancingMovement = require("../models/FinancingMovement");

let JournalEntry = null;
try {
  JournalEntry = require("../models/JournalEntry");
} catch (_) {}

const router = express.Router();

// =====================================================
// Model fallback legacy: tarjetas de crédito
// =====================================================
function getTarjetaModel() {
  if (mongoose.models.TarjetaCredito) return mongoose.models.TarjetaCredito;
  if (mongoose.models.CreditCard) return mongoose.models.CreditCard;

  const TarjetaSchema = new mongoose.Schema(
    {
      owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
      nombre: { type: String, required: true, trim: true },
      banco: { type: String, trim: true, default: "" },
      ultimos4: { type: String, trim: true, default: "" },
      linea_credito: { type: Number, default: 0 },
      saldo_actual: { type: Number, default: 0 },
      activo: { type: Boolean, default: true, index: true },
    },
    { timestamps: true }
  );

  TarjetaSchema.index({ owner: 1, activo: 1 });
  return mongoose.model("TarjetaCredito", TarjetaSchema);
}

const TarjetaCredito = getTarjetaModel();

// =====================================================
// Helpers
// =====================================================
function asTrim(v, def = "") {
  if (v === undefined || v === null) return def;
  return String(v).trim();
}

function asBool(v, def = null) {
  if (v === undefined || v === null || v === "") return def;
  const s = String(v).trim().toLowerCase();
  if (["true", "1", "yes", "y", "si", "sí"].includes(s)) return true;
  if (["false", "0", "no", "n"].includes(s)) return false;
  return def;
}

function toNum(v, def = 0) {
  const n = Number(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : def;
}

function asDateOrNull(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function asObjectIdOrNull(v) {
  const s = asTrim(v, "");
  return mongoose.Types.ObjectId.isValid(s) ? new mongoose.Types.ObjectId(s) : null;
}

function isValidObjectId(v) {
  return mongoose.Types.ObjectId.isValid(asTrim(v, ""));
}

function normalizeTipoFinanciamiento(v) {
  const s = asTrim(v, "").toLowerCase();
  const aliases = {
    simple: "credito_simple",
    credito_simple: "credito_simple",
    prestamo: "credito_simple",
    revolvente: "linea_credito",
    linea_credito: "linea_credito",
    tarjeta_corporativa: "tarjeta_credito",
    tarjeta_credito: "tarjeta_credito",
    arrendamiento: "arrendamiento",
    hipoteca: "hipoteca",
    factoraje: "factoraje",
    otro: "otro",
  };
  return aliases[s] || "credito_simple";
}

function normalizeCategoriaFinanciamiento(v) {
  const s = asTrim(v, "").toLowerCase();
  const allowed = new Set([
    "bancario",
    "proveedor",
    "accionista",
    "intercompania",
    "gobierno",
    "fintech",
    "otro",
  ]);
  return allowed.has(s) ? s : "bancario";
}

function normalizeEstatusFinanciamiento(v) {
  const s = asTrim(v, "").toLowerCase();
  const aliases = {
    activo: "activo",
    pagado: "liquidado",
    liquidado: "liquidado",
    vencido: "vencido",
    cancelado: "cancelado",
    suspendido: "suspendido",
  };
  return aliases[s] || "activo";
}

function normalizePeriodicidad(v) {
  const s = asTrim(v, "").toLowerCase();
  const allowed = new Set([
    "semanal",
    "quincenal",
    "mensual",
    "bimestral",
    "trimestral",
    "semestral",
    "anual",
    "variable",
    "sin_definir",
  ]);
  return allowed.has(s) ? s : "mensual";
}

function normalizeTipoMovimiento(v) {
  const s = asTrim(v, "").toLowerCase();
  const aliases = {
    apertura: "apertura",
    disposicion: "disposicion",
    desembolso: "disposicion",
    amortizacion: "amortizacion",
    cargo_intereses: "cargo_intereses",
    cargo_interes: "cargo_intereses",
    pago_intereses: "pago_intereses",
    pago_interes: "pago_intereses",
    cargo_comision: "cargo_comision",
    pago_comision: "pago_comision",
    cargo_moratorio: "cargo_moratorio",
    ajuste: "ajuste",
    cancelacion: "cancelacion",
    refinanciamiento: "refinanciamiento",
    egreso: "egreso",
    capex: "capex",
    otro: "otro",
  };
  return aliases[s] || "otro";
}

function normalizeEstatusMovimiento(v) {
  const s = asTrim(v, "").toLowerCase();
  const allowed = new Set(["aplicado", "pendiente", "cancelado"]);
  return allowed.has(s) ? s : "aplicado";
}

function parseTags(v) {
  if (Array.isArray(v)) {
    return v.map((x) => asTrim(x)).filter(Boolean);
  }
  const s = asTrim(v, "");
  if (!s) return [];
  return s.split(",").map((x) => x.trim()).filter(Boolean);
}

function getUiTipoFromFinancingLike(doc) {
  const raw = asTrim(doc?.tipo || doc?.tipo_credito, "").toLowerCase();
  if (raw === "credito_simple" || raw === "simple" || raw === "prestamo") return "simple";
  if (raw === "linea_credito" || raw === "revolvente") return "revolvente";
  if (raw === "tarjeta_credito" || raw === "tarjeta_corporativa") return "tarjeta_corporativa";
  return raw || "simple";
}

function getLegacyEstado(doc) {
  return normalizeEstatusFinanciamiento(doc?.estatus || doc?.estado || "activo");
}

function getLegacyTipoMovimiento(doc) {
  return normalizeTipoMovimiento(doc?.tipo || doc?.tipo_transaccion || "otro");
}

function isOpenFacilityType(doc) {
  const tipoUi = getUiTipoFromFinancingLike(doc);
  return tipoUi === "revolvente" || tipoUi === "tarjeta_corporativa";
}

function getTipoLabelFromFinancing(doc) {
  const tipoUi = getUiTipoFromFinancingLike(doc);

  if (tipoUi === "simple") return "Crédito Simple";
  if (tipoUi === "revolvente") return "Crédito Revolvente";
  if (tipoUi === "tarjeta_corporativa") return "Tarjeta Corporativa";
  return "Financiamiento";
}

function getEstadoLabelFromFinancing(doc) {
  const estado = normalizeEstatusFinanciamiento(doc?.estatus || doc?.estado || "activo");
  const labels = {
    activo: "ACTIVO",
    liquidado: "PAGADO",
    vencido: "VENCIDO",
    cancelado: "CANCELADO",
    suspendido: "SUSPENDIDO",
  };
  return labels[estado] || estado.toUpperCase();
}

function buildDetailMetrics(doc) {
  const tipoUi = getUiTipoFromFinancingLike(doc);
  const estado = normalizeEstatusFinanciamiento(doc?.estatus || doc?.estado || "activo");

  const lineaCredito = Math.max(0, toNum(doc?.linea_credito, 0));
  const montoOriginal = Math.max(0, toNum(doc?.monto_original, 0));
  const saldoDispuestoActual = Math.max(0, toNum(doc?.saldo_dispuesto_actual, 0));
  const saldoCapitalActual = Math.max(0, toNum(doc?.saldo_capital_actual, 0));
  const saldoTotalActual = Math.max(0, toNum(doc?.saldo_total_actual, 0));
  const totalAmortizadoCapital = Math.max(0, toNum(doc?.total_amortizado_capital, 0));
  const disponibleActual = Math.max(
    0,
    toNum(doc?.disponible_actual, Math.max(0, lineaCredito - saldoDispuestoActual))
  );

  const montoTotalVista =
    tipoUi === "revolvente" || tipoUi === "tarjeta_corporativa"
      ? lineaCredito
      : montoOriginal;

  const saldoActualVista =
    tipoUi === "revolvente" || tipoUi === "tarjeta_corporativa"
      ? saldoDispuestoActual
      : saldoTotalActual;

  const montoPagadoCapital =
    tipoUi === "simple"
      ? Math.max(0, montoOriginal - saldoCapitalActual)
      : totalAmortizadoCapital;

  const montoPendienteCapital =
    tipoUi === "simple"
      ? Math.max(0, saldoCapitalActual)
      : Math.max(0, saldoDispuestoActual);

  const usoLineaPct =
    lineaCredito > 0 ? Math.min(100, (saldoDispuestoActual / lineaCredito) * 100) : 0;

  const progresoPagoPct =
    montoOriginal > 0 ? Math.min(100, (montoPagadoCapital / montoOriginal) * 100) : 0;

  return {
    tipo_ui: tipoUi,
    tipoUi,
    tipo_label: getTipoLabelFromFinancing(doc),
    tipoLabel: getTipoLabelFromFinancing(doc),

    estado_ui: estado,
    estadoUi: estado,
    estado_label: getEstadoLabelFromFinancing(doc),
    estadoLabel: getEstadoLabelFromFinancing(doc),

    cuenta_display:
      asTrim(doc?.numero_cuenta) ||
      asTrim(doc?.numero_contrato) ||
      asTrim(doc?.referencia) ||
      "",
    cuentaDisplay:
      asTrim(doc?.numero_cuenta) ||
      asTrim(doc?.numero_contrato) ||
      asTrim(doc?.referencia) ||
      "",

    condiciones_texto: asTrim(doc?.notas) || asTrim(doc?.descripcion) || "",
    condicionesTexto: asTrim(doc?.notas) || asTrim(doc?.descripcion) || "",
    descripcion_corta: asTrim(doc?.descripcion) || asTrim(doc?.notas) || "",
    descripcionCorta: asTrim(doc?.descripcion) || asTrim(doc?.notas) || "",

    monto_total_vista: montoTotalVista,
    montoTotalVista,
    saldo_actual_vista: saldoActualVista,
    saldoActualVista,

    monto_pagado_capital: montoPagadoCapital,
    montoPagadoCapital,
    monto_pendiente_capital: montoPendienteCapital,
    montoPendienteCapital,

    uso_linea_pct: usoLineaPct,
    usoLineaPct,
    progreso_pago_pct: progresoPagoPct,
    progresoPagoPct,

    disponible_linea: disponibleActual,
    disponibleLinea: disponibleActual,

    modo_visual: tipoUi === "simple" ? "progreso_pago" : "uso_linea",
    modoVisual: tipoUi === "simple" ? "progreso_pago" : "uso_linea",
  };
}

function recalcFinancingSnapshot(financingLike) {
  const f = financingLike?.toObject ? financingLike.toObject() : { ...(financingLike || {}) };

  f.linea_credito = Math.max(0, toNum(f.linea_credito, 0));
  f.saldo_dispuesto_actual = Math.max(0, toNum(f.saldo_dispuesto_actual, 0));
  f.saldo_capital_actual = Math.max(0, toNum(f.saldo_capital_actual, 0));
  f.saldo_intereses_actual = Math.max(0, toNum(f.saldo_intereses_actual, 0));
  f.saldo_moratorios_actual = Math.max(0, toNum(f.saldo_moratorios_actual, 0));
  f.saldo_comisiones_actual = Math.max(0, toNum(f.saldo_comisiones_actual, 0));

  f.total_dispuesto = Math.max(0, toNum(f.total_dispuesto, 0));
  f.total_amortizado_capital = Math.max(0, toNum(f.total_amortizado_capital, 0));
  f.total_intereses_cargados = Math.max(0, toNum(f.total_intereses_cargados, 0));
  f.total_intereses_pagados = Math.max(0, toNum(f.total_intereses_pagados, 0));
  f.total_comisiones_cargadas = Math.max(0, toNum(f.total_comisiones_cargadas, 0));
  f.total_comisiones_pagadas = Math.max(0, toNum(f.total_comisiones_pagadas, 0));

  f.saldo_total_actual =
    Math.max(0, toNum(f.saldo_capital_actual, 0)) +
    Math.max(0, toNum(f.saldo_intereses_actual, 0)) +
    Math.max(0, toNum(f.saldo_moratorios_actual, 0)) +
    Math.max(0, toNum(f.saldo_comisiones_actual, 0));

  f.disponible_actual = Math.max(0, toNum(f.linea_credito, 0) - toNum(f.saldo_dispuesto_actual, 0));

  const estatusActual = asTrim(f.estatus, "").toLowerCase();
  const openFacility = isOpenFacilityType(f);

  if (!["cancelado", "suspendido", "vencido"].includes(estatusActual)) {
    if (toNum(f.saldo_total_actual, 0) <= 0) {
      f.estatus = openFacility ? "activo" : "liquidado";
    } else if (estatusActual === "liquidado") {
      f.estatus = "activo";
    }
  }

  return f;
}

function applyMovementToFinancing(financingLike, payload) {
  const f = recalcFinancingSnapshot(financingLike);
  const tipo = normalizeTipoMovimiento(payload.tipo);
  const monto = Math.max(0, toNum(payload.monto, 0));
  const montoCapital = Math.max(0, toNum(payload.monto_capital, 0));
  const montoIntereses = Math.max(0, toNum(payload.monto_intereses, 0));
  const montoMoratorios = Math.max(0, toNum(payload.monto_moratorios, 0));
  const montoComisiones = Math.max(0, toNum(payload.monto_comisiones, 0));

  switch (tipo) {
    case "apertura": {
      const capital = montoCapital || monto || Math.max(0, toNum(f.monto_dispuesto_inicial, 0));
      f.saldo_dispuesto_actual += capital;
      f.saldo_capital_actual += capital;
      f.total_dispuesto += capital;
      break;
    }

    case "disposicion": {
      const capital = montoCapital || monto;
      f.saldo_dispuesto_actual += capital;
      f.saldo_capital_actual += capital;
      f.total_dispuesto += capital;
      break;
    }

    case "amortizacion": {
      const capital = montoCapital || 0;
      const intereses = montoIntereses || 0;
      const moratorios = montoMoratorios || 0;
      const comisiones = montoComisiones || 0;

      f.saldo_capital_actual = Math.max(0, f.saldo_capital_actual - capital);
      f.saldo_dispuesto_actual = Math.max(0, f.saldo_dispuesto_actual - capital);
      f.total_amortizado_capital += capital;

      if (intereses > 0) {
        f.saldo_intereses_actual = Math.max(0, f.saldo_intereses_actual - intereses);
        f.total_intereses_pagados += intereses;
      }

      if (moratorios > 0) {
        f.saldo_moratorios_actual = Math.max(0, f.saldo_moratorios_actual - moratorios);
      }

      if (comisiones > 0) {
        f.saldo_comisiones_actual = Math.max(0, f.saldo_comisiones_actual - comisiones);
        f.total_comisiones_pagadas += comisiones;
      }
      break;
    }

    case "cargo_intereses": {
      const intereses = montoIntereses || monto;
      f.saldo_intereses_actual += intereses;
      f.total_intereses_cargados += intereses;
      break;
    }

    case "pago_intereses": {
      const intereses = montoIntereses || monto;
      f.saldo_intereses_actual = Math.max(0, f.saldo_intereses_actual - intereses);
      f.total_intereses_pagados += intereses;
      break;
    }

    case "cargo_comision": {
      const comisiones = montoComisiones || monto;
      f.saldo_comisiones_actual += comisiones;
      f.total_comisiones_cargadas += comisiones;
      break;
    }

    case "pago_comision": {
      const comisiones = montoComisiones || monto;
      f.saldo_comisiones_actual = Math.max(0, f.saldo_comisiones_actual - comisiones);
      f.total_comisiones_pagadas += comisiones;
      break;
    }

    case "cargo_moratorio": {
      const moratorios = montoMoratorios || monto;
      f.saldo_moratorios_actual += moratorios;
      break;
    }

    case "cancelacion": {
      f.estatus = "cancelado";
      break;
    }

    default:
      break;
  }

  return recalcFinancingSnapshot(f);
}

function validateMovementAgainstFinancing(financing, payload) {
  const tipoFin = getUiTipoFromFinancingLike(financing);
  const tipoMov = normalizeTipoMovimiento(payload?.tipo || payload?.tipo_transaccion);

  const montoCapital = Math.max(
    0,
    toNum(
      payload?.monto_capital ??
        payload?.montoCapital ??
        payload?.capital_pagado ??
        payload?.monto,
      0
    )
  );

  if (tipoMov === "disposicion" && tipoFin !== "revolvente") {
    const err = new Error("La disposición solo aplica a créditos revolventes.");
    err.statusCode = 400;
    throw err;
  }

  if (tipoMov === "disposicion") {
    const linea = Math.max(0, toNum(financing?.linea_credito, 0));
    const saldoDispuestoActual = Math.max(0, toNum(financing?.saldo_dispuesto_actual, 0));
    const disponible = Math.max(0, linea - saldoDispuestoActual);

    if (montoCapital > disponible) {
      const err = new Error("La disposición excede la línea de crédito disponible.");
      err.statusCode = 400;
      throw err;
    }
  }
}

function buildLegacyAliasesForFinancing(doc) {
  const tipoUi = getUiTipoFromFinancingLike(doc);
  const estado = getLegacyEstado(doc);

  const montoTotal =
    tipoUi === "revolvente" || tipoUi === "tarjeta_corporativa"
      ? toNum(doc.linea_credito, 0)
      : toNum(doc.monto_original, 0);

  const saldoActual =
    tipoUi === "revolvente" || tipoUi === "tarjeta_corporativa"
      ? toNum(doc.saldo_dispuesto_actual, 0)
      : toNum(doc.saldo_total_actual, 0);

  const institucionId = doc.institucion_id ? String(doc.institucion_id) : "";

  return {
    user_id: doc.owner ? String(doc.owner) : "",
    tipo_credito: tipoUi,
    monto_total: montoTotal,
    tasa_interes: toNum(doc.tasa_interes_anual, 0),
    saldo_inicial: toNum(doc.monto_original, 0),
    saldo_actual: saldoActual,
    institucion_financiera: doc.institucion || "",
    institucion_financiera_id: institucionId || "",
    condiciones: doc.notas || doc.descripcion || "",
    estado,
  };
}

function mapFinancingForUI(doc) {
  const d = doc?.toObject ? doc.toObject() : doc || {};
  const institucionId = d.institucion_id ? String(d.institucion_id) : "";

  const base = {
    id: String(d._id || ""),
    _id: d._id || null,
    owner: d.owner || null,

    nombre: d.nombre || "",
    alias: d.alias || "",

    institucion: d.institucion || "",
    institucion_id: institucionId || "",
    institucionId: institucionId || "",

    tipo: d.tipo || "credito_simple",
    subtipo: d.subtipo || "",
    categoria: d.categoria || "bancario",

    estatus: d.estatus || "activo",
    activo: !!d.activo,

    numero_contrato: d.numero_contrato || "",
    numeroContrato: d.numero_contrato || "",
    numero_cuenta: d.numero_cuenta || "",
    numeroCuenta: d.numero_cuenta || "",
    referencia: d.referencia || "",

    moneda: d.moneda || "MXN",
    tipo_cambio: toNum(d.tipo_cambio, 1),
    tipoCambio: toNum(d.tipo_cambio, 1),

    fecha_apertura: d.fecha_apertura || null,
    fechaApertura: d.fecha_apertura || null,
    fecha_inicio: d.fecha_inicio || null,
    fechaInicio: d.fecha_inicio || null,
    fecha_vencimiento: d.fecha_vencimiento || null,
    fechaVencimiento: d.fecha_vencimiento || null,
    fecha_corte: d.fecha_corte ?? null,
    fechaCorte: d.fecha_corte ?? null,
    fecha_pago: d.fecha_pago ?? null,
    fechaPago: d.fecha_pago ?? null,

    linea_credito: toNum(d.linea_credito, 0),
    lineaCredito: toNum(d.linea_credito, 0),
    monto_original: toNum(d.monto_original, 0),
    montoOriginal: toNum(d.monto_original, 0),
    monto_dispuesto_inicial: toNum(d.monto_dispuesto_inicial, 0),
    montoDispuestoInicial: toNum(d.monto_dispuesto_inicial, 0),

    tasa_interes_anual: toNum(d.tasa_interes_anual, 0),
    tasaInteresAnual: toNum(d.tasa_interes_anual, 0),
    tasa_interes_mensual: toNum(d.tasa_interes_mensual, 0),
    tasaInteresMensual: toNum(d.tasa_interes_mensual, 0),
    tasa_moratoria_anual: toNum(d.tasa_moratoria_anual, 0),
    tasaMoratoriaAnual: toNum(d.tasa_moratoria_anual, 0),

    comision_apertura: toNum(d.comision_apertura, 0),
    comisionApertura: toNum(d.comision_apertura, 0),
    comision_disposicion: toNum(d.comision_disposicion, 0),
    comisionDisposicion: toNum(d.comision_disposicion, 0),

    plazo_meses: toNum(d.plazo_meses, 0),
    plazoMeses: toNum(d.plazo_meses, 0),
    pago_periodico_estimado: toNum(d.pago_periodico_estimado, 0),
    pagoPeriodicoEstimado: toNum(d.pago_periodico_estimado, 0),
    periodicidad_pago: d.periodicidad_pago || "mensual",
    periodicidadPago: d.periodicidad_pago || "mensual",

    saldo_dispuesto_actual: toNum(d.saldo_dispuesto_actual, 0),
    saldoDispuestoActual: toNum(d.saldo_dispuesto_actual, 0),
    saldo_capital_actual: toNum(d.saldo_capital_actual, 0),
    saldoCapitalActual: toNum(d.saldo_capital_actual, 0),
    saldo_intereses_actual: toNum(d.saldo_intereses_actual, 0),
    saldoInteresesActual: toNum(d.saldo_intereses_actual, 0),
    saldo_moratorios_actual: toNum(d.saldo_moratorios_actual, 0),
    saldoMoratoriosActual: toNum(d.saldo_moratorios_actual, 0),
    saldo_comisiones_actual: toNum(d.saldo_comisiones_actual, 0),
    saldoComisionesActual: toNum(d.saldo_comisiones_actual, 0),
    saldo_total_actual: toNum(d.saldo_total_actual, 0),
    saldoTotalActual: toNum(d.saldo_total_actual, 0),
    disponible_actual: toNum(d.disponible_actual, 0),
    disponibleActual: toNum(d.disponible_actual, 0),

    total_dispuesto: toNum(d.total_dispuesto, 0),
    totalDispuesto: toNum(d.total_dispuesto, 0),
    total_amortizado_capital: toNum(d.total_amortizado_capital, 0),
    totalAmortizadoCapital: toNum(d.total_amortizado_capital, 0),
    total_intereses_cargados: toNum(d.total_intereses_cargados, 0),
    totalInteresesCargados: toNum(d.total_intereses_cargados, 0),
    total_intereses_pagados: toNum(d.total_intereses_pagados, 0),
    totalInteresesPagados: toNum(d.total_intereses_pagados, 0),
    total_comisiones_cargadas: toNum(d.total_comisiones_cargadas, 0),
    totalComisionesCargadas: toNum(d.total_comisiones_cargadas, 0),
    total_comisiones_pagadas: toNum(d.total_comisiones_pagadas, 0),
    totalComisionesPagadas: toNum(d.total_comisiones_pagadas, 0),

    cuenta_pasivo_codigo: d.cuenta_pasivo_codigo || "",
    cuentaPasivoCodigo: d.cuenta_pasivo_codigo || "",
    cuenta_pasivo_nombre: d.cuenta_pasivo_nombre || "",
    cuentaPasivoNombre: d.cuenta_pasivo_nombre || "",

    cuenta_intereses_codigo: d.cuenta_intereses_codigo || "",
    cuentaInteresesCodigo: d.cuenta_intereses_codigo || "",
    cuenta_intereses_nombre: d.cuenta_intereses_nombre || "",
    cuentaInteresesNombre: d.cuenta_intereses_nombre || "",

    cuenta_bancos_codigo: d.cuenta_bancos_codigo || "",
    cuentaBancosCodigo: d.cuenta_bancos_codigo || "",
    cuenta_bancos_nombre: d.cuenta_bancos_nombre || "",
    cuentaBancosNombre: d.cuenta_bancos_nombre || "",

    descripcion: d.descripcion || "",
    notas: d.notas || "",
    etiquetas: Array.isArray(d.etiquetas) ? d.etiquetas : [],

    ultimo_movimiento_at: d.ultimo_movimiento_at || null,
    ultimoMovimientoAt: d.ultimo_movimiento_at || null,
    ultimo_movimiento_tipo: d.ultimo_movimiento_tipo || "",
    ultimoMovimientoTipo: d.ultimo_movimiento_tipo || "",

    created_at: d.createdAt || null,
    updated_at: d.updatedAt || null,
    createdAt: d.createdAt || null,
    updatedAt: d.updatedAt || null,
  };

  const enriched = {
    ...base,
    ...buildLegacyAliasesForFinancing(base),
    ...buildDetailMetrics(base),
  };

  return enriched;
}

function buildLegacyAliasesForMovement(doc) {
  return {
    user_id: doc.owner ? String(doc.owner) : "",
    financiamiento_id: doc.financingId ? String(doc.financingId) : "",
    tipo_transaccion: getLegacyTipoMovimiento(doc),
    capital_pagado: toNum(doc.monto_capital, 0),
    interes_pagado: toNum(doc.monto_intereses, 0),
    saldo_restante:
      toNum(doc.snapshot_after?.saldo_total_actual, 0) ||
      toNum(doc.snapshot_after?.saldo_capital_actual, 0),
    metodo_pago: doc.metodo_pago || "",
    numero_referencia: doc.referencia || "",
  };
}

function mapMovementForUI(doc) {
  const d = doc?.toObject ? doc.toObject() : doc || {};
  const snap = d.snapshot_after || {};

  const base = {
    id: String(d._id || ""),
    _id: d._id || null,
    owner: d.owner || null,

    financingId: d.financingId ? String(d.financingId) : "",
    financing_id: d.financingId ? String(d.financingId) : "",

    tipo: d.tipo || "otro",
    subtipo: d.subtipo || "",
    estatus: d.estatus || "aplicado",

    fecha: d.fecha || null,

    monto: toNum(d.monto, 0),
    moneda: d.moneda || "MXN",
    tipo_cambio: toNum(d.tipo_cambio, 1),
    tipoCambio: toNum(d.tipo_cambio, 1),

    monto_capital: toNum(d.monto_capital, 0),
    montoCapital: toNum(d.monto_capital, 0),
    monto_intereses: toNum(d.monto_intereses, 0),
    montoIntereses: toNum(d.monto_intereses, 0),
    monto_moratorios: toNum(d.monto_moratorios, 0),
    montoMoratorios: toNum(d.monto_moratorios, 0),
    monto_comisiones: toNum(d.monto_comisiones, 0),
    montoComisiones: toNum(d.monto_comisiones, 0),
    monto_iva: toNum(d.monto_iva, 0),
    montoIva: toNum(d.monto_iva, 0),

    metodo_pago: d.metodo_pago || "",
    metodoPago: d.metodo_pago || "",
    cuenta_destino: d.cuenta_destino || "",
    cuentaDestino: d.cuenta_destino || "",
    referencia: d.referencia || "",
    beneficiario: d.beneficiario || "",
    institucion: d.institucion || "",

    journalEntryId: d.journalEntryId ? String(d.journalEntryId) : "",
    source: d.source || "financiamiento",
    sourceId: d.sourceId ? String(d.sourceId) : "",

    snapshot_after: {
      saldo_dispuesto_actual: toNum(snap.saldo_dispuesto_actual, 0),
      saldo_capital_actual: toNum(snap.saldo_capital_actual, 0),
      saldo_intereses_actual: toNum(snap.saldo_intereses_actual, 0),
      saldo_moratorios_actual: toNum(snap.saldo_moratorios_actual, 0),
      saldo_comisiones_actual: toNum(snap.saldo_comisiones_actual, 0),
      saldo_total_actual: toNum(snap.saldo_total_actual, 0),
      disponible_actual: toNum(snap.disponible_actual, 0),
    },

    descripcion: d.descripcion || "",
    notas: d.notas || "",
    tags: Array.isArray(d.tags) ? d.tags : [],
    meta: d.meta && typeof d.meta === "object" ? d.meta : {},

    created_at: d.createdAt || null,
    updated_at: d.updatedAt || null,
    createdAt: d.createdAt || null,
    updatedAt: d.updatedAt || null,
  };

  return {
    ...base,
    ...buildLegacyAliasesForMovement({ ...d, ...base }),
  };
}

function buildTarjetaTxForUI(m) {
  const mm = mapMovementForUI(m);
  const tipo = getLegacyTipoMovimiento(mm);

  let tipoUI = "cargo";
  if (tipo === "amortizacion") tipoUI = "amortizacion";
  else if (tipo === "cargo_intereses") tipoUI = "cargo_interes";
  else if (tipo === "disposicion") tipoUI = "desembolso";
  else if (tipo === "egreso" || tipo === "capex") tipoUI = "cargo";

  return {
    id: mm.id,
    fecha: mm.fecha,
    descripcion: mm.descripcion || mm.notas || getTipoLabelFromMovement(tipo),
    monto: mm.monto,
    tipo,
    proveedor: mm.beneficiario || null,
    tipoTransaccion: tipoUI,
    estado: mm.estatus === "cancelado" ? "cancelado" : "activo",
    fechaCancelacion: mm.meta?.fechaCancelacion || null,
    motivoCancelacion: mm.meta?.motivoCancelacion || null,
    detalle: {
      ...mm.meta,
      cuenta_codigo: mm.meta?.cuenta_codigo || "",
      capital_pagado: mm.capital_pagado,
      interes_pagado: mm.interes_pagado,
      metodo_pago: mm.metodo_pago,
    },
    journalEntryId: mm.journalEntryId || "",
  };
}

function getTipoLabelFromMovement(tipo) {
  const labels = {
    apertura: "Apertura",
    disposicion: "Disposición",
    amortizacion: "Amortización",
    cargo_intereses: "Cargo por Intereses",
    pago_intereses: "Pago de Intereses",
    cargo_comision: "Cargo por Comisión",
    pago_comision: "Pago de Comisión",
    cargo_moratorio: "Cargo Moratorio",
    egreso: "Egreso",
    capex: "CAPEX",
  };
  return labels[tipo] || tipo || "Movimiento";
}

function buildJournalEntryPayload({ owner, financing, movement, movementId }) {
  const tipo = normalizeTipoMovimiento(movement.tipo);
  const fecha = movement.fecha || new Date();

  const liabilityCode = asTrim(financing.cuenta_pasivo_codigo, "2101");
  const liabilityName = asTrim(financing.cuenta_pasivo_nombre, "Financiamientos");
  const banksCode = asTrim(financing.cuenta_bancos_codigo, "1002");
  const banksName = asTrim(financing.cuenta_bancos_nombre, "Bancos");
  const interestsCode = asTrim(financing.cuenta_intereses_codigo, "5201");
  const interestsName = asTrim(financing.cuenta_intereses_nombre, "Gastos Financieros");

  const monto = Math.max(0, toNum(movement.monto, 0));
  const capital = Math.max(0, toNum(movement.monto_capital, 0));
  const intereses = Math.max(0, toNum(movement.monto_intereses, 0));
  const comisiones = Math.max(0, toNum(movement.monto_comisiones, 0));

  const lines = [];
  const pushDebit = (code, name, amount, memo = "") => {
    if (amount > 0) {
      lines.push({
        accountCode: code,
        accountCodigo: code,
        accountName: name,
        debit: amount,
        credit: 0,
        memo,
      });
    }
  };
  const pushCredit = (code, name, amount, memo = "") => {
    if (amount > 0) {
      lines.push({
        accountCode: code,
        accountCodigo: code,
        accountName: name,
        debit: 0,
        credit: amount,
        memo,
      });
    }
  };

  if (tipo === "apertura" || tipo === "disposicion") {
    pushDebit(banksCode, banksName, monto, movement.descripcion || getTipoLabelFromMovement(tipo));
    pushCredit(liabilityCode, liabilityName, monto, movement.descripcion || getTipoLabelFromMovement(tipo));
  } else if (tipo === "amortizacion") {
    if (capital > 0) pushDebit(liabilityCode, liabilityName, capital, "Pago a capital");
    if (intereses > 0) pushDebit(interestsCode, interestsName, intereses, "Pago de intereses");
    if (comisiones > 0) pushDebit(interestsCode, interestsName, comisiones, "Pago de comisiones");
    pushCredit(banksCode, banksName, capital + intereses + comisiones, movement.descripcion || "Amortización");
  } else if (tipo === "cargo_intereses") {
    pushDebit(interestsCode, interestsName, monto, movement.descripcion || "Cargo por intereses");
    pushCredit(liabilityCode, liabilityName, monto, movement.descripcion || "Cargo por intereses");
  } else if (tipo === "pago_intereses") {
    pushDebit(liabilityCode, liabilityName, monto, "Pago de intereses");
    pushCredit(banksCode, banksName, monto, "Pago de intereses");
  } else if (tipo === "cargo_comision") {
    pushDebit(interestsCode, interestsName, monto, "Cargo por comisión");
    pushCredit(liabilityCode, liabilityName, monto, "Cargo por comisión");
  } else if (tipo === "pago_comision") {
    pushDebit(liabilityCode, liabilityName, monto, "Pago de comisión");
    pushCredit(banksCode, banksName, monto, "Pago de comisión");
  } else if (tipo === "cargo_moratorio") {
    pushDebit(interestsCode, interestsName, monto, "Cargo moratorio");
    pushCredit(liabilityCode, liabilityName, monto, "Cargo moratorio");
  }

  if (!lines.length) return null;

  const concept = movement.descripcion || `${getTipoLabelFromMovement(tipo)} - ${financing.nombre}`;

  return {
    owner,
    source: "financiamiento",
    sourceId: movementId,
    transaccionId: movementId,
    concept,
    concepto: concept,
    descripcion: concept,
    date: fecha,
    fecha,
    lines,
    detalle_asientos: lines,
    references: [
      { source: "financiamiento", id: String(movementId) },
      { source: "financing", id: String(financing._id) },
    ],
  };
}

async function createJournalEntryBestEffort({ owner, financing, movement, movementId }) {
  try {
    if (!JournalEntry) return null;
    const payload = buildJournalEntryPayload({ owner, financing, movement, movementId });
    if (!payload) return null;
    const je = await JournalEntry.create(payload);
    return je?._id ? String(je._id) : null;
  } catch (err) {
    console.error("createJournalEntryBestEffort error:", err?.message || err);
    return null;
  }
}

async function createMovementAndApply({ owner, financing, payload }) {
  const fecha = asDateOrNull(payload.fecha) || new Date();

  const monto = Math.max(0, toNum(payload.monto, 0));
  const montoCapital = Math.max(0, toNum(payload.monto_capital ?? payload.montoCapital ?? payload.capital_pagado, 0));
  const montoIntereses = Math.max(0, toNum(payload.monto_intereses ?? payload.montoIntereses ?? payload.interes_pagado, 0));
  const montoMoratorios = Math.max(0, toNum(payload.monto_moratorios ?? payload.montoMoratorios, 0));
  const montoComisiones = Math.max(0, toNum(payload.monto_comisiones ?? payload.montoComisiones, 0));
  const montoIva = Math.max(0, toNum(payload.monto_iva ?? payload.montoIva, 0));

  const effectiveAmount =
    monto > 0
      ? monto
      : Math.max(0, montoCapital + montoIntereses + montoMoratorios + montoComisiones + montoIva);

  if (effectiveAmount <= 0) {
    const err = new Error("Debes enviar un monto mayor a 0.");
    err.statusCode = 400;
    throw err;
  }

  const tipo = normalizeTipoMovimiento(payload.tipo || payload.tipo_transaccion);

  validateMovementAgainstFinancing(financing, {
    ...payload,
    tipo,
    monto: effectiveAmount,
    monto_capital: montoCapital,
    monto_intereses: montoIntereses,
    monto_moratorios: montoMoratorios,
    monto_comisiones: montoComisiones,
  });

  const current = recalcFinancingSnapshot(financing);
  const nextState = applyMovementToFinancing(current, {
    tipo,
    monto: effectiveAmount,
    monto_capital: montoCapital,
    monto_intereses: montoIntereses,
    monto_moratorios: montoMoratorios,
    monto_comisiones: montoComisiones,
  });

  const movement = await FinancingMovement.create({
    owner,
    financingId: financing._id,
    tipo,
    subtipo: asTrim(payload.subtipo, ""),
    estatus: normalizeEstatusMovimiento(payload.estatus),
    fecha,

    monto: effectiveAmount,
    moneda: asTrim(payload.moneda || financing.moneda || "MXN", "MXN").toUpperCase(),
    tipo_cambio: Math.max(0, toNum(payload.tipo_cambio ?? payload.tipoCambio, financing.tipo_cambio || 1)) || 1,

    monto_capital: montoCapital,
    monto_intereses: montoIntereses,
    monto_moratorios: montoMoratorios,
    monto_comisiones: montoComisiones,
    monto_iva: montoIva,

    metodo_pago: asTrim(payload.metodo_pago ?? payload.metodoPago, ""),
    cuenta_destino: asTrim(payload.cuenta_destino ?? payload.cuentaDestino, ""),
    referencia: asTrim(payload.referencia ?? payload.numero_referencia, ""),
    beneficiario: asTrim(payload.beneficiario, ""),
    institucion: asTrim(payload.institucion || financing.institucion || "", ""),

    source: "financiamiento",
    sourceId: null,

    snapshot_after: {
      saldo_dispuesto_actual: nextState.saldo_dispuesto_actual,
      saldo_capital_actual: nextState.saldo_capital_actual,
      saldo_intereses_actual: nextState.saldo_intereses_actual,
      saldo_moratorios_actual: nextState.saldo_moratorios_actual,
      saldo_comisiones_actual: nextState.saldo_comisiones_actual,
      saldo_total_actual: nextState.saldo_total_actual,
      disponible_actual: nextState.disponible_actual,
    },

    descripcion: asTrim(payload.descripcion, ""),
    notas: asTrim(payload.notas, ""),
    tags: parseTags(payload.tags ?? payload.etiquetas),
    meta: payload.meta && typeof payload.meta === "object" ? payload.meta : {},
  });

  const journalEntryId = await createJournalEntryBestEffort({
    owner,
    financing,
    movement,
    movementId: movement._id,
  });

  const movementUpdated = await FinancingMovement.findOneAndUpdate(
    { _id: movement._id, owner },
    {
      $set: {
        sourceId: movement._id,
        journalEntryId: journalEntryId ? new mongoose.Types.ObjectId(journalEntryId) : undefined,
      },
    },
    { new: true }
  );

  const updated = await Financing.findOneAndUpdate(
    { _id: financing._id, owner },
    {
      $set: {
        saldo_dispuesto_actual: nextState.saldo_dispuesto_actual,
        saldo_capital_actual: nextState.saldo_capital_actual,
        saldo_intereses_actual: nextState.saldo_intereses_actual,
        saldo_moratorios_actual: nextState.saldo_moratorios_actual,
        saldo_comisiones_actual: nextState.saldo_comisiones_actual,
        saldo_total_actual: nextState.saldo_total_actual,
        disponible_actual: nextState.disponible_actual,

        total_dispuesto: nextState.total_dispuesto,
        total_amortizado_capital: nextState.total_amortizado_capital,
        total_intereses_cargados: nextState.total_intereses_cargados,
        total_intereses_pagados: nextState.total_intereses_pagados,
        total_comisiones_cargadas: nextState.total_comisiones_cargadas,
        total_comisiones_pagadas: nextState.total_comisiones_pagadas,

        ultimo_movimiento_at: movement.fecha || new Date(),
        ultimo_movimiento_tipo: movement.tipo,
        estatus: nextState.estatus,
      },
    },
    { new: true }
  );

  return {
    movement: movementUpdated || movement,
    financing: updated,
  };
}

// =====================================================
// Legacy routes: tarjetas de crédito
// =====================================================

router.get("/tarjetas-credito", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;
    const wrap = asTrim(req.query.wrap) === "1";
    const activo = asBool(req.query.activo, null);

    const filter = { owner };
    if (activo !== null) filter.activo = activo;

    const docs = await TarjetaCredito.find(filter).sort({ createdAt: -1 }).lean();
    const items = docs.map((d) => ({
      id: String(d._id),
      _id: d._id,
      nombre: d.nombre || "",
      banco: d.banco || "",
      ultimos4: d.ultimos4 || "",
      linea_credito: toNum(d.linea_credito, 0),
      saldo_actual: toNum(d.saldo_actual, 0),
      activo: !!d.activo,
      created_at: d.createdAt || null,
      updated_at: d.updatedAt || null,
      createdAt: d.createdAt || null,
      updatedAt: d.updatedAt || null,
    }));

    if (!wrap) return res.json(items);
    return res.json({ ok: true, data: items, items });
  } catch (err) {
    console.error("GET /api/financiamientos/tarjetas-credito error:", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

router.post("/tarjetas-credito", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;

    const nombre = asTrim(req.body?.nombre);
    const banco = asTrim(req.body?.banco, "");
    const ultimos4 = asTrim(req.body?.ultimos4, "");
    const linea_credito = toNum(req.body?.linea_credito, 0);
    const saldo_actual = toNum(req.body?.saldo_actual, 0);
    const activo = asBool(req.body?.activo, true);

    if (!nombre) {
      return res.status(400).json({
        ok: false,
        error: "VALIDATION",
        message: "nombre es requerido.",
      });
    }

    const created = await TarjetaCredito.create({
      owner,
      nombre,
      banco,
      ultimos4,
      linea_credito,
      saldo_actual,
      activo: activo !== null ? activo : true,
    });

    const item = {
      id: String(created._id),
      _id: created._id,
      nombre: created.nombre || "",
      banco: created.banco || "",
      ultimos4: created.ultimos4 || "",
      linea_credito: toNum(created.linea_credito, 0),
      saldo_actual: toNum(created.saldo_actual, 0),
      activo: !!created.activo,
      created_at: created.createdAt || null,
      updated_at: created.updatedAt || null,
    };

    return res.status(201).json({ ok: true, data: item, item, ...item });
  } catch (err) {
    console.error("POST /api/financiamientos/tarjetas-credito error:", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR", message: err?.message || "SERVER_ERROR" });
  }
});

// =====================================================
// Main routes: financiamientos
// =====================================================

router.get("/resumen", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;
    const docs = await Financing.find({ owner, activo: true }).lean();
    const items = docs.map(mapFinancingForUI);

    const resumen = {
      total: items.length,
      activos: items.filter((x) => x.estatus === "activo").length,
      liquidados: items.filter((x) => x.estatus === "liquidado").length,
      vencidos: items.filter((x) => x.estatus === "vencido").length,
      cancelados: items.filter((x) => x.estatus === "cancelado").length,

      saldo_total_actual: items.reduce((acc, x) => acc + toNum(x.saldo_total_actual, 0), 0),
      saldo_capital_actual: items.reduce((acc, x) => acc + toNum(x.saldo_capital_actual, 0), 0),
      saldo_intereses_actual: items.reduce((acc, x) => acc + toNum(x.saldo_intereses_actual, 0), 0),
      saldo_moratorios_actual: items.reduce((acc, x) => acc + toNum(x.saldo_moratorios_actual, 0), 0),
      saldo_comisiones_actual: items.reduce((acc, x) => acc + toNum(x.saldo_comisiones_actual, 0), 0),
      total_dispuesto: items.reduce((acc, x) => acc + toNum(x.total_dispuesto, 0), 0),
      total_amortizado_capital: items.reduce((acc, x) => acc + toNum(x.total_amortizado_capital, 0), 0),
      disponible_actual: items.reduce((acc, x) => acc + toNum(x.disponible_actual, 0), 0),
      linea_credito_total: items.reduce((acc, x) => acc + toNum(x.linea_credito, 0), 0),
    };

    return res.json({ ok: true, data: resumen, resumen });
  } catch (err) {
    console.error("GET /api/financiamientos/resumen error:", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR", message: err?.message || "SERVER_ERROR" });
  }
});

router.get("/transacciones", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;
    const wrap = asTrim(req.query.wrap) === "1";

    const financingId = asTrim(req.query.financingId || req.query.financiamientoId || req.query.financing_id, "");
    const tipo = asTrim(req.query.tipo || req.query.tipo_transaccion, "");
    const estatus = asTrim(req.query.estatus, "");
    const q = asTrim(req.query.q, "");
    const from = asDateOrNull(req.query.from || req.query.fechaInicio || req.query.start);
    const to = asDateOrNull(req.query.to || req.query.fechaFin || req.query.end);
    const limit = Math.max(1, Math.min(500, Math.trunc(toNum(req.query.limit, 200))));

    const filter = { owner };

    if (financingId && isValidObjectId(financingId)) {
      filter.financingId = financingId;
    }
    if (tipo) filter.tipo = normalizeTipoMovimiento(tipo);
    if (estatus) filter.estatus = normalizeEstatusMovimiento(estatus);
    if (from || to) {
      filter.fecha = {};
      if (from) filter.fecha.$gte = from;
      if (to) filter.fecha.$lte = to;
    }
    if (q) {
      filter.$or = [
        { descripcion: { $regex: q, $options: "i" } },
        { referencia: { $regex: q, $options: "i" } },
        { beneficiario: { $regex: q, $options: "i" } },
        { institucion: { $regex: q, $options: "i" } },
        { subtipo: { $regex: q, $options: "i" } },
      ];
    }

    const docs = await FinancingMovement.find(filter).sort({ fecha: -1, createdAt: -1 }).limit(limit).lean();
    const items = docs.map(mapMovementForUI);

    if (!wrap) return res.json(items);
    return res.json({ ok: true, data: items, items });
  } catch (err) {
    console.error("GET /api/financiamientos/transacciones error:", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR", message: err?.message || "SERVER_ERROR" });
  }
});

router.post("/transacciones", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;
    const financingId = asTrim(
      req.body?.financingId ||
        req.body?.financing_id ||
        req.body?.financiamientoId ||
        req.body?.financiamiento_id,
      ""
    );

    if (!isValidObjectId(financingId)) {
      return res.status(400).json({ ok: false, error: "VALIDATION", message: "financingId inválido" });
    }

    const financing = await Financing.findOne({ _id: financingId, owner });
    if (!financing) return res.status(404).json({ ok: false, error: "NOT_FOUND" });

    const result = await createMovementAndApply({
      owner,
      financing,
      payload: req.body,
    });

    const item = mapMovementForUI(result.movement);
    const financingItem = mapFinancingForUI(result.financing);

    return res.status(201).json({
      ok: true,
      data: item,
      item,
      movimiento: item,
      financing: financingItem,
      financiamiento: financingItem,
    });
  } catch (err) {
    console.error("POST /api/financiamientos/transacciones error:", err);
    const status = err?.statusCode || 500;
    return res.status(status).json({
      ok: false,
      error: status === 400 ? "VALIDATION" : "SERVER_ERROR",
      message: err?.message || "SERVER_ERROR",
    });
  }
});

router.post("/disposiciones", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;
    const financingId = asTrim(
      req.body?.financingId ||
        req.body?.financing_id ||
        req.body?.financiamientoId ||
        req.body?.financiamiento_id,
      ""
    );

    if (!isValidObjectId(financingId)) {
      return res.status(400).json({ ok: false, error: "VALIDATION", message: "financingId inválido" });
    }

    const financing = await Financing.findOne({ _id: financingId, owner });
    if (!financing) return res.status(404).json({ ok: false, error: "NOT_FOUND" });

    const tipoFin = getUiTipoFromFinancingLike(financing);
    if (tipoFin !== "revolvente") {
      return res.status(400).json({
        ok: false,
        error: "VALIDATION",
        message: "La disposición solo aplica a créditos revolventes.",
      });
    }

    const result = await createMovementAndApply({
      owner,
      financing,
      payload: {
        ...req.body,
        tipo: "disposicion",
        monto_capital: req.body?.monto_capital ?? req.body?.montoCapital ?? req.body?.monto,
      },
    });

    const item = mapMovementForUI(result.movement);
    const financingItem = mapFinancingForUI(result.financing);

    return res.status(201).json({
      ok: true,
      data: item,
      item,
      movimiento: item,
      financing: financingItem,
      financiamiento: financingItem,
    });
  } catch (err) {
    console.error("POST /api/financiamientos/disposiciones error:", err);
    const status = err?.statusCode || 500;
    return res.status(status).json({
      ok: false,
      error: status === 400 ? "VALIDATION" : "SERVER_ERROR",
      message: err?.message || "SERVER_ERROR",
    });
  }
});

router.get("/", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;
    const wrap = asTrim(req.query.wrap) === "1";

    const activo = asBool(req.query.activo, true);
    const tipo = asTrim(req.query.tipo || req.query.tipo_credito, "");
    const categoria = asTrim(req.query.categoria, "");
    const estatus = asTrim(req.query.estatus || req.query.estado, "");
    const q = asTrim(req.query.q, "");
    const institucionId = asTrim(req.query.institucion_id || req.query.institucionId || req.query.institucion_financiera_id, "");

    const filter = { owner };
    if (activo !== null) filter.activo = !!activo;
    if (tipo) filter.tipo = normalizeTipoFinanciamiento(tipo);
    if (categoria) filter.categoria = normalizeCategoriaFinanciamiento(categoria);
    if (estatus) filter.estatus = normalizeEstatusFinanciamiento(estatus);
    if (institucionId && isValidObjectId(institucionId)) {
      filter.institucion_id = institucionId;
    }
    if (q) {
      filter.$or = [
        { nombre: { $regex: q, $options: "i" } },
        { alias: { $regex: q, $options: "i" } },
        { institucion: { $regex: q, $options: "i" } },
        { numero_contrato: { $regex: q, $options: "i" } },
        { numero_cuenta: { $regex: q, $options: "i" } },
        { referencia: { $regex: q, $options: "i" } },
      ];
    }

    const docs = await Financing.find(filter).sort({ createdAt: -1 }).lean();
    const items = docs.map(mapFinancingForUI);

    if (!wrap) return res.json(items);
    return res.json({ ok: true, data: items, items });
  } catch (err) {
    console.error("GET /api/financiamientos error:", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR", message: err?.message || "SERVER_ERROR" });
  }
});

router.post("/", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;

    const nombre = asTrim(req.body?.nombre || req.body?.name);
    if (!nombre) {
      return res.status(400).json({
        ok: false,
        error: "VALIDATION",
        message: "nombre es requerido.",
      });
    }

    const tipoNormalized = normalizeTipoFinanciamiento(req.body?.tipo || req.body?.tipo_credito);
    const uiTipo = getUiTipoFromFinancingLike({ tipo: tipoNormalized });

    const allowedCreateTypes = new Set(["credito_simple", "linea_credito", "tarjeta_credito"]);
    if (!allowedCreateTypes.has(tipoNormalized)) {
      return res.status(400).json({
        ok: false,
        error: "VALIDATION",
        message: "Solo se permite registrar crédito simple, crédito revolvente o tarjeta de crédito.",
      });
    }

    const montoTotalLegacy = Math.max(0, toNum(req.body?.monto_total, 0));
    const montoOriginal = Math.max(
      0,
      toNum(req.body?.monto_original ?? req.body?.montoOriginal, uiTipo === "simple" ? montoTotalLegacy : 0)
    );
    const lineaCredito = Math.max(
      0,
      toNum(req.body?.linea_credito ?? req.body?.lineaCredito, uiTipo !== "simple" ? montoTotalLegacy : 0)
    );

    const montoDispuestoInicial =
      uiTipo === "simple"
        ? Math.max(
            0,
            toNum(
              req.body?.monto_dispuesto_inicial ??
                req.body?.montoDispuestoInicial ??
                req.body?.saldo_inicial ??
                req.body?.monto_total,
              0
            )
          )
        : Math.max(
            0,
            toNum(req.body?.monto_dispuesto_inicial ?? req.body?.montoDispuestoInicial, 0)
          );

    const payload = {
      owner,
      nombre,
      alias: asTrim(req.body?.alias, ""),

      institucion: asTrim(req.body?.institucion ?? req.body?.institucion_financiera, ""),
      institucion_id: asObjectIdOrNull(
        req.body?.institucion_id ?? req.body?.institucionId ?? req.body?.institucion_financiera_id
      ),

      tipo: tipoNormalized,
      subtipo: asTrim(req.body?.subtipo, ""),
      categoria: normalizeCategoriaFinanciamiento(req.body?.categoria),
      estatus: normalizeEstatusFinanciamiento(req.body?.estatus ?? req.body?.estado),
      activo: asBool(req.body?.activo, true) !== false,

      numero_contrato: asTrim(req.body?.numero_contrato ?? req.body?.numeroContrato, ""),
      numero_cuenta: asTrim(req.body?.numero_cuenta ?? req.body?.numeroCuenta, ""),
      referencia: asTrim(req.body?.referencia, ""),

      moneda: asTrim(req.body?.moneda, "MXN").toUpperCase() || "MXN",
      tipo_cambio: Math.max(0, toNum(req.body?.tipo_cambio ?? req.body?.tipoCambio, 1)) || 1,

      fecha_apertura: asDateOrNull(req.body?.fecha_apertura ?? req.body?.fechaApertura ?? req.body?.fecha_inicio),
      fecha_inicio: asDateOrNull(req.body?.fecha_inicio ?? req.body?.fechaInicio),
      fecha_vencimiento: asDateOrNull(req.body?.fecha_vencimiento ?? req.body?.fechaVencimiento),
      fecha_corte: req.body?.fecha_corte ?? req.body?.fechaCorte ?? null,
      fecha_pago: req.body?.fecha_pago ?? req.body?.fechaPago ?? null,

      linea_credito: lineaCredito,
      monto_original: montoOriginal,
      monto_dispuesto_inicial: montoDispuestoInicial,

      tasa_interes_anual: Math.max(
        0,
        toNum(req.body?.tasa_interes_anual ?? req.body?.tasaInteresAnual ?? req.body?.tasa_interes, 0)
      ),
      tasa_interes_mensual: Math.max(0, toNum(req.body?.tasa_interes_mensual ?? req.body?.tasaInteresMensual, 0)),
      tasa_moratoria_anual: Math.max(
        0,
        toNum(req.body?.tasa_moratoria_anual ?? req.body?.tasaMoratoriaAnual, 0)
      ),

      comision_apertura: Math.max(0, toNum(req.body?.comision_apertura ?? req.body?.comisionApertura, 0)),
      comision_disposicion: Math.max(
        0,
        toNum(req.body?.comision_disposicion ?? req.body?.comisionDisposicion, 0)
      ),

      plazo_meses: Math.max(
        0,
        Math.trunc(toNum(req.body?.plazo_meses ?? req.body?.plazoMeses, 0))
      ),
      pago_periodico_estimado: Math.max(
        0,
        toNum(req.body?.pago_periodico_estimado ?? req.body?.pagoPeriodicoEstimado, 0)
      ),
      periodicidad_pago: normalizePeriodicidad(req.body?.periodicidad_pago ?? req.body?.periodicidadPago),

      saldo_dispuesto_actual: 0,
      saldo_capital_actual: 0,
      saldo_intereses_actual: 0,
      saldo_moratorios_actual: 0,
      saldo_comisiones_actual: 0,
      saldo_total_actual: 0,
      disponible_actual: 0,

      total_dispuesto: 0,
      total_amortizado_capital: 0,
      total_intereses_cargados: 0,
      total_intereses_pagados: 0,
      total_comisiones_cargadas: 0,
      total_comisiones_pagadas: 0,

      cuenta_pasivo_codigo: asTrim(req.body?.cuenta_pasivo_codigo ?? req.body?.cuentaPasivoCodigo, ""),
      cuenta_pasivo_nombre: asTrim(req.body?.cuenta_pasivo_nombre ?? req.body?.cuentaPasivoNombre, ""),
      cuenta_intereses_codigo: asTrim(req.body?.cuenta_intereses_codigo ?? req.body?.cuentaInteresesCodigo, ""),
      cuenta_intereses_nombre: asTrim(req.body?.cuenta_intereses_nombre ?? req.body?.cuentaInteresesNombre, ""),
      cuenta_bancos_codigo: asTrim(req.body?.cuenta_bancos_codigo ?? req.body?.cuentaBancosCodigo, ""),
      cuenta_bancos_nombre: asTrim(req.body?.cuenta_bancos_nombre ?? req.body?.cuentaBancosNombre, ""),

      descripcion: asTrim(req.body?.descripcion, ""),
      notas: asTrim(req.body?.notas ?? req.body?.condiciones, ""),
      etiquetas: parseTags(req.body?.etiquetas),
    };

    let financing = await Financing.create(payload);

    if (montoDispuestoInicial > 0) {
      const result = await createMovementAndApply({
        owner,
        financing,
        payload: {
          tipo: "apertura",
          fecha: payload.fecha_apertura || payload.fecha_inicio || new Date(),
          monto: montoDispuestoInicial,
          monto_capital: montoDispuestoInicial,
          moneda: payload.moneda,
          tipo_cambio: payload.tipo_cambio,
          referencia: payload.referencia || "",
          descripcion: asTrim(req.body?.descripcion_apertura || "Apertura del financiamiento"),
          notas: asTrim(req.body?.notas_apertura || req.body?.notas || "", ""),
          etiquetas: parseTags(req.body?.etiquetas),
        },
      });

      financing = result.financing;
    } else {
      const nextState = recalcFinancingSnapshot(financing);
      financing = await Financing.findOneAndUpdate(
        { _id: financing._id, owner },
        {
          $set: {
            saldo_total_actual: nextState.saldo_total_actual,
            disponible_actual: nextState.disponible_actual,
            estatus: nextState.estatus,
          },
        },
        { new: true }
      );
    }

    const item = mapFinancingForUI(financing);
    return res.status(201).json({ ok: true, data: item, item, ...item });
  } catch (err) {
    console.error("POST /api/financiamientos error:", err);
    return res.status(500).json({
      ok: false,
      error: "SERVER_ERROR",
      message: err?.message || "SERVER_ERROR",
    });
  }
});

router.get("/:id/movimientos", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;
    const id = asTrim(req.params.id, "");
    const wrap = asTrim(req.query.wrap) === "1";

    if (!isValidObjectId(id)) {
      return res.status(400).json({ ok: false, error: "VALIDATION", message: "id inválido" });
    }

    const exists = await Financing.exists({ _id: id, owner });
    if (!exists) return res.status(404).json({ ok: false, error: "NOT_FOUND" });

    const tipo = asTrim(req.query.tipo || req.query.tipo_transaccion, "");
    const estatus = asTrim(req.query.estatus, "");
    const from = asDateOrNull(req.query.from || req.query.fechaInicio || req.query.start);
    const to = asDateOrNull(req.query.to || req.query.fechaFin || req.query.end);
    const limit = Math.max(1, Math.min(500, Math.trunc(toNum(req.query.limit, 200))));

    const filter = { owner, financingId: id };
    if (tipo) filter.tipo = normalizeTipoMovimiento(tipo);
    if (estatus) filter.estatus = normalizeEstatusMovimiento(estatus);
    if (from || to) {
      filter.fecha = {};
      if (from) filter.fecha.$gte = from;
      if (to) filter.fecha.$lte = to;
    }

    const docs = await FinancingMovement.find(filter).sort({ fecha: -1, createdAt: -1 }).limit(limit).lean();
    const items = docs.map(mapMovementForUI);

    if (!wrap) return res.json(items);
    return res.json({ ok: true, data: items, items });
  } catch (err) {
    console.error("GET /api/financiamientos/:id/movimientos error:", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR", message: err?.message || "SERVER_ERROR" });
  }
});

router.get("/:id/transacciones", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;
    const id = asTrim(req.params.id, "");

    if (!isValidObjectId(id)) {
      return res.status(400).json({ ok: false, error: "VALIDATION", message: "id inválido" });
    }

    const exists = await Financing.exists({ _id: id, owner });
    if (!exists) return res.status(404).json({ ok: false, error: "NOT_FOUND" });

    const docs = await FinancingMovement.find({ owner, financingId: id })
      .sort({ fecha: -1, createdAt: -1 })
      .lean();

    const items = docs.map(mapMovementForUI);
    return res.json({ ok: true, data: items, items });
  } catch (err) {
    console.error("GET /api/financiamientos/:id/transacciones error:", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR", message: err?.message || "SERVER_ERROR" });
  }
});

router.get("/:id/tarjeta/transacciones", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;
    const id = asTrim(req.params.id, "");

    if (!isValidObjectId(id)) {
      return res.status(400).json({ ok: false, error: "VALIDATION", message: "id inválido" });
    }

    const financing = await Financing.findOne({ _id: id, owner }).lean();
    if (!financing) return res.status(404).json({ ok: false, error: "NOT_FOUND" });

    const docs = await FinancingMovement.find({ owner, financingId: id })
      .sort({ fecha: -1, createdAt: -1 })
      .lean();

    const items = docs.map(buildTarjetaTxForUI);
    return res.json({ ok: true, data: items, items });
  } catch (err) {
    console.error("GET /api/financiamientos/:id/tarjeta/transacciones error:", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR", message: err?.message || "SERVER_ERROR" });
  }
});

router.post("/:id/movimientos", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;
    const id = asTrim(req.params.id, "");

    if (!isValidObjectId(id)) {
      return res.status(400).json({ ok: false, error: "VALIDATION", message: "id inválido" });
    }

    const financing = await Financing.findOne({ _id: id, owner });
    if (!financing) return res.status(404).json({ ok: false, error: "NOT_FOUND" });

    const result = await createMovementAndApply({
      owner,
      financing,
      payload: req.body,
    });

    const item = mapMovementForUI(result.movement);
    const financingItem = mapFinancingForUI(result.financing);

    return res.status(201).json({
      ok: true,
      data: item,
      item,
      movimiento: item,
      financing: financingItem,
      financiamiento: financingItem,
    });
  } catch (err) {
    console.error("POST /api/financiamientos/:id/movimientos error:", err);
    const status = err?.statusCode || 500;
    return res.status(status).json({
      ok: false,
      error: status === 400 ? "VALIDATION" : "SERVER_ERROR",
      message: err?.message || "SERVER_ERROR",
    });
  }
});

// Aliases semánticos correctos
router.post("/:id/disposicion", ensureAuth, async (req, res) => {
  req.body = { ...req.body, tipo: "disposicion" };
  req.url = `/${req.params.id}/movimientos`;
  return router.handle(req, res);
});

router.post("/:id/amortizacion", ensureAuth, async (req, res) => {
  req.body = { ...req.body, tipo: "amortizacion" };
  req.url = `/${req.params.id}/movimientos`;
  return router.handle(req, res);
});

router.post("/:id/intereses", ensureAuth, async (req, res) => {
  req.body = { ...req.body, tipo: "cargo_intereses" };
  req.url = `/${req.params.id}/movimientos`;
  return router.handle(req, res);
});

router.post("/:id/pago-intereses", ensureAuth, async (req, res) => {
  req.body = { ...req.body, tipo: "pago_intereses" };
  req.url = `/${req.params.id}/movimientos`;
  return router.handle(req, res);
});

router.post("/:id/comision", ensureAuth, async (req, res) => {
  req.body = { ...req.body, tipo: "cargo_comision" };
  req.url = `/${req.params.id}/movimientos`;
  return router.handle(req, res);
});

router.post("/:id/pago-comision", ensureAuth, async (req, res) => {
  req.body = { ...req.body, tipo: "pago_comision" };
  req.url = `/${req.params.id}/movimientos`;
  return router.handle(req, res);
});

router.get("/:id", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;
    const id = asTrim(req.params.id, "");

    if (!isValidObjectId(id)) {
      return res.status(400).json({ ok: false, error: "VALIDATION", message: "id inválido" });
    }

    const doc = await Financing.findOne({ _id: id, owner }).lean();
    if (!doc) return res.status(404).json({ ok: false, error: "NOT_FOUND" });

    const item = mapFinancingForUI(doc);
    return res.json({ ok: true, data: item, item, ...item });
  } catch (err) {
    console.error("GET /api/financiamientos/:id error:", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR", message: err?.message || "SERVER_ERROR" });
  }
});

router.patch("/:id", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;
    const id = asTrim(req.params.id, "");

    if (!isValidObjectId(id)) {
      return res.status(400).json({ ok: false, error: "VALIDATION", message: "id inválido" });
    }

    const current = await Financing.findOne({ _id: id, owner }).lean();
    if (!current) return res.status(404).json({ ok: false, error: "NOT_FOUND" });

    const patch = {};

    if (req.body?.nombre !== undefined || req.body?.name !== undefined) {
      patch.nombre = asTrim(req.body?.nombre || req.body?.name, "");
      if (!patch.nombre) {
        return res.status(400).json({
          ok: false,
          error: "VALIDATION",
          message: "nombre no puede ir vacío.",
        });
      }
    }

    if (req.body?.alias !== undefined) patch.alias = asTrim(req.body?.alias, "");
    if (req.body?.institucion !== undefined || req.body?.institucion_financiera !== undefined) {
      patch.institucion = asTrim(req.body?.institucion ?? req.body?.institucion_financiera, "");
    }
    if (
      req.body?.institucion_id !== undefined ||
      req.body?.institucionId !== undefined ||
      req.body?.institucion_financiera_id !== undefined
    ) {
      patch.institucion_id = asObjectIdOrNull(
        req.body?.institucion_id ?? req.body?.institucionId ?? req.body?.institucion_financiera_id
      );
    }

    if (req.body?.tipo !== undefined || req.body?.tipo_credito !== undefined) {
      patch.tipo = normalizeTipoFinanciamiento(req.body?.tipo ?? req.body?.tipo_credito);
    }
    if (req.body?.subtipo !== undefined) patch.subtipo = asTrim(req.body?.subtipo, "");
    if (req.body?.categoria !== undefined) patch.categoria = normalizeCategoriaFinanciamiento(req.body?.categoria);
    if (req.body?.estatus !== undefined || req.body?.estado !== undefined) {
      patch.estatus = normalizeEstatusFinanciamiento(req.body?.estatus ?? req.body?.estado);
    }
    if (req.body?.activo !== undefined) patch.activo = asBool(req.body?.activo, true);

    if (req.body?.numero_contrato !== undefined || req.body?.numeroContrato !== undefined) {
      patch.numero_contrato = asTrim(req.body?.numero_contrato ?? req.body?.numeroContrato, "");
    }
    if (req.body?.numero_cuenta !== undefined || req.body?.numeroCuenta !== undefined) {
      patch.numero_cuenta = asTrim(req.body?.numero_cuenta ?? req.body?.numeroCuenta, "");
    }
    if (req.body?.referencia !== undefined) patch.referencia = asTrim(req.body?.referencia, "");

    if (req.body?.moneda !== undefined) patch.moneda = asTrim(req.body?.moneda, "MXN").toUpperCase() || "MXN";
    if (req.body?.tipo_cambio !== undefined || req.body?.tipoCambio !== undefined) {
      patch.tipo_cambio = Math.max(0, toNum(req.body?.tipo_cambio ?? req.body?.tipoCambio, 1)) || 1;
    }

    if (req.body?.fecha_apertura !== undefined || req.body?.fechaApertura !== undefined) {
      patch.fecha_apertura = asDateOrNull(req.body?.fecha_apertura ?? req.body?.fechaApertura);
    }
    if (req.body?.fecha_inicio !== undefined || req.body?.fechaInicio !== undefined) {
      patch.fecha_inicio = asDateOrNull(req.body?.fecha_inicio ?? req.body?.fechaInicio);
    }
    if (req.body?.fecha_vencimiento !== undefined || req.body?.fechaVencimiento !== undefined) {
      patch.fecha_vencimiento = asDateOrNull(req.body?.fecha_vencimiento ?? req.body?.fechaVencimiento);
    }
    if (req.body?.fecha_corte !== undefined || req.body?.fechaCorte !== undefined) {
      patch.fecha_corte = req.body?.fecha_corte ?? req.body?.fechaCorte ?? null;
    }
    if (req.body?.fecha_pago !== undefined || req.body?.fechaPago !== undefined) {
      patch.fecha_pago = req.body?.fecha_pago ?? req.body?.fechaPago ?? null;
    }

    if (
      req.body?.linea_credito !== undefined ||
      req.body?.lineaCredito !== undefined ||
      req.body?.monto_total !== undefined
    ) {
      patch.linea_credito = Math.max(
        0,
        toNum(req.body?.linea_credito ?? req.body?.lineaCredito ?? req.body?.monto_total, 0)
      );
    }
    if (
      req.body?.monto_original !== undefined ||
      req.body?.montoOriginal !== undefined ||
      req.body?.saldo_inicial !== undefined
    ) {
      patch.monto_original = Math.max(
        0,
        toNum(req.body?.monto_original ?? req.body?.montoOriginal ?? req.body?.saldo_inicial, 0)
      );
    }

    if (
      req.body?.tasa_interes_anual !== undefined ||
      req.body?.tasaInteresAnual !== undefined ||
      req.body?.tasa_interes !== undefined
    ) {
      patch.tasa_interes_anual = Math.max(
        0,
        toNum(req.body?.tasa_interes_anual ?? req.body?.tasaInteresAnual ?? req.body?.tasa_interes, 0)
      );
    }

    if (req.body?.plazo_meses !== undefined || req.body?.plazoMeses !== undefined) {
      patch.plazo_meses = Math.max(0, Math.trunc(toNum(req.body?.plazo_meses ?? req.body?.plazoMeses, 0)));
    }

    if (req.body?.descripcion !== undefined) patch.descripcion = asTrim(req.body?.descripcion, "");
    if (req.body?.notas !== undefined || req.body?.condiciones !== undefined) {
      patch.notas = asTrim(req.body?.notas ?? req.body?.condiciones, "");
    }
    if (req.body?.etiquetas !== undefined) patch.etiquetas = parseTags(req.body?.etiquetas);

    const merged = recalcFinancingSnapshot({ ...current, ...patch });

    const updated = await Financing.findOneAndUpdate(
      { _id: id, owner },
      {
        $set: {
          ...patch,
          saldo_total_actual: merged.saldo_total_actual,
          disponible_actual: merged.disponible_actual,
          estatus: merged.estatus,
        },
      },
      { new: true }
    ).lean();

    if (!updated) return res.status(404).json({ ok: false, error: "NOT_FOUND" });

    const item = mapFinancingForUI(updated);
    return res.json({ ok: true, data: item, item, ...item });
  } catch (err) {
    console.error("PATCH /api/financiamientos/:id error:", err);
    return res.status(500).json({
      ok: false,
      error: "SERVER_ERROR",
      message: err?.message || "SERVER_ERROR",
    });
  }
});

router.delete("/:id", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;
    const id = asTrim(req.params.id, "");

    if (!isValidObjectId(id)) {
      return res.status(400).json({ ok: false, error: "VALIDATION", message: "id inválido" });
    }

    const deleted = await Financing.findOneAndDelete({ _id: id, owner }).lean();
    if (!deleted) return res.status(404).json({ ok: false, error: "NOT_FOUND" });

    await FinancingMovement.deleteMany({ owner, financingId: id });

    return res.json({ ok: true, data: { id }, id });
  } catch (err) {
    console.error("DELETE /api/financiamientos/:id error:", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

module.exports = router;