// backend/routes/cuentas.js
const express = require("express");
const router = express.Router();

const ensureAuth = require("../middleware/ensureAuth");
const Account = require("../models/Account");

function toStr(v) {
  if (v === null || typeof v === "undefined") return "";
  return String(v).trim();
}

function looksLikeSubcuenta(doc) {
  const parentCode = toStr(doc.parentCode);
  if (!parentCode) return false;
  const code = toStr(doc.code);
  return /[-./]\d+$/.test(code);
}

/**
 * Catálogo base (alineado a tu enum de Account.type)
 * type: activo|pasivo|capital|ingreso|gasto|orden
 */
const DEFAULT_CHART = [
  // ACTIVOS
  { code: "1001", name: "Caja", type: "activo" },
  { code: "1002", name: "Bancos", type: "activo" },
  { code: "1101", name: "Clientes (Cuentas por Cobrar)", type: "activo" },
  { code: "1003", name: "Cuentas por Cobrar Clientes", type: "activo" },
  { code: "1003-01", name: "Clientes Nacionales", parentCode: "1003", type: "activo" },
  { code: "1004", name: "Documentos por Cobrar", type: "activo" },
  { code: "1005", name: "Inventario de Mercancías", type: "activo" },
  { code: "1006", name: "Inventario de Materias Primas", type: "activo" },
  { code: "1007", name: "IVA Acreditable", type: "activo" },
  { code: "1008", name: "Gastos Pagados por Anticipado", type: "activo" },

  // Activo no circulante
  { code: "1201", name: "Terrenos", type: "activo" },
  { code: "1202", name: "Edificios", type: "activo" },
  { code: "1203", name: "Maquinaria y Equipo", type: "activo" },
  { code: "1204", name: "Mobiliario y Equipo de Oficina", type: "activo" },
  { code: "1205", name: "Vehículos", type: "activo" },
  { code: "1206", name: "Equipo de Cómputo", type: "activo" },

  // PASIVOS
  { code: "2001", name: "Proveedores", type: "pasivo" },
  { code: "2002", name: "Documentos por Pagar", type: "pasivo" },
  { code: "2003", name: "Acreedores Diversos", type: "pasivo" },
  { code: "2004", name: "IVA por Pagar", type: "pasivo" },
  { code: "2005", name: "Impuestos por Pagar", type: "pasivo" },
  { code: "2006", name: "Sueldos por Pagar", type: "pasivo" },
  { code: "2007", name: "Préstamos Bancarios Corto Plazo", type: "pasivo" },

  { code: "2101", name: "Préstamos Bancarios Largo Plazo", type: "pasivo" },
  { code: "2102", name: "Hipotecas por Pagar", type: "pasivo" },
  { code: "2103", name: "Documentos por Pagar Largo Plazo", type: "pasivo" },

  // CAPITAL
  { code: "3001", name: "Capital Social", type: "capital" },
  { code: "3002", name: "Aportaciones para Futuros Aumentos", type: "capital" },
  { code: "3003", name: "Prima en Venta de Acciones", type: "capital" },
  { code: "3101", name: "Reserva Legal", type: "capital" },
  { code: "3102", name: "Utilidades Retenidas", type: "capital" },

  // INGRESOS
  { code: "4001", name: "Ventas", type: "ingreso" },
  { code: "4001-01", name: "Ventas Subcuenta 1", parentCode: "4001", type: "ingreso" },
  { code: "4001-02", name: "Ventas Subcuenta 2", parentCode: "4001", type: "ingreso" },
  { code: "4001-03", name: "Ventas Subcuenta 3", parentCode: "4001", type: "ingreso" },
  { code: "4001-04", name: "Ventas Subcuenta 4", parentCode: "4001", type: "ingreso" },

  { code: "4002", name: "Devoluciones sobre Ventas", type: "ingreso" },
  { code: "4003", name: "Descuentos sobre Ventas", type: "ingreso" },
  { code: "4101", name: "Productos Financieros", type: "ingreso" },

  // GASTOS (incluye impuestos por tu enum)
  { code: "5001", name: "Costo de Ventas", type: "gasto" },
  { code: "5101", name: "Gastos de Operación", type: "gasto" },
  { code: "5202", name: "Comisiones Bancarias", type: "gasto" },
  { code: "5301", name: "Depreciaciones y Amortizaciones", type: "gasto" },
  { code: "5401", name: "Gastos Financieros", type: "gasto" },

  { code: "6001", name: "Impuesto sobre la Renta", type: "gasto" },
  { code: "6002", name: "PTU", type: "gasto" },
  { code: "7001", name: "Impuestos (Legacy)", type: "gasto" },
];

