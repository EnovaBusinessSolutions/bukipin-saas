const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const ensureAuth = require("../middleware/ensureAuth");

const ExpenseTransaction = require("../models/ExpenseTransaction");
const ExpenseProduct = require("../models/ExpenseProduct");

let JournalEntry = null;
try {
  JournalEntry = require("../models/JournalEntry");
} catch (e) {
  JournalEntry = null;
}

let Account = null;
try {
  Account = require("../models/Account");
} catch (e) {
  Account = null;
}

const {
  TZ_OFFSET_MINUTES,
  num: dtNum,
  asTrim,
  asValidDate,
  toYMDLocal,
  parseInputDateSmart,
  parseStartDate,
  parseEndDate,
  pickEffectiveDate,
} = require("../utils/datetime");

// ======================================================
// Helpers base
// ======================================================

function toNum(v, def = 0) {
  return dtNum(v, def);
}

function normalizeTipoEgreso(v) {
  const s = asTrim(v).toLowerCase();
  if (["costo", "costos"].includes(s)) return "costo";
  if (["gasto", "gastos"].includes(s)) return "gasto";
  if (["otro", "otros"].includes(s)) return "otro";
  return s;
}

function normalizeTipoPago(v) {
  const s = asTrim(v).toLowerCase();
  if (["contado", "total", "pago_total"].includes(s)) return "contado";
  if (["credito", "crédito"].includes(s)) return "credito";
  if (["parcial", "parciales"].includes(s)) return "parcial";
  return s;
}

function normalizeMetodoPago(v) {
  const s = asTrim(v).toLowerCase();
  if (!s) return "";
  if (s === "bancos" || s === "transferencia" || s === "tarjeta-transferencia") return "bancos";
  return s;
}

function normalizeEstado(v) {
  const s = asTrim(v).toLowerCase();
  if (!s) return "";
  if (["activo", "activa", "active"].includes(s)) return "activo";
  if (["cancelado", "cancelada", "canceled"].includes(s)) return "cancelado";
  return s;
}

function toObjectIdOrNull(v) {
  if (v === undefined || v === null) return null;
  if (v instanceof mongoose.Types.ObjectId) return v;
  const s = String(v).trim();
  if (!s) return null;
  return mongoose.Types.ObjectId.isValid(s) ? new mongoose.Types.ObjectId(s) : null;
}

function getExpenseEffectiveDate(doc) {
  return (
    asValidDate(doc?.fecha) ||
    asValidDate(doc?.date) ||
    asValidDate(doc?.createdAt) ||
    asValidDate(doc?.created_at) ||
    null
  );
}

function getExpenseDueDate(doc) {
  return (
    asValidDate(doc?.fechaVencimiento) ||
    asValidDate(doc?.fecha_vencimiento) ||
    null
  );
}

let _txProductField = null;
function getTxProductField() {
  if (_txProductField) return _txProductField;
  const paths = ExpenseTransaction?.schema?.paths || {};
  if (paths.productoId) _txProductField = "productoId";
  else if (paths.productId) _txProductField = "productId";
  else if (paths.producto_egreso_id) _txProductField = "producto_egreso_id";
  else _txProductField = "productoId";
  return _txProductField;
}

