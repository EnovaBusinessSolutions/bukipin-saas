// backend/routes/financiamientos.js
const express = require("express");
const mongoose = require("mongoose");
const ensureAuth = require("../middleware/ensureAuth");

const Financing = require("../models/Financing");
const FinancingMovement = require("../models/FinancingMovement");

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
  const allowed = new Set([
    "prestamo",
    "credito_simple",
    "linea_credito",
    "tarjeta_credito",
    "arrendamiento",
    "hipoteca",
    "factoraje",
    "otro",
  ]);
  return allowed.has(s) ? s : "prestamo";
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
  const allowed = new Set(["activo", "liquidado", "vencido", "cancelado", "suspendido"]);
  return allowed.has(s) ? s : "activo";
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
  const allowed = new Set([
    "apertura",
    "disposicion",
    "amortizacion",
    "cargo_intereses",
    "pago_intereses",
    "cargo_comision",
    "pago_comision",
    "cargo_moratorio",
    "ajuste",
    "cancelacion",
    "refinanciamiento",
    "otro",
  ]);
  return allowed.has(s) ? s : "otro";
}

function normalizeEstatusMovimiento(v) {
  const s = asTrim(v, "").toLowerCase();
  const allowed = new Set(["aplicado", "pendiente", "cancelado"]);
  return allowed.has(s) ? s : "aplicado";
}

function sortByFechaDesc(a, b) {
  const af = new Date(a?.fecha || a?.createdAt || 0).getTime();
  const bf = new Date(b?.fecha || b?.createdAt || 0).getTime();
  return bf - af;
}

function mapTarjetaForUI(doc) {
  const d = doc?.toObject ? doc.toObject() : doc || {};
  return {
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
  };
}

function mapFinancingForUI(doc) {
  const d = doc?.toObject ? doc.toObject() : doc || {};
  const institucionId = d.institucion_id ? String(d.institucion_id) : "";

  return {
    id: String(d._id || ""),
    _id: d._id || null,

    nombre: d.nombre || "",
    alias: d.alias || "",

    institucion: d.institucion || "",
    institucion_id: institucionId || "",
    institucionId: institucionId || "",

    tipo: d.tipo || "prestamo",
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
}

function mapMovementForUI(doc) {
  const d = doc?.toObject ? doc.toObject() : doc || {};
  const snap = d.snapshot_after || {};

  return {
    id: String(d._id || ""),
    _id: d._id || null,

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

  if (toNum(f.saldo_total_actual, 0) <= 0) {
    if (["cancelado", "suspendido"].includes(asTrim(f.estatus, "").toLowerCase())) {
      // no tocar
    } else {
      f.estatus = "liquidado";
    }
  } else if (["liquidado"].includes(asTrim(f.estatus, "").toLowerCase())) {
    f.estatus = "activo";
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
      const capital = montoCapital || monto;
      f.saldo_capital_actual = Math.max(0, f.saldo_capital_actual - capital);
      f.saldo_dispuesto_actual = Math.max(0, f.saldo_dispuesto_actual - capital);
      f.total_amortizado_capital += capital;
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

    case "ajuste":
    case "refinanciamiento":
    case "otro":
    default:
      break;
  }

  return recalcFinancingSnapshot(f);
}

async function getFinancingOr404(owner, id) {
  if (!isValidObjectId(id)) return null;
  return Financing.findOne({ _id: id, owner });
}

function parseTags(v) {
  if (Array.isArray(v)) {
    return v.map((x) => asTrim(x)).filter(Boolean);
  }
  const s = asTrim(v, "");
  if (!s) return [];
  return s.split(",").map((x) => x.trim()).filter(Boolean);
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
    const items = docs.map(mapTarjetaForUI);

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

    const item = mapTarjetaForUI(created);
    return res.status(201).json({ ok: true, data: item, item, ...item });
  } catch (err) {
    console.error("POST /api/financiamientos/tarjetas-credito error:", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR", message: err?.message || "SERVER_ERROR" });
  }
});

router.patch("/tarjetas-credito/:id", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;
    const id = asTrim(req.params.id, "");

    if (!isValidObjectId(id)) {
      return res.status(400).json({ ok: false, error: "VALIDATION", message: "id inválido" });
    }

    const patch = {};
    if (req.body?.nombre !== undefined) patch.nombre = asTrim(req.body?.nombre, "");
    if (req.body?.banco !== undefined) patch.banco = asTrim(req.body?.banco, "");
    if (req.body?.ultimos4 !== undefined) patch.ultimos4 = asTrim(req.body?.ultimos4, "");
    if (req.body?.linea_credito !== undefined) patch.linea_credito = toNum(req.body?.linea_credito, 0);
    if (req.body?.saldo_actual !== undefined) patch.saldo_actual = toNum(req.body?.saldo_actual, 0);
    if (req.body?.activo !== undefined) patch.activo = asBool(req.body?.activo, true);

    if (patch.nombre !== undefined && !patch.nombre) {
      return res.status(400).json({ ok: false, error: "VALIDATION", message: "nombre no puede ir vacío." });
    }

    const updated = await TarjetaCredito.findOneAndUpdate({ _id: id, owner }, patch, { new: true }).lean();
    if (!updated) return res.status(404).json({ ok: false, error: "NOT_FOUND" });

    const item = mapTarjetaForUI(updated);
    return res.json({ ok: true, data: item, item, ...item });
  } catch (err) {
    console.error("PATCH /api/financiamientos/tarjetas-credito/:id error:", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR", message: err?.message || "SERVER_ERROR" });
  }
});

