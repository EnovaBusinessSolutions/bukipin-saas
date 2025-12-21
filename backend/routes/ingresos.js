// backend/routes/ingresos.js
const express = require("express");
const router = express.Router();

const ensureAuth = require("../middleware/ensureAuth");
const IncomeTransaction = require("../models/IncomeTransaction");
const JournalEntry = require("../models/JournalEntry");
const Account = require("../models/Account");

// Opcional (si existe en tu proyecto)
let Client = null;
try {
  Client = require("../models/Client");
} catch (_) {}

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

/**
 * Detecta si JournalEntry.lines usa accountId (ObjectId) o accountCodigo (string).
 * Tu modelo (según screenshot) usa accountCodigo.
 */
function journalLineMode() {
  const schema = JournalEntry?.schema;
  if (!schema) return "code";

  const hasAccountId =
    schema.path("lines.accountId") ||
    schema.path("lines.$.accountId") ||
    schema.path("lines.0.accountId");
  if (hasAccountId) return "id";

  const hasAccountCodigo =
    schema.path("lines.accountCodigo") ||
    schema.path("lines.$.accountCodigo") ||
    schema.path("lines.0.accountCodigo");
  if (hasAccountCodigo) return "code";

  // fallback legacy
  const hasAccountCode =
    schema.path("lines.accountCode") ||
    schema.path("lines.$.accountCode") ||
    schema.path("lines.0.accountCode");

  return hasAccountCode ? "code" : "code";
}

async function accountIdByCode(owner, code) {
  const acc = await Account.findOne({
    owner,
    code: String(code).trim(),
  })
    .select("_id code name")
    .lean();
  return acc?._id || null;
}

/**
 * Construye una línea de asiento compatible con tu schema.
 * Importante: si tu schema requiere accountId y no existe la cuenta, fallamos con mensaje claro.
 */
async function buildLine(owner, { code, debit = 0, credit = 0, memo = "" }) {
  const mode = journalLineMode();

  const base = {
    debit: num(debit, 0),
    credit: num(credit, 0),
    memo: memo || "",
  };

  if (mode === "id") {
    const id = await accountIdByCode(owner, code);
    if (!id) {
      const err = new Error(
        `No existe la cuenta contable con code="${String(code).trim()}" para este usuario. Asegúrate de que el seed la haya creado.`
      );
      err.statusCode = 400;
      throw err;
    }
    return { ...base, accountId: id };
  }

  // ✅ Tu JournalEntry usa accountCodigo
  return { ...base, accountCodigo: String(code).trim() };
}

/**
 * Mapeo de JournalEntry a la forma legacy que tu UI suele esperar
 */
