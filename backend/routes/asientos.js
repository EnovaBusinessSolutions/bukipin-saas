// backend/routes/asientos.js
const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const JournalEntry = require("../models/JournalEntry");
const Account = require("../models/Account");
const ensureAuth = require("../middleware/ensureAuth");

// ✅ FIX: num() robusto (soporta "$1,200", " 1,200 ", etc.)
function num(v, def = 0) {
  if (v === null || typeof v === "undefined") return def;
  if (typeof v === "number") return Number.isFinite(v) ? v : def;

  const s = String(v).trim();
  if (!s) return def;

  // quita $ , espacios y símbolos comunes
  const cleaned = s.replace(/[$,\s]/g, "");
  const n = Number(cleaned);
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

// ✅ Determinar el campo de fecha real en JournalEntry
function pickDateField() {
  const p = JournalEntry?.schema?.paths || {};
  if (p.date) return "date";
  if (p.fecha) return "fecha";
  if (p.entryDate) return "entryDate";
  return "createdAt";
}

async function getAccountNameMap(owner, codes) {
  const unique = Array.from(new Set((codes || []).filter(Boolean).map((c) => String(c).trim())));
  if (!unique.length) return {};

  const rows = await Account.find({ owner, code: { $in: unique } }).select("code name nombre").lean();

  const map = {};
  for (const r of rows) {
    map[String(r.code)] = r.name ?? r.nombre ?? "";
  }
  return map;
}

/**
 * ✅ NUEVO: Mapa por CODE y por ID
 */
async function getAccountMaps(owner, rawLines) {
  const byCode = {};
  const byId = {};
  const lines = Array.isArray(rawLines) ? rawLines : [];
  const codes = [];
  const ids = [];

  for (const l of lines) {
    const code =
      l?.accountCodigo ??
      l?.accountCode ??
      l?.cuentaCodigo ??
      l?.cuenta_codigo ??
      l?.code ??
      l?.cuenta?.code ??
      l?.cuenta?.codigo ??
      l?.account?.code ??
      l?.account?.codigo ??
      null;

    if (code) codes.push(String(code).trim());

    const idCandidate =
      l?.accountId ??
      l?.account_id ??
      l?.accountID ??
      l?.cuentaId ??
      l?.cuenta_id ??
      l?.account?._id ??
      l?.cuenta?._id ??
      null;

    if (idCandidate) {
      const sid = String(idCandidate).trim();
      if (mongoose.Types.ObjectId.isValid(sid)) ids.push(new mongoose.Types.ObjectId(sid));
    }
  }

  const uniqueCodes = Array.from(new Set(codes.filter(Boolean)));
  const uniqueIds = Array.from(new Set(ids.map((x) => String(x)))).map((x) => new mongoose.Types.ObjectId(x));

  if (!uniqueCodes.length && !uniqueIds.length) {
    return { byCode, byId };
  }

  const or = [];
  if (uniqueCodes.length) or.push({ code: { $in: uniqueCodes } });
  if (uniqueIds.length) or.push({ _id: { $in: uniqueIds } });

  const rows = await Account.find({ owner, $or: or }).select("_id code name nombre").lean();

  for (const r of rows) {
    const code = String(r.code || "").trim();
    const name = r.name ?? r.nombre ?? "";
    if (code) byCode[code] = name;

    const id = String(r._id || "").trim();
    if (id) byId[id] = { code: code || null, name: name || null };
  }

  return { byCode, byId };
}

/**
 * ✅ UI mapper (lo mantengo igual que tú lo tienes)
 */
function mapEntryForUI(entry, accountMapsOrNameMap = {}) {
  const byCode = accountMapsOrNameMap?.byCode ? accountMapsOrNameMap.byCode : accountMapsOrNameMap;
  const byId = accountMapsOrNameMap?.byId ? accountMapsOrNameMap.byId : {};

  const rawLines = entry.lines || entry.detalle_asientos || entry.detalles_asiento || [];

  const detalle_asientos = (rawLines || []).map((l) => {
    let cuentaCodigo =
      l?.accountCodigo ??
      l?.accountCode ??
      l?.cuentaCodigo ??
      l?.cuenta_codigo ??
      l?.code ??
      l?.cuenta?.code ??
      l?.cuenta?.codigo ??
      l?.account?.code ??
      l?.account?.codigo ??
      "";

    let cuenta_codigo = cuentaCodigo ? String(cuentaCodigo).trim() : "";

    const idCandidate =
      l?.accountId ??
      l?.account_id ??
      l?.accountID ??
      l?.cuentaId ??
      l?.cuenta_id ??
      l?.account?._id ??
      l?.cuenta?._id ??
      null;

    const sid = idCandidate ? String(idCandidate).trim() : "";

    if (!cuenta_codigo && sid && byId[sid]?.code) {
      cuenta_codigo = String(byId[sid].code || "").trim();
    }

    const nameFromLine =
      l?.cuenta_nombre ??
      l?.cuentaNombre ??
      l?.accountName ??
      l?.account_name ??
      l?.cuenta?.name ??
      l?.cuenta?.nombre ??
      l?.account?.name ??
      l?.account?.nombre ??
      null;

    const cuenta_nombre =
      nameFromLine != null && String(nameFromLine).trim()
        ? String(nameFromLine).trim()
        : cuenta_codigo
          ? byCode[cuenta_codigo] || (sid && byId[sid]?.name ? byId[sid].name : null)
          : sid && byId[sid]?.name
            ? byId[sid].name
            : null;

    const side = String(l?.side || "").toLowerCase().trim();

    // ✅ FIX: monto y debit/credit robustos (strings con $)
    const monto =
      num(l?.monto, 0) ||
      num(l?.amount, 0) ||
      num(l?.importe, 0) ||
      num(l?.valor, 0) ||
      0;

    const debe = num(l?.debit, 0) || num(l?.debe, 0) || (side === "debit" ? monto : 0);
    const haber = num(l?.credit, 0) || num(l?.haber, 0) || (side === "credit" ? monto : 0);

    const memo = l?.memo ?? l?.descripcion ?? l?.concepto ?? l?.description ?? "";

    return {
      cuenta_codigo: cuenta_codigo || null,
      cuenta_nombre: cuenta_nombre || null,
      debe,
      haber,
      descripcion: memo || "",
      memo: memo || "",
    };
  });

  const detalles = detalle_asientos.map((d) => ({
    cuenta_codigo: d.cuenta_codigo,
    cuenta_nombre: d.cuenta_nombre,
    descripcion: d.descripcion || "",
    debe: d.debe,
    haber: d.haber,
  }));

  const concepto = entry.concept ?? entry.concepto ?? entry.descripcion ?? entry.memo ?? "";
  const numeroAsiento = entry.numeroAsiento ?? entry.numero_asiento ?? entry.numero ?? null;

  const fechaReal = entry.date ?? entry.fecha ?? entry.createdAt ?? entry.created_at ?? null;
  const source = entry.source ?? entry.fuente ?? "";

  const txId = entry.sourceId
    ? String(entry.sourceId)
    : entry.transaccionId
      ? String(entry.transaccionId)
      : entry.source_id
        ? String(entry.source_id)
        : entry.transaccion_id
          ? String(entry.transaccion_id)
          : null;

  return {
    id: String(entry._id),
    _id: entry._id,
    numeroAsiento,
    numero_asiento: numeroAsiento,
    asiento_fecha: fechaReal ? toYMD(fechaReal) : null,
    fecha: fechaReal,
    descripcion: concepto || "",
    concepto: concepto || "",
    source,
    transaccion_ingreso_id: txId,
    detalle_asientos,
    detalles,
    created_at: entry.createdAt ?? entry.created_at ?? null,
    updated_at: entry.updatedAt ?? entry.updated_at ?? null,
  };
}

/**
 * ✅ IMPORTANTE:
 * /depreciaciones DEBE ir ANTES de "/:id"
 */
router.get("/depreciaciones", ensureAuth, async (_req, res) => {
  return res.json({ ok: true, data: [], items: [] });
});

/**
 * ✅ Endpoint saldo por cuentas:
 * GET /api/asientos/detalle?cuentas=1001,1002&start=YYYY-MM-DD&end=YYYY-MM-DD
 *
 * Devuelve: [{ cuenta_codigo, cuenta_nombre, debe, haber, neto, saldo }]
 *
 * ✅ FIX E2E:
 * - soporta líneas con code o con accountId
 * - usa dateField real (date/fecha/createdAt)
 * - num() robusto (soporta strings con "$")
 * - agrega "saldo" (alias de neto) para hooks/UI
 */
router.get("/detalle", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;
    const dateField = pickDateField();

    const startRaw = req.query.start ?? req.query.from ?? null;
    const endRaw = req.query.end ?? req.query.to ?? req.query.until ?? null;

    if (startRaw && !parseYMD(startRaw)) {
      return res.status(400).json({
        ok: false,
        error: "VALIDATION",
        message: "Fecha 'start/from' inválida. Usa YYYY-MM-DD",
      });
    }
    if (endRaw && !parseYMD(endRaw)) {
      return res.status(400).json({
        ok: false,
        error: "VALIDATION",
        message: "Fecha 'end/to' inválida. Usa YYYY-MM-DD",
      });
    }

    const start = parseYMD(startRaw);
    const end = parseYMD(endRaw);

    // cuentas=1001,1002
    let cuentas = req.query.cuentas;
    if (Array.isArray(cuentas)) {
      cuentas = cuentas.flatMap((x) => String(x).split(","));
    } else {
      cuentas = String(cuentas || "").split(",");
    }

    let codes = (cuentas || []).map((c) => String(c || "").trim()).filter(Boolean);

    // Si no mandan cuentas, inferimos 50/51/52 (egresos)
    if (!codes.length) {
      const rows = await Account.find({
        owner,
        $or: [{ code: /^50/ }, { code: /^51/ }, { code: /^52/ }],
      })
        .select("code")
        .lean();

      codes = Array.from(new Set((rows || []).map((r) => String(r.code || "").trim()).filter(Boolean)));
    }

    if (!codes.length) {
      return res.json({ ok: true, data: [], items: [], byCode: {} });
    }

    // Construir filtro base
    const match = { owner };
    if (start || end) {
      match[dateField] = {};
      if (start) match[dateField].$gte = start;
      if (end) match[dateField].$lte = dayEnd(end);
    }

    // Traer SOLO lo necesario para calcular saldos
    const docs = await JournalEntry.find(match)
      .select(`${dateField} lines detalle_asientos detalles_asiento`)
      .lean();

    // juntar líneas para resolver mapas (por accountId también)
    const allLines = [];
    for (const e of docs) {
      const lines = e.lines || e.detalle_asientos || e.detalles_asiento || [];
      if (Array.isArray(lines) && lines.length) allLines.push(...lines);
    }

    const accountMaps = await getAccountMaps(owner, allLines);
    const nameMap = await getAccountNameMap(owner, codes);

    // init
    const byCode = {};
    for (const code of codes) {
      byCode[code] = {
        cuenta_codigo: code,
        cuenta_nombre: nameMap[code] || accountMaps.byCode[code] || null,
        debe: 0,
        haber: 0,
        neto: 0,
        saldo: 0, // ✅ alias útil para UI/hook
      };
    }

    // sumar
    for (const e of docs) {
      const lines = e.lines || e.detalle_asientos || e.detalles_asiento || [];
      if (!Array.isArray(lines) || !lines.length) continue;

      for (const l of lines) {
        // resolver cuenta code directo
        let code =
          l?.accountCodigo ??
          l?.accountCode ??
          l?.cuentaCodigo ??
          l?.cuenta_codigo ??
          l?.code ??
          l?.cuenta?.code ??
          l?.cuenta?.codigo ??
          l?.account?.code ??
          l?.account?.codigo ??
          null;

        code = code ? String(code).trim() : "";

        // si no hay code, resolver por id
        if (!code) {
          const idCandidate =
            l?.accountId ??
            l?.account_id ??
            l?.accountID ??
            l?.cuentaId ??
            l?.cuenta_id ??
            l?.account?._id ??
            l?.cuenta?._id ??
            null;

          const sid = idCandidate ? String(idCandidate).trim() : "";
          if (sid && accountMaps.byId[sid]?.code) {
            code = String(accountMaps.byId[sid].code || "").trim();
          }
        }

        if (!code || !byCode[code]) continue;

        const side = String(l?.side || "").toLowerCase().trim();

        const monto =
          num(l?.monto, 0) ||
          num(l?.amount, 0) ||
          num(l?.importe, 0) ||
          num(l?.valor, 0) ||
          0;

        const debe = num(l?.debit, 0) || num(l?.debe, 0) || (side === "debit" ? monto : 0);
        const haber = num(l?.credit, 0) || num(l?.haber, 0) || (side === "credit" ? monto : 0);

        byCode[code].debe += debe;
        byCode[code].haber += haber;
      }
    }

    const items = Object.values(byCode).map((r) => {
      const neto = num(r.debe, 0) - num(r.haber, 0);
      return {
        ...r,
        neto,
        saldo: neto, // ✅ alias
      };
    });

    return res.json({
      ok: true,
      data: items,
      items,
      byCode,
      meta: {
        dateField,
        start: start ? toYMD(start) : null,
        end: end ? toYMD(end) : null,
        codes_count: codes.length,
        docs_count: Array.isArray(docs) ? docs.length : 0,
      },
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
    const dateField = pickDateField();

    const start = parseYMD(req.query.start);
    const end = parseYMD(req.query.end);
    const includeDetalles = String(req.query.include_detalles || req.query.includeDetalles || "0").trim() === "1";
    const wrap = String(req.query.wrap || "").trim() === "1";

    const limitRaw = Number(req.query.limit ?? 200);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 500) : 200;

    const match = { owner };
    if (start || end) {
      match[dateField] = {};
      if (start) match[dateField].$gte = start;
      if (end) match[dateField].$lte = dayEnd(end);
    }

    const sortObj = {};
    sortObj[dateField] = -1;
    sortObj.createdAt = -1;

    const docs = await JournalEntry.find(match).sort(sortObj).limit(limit).lean();

    const allLines = [];
    for (const a of docs) {
      const lines = a.lines || a.detalle_asientos || a.detalles_asiento || [];
      if (Array.isArray(lines) && lines.length) allLines.push(...lines);
    }

    const accountMaps = await getAccountMaps(owner, allLines);

    const items = docs.map((a) => {
      const ui = mapEntryForUI(a, accountMaps);
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
        dateField,
        docs_count: Array.isArray(docs) ? docs.length : 0,
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
      return res.status(400).json({ ok: false, error: "VALIDATION", message: "numero_asiento es requerido" });
    }

    const asiento =
      (await JournalEntry.findOne({ owner, numeroAsiento: numero }).sort({ createdAt: -1 }).lean()) ||
      (await JournalEntry.findOne({ owner, numero: numero }).sort({ createdAt: -1 }).lean()) ||
      (await JournalEntry.findOne({ owner, numero_asiento: numero }).sort({ createdAt: -1 }).lean());

    if (!asiento) return res.status(404).json({ ok: false, error: "NOT_FOUND" });

    const rawLines = asiento.lines || asiento.detalle_asientos || asiento.detalles_asiento || [];
    const accountMaps = await getAccountMaps(owner, rawLines);
    const asientoUI = mapEntryForUI(asiento, accountMaps);

    return res.json({
      ok: true,
      data: asientoUI,
      asiento: asientoUI,
      item: asientoUI,
      ...asientoUI,
    });
  } catch (e) {
    console.error("GET /api/asientos/by-numero error:", e);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
}

router.get("/by-numero", ensureAuth, handleByNumero);

router.get("/by-ref/:numero", ensureAuth, async (req, res) => {
  req.query.numero_asiento = req.params.numero;
  return handleByNumero(req, res);
});

router.get("/by-ref", ensureAuth, async (req, res) => {
  return handleByNumero(req, res);
});

/**
 * ✅ CLAVE:
 * GET /api/asientos/by-transaccion?source=ingreso|egreso|...&id=XXXXXXXX
 */
router.get("/by-transaccion", ensureAuth, async (req, res) => {
  try {
    let { source, id } = req.query;
    source = String(source || "").trim();
    id = String(id || "").trim();

    if (!id) {
      return res.status(400).json({ ok: false, error: "MISSING_PARAMS", details: "id es requerido" });
    }

    const owner = req.user._id;
    const sourceIdCandidates = [id];

    if (mongoose.Types.ObjectId.isValid(id)) {
      sourceIdCandidates.push(new mongoose.Types.ObjectId(id));
    }

    const sourceAliases = new Set();
    if (source) {
      sourceAliases.add(source.toLowerCase());
      if (source.toLowerCase() === "ingresos") sourceAliases.add("ingreso");
      if (source.toLowerCase() === "ingreso") sourceAliases.add("ingresos");
      if (source.toLowerCase() === "egresos") sourceAliases.add("egreso");
      if (source.toLowerCase() === "egreso") sourceAliases.add("egresos");
    }

    const findBy = async (q) => JournalEntry.findOne(q).sort({ createdAt: -1 }).lean();

    let asiento = null;

    if (sourceAliases.size) {
      const srcList = Array.from(sourceAliases);
      asiento =
        (await findBy({ owner, source: { $in: srcList }, sourceId: { $in: sourceIdCandidates } })) ||
        (await findBy({ owner, source: { $in: srcList }, transaccionId: { $in: sourceIdCandidates } })) ||
        (await findBy({ owner, source: { $in: srcList }, source_id: { $in: sourceIdCandidates } })) ||
        (await findBy({ owner, "references.source": { $in: srcList }, "references.id": id }));
    }

    if (!asiento) {
      asiento =
        (await findBy({ owner, sourceId: { $in: sourceIdCandidates } })) ||
        (await findBy({ owner, transaccionId: { $in: sourceIdCandidates } })) ||
        (await findBy({ owner, source_id: { $in: sourceIdCandidates } })) ||
        (await findBy({ owner, "references.id": id }));
    }

    if (!asiento) return res.status(404).json({ ok: false, error: "NOT_FOUND" });

    const rawLines = asiento.lines || asiento.detalle_asientos || asiento.detalles_asiento || [];
    const accountMaps = await getAccountMaps(owner, rawLines);
    const asientoUI = mapEntryForUI(asiento, accountMaps);

    const numeroAsiento = asientoUI.numeroAsiento || asientoUI.numero_asiento || String(asiento._id);

    return res.json({
      ok: true,
      data: asientoUI,
      asiento: asientoUI,
      item: asientoUI,
      numeroAsiento,
      asientos: [asientoUI],
      ...asientoUI,
    });
  } catch (e) {
    console.error("GET /api/asientos/by-transaccion error:", e);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

/**
 * GET /api/asientos/:id (siempre al final)
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

    const rawLines = asiento.lines || asiento.detalle_asientos || asiento.detalles_asiento || [];
    const accountMaps = await getAccountMaps(owner, rawLines);
    const asientoUI = mapEntryForUI(asiento, accountMaps);

    return res.json({
      ok: true,
      data: asientoUI,
      asiento: asientoUI,
      item: asientoUI,
      ...asientoUI,
    });
  } catch (e) {
    console.error("GET /api/asientos/:id error:", e);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

module.exports = router;
