// backend/routes/asientos.js
const express = require("express");
const router = express.Router();

const mongoose = require("mongoose");
const JournalEntry = require("../models/JournalEntry");
const Account = require("../models/Account");
const ensureAuth = require("../middleware/ensureAuth");

// -------------------- helpers --------------------
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

/**
 * ✅ Evita bugs de timezone con YYYY-MM-DD
 * - Si viene YYYY-MM-DD => interpretamos local "T00:00:00"
 * - Si viene ISO => Date(ISO)
 */
function isoDateOrNull(v) {
  const s = String(v ?? "").trim();
  if (!s) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(`${s}T00:00:00`);
    if (Number.isNaN(d.getTime())) return null;
    return d;
  }

  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

async function getAccountNameMap(owner, codes) {
  const unique = Array.from(new Set((codes || []).filter(Boolean).map((c) => String(c).trim())));
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
 * ✅ Shape EXACTO que tus modales esperan:
 * currentAsientos.descripcion
 * currentAsientos.detalles[] = { cuenta_codigo, cuenta_nombre, descripcion, debe, haber }
 */
function mapEntryForUI(entry, accountNameMap = {}) {
  const rawLines = entry.lines || entry.detalle_asientos || [];

  const detalle_asientos = (rawLines || []).map((l) => {
    const cuentaCodigo = l.accountCodigo ?? l.accountCode ?? l.cuenta_codigo ?? l.code ?? "";
    const cuenta_codigo = cuentaCodigo ? String(cuentaCodigo).trim() : "";

    return {
      cuenta_codigo: cuenta_codigo || null,
      cuenta_nombre: cuenta_codigo ? (accountNameMap[cuenta_codigo] || null) : null,
      debe: num(l.debit ?? l.debe, 0),
      haber: num(l.credit ?? l.haber, 0),
      memo: l.memo ?? l.descripcion ?? "",
    };
  });

  const detalles = detalle_asientos.map((d) => ({
    cuenta_codigo: d.cuenta_codigo,
    cuenta_nombre: d.cuenta_nombre,
    descripcion: d.memo || "",
    debe: d.debe,
    haber: d.haber,
  }));

  const concepto = entry.concept ?? entry.concepto ?? entry.descripcion ?? "";
  const numeroAsiento = entry.numeroAsiento ?? entry.numero_asiento ?? null;

  return {
    id: String(entry._id),
    _id: entry._id,

    numeroAsiento,
    numero_asiento: numeroAsiento,

    asiento_fecha: toYMD(entry.date),
    fecha: entry.date,

    // ✅ la UI usa currentAsientos.descripcion
    descripcion: concepto,
    concepto,

    source: entry.source ?? "",
    transaccion_ingreso_id: entry.sourceId ? String(entry.sourceId) : null,

    detalle_asientos,
    detalles,

    created_at: entry.createdAt,
    updated_at: entry.updatedAt,
  };
}

// -------------------- ROUTES --------------------

/**
 * ✅ GET /api/asientos/detalle?cuentas=1001,1002
 * Devuelve saldos por cuenta (para useSaldosDisponibles).
 *
 * Respuesta:
 * [
 *   { cuenta_codigo:"1001", cuentaCodigo:"1001", debe, haber, totalDebe, totalHaber, saldo }
 * ]
 */
router.get("/detalle", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;

    const cuentasRaw = String(req.query.cuentas ?? "").trim();
    if (!cuentasRaw) {
      return res.status(400).json({
        ok: false,
        error: "MISSING_PARAMS",
        message: "cuentas es requerido. Ej: /api/asientos/detalle?cuentas=1001,1002",
      });
    }

    const cuentas = cuentasRaw
      .split(",")
      .map((s) => String(s).trim())
      .filter(Boolean);

    if (!cuentas.length) {
      return res.json([]);
    }

    // Agregamos por accountCodigo dentro de lines
    const rows = await JournalEntry.aggregate([
      { $match: { owner: new mongoose.Types.ObjectId(owner) } },
      { $unwind: "$lines" },
      { $match: { "lines.accountCodigo": { $in: cuentas } } },
      {
        $group: {
          _id: "$lines.accountCodigo",
          totalDebe: { $sum: "$lines.debit" },
          totalHaber: { $sum: "$lines.credit" },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    // Asegura que regresamos todas las cuentas pedidas (aunque no haya movimientos)
    const map = new Map(rows.map((r) => [String(r._id), r]));
    const out = cuentas.map((codigo) => {
      const r = map.get(codigo) || { totalDebe: 0, totalHaber: 0 };
      const debe = num(r.totalDebe, 0);
      const haber = num(r.totalHaber, 0);
      const saldo = debe - haber;

      return {
        cuenta_codigo: codigo,
        cuentaCodigo: codigo,
        debe,
        haber,
        totalDebe: debe,
        totalHaber: haber,
        saldo,
      };
    });

    return res.json(out);
  } catch (e) {
    console.error("GET /api/asientos/detalle error:", e);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

/**
 * ✅ GET /api/asientos?start=YYYY-MM-DD&end=YYYY-MM-DD&source=egreso&include_detalles=1&limit=200
 * Esto evita el 404 que ves en consola y te sirve para listados.
 *
 * - include_detalles=1 => devuelve asientos ya mapeados con detalles[]
 * - include_detalles=0 => devuelve rows lean “raw”
 */
router.get("/", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;

    const start = isoDateOrNull(req.query.start);
    const end = isoDateOrNull(req.query.end);
    const source = String(req.query.source ?? "").trim();
    const includeDetalles = String(req.query.include_detalles ?? "").trim() === "1";
    const limit = Math.min(500, Math.max(1, num(req.query.limit, 200)));
    const wrap = String(req.query.wrap ?? "").trim() === "1";

    const filter = { owner };

    if (source) filter.source = source;

    if (start || end) {
      filter.date = {};
      if (start) filter.date.$gte = start;
      if (end) {
        const e = new Date(end);
        e.setHours(23, 59, 59, 999);
        filter.date.$lte = e;
      }
    }

    const docs = await JournalEntry.find(filter)
      .sort({ date: -1, createdAt: -1 })
      .limit(limit)
      .lean();

    if (!includeDetalles) {
      if (!wrap) return res.json(docs);
      return res.json({ ok: true, data: docs, items: docs });
    }

    // enriquecer nombres
    const allCodes = [];
    for (const a of docs) {
      for (const l of a.lines || []) {
        if (l?.accountCodigo) allCodes.push(String(l.accountCodigo));
      }
    }
    const accountNameMap = await getAccountNameMap(owner, allCodes);

    const items = docs.map((a) => mapEntryForUI(a, accountNameMap));

    if (!wrap) return res.json(items);
    return res.json({ ok: true, data: items, items });
  } catch (e) {
    console.error("GET /api/asientos error:", e);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

// GET /api/asientos/:id
router.get("/:id", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;
    const id = String(req.params.id || "").trim();

    const doc = await JournalEntry.findOne({ owner, _id: id }).lean();
    if (!doc) return res.status(404).json({ ok: false, error: "NOT_FOUND" });

    const codes = (doc.lines || []).map((l) => l.accountCodigo).filter(Boolean).map(String);
    const accountNameMap = await getAccountNameMap(owner, codes);

    const item = mapEntryForUI(doc, accountNameMap);
    return res.json({ ok: true, data: item, item, ...item });
  } catch (e) {
    console.error("GET /api/asientos/:id error:", e);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

// GET /api/asientos/by-transaccion?source=ingreso&id=XXXXXXXX
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
      })
        .sort({ createdAt: -1 })
        .lean()) ||
      (await JournalEntry.findOne({
        owner,
        source: { $in: Array.from(sourceAliases) },
        transaccionId: id,
      })
        .sort({ createdAt: -1 })
        .lean()) ||
      (await JournalEntry.findOne({
        owner,
        source: { $in: Array.from(sourceAliases) },
        transaccion_id: id,
      })
        .sort({ createdAt: -1 })
        .lean()) ||
      (await JournalEntry.findOne({
        owner,
        "references.source": { $in: Array.from(sourceAliases) },
        "references.id": id,
      })
        .sort({ createdAt: -1 })
        .lean());

    if (!asiento) return res.status(404).json({ ok: false, error: "NOT_FOUND" });

    const codes = (asiento.lines || [])
      .map((l) => l.accountCodigo ?? l.accountCode ?? l.cuenta_codigo ?? null)
      .filter(Boolean)
      .map(String);

    const accountNameMap = await getAccountNameMap(owner, codes);

    const asientoUI = mapEntryForUI(asiento, accountNameMap);
    const numeroAsiento = asientoUI.numeroAsiento || String(asiento._id);

    return res.json({
      ok: true,
      data: {
        asiento: asientoUI,
        numeroAsiento,
        raw: asiento,
      },
      asiento: asientoUI,
      numeroAsiento,
      asientos: [asientoUI],
    });
  } catch (e) {
    console.error("GET /api/asientos/by-transaccion error:", e);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

module.exports = router;