router.delete("/tarjetas-credito/:id", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;
    const id = asTrim(req.params.id, "");

    if (!isValidObjectId(id)) {
      return res.status(400).json({ ok: false, error: "VALIDATION", message: "id inválido" });
    }

    const deleted = await TarjetaCredito.findOneAndDelete({ _id: id, owner }).lean();
    if (!deleted) return res.status(404).json({ ok: false, error: "NOT_FOUND" });

    return res.json({ ok: true, data: { id }, id });
  } catch (err) {
    console.error("DELETE /api/financiamientos/tarjetas-credito/:id error:", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

// =====================================================
// Main routes: financiamientos
// =====================================================

/**
 * GET /api/financiamientos/resumen
 */
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

/**
 * GET /api/financiamientos/transacciones
 * Query:
 * - financingId / financiamientoId
 * - tipo
 * - estatus
 * - q
 * - from / to
 * - limit
 * - wrap=1
 */
router.get("/transacciones", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;
    const wrap = asTrim(req.query.wrap) === "1";

    const financingId = asTrim(req.query.financingId || req.query.financiamientoId, "");
    const tipo = asTrim(req.query.tipo, "");
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

/**
 * GET /api/financiamientos
 * Devuelve ARRAY por default
 */
router.get("/", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;
    const wrap = asTrim(req.query.wrap) === "1";

    const activo = asBool(req.query.activo, true);
    const tipo = asTrim(req.query.tipo, "");
    const categoria = asTrim(req.query.categoria, "");
    const estatus = asTrim(req.query.estatus, "");
    const q = asTrim(req.query.q, "");

    const filter = { owner };
    if (activo !== null) filter.activo = !!activo;
    if (tipo) filter.tipo = normalizeTipoFinanciamiento(tipo);
    if (categoria) filter.categoria = normalizeCategoriaFinanciamiento(categoria);
    if (estatus) filter.estatus = normalizeEstatusFinanciamiento(estatus);
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

/**
 * POST /api/financiamientos
 */
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

    const montoDispuestoInicial = Math.max(
      0,
      toNum(req.body?.monto_dispuesto_inicial ?? req.body?.montoDispuestoInicial, 0)
    );

    const payload = {
      owner,
      nombre,
      alias: asTrim(req.body?.alias, ""),

      institucion: asTrim(req.body?.institucion, ""),
      institucion_id: asObjectIdOrNull(req.body?.institucion_id ?? req.body?.institucionId),

      tipo: normalizeTipoFinanciamiento(req.body?.tipo),
      subtipo: asTrim(req.body?.subtipo, ""),
      categoria: normalizeCategoriaFinanciamiento(req.body?.categoria),
      estatus: normalizeEstatusFinanciamiento(req.body?.estatus),
      activo: asBool(req.body?.activo, true) !== false,

      numero_contrato: asTrim(req.body?.numero_contrato ?? req.body?.numeroContrato, ""),
      numero_cuenta: asTrim(req.body?.numero_cuenta ?? req.body?.numeroCuenta, ""),
      referencia: asTrim(req.body?.referencia, ""),

      moneda: asTrim(req.body?.moneda, "MXN").toUpperCase() || "MXN",
      tipo_cambio: Math.max(0, toNum(req.body?.tipo_cambio ?? req.body?.tipoCambio, 1)) || 1,

      fecha_apertura: asDateOrNull(req.body?.fecha_apertura ?? req.body?.fechaApertura),
      fecha_inicio: asDateOrNull(req.body?.fecha_inicio ?? req.body?.fechaInicio),
      fecha_vencimiento: asDateOrNull(req.body?.fecha_vencimiento ?? req.body?.fechaVencimiento),
      fecha_corte: req.body?.fecha_corte ?? req.body?.fechaCorte ?? null,
      fecha_pago: req.body?.fecha_pago ?? req.body?.fechaPago ?? null,

      linea_credito: Math.max(0, toNum(req.body?.linea_credito ?? req.body?.lineaCredito, 0)),
      monto_original: Math.max(0, toNum(req.body?.monto_original ?? req.body?.montoOriginal, 0)),
      monto_dispuesto_inicial: montoDispuestoInicial,

      tasa_interes_anual: Math.max(0, toNum(req.body?.tasa_interes_anual ?? req.body?.tasaInteresAnual, 0)),
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

      plazo_meses: Math.max(0, Math.trunc(toNum(req.body?.plazo_meses ?? req.body?.plazoMeses, 0))),
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
      notas: asTrim(req.body?.notas, ""),
      etiquetas: parseTags(req.body?.etiquetas),
    };

    let financing = await Financing.create(payload);

    if (montoDispuestoInicial > 0) {
      const nextState = applyMovementToFinancing(financing, {
        tipo: "apertura",
        monto: montoDispuestoInicial,
        monto_capital: montoDispuestoInicial,
      });

      financing = await Financing.findOneAndUpdate(
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

            ultimo_movimiento_at: new Date(),
            ultimo_movimiento_tipo: "apertura",
            estatus: nextState.estatus,
          },
        },
        { new: true }
      );

      await FinancingMovement.create({
        owner,
        financingId: financing._id,
        tipo: "apertura",
        estatus: "aplicado",
        fecha: payload.fecha_apertura || payload.fecha_inicio || new Date(),
        monto: montoDispuestoInicial,
        moneda: payload.moneda,
        tipo_cambio: payload.tipo_cambio,
        monto_capital: montoDispuestoInicial,
        monto_intereses: 0,
        monto_moratorios: 0,
        monto_comisiones: 0,
        monto_iva: 0,
        metodo_pago: "",
        cuenta_destino: "",
        referencia: payload.referencia || "",
        beneficiario: "",
        institucion: payload.institucion || "",
        source: "financiamiento",
        sourceId: financing._id,
        snapshot_after: {
          saldo_dispuesto_actual: nextState.saldo_dispuesto_actual,
          saldo_capital_actual: nextState.saldo_capital_actual,
          saldo_intereses_actual: nextState.saldo_intereses_actual,
          saldo_moratorios_actual: nextState.saldo_moratorios_actual,
          saldo_comisiones_actual: nextState.saldo_comisiones_actual,
          saldo_total_actual: nextState.saldo_total_actual,
          disponible_actual: nextState.disponible_actual,
        },
        descripcion: asTrim(req.body?.descripcion_apertura ?? "Apertura del financiamiento"),
        notas: asTrim(req.body?.notas_apertura ?? req.body?.notas, ""),
        tags: parseTags(req.body?.etiquetas),
        meta: {},
      });
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

/**
 * GET /api/financiamientos/:id/movimientos
 */
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

    const tipo = asTrim(req.query.tipo, "");
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

/**
 * POST /api/financiamientos/:id/movimientos
 */
router.post("/:id/movimientos", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;
    const id = asTrim(req.params.id, "");

    if (!isValidObjectId(id)) {
      return res.status(400).json({ ok: false, error: "VALIDATION", message: "id inválido" });
    }

    const financing = await Financing.findOne({ _id: id, owner });
    if (!financing) return res.status(404).json({ ok: false, error: "NOT_FOUND" });

    const tipo = normalizeTipoMovimiento(req.body?.tipo);
    const fecha = asDateOrNull(req.body?.fecha) || new Date();

    const monto = Math.max(0, toNum(req.body?.monto, 0));
    const montoCapital = Math.max(0, toNum(req.body?.monto_capital ?? req.body?.montoCapital, 0));
    const montoIntereses = Math.max(0, toNum(req.body?.monto_intereses ?? req.body?.montoIntereses, 0));
    const montoMoratorios = Math.max(0, toNum(req.body?.monto_moratorios ?? req.body?.montoMoratorios, 0));
    const montoComisiones = Math.max(0, toNum(req.body?.monto_comisiones ?? req.body?.montoComisiones, 0));
    const montoIva = Math.max(0, toNum(req.body?.monto_iva ?? req.body?.montoIva, 0));

    const effectiveAmount =
      monto > 0
        ? monto
        : Math.max(0, montoCapital + montoIntereses + montoMoratorios + montoComisiones + montoIva);

    if (effectiveAmount <= 0) {
      return res.status(400).json({
        ok: false,
        error: "VALIDATION",
        message: "Debes enviar un monto mayor a 0.",
      });
    }

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
      subtipo: asTrim(req.body?.subtipo, ""),
      estatus: normalizeEstatusMovimiento(req.body?.estatus),
      fecha,

      monto: effectiveAmount,
      moneda: asTrim(req.body?.moneda || financing.moneda || "MXN", "MXN").toUpperCase(),
      tipo_cambio: Math.max(0, toNum(req.body?.tipo_cambio ?? req.body?.tipoCambio, financing.tipo_cambio || 1)) || 1,

      monto_capital: montoCapital,
      monto_intereses: montoIntereses,
      monto_moratorios: montoMoratorios,
      monto_comisiones: montoComisiones,
      monto_iva: montoIva,

      metodo_pago: asTrim(req.body?.metodo_pago ?? req.body?.metodoPago, ""),
      cuenta_destino: asTrim(req.body?.cuenta_destino ?? req.body?.cuentaDestino, ""),
      referencia: asTrim(req.body?.referencia, ""),
      beneficiario: asTrim(req.body?.beneficiario, ""),
      institucion: asTrim(req.body?.institucion || financing.institucion || "", ""),

      journalEntryId: asObjectIdOrNull(req.body?.journalEntryId),
      source: asTrim(req.body?.source, "financiamiento"),
      sourceId: asObjectIdOrNull(req.body?.sourceId) || financing._id,

      snapshot_after: {
        saldo_dispuesto_actual: nextState.saldo_dispuesto_actual,
        saldo_capital_actual: nextState.saldo_capital_actual,
        saldo_intereses_actual: nextState.saldo_intereses_actual,
        saldo_moratorios_actual: nextState.saldo_moratorios_actual,
        saldo_comisiones_actual: nextState.saldo_comisiones_actual,
        saldo_total_actual: nextState.saldo_total_actual,
        disponible_actual: nextState.disponible_actual,
      },

      descripcion: asTrim(req.body?.descripcion, ""),
      notas: asTrim(req.body?.notas, ""),
      tags: parseTags(req.body?.tags ?? req.body?.etiquetas),
      meta: req.body?.meta && typeof req.body.meta === "object" ? req.body.meta : {},
    });

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

    const item = mapMovementForUI(movement);
    const financingItem = mapFinancingForUI(updated);

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
    return res.status(500).json({
      ok: false,
      error: "SERVER_ERROR",
      message: err?.message || "SERVER_ERROR",
    });
  }
});

