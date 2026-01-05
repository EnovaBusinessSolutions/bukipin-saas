// backend/routes/cuentas.js
const express = require("express");
const router = express.Router();

const ensureAuth = require("../middleware/ensureAuth");
const Account = require("../models/Account");

function toStr(v) {
  if (v === null || typeof v === "undefined") return "";
  return String(v).trim();
}

/**
 * ✅ Subcuenta = tiene parentCode y NO es el mismo código del padre
 * (No dependemos de que el código termine en "-01", porque en Bukipin 2
 * hay “subcuentas” como 5002/5003/5004 colgadas de 5001).
 */
function looksLikeSubcuenta(doc) {
  const parentCode = toStr(doc.parentCode);
  if (!parentCode) return false;
  const code = toStr(doc.code);
  if (!code) return false;
  return code !== parentCode;
}

/**
 * ✅ Catálogo base (alineado al enum)
 * type: activo|pasivo|capital|ingreso|gasto|orden
 *
 * NOTA IMPORTANTE:
 * - Antes usabas type:"costo" (no existe en el enum). Aquí ya NO lo usamos.
 * - Para no romper data ya insertada con "costo", abajo lo normalizamos a "gasto".
 *
 * ESTRUCTURA:
 * - Puedes “colar” jerarquía con parentCode (para que UI muestre subcuentas como Bukipin 2).
 */
const DEFAULT_CHART = [
  // =======================
  // ACTIVOS (Circulante)
  // =======================
  { code: "1001", name: "Caja", type: "activo" },
  { code: "1002", name: "Bancos", type: "activo" },

  { code: "1003", name: "Cuentas por Cobrar Clientes", type: "activo" },
  { code: "1003-01", name: "Clientes", type: "activo", parentCode: "1003" },

  { code: "1004", name: "Documentos por Cobrar", type: "activo" },
  { code: "1005", name: "Inventario de Mercancías", type: "activo" },
  { code: "1006", name: "Inventario de Materias Primas", type: "activo" },
  { code: "1007", name: "IVA Acreditable", type: "activo" },
  { code: "1008", name: "Gastos Pagados por Anticipado", type: "activo" },

  // Legacy (lo sigues usando en flujos viejos)
  { code: "1101", name: "Clientes", type: "activo" },

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
  // CAPITAL CONTABLE
  // =======================
  { code: "3001", name: "Capital Social", type: "capital" },
  { code: "3002", name: "Aportaciones para Futuros Aumentos", type: "capital" },
  { code: "3003", name: "Prima en Venta de Acciones", type: "capital" },

  { code: "3101", name: "Reserva Legal", type: "capital" },
  { code: "3102", name: "Utilidades Retenidas", type: "capital" },
  { code: "3104", name: "Pérdidas Acumuladas", type: "capital" },

  { code: "3201", name: "Dividendos Decretados", type: "capital" },

  // =======================
  // INGRESOS (Ventas)
  // =======================
  { code: "4001", name: "Ventas", type: "ingreso" },

  // Subcuentas de Ventas (como ya las estás mostrando en tu sistema)
  { code: "4001-01", name: "Ventas Contado", type: "ingreso", parentCode: "4001" },
  { code: "4001-02", name: "Ventas Crédito", type: "ingreso", parentCode: "4001" },
  { code: "4001-03", name: "Ventas Transferencia", type: "ingreso", parentCode: "4001" },
  { code: "4001-04", name: "Otras Ventas", type: "ingreso", parentCode: "4001" },

  { code: "4002", name: "Devoluciones sobre Ventas", type: "ingreso" },
  { code: "4003", name: "Descuentos sobre Ventas", type: "ingreso" },
  { code: "4004", name: "Ventas inventarios", type: "ingreso" },

  // =======================
  // INGRESOS (Otros)
  // =======================
  { code: "4101", name: "Productos Financieros", type: "ingreso" },
  { code: "4102", name: "Otros Productos", type: "ingreso" },
  { code: "4103", name: "Ganancia en Venta de Activos", type: "ingreso" },

  // =======================
  // EGRESOS (Costo de Ventas) — como Bukipin 2
  // =======================
  { code: "5001", name: "Costo de Ventas", type: "gasto" },
  { code: "5002", name: "Costo de Ventas Inventario", type: "gasto", parentCode: "5001" },
  { code: "5003", name: "Devoluciones sobre Compras", type: "gasto", parentCode: "5001" },
  { code: "5004", name: "Descuentos sobre Compras", type: "gasto", parentCode: "5001" },

  // =======================
  // EGRESOS (Gastos de Operación) — faltaban en Bukipin 1
  // =======================
  { code: "5101", name: "Gastos de Venta", type: "gasto" },
  { code: "5102", name: "Sueldos y Salarios Ventas", type: "gasto" },
  { code: "5103", name: "Comisiones sobre Ventas", type: "gasto" },
  { code: "5104", name: "Publicidad", type: "gasto" },
  { code: "5105", name: "Gastos de Administración", type: "gasto" },
  { code: "5106", name: "Sueldos y Salarios Administración", type: "gasto" },
  { code: "5107", name: "Renta de Oficinas", type: "gasto" },
  { code: "5108", name: "Servicios Públicos", type: "gasto" },

  // =======================
  // EGRESOS (Depreciaciones y Amortizaciones) — como Bukipin 2
  // =======================
  { code: "5109", name: "Depreciaciones", type: "gasto" },
  { code: "5110", name: "Amortizaciones", type: "gasto" },

  // =======================
  // EGRESOS (Gastos Financieros) — como Bukipin 2
  // =======================
  { code: "5201", name: "Intereses Pagados", type: "gasto" },

  // =======================
  // EGRESOS (Otros Gastos)
  // =======================
  { code: "5204", name: "Otros gastos", type: "gasto" },

  // =======================
  // Otros Ingresos y Gastos (Resultados No Operativos) — como Bukipin 2
  // =======================
  { code: "5202", name: "Comisiones Bancarias", type: "gasto" },
  { code: "5203", name: "Pérdida en Venta de Activos", type: "gasto" },

  // =======================
  // Impuestos (Provisiones)
  // =======================
  { code: "6001", name: "Impuesto sobre la Renta", type: "gasto" },
  { code: "6002", name: "Participación de Utilidades a Trabajadores", type: "gasto" },

  // Opcional (si en tu UI ya existe 7001 en Bukipin 1, no estorba)
  { code: "7001", name: "Impuestos", type: "gasto" },
];

