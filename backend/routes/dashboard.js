// backend/routes/dashboard.js
const express = require("express");
const router = express.Router();

const ensureAuth = require("../middleware/ensureAuth");

let JournalEntry = null;
let IncomeTransaction = null;
let ExpenseTransaction = null;
let InventoryMovement = null;
let Financing = null;

try {
  JournalEntry = require("../models/JournalEntry");
} catch (_) {}

try {
  IncomeTransaction = require("../models/IncomeTransaction");
} catch (_) {}

try {
  ExpenseTransaction = require("../models/ExpenseTransaction");
} catch (_) {}

try {
  InventoryMovement = require("../models/InventoryMovement");
} catch (_) {}

try {
  Financing = require("../models/Financing");
} catch (_) {}

// ======================================================
// Helpers base
// ======================================================

const TZ_OFFSET_MINUTES = Number(process.env.APP_TZ_OFFSET_MINUTES ?? -360); // CDMX -06

function num(v, def = 0) {
  if (v === null || v === undefined) return def;
  const s = String(v).trim();
  if (!s) return def;
  const cleaned = s.replace(/[$,\s]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : def;
}

function asTrim(v, def = "") {
  if (v === undefined || v === null) return def;
  return String(v).trim();
}

function asValidDate(v) {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function isDateOnly(str) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(str || "").trim());
}