function mapTxForUI(doc) {
  const d = doc?.toObject ? doc.toObject() : doc;

  const subtipoResolved = d.subtipoEgreso ?? d.subtipo_egreso ?? "";
  let tipoResolved = d.tipoEgreso ?? d.tipo_egreso ?? d.tipo ?? "";
  const estadoResolved = d.estado ?? d.status ?? "activo";

  if (String(subtipoResolved || "").toLowerCase() === "otros_gastos") {
    tipoResolved = "otro";
  }

  const fecha = getExpenseEffectiveDate(d);
  const fechaVencimiento = getExpenseDueDate(d);

  const item = {
    id: String(d._id),
    _id: d._id,

    tipo_egreso: tipoResolved,
    subtipo_egreso: subtipoResolved,

    descripcion: d.descripcion ?? "",

    cuenta_codigo: d.cuentaCodigo ?? d.cuenta_codigo ?? "",
    subcuenta_id: d.subcuentaId
      ? String(d.subcuentaId)
      : d.subcuenta_id
      ? String(d.subcuenta_id)
      : null,

    monto_total: toNum(d.montoTotal ?? d.monto_total ?? d.total ?? 0, 0),
    cantidad: toNum(d.cantidad, 0),
    precio_unitario: toNum(d.precioUnitario ?? d.precio_unitario, 0),

    tipo_pago: d.tipoPago ?? d.tipo_pago ?? "",
    metodo_pago: d.metodoPago ?? d.metodo_pago ?? "",

    monto_pagado: toNum(d.montoPagado ?? d.monto_pagado, 0),
    monto_pendiente: toNum(d.montoPendiente ?? d.monto_pendiente, 0),

    fecha: fecha ? fecha.toISOString() : null,
    fecha_ymd: fecha ? toYMDLocal(fecha) : null,

    fecha_vencimiento: fechaVencimiento ? fechaVencimiento.toISOString() : null,
    fecha_vencimiento_ymd: fechaVencimiento ? toYMDLocal(fechaVencimiento) : null,

    proveedor_id: d.proveedorId ? String(d.proveedorId) : d.proveedor_id ? String(d.proveedor_id) : null,
    proveedor_nombre: d.proveedorNombre ?? d.proveedor_nombre ?? null,
    proveedor_telefono: d.proveedorTelefono ?? d.proveedor_telefono ?? null,
    proveedor_email: d.proveedorEmail ?? d.proveedor_email ?? null,
    proveedor_rfc: d.proveedorRfc ?? d.proveedor_rfc ?? null,

    producto_egreso_id: d.productoEgresoId
      ? String(d.productoEgresoId)
      : d.producto_egreso_id
      ? String(d.producto_egreso_id)
      : d.productoId
      ? String(d.productoId)
      : d.productId
      ? String(d.productId)
      : null,

    comentarios: d.comentarios ?? null,
    numero_asiento: d.numeroAsiento ?? d.numero_asiento ?? null,
    asiento_id: d.asientoId ? String(d.asientoId) : d.asiento_id ? String(d.asiento_id) : null,

    estado: estadoResolved,
    motivo_cancelacion: d.motivoCancelacion ?? d.motivo_cancelacion ?? null,
    cancelado_at: d.canceladoAt
      ? new Date(d.canceladoAt).toISOString()
      : d.cancelado_at
      ? new Date(d.cancelado_at).toISOString()
      : null,
    numero_asiento_reversion: d.numeroAsientoReversion ?? d.numero_asiento_reversion ?? null,

    created_at: d.createdAt ? new Date(d.createdAt).toISOString() : d.created_at ?? null,
    updated_at: d.updatedAt ? new Date(d.updatedAt).toISOString() : d.updated_at ?? null,
  };

  item.tipoEgreso = item.tipo_egreso;
  item.subtipoEgreso = item.subtipo_egreso;
  item.cuentaCodigo = item.cuenta_codigo;
  item.subcuentaId = item.subcuenta_id;
  item.montoTotal = item.monto_total;
  item.precioUnitario = item.precio_unitario;
  item.tipoPago = item.tipo_pago;
  item.metodoPago = item.metodo_pago;
  item.montoPagado = item.monto_pagado;
  item.montoPendiente = item.monto_pendiente;
  item.fechaVencimiento = item.fecha_vencimiento;
  item.proveedorId = item.proveedor_id;
  item.productoId = item.producto_egreso_id;
  item.asientoId = item.asiento_id;
  item.motivoCancelacion = item.motivo_cancelacion;
  item.canceladoAt = item.cancelado_at;
  item.numeroAsientoReversion = item.numero_asiento_reversion;

  return item;
}

function genNumeroAsiento(ownerId) {
  const ymd = toYMDLocal(new Date())?.replace(/-/g, "") || "00000000";
  const rand = Math.random().toString(36).slice(2, 7).toUpperCase();
  const tail = String(ownerId).slice(-4).toUpperCase();
  return `EGR-${ymd}-${tail}-${rand}`;
}

