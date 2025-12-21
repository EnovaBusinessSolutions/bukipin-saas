// backend/routes/ingresos.js
const express = require("express");
const router = express.Router();

const ensureAuth = require("../middleware/ensureAuth");
const IncomeTransaction = require("../models/IncomeTransaction");
const JournalEntry = require("../models/JournalEntry");
const Account = require("../models/Account");

function parseDate(s) {
  if (!s) return null;
  const d = new Date(String(s));
  return Number.isNaN(d.getTime()) ? null : d;
}

function num(v, def = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function isTrue(v) {
  if (typeof v === "undefined") return false;
  const s = String(v).toLowerCase();
  return s === "true" || s === "1" || s === "yes";
}

/**
 * Detecta si JournalEntry.lines usa accountId (ObjectId) o accountCode/accountCodigo (string).
 */
function journalLineMode() {
  const schema = JournalEntry?.schema;
  if (!schema) return "code";

  // Intentos típicos (depende de tu schema real)
  const hasAccountId =
    schema.path("lines.accountId") ||
    schema.path("lines.$.accountId") ||
    schema.path("lines.0.accountId");

  if (hasAccountId) return "id";

  const hasAccountCode =
    schema.path("lines.accountCode") ||
    schema.path("lines.accountCodigo") ||
    schema.path("lines.$.accountCode") ||
    schema.path("lines.$.accountCodigo");

  return hasAccountCode ? "code" : "code";
}

/**
 * Devuelve un accountId buscando por code+owner (si existe).
 */
async function accountIdByCode(owner, code) {
  const acc = await Account.findOne({ owner, code: String(code).trim() }).select("_id code name").lean();
  return acc?._id || null;
}

/**
 * Construye una línea de asiento compatible con tu schema (accountId o accountCode)
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
    return {
      ...base,
      accountId: id, // puede ser null si no existe; ideal que tu seed lo tenga
    };
  }

  // mode === "code"
  return {
    ...base,
    accountCode: String(code).trim(),
  };
}

/**
 * GET /api/ingresos/detalles?start=YYYY-MM-DD&end=YYYY-MM-DD
 * (soporta también from/to)
 */
router.get("/detalles", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;

    const start = parseDate(req.query.start || req.query.from);
    const end = parseDate(req.query.end || req.query.to);

    if (!start || !end) {
      return res.status(400).json({ ok: false, message: "start/end (o from/to) son requeridos." });
    }

    const items = await IncomeTransaction.find({
      owner,
      fecha: { $gte: start, $lte: end },
    })
      .sort({ fecha: -1 })
      .lean();

    return res.json({ ok: true, data: items });
  } catch (err) {
    console.error("GET /api/ingresos/detalles error:", err);
    return res.status(500).json({ ok: false, message: "Error cargando ingresos" });
  }
});

/**
 * GET /api/ingresos/asientos-directos?limit=300
 * Devuelve asientos relacionados a ingresos (source: "ingreso")
 */
router.get("/asientos-directos", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;
    const limit = Math.min(2000, Number(req.query.limit || 300));

    const items = await JournalEntry.find({ owner, source: "ingreso" })
      .sort({ date: -1 })
      .limit(limit)
      .lean();

    return res.json({ ok: true, data: items });
  } catch (err) {
    console.error("GET /api/ingresos/asientos-directos error:", err);
    return res.status(500).json({ ok: false, message: "Error cargando asientos" });
  }
});

/**
 * GET /api/ingresos/recientes?limit=1000
 * Útil para widgets/tabla rápida
 */
router.get("/recientes", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;
    const limit = Math.min(2000, Number(req.query.limit || 1000));

    const items = await IncomeTransaction.find({ owner })
      .sort({ fecha: -1 })
      .limit(limit)
      .lean();

    return res.json({ ok: true, data: items });
  } catch (err) {
    console.error("GET /api/ingresos/recientes error:", err);
    return res.status(500).json({ ok: false, message: "Error cargando ingresos recientes" });
  }
});

/**
 * POST /api/ingresos
 * Crea transacción + asiento contable.
 *
 * Body recomendado (flexible):
 * - descripcion
 * - montoTotal
 * - montoDescuento (opcional)
 * - metodoPago: efectivo|bancos
 * - tipoPago: contado|parcial|credito
 * - montoPagado (opcional)
 * - cuentaCodigo (ingreso) default 4001
 * - fecha (opcional)
 * - clientId / productoId (opcionales si tu modelo los maneja)
 */
