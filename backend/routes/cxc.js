// backend/routes/cxc.js
const express = require("express");
const router = express.Router();

const mongoose = require("mongoose");
const ensureAuth = require("../middleware/ensureAuth");

const IncomeTransaction = require("../models/IncomeTransaction");
const JournalEntry = require("../models/JournalEntry");
const Account = require("../models/Account");

const {
  TZ_OFFSET_MINUTES,
  num: dtNum,
  asTrim,
  asValidDate,
  toYMDLocal,
  parseInputDateSmart,
  parseStartDate,
  parseEndDate,
  fixMidnightUtcWithCreatedAt,
  pickEffectiveDate,
} = require("../utils/datetime");

// Client opcional
let Client = null;
try {
  Client = require("../models/Client");
} catch (_) {}

// Counter opcional
let Counter = null;
try {
  Counter = require("../models/Counter");
} catch (_) {}

// =========================
// Helpers
// =========================

function num(v, def = 0) {
  return dtNum(v, def);
}

function lower(v) {
  return String(v ?? "").trim().toLowerCase();
}

function isObjectId(v) {
  return !!v && mongoose.Types.ObjectId.isValid(String(v));
}

function pickJournalEntryLines(entry) {
  if (Array.isArray(entry?.lines)) return entry.lines;
  if (Array.isArray(entry?.detalle_asientos)) return entry.detalle_asientos;
  if (Array.isArray(entry?.detalles_asiento)) return entry.detalles_asiento;
  if (Array.isArray(entry?.detalles)) return entry.detalles;
  return [];
}

function lineCode(line) {
  return String(
    line?.accountCodigo ??
      line?.accountCode ??
      line?.account_codigo ??
      line?.cuentaCodigo ??
      line?.cuenta_codigo ??
      line?.codigo ??
      line?.account?.codigo ??
      line?.cuentas?.codigo ??
      ""
  ).trim();
}

function lineName(line) {
  return String(
    line?.accountNombre ??
      line?.accountName ??
      line?.account_nombre ??
      line?.cuentaNombre ??
      line?.cuenta_nombre ??
      line?.nombre ??
      line?.account?.nombre ??
      line?.account?.name ??
      ""
  ).trim();
}

function lineDebit(line) {
  return num(line?.debit ?? line?.debe ?? line?.debitAmount ?? line?.debit_amount, 0);
}

function lineCredit(line) {
  return num(line?.credit ?? line?.haber ?? line?.creditAmount ?? line?.credit_amount, 0);
}

function normalizeMetodoPago(raw) {
  const v = lower(raw);
  if (["tarjeta", "transferencia", "spei", "banco", "bancos"].includes(v)) return "bancos";
  if (["efectivo", "cash", "caja"].includes(v)) return "efectivo";
  if (!v) return "efectivo";
  return v;
}

function parseOrder(order) {
  const o = String(order || "").trim().toLowerCase();
  if (!o) return { createdAt: -1 };
  if (o === "created_at_desc") return { createdAt: -1 };
  if (o === "created_at_asc") return { createdAt: 1 };
  if (o === "fecha_desc") return { fecha: -1, createdAt: -1 };
  if (o === "fecha_asc") return { fecha: 1, createdAt: 1 };
  return { createdAt: -1 };
}

function getLocalBusinessYear(dateObj = new Date()) {
  const ymd = toYMDLocal(dateObj);
  const year = Number(String(ymd || "").slice(0, 4));
  return Number.isFinite(year) ? year : new Date().getUTCFullYear();
}

function getTxEffectiveDate(tx) {
  const fixedFecha = fixMidnightUtcWithCreatedAt(
    tx?.fecha ??
      tx?.date ??
      tx?.entryDate ??
      tx?.createdAt ??
      tx?.created_at ??
      null,
    tx?.createdAt ?? tx?.created_at ?? null
  );

  if (fixedFecha) return fixedFecha;
  return pickEffectiveDate(tx);
}

function getDueDate(tx) {
  return (
    asValidDate(tx?.fechaLimite) ||
    asValidDate(tx?.fecha_limite) ||
    asValidDate(tx?.fecha_vencimiento) ||
    asValidDate(tx?.fechaVencimiento) ||
    null
  );
}

function inLocalRangeByEffectiveDate(doc, start, end) {
  const d = getTxEffectiveDate(doc) || pickEffectiveDate(doc);
  if (!d) return false;
  if (start && d.getTime() < start.getTime()) return false;
  if (end && d.getTime() > end.getTime()) return false;
  return true;
}