function resolveCreditAccountByMetodoPago(metodoPago) {
  const CASH = process.env.CTA_EFECTIVO || "1001";
  const BANK = process.env.CTA_BANCOS || "1002";

  if (!metodoPago) return { tipo: "unknown", cuentaCodigo: BANK, meta: {} };
  if (metodoPago === "efectivo") return { tipo: "cash", cuentaCodigo: CASH, meta: {} };
  if (metodoPago === "bancos") return { tipo: "bank", cuentaCodigo: BANK, meta: {} };

  if (metodoPago.startsWith("tarjeta_credito_")) {
    const CC = process.env.CTA_TARJETAS_CREDITO || "2101";
    return { tipo: "credit_card", cuentaCodigo: CC, meta: { tarjetaId: metodoPago.replace("tarjeta_credito_", "") } };
  }

  return { tipo: "other", cuentaCodigo: BANK, meta: {} };
}

function isPrecargadosFlow(subtipoEgreso, reqBody) {
  const sub = String(subtipoEgreso || "").trim().toLowerCase();
  const src = String(reqBody?.source ?? reqBody?.origen ?? reqBody?.from ?? "").trim().toLowerCase();

  if (src === "precargados" || src === "precargado") return true;
  if (sub === "precargado" || sub === "precargados") return true;
  if (sub.includes("precarg")) return true;

  return false;
}

function wantsForceProveedores2001(reqBody) {
  return reqBody?.force_proveedores_2001 === true || reqBody?.forceProveedores2001 === true;
}

function isOtrosGastos(tipoEgresoRaw, subtipoEgreso) {
  const t = String(tipoEgresoRaw || "").toLowerCase().trim();
  const s = String(subtipoEgreso || "").toLowerCase().trim();
  return t === "otro" || s === "otros_gastos";
}

function pickLines(e) {
  return e?.lines || e?.detalle_asientos || e?.detalles_asiento || [];
}

function pickCode(l) {
  return String(
    l?.accountCodigo ??
      l?.accountCode ??
      l?.cuentaCodigo ??
      l?.cuenta_codigo ??
      l?.code ??
      l?.cuenta?.code ??
      l?.cuenta?.codigo ??
      l?.account?.code ??
      l?.account?.codigo ??
      ""
  ).trim();
}

function pickDebe(l) {
  const side = String(l?.side || "").toLowerCase().trim();
  const monto = toNum(l?.monto ?? l?.amount ?? l?.importe ?? l?.valor ?? 0, 0);
  return toNum(l?.debit ?? l?.debe ?? 0, 0) || (side === "debit" ? monto : 0);
}

function pickHaber(l) {
  const side = String(l?.side || "").toLowerCase().trim();
  const monto = toNum(l?.monto ?? l?.amount ?? l?.importe ?? l?.valor ?? 0, 0);
  return toNum(l?.credit ?? l?.haber ?? 0, 0) || (side === "credit" ? monto : 0);
}

function pickMemo(l) {
  return String(l?.memo ?? l?.descripcion ?? l?.concepto ?? l?.description ?? "").trim();
}

function pickEntryDate(e) {
  return pickEffectiveDate(e);
}

function pickEntryNumero(e) {
  return e?.numeroAsiento ?? e?.numero_asiento ?? e?.numero ?? e?.folio ?? String(e?._id || "");
}

function extractNameQtyFromText(text) {
  const s = String(text || "").trim();
  if (!s) return { producto_nombre: "", cantidad: null };

  const m = s.match(/costo\s+de\s+venta\s*-\s*(.+?)\s*\((\d+)\s*unidades?\)/i);
  if (m) return { producto_nombre: String(m[1] || "").trim(), cantidad: toNum(m[2], 0) };

  const m2 = s.match(/-\s*(.+?)\s*\((\d+)\s*unidades?\)/i);
  if (m2) return { producto_nombre: String(m2[1] || "").trim(), cantidad: toNum(m2[2], 0) };

  return { producto_nombre: "", cantidad: null };
}

