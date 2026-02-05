// backend/routes/contabilidad.js
const express = require("express");
const router = express.Router();

const ensureAuth = require("../middleware/ensureAuth");
const JournalEntry = require("../models/JournalEntry");

/**
 * Fechas (MUY IMPORTANTE):
 * new Date("YYYY-MM-DD") se interpreta como UTC y rompe rangos en MX.
 * Usamos "T00:00:00" (local) y para end usamos fin de día.
 */
function parseStartDate(s) {
  if (!s) return null;
  const str = String(s).trim();
  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(str);
  const d = new Date(isDateOnly ? `${str}T00:00:00` : str);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseEndDate(s) {
  if (!s) return null;
  const str = String(s).trim();
  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(str);
  const d = new Date(isDateOnly ? `${str}T23:59:59.999` : str);
  return Number.isNaN(d.getTime()) ? null : d;
}

function num(v, def = 0) {
  if (v == null) return def;
  const n = Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : def;
}

function toYMD(d) {
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return null;
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const day = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function lineCode(line) {
  return (
    (line && (line.accountCodigo || line.accountCode || line.account_codigo)) ??
    null
  );
}

function lineName(line) {
  return (
    (line &&
      (line.accountNombre ||
        line.accountName ||
        line.account_nombre ||
        line.cuenta_nombre)) ??
    null
  );
}

function entryNumber(entry) {
  return (
    entry.number ??
    entry.numero_asiento ??
    entry.numeroAsiento ??
    entry.folio ??
    entry.no ??
    ""
  );
}

function entryConcept(entry) {
  return (
    entry.memo ??
    entry.concepto ??
    entry.concept ??
    entry.descripcion ??
    entry.description ??
    ""
  );
}

function sumEntry(entry) {
  const lines = Array.isArray(entry.lines) ? entry.lines : [];
  const debe = lines.reduce((acc, l) => acc + num(l.debit, 0), 0);
  const haber = lines.reduce((acc, l) => acc + num(l.credit, 0), 0);
  return { debe, haber };
}

function mapEntryForUI(entry) {
  const lines = Array.isArray(entry.lines) ? entry.lines : [];

  const detalle_asientos = lines.map((l) => ({
    cuenta_codigo: lineCode(l),
    cuenta_nombre: lineName(l),
    debe: num(l.debit, 0),
    haber: num(l.credit, 0),
    memo: l.memo ?? "",
  }));

  const { debe, haber } = sumEntry(entry);

  return {
    id: String(entry._id),
    _id: entry._id,

    numero_asiento: entryNumber(entry),
    asiento_fecha: toYMD(entry.date),
    fecha: entry.date,

    concepto: entryConcept(entry),
    source: entry.source ?? "",
    source_id: entry.sourceId ? String(entry.sourceId) : null,

    // Totales por asiento (útil para UI de balanza)
    debe_total: debe,
    haber_total: haber,

    detalle_asientos,

    created_at: entry.createdAt,
    updated_at: entry.updatedAt,
  };
}

function flattenDetalles(entries, { cuentaPrefix, cuentaCodigo } = {}) {
  const out = [];

  for (const e of entries) {
    const asientoFecha = toYMD(e.date);

    for (const l of e.lines || []) {
      const codigo = lineCode(l);

      if (
        cuentaPrefix &&
        (!codigo || !String(codigo).startsWith(String(cuentaPrefix)))
      )
        continue;
      if (cuentaCodigo && String(codigo) !== String(cuentaCodigo)) continue;

      out.push({
        cuenta_codigo: codigo,
        cuenta_nombre: lineName(l),
        debe: num(l.debit, 0),
        haber: num(l.credit, 0),

        asiento_fecha: asientoFecha,
        asiento_id: String(e._id),

        concepto: entryConcept(e),
        source: e.source ?? "",
        source_id: e.sourceId ? String(e.sourceId) : null,

        memo: l.memo ?? "",
      });
    }
  }

  return out;
}

// Naturaleza contable para saldos (mismo criterio que el frontend)
function saldoPorNaturaleza(codigo, debe, haber) {
  const d = String(codigo || "").charAt(0);
  // Deudora: Activos(1), Costos(5), Gastos(6)
  if (["1", "5", "6"].includes(d)) return debe - haber;
  // Acreedora: Pasivos(2), Capital(3), Ingresos(4)
  if (["2", "3", "4"].includes(d)) return haber - debe;
  return debe - haber;
}

/**
 * ✅ (debug) GET /api/contabilidad/ping
 * Sirve para confirmar que esta ruta está montada en producción.
 */
router.get("/ping", ensureAuth, (req, res) => {
  res.json({ ok: true, route: "contabilidad", user: String(req.user?._id) });
});

/**
 * ✅ Handler reutilizable para detalle-asientos
 * Necesario porque el frontend está llamando /asientos/detalle (y antes era /detalle-asientos).
 */
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

    const cuentaPrefix = req.query.cuenta_prefix
      ? String(req.query.cuenta_prefix)
      : null;
    const cuentaCodigo = req.query.cuenta_codigo
      ? String(req.query.cuenta_codigo)
      : null;

    const entries = await JournalEntry.find({
      owner,
      date: { $gte: start, $lte: end },
    })
      .sort({ date: -1, createdAt: -1 })
      .lean();

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
      },
      detalles, // compat
      detalle_asientos: detalles, // compat legacy
    });
  } catch (err) {
    console.error("GET /api/contabilidad/*detalle* error:", err);
    return res
      .status(500)
      .json({ ok: false, message: "Error cargando detalle de asientos" });
  }
}

/**
 * ✅ GET /api/contabilidad/detalle-asientos?from=YYYY-MM-DD&to=YYYY-MM-DD
 * ✅ GET /api/contabilidad/asientos/detalle?start=YYYY-MM-DD&end=YYYY-MM-DD   <-- ALIAS NUEVO (para tu frontend)
 */
