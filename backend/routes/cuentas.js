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
 *
 * NOTA:
 * - Depreciaciones/Amortización acumulada son "contra-activos", pero en tu enum
 *   no existe ese tipo, así que las dejamos como "activo" (para agrupar en Balance General).
 */
const DEFAULT_CHART = [
  // =======================
  // ACTIVOS (Circulante)
  // =======================
  { code: "1001", name: "Caja", type: "activo" },
  { code: "1002", name: "Bancos", type: "activo" },

  // En tus flujos legacy ya usas 1101 como Clientes, lo mantenemos.
  { code: "1101", name: "Clientes", type: "activo" },

  { code: "1003", name: "Cuentas por Cobrar Clientes", type: "activo" },

  { code: "1004", name: "Documentos por Cobrar", type: "activo" },
  { code: "1005", name: "Inventario de Mercancías", type: "activo" },
  { code: "1006", name: "Inventario de Materias Primas", type: "activo" },
  { code: "1007", name: "IVA Acreditable", type: "activo" },
  { code: "1008", name: "Gastos Pagados por Anticipado", type: "activo" },

  // =======================
  // ACTIVOS (No circulante)
  // =======================
  { code: "1201", name: "Terrenos", type: "activo" },
  { code: "1202", name: "Edificios", type: "activo" },
  { code: "1203", name: "Maquinaria y Equipo", type: "activo" },
  { code: "1204", name: "Mobiliario y Equipo de Oficina", type: "activo" },
  { code: "1205", name: "Vehículos", type: "activo" },
  { code: "1206", name: "Equipo de Cómputo", type: "activo" },

  // Depreciaciones acumuladas
  { code: "1207", name: "Depreciación Acumulada Edificios", type: "activo" },
  { code: "1208", name: "Depreciación Acumulada Maquinaria", type: "activo" },
  { code: "1209", name: "Depreciación Acumulada Mobiliario", type: "activo" },
  { code: "1210", name: "Depreciación Acumulada Vehículos", type: "activo" },
  { code: "1211", name: "Depreciación Acumulada Equipo Cómputo", type: "activo" },
  { code: "1212", name: "Otros Activos Fijos", type: "activo" },
  { code: "1213", name: "Depreciación Acumulada Otros Activos", type: "activo" },

  // =======================
  // ACTIVO DIFERIDO
  // =======================
  { code: "1301", name: "Gastos de Instalación", type: "activo" },
  { code: "1302", name: "Gastos de Organización", type: "activo" },
  { code: "1303", name: "Marcas y Patentes", type: "activo" },
  { code: "1304", name: "Amortización Acumulada", type: "activo" },

  // =======================
  // PASIVO (Circulante)
  // =======================
  { code: "2001", name: "Proveedores", type: "pasivo" },
  { code: "2002", name: "Documentos por Pagar", type: "pasivo" },
  { code: "2003", name: "Acreedores Diversos", type: "pasivo" },
  { code: "2004", name: "IVA por Pagar", type: "pasivo" },
  { code: "2005", name: "Impuestos por Pagar", type: "pasivo" },
  { code: "2006", name: "Sueldos por Pagar", type: "pasivo" },
  { code: "2007", name: "Préstamos Bancarios Corto Plazo", type: "pasivo" },

  // =======================
  // PASIVO (No Circulante)
  // =======================
  { code: "2101", name: "Préstamos Bancarios Largo Plazo", type: "pasivo" },
  { code: "2102", name: "Hipotecas por Pagar", type: "pasivo" },
  { code: "2103", name: "Documentos por Pagar Largo Plazo", type: "pasivo" },

  // =======================
  // CAPITAL CONTABLE (Capital Contribuido)
  // =======================
  { code: "3001", name: "Capital Social", type: "capital" },
  { code: "3002", name: "Aportaciones para Futuros Aumentos", type: "capital" },
  { code: "3003", name: "Prima en Venta de Acciones", type: "capital" },

  // =======================
  // CAPITAL CONTABLE (Capital Ganado)
  // =======================

  { code: "3101", name: "Reserva Legal", type: "capital" },
  { code: "3102", name: "Utilidades Retenidas", type: "capital" },
  { code: "3104", name: "Pérdidas Acumuladas", type: "capital" },

// =======================
  // CAPITAL CONTABLE (Capital Reembolsado)
  // =======================

  { code: "3201", name: "Dividendos Decretados", type: "capital" },

  // =======================
  // INGRESOS (Ingresos por Ventas)
  // =======================
  { code: "4001", name: "Ventas", type: "ingreso" },
  { code: "4002", name: "Devoluciones sobre Ventas", type: "ingreso" },
  { code: "4003", name: "Descuentos sobre Ventas", type: "ingreso" },
  { code: "4004", name: "Ventas inventarios", type: "ingreso" },

  // =======================
  // INGRESOS (Otros Ingresos)
  // =======================

  { code: "4101", name: "Productos Financieros", type: "ingreso" },
  { code: "4102", name: "Otros Productos", type: "ingreso" },
  { code: "4103", name: "Ganancia en Venta de Activos", type: "ingreso" },

  // =======================
  // EGRESOS (Costo de Ventas)
  // =======================
  { code: "5001", name: "Costo de Ventas", type: "costo" },
  { code: "5002", name: "Costo de Ventas Inventario", type: "costo" },
  { code: "5003", name: "Devoluciones sobre Compras", type: "costo" },
  { code: "5004", name: "Descuentos sobre Compras", type: "costo" },

  // =======================
  // EGRESOS (Gastos de Operacion)
  // =======================

  { code: "5109", name: "Depreciaciones", type: "gasto" },
  { code: "5110", name: "Amortizaciones", type: "gasto" },

   // =======================
  // EGRESOS (Gastos Financieros)
  // =======================

   { code: "5201", name: "Intereses Pagados", type: "gasto" },

// =======================
  // EGRESOS (Otros Gastos)
  // =======================

  { code: "5204", name: "Otros gastos", type: "gasto" },

  // =======================
  // Otros Ingresos y Gastos (Resultados No Operativos)
  // =======================

  { code: "5202", name: "Comisiones Bancarias", type: "gasto" },
  { code: "5203", name: "Pérdida en Venta de Activos", type: "gasto" },

  // =======================
  // Impuestos (Provisiones)
  // =======================

  { code: "6001", name: "Impuesto sobre la Renta", type: "gasto" },
  { code: "6002", name: "Participación de Utilidades a Trabajadores", type: "gasto" },
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

  let subgrupo = "General";

  if (grupo === "Activos") {
    if (c.startsWith("10") || c.startsWith("11")) subgrupo = "Activo Circulante";
    else if (c.startsWith("12")) subgrupo = "Activo No Circulante";
    else if (c.startsWith("13")) subgrupo = "Activo Diferido";
  } else if (grupo === "Pasivos") {
    if (c.startsWith("20")) subgrupo = "Pasivo Corto Plazo";
    else if (c.startsWith("21")) subgrupo = "Pasivo Largo Plazo";
  } else if (grupo === "Capital Contable") {
    if (c.startsWith("30")) subgrupo = "Capital Contribuido";
    else if (c.startsWith("31")) subgrupo = "Capital Ganado";
    else if (c.startsWith("32")) subgrupo = "Capital Reembolsado";
  } else if (grupo === "Ingresos") {
    subgrupo = c.startsWith("41") ? "Otros Ingresos" : "Ingresos por Ventas";
  } else if (grupo === "Egresos") {
    if (c.startsWith("50")) subgrupo = "Costo de Ventas";
    else if (c.startsWith("51")) subgrupo = "Gastos de Operación";
    else if (c.startsWith("52")) subgrupo = "General";
    else if (c.startsWith("53")) subgrupo = "Depreciaciones y Amortizaciones";
    else if (c.startsWith("54")) subgrupo = "Gastos Financieros";
    else if (c.startsWith("55")) subgrupo = "Otros Gastos";
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

/**
 * ✅ Seed idempotente:
 * - SIEMPRE hace upsert del DEFAULT_CHART (no depende de minCount)
 * - NO pisa cambios del usuario ($setOnInsert)
 */
async function ensureDefaultChart(owner) {
  const before = await Account.countDocuments({ owner });

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
  return {
    attempted: true,
    before,
    after,
    insertedApprox: Math.max(0, after - before),
    bulk,
  };
}

/**
 * ✅ RUTA FIRMA (para confirmar que estás pegándole al router correcto)
 */
router.get("/__sig", (req, res) => {
  return res.json({
    ok: true,
    sig: "cuentas-router-v2026-01-05-fullchart",
    time: new Date().toISOString(),
  });
});

router.get(["/", "/cuentas"], ensureAuth, async (req, res) => {
  res.set("x-bukipin-cuentas", "v2026-01-05-fullchart");
  res.set("cache-control", "no-store");

  try {
    const owner = req.user._id;

    const ensureDefaults = String(req.query.ensureDefaults ?? "true") === "true";
    let seedInfo = null;
    if (ensureDefaults) {
      seedInfo = await ensureDefaultChart(owner);
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