async function nextJournalNumber(owner, dateObj) {
  const businessYear = getLocalBusinessYear(dateObj || new Date());

  if (!Counter) {
    return `${businessYear}-0000`;
  }

  const key = `journal-${businessYear}`;
  const doc = await Counter.findOneAndUpdate(
    { owner, key },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  ).lean();

  const seq = doc?.seq || 1;
  return `${businessYear}-${String(seq).padStart(4, "0")}`;
}

async function buildLine(owner, { code, debit = 0, credit = 0, memo = "" }) {
  const c = String(code ?? "").trim();
  if (!c) {
    const err = new Error("buildLine requiere code/codigo válido.");
    err.statusCode = 400;
    throw err;
  }

  const base = {
    debit: num(debit, 0),
    credit: num(credit, 0),
    memo: memo || "",
    accountCodigo: c,
    accountCode: c,
    cuenta_codigo: c,
    cuentaCodigo: c,
  };

  const acc = await Account.findOne({
    owner,
    $or: [{ code: c }, { codigo: c }],
  })
    .select("_id code codigo name nombre")
    .lean();

  if (acc?._id) {
    const id = acc._id;
    return { ...base, accountId: id, cuenta_id: id, account: id };
  }

  return base;
}

async function buildAccountMaps(owner, entries) {
  const codes = new Set();
  const ids = new Set();

  for (const e of entries || []) {
    const lines = pickJournalEntryLines(e);
    for (const l of lines) {
      const c = lineCode(l);
      if (c) codes.add(c);

      const aid = l?.accountId ?? l?.cuenta_id ?? l?.account ?? null;
      if (aid && mongoose.Types.ObjectId.isValid(String(aid))) ids.add(String(aid));
    }
  }

  if (!codes.size && !ids.size) return { nameByCode: {}, codeById: {}, nameById: {} };

  const or = [];
  if (codes.size) {
    or.push({ code: { $in: [...codes] } });
    or.push({ codigo: { $in: [...codes] } });
  }
  if (ids.size) {
    or.push({ _id: { $in: [...ids].map((x) => new mongoose.Types.ObjectId(x)) } });
  }

  const rows = await Account.find({ owner, $or: or })
    .select("_id code codigo name nombre")
    .lean();

  const nameByCode = {};
  const codeById = {};
  const nameById = {};

  for (const r of rows || []) {
    const id = String(r._id);
    const code = String(r.code ?? r.codigo ?? "").trim();
    const name = r.name ?? r.nombre ?? "";

    if (id) {
      nameById[id] = name;
      if (code) codeById[id] = code;
    }
    if (code) nameByCode[code] = name;
  }

  return { nameByCode, codeById, nameById };
}

function mapEntryForUI(entry, accountMaps = {}) {
  const nameByCode = accountMaps?.nameByCode || {};
  const codeById = accountMaps?.codeById || {};
  const nameById = accountMaps?.nameById || {};

  const rawLines = pickJournalEntryLines(entry);

  const detalle_asientos = rawLines.map((l) => {
    let cuenta_codigo = lineCode(l);

    if (!cuenta_codigo) {
      const aid = l?.accountId ?? l?.cuenta_id ?? l?.account ?? null;
      if (aid) {
        const sid = String(aid);
        if (codeById[sid]) cuenta_codigo = String(codeById[sid]).trim();
      }
    }

    const aid2 = l?.accountId ?? l?.cuenta_id ?? l?.account ?? null;
    const sid2 = aid2 ? String(aid2) : null;

    const cuenta_nombre =
      (cuenta_codigo ? (nameByCode[cuenta_codigo] || null) : null) ||
      (sid2 ? (nameById[sid2] || null) : null) ||
      lineName(l) ||
      null;

    const memo = l?.memo ?? l?.descripcion ?? l?.concepto ?? "";

    return {
      cuenta_codigo: cuenta_codigo || null,
      cuenta_nombre,
      debe: lineDebit(l),
      haber: lineCredit(l),
      memo,
      descripcion: memo,
    };
  });

  const detalles = detalle_asientos.map((d) => ({
    cuenta_codigo: d.cuenta_codigo,
    cuenta_nombre: d.cuenta_nombre,
    descripcion: d.descripcion || d.memo || "",
    debe: d.debe,
    haber: d.haber,
  }));

  const concepto = entry?.concept ?? entry?.concepto ?? entry?.descripcion ?? "";
  const numeroAsiento =
    entry?.numeroAsiento ?? entry?.numero_asiento ?? entry?.numero ?? entry?.folio ?? null;

  const fecha = pickEffectiveDate(entry);

  return {
    id: String(entry?._id || ""),
    _id: entry?._id,

    numeroAsiento,
    numero_asiento: numeroAsiento,

    asiento_fecha: fecha ? toYMDLocal(fecha) : null,
    fecha,

    descripcion: concepto,
    concepto,

    source: entry?.source ?? "",
    sourceId: entry?.sourceId
      ? String(entry.sourceId)
      : entry?.transaccionId
        ? String(entry.transaccionId)
        : null,

    detalle_asientos,
    detalles,

    created_at: entry?.createdAt ?? null,
    updated_at: entry?.updatedAt ?? null,
  };
}