function mirrorCamel(item) {
  const x = { ...item };

  x.tipoEgreso = x.tipo_egreso;
  x.subtipoEgreso = x.subtipo_egreso;
  x.cuentaCodigo = x.cuenta_codigo;
  x.subcuentaId = x.subcuenta_id;
  x.montoTotal = x.monto_total;
  x.precioUnitario = x.precio_unitario;
  x.tipoPago = x.tipo_pago;
  x.metodoPago = x.metodo_pago;
  x.montoPagado = x.monto_pagado;
  x.montoPendiente = x.monto_pendiente;
  x.fechaVencimiento = x.fecha_vencimiento;
  x.proveedorId = x.proveedor_id;
  x.productoId = x.producto_egreso_id;
  x.asientoId = x.asiento_id;
  x.motivoCancelacion = x.motivo_cancelacion;
  x.canceladoAt = x.cancelado_at;
  x.numeroAsientoReversion = x.numero_asiento_reversion;

  return x;
}

function sortByEffectiveDateDesc(a, b) {
  const da = getExpenseEffectiveDate(a) || pickEntryDate(a);
  const db = getExpenseEffectiveDate(b) || pickEntryDate(b);

  const ta = da ? da.getTime() : 0;
  const tb = db ? db.getTime() : 0;
  if (tb !== ta) return tb - ta;

  const ca = asValidDate(a?.createdAt ?? a?.created_at)?.getTime() || 0;
  const cb = asValidDate(b?.createdAt ?? b?.created_at)?.getTime() || 0;
  return cb - ca;
}

async function buildCogsTxItemsFromJournal({ owner, start, end, limit = 2000 }) {
  if (!JournalEntry) return [];

  const docs = await JournalEntry.find({ owner })
    .select(
      "date fecha entryDate createdAt created_at concept concepto descripcion memo numeroAsiento numero_asiento numero folio lines detalle_asientos detalles_asiento"
    )
    .limit(Math.min(Math.max(limit, 1), 5000))
    .lean();

  const filteredDocs = (docs || []).filter((e) => {
    const fecha = pickEntryDate(e);
    if (!fecha) return false;
    if (start && fecha.getTime() < start.getTime()) return false;
    if (end && fecha.getTime() > end.getTime()) return false;
    return true;
  });

  let nameMap = new Map();
  if (Account) {
    try {
      const allLines = [];
      for (const e of filteredDocs) {
        const lines = pickLines(e);
        if (Array.isArray(lines)) allLines.push(...lines);
      }
      const codes = Array.from(new Set(allLines.map(pickCode).filter(Boolean)));
      if (codes.length) {
        const accRows = await Account.find({
          owner,
          $or: [{ code: { $in: codes } }, { codigo: { $in: codes } }],
        })
          .select("code codigo name nombre")
          .lean();

        nameMap = new Map(
          (accRows || []).map((a) => [String(a.code ?? a.codigo).trim(), a.name ?? a.nombre ?? ""])
        );
      }
    } catch (_) {}
  }

  const out = [];

  for (const e of filteredDocs) {
    const lines = pickLines(e);
    if (!Array.isArray(lines) || !lines.length) continue;

    let debe5002 = 0;
    let refText = "";

    for (const l of lines) {
      if (pickCode(l) === "5002") {
        const d = pickDebe(l);
        debe5002 += d;
        if (!refText) refText = pickMemo(l);
      }
    }

    if (!(debe5002 > 0)) continue;

    const fecha = pickEntryDate(e);
    const numero = pickEntryNumero(e);
    const concepto = String(e.concept ?? e.concepto ?? e.descripcion ?? e.memo ?? "").trim();

    const { producto_nombre, cantidad } = extractNameQtyFromText(refText || concepto);
    const montoTotal = Math.round(debe5002 * 100) / 100;
    const precioUnit = cantidad && cantidad > 0 ? Math.round((montoTotal / cantidad) * 100) / 100 : 0;

    const detalles_asiento = lines.map((l) => {
      const code = pickCode(l) || null;
      return {
        cuenta_codigo: code,
        cuenta_nombre: code ? nameMap.get(code) || null : null,
        debe: pickDebe(l),
        haber: pickHaber(l),
        descripcion: pickMemo(l) || null,
      };
    });

    const base = {
      id: `cogs_${String(e._id)}`,
      _id: `cogs_${String(e._id)}`,

      tipo_egreso: "costo",
      subtipo_egreso: "costo_venta_inventario",

      descripcion: concepto || `Costo de venta inventario${producto_nombre ? ` - ${producto_nombre}` : ""}`,

      cuenta_codigo: "5002",
      subcuenta_id: null,

      monto_total: montoTotal,
      cantidad: cantidad ?? 1,
      precio_unitario: precioUnit,

      tipo_pago: "contado",
      metodo_pago: "cogs",

      monto_pagado: montoTotal,
      monto_pendiente: 0,

      fecha: fecha ? fecha.toISOString() : null,
      fecha_ymd: fecha ? toYMDLocal(fecha) : null,
      fecha_vencimiento: null,

      proveedor_id: null,
      proveedor_nombre: null,
      proveedor_telefono: null,
      proveedor_email: null,
      proveedor_rfc: null,

      producto_egreso_id: null,
      comentarios: null,

      numero_asiento: String(numero),
      asiento_id: String(e._id),

      estado: "activo",

      motivo_cancelacion: null,
      cancelado_at: null,
      numero_asiento_reversion: null,

      created_at: fecha ? fecha.toISOString() : null,
      updated_at: null,

      source: "cogs_journal",
      detalles_asiento,
    };

    out.push(mirrorCamel(base));
  }

  out.sort(sortByEffectiveDateDesc);
  return out;
}