// Aliases semánticos
router.post("/:id/disposicion", ensureAuth, async (req, res, next) => {
  req.body = { ...req.body, tipo: "disposicion" };
  next();
}, (req, res, next) => router.handle(req, res, next));

router.post("/:id/amortizacion", ensureAuth, async (req, res, next) => {
  req.body = { ...req.body, tipo: "amortizacion" };
  next();
}, (req, res, next) => router.handle(req, res, next));

router.post("/:id/intereses", ensureAuth, async (req, res, next) => {
  req.body = { ...req.body, tipo: "cargo_intereses" };
  next();
}, (req, res, next) => router.handle(req, res, next));

router.post("/:id/pago-intereses", ensureAuth, async (req, res, next) => {
  req.body = { ...req.body, tipo: "pago_intereses" };
  next();
}, (req, res, next) => router.handle(req, res, next));

router.post("/:id/comision", ensureAuth, async (req, res, next) => {
  req.body = { ...req.body, tipo: "cargo_comision" };
  next();
}, (req, res, next) => router.handle(req, res, next));

router.post("/:id/pago-comision", ensureAuth, async (req, res, next) => {
  req.body = { ...req.body, tipo: "pago_comision" };
  next();
}, (req, res, next) => router.handle(req, res, next));

/**
 * GET /api/financiamientos/:id
 */
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

