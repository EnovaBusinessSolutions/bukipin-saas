const mongoose = require("mongoose");

const Financing = require("../models/Financing");
const FinancingMovement = require("../models/FinancingMovement");

function asTrim(v, def = "") {
  if (v === undefined || v === null) return def;
  return String(v).trim();
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
  if (v === undefined || v === null || v === "") return null;
  if (v instanceof mongoose.Types.ObjectId) return v;
  const s = String(v).trim();
  return mongoose.Types.ObjectId.isValid(s) ? new mongoose.Types.ObjectId(s) : null;
}

async function safeDeleteMovement({ movementId, owner }) {
  try {
    if (!movementId) return;
    await FinancingMovement.deleteOne({ _id: movementId, owner });
  } catch (rollbackErr) {
    console.error("safeDeleteMovement rollback error:", rollbackErr?.message || rollbackErr);
  }
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
  return f;
}

function buildCorporateCardNextState(financingLike, monto) {
  const current = recalcFinancingSnapshot(financingLike);
  const amount = Math.max(0, toNum(monto, 0));

  current.saldo_dispuesto_actual += amount;
  current.saldo_capital_actual += amount;
  current.total_dispuesto += amount;

  return recalcFinancingSnapshot(current);
}

async function prepareCorporateCardCharge({ owner, financingId, monto }) {
  const financingObjectId = asObjectIdOrNull(financingId);
  if (!financingObjectId) {
    const err = new Error("financingId inválido o faltante para pago con tarjeta corporativa.");
    err.statusCode = 400;
    throw err;
  }

  const amount = Math.max(0, toNum(monto, 0));
  if (!(amount > 0)) {
    const err = new Error("El monto del cargo a tarjeta debe ser mayor a 0.");
    err.statusCode = 400;
    throw err;
  }

  const financing = await Financing.findOne({ _id: financingObjectId, owner });
  if (!financing) {
    const err = new Error("El financiamiento de tarjeta corporativa no existe.");
    err.statusCode = 404;
    throw err;
  }

  const current = recalcFinancingSnapshot(financing);

  if (current.tipo !== "tarjeta_credito") {
    const err = new Error("El financing indicado no es de tipo tarjeta_credito.");
    err.statusCode = 400;
    throw err;
  }

  if (current.estatus !== "activo" || current.activo === false) {
    const err = new Error("La tarjeta corporativa indicada no está activa.");
    err.statusCode = 400;
    throw err;
  }

  if (amount > Math.max(0, toNum(current.disponible_actual, 0))) {
    const err = new Error("El monto_pagado excede el disponible de la tarjeta corporativa.");
    err.statusCode = 400;
    throw err;
  }

  const nextState = buildCorporateCardNextState(current, amount);
  const liabilityAccountCode =
    asTrim(current.cuenta_pasivo_codigo, "") ||
    asTrim(process.env.CTA_TARJETAS_CREDITO, "") ||
    "2101";

  return {
    financing,
    current,
    nextState,
    liabilityAccountCode,
    liabilityAccountName: asTrim(current.cuenta_pasivo_nombre, "Tarjetas de Crédito"),
    amount,
  };
}