function mapEntryForUI(entry) {
  const detalle_asientos = (entry.lines || []).map((l) => ({
    cuenta_codigo: l.accountCodigo ?? l.accountCode ?? null,
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
    transaccion_ingreso_id: entry.sourceId ? String(entry.sourceId) : null,

    detalle_asientos,

    created_at: entry.createdAt,
    updated_at: entry.updatedAt,
  };
}

/**
 * Aplanar asientos a "detalles" contables (analítica lo usa mucho)
 */
function flattenDetalles(entries) {
  const detalles = [];
  for (const e of entries) {
    const asientoFecha = toYMD(e.date);
    for (const l of e.lines || []) {
      detalles.push({
        cuenta_codigo: l.accountCodigo ?? l.accountCode ?? null,
        debe: num(l.debit, 0),
        haber: num(l.credit, 0),
        asiento_fecha: asientoFecha,
        asiento_id: String(e._id),
        concepto: e.concept ?? "",
        transaccion_ingreso_id: e.sourceId ? String(e.sourceId) : null,
      });
    }
  }
  return detalles;
}

/**
 * GET /api/ingresos/clientes-min?q=...&limit=200
 */
router.get("/clientes-min", ensureAuth, async (req, res) => {
  try {
    if (!Client) return res.json({ ok: true, data: [] });

    const owner = req.user._id;
    const q = (req.query.q ? String(req.query.q) : "").trim();
    const limit = Math.min(2000, Number(req.query.limit || 200));

    const filter = { owner };
    if (q) {
      filter.$or = [
        { nombre: { $regex: q, $options: "i" } },
        { name: { $regex: q, $options: "i" } },
        { rfc: { $regex: q, $options: "i" } },
      ];
    }

    const items = await Client.find(filter)
      .select("_id nombre name")
      .sort({ nombre: 1, name: 1 })
      .limit(limit)
      .lean();

    const data = items.map((c) => ({
      id: String(c._id),
      nombre: c.nombre ?? c.name ?? "Sin nombre",
    }));

    return res.json({ ok: true, data });
  } catch (err) {
    console.error("GET /api/ingresos/clientes-min error:", err);
    return res.status(500).json({ ok: false, message: "Error cargando clientes" });
  }
});

/**
 * GET /api/ingresos/asientos?start=YYYY-MM-DD&end=YYYY-MM-DD
 * Devuelve asientos con detalle_asientos
 */
router.get("/asientos", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;

    const start = parseStartDate(req.query.start || req.query.from);
    const end = parseEndDate(req.query.end || req.query.to);

    if (!start || !end) {
      return res.status(400).json({
        ok: false,
        message: "start/end (o from/to) son requeridos.",
      });
    }

    const entries = await JournalEntry.find({
      owner,
      date: { $gte: start, $lte: end },
      source: { $in: ["ingreso", "ingreso_directo"] },
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
    console.error("GET /api/ingresos/asientos error:", err);
    return res.status(500).json({ ok: false, message: "Error cargando asientos" });
  }
});

/**
 * GET /api/ingresos/detalles?start=YYYY-MM-DD&end=YYYY-MM-DD
 * Devuelve detalles contables aplanados + items/resumen (compat)
 */
router.get("/detalles", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;

    const start = parseStartDate(req.query.start || req.query.from);
    const end = parseEndDate(req.query.end || req.query.to);

    if (!start || !end) {
      return res.status(400).json({
        ok: false,
        message: "start/end (o from/to) son requeridos.",
      });
    }

    // 1) Asientos para detalles contables
    const entries = await JournalEntry.find({
      owner,
      date: { $gte: start, $lte: end },
      source: { $in: ["ingreso", "ingreso_directo"] },
    })
      .sort({ date: -1, createdAt: -1 })
      .lean();

    const detalles = flattenDetalles(entries);

    // 2) Transacciones (por si la UI las usa también)
    const items = await IncomeTransaction.find({
      owner,
      fecha: { $gte: start, $lte: end },
    })
      .sort({ fecha: -1, createdAt: -1 })
      .lean();

    const total = items.reduce(
      (acc, it) => acc + num(it.montoNeto ?? it.montoTotal ?? 0),
      0
    );

    return res.json({
      ok: true,
      data: {
        detalles,
        items,
        resumen: { total, count: items.length },
      },
      // compat legacy
      detalles,
      items,
      resumen: { total, count: items.length },
    });
  } catch (err) {
    console.error("GET /api/ingresos/detalles error:", err);
    return res.status(500).json({ ok: false, message: "Error cargando detalles" });
  }
});

/**
 * GET /api/ingresos/asientos-directos?limit=300
 * Asientos sin transacción ligada (sourceId null). start/end opcional.
 */
router.get("/asientos-directos", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;
    const limit = Math.min(2000, Number(req.query.limit || 300));

    const start = parseStartDate(req.query.start || req.query.from);
    const end = parseEndDate(req.query.end || req.query.to);

    const filter = {
      owner,
      source: { $in: ["ingreso", "ingreso_directo"] },
      $or: [{ sourceId: null }, { sourceId: { $exists: false } }],
    };

    if (start && end) filter.date = { $gte: start, $lte: end };

    const entries = await JournalEntry.find(filter)
      .sort({ date: -1, createdAt: -1 })
      .limit(limit)
      .lean();

    const asientos = entries.map(mapEntryForUI);

    return res.json({
      ok: true,
      data: { asientos },
      asientos,
    });
  } catch (err) {
    console.error("GET /api/ingresos/asientos-directos error:", err);
    return res.status(500).json({ ok: false, message: "Error cargando asientos" });
  }
});