function inferClasificacion(code, type) {
  const c = String(code || "").trim();
  const rawType = String(type || "").toLowerCase().trim();

  // ✅ Normaliza data vieja
  const t = rawType === "costo" ? "gasto" : rawType;

  const estado_financiero = ["activo", "pasivo", "capital"].includes(t)
    ? "Balance General"
    : "Estado de Resultados";

  let grupo = "General";
  if (t === "activo") grupo = "Activos";
  else if (t === "pasivo") grupo = "Pasivos";
  else if (t === "capital") grupo = "Capital Contable";
  else if (t === "ingreso") grupo = "Ingresos";
  else if (t === "gasto") grupo = "Egresos";

  // ✅ Overrides para que quede como en tu UI de Bukipin 2
  if (["5202", "5203"].includes(c)) grupo = "Otros Ingresos y Gastos";
  if (c.startsWith("60") || c.startsWith("70")) grupo = "Impuestos";

  let subgrupo = "General";

  if (grupo === "Activos") {
    if (c.startsWith("10") || c.startsWith("11")) subgrupo = "Activo Circulante";
    else if (c.startsWith("12")) subgrupo = "Activo No Circulante";
    else if (c.startsWith("13")) subgrupo = "Activo Diferido";
  } else if (grupo === "Pasivos") {
    if (c.startsWith("20")) subgrupo = "Pasivo Circulante";
    else if (c.startsWith("21")) subgrupo = "Pasivo No Circulante";
  } else if (grupo === "Capital Contable") {
    if (c.startsWith("30")) subgrupo = "Capital Contribuido";
    else if (c.startsWith("31")) subgrupo = "Capital Ganado";
    else if (c.startsWith("32")) subgrupo = "Capital Reembolsado";
  } else if (grupo === "Ingresos") {
    subgrupo = c.startsWith("41") ? "Otros Ingresos" : "Ingresos por Ventas";
  } else if (grupo === "Egresos") {
    if (c.startsWith("50")) subgrupo = "Costo de Ventas";
    else if (["5109", "5110"].includes(c) || c.startsWith("53")) subgrupo = "Depreciaciones y Amortizaciones";
    else if (c === "5201" || c.startsWith("54")) subgrupo = "Gastos Financieros";
    else if (c === "5204" || c.startsWith("55")) subgrupo = "Otros Gastos";
    else subgrupo = "Gastos de Operación";
  } else if (grupo === "Otros Ingresos y Gastos") {
    subgrupo = "Resultados No Operativos";
  } else if (grupo === "Impuestos") {
    subgrupo = "Provisiones";
  }

  return { estado_financiero, grupo, subgrupo };
}

function normalizeAccountOut(doc) {
  const code = toStr(doc.code);
  const name = toStr(doc.name);

  const rawType = toStr(doc.type).toLowerCase();
  const normalizedType = rawType === "costo" ? "gasto" : rawType;

  const { estado_financiero, grupo, subgrupo } = inferClasificacion(code, normalizedType);

  return {
    id: doc._id,
    _id: doc._id,

    codigo: code,
    nombre: name,
    code,
    name,

    // ✅ entregamos el type normalizado para que el frontend agrupe bien
    type: normalizedType || null,
    originalType: rawType || null,

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
 * - Upsert por (owner + code)
 * - NO pisa cambios del usuario ($setOnInsert)
 * - Inserta NUEVAS cuentas cuando agregas más al DEFAULT_CHART
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
 * ✅ RUTA FIRMA (para confirmar router correcto)
 */
router.get("/__sig", (req, res) => {
  return res.json({
    ok: true,
    sig: "cuentas-router-v2026-01-05-bukipin2-match",
    time: new Date().toISOString(),
  });
});

router.get(["/", "/cuentas"], ensureAuth, async (req, res) => {
  res.set("x-bukipin-cuentas", "v2026-01-05-bukipin2-match");
  res.set("cache-control", "no-store");

  try {
    const owner = req.user._id;

    const ensureDefaults = String(req.query.ensureDefaults ?? "false") === "true";
    let seedInfo = null;
    if (ensureDefaults) {
      seedInfo = await ensureDefaultChart(owner);
    }

    const q = { owner };
    const activeParam = req.query.active;
    // Default: solo activas
    if (typeof activeParam === "undefined") {
    q.isActive = true;
    } else {
    const v = String(activeParam).toLowerCase();
    // active=all para traer todo
    if (v !== "all") q.isActive = v === "true";
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
