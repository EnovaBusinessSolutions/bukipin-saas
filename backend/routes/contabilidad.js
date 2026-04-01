// backend/routes/contabilidad.js
const express = require("express");
const router = express.Router();

const ensureAuth = require("../middleware/ensureAuth");
const JournalEntry = require("../models/JournalEntry");

const {
  TZ_OFFSET_MINUTES,
  parseStartDate,
  parseEndDate,
  toYMDLocal,
  pickEffectiveDate,
} = require("../utils/datetime");

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

function entryNumber(entry) {
  return (
    entry?.number ??
    entry?.numero_asiento ??
    entry?.numeroAsiento ??
    entry?.folio ??
    entry?.no ??
    ""
  );
}

function entryConcept(entry) {
  return (
    entry?.memo ??
    entry?.concepto ??
    entry?.concept ??
    entry?.descripcion ??
    entry?.description ??
    ""
  );
}

function sumEntry(entry) {
  const lines = pickEntryLines(entry);
  const debe = lines.reduce((acc, l) => acc + lineDebit(l), 0);
  const haber = lines.reduce((acc, l) => acc + lineCredit(l), 0);
  return { debe, haber };
}

function getEntryEffectiveDate(entry) {
  return pickEffectiveDate(entry);
}

function accountCodeExpr() {
  return {
    $ifNull: [
      "$lines.accountCodigo",
      {
        $ifNull: [
          "$lines.accountCode",
          {
            $ifNull: [
              "$lines.account_codigo",
              {
                $ifNull: ["$lines.cuentaCodigo", "$lines.cuenta_codigo"],
              },
            ],
          },
        ],
      },
    ],
  };
}

function accountNameExpr() {
  return {
    $ifNull: [
      "$lines.accountNombre",
      {
        $ifNull: [
          "$lines.accountName",
          {
            $ifNull: [
              "$lines.account_nombre",
              {
                $ifNull: ["$lines.cuentaNombre", "$lines.cuenta_nombre"],
              },
            ],
          },
        ],
      },
    ],
  };
}

function buildEntryDateOrConditions(start, end) {
  const conditions = [];

  if (start && end) {
    conditions.push({ date: { $gte: start, $lte: end } });
    conditions.push({ fecha: { $gte: start, $lte: end } });
    conditions.push({ entryDate: { $gte: start, $lte: end } });
    conditions.push({ asiento_fecha: { $gte: start, $lte: end } });
    conditions.push({ asientoFecha: { $gte: start, $lte: end } });
    return conditions;
  }

  if (end) {
    conditions.push({ date: { $lte: end } });
    conditions.push({ fecha: { $lte: end } });
    conditions.push({ entryDate: { $lte: end } });
    conditions.push({ asiento_fecha: { $lte: end } });
    conditions.push({ asientoFecha: { $lte: end } });
    return conditions;
  }

  if (start) {
    conditions.push({ date: { $gte: start } });
    conditions.push({ fecha: { $gte: start } });
    conditions.push({ entryDate: { $gte: start } });
    conditions.push({ asiento_fecha: { $gte: start } });
    conditions.push({ asientoFecha: { $gte: start } });
    return conditions;
  }

  return [];
}

function buildEntryMatch(owner, start, end) {
  const orConditions = buildEntryDateOrConditions(start, end);

  if (!orConditions.length) {
    return { owner };
  }

  return {
    owner,
    $or: orConditions,
  };
}

function inLocalRange(entry, start, end) {
  const d = getEntryEffectiveDate(entry);
  if (!d) return false;
  if (start && d.getTime() < start.getTime()) return false;
  if (end && d.getTime() > end.getTime()) return false;
  return true;
}

function mapEntryForUI(entry) {
  const lines = pickEntryLines(entry);

  const detalle_asientos = lines.map((l) => ({
    cuenta_codigo: lineCode(l),
    cuenta_nombre: lineName(l),
    debe: lineDebit(l),
    haber: lineCredit(l),
    memo: l?.memo ?? "",
  }));

  const { debe, haber } = sumEntry(entry);
  const effectiveDate = getEntryEffectiveDate(entry);

  return {
    id: String(entry?._id || ""),
    _id: entry?._id,

    numero_asiento: entryNumber(entry),
    asiento_fecha: toYMDLocal(effectiveDate),
    fecha: effectiveDate,

    concepto: entryConcept(entry),
    source: entry?.source ?? "",
    source_id: entry?.sourceId ? String(entry.sourceId) : null,

    debe_total: debe,
    haber_total: haber,

    detalle_asientos,

    created_at: entry?.createdAt ?? null,
    updated_at: entry?.updatedAt ?? null,
  };
}