function computeMontosTx(tx) {
  const total = num(tx?.montoTotal ?? tx?.monto_total ?? tx?.total, 0);
  const descuento = num(tx?.montoDescuento ?? tx?.monto_descuento ?? tx?.descuento, 0);
  const neto = num(
    tx?.montoNeto ?? tx?.monto_neto ?? tx?.neto,
    Math.max(0, total - Math.max(0, descuento))
  );
  const pagado = num(tx?.montoPagado ?? tx?.monto_pagado ?? tx?.pagado, 0);
  const pendienteSaved = num(
    tx?.saldoPendiente ?? tx?.saldo_pendiente ?? tx?.monto_pendiente,
    NaN
  );
  const pendiente = Number.isFinite(pendienteSaved)
    ? pendienteSaved
    : Math.max(0, Number((neto - pagado).toFixed(2)));

  return { total, descuento, neto, pagado, pendiente };
}

function mapTxForUI(tx) {
  const montos = computeMontosTx(tx);

  const cuentaCodigo =
    tx?.cuentaCodigo ??
    tx?.cuenta_codigo ??
    tx?.cuentaPrincipalCodigo ??
    tx?.cuenta_principal_codigo ??
    null;

  const subcuentaId = tx?.subcuentaId ?? tx?.subcuenta_id ?? null;

  const fechaFinal =
    getTxEffectiveDate(tx) ||
    asValidDate(tx?.fecha) ||
    asValidDate(tx?.createdAt) ||
    null;

  const fechaLimiteFinal = getDueDate(tx);

  return {
    ...tx,
    id: tx?._id ? String(tx._id) : tx?.id,

    fecha: fechaFinal,
    fecha_fixed: fechaFinal ? fechaFinal.toISOString() : null,
    fecha_ymd: fechaFinal ? toYMDLocal(fechaFinal) : null,

    fechaLimite: fechaLimiteFinal ? fechaLimiteFinal.toISOString() : null,
    fecha_limite: fechaLimiteFinal ? fechaLimiteFinal.toISOString() : null,
    fecha_vencimiento: fechaLimiteFinal ? toYMDLocal(fechaLimiteFinal) : null,
    fechaVencimiento: fechaLimiteFinal ? toYMDLocal(fechaLimiteFinal) : null,

    montoTotal: montos.total,
    montoDescuento: montos.descuento,
    montoNeto: montos.neto,
    montoPagado: montos.pagado,
    saldoPendiente: montos.pendiente,

    monto_total: montos.total,
    monto_descuento: montos.descuento,
    monto_neto: montos.neto,
    monto_pagado: montos.pagado,
    saldo_pendiente: montos.pendiente,
    monto_pendiente: montos.pendiente,
    pendiente: montos.pendiente,

    cuentaCodigo: cuentaCodigo ?? null,
    cuenta_codigo: cuentaCodigo ?? null,

    subcuentaId: subcuentaId ? String(subcuentaId) : null,
    subcuenta_id: subcuentaId ? String(subcuentaId) : null,

    clienteId: tx?.clienteId ?? tx?.clientId ?? tx?.cliente_id ?? tx?.client_id ?? null,
    cliente_id: tx?.cliente_id ?? tx?.clienteId ?? tx?.clientId ?? tx?.client_id ?? null,

    cliente_nombre: tx?.cliente_nombre ?? tx?.clienteNombre ?? tx?.cliente_name ?? null,

    metodoPago: tx?.metodoPago ?? tx?.metodo_pago ?? null,
    tipoPago: tx?.tipoPago ?? tx?.tipo_pago ?? null,

    metodo_pago: tx?.metodoPago ?? tx?.metodo_pago ?? null,
    tipo_pago: tx?.tipoPago ?? tx?.tipo_pago ?? null,

    tipo_ingreso: tx?.tipoIngreso ?? tx?.tipo_ingreso ?? null,
    tipoIngreso: tx?.tipoIngreso ?? tx?.tipo_ingreso ?? null,
    cuenta_principal_codigo: cuentaCodigo ?? null,
  };
}