/**
 * PATCH /api/financiamientos/:id
 */
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
    if (req.body?.institucion !== undefined) patch.institucion = asTrim(req.body?.institucion, "");
    if (req.body?.institucion_id !== undefined || req.body?.institucionId !== undefined) {
      patch.institucion_id = asObjectIdOrNull(req.body?.institucion_id ?? req.body?.institucionId);
    }

    if (req.body?.tipo !== undefined) patch.tipo = normalizeTipoFinanciamiento(req.body?.tipo);
    if (req.body?.subtipo !== undefined) patch.subtipo = asTrim(req.body?.subtipo, "");
    if (req.body?.categoria !== undefined) patch.categoria = normalizeCategoriaFinanciamiento(req.body?.categoria);
    if (req.body?.estatus !== undefined) patch.estatus = normalizeEstatusFinanciamiento(req.body?.estatus);
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

    if (req.body?.linea_credito !== undefined || req.body?.lineaCredito !== undefined) {
      patch.linea_credito = Math.max(0, toNum(req.body?.linea_credito ?? req.body?.lineaCredito, 0));
    }
    if (req.body?.monto_original !== undefined || req.body?.montoOriginal !== undefined) {
      patch.monto_original = Math.max(0, toNum(req.body?.monto_original ?? req.body?.montoOriginal, 0));
    }
    if (req.body?.monto_dispuesto_inicial !== undefined || req.body?.montoDispuestoInicial !== undefined) {
      patch.monto_dispuesto_inicial = Math.max(
        0,
        toNum(req.body?.monto_dispuesto_inicial ?? req.body?.montoDispuestoInicial, 0)
      );
    }

    if (req.body?.tasa_interes_anual !== undefined || req.body?.tasaInteresAnual !== undefined) {
      patch.tasa_interes_anual = Math.max(
        0,
        toNum(req.body?.tasa_interes_anual ?? req.body?.tasaInteresAnual, 0)
      );
    }
    if (req.body?.tasa_interes_mensual !== undefined || req.body?.tasaInteresMensual !== undefined) {
      patch.tasa_interes_mensual = Math.max(
        0,
        toNum(req.body?.tasa_interes_mensual ?? req.body?.tasaInteresMensual, 0)
      );
    }
    if (req.body?.tasa_moratoria_anual !== undefined || req.body?.tasaMoratoriaAnual !== undefined) {
      patch.tasa_moratoria_anual = Math.max(
        0,
        toNum(req.body?.tasa_moratoria_anual ?? req.body?.tasaMoratoriaAnual, 0)
      );
    }

    if (req.body?.comision_apertura !== undefined || req.body?.comisionApertura !== undefined) {
      patch.comision_apertura = Math.max(
        0,
        toNum(req.body?.comision_apertura ?? req.body?.comisionApertura, 0)
      );
    }
    if (req.body?.comision_disposicion !== undefined || req.body?.comisionDisposicion !== undefined) {
      patch.comision_disposicion = Math.max(
        0,
        toNum(req.body?.comision_disposicion ?? req.body?.comisionDisposicion, 0)
      );
    }

    if (req.body?.plazo_meses !== undefined || req.body?.plazoMeses !== undefined) {
      patch.plazo_meses = Math.max(0, Math.trunc(toNum(req.body?.plazo_meses ?? req.body?.plazoMeses, 0)));
    }
    if (req.body?.pago_periodico_estimado !== undefined || req.body?.pagoPeriodicoEstimado !== undefined) {
      patch.pago_periodico_estimado = Math.max(
        0,
        toNum(req.body?.pago_periodico_estimado ?? req.body?.pagoPeriodicoEstimado, 0)
      );
    }
    if (req.body?.periodicidad_pago !== undefined || req.body?.periodicidadPago !== undefined) {
      patch.periodicidad_pago = normalizePeriodicidad(req.body?.periodicidad_pago ?? req.body?.periodicidadPago);
    }

    if (req.body?.cuenta_pasivo_codigo !== undefined || req.body?.cuentaPasivoCodigo !== undefined) {
      patch.cuenta_pasivo_codigo = asTrim(req.body?.cuenta_pasivo_codigo ?? req.body?.cuentaPasivoCodigo, "");
    }
    if (req.body?.cuenta_pasivo_nombre !== undefined || req.body?.cuentaPasivoNombre !== undefined) {
      patch.cuenta_pasivo_nombre = asTrim(req.body?.cuenta_pasivo_nombre ?? req.body?.cuentaPasivoNombre, "");
    }
    if (req.body?.cuenta_intereses_codigo !== undefined || req.body?.cuentaInteresesCodigo !== undefined) {
      patch.cuenta_intereses_codigo = asTrim(
        req.body?.cuenta_intereses_codigo ?? req.body?.cuentaInteresesCodigo,
        ""
      );
    }
    if (req.body?.cuenta_intereses_nombre !== undefined || req.body?.cuentaInteresesNombre !== undefined) {
      patch.cuenta_intereses_nombre = asTrim(
        req.body?.cuenta_intereses_nombre ?? req.body?.cuentaInteresesNombre,
        ""
      );
    }
    if (req.body?.cuenta_bancos_codigo !== undefined || req.body?.cuentaBancosCodigo !== undefined) {
      patch.cuenta_bancos_codigo = asTrim(req.body?.cuenta_bancos_codigo ?? req.body?.cuentaBancosCodigo, "");
    }
    if (req.body?.cuenta_bancos_nombre !== undefined || req.body?.cuentaBancosNombre !== undefined) {
      patch.cuenta_bancos_nombre = asTrim(req.body?.cuenta_bancos_nombre ?? req.body?.cuentaBancosNombre, "");
    }

    if (req.body?.descripcion !== undefined) patch.descripcion = asTrim(req.body?.descripcion, "");
    if (req.body?.notas !== undefined) patch.notas = asTrim(req.body?.notas, "");
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

/**
 * DELETE /api/financiamientos/:id
 * hard delete por ahora
 */
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