/**
 * GET /api/ingresos/recientes?limit=1000
 */
router.get("/recientes", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;
    const limit = Math.min(2000, Number(req.query.limit || 1000));

    const items = await IncomeTransaction.find({ owner })
      .sort({ fecha: -1, createdAt: -1 })
      .limit(limit)
      .lean();

    return res.json({ ok: true, data: items, items });
  } catch (err) {
    console.error("GET /api/ingresos/recientes error:", err);
    return res.status(500).json({ ok: false, message: "Error cargando ingresos recientes" });
  }
});

/**
 * POST /api/ingresos/:id/cancelar
 * Compat con UI legacy: borra la transacción y su asiento ligado.
 */
router.post("/:id/cancelar", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;
    const { id } = req.params;

    const tx = await IncomeTransaction.findOne({ _id: id, owner });
    if (!tx) return res.status(404).json({ ok: false, message: "Ingreso no encontrado." });

    // Encuentra asientos ligados para devolver "numeroAsientoCancelado"
    const linked = await JournalEntry.findOne({
      owner,
      source: "ingreso",
      sourceId: tx._id,
    }).select("_id").lean();

    const numeroAsientoCancelado = linked ? String(linked._id) : null;

    await JournalEntry.deleteMany({ owner, source: "ingreso", sourceId: tx._id });
    await IncomeTransaction.deleteOne({ _id: tx._id, owner });

    return res.json({
      ok: true,
      numeroAsientoCancelado,
      data: { numeroAsientoCancelado },
    });
  } catch (err) {
    console.error("POST /api/ingresos/:id/cancelar error:", err);
    return res.status(500).json({ ok: false, message: "Error cancelando ingreso" });
  }
});

/**
 * POST /api/ingresos
 * Crea transacción + asiento contable.
 *
 * Acepta llaves legacy y nuevas:
 * - tipoIngreso (precargados|inventariados|general|otros)
 * - descripcion
 * - montoTotal / total
 * - montoDescuento / descuento
 * - metodoPago: efectivo|bancos
 * - tipoPago: contado|parcial|credito
 * - montoPagado / pagado
 * - cuentaCodigo OR cuentaPrincipalCodigo (default 4001)
 * - subcuentaId (opcional)
 * - fecha (opcional)
 * - clienteId/clientId (opcional)
 */