// =========================
// Handlers compartidos
// =========================

async function handleListIngresos(req, res) {
  try {
    const owner = req.user._id;
    const limit = Math.min(5000, Number(req.query.limit || 2000));
    const order = parseOrder(req.query.order);

    const pendientes =
      String(req.query.pendientes ?? "").toLowerCase() === "1" ||
      String(req.query.pendientes ?? "").toLowerCase() === "true";

    const query = { owner };

    if (pendientes) {
      query.$or = [
        { saldoPendiente: { $gt: 0 } },
        { saldo_pendiente: { $gt: 0 } },
        { monto_pendiente: { $gt: 0 } },
      ];
    }

    const rows = await IncomeTransaction.find(query).sort(order).limit(limit).lean();
    let items = (rows || []).map(mapTxForUI);

    if (Client) {
      const ids = [
        ...new Set(
          items
            .map((x) => x.clienteId || x.cliente_id)
            .filter(isObjectId)
            .map(String)
        ),
      ];

      if (ids.length) {
        const clients = await Client.find({
          owner,
          _id: { $in: ids.map((x) => new mongoose.Types.ObjectId(x)) },
        })
          .select("_id nombre name razonSocial razon_social")
          .lean();

        const nameById = {};
        for (const c of clients || []) {
          const id = String(c._id);
          const n = c.nombre ?? c.name ?? c.razonSocial ?? c.razon_social ?? null;
          if (id && n) nameById[id] = n;
        }

        items = items.map((it) => {
          const cid = String(it.clienteId || it.cliente_id || "");
          if (!it.cliente_nombre && cid && nameById[cid]) {
            return { ...it, cliente_nombre: nameById[cid] };
          }
          return it;
        });
      }
    }

    return res.json({
      ok: true,
      data: items,
      items,
      meta: {
        timezoneOffsetMinutes: TZ_OFFSET_MINUTES,
      },
    });
  } catch (err) {
    console.error("GET /api/cxc/ingresos error:", err);
    return res.status(500).json({ ok: false, message: "Error cargando CxC (ingresos)" });
  }
}

async function handleGetIngresoById(req, res) {
  try {
    const owner = req.user._id;
    const { id } = req.params;

    if (!isObjectId(id)) {
      return res.status(400).json({ ok: false, message: "ID inválido." });
    }

    const row = await IncomeTransaction.findOne({
      owner,
      _id: new mongoose.Types.ObjectId(String(id)),
    }).lean();

    if (!row) {
      return res.status(404).json({ ok: false, message: "Ingreso no encontrado." });
    }

    let item = mapTxForUI(row);

    if (Client) {
      const cid = item.clienteId || item.cliente_id;
      if (cid && isObjectId(cid) && !item.cliente_nombre) {
        const c = await Client.findOne({
          owner,
          _id: new mongoose.Types.ObjectId(String(cid)),
        })
          .select("_id nombre name razonSocial razon_social")
          .lean();

        const n = c?.nombre ?? c?.name ?? c?.razonSocial ?? c?.razon_social ?? null;
        if (n) item = { ...item, cliente_nombre: n };
      }
    }

    return res.json({
      ok: true,
      data: item,
      item,
      meta: {
        timezoneOffsetMinutes: TZ_OFFSET_MINUTES,
      },
    });
  } catch (err) {
    console.error("GET /api/cxc/ingresos/:id error:", err);
    return res.status(500).json({ ok: false, message: "Error cargando el detalle del ingreso" });
  }
}

// =========================
// Registrar pago
// =========================

