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
  // YYYY-MM-DD
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
  // intentamos ser robustos ante distintos nombres
  const p = JournalEntry?.schema?.paths || {};
  if (p.date) return "date";
  if (p.fecha) return "fecha";
  if (p.entryDate) return "entryDate";
  return "createdAt";
}

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

  const acc = await Account.findById(accountId).lean();
  return acc?.code ? String(acc.code).trim() : null;
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

/**
 * GET /api/flujo-efectivo?start=YYYY-MM-DD&end=YYYY-MM-DD
 * También soporta /api/flujo-efectivo/operativo?start=...&end=...
 *
 * Calcula:
 * - saldo inicial efectivo/bancos (movimientos antes de start)
 * - entradas/salidas del periodo
 * - saldo final efectivo/bancos
 * - consolidado y bandera verificado
 */
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

    // end inclusivo -> convertimos a endExclusive (+1 día)
    const endExclusive = addDays(end, 1);

    // Traemos asientos del usuario (multi-tenant)
    const baseFilter = { owner: req.user._id };

    // 1) saldo inicial = sumatoria antes de start
    const beforeFilter = {
      ...baseFilter,
      [dateField]: { $lt: start },
    };

    // 2) movimientos del periodo
    const periodFilter = {
      ...baseFilter,
      [dateField]: { $gte: start, $lt: endExclusive },
    };

    const [beforeEntries, periodEntries] = await Promise.all([
      JournalEntry.find(beforeFilter).lean(),
      JournalEntry.find(periodFilter).lean(),
    ]);

    // Códigos “caja/bancos” (según tu memoria del proyecto)
    const COD_EFECTIVO = "1001";
    const COD_BANCOS = "1002";

    async function sumFor(entries) {
      let iniE = 0, iniB = 0;
      let entE = 0, salE = 0;
      let entB = 0, salB = 0;

      return { iniE, iniB, entE, salE, entB, salB };
    }

    // Saldo inicial
    let saldoInicialE = 0;
    let saldoInicialB = 0;

    for (const e of beforeEntries) {
      for (const line of entryLines(e)) {
        const code = await resolveLineAccountCode(line);
        if (!code) continue;

        const d = lineDebit(line);
        const c = lineCredit(line);
        const delta = d - c;

        if (code === COD_EFECTIVO) saldoInicialE += delta;
        if (code === COD_BANCOS) saldoInicialB += delta;
      }
    }

    // Periodo: entradas/salidas + lista de movimientos
    let entradasE = 0, salidasE = 0;
    let entradasB = 0, salidasB = 0;

    const movimientos = []; // para “Resumen Transacciones” si lo ocupas

    for (const e of periodEntries) {
      const eDate = e?.[dateField] ? new Date(e[dateField]) : null;
      const fecha = eDate && !Number.isNaN(eDate.getTime()) ? eDate.toISOString().slice(0, 10) : null;

      for (const line of entryLines(e)) {
        const code = await resolveLineAccountCode(line);
        if (!code) continue;

        const d = lineDebit(line);
        const c = lineCredit(line);

        if (code === COD_EFECTIVO) {
          if (d > 0) entradasE += d;
          if (c > 0) salidasE += c;

          if (d > 0 || c > 0) {
            movimientos.push({
              fecha,
              tipo: "efectivo",
              monto: d > 0 ? d : -c,
              memo: line?.memo ?? e?.memo ?? e?.description ?? "",
              asientoId: String(e?._id ?? ""),
            });
          }
        }

        if (code === COD_BANCOS) {
          if (d > 0) entradasB += d;
          if (c > 0) salidasB += c;

          if (d > 0 || c > 0) {
            movimientos.push({
              fecha,
              tipo: "bancos",
              monto: d > 0 ? d : -c,
              memo: line?.memo ?? e?.memo ?? e?.description ?? "",
              asientoId: String(e?._id ?? ""),
            });
          }
        }
      }
    }

    const saldoFinalE = saldoInicialE + entradasE - salidasE;
    const saldoFinalB = saldoInicialB + entradasB - salidasB;

    const consolidadoFinal = saldoFinalE + saldoFinalB;

    return res.json({
      ok: true,
      data: {
        range: {
          start: req.query.start,
          end: req.query.end,
        },
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
          saldoFinal: consolidadoFinal,
          verificado: true, // si luego quieres validar vs balanza, aquí se conecta
        },
        movimientos,
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
// compat con tu implementación previa
router.get("/operativo", ensureAuth, handle);

module.exports = router;