// ======================================================
// Routes
// ======================================================

router.post("/", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;

    const tipoEgresoRaw = normalizeTipoEgreso(req.body?.tipo_egreso ?? req.body?.tipoEgreso ?? req.body?.tipo);
    const subtipoEgreso = asTrim(req.body?.subtipo_egreso ?? req.body?.subtipoEgreso ?? "precargado");
    const descripcion = asTrim(req.body?.descripcion ?? req.body?.concepto ?? req.body?.concept);

    const otrosGastos = isOtrosGastos(tipoEgresoRaw, subtipoEgreso);
    const tipoEgreso = otrosGastos ? "gasto" : tipoEgresoRaw;

    let cuentaCodigo = asTrim(
      req.body?.cuenta_codigo ??
        req.body?.cuentaCodigo ??
        req.body?.cuentaPrincipalCodigo ??
        req.body?.cuenta_principal_codigo
    );

    if (otrosGastos) cuentaCodigo = "5204";

    const subcuentaId = toObjectIdOrNull(req.body?.subcuenta_id ?? req.body?.subcuentaId);
    const montoTotal = toNum(req.body?.monto_total ?? req.body?.montoTotal, 0);

    let cantidad = toNum(req.body?.cantidad, 0);
    let precioUnitario = toNum(req.body?.precio_unitario ?? req.body?.precioUnitario, 0);
    if (otrosGastos) {
      cantidad = 1;
      precioUnitario = montoTotal;
    }

    const tipoPago = normalizeTipoPago(req.body?.tipo_pago ?? req.body?.tipoPago);
    const metodoPago = normalizeMetodoPago(req.body?.metodo_pago ?? req.body?.metodoPago);
    const montoPagado = toNum(req.body?.monto_pagado ?? req.body?.montoPagado, 0);

    const fechaVencimiento = parseInputDateSmart(
      req.body?.fecha_vencimiento ?? req.body?.fechaVencimiento,
      new Date()
    );
    const fecha = parseInputDateSmart(req.body?.fecha, new Date());

    const proveedorId = toObjectIdOrNull(req.body?.proveedor_id ?? req.body?.proveedorId);
    const proveedorNombre = asTrim(req.body?.proveedor_nombre ?? req.body?.proveedorNombre ?? req.body?.proveedor ?? "");
    const proveedorTelefono = asTrim(req.body?.proveedor_telefono ?? req.body?.proveedorTelefono ?? "");
    const proveedorEmail = asTrim(req.body?.proveedor_email ?? req.body?.proveedorEmail ?? "");
    const proveedorRfc = asTrim(req.body?.proveedor_rfc ?? req.body?.proveedorRfc ?? "");

    const productoEgresoIdRaw =
      req.body?.producto_egreso_id ?? req.body?.productoEgresoId ?? req.body?.productoId ?? req.body?.productId;
    const productoEgresoId = toObjectIdOrNull(productoEgresoIdRaw);

    const comentarios = asTrim(req.body?.comentarios ?? "");

    const isPrecargados = isPrecargadosFlow(subtipoEgreso, req.body);
    const forceProveedores2001 = wantsForceProveedores2001(req.body);

    if (!["costo", "gasto"].includes(tipoEgreso)) {
      return res.status(400).json({ ok: false, error: "VALIDATION", message: "tipo_egreso inválido (usa costo|gasto|otro)." });
    }
    if (!descripcion) {
      return res.status(400).json({ ok: false, error: "VALIDATION", message: "descripcion es requerida." });
    }
    if (!cuentaCodigo) {
      return res.status(400).json({ ok: false, error: "VALIDATION", message: "cuenta_codigo es requerida." });
    }
    if (!(montoTotal > 0)) {
      return res.status(400).json({ ok: false, error: "VALIDATION", message: "monto_total debe ser > 0." });
    }
    if (!(cantidad > 0)) {
      return res.status(400).json({ ok: false, error: "VALIDATION", message: "cantidad debe ser > 0." });
    }
    if (!(precioUnitario > 0)) {
      return res.status(400).json({ ok: false, error: "VALIDATION", message: "precio_unitario debe ser > 0." });
    }
    if (!["contado", "credito", "parcial"].includes(tipoPago)) {
      return res.status(400).json({ ok: false, error: "VALIDATION", message: "tipo_pago inválido (contado|credito|parcial)." });
    }

    if (tipoPago === "contado" || tipoPago === "parcial") {
      if (!metodoPago) {
        return res.status(400).json({
          ok: false,
          error: "VALIDATION",
          message: "metodo_pago es requerido para contado/parcial.",
        });
      }
    }

    if (tipoPago === "parcial") {
      if (!(montoPagado > 0) || !(montoPagado < montoTotal)) {
        return res.status(400).json({
          ok: false,
          error: "VALIDATION",
          message: "En parcial, monto_pagado debe ser > 0 y < monto_total.",
        });
      }
    }

    if (productoEgresoId) {
      const productDoc = await ExpenseProduct.findOne({ _id: productoEgresoId, owner }).lean();
      if (!productDoc) {
        return res.status(404).json({
          ok: false,
          error: "NOT_FOUND",
          message: "producto_egreso_id no existe o no pertenece al usuario.",
        });
      }
    }

    const fixedMontoPagado = tipoPago === "contado" ? montoTotal : tipoPago === "parcial" ? montoPagado : 0;
    const fixedMontoPendiente =
      tipoPago === "contado" ? 0 : tipoPago === "parcial" ? Math.max(0, montoTotal - fixedMontoPagado) : montoTotal;

    const numeroAsiento = genNumeroAsiento(owner);

    const txPayload = {
      owner,
      tipo: tipoEgreso,
      tipoEgreso,
      subtipoEgreso,
      descripcion,

      cuentaCodigo,
      subcuentaId,

      montoTotal,
      cantidad,
      precioUnitario,

      tipoPago,
      metodoPago: metodoPago || null,

      montoPagado: fixedMontoPagado,
      montoPendiente: fixedMontoPendiente,

      fecha,
      fechaVencimiento: tipoPago === "credito" || tipoPago === "parcial" ? fechaVencimiento || null : null,

      proveedorId,
      proveedorNombre: proveedorNombre || null,
      proveedorTelefono: proveedorTelefono || null,
      proveedorEmail: proveedorEmail || null,
      proveedorRfc: proveedorRfc || null,

      comentarios: comentarios || null,
      numeroAsiento,
    };

    const txProductField = getTxProductField();
    if (productoEgresoId) txPayload[txProductField] = productoEgresoId;

    const created = await ExpenseTransaction.create(txPayload);

    let asiento = null;
    if (JournalEntry) {
      const PROVEEDORES_2001 = process.env.CTA_CXP || "2001";
      const OTROS_ACREEDORES_2003 = process.env.CTA_OTROS_ACREEDORES || "2003";

      const cuentaPendiente =
        otrosGastos && (tipoPago === "credito" || tipoPago === "parcial") ? OTROS_ACREEDORES_2003 : PROVEEDORES_2001;

      const creditInfo = resolveCreditAccountByMetodoPago(metodoPago);

      const lines = [];
      const pushLine = ({ side, cuentaCodigo: code, monto, memo }) => {
        const m = toNum(monto, 0);
        const s = String(side || "").toLowerCase().trim();
        const isDebit = s === "debit";
        const isCredit = s === "credit";
        lines.push({
          accountCodigo: String(code || "").trim(),
          debit: isDebit ? m : 0,
          credit: isCredit ? m : 0,
          memo: memo || "",
        });
      };

      pushLine({
        side: "debit",
        cuentaCodigo,
        monto: montoTotal,
        memo: `Egreso (${subtipoEgreso || tipoEgreso}) - ${descripcion}`,
      });

      if (tipoPago === "contado") {
        pushLine({
          side: "credit",
          cuentaCodigo: creditInfo.cuentaCodigo,
          monto: montoTotal,
          memo: `Pago contado (${creditInfo.tipo})`,
        });
      } else if (tipoPago === "credito") {
        pushLine({
          side: "credit",
          cuentaCodigo: cuentaPendiente,
          monto: montoTotal,
          memo:
            cuentaPendiente === OTROS_ACREEDORES_2003
              ? `A crédito - Otros acreedores (${cuentaPendiente})`
              : `A crédito - Proveedores (${cuentaPendiente})`,
        });
      } else if (tipoPago === "parcial") {
        if (fixedMontoPagado > 0) {
          pushLine({
            side: "credit",
            cuentaCodigo: creditInfo.cuentaCodigo,
            monto: fixedMontoPagado,
            memo: `Pago parcial (${creditInfo.tipo})`,
          });
        }
        if (fixedMontoPendiente > 0) {
          pushLine({
            side: "credit",
            cuentaCodigo: cuentaPendiente,
            monto: fixedMontoPendiente,
            memo:
              cuentaPendiente === OTROS_ACREEDORES_2003
                ? `Saldo pendiente - Otros acreedores (${cuentaPendiente})`
                : `Saldo pendiente - Proveedores (${cuentaPendiente})`,
          });
        }
      }

      const conceptText = `Egreso: ${descripcion}`;

      asiento = await JournalEntry.create({
        owner,
        date: fecha,
        concept: conceptText,
        numeroAsiento,
        source: "egreso",
        sourceId: created._id,
        transaccionId: created._id,
        source_id: created._id,
        lines,
      });

      await ExpenseTransaction.updateOne({ _id: created._id, owner }, { $set: { asientoId: asiento._id } });
      created.asientoId = asiento._id;
    }

    const item = mapTxForUI(created);

    return res.status(201).json({
      ok: true,
      egreso_id: String(created._id),
      numero_asiento: numeroAsiento,

      asiento_id: asiento ? String(asiento._id) : item.asiento_id || null,
      asientoId: asiento ? String(asiento._id) : item.asiento_id || null,

      asiento: asiento
        ? {
            _id: asiento._id,
            id: String(asiento._id),
            numeroAsiento: asiento.numeroAsiento ?? asiento.numero ?? null,
            numero_asiento: asiento.numeroAsiento ?? asiento.numero ?? null,
            source: asiento.source ?? asiento.fuente ?? "egreso",
          }
        : null,

      meta: {
        isPrecargados,
        forceProveedores2001,
        otrosGastos,
        forcedCuentaCodigo: otrosGastos ? "5204" : null,
        reglaPendienteOtrosGastos: otrosGastos ? "credito/parcial => 2003" : null,
        timezoneOffsetMinutes: TZ_OFFSET_MINUTES,
      },

      data: item,
      item,
      ...item,
    });
  } catch (err) {
    console.error("POST /api/egresos/transacciones error:", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR", message: err?.message || "SERVER_ERROR" });
  }
});