async function handleRegistrarPago(req, res) {
  let session = null;

  try {
    const owner = req.user._id;

    const ingresoIdRaw =
      req.body?.ingresoId ??
      req.body?.ingreso_id ??
      req.body?.cuentaId ??
      req.body?.cuenta_id ??
      req.body?.transaccion_id ??
      req.body?.transaccionId ??
      req.body?.referencia_id ??
      req.body?.referenciaId ??
      req.body?.id ??
      null;

    if (!ingresoIdRaw || !isObjectId(ingresoIdRaw)) {
      return res.status(400).json({ ok: false, message: "ingresoId/referencia_id inválido." });
    }

    const monto = num(req.body?.monto ?? req.body?.amount, 0);
    if (!(monto > 0)) {
      return res.status(400).json({ ok: false, message: "monto debe ser > 0." });
    }

    const metodoPago = normalizeMetodoPago(req.body?.metodoPago ?? req.body?.metodo_pago);
    if (!["efectivo", "bancos"].includes(metodoPago)) {
      return res
        .status(400)
        .json({ ok: false, message: "metodoPago inválido (efectivo|bancos)." });
    }

    const fecha = parseInputDateSmart(req.body?.fecha, new Date());
    const nota = asTrim(req.body?.nota ?? req.body?.concepto ?? req.body?.descripcion ?? "", "");
    const tipoRegistro = lower(
      req.body?.tipoRegistro ?? req.body?.referencia_tipo ?? req.body?.tipo ?? "ingreso"
    );

    const COD_CAJA = "1001";
    const COD_BANCOS = "1002";
    const COD_CXC_CLIENTES = "1003";
    const COD_DEUDORES = "1009";

    const codCobro = metodoPago === "bancos" ? COD_BANCOS : COD_CAJA;

    try {
      session = await mongoose.startSession();
      session.startTransaction();
    } catch (_) {
      session = null;
    }

    const tx = await IncomeTransaction.findOne({
      owner,
      _id: new mongoose.Types.ObjectId(String(ingresoIdRaw)),
    }).session(session || undefined);

    if (!tx) {
      if (session) await session.abortTransaction().catch(() => {});
      return res.status(404).json({ ok: false, message: "Ingreso no encontrado." });
    }

    const montos = computeMontosTx(tx);
    const pendiente = num(montos.pendiente, 0);

    if (!(pendiente > 0)) {
      if (session) await session.abortTransaction().catch(() => {});
      return res
        .status(400)
        .json({ ok: false, message: "Este ingreso no tiene saldo pendiente." });
    }

    if (monto > pendiente) {
      if (session) await session.abortTransaction().catch(() => {});
      return res.status(400).json({
        ok: false,
        message: `El monto del cobro (${monto}) no puede ser mayor al saldo pendiente (${pendiente}).`,
      });
    }

    const neto = num(montos.neto, 0);
    const pagadoPrev = num(tx.montoPagado ?? tx.monto_pagado, 0);
    const pagadoNew = Number((pagadoPrev + monto).toFixed(2));
    const saldoNew = Math.max(0, Number((neto - pagadoNew).toFixed(2)));

    tx.montoPagado = pagadoNew;
    tx.monto_pagado = pagadoNew;

    tx.saldoPendiente = saldoNew;
    tx.saldo_pendiente = saldoNew;
    tx.montoPendiente = saldoNew;
    tx.monto_pendiente = saldoNew;

    if (saldoNew <= 0) {
      tx.tipoPago = "contado";
      tx.tipo_pago = "contado";
    } else {
      tx.tipoPago = "parcial";
      tx.tipo_pago = "parcial";
    }

    tx.metodoPago = metodoPago;
    tx.metodo_pago = metodoPago;

    await tx.save({ session: session || undefined });

    let codCxC = COD_CXC_CLIENTES;

    const tipoIng = lower(tx.tipoIngreso ?? tx.tipo_ingreso);
    const cuentaPrincipal = String(
      tx.cuentaPrincipalCodigo ??
        tx.cuenta_principal_codigo ??
        tx.cuentaCodigo ??
        tx.cuenta_codigo ??
        ""
    ).trim();

    const is1009 =
      tipoRegistro === "venta_activo"
        ? false
        : tipoIng === "otros" || cuentaPrincipal === "4102";

    if (is1009) codCxC = COD_DEUDORES;

    const lines = [
      await buildLine(owner, {
        code: codCobro,
        debit: monto,
        credit: 0,
        memo: nota || "Cobro de cliente",
      }),
      await buildLine(owner, {
        code: codCxC,
        debit: 0,
        credit: monto,
        memo: nota || "Aplicación a Cuentas por Cobrar",
      }),
    ];

    const numeroAsiento = await nextJournalNumber(owner, fecha);

    const created = await JournalEntry.create(
      [
        {
          owner,
          date: fecha,
          concept: `Cobro CxC: ${tx.descripcion || "Ingreso"}`,
          source: "cobro_cxc",
          sourceId: tx._id,
          transaccionId: tx._id,
          source_id: tx._id,

          lines,
          detalle_asientos: lines,
          detalles_asiento: lines,

          numeroAsiento,
          numero_asiento: numeroAsiento,
        },
      ],
      session ? { session } : undefined
    );

    const entryDoc = Array.isArray(created) ? created[0] : created;

    try {
      tx.asientoCobroId = tx.asientoCobroId ?? entryDoc._id;
      tx.asiento_cobro_id = tx.asiento_cobro_id ?? entryDoc._id;
      tx.ultimoCobroNumeroAsiento = tx.ultimoCobroNumeroAsiento ?? numeroAsiento;
      await tx.save({ session: session || undefined }).catch(() => {});
    } catch (_) {}

    if (session) {
      await session.commitTransaction().catch(() => {});
      await session.endSession().catch(() => {});
      session = null;
    }

    const entryPlain = entryDoc?.toObject ? entryDoc.toObject() : entryDoc;
    const accountMaps = await buildAccountMaps(owner, [entryPlain]);
    const asiento = mapEntryForUI(entryPlain, accountMaps);

    const txUI = mapTxForUI(tx?.toObject ? tx.toObject() : tx);

    return res.status(201).json({
      ok: true,
      data: {
        transaction: txUI,
        asiento,
        numeroAsiento,
        cobro: {
          referencia_id: String(tx._id),
          ingresoId: String(tx._id),
          tipo: "cobro",
          monto,
          metodoPago,
          fecha,
          nota: nota || "",
          cuenta_abonada: codCxC,
        },
        meta: {
          timezoneOffsetMinutes: TZ_OFFSET_MINUTES,
        },
      },
      transaction: txUI,
      asiento,
      numeroAsiento,
    });
  } catch (err) {
    try {
      if (session) {
        await session.abortTransaction().catch(() => {});
        await session.endSession().catch(() => {});
      }
    } catch (_) {}

    console.error("POST /api/cxc/registrar-pago error:", err);
    const status = err?.statusCode || 500;
    return res
      .status(status)
      .json({ ok: false, message: err?.message || "Error registrando cobro" });
  }
}