async function applyCorporateCardCharge({
  owner,
  financingId,
  monto,
  source = "egreso",
  sourceModule = "egresos",
  sourceId = null,
  journalEntryId = null,
  fecha = null,
  descripcion = "",
  metodoPago = "tarjeta_credito",
  moneda = "MXN",
  tipoCambio = 1,
  meta = {},
}) {
  const prepared = await prepareCorporateCardCharge({ owner, financingId, monto });
  let movement = null;

  movement = await FinancingMovement.create({
    owner,
    financingId: prepared.financing._id,
    tipo: "cargo_tarjeta",
    estatus: "aplicado",
    fecha: asDateOrNull(fecha) || new Date(),
    monto: prepared.amount,
    moneda: asTrim(moneda || prepared.financing.moneda || "MXN", "MXN").toUpperCase(),
    tipo_cambio: Math.max(0, toNum(tipoCambio ?? prepared.financing.tipo_cambio, 1)) || 1,
    monto_capital: prepared.amount,
    metodo_pago: asTrim(metodoPago, "tarjeta_credito"),
    journalEntryId: asObjectIdOrNull(journalEntryId),
    source: asTrim(source, "egreso"),
    sourceModule: asTrim(sourceModule, "egresos"),
    sourceId: asObjectIdOrNull(sourceId),
    snapshot_after: {
      saldo_dispuesto_actual: prepared.nextState.saldo_dispuesto_actual,
      saldo_capital_actual: prepared.nextState.saldo_capital_actual,
      saldo_intereses_actual: prepared.nextState.saldo_intereses_actual,
      saldo_moratorios_actual: prepared.nextState.saldo_moratorios_actual,
      saldo_comisiones_actual: prepared.nextState.saldo_comisiones_actual,
      saldo_total_actual: prepared.nextState.saldo_total_actual,
      disponible_actual: prepared.nextState.disponible_actual,
    },
    descripcion: asTrim(descripcion, "Cargo a tarjeta corporativa"),
    meta: meta && typeof meta === "object" ? meta : {},
  });

  let financing = null;
  try {
    financing = await Financing.findOneAndUpdate(
      {
        _id: prepared.financing._id,
        owner,
        tipo: "tarjeta_credito",
        estatus: "activo",
        activo: true,
        saldo_dispuesto_actual: prepared.current.saldo_dispuesto_actual,
        saldo_capital_actual: prepared.current.saldo_capital_actual,
        total_dispuesto: prepared.current.total_dispuesto,
      },
      {
        $set: {
          saldo_dispuesto_actual: prepared.nextState.saldo_dispuesto_actual,
          saldo_capital_actual: prepared.nextState.saldo_capital_actual,
          saldo_intereses_actual: prepared.nextState.saldo_intereses_actual,
          saldo_moratorios_actual: prepared.nextState.saldo_moratorios_actual,
          saldo_comisiones_actual: prepared.nextState.saldo_comisiones_actual,
          saldo_total_actual: prepared.nextState.saldo_total_actual,
          disponible_actual: prepared.nextState.disponible_actual,
          total_dispuesto: prepared.nextState.total_dispuesto,
          total_amortizado_capital: prepared.nextState.total_amortizado_capital,
          total_intereses_cargados: prepared.nextState.total_intereses_cargados,
          total_intereses_pagados: prepared.nextState.total_intereses_pagados,
          total_comisiones_cargadas: prepared.nextState.total_comisiones_cargadas,
          total_comisiones_pagadas: prepared.nextState.total_comisiones_pagadas,
          ultimo_movimiento_at: movement.fecha || new Date(),
          ultimo_movimiento_tipo: movement.tipo,
          estatus: prepared.nextState.estatus || prepared.financing.estatus,
        },
      },
      { new: true }
    );

    if (!financing) {
      const err = new Error(
        "No se pudo aplicar el cargo a la tarjeta corporativa porque el financiamiento cambió durante la operación."
      );
      err.statusCode = 409;
      throw err;
    }
  } catch (err) {
    await safeDeleteMovement({ movementId: movement?._id, owner });
    throw err;
  }

  let movementUpdated = movement;
  try {
    movementUpdated =
      (await FinancingMovement.findOneAndUpdate(
        { _id: movement._id, owner },
        {
          $set: {
            sourceId: asObjectIdOrNull(sourceId),
            journalEntryId: asObjectIdOrNull(journalEntryId),
          },
        },
        { new: true }
      )) || movement;
  } catch (syncErr) {
    console.error("applyCorporateCardCharge reference sync error:", syncErr?.message || syncErr);
  }

  return {
    financing,
    movement: movementUpdated,
    liabilityAccountCode: prepared.liabilityAccountCode,
    liabilityAccountName: prepared.liabilityAccountName,
    amount: prepared.amount,
  };
}

module.exports = {
  prepareCorporateCardCharge,
  applyCorporateCardCharge,
};
