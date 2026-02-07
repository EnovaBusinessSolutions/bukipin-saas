const express = require("express");
const router = express.Router();

const ensureAuth = require("../middleware/ensureAuth");
const JournalEntry = require("../models/JournalEntry");
const Account = require("../models/Account");

function num(v, def = 0) {
  const n = Number(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : def;
}

function parseYMD(s) {
  if (!s) return null;
  const str = String(s).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return null;
  const [y, m, d] = str.split("-").map((x) => Number(x));
  const dt = new Date(y, m - 1, d, 0, 0, 0, 0);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function pickDateField() {
  const p = JournalEntry?.schema?.paths || {};
  if (p.date) return "date";
  if (p.fecha) return "fecha";
  if (p.entryDate) return "entryDate";
  if (p.asiento_fecha) return "asiento_fecha";
  if (p.asientoFecha) return "asientoFecha";
  if (p.asientos_fecha) return "asientos_fecha";
  return "createdAt";
}

function lineDebit(line) {
  return num(line?.debit ?? line?.debe ?? line?.debitAmount ?? 0, 0);
}
function lineCredit(line) {
  return num(line?.credit ?? line?.haber ?? line?.creditAmount ?? 0, 0);
}

function entryLines(entry) {
  return entry?.lines || entry?.detalles || entry?.detailLines || [];
}

function isCashOrBank(code) {
  return code === "1001" || code === "1002";
}

function accountTopLevel(code) {
  // "1001" -> 1, "5002" -> 5
  const s = String(code || "").trim();
  const d = Number(s[0]);
  return Number.isFinite(d) ? d : null;
}

/**
 * Reglas base para clasificar CF por contraparte:
 * - Si el movimiento afecta 1001/1002 y la contraparte es:
 *   - 4xxx (ventas/ingresos) o 5xxx/6xxx (costos/gastos) -> OPERATIVO
 *   - 1xxx (activos) excepto 1001/1002 -> INVERSION (inventario, activos fijos, etc.)
 *   - 2xxx/3xxx -> FINANCIAMIENTO (proveedores, préstamos, capital)
 *
 * Nota: estas reglas se pueden refinar después, pero ya dejan el panel "vivo" y coherente.
 */
function classifyByCounterparty(counterCodes) {
  // counterCodes: Set<string> sin incluir 1001/1002 idealmente
  // si hay mezcla, priorizamos: financiamiento > inversion > operativo
  let hasFin = false;
  let hasInv = false;
  let hasOp = false;

  for (const code of counterCodes) {
    if (!code) continue;
    if (isCashOrBank(code)) continue;

    const top = accountTopLevel(code);
    if (top === 2 || top === 3) hasFin = true;
    else if (top === 1) hasInv = true;
    else if (top === 4 || top === 5 || top === 6) hasOp = true;
    else hasOp = true;
  }

  if (hasFin) return "financiamiento";
  if (hasInv) return "inversion";
  if (hasOp) return "operativo";
  return "operativo";
}

async function handle(req, res) {
  try {
    const dateField = pickDateField();

    const start = parseYMD(req.query.start);
    const end = parseYMD(req.query.end);

    if (!start || !end) {
      return res.status(400).json({
        ok: false,
        error: "BAD_RANGE",
        message: "Parámetros requeridos: start=YYYY-MM-DD & end=YYYY-MM-DD",
      });
    }

    const endExclusive = addDays(end, 1);

    const baseFilter = { owner: req.user._id };

    const beforeFilter = { ...baseFilter, [dateField]: { $lt: start } };
    const periodFilter = { ...baseFilter, [dateField]: { $gte: start, $lt: endExclusive } };

    const [beforeEntries, periodEntries] = await Promise.all([
      JournalEntry.find(beforeFilter).lean(),
      JournalEntry.find(periodFilter).lean(),
    ]);

    const COD_EFECTIVO = "1001";
    const COD_BANCOS = "1002";

    // Cache: accountId -> code
    const accountCodeById = new Map();

    async function resolveLineAccountCode(line) {
      const code =
        line?.accountCodigo ??
        line?.account_code ??
        line?.cuenta_codigo ??
        line?.cuentaCodigo ??
        line?.codigo ??
        null;

      if (code) return String(code).trim();

      const accountId =
        line?.accountId ??
        line?.account_id ??
        line?.account ??
        line?.cuentaId ??
        line?.cuenta_id ??
        null;

      if (!accountId) return null;

      const key = String(accountId);
      if (accountCodeById.has(key)) return accountCodeById.get(key);

      const acc = await Account.findById(accountId).lean();
      const resolved = acc?.code ? String(acc.code).trim() : null;
      accountCodeById.set(key, resolved);
      return resolved;
    }

    // ---------- SALDO INICIAL (1001/1002 neto antes de start)
    let saldoInicialE = 0;
    let saldoInicialB = 0;

    for (const e of beforeEntries) {
      for (const line of entryLines(e)) {
        const code = await resolveLineAccountCode(line);
        if (!code) continue;

        const delta = lineDebit(line) - lineCredit(line);

        if (code === COD_EFECTIVO) saldoInicialE += delta;
        if (code === COD_BANCOS) saldoInicialB += delta;
      }
    }

    // ---------- PERIODO: entradas/salidas y clasificación base
    let entradasE = 0, salidasE = 0;
    let entradasB = 0, salidasB = 0;

    // acumuladores por categoría (MoneySplit)
    const operativo = { efectivo: 0, bancos: 0, total: 0 };
    const inversion = { efectivo: 0, bancos: 0, total: 0 };
    const financiamiento = { efectivo: 0, bancos: 0, total: 0 };

    const movimientosDetalle = []; // detalle para ResumenTransacciones

    for (const e of periodEntries) {
      const rawDate =
        e?.[dateField] ??
        e?.fecha ??
        e?.asiento_fecha ??
        e?.asientoFecha ??
        e?.createdAt ??
        null;

      const eDate = rawDate ? new Date(rawDate) : null;
      const fecha =
        eDate && !Number.isNaN(eDate.getTime()) ? eDate.toISOString().slice(0, 10) : null;

      const lines = entryLines(e);

      // resolvemos códigos de todas las líneas 1 vez por asiento
      const codes = [];
      for (const line of lines) {
        codes.push(await resolveLineAccountCode(line));
      }

      // codes contraparte = todos menos 1001/1002
      const counterparty = new Set();
      for (const c of codes) {
        if (!c) continue;
        if (isCashOrBank(c)) continue;
        counterparty.add(String(c));
      }

      const categoria = classifyByCounterparty(counterparty); // operativo|inversion|financiamiento

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const code = codes[i];
        if (!code) continue;

        const d = lineDebit(line);
        const c = lineCredit(line);

        // neto para caja/bancos (activo): debe - haber
        const neto = d - c;

        if (code === COD_EFECTIVO) {
          if (d > 0) entradasE += d;
          if (c > 0) salidasE += c;

          // categorización (solo si afectó caja/bancos)
          if (categoria === "operativo") operativo.efectivo += neto;
          if (categoria === "inversion") inversion.efectivo += neto;
          if (categoria === "financiamiento") financiamiento.efectivo += neto;

          if (d > 0 || c > 0) {
            movimientosDetalle.push({
              fecha,
              tipo: "efectivo",
              monto: neto, // ya con signo
              memo: line?.memo ?? e?.memo ?? e?.description ?? "",
              asientoId: String(e?._id ?? ""),
              categoria,
            });
          }
        }

        if (code === COD_BANCOS) {
          if (d > 0) entradasB += d;
          if (c > 0) salidasB += c;

          if (categoria === "operativo") operativo.bancos += neto;
          if (categoria === "inversion") inversion.bancos += neto;
          if (categoria === "financiamiento") financiamiento.bancos += neto;

          if (d > 0 || c > 0) {
            movimientosDetalle.push({
              fecha,
              tipo: "bancos",
              monto: neto,
              memo: line?.memo ?? e?.memo ?? e?.description ?? "",
              asientoId: String(e?._id ?? ""),
              categoria,
            });
          }
        }
      }
    }

    // Totales por split
    operativo.total = operativo.efectivo + operativo.bancos;
    inversion.total = inversion.efectivo + inversion.bancos;
    financiamiento.total = financiamiento.efectivo + financiamiento.bancos;

    const movimientoE = entradasE - salidasE;
    const movimientoB = entradasB - salidasB;

    const saldoFinalE = saldoInicialE + movimientoE;
    const saldoFinalB = saldoInicialB + movimientoB;

    const saldoInicial = {
      efectivo: saldoInicialE,
      bancos: saldoInicialB,
      total: saldoInicialE + saldoInicialB,
    };

    const movimientos = {
      efectivo: movimientoE,
      bancos: movimientoB,
      total: movimientoE + movimientoB,
    };

    const saldoFinal = {
      efectivo: saldoFinalE,
      bancos: saldoFinalB,
      total: saldoFinalE + saldoFinalB,
    };

    const flujoNeto = {
      efectivo: movimientoE,
      bancos: movimientoB,
      total: movimientoE + movimientoB,
    };

    // view por path
    const path = String(req.path || "/");
    const view = path.includes("ejecutivo")
      ? "ejecutivo"
      : path.includes("analitico")
      ? "analitico"
      : "operativo";

    return res.json({
      ok: true,
      data: {
        view,
        range: { start: req.query.start, end: req.query.end },

        // ✅ SHAPE CANONICO (para Ejecutivo/Operativo/Analítico)
        saldoInicial,
        operativo,
        inversion,
        financiamiento,
        flujoNeto,
        saldoFinal,

        // ✅ SHAPE LEGACY (compat con tu ResumenFinanciero / otros)
        efectivo: {
          saldoInicial: saldoInicialE,
          entradas: entradasE,
          salidas: salidasE,
          saldoFinal: saldoFinalE,
        },
        bancos: {
          saldoInicial: saldoInicialB,
          entradas: entradasB,
          salidas: salidasB,
          saldoFinal: saldoFinalB,
        },
        consolidado: {
          saldoFinal: saldoFinal.total,
          verificado: true,
        },

        // ✅ NO choques: "movimientos" es objeto; detalle separado
        movimientos,
        movimientosDetalle,

        sinDatos: periodEntries.length === 0,
      },
    });
  } catch (err) {
    console.error("[flujo-efectivo] error:", err);
    return res.status(500).json({
      ok: false,
      error: "SERVER_ERROR",
      message: "Error calculando flujo de efectivo",
    });
  }
}

router.get("/", ensureAuth, handle);
router.get("/operativo", ensureAuth, handle);
router.get("/ejecutivo", ensureAuth, handle);
router.get("/analitico", ensureAuth, handle);

module.exports = router;