// =========================
// Endpoints
// =========================

router.get("/ingresos", ensureAuth, handleListIngresos);
router.get("/ingresos/:id", ensureAuth, handleGetIngresoById);
router.get("/detalle", ensureAuth, handleListIngresos);
router.get("/ventas-activos", ensureAuth, async (req, res) =>
  res.json({ ok: true, data: [], items: [] })
);

router.get("/asientos", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;

    const cuentaCodigo = String(req.query.cuenta_codigo || "").trim();
    if (!cuentaCodigo) {
      return res.status(400).json({ ok: false, message: "Falta cuenta_codigo" });
    }

    const start = req.query.start ? parseStartDate(req.query.start) : null;
    const end = req.query.end ? parseEndDate(req.query.end) : null;

    if (req.query.start && !start) {
      return res.status(400).json({ ok: false, message: "start inválido" });
    }
    if (req.query.end && !end) {
      return res.status(400).json({ ok: false, message: "end inválido" });
    }

    const entries = await JournalEntry.find({ owner }).sort({ createdAt: 1 }).lean();

    const out = [];
    for (const e of entries || []) {
      const fecha = pickEffectiveDate(e);
      if (!fecha) continue;

      if (start && fecha.getTime() < start.getTime()) continue;
      if (end && fecha.getTime() > end.getTime()) continue;

      const lines = pickJournalEntryLines(e);
      if (!lines.length) continue;

      let debe = 0;
      let haber = 0;

      for (const ln of lines) {
        const code = lineCode(ln);
        if (code !== cuentaCodigo) continue;

        debe += lineDebit(ln);
        haber += lineCredit(ln);
      }

      if (debe === 0 && haber === 0) continue;

      out.push({
        fecha: fecha.toISOString(),
        fecha_ymd: toYMDLocal(fecha),
        debe,
        haber,
      });
    }

    return res.json({
      ok: true,
      data: out,
      items: out,
      meta: {
        timezoneOffsetMinutes: TZ_OFFSET_MINUTES,
      },
    });
  } catch (err) {
    console.error("GET /api/cxc/asientos error:", err);
    return res.status(500).json({ ok: false, message: "Error cargando asientos CxC" });
  }
});

router.post("/registrar-pago", ensureAuth, handleRegistrarPago);
router.post("/cuentas-por-cobrar/registrar-pago", ensureAuth, handleRegistrarPago);

module.exports = router;