function flattenDetalles(entries, { cuentaPrefix, cuentaCodigo } = {}) {
  const out = [];

  for (const e of entries || []) {
    const asientoFecha = toYMDLocal(getEntryEffectiveDate(e));
    const lines = pickEntryLines(e);

    for (const l of lines) {
      const codigo = lineCode(l);
      if (!codigo) continue;

      if (cuentaPrefix && !String(codigo).startsWith(String(cuentaPrefix))) continue;
      if (cuentaCodigo && String(codigo) !== String(cuentaCodigo)) continue;

      out.push({
        cuenta_codigo: codigo,
        cuenta_nombre: lineName(l),
        debe: lineDebit(l),
        haber: lineCredit(l),

        asiento_fecha: asientoFecha,
        asiento_id: String(e?._id || ""),

        concepto: entryConcept(e),
        source: e?.source ?? "",
        source_id: e?.sourceId ? String(e.sourceId) : null,

        memo: l?.memo ?? "",
      });
    }
  }

  return out;
}

// Naturaleza contable para saldos
function saldoPorNaturaleza(codigo, debe, haber) {
  const d = String(codigo || "").charAt(0);
  if (["1", "5", "6"].includes(d)) return num(debe, 0) - num(haber, 0);
  if (["2", "3", "4"].includes(d)) return num(haber, 0) - num(debe, 0);
  return num(debe, 0) - num(haber, 0);
}

async function aggregateByAccount({ owner, start = null, end = null }) {
  const match = buildEntryMatch(owner, start, end);

  return JournalEntry.aggregate([
    { $match: match },
    {
      $addFields: {
        __entry_date: {
          $ifNull: [
            "$date",
            {
              $ifNull: [
                "$fecha",
                {
                  $ifNull: [
                    "$entryDate",
                    { $ifNull: ["$asiento_fecha", "$asientoFecha"] },
                  ],
                },
              ],
            },
          ],
        },
      },
    },
    { $unwind: "$lines" },
    {
      $project: {
        cuenta_codigo: accountCodeExpr(),
        cuenta_nombre: accountNameExpr(),
        debit: {
          $convert: {
            input: { $ifNull: ["$lines.debit", "$lines.debe"] },
            to: "double",
            onError: 0,
            onNull: 0,
          },
        },
        credit: {
          $convert: {
            input: { $ifNull: ["$lines.credit", "$lines.haber"] },
            to: "double",
            onError: 0,
            onNull: 0,
          },
        },
        __entry_date: 1,
        createdAt: 1,
      },
    },
    { $match: { cuenta_codigo: { $ne: "" } } },
    {
      $group: {
        _id: "$cuenta_codigo",
        cuenta_nombre: { $last: "$cuenta_nombre" },
        debe: { $sum: "$debit" },
        haber: { $sum: "$credit" },
        fechas: { $push: "$__entry_date" },
        createdAts: { $push: "$createdAt" },
      },
    },
  ]);
}

// ======================================================
// Routes
// ======================================================

router.get("/ping", ensureAuth, (req, res) => {
  return res.json({
    ok: true,
    route: "contabilidad",
    user: String(req.user?._id || ""),
    time: new Date().toISOString(),
    timezoneOffsetMinutes: TZ_OFFSET_MINUTES,
  });
});

async function handleDetalleAsientos(req, res) {
  try {
    const owner = req.user._id;

    const start = parseStartDate(req.query.from || req.query.start);
    const end = parseEndDate(req.query.to || req.query.end);

    if (!start || !end) {
      return res.status(400).json({
        ok: false,
        message: "from/to (o start/end) son requeridos.",
      });
    }

    const cuentaPrefix = req.query.cuenta_prefix ? String(req.query.cuenta_prefix) : null;
    const cuentaCodigo = req.query.cuenta_codigo ? String(req.query.cuenta_codigo) : null;

    const rawEntries = await JournalEntry.find(buildEntryMatch(owner, start, end))
      .sort({ createdAt: -1, _id: -1 })
      .lean();

    const entries = rawEntries.filter((e) => inLocalRange(e, start, end));
    entries.sort((a, b) => {
      const da = getEntryEffectiveDate(a);
      const db = getEntryEffectiveDate(b);
      const ta = da ? da.getTime() : 0;
      const tb = db ? db.getTime() : 0;
      if (tb !== ta) return tb - ta;
      return new Date(b?.createdAt || 0).getTime() - new Date(a?.createdAt || 0).getTime();
    });

    const detalles = flattenDetalles(entries, { cuentaPrefix, cuentaCodigo });

    const debeTotal = detalles.reduce((acc, d) => acc + num(d.debe, 0), 0);
    const haberTotal = detalles.reduce((acc, d) => acc + num(d.haber, 0), 0);

    return res.json({
      ok: true,
      data: {
        detalles,
        resumen: {
          count: detalles.length,
          debeTotal,
          haberTotal,
        },
        meta: {
          from: req.query.from || req.query.start || null,
          to: req.query.to || req.query.end || null,
          timezoneOffsetMinutes: TZ_OFFSET_MINUTES,
        },
      },
      detalles,
      detalle_asientos: detalles,
    });
  } catch (err) {
    console.error("GET /api/contabilidad/*detalle* error:", err);
    return res.status(500).json({
      ok: false,
      message: "Error cargando detalle de asientos",
    });
  }
}

