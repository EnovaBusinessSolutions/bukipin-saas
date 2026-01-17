// backend/routes/asientos.js
const express = require("express");
const router = express.Router();

const mongoose = require("mongoose");
const JournalEntry = require("../models/JournalEntry");
const Account = require("../models/Account");
const ensureAuth = require("../middleware/ensureAuth");

function num(v, def = 0) {
  const n = Number(String(v ?? "").replace(/,/g, ""));
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

function parseYMD(s) {
  const str = String(s || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return null;
  const d = new Date(`${str}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function dayEnd(d) {
  const e = new Date(d);
  e.setHours(23, 59, 59, 999);
  return e;
}

async function getAccountNameMap(owner, codes) {
  const unique = Array.from(
    new Set((codes || []).filter(Boolean).map((c) => String(c).trim()))
  );
  if (!unique.length) return {};

  const rows = await Account.find({ owner, code: { $in: unique } })
    .select("code name nombre")
    .lean();

  const map = {};
  for (const r of rows) {
    map[String(r.code)] = r.name ?? r.nombre ?? "";
  }
  return map;
}

/**
 * ✅ Shape EXACTO que tus UIs esperan:
 * asiento.descripcion
 * asiento.detalles[] = { cuenta_codigo, cuenta_nombre, descripcion, debe, haber }
 *
 * Soporta líneas tipo:
 * - { accountCodigo, debit, credit, memo }            (JournalEntry actual)
 * - { cuentaCodigo, debe, haber, descripcion }        (legacy)
 * - { side:"debit|credit", monto, cuentaCodigo }      (legacy)
 */
function mapEntryForUI(entry, accountNameMap = {}) {
  const rawLines = entry.lines || entry.detalle_asientos || entry.detalles_asiento || [];

  const detalle_asientos = (rawLines || []).map((l) => {
    const cuentaCodigo =
      l.accountCodigo ??
      l.accountCode ??
      l.cuentaCodigo ??
      l.cuenta_codigo ??
      l.code ??
      "";

    const cuenta_codigo = cuentaCodigo ? String(cuentaCodigo).trim() : "";

    const side = String(l.side || "").toLowerCase().trim();
    const monto = num(l.monto, 0);

    const debe = num(
      l.debit ?? l.debe ?? (side === "debit" ? monto : 0),
      0
    );
    const haber = num(
      l.credit ?? l.haber ?? (side === "credit" ? monto : 0),
      0
    );

    const memo = l.memo ?? l.descripcion ?? l.concepto ?? "";

    return {
      cuenta_codigo: cuenta_codigo || null,
      cuenta_nombre: cuenta_codigo ? accountNameMap[cuenta_codigo] || null : null,
      debe,
      haber,
      memo: memo || "",
    };
  });

  const detalles = detalle_asientos.map((d) => ({
    cuenta_codigo: d.cuenta_codigo,
    cuenta_nombre: d.cuenta_nombre,
    descripcion: d.memo || "",
    debe: d.debe,
    haber: d.haber,
  }));

  const concepto =
    entry.concept ??
    entry.concepto ??
    entry.descripcion ??
    entry.memo ??
    "";

  const numeroAsiento =
    entry.numeroAsiento ??
    entry.numero_asiento ??
    entry.numero ??
    null;

  const fechaReal =
    entry.date ?? entry.fecha ?? entry.createdAt ?? entry.created_at ?? null;

  return {
    id: String(entry._id),
    _id: entry._id,

    numeroAsiento,
    numero_asiento: numeroAsiento,

    asiento_fecha: fechaReal ? toYMD(fechaReal) : null,
    fecha: fechaReal,

    descripcion: concepto || "",
    concepto: concepto || "",

    source: entry.source ?? entry.fuente ?? "",
    transaccion_ingreso_id: entry.sourceId
      ? String(entry.sourceId)
      : entry.transaccionId
      ? String(entry.transaccionId)
      : entry.source_id
      ? String(entry.source_id)
      : entry.transaccion_id
      ? String(entry.transaccion_id)
      : null,

    detalle_asientos,
    detalles,

    created_at: entry.createdAt ?? entry.created_at ?? null,
    updated_at: entry.updatedAt ?? entry.updated_at ?? null,
  };
}

/**
 * ✅ IMPORTANTE:
 * /depreciaciones DEBE ir ANTES de "/:id"
 * porque si no, Express interpreta "depreciaciones" como un id.
 */
router.get("/depreciaciones", ensureAuth, async (_req, res) => {
  return res.json({ ok: true, data: [], items: [] });
});

/**
 * ✅ Endpoint que tu UI/hook usan:
 * GET /api/asientos/detalle?cuentas=1001,1002&start=YYYY-MM-DD&end=YYYY-MM-DD
 *
 * Devuelve: [{ cuenta_codigo, cuenta_nombre, debe, haber, neto }]
 */
router.get("/detalle", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;

    let cuentas = req.query.cuentas;

    if (Array.isArray(cuentas)) {
      cuentas = cuentas.flatMap((x) => String(x).split(","));
    } else {
      cuentas = String(cuentas || "").split(",");
    }

    const codes = cuentas.map((c) => String(c || "").trim()).filter(Boolean);

    if (!codes.length) {
      return res.status(400).json({
        ok: false,
        error: "VALIDATION",
        message: "Parámetro 'cuentas' es requerido. Ej: ?cuentas=1001,1002",
      });
    }

    const start = parseYMD(req.query.start);
    const end = parseYMD(req.query.end);

    const match = { owner };
    if (start || end) {
      match.date = {};
      if (start) match.date.$gte = start;
      if (end) match.date.$lte = dayEnd(end);
    }

    const agg = await JournalEntry.aggregate([
      { $match: match },
      { $unwind: "$lines" },
      {
        $project: {
          code: {
            $ifNull: [
              "$lines.accountCodigo",
              {
                $ifNull: [
                  "$lines.cuentaCodigo",
                  { $ifNull: ["$lines.cuenta_codigo", "$lines.code"] },
                ],
              },
            ],
          },
          side: { $toLower: { $ifNull: ["$lines.side", ""] } },
          debitRaw: { $ifNull: ["$lines.debit", { $ifNull: ["$lines.debe", null] }] },
          creditRaw: { $ifNull: ["$lines.credit", { $ifNull: ["$lines.haber", null] }] },
          montoRaw: { $ifNull: ["$lines.monto", 0] },
        },
      },
      { $match: { code: { $in: codes } } },
      {
        $project: {
          code: 1,
          debe: {
            $cond: [
              { $ne: ["$debitRaw", null] },
              { $convert: { input: "$debitRaw", to: "double", onError: 0, onNull: 0 } },
              {
                $cond: [
                  { $eq: ["$side", "debit"] },
                  { $convert: { input: "$montoRaw", to: "double", onError: 0, onNull: 0 } },
                  0,
                ],
              },
            ],
          },
          haber: {
            $cond: [
              { $ne: ["$creditRaw", null] },
              { $convert: { input: "$creditRaw", to: "double", onError: 0, onNull: 0 } },
              {
                $cond: [
                  { $eq: ["$side", "credit"] },
                  { $convert: { input: "$montoRaw", to: "double", onError: 0, onNull: 0 } },
                  0,
                ],
              },
            ],
          },
        },
      },
      {
        $group: {
          _id: "$code",
          debe: { $sum: "$debe" },
          haber: { $sum: "$haber" },
        },
      },
    ]);

    const accountNameMap = await getAccountNameMap(owner, codes);

    const byCode = {};
    for (const code of codes) {
      byCode[code] = {
        cuenta_codigo: code,
        cuenta_nombre: accountNameMap[code] || null,
        debe: 0,
        haber: 0,
        neto: 0,
      };
    }

    for (const row of agg) {
      const code = String(row._id || "").trim();
      if (!code) continue;

      const debe = num(row.debe, 0);
      const haber = num(row.haber, 0);

      byCode[code] = {
        cuenta_codigo: code,
        cuenta_nombre: accountNameMap[code] || null,
        debe,
        haber,
        neto: debe - haber,
      };
    }

    const items = Object.values(byCode);

    return res.json({
      ok: true,
      data: items,
      items,
      byCode,
    });
  } catch (e) {
    console.error("GET /api/asientos/detalle error:", e);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

/**
 * ✅ LO QUE TU UI ESTÁ PIDIENDO:
 * GET /api/asientos?start=YYYY-MM-DD&end=YYYY-MM-DD&include_detalles=1&limit=200
 */
router.get("/", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;

    const start = parseYMD(req.query.start);
    const end = parseYMD(req.query.end);

    const includeDetalles =
      String(req.query.include_detalles || req.query.includeDetalles || "0").trim() === "1";

    const wrap = String(req.query.wrap || "").trim() === "1";

    const limitRaw = Number(req.query.limit ?? 200);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 500) : 200;

    const match = { owner };
    if (start || end) {
      match.date = {};
      if (start) match.date.$gte = start;
      if (end) match.date.$lte = dayEnd(end);
    }

    const docs = await JournalEntry.find(match)
      .sort({ date: -1, createdAt: -1 })
      .limit(limit)
      .lean();

    const allCodes = [];
    for (const a of docs) {
      const lines = a.lines || [];
      for (const l of lines) {
        const code =
          l.accountCodigo ??
          l.accountCode ??
          l.cuentaCodigo ??
          l.cuenta_codigo ??
          l.code ??
          null;
        if (code) allCodes.push(String(code));
      }
    }

    const accountNameMap = await getAccountNameMap(owner, allCodes);

    const items = docs.map((a) => {
      const ui = mapEntryForUI(a, accountNameMap);
      if (!includeDetalles) {
        delete ui.detalle_asientos;
        delete ui.detalles;
      }
      return ui;
    });

    if (!wrap) return res.json(items);

    return res.json({
      ok: true,
      data: items,
      items,
      meta: {
        limit,
        include_detalles: includeDetalles ? 1 : 0,
        start: start ? toYMD(start) : null,
        end: end ? toYMD(end) : null,
      },
    });
  } catch (e) {
    console.error("GET /api/asientos error:", e);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

// -------- helpers reusables para endpoints legacy ----------
async function handleByNumero(req, res) {
  try {
    const owner = req.user._id;
    const numero = String(req.query.numero_asiento ?? req.query.numeroAsiento ?? req.query.numero ?? "").trim();

    if (!numero) {
      return res.status(400).json({
        ok: false,
        error: "VALIDATION",
        message: "numero_asiento es requerido",
      });
    }

    const asiento =
      (await JournalEntry.findOne({ owner, numeroAsiento: numero }).sort({ createdAt: -1 }).lean()) ||
      (await JournalEntry.findOne({ owner, numero: numero }).sort({ createdAt: -1 }).lean()) ||
      (await JournalEntry.findOne({ owner, numero_asiento: numero }).sort({ createdAt: -1 }).lean());

    if (!asiento) return res.status(404).json({ ok: false, error: "NOT_FOUND" });

    const codes = (asiento.lines || [])
      .map((l) => l.accountCodigo ?? l.cuentaCodigo ?? l.cuenta_codigo ?? l.code ?? null)
      .filter(Boolean)
      .map(String);

    const accountNameMap = await getAccountNameMap(owner, codes);
    const asientoUI = mapEntryForUI(asiento, accountNameMap);

    return res.json({ ok: true, data: asientoUI, asiento: asientoUI });
  } catch (e) {
    console.error("GET /api/asientos/by-numero error:", e);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
}

/**
 * ✅ Compat: buscar por número de asiento
 * GET /api/asientos/by-numero?numero_asiento=EGR-...
 */
router.get("/by-numero", ensureAuth, handleByNumero);

/**
 * ✅ Compat LEGACY:
 * GET /api/asientos/by-ref/:numero
 * GET /api/asientos/by-ref?numero_asiento=...
 */
router.get("/by-ref/:numero", ensureAuth, async (req, res) => {
  req.query.numero_asiento = req.params.numero;
  return handleByNumero(req, res);
});

router.get("/by-ref", ensureAuth, async (req, res) => {
  return handleByNumero(req, res);
});

/**
 * GET /api/asientos/by-transaccion?source=ingreso|egreso|...&id=XXXXXXXX
 */
router.get("/by-transaccion", ensureAuth, async (req, res) => {
  try {
    let { source, id } = req.query;

    source = String(source || "").trim();
    id = String(id || "").trim();

    if (!source || !id) {
      return res.status(400).json({
        ok: false,
        error: "MISSING_PARAMS",
        details: "source e id son requeridos",
      });
    }

    const sourceAliases = new Set([source.toLowerCase()]);
    if (source.toLowerCase() === "ingresos") sourceAliases.add("ingreso");
    if (source.toLowerCase() === "ingreso") sourceAliases.add("ingresos");
    if (source.toLowerCase() === "egresos") sourceAliases.add("egreso");
    if (source.toLowerCase() === "egreso") sourceAliases.add("egresos");

    const owner = req.user._id;

    const sourceIdCandidates = [id];
    if (mongoose.Types.ObjectId.isValid(id)) {
      sourceIdCandidates.push(new mongoose.Types.ObjectId(id));
    }

    const asiento =
      (await JournalEntry.findOne({
        owner,
        source: { $in: Array.from(sourceAliases) },
        sourceId: { $in: sourceIdCandidates },
      }).sort({ createdAt: -1 }).lean()) ||
      (await JournalEntry.findOne({
        owner,
        source: { $in: Array.from(sourceAliases) },
        transaccionId: { $in: sourceIdCandidates },
      }).sort({ createdAt: -1 }).lean()) ||
      (await JournalEntry.findOne({
        owner,
        source: { $in: Array.from(sourceAliases) },
        source_id: { $in: sourceIdCandidates },
      }).sort({ createdAt: -1 }).lean()) ||
      (await JournalEntry.findOne({
        owner,
        "references.source": { $in: Array.from(sourceAliases) },
        "references.id": id,
      }).sort({ createdAt: -1 }).lean());

    if (!asiento) return res.status(404).json({ ok: false, error: "NOT_FOUND" });

    const codes = (asiento.lines || [])
      .map((l) => l.accountCodigo ?? l.cuentaCodigo ?? l.cuenta_codigo ?? l.code ?? null)
      .filter(Boolean)
      .map(String);

    const accountNameMap = await getAccountNameMap(owner, codes);

    const asientoUI = mapEntryForUI(asiento, accountNameMap);
    const numeroAsiento = asientoUI.numeroAsiento || String(asiento._id);

    return res.json({
      ok: true,
      data: { asiento: asientoUI, numeroAsiento, raw: asiento },
      asiento: asientoUI,
      numeroAsiento,
      asientos: [asientoUI],
    });
  } catch (e) {
    console.error("GET /api/asientos/by-transaccion error:", e);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

/**
 * GET /api/asientos/:id  (detalle por id)
 * ⚠️ SIEMPRE al final, para no pisar rutas como /depreciaciones
 */
router.get("/:id", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;
    const id = String(req.params.id || "").trim();

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ ok: false, error: "VALIDATION", message: "id inválido" });
    }

    const asiento = await JournalEntry.findOne({ _id: id, owner }).lean();
    if (!asiento) return res.status(404).json({ ok: false, error: "NOT_FOUND" });

    const codes = (asiento.lines || [])
      .map((l) => l.accountCodigo ?? l.cuentaCodigo ?? l.cuenta_codigo ?? l.code ?? null)
      .filter(Boolean)
      .map(String);

    const accountNameMap = await getAccountNameMap(owner, codes);
    const asientoUI = mapEntryForUI(asiento, accountNameMap);

    return res.json({ ok: true, data: asientoUI, asiento: asientoUI });
  } catch (e) {
    console.error("GET /api/asientos/:id error:", e);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

module.exports = router;
