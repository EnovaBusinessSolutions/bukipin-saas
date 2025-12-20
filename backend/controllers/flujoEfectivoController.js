const {
  buildFlujoEfectivoOperativo,
  buildResumenFlujoCajaBancos,
  listAsientosForFlujoEfectivo,
} = require("../services/flujoEfectivoService");

function parseISODateOnly(dateStr) {
  if (!dateStr || typeof dateStr !== "string") return null;
  const ok = /^\d{4}-\d{2}-\d{2}$/.test(dateStr);
  if (!ok) return null;
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

exports.getFlujoOperativo = async (req, res) => {
  try {
    const start = parseISODateOnly(req.query.start);
    const end = parseISODateOnly(req.query.end);
    if (!start || !end) return res.status(400).json({ ok: false, error: "BAD_REQUEST", message: "start/end requeridos" });
    const endExclusive = new Date(end.getTime() + 24 * 60 * 60 * 1000);
    const data = await buildFlujoEfectivoOperativo({ ownerId: req.user._id, start, endExclusive });
    return res.json({ ok: true, data });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
};

exports.getResumenFlujo = async (req, res) => {
  try {
    const start = parseISODateOnly(req.query.start);
    const end = parseISODateOnly(req.query.end);
    if (!start || !end) return res.status(400).json({ ok: false, error: "BAD_REQUEST", message: "start/end requeridos" });
    const endExclusive = new Date(end.getTime() + 24 * 60 * 60 * 1000);
    const data = await buildResumenFlujoCajaBancos({ ownerId: req.user._id, start, endExclusive });
    return res.json({ ok: true, data });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
};

exports.getTransaccionesFlujo = async (req, res) => {
  try {
    const start = parseISODateOnly(req.query.start);
    const end = parseISODateOnly(req.query.end);

    if (!start || !end) {
      return res.status(400).json({
        ok: false,
        error: "BAD_REQUEST",
        message: "Parámetros requeridos: start=YYYY-MM-DD&end=YYYY-MM-DD",
      });
    }

    const endExclusive = new Date(end.getTime() + 24 * 60 * 60 * 1000);

    const asientos = await listAsientosForFlujoEfectivo({
      ownerId: req.user._id,
      start,
      endExclusive,
    });

    return res.json({ ok: true, data: { asientos } });
  } catch (err) {
    console.error("GET /api/flujo-efectivo/transacciones error:", err);
    return res.status(500).json({
      ok: false,
      error: "SERVER_ERROR",
      message: "Error listando transacciones.",
    });
  }
};