function parseStartDate(s) {
  if (!s) return null;
  const str = String(s).trim();
  const d = new Date(isDateOnly(str) ? `${str}T00:00:00` : str);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseEndDate(s) {
  if (!s) return null;
  const str = String(s).trim();
  const d = new Date(isDateOnly(str) ? `${str}T23:59:59.999` : str);
  return Number.isNaN(d.getTime()) ? null : d;
}

function nowLocal() {
  return new Date();
}

function startOfTodayLocal(base = new Date()) {
  return new Date(base.getFullYear(), base.getMonth(), base.getDate(), 0, 0, 0, 0);
}

function endOfTodayLocal(base = new Date()) {
  return new Date(base.getFullYear(), base.getMonth(), base.getDate(), 23, 59, 59, 999);
}

function startOfMonthLocal(base = new Date()) {
  return new Date(base.getFullYear(), base.getMonth(), 1, 0, 0, 0, 0);
}

function startOfYearLocal(base = new Date()) {
  return new Date(base.getFullYear(), 0, 1, 0, 0, 0, 0);
}

function toYMDLocal(d) {
  const dt = asValidDate(d);
  if (!dt) return null;
  const local = new Date(dt.getTime() + TZ_OFFSET_MINUTES * 60 * 1000);
  const y = local.getUTCFullYear();
  const m = String(local.getUTCMonth() + 1).padStart(2, "0");
  const day = String(local.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function monthKeyLocal(d) {
  const ymd = toYMDLocal(d);
  if (!ymd) return null;
  return ymd.slice(0, 7);
}

function isSameOrAfterDateYMD(dateStr, compareStr) {
  if (!dateStr || !compareStr) return false;
  return String(dateStr) >= String(compareStr);
}

function sumObjectValues(obj) {
  return Object.values(obj || {}).reduce((acc, v) => acc + num(v, 0), 0);
}

function pickEntryDate(entry) {
  return (
    entry?.date ||
    entry?.fecha ||
    entry?.entryDate ||
    entry?.asiento_fecha ||
    entry?.asientoFecha ||
    entry?.createdAt ||
    entry?.created_at ||
    null
  );
}

function pickEntryLines(entry) {
  if (Array.isArray(entry?.lines)) return entry.lines;
  if (Array.isArray(entry?.detalle_asientos)) return entry.detalle_asientos;
  if (Array.isArray(entry?.detalles_asiento)) return entry.detalles_asiento;
  if (Array.isArray(entry?.detalles)) return entry.detalles;
  return [];
}

function lineCode(line) {
  return String(
    line?.accountCodigo ??
      line?.accountCode ??
      line?.account_codigo ??
      line?.cuentaCodigo ??
      line?.cuenta_codigo ??
      line?.codigo ??
      ""
  ).trim();
}

function lineName(line) {
  return String(
    line?.accountNombre ??
      line?.accountName ??
      line?.account_nombre ??
      line?.cuentaNombre ??
      line?.cuenta_nombre ??
      line?.nombre ??
      ""
  ).trim();
}

function lineDebit(line) {
  return num(line?.debit ?? line?.debe ?? line?.debitAmount ?? 0, 0);
}

function lineCredit(line) {
  return num(line?.credit ?? line?.haber ?? line?.creditAmount ?? 0, 0);
}

function isCashAccount(code) {
  return String(code) === "1001";
}

function isBankAccount(code) {
  return String(code) === "1002";
}

function isCashOrBank(code) {
  return isCashAccount(code) || isBankAccount(code);
}

function accountTopLevel(code) {
  const s = String(code || "").trim();
  const n = Number(s[0]);
  return Number.isFinite(n) ? n : null;
}

// Naturaleza contable
function saldoPorNaturaleza(codigo, debe, haber) {
  const d = String(codigo || "").charAt(0);
  if (["1", "5", "6"].includes(d)) return num(debe, 0) - num(haber, 0); // deudora
  if (["2", "3", "4"].includes(d)) return num(haber, 0) - num(debe, 0); // acreedora
  return num(debe, 0) - num(haber, 0);
}

function classifyCashflowByCounterparty(counterCodes) {
  let hasFin = false;
  let hasInv = false;
  let hasOp = false;

  for (const code of counterCodes || []) {
    if (!code || isCashOrBank(code)) continue;
    const top = accountTopLevel(code);

    if (top === 2 || top === 3) hasFin = true;
    else if (top === 1) hasInv = true;
    else if (top === 4 || top === 5 || top === 6) hasOp = true;
    else hasOp = true;
  }

  if (hasFin) return "financiamiento";
  if (hasInv) return "inversion";
  return "operativo";
}

function getMonthLabelsForYear(baseDate = new Date()) {
  const year = baseDate.getFullYear();
  const labels = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

  return labels.map((label, idx) => ({
    key: `${year}-${String(idx + 1).padStart(2, "0")}`,
    label,
    monthIndex: idx,
  }));
}

function makeEmptyEstadoResultadosSeries(baseDate = new Date()) {
  return getMonthLabelsForYear(baseDate).map((m) => ({
    mes: m.label,
    monthKey: m.key,
    ingresos: 0,
    egresos: 0,
    utilidadBruta: 0,
    ebitda: 0,
    utilidadNeta: 0,
  }));
}

function makeEmptyFlujoSeries(baseDate = new Date()) {
  return getMonthLabelsForYear(baseDate).map((m) => ({
    mes: m.label,
    monthKey: m.key,
    operativo: 0,
    inversion: 0,
    financiamiento: 0,
    neto: 0,
    acumulado: 0,
  }));
}

function isDepreciationOrAmortizationLine(code, name) {
  const c = String(code || "").trim();
  const n = String(name || "").toLowerCase().trim();

  if (["6103", "6104", "6203", "6204"].includes(c)) return true;
  if (n.includes("depreci")) return true;
  if (n.includes("amortiz")) return true;

  return false;
}

function normalizeIncomeMontos(tx) {
  const total = num(tx?.montoTotal ?? tx?.monto_total ?? tx?.total, 0);
  const descuento = num(tx?.montoDescuento ?? tx?.monto_descuento ?? tx?.descuento, 0);
  const neto = num(tx?.montoNeto ?? tx?.monto_neto ?? tx?.neto, Math.max(0, total - descuento));
  const pagado = num(tx?.montoPagado ?? tx?.monto_pagado ?? tx?.pagado, 0);
  const pendienteSaved = num(tx?.saldoPendiente ?? tx?.saldo_pendiente ?? tx?.monto_pendiente, NaN);

  const pendiente = Number.isFinite(pendienteSaved)
    ? pendienteSaved
    : Math.max(0, Number((neto - pagado).toFixed(2)));

  return { total, descuento, neto, pagado, pendiente };
}

function normalizeExpenseMontos(tx) {
  const total = num(tx?.montoTotal ?? tx?.monto_total ?? tx?.total, 0);
  const pagado = num(tx?.montoPagado ?? tx?.monto_pagado, 0);
  const pendienteSaved = num(tx?.montoPendiente ?? tx?.monto_pendiente ?? tx?.saldo_pendiente, NaN);

  const pendiente = Number.isFinite(pendienteSaved)
    ? pendienteSaved
    : Math.max(0, Number((total - pagado).toFixed(2)));

  return { total, pagado, pendiente };
}

function getDueStatus(fechaVencimiento, saldoPendiente, now = new Date()) {
  const saldo = num(saldoPendiente, 0);
  if (!(saldo > 0)) return "pagada";

  const fv = asValidDate(fechaVencimiento);
  if (!fv) return "sin_fecha";

  const a = startOfTodayLocal(now);
  const b = startOfTodayLocal(fv);

  if (a.getTime() > b.getTime()) return "vencida";
  return "corriente";
}

function pickInventoryMovementType(m) {
  return String(m?.tipo_movimiento ?? m?.tipoMovimiento ?? m?.tipo ?? m?.type ?? "")
    .toLowerCase()
    .trim();
}

function pickInventoryQty(m) {
  return num(m?.qty ?? m?.cantidad ?? m?.quantity ?? m?.unidades ?? m?.units, 0);
}

function pickInventoryProductId(m) {
  const raw =
    m?.productId ??
    m?.productoId ??
    m?.producto_id ??
    m?.product ??
    null;

  if (!raw) return "";
  if (typeof raw === "object") return String(raw?._id ?? raw?.id ?? "");
  return String(raw);
}

function pickInventoryProductName(m) {
  const p = m?.productId && typeof m.productId === "object" ? m.productId : null;
  return String(
    p?.nombre ??
      p?.name ??
      m?.producto_nombre ??
      m?.product_name ??
      "Producto"
  ).trim();
}

function pickInventoryMinStock(m) {
  const p = m?.productId && typeof m.productId === "object" ? m.productId : null;
  return num(
    p?.stock_minimo ??
      p?.stockMinimo ??
      p?.minStock ??
      p?.min_stock ??
      m?.stock_minimo ??
      m?.stockMinimo,
    3
  );
}

// ======================================================
// Builders de bloques
// ======================================================

async function buildVentasYKpis({ owner, now }) {
  const startToday = startOfTodayLocal(now);
  const startMonth = startOfMonthLocal(now);
  const startYear = startOfYearLocal(now);

  const ymdToday = toYMDLocal(startToday);
  const ymdMonth = toYMDLocal(startMonth);
  const ymdYear = toYMDLocal(startYear);

  let ventasDelDia = 0;
  let ventasDelMes = 0;
  let ventasDelAno = 0;

  let descuentosDelDia = 0;
  let descuentosDelMes = 0;
  let descuentosDelAno = 0;

  let otrosIngresosDelDia = 0;
  let otrosIngresosDelMes = 0;
  let otrosIngresosDelAno = 0;

  let efectivo = 0;
  let bancos = 0;

  if (JournalEntry) {
    const entries = await JournalEntry.find({
      owner,
      date: { $lte: endOfTodayLocal(now) },
    })
      .sort({ date: 1, createdAt: 1 })
      .lean();

    for (const entry of entries || []) {
      const entryDate = pickEntryDate(entry);
      const ymd = toYMDLocal(entryDate);
      const lines = pickEntryLines(entry);

      for (const line of lines) {
        const code = lineCode(line);
        const debe = lineDebit(line);
        const haber = lineCredit(line);

        // Caja hoy (saldo acumulado al día)
        if (isCashAccount(code)) efectivo += debe - haber;
        if (isBankAccount(code)) bancos += debe - haber;

        if (!ymd) continue;
        if (!isSameOrAfterDateYMD(ymd, ymdYear)) continue;

        // 4003 descuentos
        if (code === "4003") {
          const montoDescuento = debe - haber;

          if (isSameOrAfterDateYMD(ymd, ymdToday)) descuentosDelDia += montoDescuento;
          if (isSameOrAfterDateYMD(ymd, ymdMonth)) descuentosDelMes += montoDescuento;
          descuentosDelAno += montoDescuento;
          continue;
        }

        // 4001 ventas
        if (code === "4001") {
          const montoVenta = haber - debe;

          if (isSameOrAfterDateYMD(ymd, ymdToday)) ventasDelDia += montoVenta;
          if (isSameOrAfterDateYMD(ymd, ymdMonth)) ventasDelMes += montoVenta;
          ventasDelAno += montoVenta;
          continue;
        }

        // otras 4XXX
        if (String(code).startsWith("4")) {
          const montoOtros = haber - debe;

          if (isSameOrAfterDateYMD(ymd, ymdToday)) otrosIngresosDelDia += montoOtros;
          if (isSameOrAfterDateYMD(ymd, ymdMonth)) otrosIngresosDelMes += montoOtros;
          otrosIngresosDelAno += montoOtros;
        }
      }
    }
  }

  const ingresoNetoDelDia = Math.max(0, ventasDelDia - descuentosDelDia);
  const ingresoNetoDelMes = Math.max(0, ventasDelMes - descuentosDelMes);
  const ingresoNetoDelAno = Math.max(0, ventasDelAno - descuentosDelAno);

  return {
    ventas: {
      ventasDelDia: num(ventasDelDia, 0),
      ventasDelMes: num(ventasDelMes, 0),
      ventasDelAno: num(ventasDelAno, 0),

      descuentosDelDia: num(descuentosDelDia, 0),
      descuentosDelMes: num(descuentosDelMes, 0),
      descuentosDelAno: num(descuentosDelAno, 0),

      otrosIngresosDelDia: num(otrosIngresosDelDia, 0),
      otrosIngresosDelMes: num(otrosIngresosDelMes, 0),
      otrosIngresosDelAno: num(otrosIngresosDelAno, 0),

      ingresoNetoDelDia: num(ingresoNetoDelDia, 0),
      ingresoNetoDelMes: num(ingresoNetoDelMes, 0),
      ingresoNetoDelAno: num(ingresoNetoDelAno, 0),

      totalIngresosDelDia: num(ingresoNetoDelDia + otrosIngresosDelDia, 0),
      totalIngresosDelMes: num(ingresoNetoDelMes + otrosIngresosDelMes, 0),
      totalIngresosDelAno: num(ingresoNetoDelAno + otrosIngresosDelAno, 0),
    },

    caja: {
      efectivo: num(efectivo, 0),
      bancos: num(bancos, 0),
      total: num(efectivo + bancos, 0),
    },
  };
}

async function buildEstadoResultados({ owner, now }) {
  const startYear = startOfYearLocal(now);
  const endToday = endOfTodayLocal(now);

  const series = makeEmptyEstadoResultadosSeries(now);
  const byMonth = Object.fromEntries(series.map((s) => [s.monthKey, s]));

  if (!JournalEntry) {
    return {
      series,
      totales: {
        ingresos: 0,
        egresos: 0,
        utilidadBruta: 0,
        ebitda: 0,
        utilidadNeta: 0,
      },
    };
  }

  const entries = await JournalEntry.find({
    owner,
    date: { $gte: startYear, $lte: endToday },
  })
    .sort({ date: 1, createdAt: 1 })
    .lean();

  for (const entry of entries || []) {
    const monthKey = monthKeyLocal(pickEntryDate(entry));
    if (!monthKey || !byMonth[monthKey]) continue;

    const bucket = byMonth[monthKey];
    const lines = pickEntryLines(entry);

    for (const line of lines) {
      const code = lineCode(line);
      const name = lineName(line);
      const debe = lineDebit(line);
      const haber = lineCredit(line);

      if (!code) continue;

      // ingresos = 4XXX netos
      if (code.startsWith("4")) {
        const monto = haber - debe;
        bucket.ingresos += monto;
        continue;
      }

      // costos = 5XXX
      if (code.startsWith("5")) {
        const monto = debe - haber;
        bucket.egresos += monto;
        continue;
      }

      // gastos = 6XXX
      if (code.startsWith("6")) {
        const monto = debe - haber;
        bucket.egresos += monto;

        // EBITDA excluye dep/amort
        if (isDepreciationOrAmortizationLine(code, name)) {
          // no sumar este gasto a EBITDA
        }
      }
    }
  }

  for (const bucket of series) {
    const monthEntries = await getMonthEntriesForEstadoResultados({
      owner,
      monthKey: bucket.monthKey,
      now,
    });

    bucket.ingresos = num(monthEntries.ingresos, 0);
    bucket.egresos = num(monthEntries.egresos, 0);
    bucket.utilidadBruta = num(monthEntries.utilidadBruta, 0);
    bucket.ebitda = num(monthEntries.ebitda, 0);
    bucket.utilidadNeta = num(monthEntries.utilidadNeta, 0);
  }

  const totales = {
    ingresos: num(series.reduce((acc, x) => acc + num(x.ingresos, 0), 0), 0),
    egresos: num(series.reduce((acc, x) => acc + num(x.egresos, 0), 0), 0),
    utilidadBruta: num(series.reduce((acc, x) => acc + num(x.utilidadBruta, 0), 0), 0),
    ebitda: num(series.reduce((acc, x) => acc + num(x.ebitda, 0), 0), 0),
    utilidadNeta: num(series.reduce((acc, x) => acc + num(x.utilidadNeta, 0), 0), 0),
  };

  return { series, totales };
}

// helper separado para mayor claridad en la clasificación mensual P&L
async function getMonthEntriesForEstadoResultados({ owner, monthKey }) {
  if (!JournalEntry) {
    return {
      ingresos: 0,
      egresos: 0,
      utilidadBruta: 0,
      ebitda: 0,
      utilidadNeta: 0,
    };
  }

  const [year, month] = String(monthKey).split("-").map(Number);
  const start = new Date(year, month - 1, 1, 0, 0, 0, 0);
  const end = new Date(year, month, 0, 23, 59, 59, 999);

  const entries = await JournalEntry.find({
    owner,
    date: { $gte: start, $lte: end },
  }).lean();

  let ingresos = 0;
  let costos = 0;
  let gastosOperativos = 0;
  let depAmort = 0;

  for (const entry of entries || []) {
    const lines = pickEntryLines(entry);

    for (const line of lines) {
      const code = lineCode(line);
      const name = lineName(line);
      const debe = lineDebit(line);
      const haber = lineCredit(line);

      if (!code) continue;

      if (code.startsWith("4")) {
        ingresos += haber - debe;
        continue;
      }

      if (code.startsWith("5")) {
        costos += debe - haber;
        continue;
      }

      if (code.startsWith("6")) {
        const monto = debe - haber;
        if (isDepreciationOrAmortizationLine(code, name)) depAmort += monto;
        else gastosOperativos += monto;
      }
    }
  }

  const egresos = costos + gastosOperativos + depAmort;
  const utilidadBruta = ingresos - costos;
  const ebitda = utilidadBruta - gastosOperativos;
  const utilidadNeta = ingresos - egresos;

  return {
    ingresos: num(ingresos, 0),
    egresos: num(egresos, 0),
    utilidadBruta: num(utilidadBruta, 0),
    ebitda: num(ebitda, 0),
    utilidadNeta: num(utilidadNeta, 0),
  };
}

async function buildFlujoWaterfall({ owner, now }) {
  const startYear = startOfYearLocal(now);
  const endToday = endOfTodayLocal(now);

  const series = makeEmptyFlujoSeries(now);
  const byMonth = Object.fromEntries(series.map((s) => [s.monthKey, s]));

  if (!JournalEntry) {
    return {
      saldoInicial: 0,
      saldoFinal: 0,
      seriesMensuales: series,
    };
  }

  // saldo inicial del año para caja
  const beforeYearEntries = await JournalEntry.find({
    owner,
    date: { $lt: startYear },
  }).lean();

  let saldoInicial = 0;
  for (const entry of beforeYearEntries || []) {
    const lines = pickEntryLines(entry);
    for (const line of lines) {
      const code = lineCode(line);
      if (!isCashOrBank(code)) continue;
      saldoInicial += lineDebit(line) - lineCredit(line);
    }
  }

  const yearEntries = await JournalEntry.find({
    owner,
    date: { $gte: startYear, $lte: endToday },
  })
    .sort({ date: 1, createdAt: 1 })
    .lean();

  for (const entry of yearEntries || []) {
    const monthKey = monthKeyLocal(pickEntryDate(entry));
    if (!monthKey || !byMonth[monthKey]) continue;

    const bucket = byMonth[monthKey];
    const lines = pickEntryLines(entry);

    const codes = lines.map((l) => lineCode(l));
    const counterparties = new Set(codes.filter((c) => c && !isCashOrBank(c)));
    const categoria = classifyCashflowByCounterparty(counterparties);

    let netCashImpact = 0;

    for (const line of lines) {
      const code = lineCode(line);
      if (!isCashOrBank(code)) continue;
      netCashImpact += lineDebit(line) - lineCredit(line);
    }

    if (categoria === "operativo") bucket.operativo += netCashImpact;
    else if (categoria === "inversion") bucket.inversion += netCashImpact;
    else if (categoria === "financiamiento") bucket.financiamiento += netCashImpact;
  }

  let running = saldoInicial;
  for (const bucket of series) {
    bucket.operativo = num(bucket.operativo, 0);
    bucket.inversion = num(bucket.inversion, 0);
    bucket.financiamiento = num(bucket.financiamiento, 0);
    bucket.neto = num(bucket.operativo + bucket.inversion + bucket.financiamiento, 0);
    running += bucket.neto;
    bucket.acumulado = num(running, 0);
  }

  return {
    saldoInicial: num(saldoInicial, 0),
    saldoFinal: num(running, 0),
    seriesMensuales: series,
  };
}

async function buildBalanceGeneral({ owner, now }) {
  const endToday = endOfTodayLocal(now);

  const estructura = {
    activoCirculante: 0,
    activoNoCirculante: 0,
    pasivoCirculante: 0,
    pasivoNoCirculante: 0,
    capitalContable: 0,
  };

  if (!JournalEntry) {
    return {
      activos: 0,
      pasivos: 0,
      capital: 0,
      estructura,
    };
  }

  const entries = await JournalEntry.find({
    owner,
    date: { $lte: endToday },
  }).lean();

  const byCode = {};

  for (const entry of entries || []) {
    const lines = pickEntryLines(entry);
    for (const line of lines) {
      const code = lineCode(line);
      if (!code) continue;

      if (!byCode[code]) {
        byCode[code] = { debe: 0, haber: 0, name: lineName(line) || "" };
      }

      byCode[code].debe += lineDebit(line);
      byCode[code].haber += lineCredit(line);
    }
  }

  for (const [code, data] of Object.entries(byCode)) {
    const saldo = saldoPorNaturaleza(code, data.debe, data.haber);
    const top = accountTopLevel(code);

    if (top === 1) {
      if (code.startsWith("10")) estructura.activoCirculante += saldo;
      else estructura.activoNoCirculante += saldo;
    } else if (top === 2) {
      if (code.startsWith("20")) estructura.pasivoCirculante += saldo;
      else estructura.pasivoNoCirculante += saldo;
    } else if (top === 3) {
      estructura.capitalContable += saldo;
    }
  }

  const activos = num(estructura.activoCirculante + estructura.activoNoCirculante, 0);
  const pasivos = num(estructura.pasivoCirculante + estructura.pasivoNoCirculante, 0);
  const capital = num(estructura.capitalContable, 0);

  return {
    activos,
    pasivos,
    capital,
    estructura: {
      activoCirculante: num(estructura.activoCirculante, 0),
      activoNoCirculante: num(estructura.activoNoCirculante, 0),
      pasivoCirculante: num(estructura.pasivoCirculante, 0),
      pasivoNoCirculante: num(estructura.pasivoNoCirculante, 0),
      capitalContable: num(estructura.capitalContable, 0),
    },
  };
}

async function buildCxC({ owner, now }) {
  if (!IncomeTransaction) {
    return {
      total: 0,
      corriente: 0,
      vencido: 0,
      cantidad: 0,
    };
  }

  const rows = await IncomeTransaction.find({ owner }).lean();

  let total = 0;
  let corriente = 0;
  let vencido = 0;
  let cantidad = 0;

  for (const tx of rows || []) {
    const { pendiente } = normalizeIncomeMontos(tx);
    if (!(pendiente > 0)) continue;

    cantidad += 1;
    total += pendiente;

    const due =
      tx?.fechaLimite ??
      tx?.fecha_limite ??
      tx?.fecha_vencimiento ??
      tx?.fechaVencimiento ??
      null;

    const status = getDueStatus(due, pendiente, now);
    if (status === "vencida") vencido += pendiente;
    else corriente += pendiente;
  }

  return {
    total: num(total, 0),
    corriente: num(corriente, 0),
    vencido: num(vencido, 0),
    cantidad,
  };
}

async function buildCxP({ owner, now }) {
  if (!ExpenseTransaction) {
    return {
      total: 0,
      corriente: 0,
      vencido: 0,
      cantidad: 0,
    };
  }

  const rows = await ExpenseTransaction.find({
    owner,
    estado: { $ne: "cancelado" },
  }).lean();

  let total = 0;
  let corriente = 0;
  let vencido = 0;
  let cantidad = 0;

  for (const tx of rows || []) {
    const { pendiente } = normalizeExpenseMontos(tx);
    if (!(pendiente > 0)) continue;

    cantidad += 1;
    total += pendiente;

    const due =
      tx?.fechaVencimiento ??
      tx?.fecha_vencimiento ??
      null;

    const status = getDueStatus(due, pendiente, now);
    if (status === "vencida") vencido += pendiente;
    else corriente += pendiente;
  }

  return {
    total: num(total, 0),
    corriente: num(corriente, 0),
    vencido: num(vencido, 0),
    cantidad,
  };
}

async function buildInventario({ owner }) {
  if (!InventoryMovement) {
    return {
      bien: 0,
      bajo: 0,
      negativo: 0,
      totalProductos: 0,
    };
  }

  const movimientos = await InventoryMovement.find({ owner })
    .setOptions({ strictPopulate: false })
    .populate({
      path: "productId",
      select: "nombre name stock_minimo stockMinimo minStock min_stock",
      strictPopulate: false,
    })
    .lean();

  const byProduct = {};

  for (const mov of movimientos || []) {
    const productId = pickInventoryProductId(mov);
    if (!productId) continue;

    const tipo = pickInventoryMovementType(mov);
    const qty = pickInventoryQty(mov);
    const minStock = pickInventoryMinStock(mov);
    const name = pickInventoryProductName(mov);

    if (!byProduct[productId]) {
      byProduct[productId] = {
        productId,
        nombre: name,
        stock: 0,
        minStock,
      };
    }

    if (tipo === "compra" || tipo === "entrada" || tipo === "ajuste_entrada") {
      byProduct[productId].stock += qty;
    } else if (tipo === "venta" || tipo === "salida" || tipo === "ajuste_salida") {
      byProduct[productId].stock -= qty;
    } else if (tipo === "ajuste") {
      // si algún ajuste viene directo, lo tratamos como delta
      byProduct[productId].stock += qty;
    }
  }

  let bien = 0;
  let bajo = 0;
  let negativo = 0;

  for (const item of Object.values(byProduct)) {
    const stock = num(item.stock, 0);
    const minStock = Math.max(0, num(item.minStock, 3));

    if (stock < 0) negativo += 1;
    else if (stock <= minStock) bajo += 1;
    else bien += 1;
  }

  return {
    bien,
    bajo,
    negativo,
    totalProductos: Object.keys(byProduct).length,
  };
}

async function buildPasivosBancarios({ owner }) {
  if (!Financing) {
    return {
      totalDeuda: 0,
      totalPagado: 0,
      totalPendiente: 0,
      items: [],
    };
  }

  const docs = await Financing.find({
    owner,
    activo: true,
  }).lean();

  const items = (docs || []).map((d) => {
    const tipo = String(d?.tipo || "credito_simple").trim();
    const institucion = asTrim(d?.institucion, "Sin institución");

    const lineaCredito = num(d?.linea_credito, 0);
    const montoOriginal = num(d?.monto_original, 0);
    const saldoDispuestoActual = num(d?.saldo_dispuesto_actual, 0);
    const saldoCapitalActual = num(d?.saldo_capital_actual, 0);
    const saldoTotalActual = num(d?.saldo_total_actual, 0);
    const totalAmortizadoCapital = num(d?.total_amortizado_capital, 0);
    const totalInteresesPagados = num(d?.total_intereses_pagados, 0);
    const totalComisionesPagadas = num(d?.total_comisiones_pagadas, 0);

    const totalContratado =
      tipo === "linea_credito" || tipo === "tarjeta_credito"
        ? lineaCredito
        : montoOriginal;

    const saldoActual =
      tipo === "linea_credito" || tipo === "tarjeta_credito"
        ? saldoDispuestoActual
        : saldoTotalActual;

    const pagado = totalAmortizadoCapital + totalInteresesPagados + totalComisionesPagadas;

    return {
      id: String(d?._id || ""),
      institucion,
      nombre: asTrim(d?.nombre, "Financiamiento"),
      tipo,
      totalContratado: num(totalContratado, 0),
      saldoActual: num(saldoActual, 0),
      pagado: num(pagado, 0),
      capitalPagado: num(totalAmortizadoCapital, 0),
      saldoCapitalActual: num(saldoCapitalActual, 0),
      disponibleActual: num(d?.disponible_actual, 0),
      estatus: asTrim(d?.estatus, "activo"),
    };
  });

  const totalDeuda = num(items.reduce((acc, x) => acc + num(x.totalContratado, 0), 0), 0);
  const totalPagado = num(items.reduce((acc, x) => acc + num(x.pagado, 0), 0), 0);
  const totalPendiente = num(items.reduce((acc, x) => acc + num(x.saldoActual, 0), 0), 0);

  items.sort((a, b) => num(b.saldoActual, 0) - num(a.saldoActual, 0));

  return {
    totalDeuda,
    totalPagado,
    totalPendiente,
    items: items.slice(0, 10),
  };
}

// ======================================================
// Route
// ======================================================

router.get("/ping", ensureAuth, (req, res) => {
  return res.json({
    ok: true,
    route: "dashboard",
    user: String(req.user?._id || ""),
    time: new Date().toISOString(),
  });
});

router.get("/resumen", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;
    const now = nowLocal();

    const [
      ventasYKpis,
      estadoResultados,
      flujo,
      balanceGeneral,
      cxc,
      cxp,
      inventario,
      pasivosBancarios,
    ] = await Promise.all([
      buildVentasYKpis({ owner, now }),
      buildEstadoResultados({ owner, now }),
      buildFlujoWaterfall({ owner, now }),
      buildBalanceGeneral({ owner, now }),
      buildCxC({ owner, now }),
      buildCxP({ owner, now }),
      buildInventario({ owner }),
      buildPasivosBancarios({ owner }),
    ]);

    return res.json({
      ok: true,
      data: {
        kpis: {
          ventasDia: ventasYKpis.ventas.ventasDelDia,
          ventasMes: ventasYKpis.ventas.ventasDelMes,
          ventasAno: ventasYKpis.ventas.ventasDelAno,
          caja: ventasYKpis.caja,

          // extras útiles para UI
          descuentosMes: ventasYKpis.ventas.descuentosDelMes,
          ingresoNetoMes: ventasYKpis.ventas.ingresoNetoDelMes,
          totalIngresosMes: ventasYKpis.ventas.totalIngresosDelMes,
        },

        ventas: ventasYKpis.ventas,

        estadoResultados,

        flujo,

        balanceGeneral,

        cxc,

        cxp,

        inventario,

        pasivosBancarios,

        pendientes: {
          radiografiaNegocio: true,
          recomendacionesIA: true,
        },

        meta: {
          generatedAt: new Date().toISOString(),
          timezoneOffsetMinutes: TZ_OFFSET_MINUTES,
        },
      },
    });
  } catch (err) {
    console.error("GET /api/dashboard/resumen error:", err);
    return res.status(500).json({
      ok: false,
      message: err?.message || "Error construyendo dashboard financiero",
    });
  }
});

module.exports = router;