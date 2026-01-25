// backend/routes/asientos.js
const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const JournalEntry = require("../models/JournalEntry");
const Account = require("../models/Account");
const ensureAuth = require("../middleware/ensureAuth");

// ✅ Opcional: Counter (para folio tipo 2026-0010)
let Counter = null;
try {
  Counter = require("../models/Counter");
} catch (_) {}

// ✅ Opcional: modelo de movimientos de inventario (para resolver asiento real desde Inventario)
let InventoryMovement = null;
try {
  InventoryMovement = require("../models/InventoryMovement");
} catch (_) {
  try {
    InventoryMovement = require("../models/InventoryTransaction");
  } catch (_) {
    try {
      InventoryMovement = require("../models/InventarioMovimiento");
    } catch (_) {
      try {
        InventoryMovement = require("../models/StockMovement");
      } catch (_) {
        try {
          InventoryMovement = require("../models/MovimientoInventario");
        } catch (_) {}
      }
    }
  }
}

// ✅ FIX: num() robusto (soporta "$1,200", " 1,200 ", etc.)
function num(v, def = 0) {
  if (v === null || typeof v === "undefined") return def;
  if (typeof v === "number") return Number.isFinite(v) ? v : def;

  const s = String(v).trim();
  if (!s) return def;

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

function isObjectId(v) {
  return !!v && mongoose.Types.ObjectId.isValid(String(v));
}

function pickEntryDate(entry) {
  return entry?.date ?? entry?.fecha ?? entry?.entryDate ?? entry?.createdAt ?? entry?.created_at ?? null;
}

function pickEntryNumero(entry) {
  return entry?.numeroAsiento ?? entry?.numero_asiento ?? entry?.numero ?? entry?.folio ?? null;
}

function pickEntryConcept(entry) {
  return entry?.concept ?? entry?.concepto ?? entry?.descripcion ?? entry?.memo ?? "";
}

/**
 * ✅ NUEVO: detecta si un path del schema es ObjectId
 * (para evitar CastError metiendo strings en $in)
 */
function pathIsObjectId(model, path) {
  try {
    const p = model?.schema?.paths?.[path];
    if (!p) return false;
    const inst = String(p.instance || "").toLowerCase();
    if (inst === "objectid" || inst === "objectid") return true;
    // fallback por si instance viene raro
    const optType = p.options?.type;
    return optType === mongoose.Schema.Types.ObjectId;
  } catch {
    return false;
  }
}

/**
 * ✅ NUEVO: normaliza ids cogs_*
 * cogs_<journalEntryId> => <journalEntryId>
 */
function normalizeCogsId(raw) {
  const s = String(raw || "").trim();
  if (s.toLowerCase().startsWith("cogs_")) return s.slice(5).trim();
  return s;
}

/**
 * ✅ Genera folio tipo YYYY-0001 si falta numeroAsiento (y lo persiste)
 * Solo aplica si existe Counter.
 */
async function ensureNumeroAsiento(owner, entry) {
  try {
    if (!entry) return entry;

    const existing = pickEntryNumero(entry);
    if (existing) return entry;

    if (!Counter) return entry;

    const dateObj = pickEntryDate(entry) ? new Date(pickEntryDate(entry)) : new Date();
    const year = Number.isFinite(dateObj.getTime()) ? dateObj.getFullYear() : new Date().getFullYear();
    const key = `journal-${year}`;

    const doc = await Counter.findOneAndUpdate(
      { owner, key },
      { $inc: { seq: 1 } },
      { new: true, upsert: true }
    ).lean();

    const seq = doc?.seq || 1;
    const numeroAsiento = `${year}-${String(seq).padStart(4, "0")}`;

    // Persistimos para que ya no vuelva a mostrarse el ObjectId en UI
    await JournalEntry.updateOne(
      { owner, _id: entry._id },
      { $set: { numeroAsiento, numero_asiento: numeroAsiento, numero: numeroAsiento } }
    ).catch(() => {});

    return { ...entry, numeroAsiento, numero_asiento: numeroAsiento, numero: numeroAsiento };
  } catch {
    return entry;
  }
}

function ensureConceptFallback(entry) {
  const c = String(pickEntryConcept(entry) || "").trim();
  if (c) return entry;

  const src = String(entry?.source ?? entry?.fuente ?? "asiento").trim();
  const d = pickEntryDate(entry);
  const ymd = d ? toYMD(d) : null;

  const fallback = ymd ? `Asiento: ${src} (${ymd})` : `Asiento: ${src}`;
  return { ...entry, concept: fallback, concepto: fallback, descripcion: fallback, memo: fallback };
}

async function getAccountNameMap(owner, codes) {
  const unique = Array.from(new Set((codes || []).filter(Boolean).map((c) => String(c).trim())));
  if (!unique.length) return {};

  // ✅ soportar code o codigo
  const rows = await Account.find({
    owner,
    $or: [{ code: { $in: unique } }, { codigo: { $in: unique } }],
  })
    .select("code codigo name nombre")
    .lean();

  const map = {};
  for (const r of rows) {
    const code = String(r.code ?? r.codigo ?? "").trim();
    if (!code) continue;
    map[code] = r.name ?? r.nombre ?? "";
  }
  return map;
}

/**
 * ✅ NUEVO: Mapa por CODE y por ID (soporta code/codigo)
 * ✅ FIX: $or plano (evita $or anidado dentro de $or)
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
  const uniqueIds = Array.from(new Set(ids.map((x) => String(x)))).map(
    (x) => new mongoose.Types.ObjectId(x)
  );

  if (!uniqueCodes.length && !uniqueIds.length) {
    return { byCode, byId };
  }

  const or = [];
  if (uniqueCodes.length) {
    or.push({ code: { $in: uniqueCodes } });
    or.push({ codigo: { $in: uniqueCodes } });
  }
  if (uniqueIds.length) {
    or.push({ _id: { $in: uniqueIds } });
  }

  const rows = await Account.find({ owner, $or: or })
    .select("_id code codigo name nombre")
    .lean();

  for (const r of rows) {
    const code = String(r.code ?? r.codigo ?? "").trim();
    const name = r.name ?? r.nombre ?? "";
    if (code) byCode[code] = name;

    const id = String(r._id || "").trim();
    if (id) byId[id] = { code: code || null, name: name || null };
  }

  return { byCode, byId };
}

/**
 * ✅ UI mapper (igual al tuyo, solo con mapas más robustos)
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

  const concepto = pickEntryConcept(entry);
  const numeroAsiento = pickEntryNumero(entry);

  const fechaReal = pickEntryDate(entry);
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

    let cuentas = req.query.cuentas;
    if (Array.isArray(cuentas)) {
      cuentas = cuentas.flatMap((x) => String(x).split(","));
    } else {
      cuentas = String(cuentas || "").split(",");
    }

    let codes = (cuentas || []).map((c) => String(c || "").trim()).filter(Boolean);

    if (!codes.length) {
      const rows = await Account.find({
        owner,
        $or: [{ code: /^50/ }, { code: /^51/ }, { code: /^52/ }, { codigo: /^50/ }, { codigo: /^51/ }, { codigo: /^52/ }],
      })
        .select("code codigo")
        .lean();

      codes = Array.from(
        new Set((rows || [])
          .map((r) => String(r.code ?? r.codigo ?? "").trim())
          .filter(Boolean))
      );
    }

    if (!codes.length) {
      return res.json({ ok: true, data: [], items: [], byCode: {} });
    }

    const match = { owner };
    if (start || end) {
      match[dateField] = {};
      if (start) match[dateField].$gte = start;
      if (end) match[dateField].$lte = dayEnd(end);
    }

    const docs = await JournalEntry.find(match)
      .select(`${dateField} lines detalle_asientos detalles_asiento`)
      .lean();

    const allLines = [];
    for (const e of docs) {
      const lines = e.lines || e.detalle_asientos || e.detalles_asiento || [];
      if (Array.isArray(lines) && lines.length) allLines.push(...lines);
    }

    const accountMaps = await getAccountMaps(owner, allLines);
    const nameMap = await getAccountNameMap(owner, codes);

    const byCode = {};
    for (const code of codes) {
      byCode[code] = {
        cuenta_codigo: code,
        cuenta_nombre: nameMap[code] || accountMaps.byCode[code] || null,
        debe: 0,
        haber: 0,
        neto: 0,
        saldo: 0,
      };
    }

    for (const e of docs) {
      const lines = e.lines || e.detalle_asientos || e.detalles_asiento || [];
      if (!Array.isArray(lines) || !lines.length) continue;

      for (const l of lines) {
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
      return { ...r, neto, saldo: neto };
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

    let asiento =
      (await JournalEntry.findOne({ owner, numeroAsiento: numero }).sort({ createdAt: -1 }).lean()) ||
      (await JournalEntry.findOne({ owner, numero: numero }).sort({ createdAt: -1 }).lean()) ||
      (await JournalEntry.findOne({ owner, numero_asiento: numero }).sort({ createdAt: -1 }).lean());

    if (!asiento) return res.status(404).json({ ok: false, error: "NOT_FOUND" });

    asiento = ensureConceptFallback(asiento);
    asiento = await ensureNumeroAsiento(owner, asiento);

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
 * GET /api/asientos/by-transaccion?source=ingreso|egreso|inventario|...&id=XXXXXXXX
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

    // ✅ 0) SOPORTE COGS:
    // si viene cogs_<journalEntryId>, resolvemos directo por _id del JournalEntry
    if (String(id).toLowerCase().startsWith("cogs_")) {
      const jeId = normalizeCogsId(id);
      if (!isObjectId(jeId)) {
        return res.status(400).json({ ok: false, error: "VALIDATION", message: "id cogs_ inválido" });
      }

      let asiento = await JournalEntry.findOne({ owner, _id: new mongoose.Types.ObjectId(jeId) }).lean();
      if (!asiento) return res.status(404).json({ ok: false, error: "NOT_FOUND" });

      asiento = ensureConceptFallback(asiento);
      asiento = await ensureNumeroAsiento(owner, asiento);

      const rawLines = asiento.lines || asiento.detalle_asientos || asiento.detalles_asiento || [];
      const accountMaps = await getAccountMaps(owner, rawLines);
      const asientoUI = mapEntryForUI(asiento, accountMaps);

      const numeroAsiento = asientoUI.numeroAsiento || asientoUI.numero_asiento || pickEntryNumero(asiento) || null;

      return res.json({
        ok: true,
        data: asientoUI,
        asiento: asientoUI,
        item: asientoUI,
        numeroAsiento,
        asientos: [asientoUI],
        ...asientoUI,
      });
    }

    // ✅ 1) Candidatos seguros (evitar CastError)
    const oid = isObjectId(id) ? new mongoose.Types.ObjectId(id) : null;
    const idStr = id;

    const sourceIdIsObj = pathIsObjectId(JournalEntry, "sourceId");
    const transaccionIdIsObj = pathIsObjectId(JournalEntry, "transaccionId");
    const source_idIsObj = pathIsObjectId(JournalEntry, "source_id");
    const transaccion_idIsObj = pathIsObjectId(JournalEntry, "transaccion_id");

    // Para campos ObjectId SOLO usamos ObjectId; para otros, usamos string y opcional ObjectId
    const inFor = (isObjPath) => {
      if (isObjPath) return oid ? [oid] : [];
      return oid ? [idStr, oid] : [idStr];
    };

    const sourceIdCandidates = inFor(sourceIdIsObj);
    const transaccionIdCandidates = inFor(transaccionIdIsObj);
    const source_idCandidates = inFor(source_idIsObj);
    const transaccion_idCandidates = inFor(transaccion_idIsObj);

    const sourceAliases = new Set();
    if (source) {
      const s = source.toLowerCase();
      sourceAliases.add(s);
      if (s === "ingresos") sourceAliases.add("ingreso");
      if (s === "ingreso") sourceAliases.add("ingresos");
      if (s === "egresos") sourceAliases.add("egreso");
      if (s === "egreso") sourceAliases.add("egresos");
      if (s === "movimientos_inventario") sourceAliases.add("inventario");
      if (s === "movimiento_inventario") sourceAliases.add("inventario");
      if (s === "inventario") {
        sourceAliases.add("movimiento_inventario");
        sourceAliases.add("movimientos_inventario");
        sourceAliases.add("inventory");
      }
    }

    const findBy = async (q) => JournalEntry.findOne(q).sort({ createdAt: -1 }).lean();

    let asiento = null;

    // 2) Buscar por source + ids (solo si hay candidatos válidos)
    if (sourceAliases.size) {
      const srcList = Array.from(sourceAliases);

      if (sourceIdCandidates.length) {
        asiento = (await findBy({ owner, source: { $in: srcList }, sourceId: { $in: sourceIdCandidates } })) || asiento;
      }
      if (!asiento && transaccionIdCandidates.length) {
        asiento = (await findBy({ owner, source: { $in: srcList }, transaccionId: { $in: transaccionIdCandidates } })) || asiento;
      }
      if (!asiento && source_idCandidates.length) {
        asiento = (await findBy({ owner, source: { $in: srcList }, source_id: { $in: source_idCandidates } })) || asiento;
      }

      if (!asiento) {
        asiento = await findBy({ owner, "references.source": { $in: srcList }, "references.id": idStr });
      }
    }

    // 3) Fallback: solo por id
    if (!asiento) {
      if (sourceIdCandidates.length) {
        asiento = (await findBy({ owner, sourceId: { $in: sourceIdCandidates } })) || asiento;
      }
      if (!asiento && transaccionIdCandidates.length) {
        asiento = (await findBy({ owner, transaccionId: { $in: transaccionIdCandidates } })) || asiento;
      }
      if (!asiento && source_idCandidates.length) {
        asiento = (await findBy({ owner, source_id: { $in: source_idCandidates } })) || asiento;
      }
      if (!asiento && transaccion_idCandidates.length) {
        asiento = (await findBy({ owner, transaccion_id: { $in: transaccion_idCandidates } })) || asiento;
      }
      if (!asiento) {
        asiento = await findBy({ owner, "references.id": idStr });
      }
    }

    // 4) ✅ ESPECIAL INVENTARIO: si no encontró asiento, resolver desde InventoryMovement -> journalEntryId/asientoId
    if (!asiento && InventoryMovement && isObjectId(id)) {
      const mov = await InventoryMovement.findOne({ owner, _id: new mongoose.Types.ObjectId(id) }).lean().catch(() => null);

      if (mov) {
        const jeId =
          mov.journalEntryId ??
          mov.asientoId ??
          mov.journal_entry_id ??
          mov.asiento_id ??
          mov.journalEntry ??
          mov.asiento ??
          null;

        if (jeId && isObjectId(jeId)) {
          asiento = await findBy({ owner, _id: new mongoose.Types.ObjectId(String(jeId)) });
        }

        // Si no hay id directo, intentar por source/sourceId del movimiento
        if (!asiento) {
          const movSrc = String(mov.source || "").trim().toLowerCase();
          const movSid = mov.sourceId ?? mov.source_id ?? mov.transaccionId ?? mov.transaccion_id ?? null;

          if (movSrc && movSid) {
            const candOid = isObjectId(movSid) ? new mongoose.Types.ObjectId(String(movSid)) : null;
            const cand = candOid ? [String(movSid), candOid] : [String(movSid)];

            asiento =
              (await findBy({ owner, source: movSrc, sourceId: { $in: candOid ? [candOid] : [] } }).catch(() => null)) ||
              (await findBy({ owner, source: movSrc, source_id: { $in: cand } })) ||
              (await findBy({ owner, source: movSrc, transaccionId: { $in: cand } }));
          }
        }
      }
    }

    if (!asiento) return res.status(404).json({ ok: false, error: "NOT_FOUND" });

    asiento = ensureConceptFallback(asiento);
    asiento = await ensureNumeroAsiento(owner, asiento);

    const rawLines = asiento.lines || asiento.detalle_asientos || asiento.detalles_asiento || [];
    const accountMaps = await getAccountMaps(owner, rawLines);
    const asientoUI = mapEntryForUI(asiento, accountMaps);

    const numeroAsiento = asientoUI.numeroAsiento || asientoUI.numero_asiento || pickEntryNumero(asiento) || null;

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

    let asiento = await JournalEntry.findOne({ _id: id, owner }).lean();
    if (!asiento) return res.status(404).json({ ok: false, error: "NOT_FOUND" });

    asiento = ensureConceptFallback(asiento);
    asiento = await ensureNumeroAsiento(owner, asiento);

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