function inferClasificacion(code, type) {
  const c = String(code || "");
  const t = String(type || "").toLowerCase();

  const estado_financiero = ["activo", "pasivo", "capital"].includes(t)
    ? "Balance General"
    : "Estado de Resultados";

  let grupo = "General";
  if (t === "activo") grupo = "Activos";
  else if (t === "pasivo") grupo = "Pasivos";
  else if (t === "capital") grupo = "Capital Contable";
  else if (t === "ingreso") grupo = "Ingresos";
  else if (t === "gasto") grupo = "Egresos";

  // Subgrupo por prefijos (simple, suficiente para UI)
  let subgrupo = "General";
  if (grupo === "Activos") {
    if (c.startsWith("11") || c.startsWith("10")) subgrupo = "Activo Circulante";
    else if (c.startsWith("12")) subgrupo = "Activo No Circulante";
    else if (c.startsWith("13")) subgrupo = "Activo Diferido";
  } else if (grupo === "Pasivos") {
    if (c.startsWith("20")) subgrupo = "Pasivo Corto Plazo";
    else if (c.startsWith("21")) subgrupo = "Pasivo Largo Plazo";
  } else if (grupo === "Capital Contable") {
    subgrupo = "Capital Contribuido";
  } else if (grupo === "Ingresos") {
    subgrupo = c.startsWith("41") ? "Otros Ingresos" : "Ingresos por Ventas";
  } else if (grupo === "Egresos") {
    if (c.startsWith("50")) subgrupo = "Costo de Ventas";
    else if (c.startsWith("51")) subgrupo = "Gastos de Operación";
    else if (c.startsWith("54")) subgrupo = "Gastos Financieros";
    else if (c.startsWith("60") || c.startsWith("70")) {
      grupo = "Impuestos";
      subgrupo = "Provisiones";
    }
  }

  return { estado_financiero, grupo, subgrupo };
}

function normalizeAccountOut(doc) {
  const code = toStr(doc.code);
  const name = toStr(doc.name);
  const type = toStr(doc.type);

  const { estado_financiero, grupo, subgrupo } = inferClasificacion(code, type);

  // ✅ devolvemos alias para tu UI (codigo/nombre) + fields reales (code/name)
  return {
    id: doc._id,
    _id: doc._id,

    codigo: code,
    nombre: name,
    code,
    name,

    type: type || null,
    category: doc.category ?? "general",
    parentCode: doc.parentCode ?? null,

    isActive: typeof doc.isActive === "boolean" ? doc.isActive : true,
    isDefault: typeof doc.isDefault === "boolean" ? doc.isDefault : false,

    estado_financiero,
    grupo,
    subgrupo,

    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

async function ensureDefaultChart(owner, { minCount = 25 } = {}) {
  const before = await Account.countDocuments({ owner });
  if (before >= minCount) {
    return { attempted: false, seeded: false, before, after: before };
  }

  const ops = DEFAULT_CHART.map((a) => ({
    updateOne: {
      filter: { owner, code: toStr(a.code) },
      update: {
        $setOnInsert: {
          owner,
          code: toStr(a.code),
          name: toStr(a.name),
          type: toStr(a.type),
          category: toStr(a.category || "general"),
          parentCode: a.parentCode ? toStr(a.parentCode) : null,
          isDefault: true,
          isActive: true,
        },
      },
      upsert: true,
    },
  }));

  let bulk = { ok: true, errorCode: null, message: null };
  try {
    await Account.bulkWrite(ops, { ordered: false });
  } catch (e) {
    bulk.ok = false;
    bulk.errorCode = e?.code ?? null;
    bulk.message = e?.message ? String(e.message).slice(0, 400) : "bulkWrite error";
  }

  const after = await Account.countDocuments({ owner });
  return { attempted: true, seeded: after > before, before, after, bulk };
}

/**
 * ✅ RUTA FIRMA (para confirmar que estás pegándole al router correcto)
 */
router.get("/__sig", (req, res) => {
  return res.json({ ok: true, sig: "cuentas-router-v2026-01-05", time: new Date().toISOString() });
});

router.get(["/", "/cuentas"], ensureAuth, async (req, res) => {
  res.set("x-bukipin-cuentas", "v2026-01-05-aligned");
  res.set("cache-control", "no-store");

  try {
    const owner = req.user._id;

    const ensureDefaults = String(req.query.ensureDefaults ?? "true") === "true";
    let seedInfo = null;
    if (ensureDefaults) {
      seedInfo = await ensureDefaultChart(owner, { minCount: 25 });
    }

    const q = { owner };
    if (typeof req.query.active !== "undefined") {
      q.isActive = String(req.query.active) === "true";
    }

    const includeSubcuentas = String(req.query.includeSubcuentas || "false") === "true";
    const onlySubcuentas = String(req.query.onlySubcuentas || "false") === "true";

    const items = await Account.find(q).sort({ code: 1 }).lean();

    let filtered = items;
    if (onlySubcuentas) filtered = items.filter(looksLikeSubcuenta);
    else if (!includeSubcuentas) filtered = items.filter((x) => !looksLikeSubcuenta(x));

    return res.json({
      ok: true,
      meta: {
        ensureDefaults,
        seedInfo,
        includeSubcuentas,
        onlySubcuentas,
        totalAll: items.length,
        totalReturned: filtered.length,
      },
      data: filtered.map(normalizeAccountOut),
    });
  } catch (err) {
    console.error("GET /api/cuentas error:", err);
    return res.status(500).json({ ok: false, message: "Error cargando cuentas" });
  }
});

module.exports = router;