router.get("/detalle-asientos", ensureAuth, handleDetalleAsientos);
router.get("/asientos/detalle", ensureAuth, handleDetalleAsientos);

async function handleGetAsientos(req, res) {
  try {
    const owner = req.user._id;

    const start = parseStartDate(req.query.from || req.query.start);
    const end = parseEndDate(req.query.to || req.query.end);

    if (!start || !end) {
      return res.status(400).json({
        ok: false,
        message: "from/to (o start/end) son requeridos.",
      });
    }

    const prevEnd = new Date(start.getTime() - 1);

    const rawEntries = await JournalEntry.find(buildEntryMatch(owner, start, end))
      .sort({ createdAt: -1, _id: -1 })
      .lean();

    const entries = rawEntries.filter((e) => inLocalRange(e, start, end));
    entries.sort((a, b) => {
      const da = getEntryEffectiveDate(a);
      const db = getEntryEffectiveDate(b);
      const ta = da ? da.getTime() : 0;
      const tb = db ? db.getTime() : 0;
      if (tb !== ta) return tb - ta;
      return new Date(b?.createdAt || 0).getTime() - new Date(a?.createdAt || 0).getTime();
    });

    const asientos = entries.map(mapEntryForUI);

    const totalDebe = asientos.reduce((acc, a) => acc + num(a.debe_total, 0), 0);
    const totalHaber = asientos.reduce((acc, a) => acc + num(a.haber_total, 0), 0);
    const cuadrado = Math.abs(totalDebe - totalHaber) < 0.01;

    const [histAgg, perAgg] = await Promise.all([
      aggregateByAccount({ owner, end: prevEnd }),
      aggregateByAccount({ owner, start, end }),
    ]);

    const histMap = new Map();
    for (const r of histAgg || []) {
      const codigo = String(r?._id || "").trim();
      if (!codigo) continue;
      histMap.set(codigo, {
        cuenta_codigo: codigo,
        cuenta_nombre: String(r?.cuenta_nombre || "").trim(),
        debe: num(r?.debe, 0),
        haber: num(r?.haber, 0),
      });
    }

    const perMap = new Map();
    for (const r of perAgg || []) {
      const codigo = String(r?._id || "").trim();
      if (!codigo) continue;
      perMap.set(codigo, {
        cuenta_codigo: codigo,
        cuenta_nombre: String(r?.cuenta_nombre || "").trim(),
        debe_total: num(r?.debe, 0),
        haber_total: num(r?.haber, 0),
      });
    }

    const allCodes = new Set([...histMap.keys(), ...perMap.keys()]);

    const saldosPorCuenta = {};
    let saldoInicialTotal = 0;
    let saldoFinalTotal = 0;

    for (const codigo of allCodes) {
      const h = histMap.get(codigo) || {
        cuenta_nombre: "",
        debe: 0,
        haber: 0,
      };

      const p = perMap.get(codigo) || {
        cuenta_nombre: h.cuenta_nombre || "",
        debe_total: 0,
        haber_total: 0,
      };

      const saldo_inicial = saldoPorNaturaleza(codigo, h.debe, h.haber);
      const neto_periodo = saldoPorNaturaleza(codigo, p.debe_total, p.haber_total);
      const saldo_final = saldo_inicial + neto_periodo;

      saldosPorCuenta[codigo] = {
        cuenta_codigo: codigo,
        cuenta_nombre: p.cuenta_nombre || h.cuenta_nombre || "",
        saldo_inicial,
        debe_total: num(p.debe_total, 0),
        haber_total: num(p.haber_total, 0),
        saldo_final,
      };

      saldoInicialTotal += saldo_inicial;
      saldoFinalTotal += saldo_final;
    }

    return res.json({
      ok: true,
      data: {
        asientos,
        items: asientos,
        totalDebe,
        totalHaber,
        cuadrado,
        count: asientos.length,
        saldosPorCuenta,
        saldoInicialTotal,
        saldoFinalTotal,
        meta: {
          from: req.query.from || req.query.start || null,
          to: req.query.to || req.query.end || null,
          timezoneOffsetMinutes: TZ_OFFSET_MINUTES,
        },
      },

      asientos,
      items: asientos,
      totalDebe,
      totalHaber,
      cuadrado,
      count: asientos.length,
      saldosPorCuenta,
      saldoInicialTotal,
      saldoFinalTotal,
    });
  } catch (err) {
    console.error("GET /api/contabilidad/asientos error:", err);
    return res.status(500).json({
      ok: false,
      message: "Error cargando asientos",
    });
  }
}

router.get(
  ["/asientos", "/asientos-balanza", "/asientos_balanza", "/balanza/asientos"],
  ensureAuth,
  handleGetAsientos
);

module.exports = router;