router.post("/", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;

    const tipoIngreso = String(req.body?.tipoIngreso || "general"); // UI lo manda
    const descripcion = String(req.body?.descripcion || "Ingreso").trim();

    const total = num(req.body?.montoTotal ?? req.body?.total, 0);
    const descuento = num(req.body?.montoDescuento ?? req.body?.descuento, 0);
    const neto = Math.max(0, total - Math.max(0, descuento));

    const metodoPago = String(req.body?.metodoPago || "efectivo"); // efectivo|bancos
    const tipoPago = String(req.body?.tipoPago || "contado"); // contado|parcial|credito

    const cuentaCodigo = String(
      req.body?.cuentaCodigo || req.body?.cuentaPrincipalCodigo || "4001"
    ).trim();

    const subcuentaId = req.body?.subcuentaId ?? null;

    const fecha = req.body?.fecha ? new Date(req.body.fecha) : new Date();
    if (Number.isNaN(fecha.getTime())) {
      return res.status(400).json({ ok: false, message: "fecha inválida." });
    }

    const montoPagadoRaw = num(req.body?.montoPagado ?? req.body?.pagado, 0);

    if (!total || total <= 0) {
      return res.status(400).json({ ok: false, message: "montoTotal debe ser > 0." });
    }
    if (descuento < 0) {
      return res.status(400).json({ ok: false, message: "montoDescuento no puede ser negativo." });
    }
    if (!["efectivo", "bancos"].includes(metodoPago)) {
      return res.status(400).json({ ok: false, message: "metodoPago inválido (efectivo|bancos)." });
    }
    if (!["contado", "parcial", "credito"].includes(tipoPago)) {
      return res.status(400).json({ ok: false, message: "tipoPago inválido (contado|parcial|credito)." });
    }
    if (tipoPago === "parcial" && (montoPagadoRaw < 0 || montoPagadoRaw > neto)) {
      return res.status(400).json({ ok: false, message: "montoPagado debe estar entre 0 y montoNeto." });
    }

    // Normalización de pagado / pendiente
    const montoPagado =
      tipoPago === "contado" ? neto : Math.min(Math.max(montoPagadoRaw, 0), neto);
    const saldoPendiente = tipoPago === "contado" ? 0 : Math.max(0, neto - montoPagado);

    // Códigos base (ajústalos a tu seed real)
    const COD_CAJA = "1001";
    const COD_BANCOS = "1002";
    const COD_CLIENTES = "1101";
    const COD_DESCUENTOS = "4002";
    const codCobro = metodoPago === "bancos" ? COD_BANCOS : COD_CAJA;

    // Armar transacción
    const txPayload = {
      owner,
      fecha,
      tipoIngreso, // ✅
      descripcion,

      montoTotal: total,
      montoDescuento: descuento,
      montoNeto: neto,

      metodoPago,
      tipoPago,
      montoPagado,

      cuentaCodigo,
      subcuentaId,

      // Si tu schema NO tiene saldoPendiente, Mongoose lo ignorará (si strict true).
      // Si lo tiene, lo guardará.
      saldoPendiente,
    };

    const clienteId = req.body?.clienteId ?? req.body?.clientId ?? null;
    if (clienteId) txPayload.clienteId = clienteId;

    const tx = await IncomeTransaction.create(txPayload);

    /**
     * Crear asiento:
     * - Debe: Caja/Bancos y/o Clientes
     * - Debe: Descuentos (si aplica)
     * - Haber: Ingresos (cuentaCodigo)
     */
    const lines = [];

    if (descuento > 0) {
      lines.push(
        await buildLine(owner, {
          code: COD_DESCUENTOS,
          debit: descuento,
          credit: 0,
          memo: "Descuento",
        })
      );
    }

    if (tipoPago === "contado") {
      lines.push(
        await buildLine(owner, {
          code: codCobro,
          debit: neto,
          credit: 0,
          memo: "Cobro contado",
        })
      );
    } else {
      if (montoPagado > 0) {
        lines.push(
          await buildLine(owner, {
            code: codCobro,
            debit: montoPagado,
            credit: 0,
            memo: "Cobro",
          })
        );
      }
      if (saldoPendiente > 0) {
        lines.push(
          await buildLine(owner, {
            code: COD_CLIENTES,
            debit: saldoPendiente,
            credit: 0,
            memo: "Saldo pendiente",
          })
        );
      }
    }

    const haberIngresos = descuento > 0 ? total : neto;
    lines.push(
      await buildLine(owner, {
        code: cuentaCodigo,
        debit: 0,
        credit: haberIngresos,
        memo: "Ingreso",
      })
    );

    const entry = await JournalEntry.create({
      owner,
      date: tx.fecha,
      concept: `Ingreso: ${tx.descripcion}`,
      source: "ingreso",
      sourceId: tx._id,
      lines,
    });

    // ✅ LO QUE ARREGLA "Asiento undefined"
    const asiento = mapEntryForUI(entry);
    const numeroAsiento = String(entry._id);

    return res.status(201).json({
      ok: true,
      numeroAsiento, // ✅ legacy UI
      asiento, // ✅ legacy UI (detalle_asientos)
      data: {
        transaction: tx,
        journalEntry: entry,
        asiento,
        numeroAsiento,
      },
    });
  } catch (err) {
    const status = err?.statusCode || 500;
    console.error("POST /api/ingresos error:", err);
    return res.status(status).json({ ok: false, message: err?.message || "Error creando ingreso" });
  }
});

module.exports = router;