router.get("/detalle-asientos", ensureAuth, handleDetalleAsientos);
router.get("/asientos/detalle", ensureAuth, handleDetalleAsientos);

/**
 * ✅ GET /api/contabilidad/asientos?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Soporta también start/end.
 *
 * 🔥 IMPORTANTE: agregamos ALIASES para cubrir naming del prototipo y evitar 404:
 * - /asientos-balanza
 * - /asientos_balanza
 * - /balanza/asientos
 */
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

    // Día anterior al inicio (para saldo inicial real)
    const prevEnd = new Date(start.getTime() - 1);

    // 1) Asientos del periodo (para UI actual: lista + modal)
    const entries = await JournalEntry.find({
      owner,
      date: { $gte: start, $lte: end },
    })
      .sort({ date: -1, createdAt: -1 })
      .lean();

    const asientos = entries.map(mapEntryForUI);

    const totalDebe = asientos.reduce((acc, a) => acc + num(a.debe_total, 0), 0);
    const totalHaber = asientos.reduce(
      (acc, a) => acc + num(a.haber_total, 0),
      0
    );
    const cuadrado = Math.abs(totalDebe - totalHaber) < 0.01;

    // =========================
    // 2) SALDOS POR CUENTA (E2E)
    // saldo_inicial: acumulado hasta prevEnd
    // debe_total/haber_total: del periodo
    // saldo_final: saldo_inicial + neto del periodo (por naturaleza)
    // =========================

    // Código de cuenta robusto dentro de aggregate
    const accountCodeExpr = {
      $ifNull: [
        "$lines.accountCodigo",
        { $ifNull: ["$lines.accountCode", "$lines.account_codigo"] },
      ],
    };

    // HISTÓRICO: <= prevEnd
    const histAgg = await JournalEntry.aggregate([
      { $match: { owner, date: { $lte: prevEnd } } },
      { $unwind: "$lines" },
      {
        $project: {
          cuenta_codigo: accountCodeExpr,
          debit: { $toDouble: { $ifNull: ["$lines.debit", 0] } },
          credit: { $toDouble: { $ifNull: ["$lines.credit", 0] } },
        },
      },
      { $match: { cuenta_codigo: { $ne: null, $ne: "" } } },
      {
        $group: {
          _id: "$cuenta_codigo",
          debe: { $sum: "$debit" },
          haber: { $sum: "$credit" },
        },
      },
    ]);

    // PERIODO: start..end
    const perAgg = await JournalEntry.aggregate([
      { $match: { owner, date: { $gte: start, $lte: end } } },
      { $unwind: "$lines" },
      {
        $project: {
          cuenta_codigo: accountCodeExpr,
          debit: { $toDouble: { $ifNull: ["$lines.debit", 0] } },
          credit: { $toDouble: { $ifNull: ["$lines.credit", 0] } },
        },
      },
      { $match: { cuenta_codigo: { $ne: null, $ne: "" } } },
      {
        $group: {
          _id: "$cuenta_codigo",
          debe_total: { $sum: "$debit" },
          haber_total: { $sum: "$credit" },
        },
      },
    ]);

    const histMap = new Map();
    for (const r of histAgg || []) {
      const codigo = String(r._id || "").trim();
      if (!codigo) continue;
      histMap.set(codigo, { debe: num(r.debe, 0), haber: num(r.haber, 0) });
    }

    const perMap = new Map();
    for (const r of perAgg || []) {
      const codigo = String(r._id || "").trim();
      if (!codigo) continue;
      perMap.set(codigo, {
        debe_total: num(r.debe_total, 0),
        haber_total: num(r.haber_total, 0),
      });
    }

    const allCodes = new Set([
      ...Array.from(histMap.keys()),
      ...Array.from(perMap.keys()),
    ]);

    const saldosPorCuenta = {};
    let saldoInicialTotal = 0;
    let saldoFinalTotal = 0;

    for (const codigo of allCodes) {
      const h = histMap.get(codigo) || { debe: 0, haber: 0 };
      const p = perMap.get(codigo) || { debe_total: 0, haber_total: 0 };

      const saldo_inicial = saldoPorNaturaleza(codigo, h.debe, h.haber);
      const neto_periodo = saldoPorNaturaleza(
        codigo,
        p.debe_total,
        p.haber_total
      );
      const saldo_final = saldo_inicial + neto_periodo;

      saldosPorCuenta[codigo] = {
        cuenta_codigo: codigo,
        saldo_inicial,
        debe_total: p.debe_total,
        haber_total: p.haber_total,
        saldo_final,
      };

      saldoInicialTotal += saldo_inicial;
      saldoFinalTotal += saldo_final;
    }

    return res.json({
      ok: true,
      data: {
        asientos,
        items: asientos, // alias útil para UIs distintas
        totalDebe,
        totalHaber,
        cuadrado,
        count: asientos.length,

        // ✅ NUEVO E2E (NO rompe lo existente)
        saldosPorCuenta,
        saldoInicialTotal,
        saldoFinalTotal,
      },

      // compat legacy
      asientos,
      items: asientos,
      totalDebe,
      totalHaber,
      cuadrado,
      count: asientos.length,

      // compat extra
      saldosPorCuenta,
      saldoInicialTotal,
      saldoFinalTotal,
    });
  } catch (err) {
    console.error("GET /api/contabilidad/asientos error:", err);
    return res
      .status(500)
      .json({ ok: false, message: "Error cargando asientos" });
  }
}

router.get(
  ["/asientos", "/asientos-balanza", "/asientos_balanza", "/balanza/asientos"],
  ensureAuth,
  handleGetAsientos
);

module.exports = router;
