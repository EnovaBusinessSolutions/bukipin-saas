// backend/routes/dashboard.js
const express = require("express");
const router = express.Router();

const ensureAuth = require("../middleware/ensureAuth");

const {
  TZ_OFFSET_MINUTES,
  asTrim,
  asValidDate,
  isDateOnly,
  toYMDLocal,
  toYMLocal,
  startOfTodayLocal,
  endOfTodayLocal,
  startOfMonthLocal,
  startOfYearLocal,
  isSameLocalDay,
  isSameLocalMonth,
  isSameLocalYear,
  dateOnlyToUtcStart,
  pickEffectiveDate,
} = require("../utils/datetime");

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

function num(v, def = 0) {
  if (v === null || v === undefined) return def;
  const s = String(v).trim();
  if (!s) return def;
  const cleaned = s.replace(/[$,\s]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : def;
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
  const year = Number(toYMDLocal(baseDate)?.slice(0, 4) || new Date().getFullYear());
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

  let fv = null;
  if (isDateOnly(fechaVencimiento)) fv = dateOnlyToUtcStart(fechaVencimiento);
  else fv = asValidDate(fechaVencimiento);

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
  const raw = m?.productId ?? m?.productoId ?? m?.producto_id ?? m?.product ?? null;

  if (!raw) return "";
  if (typeof raw === "object") return String(raw?._id ?? raw?.id ?? "");
  return String(raw);
}

function pickInventoryProductName(m) {
  const p = m?.productId && typeof m.productId === "object" ? m.productId : null;
  return String(p?.nombre ?? p?.name ?? m?.producto_nombre ?? m?.product_name ?? "Producto").trim();
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

async function buildVentasYKpis({ now, journalEntries }) {
  const endToday = endOfTodayLocal(now);

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

  for (const entry of journalEntries || []) {
    const entryDate = pickEffectiveDate(entry);
    if (!entryDate) continue;
    if (entryDate.getTime() > endToday.getTime()) continue;

    const lines = pickEntryLines(entry);

    for (const line of lines) {
      const code = lineCode(line);
      const debe = lineDebit(line);
      const haber = lineCredit(line);

      // Caja acumulada al día de hoy
      if (isCashAccount(code)) efectivo += debe - haber;
      if (isBankAccount(code)) bancos += debe - haber;

      // Solo cuentas 4XXX para ventas/ingresos
      if (!String(code).startsWith("4")) continue;

      // 4003 descuentos
      if (code === "4003") {
        const montoDescuento = debe - haber;

        if (isSameLocalDay(entryDate, now)) descuentosDelDia += montoDescuento;
        if (isSameLocalMonth(entryDate, now)) descuentosDelMes += montoDescuento;
        if (isSameLocalYear(entryDate, now)) descuentosDelAno += montoDescuento;
        continue;
      }

      // 4001 ventas
      if (code === "4001") {
        const montoVenta = haber - debe;

        if (isSameLocalDay(entryDate, now)) ventasDelDia += montoVenta;
        if (isSameLocalMonth(entryDate, now)) ventasDelMes += montoVenta;
        if (isSameLocalYear(entryDate, now)) ventasDelAno += montoVenta;
        continue;
      }

      // otras 4XXX = otros ingresos
      const montoOtros = haber - debe;
      if (isSameLocalDay(entryDate, now)) otrosIngresosDelDia += montoOtros;
      if (isSameLocalMonth(entryDate, now)) otrosIngresosDelMes += montoOtros;
      if (isSameLocalYear(entryDate, now)) otrosIngresosDelAno += montoOtros;
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

async function buildEstadoResultados({ now, journalEntries }) {
  const series = makeEmptyEstadoResultadosSeries(now);
  const byMonth = Object.fromEntries(
    series.map((s) => [
      s.monthKey,
      {
        ...s,
        _costos: 0,
        _gastosOperativos: 0,
        _depAmort: 0,
      },
    ])
  );

  for (const entry of journalEntries || []) {
    const entryDate = pickEffectiveDate(entry);
    if (!entryDate) continue;
    if (!isSameLocalYear(entryDate, now)) continue;

    const monthKey = toYMLocal(entryDate);
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
        bucket.ingresos += haber - debe;
        continue;
      }

      // costos = 5XXX
      if (code.startsWith("5")) {
        bucket._costos += debe - haber;
        continue;
      }

      // gastos = 6XXX
      if (code.startsWith("6")) {
        const monto = debe - haber;
        if (isDepreciationOrAmortizationLine(code, name)) bucket._depAmort += monto;
        else bucket._gastosOperativos += monto;
      }
    }
  }

  const normalizedSeries = Object.values(byMonth)
    .sort((a, b) => String(a.monthKey).localeCompare(String(b.monthKey)))
    .map((bucket) => {
      const costos = num(bucket._costos, 0);
      const gastosOperativos = num(bucket._gastosOperativos, 0);
      const depAmort = num(bucket._depAmort, 0);
      const ingresos = num(bucket.ingresos, 0);

      const egresos = costos + gastosOperativos + depAmort;
      const utilidadBruta = ingresos - costos;
      const ebitda = utilidadBruta - gastosOperativos;
      const utilidadNeta = ingresos - egresos;

      return {
        mes: bucket.mes,
        monthKey: bucket.monthKey,
        ingresos: num(ingresos, 0),
        egresos: num(egresos, 0),
        utilidadBruta: num(utilidadBruta, 0),
        ebitda: num(ebitda, 0),
        utilidadNeta: num(utilidadNeta, 0),
      };
    });

  const totales = {
    ingresos: num(normalizedSeries.reduce((acc, x) => acc + num(x.ingresos, 0), 0), 0),
    egresos: num(normalizedSeries.reduce((acc, x) => acc + num(x.egresos, 0), 0), 0),
    utilidadBruta: num(normalizedSeries.reduce((acc, x) => acc + num(x.utilidadBruta, 0), 0), 0),
    ebitda: num(normalizedSeries.reduce((acc, x) => acc + num(x.ebitda, 0), 0), 0),
    utilidadNeta: num(normalizedSeries.reduce((acc, x) => acc + num(x.utilidadNeta, 0), 0), 0),
  };

  return { series: normalizedSeries, totales };
}

async function buildFlujoWaterfall({ now, journalEntries }) {
  const startYear = startOfYearLocal(now);
  const endToday = endOfTodayLocal(now);

  const series = makeEmptyFlujoSeries(now);
  const byMonth = Object.fromEntries(series.map((s) => [s.monthKey, s]));

  let saldoInicial = 0;

  for (const entry of journalEntries || []) {
    const entryDate = pickEffectiveDate(entry);
    if (!entryDate) continue;

    const lines = pickEntryLines(entry);

    // saldo inicial del año
    if (entryDate.getTime() < startYear.getTime()) {
      for (const line of lines) {
        const code = lineCode(line);
        if (!isCashOrBank(code)) continue;
        saldoInicial += lineDebit(line) - lineCredit(line);
      }
      continue;
    }

    // fuera del periodo visible
    if (entryDate.getTime() > endToday.getTime()) continue;

    const monthKey = toYMLocal(entryDate);
    if (!monthKey || !byMonth[monthKey]) continue;

    const bucket = byMonth[monthKey];
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
  const normalizedSeries = series.map((bucket) => {
    const operativo = num(bucket.operativo, 0);
    const inversion = num(bucket.inversion, 0);
    const financiamiento = num(bucket.financiamiento, 0);
    const neto = operativo + inversion + financiamiento;

    running += neto;

    return {
      ...bucket,
      operativo,
      inversion,
      financiamiento,
      neto: num(neto, 0),
      acumulado: num(running, 0),
    };
  });

  return {
    saldoInicial: num(saldoInicial, 0),
    saldoFinal: num(running, 0),
    seriesMensuales: normalizedSeries,
  };
}

async function buildBalanceGeneral({ now, journalEntries }) {
  const endToday = endOfTodayLocal(now);

  const estructura = {
    activoCirculante: 0,
    activoNoCirculante: 0,
    pasivoCirculante: 0,
    pasivoNoCirculante: 0,
    capitalContable: 0,
  };

  const byCode = {};
  let resultadoEjercicio = 0;

  for (const entry of journalEntries || []) {
    const entryDate = pickEffectiveDate(entry);
    if (!entryDate) continue;
    if (entryDate.getTime() > endToday.getTime()) continue;

    const lines = pickEntryLines(entry);

    for (const line of lines) {
      const code = lineCode(line);
      if (!code) continue;

      if (!byCode[code]) {
        byCode[code] = { debe: 0, haber: 0, name: lineName(line) || "" };
      }

      byCode[code].debe += lineDebit(line);
      byCode[code].haber += lineCredit(line);

      // resultado del ejercicio del año en curso
      if (isSameLocalYear(entryDate, now)) {
        const debe = lineDebit(line);
        const haber = lineCredit(line);

        if (code.startsWith("4")) resultadoEjercicio += haber - debe;
        else if (code.startsWith("5") || code.startsWith("6")) resultadoEjercicio -= debe - haber;
      }
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

  // 🔥 FIX clave: sumar resultado del ejercicio al capital contable
  estructura.capitalContable += num(resultadoEjercicio, 0);

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

    const due = tx?.fechaVencimiento ?? tx?.fecha_vencimiento ?? null;
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
    const now = new Date();

    // 🔥 Una sola lectura de JournalEntry para evitar inconsistencias
    const journalEntries = JournalEntry
      ? await JournalEntry.find({ owner }).sort({ createdAt: 1 }).lean()
      : [];

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
      buildVentasYKpis({ now, journalEntries }),
      buildEstadoResultados({ now, journalEntries }),
      buildFlujoWaterfall({ now, journalEntries }),
      buildBalanceGeneral({ now, journalEntries }),
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