router.post("/", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;

    const descripcion = String(req.body?.descripcion || "Ingreso").trim();

    const total = num(req.body?.montoTotal, 0);
    const descuento = num(req.body?.montoDescuento, 0);
    const neto = Math.max(0, total - Math.max(0, descuento));

    const metodoPago = String(req.body?.metodoPago || "efectivo"); // efectivo|bancos
    const tipoPago = String(req.body?.tipoPago || "contado"); // contado|parcial|credito

    const montoPagado = num(req.body?.montoPagado, 0);
    const cuentaCodigo = String(req.body?.cuentaCodigo || "4001").trim(); // ingresos

    const fecha = req.body?.fecha ? new Date(req.body.fecha) : new Date();

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
    if (tipoPago === "contado" && montoPagado && Math.abs(montoPagado - neto) > 0.01) {
      // no bloqueamos por completo, pero avisamos con normalización
      // (hay UIs que mandan montoPagado aunque sea contado)
    }
    if (tipoPago === "parcial" && (montoPagado < 0 || montoPagado > neto)) {
      return res.status(400).json({ ok: false, message: "montoPagado debe estar entre 0 y montoNeto." });
    }
    if (tipoPago === "credito" && montoPagado > 0.01) {
      // crédito normalmente es 0 pagado al inicio; no bloqueamos por UI,
      // pero lo tratamos como “parcial” si viene pagado
    }

    // Códigos base (ajústalos a tu seed real)
    const COD_CAJA = "1001";
    const COD_BANCOS = "1002";
    const COD_CLIENTES = "1101";
    const COD_DESCUENTOS = "4002"; // (si tu catálogo usa otro, cámbialo)

    // Determinar cuentas Debe según tipoPago/metodoPago
    const codCobro = metodoPago === "bancos" ? COD_BANCOS : COD_CAJA;

    let saldoPendiente = 0;
    if (tipoPago === "contado") saldoPendiente = 0;
    else if (tipoPago === "credito") saldoPendiente = neto;
    else saldoPendiente = Math.max(0, neto - montoPagado);

    // Guardar transacción (owner)
    const txPayload = {
      owner,
      descripcion,
      montoTotal: total,
      montoDescuento: descuento,
      montoNeto: neto,
      metodoPago,
      tipoPago,
      montoPagado: tipoPago === "contado" ? neto : montoPagado,
      saldoPendiente,
      cuentaCodigo,
      fecha,
    };

    // Si tu modelo soporta clientId/productId, los pasamos sin romper
    if (req.body?.clientId) txPayload.clientId = req.body.clientId;
    if (req.body?.productoId) txPayload.productoId = req.body.productoId;
    if (req.body?.productId) txPayload.productId = req.body.productId;

    const tx = await IncomeTransaction.create(txPayload);

    /**
     * Crear asiento contable:
     * - Haber: Ventas (cuentaCodigo) por TOTAL (o NETO si no quieres separar descuento)
     * - Debe:
     *   - Contado: Caja/Bancos por NETO
     *   - Crédito: Clientes por NETO
     *   - Parcial: Caja/Bancos por pagado + Clientes por pendiente
     * - Si descuento > 0: Debe "Descuentos" por descuento y Haber Ventas por total (cuadra)
     */
    const lines = [];

    // Descuento (Debe)
    if (descuento > 0) {
      lines.push(await buildLine(owner, { code: COD_DESCUENTOS, debit: descuento, credit: 0, memo: "Descuento" }));
    }

    if (tipoPago === "contado") {
      lines.push(await buildLine(owner, { code: codCobro, debit: neto, credit: 0, memo: "Cobro contado" }));
    } else if (tipoPago === "credito") {
      // si vino montoPagado > 0, lo tratamos como parcial
      if (montoPagado > 0.01) {
        const pagado = Math.min(montoPagado, neto);
        const pendiente = Math.max(0, neto - pagado);

        lines.push(await buildLine(owner, { code: codCobro, debit: pagado, credit: 0, memo: "Cobro inicial" }));
        if (pendiente > 0) {
          lines.push(await buildLine(owner, { code: COD_CLIENTES, debit: pendiente, credit: 0, memo: "Saldo pendiente" }));
        }
      } else {
        lines.push(await buildLine(owner, { code: COD_CLIENTES, debit: neto, credit: 0, memo: "Venta a crédito" }));
      }
    } else {
      // parcial
      const pagado = Math.min(montoPagado, neto);
      const pendiente = Math.max(0, neto - pagado);

      if (pagado > 0) lines.push(await buildLine(owner, { code: codCobro, debit: pagado, credit: 0, memo: "Cobro parcial" }));
      if (pendiente > 0) lines.push(await buildLine(owner, { code: COD_CLIENTES, debit: pendiente, credit: 0, memo: "Saldo pendiente" }));
    }

    // Haber ingresos: si hay descuento separado, haberes por TOTAL; si no, por NETO
    const haberIngresos = descuento > 0 ? total : neto;
    lines.push(await buildLine(owner, { code: cuentaCodigo, debit: 0, credit: haberIngresos, memo: "Ingreso" }));

    const entry = await JournalEntry.create({
      owner,
      date: tx.fecha,
      concept: `Ingreso: ${tx.descripcion}`,
      source: "ingreso",
      sourceId: tx._id,
      lines,
    });

    return res.status(201).json({ ok: true, data: { transaction: tx, journalEntry: entry } });
  } catch (err) {
    console.error("POST /api/ingresos error:", err);
    return res.status(500).json({ ok: false, message: "Error creando ingreso" });
  }
});

module.exports = router;