router.get("/", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;
    const wrap = String(req.query.wrap || "").trim() === "1";

    const start = parseStartDate(req.query.start);
    const end = parseEndDate(req.query.end);

    const tipo = normalizeTipoEgreso(req.query.tipo);
    const estado = normalizeEstado(req.query.estado);

    const includeCancelados = String(req.query.include_cancelados ?? req.query.includeCancelados ?? "0").trim() === "1";

    const limitRaw = Number(req.query.limit ?? 200);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 500) : 200;

    const pendienteGtRaw = req.query.pendiente_gt ?? req.query.pendienteGt ?? null;
    const pendienteGt =
      pendienteGtRaw === null || pendienteGtRaw === undefined || String(pendienteGtRaw).trim() === ""
        ? null
        : toNum(pendienteGtRaw, 0);

    const filter = { owner };

    if (start || end) {
      filter.fecha = {};
      if (start) filter.fecha.$gte = start;
      if (end) filter.fecha.$lte = end;
    }

    if (tipo && ["costo", "gasto"].includes(tipo)) {
      filter.$or = [{ tipoEgreso: tipo }, { tipo: tipo }];
    }

    if (estado && ["activo", "cancelado"].includes(estado)) {
      filter.estado = estado;
    } else if (!includeCancelados) {
      filter.estado = { $ne: "cancelado" };
    }

    if (pendienteGt !== null) {
      filter.$and = [
        ...(Array.isArray(filter.$and) ? filter.$and : []),
        {
          $or: [
            { tipoPago: { $in: ["credito", "parcial"] } },
            { tipo_pago: { $in: ["credito", "parcial"] } },
          ],
        },
        {
          $or: [
            { montoPendiente: { $gt: pendienteGt } },
            { monto_pendiente: { $gt: pendienteGt } },
          ],
        },
      ];
    }

    const docs = await ExpenseTransaction.find(filter)
      .sort({ fecha: -1, createdAt: -1 })
      .limit(limit)
      .lean();

    let items = docs.map(mapTxForUI);
    items.sort(sortByEffectiveDateDesc);

    const includeCogsParam = req.query.include_cogs ?? req.query.includeCogs ?? null;

    const includeCogs =
      includeCogsParam !== null && includeCogsParam !== undefined
        ? String(includeCogsParam).trim() !== "0"
        : pendienteGt !== null
        ? false
        : true;

    if (includeCogs && JournalEntry) {
      const cogsItems = await buildCogsTxItemsFromJournal({
        owner,
        start,
        end,
        limit: 5000,
      });

      items = items.concat(cogsItems);
      items.sort(sortByEffectiveDateDesc);
      items = items.slice(0, limit);
    }

    if (!wrap) return res.json(items);

    return res.json({
      ok: true,
      data: items,
      items,
      meta: {
        limit,
        includeCogs,
        pendiente_gt: pendienteGt,
        timezoneOffsetMinutes: TZ_OFFSET_MINUTES,
      },
    });
  } catch (err) {
    console.error("GET /api/transacciones/egresos error:", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

router.get("/:id", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;
    const id = String(req.params.id || "").trim();

    const doc = await ExpenseTransaction.findOne({ _id: id, owner }).lean();
    if (!doc) return res.status(404).json({ ok: false, error: "NOT_FOUND" });

    const item = mapTxForUI(doc);
    return res.json({
      ok: true,
      data: item,
      item,
      ...item,
      meta: { timezoneOffsetMinutes: TZ_OFFSET_MINUTES },
    });
  } catch (err) {
    console.error("GET /api/egresos/transacciones/:id error:", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

module.exports = router;