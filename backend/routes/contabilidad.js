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
  const n = Number(v);
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

function mapEntryForUI(entry) {
  const detalle_asientos = (entry.lines || []).map((l) => ({
    cuenta_codigo: lineCode(l),
    debe: num(l.debit, 0),
    haber: num(l.credit, 0),
    memo: l.memo ?? "",
  }));

  return {
    id: String(entry._id),
    _id: entry._id,

    asiento_fecha: toYMD(entry.date),
    fecha: entry.date,

    concepto: entry.concept ?? "",
    source: entry.source ?? "",
    source_id: entry.sourceId ? String(entry.sourceId) : null,

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

      if (cuentaPrefix && (!codigo || !String(codigo).startsWith(String(cuentaPrefix)))) continue;
      if (cuentaCodigo && String(codigo) !== String(cuentaCodigo)) continue;

      out.push({
        cuenta_codigo: codigo,
        debe: num(l.debit, 0),
        haber: num(l.credit, 0),

        asiento_fecha: asientoFecha,
        asiento_id: String(e._id),

        concepto: e.concept ?? "",
        source: e.source ?? "",
        source_id: e.sourceId ? String(e.sourceId) : null,

        memo: l.memo ?? "",
      });
    }
  }

  return out;
}

/**
 * ✅ GET /api/contabilidad/detalle-asientos?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Soporta también start/end.
 *
 * Filtros opcionales:
 * - cuenta_prefix=4     -> sólo cuentas que comiencen con "4"
 * - cuenta_codigo=4001  -> sólo una cuenta exacta
 *
 * Devuelve:
 * - resp.data.detalles
 * - resp.detalles
 * - resp.detalle_asientos   (alias legacy)
 */
router.get("/detalle-asientos", ensureAuth, async (req, res) => {
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
    console.error("GET /api/contabilidad/detalle-asientos error:", err);
    return res.status(500).json({ ok: false, message: "Error cargando detalle de asientos" });
  }
});

/**
 * ✅ GET /api/contabilidad/asientos?from=YYYY-MM-DD&to=YYYY-MM-DD
 * (Útil si después quieres listar pólizas/asientos completos)
 */
router.get("/asientos", ensureAuth, async (req, res) => {
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

    const entries = await JournalEntry.find({
      owner,
      date: { $gte: start, $lte: end },
    })
      .sort({ date: -1, createdAt: -1 })
      .lean();

    const asientos = entries.map(mapEntryForUI);

    return res.json({
      ok: true,
      data: { asientos },
      asientos, // compat legacy
    });
  } catch (err) {
    console.error("GET /api/contabilidad/asientos error:", err);
    return res.status(500).json({ ok: false, message: "Error cargando asientos" });
  }
});

module.exports = router;
