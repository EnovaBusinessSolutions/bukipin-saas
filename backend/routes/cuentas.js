// backend/routes/cuentas.js
const express = require("express");
const router = express.Router();

const ensureAuth = require("../middleware/ensureAuth");
const Account = require("../models/Account");

function toStr(v) {
  if (v === null || typeof v === "undefined") return "";
  return String(v).trim();
}

function toBool(v) {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v === 1;
  if (typeof v === "string") return v.toLowerCase() === "true";
  return false;
}

/**
 * =========================
 * ✅ DEFAULT CHART (BUKIPIN)
 * =========================
 * Este catálogo base se "asegura" por usuario (owner).
 * Si el usuario tiene muy pocas cuentas, se autosembran.
 *
 * type:
 * - "debit"  => naturaleza deudora (activos, gastos)
 * - "credit" => naturaleza acreedora (pasivos, capital, ingresos)
 *
 * Nota: Si tu modelo usa otro enum para type, cámbialo aquí en 1 minuto.
 */
const DEFAULT_CHART = [
  // =======================
  // BALANCE GENERAL - ACTIVOS
  // =======================
  { codigo: "1001", nombre: "Caja", type: "debit", estado_financiero: "Balance General", grupo: "Activos", subgrupo: "Activo Circulante" },
  { codigo: "1002", nombre: "Bancos", type: "debit", estado_financiero: "Balance General", grupo: "Activos", subgrupo: "Activo Circulante" },

  // En tus asientos/ingresos ya usas 1101 como clientes (legacy). Lo dejamos.
  { codigo: "1101", nombre: "Clientes (Cuentas por Cobrar)", type: "debit", estado_financiero: "Balance General", grupo: "Activos", subgrupo: "Activo Circulante" },

  // Lo que muestras en Lovable como 1003
  { codigo: "1003", nombre: "Cuentas por Cobrar Clientes", type: "debit", estado_financiero: "Balance General", grupo: "Activos", subgrupo: "Activo Circulante" },
  { codigo: "1003-01", nombre: "Clientes Nacionales", parentCode: "1003", type: "debit", estado_financiero: "Balance General", grupo: "Activos", subgrupo: "Activo Circulante" },

  { codigo: "1004", nombre: "Documentos por Cobrar", type: "debit", estado_financiero: "Balance General", grupo: "Activos", subgrupo: "Activo Circulante" },
  { codigo: "1005", nombre: "Inventario de Mercancías", type: "debit", estado_financiero: "Balance General", grupo: "Activos", subgrupo: "Activo Circulante" },
  { codigo: "1006", nombre: "Inventario de Materias Primas", type: "debit", estado_financiero: "Balance General", grupo: "Activos", subgrupo: "Activo Circulante" },
  { codigo: "1007", nombre: "IVA Acreditable", type: "debit", estado_financiero: "Balance General", grupo: "Activos", subgrupo: "Activo Circulante" },
  { codigo: "1008", nombre: "Gastos Pagados por Anticipado", type: "debit", estado_financiero: "Balance General", grupo: "Activos", subgrupo: "Activo Circulante" },

  // Activo No Circulante
  { codigo: "1201", nombre: "Terrenos", type: "debit", estado_financiero: "Balance General", grupo: "Activos", subgrupo: "Activo No Circulante" },
  { codigo: "1202", nombre: "Edificios", type: "debit", estado_financiero: "Balance General", grupo: "Activos", subgrupo: "Activo No Circulante" },
  { codigo: "1203", nombre: "Maquinaria y Equipo", type: "debit", estado_financiero: "Balance General", grupo: "Activos", subgrupo: "Activo No Circulante" },
  { codigo: "1204", nombre: "Mobiliario y Equipo de Oficina", type: "debit", estado_financiero: "Balance General", grupo: "Activos", subgrupo: "Activo No Circulante" },
  { codigo: "1205", nombre: "Vehículos", type: "debit", estado_financiero: "Balance General", grupo: "Activos", subgrupo: "Activo No Circulante" },
  { codigo: "1206", nombre: "Equipo de Cómputo", type: "debit", estado_financiero: "Balance General", grupo: "Activos", subgrupo: "Activo No Circulante" },

  // Depreciaciones Acumuladas
  { codigo: "1207", nombre: "Depreciación Acumulada Edificios", type: "credit", estado_financiero: "Balance General", grupo: "Activos", subgrupo: "Activo No Circulante" },
  { codigo: "1208", nombre: "Depreciación Acumulada Maquinaria", type: "credit", estado_financiero: "Balance General", grupo: "Activos", subgrupo: "Activo No Circulante" },
  { codigo: "1209", nombre: "Depreciación Acumulada Mobiliario", type: "credit", estado_financiero: "Balance General", grupo: "Activos", subgrupo: "Activo No Circulante" },
  { codigo: "1210", nombre: "Depreciación Acumulada Vehículos", type: "credit", estado_financiero: "Balance General", grupo: "Activos", subgrupo: "Activo No Circulante" },
  { codigo: "1211", nombre: "Depreciación Acumulada Equipo Cómputo", type: "credit", estado_financiero: "Balance General", grupo: "Activos", subgrupo: "Activo No Circulante" },
  { codigo: "1212", nombre: "Otros Activos Fijos", type: "debit", estado_financiero: "Balance General", grupo: "Activos", subgrupo: "Activo No Circulante" },
  { codigo: "1213", nombre: "Depreciación Acumulada Otros Activos", type: "credit", estado_financiero: "Balance General", grupo: "Activos", subgrupo: "Activo No Circulante" },

  // Activo Diferido
  { codigo: "1301", nombre: "Gastos de Instalación", type: "debit", estado_financiero: "Balance General", grupo: "Activos", subgrupo: "Activo Diferido" },
  { codigo: "1302", nombre: "Gastos de Organización", type: "debit", estado_financiero: "Balance General", grupo: "Activos", subgrupo: "Activo Diferido" },
  { codigo: "1303", nombre: "Marcas y Patentes", type: "debit", estado_financiero: "Balance General", grupo: "Activos", subgrupo: "Activo Diferido" },
  { codigo: "1304", nombre: "Amortización Acumulada", type: "credit", estado_financiero: "Balance General", grupo: "Activos", subgrupo: "Activo Diferido" },

  // =======================
  // BALANCE GENERAL - PASIVOS
  // =======================
  { codigo: "2001", nombre: "Proveedores", type: "credit", estado_financiero: "Balance General", grupo: "Pasivos", subgrupo: "Pasivo Corto Plazo" },
  { codigo: "2002", nombre: "Documentos por Pagar", type: "credit", estado_financiero: "Balance General", grupo: "Pasivos", subgrupo: "Pasivo Corto Plazo" },
  { codigo: "2003", nombre: "Acreedores Diversos", type: "credit", estado_financiero: "Balance General", grupo: "Pasivos", subgrupo: "Pasivo Corto Plazo" },
  { codigo: "2004", nombre: "IVA por Pagar", type: "credit", estado_financiero: "Balance General", grupo: "Pasivos", subgrupo: "Pasivo Corto Plazo" },
  { codigo: "2005", nombre: "Impuestos por Pagar", type: "credit", estado_financiero: "Balance General", grupo: "Pasivos", subgrupo: "Pasivo Corto Plazo" },
  { codigo: "2006", nombre: "Sueldos por Pagar", type: "credit", estado_financiero: "Balance General", grupo: "Pasivos", subgrupo: "Pasivo Corto Plazo" },
  { codigo: "2007", nombre: "Préstamos Bancarios Corto Plazo", type: "credit", estado_financiero: "Balance General", grupo: "Pasivos", subgrupo: "Pasivo Corto Plazo" },

  { codigo: "2101", nombre: "Préstamos Bancarios Largo Plazo", type: "credit", estado_financiero: "Balance General", grupo: "Pasivos", subgrupo: "Pasivo Largo Plazo" },
  { codigo: "2102", nombre: "Hipotecas por Pagar", type: "credit", estado_financiero: "Balance General", grupo: "Pasivos", subgrupo: "Pasivo Largo Plazo" },
  { codigo: "2103", nombre: "Documentos por Pagar Largo Plazo", type: "credit", estado_financiero: "Balance General", grupo: "Pasivos", subgrupo: "Pasivo Largo Plazo" },

  // =======================
  // BALANCE GENERAL - CAPITAL
  // =======================
  { codigo: "3001", nombre: "Capital Social", type: "credit", estado_financiero: "Balance General", grupo: "Capital Contable", subgrupo: "Capital Contribuido" },
  { codigo: "3002", nombre: "Aportaciones para Futuros Aumentos", type: "credit", estado_financiero: "Balance General", grupo: "Capital Contable", subgrupo: "Capital Contribuido" },
  { codigo: "3003", nombre: "Prima en Venta de Acciones", type: "credit", estado_financiero: "Balance General", grupo: "Capital Contable", subgrupo: "Capital Contribuido" },

  { codigo: "3101", nombre: "Reserva Legal", type: "credit", estado_financiero: "Balance General", grupo: "Capital Contable", subgrupo: "Capital Ganado" },
  { codigo: "3102", nombre: "Utilidades Retenidas", type: "credit", estado_financiero: "Balance General", grupo: "Capital Contable", subgrupo: "Capital Ganado" },
  { codigo: "3104", nombre: "Pérdidas Acumuladas", type: "debit", estado_financiero: "Balance General", grupo: "Capital Contable", subgrupo: "Capital Ganado" },

  { codigo: "3201", nombre: "Dividendos Decretados", type: "credit", estado_financiero: "Balance General", grupo: "Capital Contable", subgrupo: "Capital Reembolsado" },

  // =======================
  // ESTADO DE RESULTADOS - INGRESOS
  // =======================
  { codigo: "4001", nombre: "Ventas", type: "credit", estado_financiero: "Estado de Resultados", grupo: "Ingresos", subgrupo: "Ingresos por Ventas" },
  { codigo: "4001-01", nombre: "Ventas Subcuenta 1", parentCode: "4001", type: "credit", estado_financiero: "Estado de Resultados", grupo: "Ingresos", subgrupo: "Ingresos por Ventas" },
  { codigo: "4001-02", nombre: "Ventas Subcuenta 2", parentCode: "4001", type: "credit", estado_financiero: "Estado de Resultados", grupo: "Ingresos", subgrupo: "Ingresos por Ventas" },
  { codigo: "4001-03", nombre: "Ventas Subcuenta 3", parentCode: "4001", type: "credit", estado_financiero: "Estado de Resultados", grupo: "Ingresos", subgrupo: "Ingresos por Ventas" },
  { codigo: "4001-04", nombre: "Ventas Subcuenta 4", parentCode: "4001", type: "credit", estado_financiero: "Estado de Resultados", grupo: "Ingresos", subgrupo: "Ingresos por Ventas" },

  { codigo: "4002", nombre: "Devoluciones sobre Ventas", type: "debit", estado_financiero: "Estado de Resultados", grupo: "Ingresos", subgrupo: "Ingresos por Ventas" },
  { codigo: "4003", nombre: "Descuentos sobre Ventas", type: "debit", estado_financiero: "Estado de Resultados", grupo: "Ingresos", subgrupo: "Ingresos por Ventas" },
  { codigo: "4004", nombre: "Ventas inventarios", type: "credit", estado_financiero: "Estado de Resultados", grupo: "Ingresos", subgrupo: "Ingresos por Ventas" },

  // Otros ingresos
  { codigo: "4101", nombre: "Productos Financieros", type: "credit", estado_financiero: "Estado de Resultados", grupo: "Ingresos", subgrupo: "Otros Ingresos" },
  { codigo: "4102", nombre: "Otros Productos", type: "credit", estado_financiero: "Estado de Resultados", grupo: "Ingresos", subgrupo: "Otros Ingresos" },
  { codigo: "4103", nombre: "Ganancia en Venta de Activos", type: "credit", estado_financiero: "Estado de Resultados", grupo: "Ingresos", subgrupo: "Otros Ingresos" },

  // =======================
  // ESTADO DE RESULTADOS - EGRESOS
  // =======================
  { codigo: "5001", nombre: "Costo de Ventas", type: "debit", estado_financiero: "Estado de Resultados", grupo: "Egresos", subgrupo: "Costo de Ventas" },
  { codigo: "5101", nombre: "Gastos de Operación", type: "debit", estado_financiero: "Estado de Resultados", grupo: "Egresos", subgrupo: "Gastos de Operación" },
  { codigo: "5301", nombre: "Depreciaciones y Amortizaciones", type: "debit", estado_financiero: "Estado de Resultados", grupo: "Egresos", subgrupo: "Depreciaciones y Amortizaciones" },
  { codigo: "5401", nombre: "Gastos Financieros", type: "debit", estado_financiero: "Estado de Resultados", grupo: "Egresos", subgrupo: "Gastos Financieros" },
  { codigo: "5501", nombre: "Otros Gastos", type: "debit", estado_financiero: "Estado de Resultados", grupo: "Egresos", subgrupo: "Otros Gastos" },

  // Otros ingresos y gastos (Resultados No Operativos)
  { codigo: "5202", nombre: "Comisiones Bancarias", type: "debit", estado_financiero: "Estado de Resultados", grupo: "Otros Ingresos y Gastos", subgrupo: "Resultados No Operativos" },
  { codigo: "5203", nombre: "Pérdida en Venta de Activos", type: "debit", estado_financiero: "Estado de Resultados", grupo: "Otros Ingresos y Gastos", subgrupo: "Resultados No Operativos" },

  // Impuestos (como en tus capturas: 6001/6002)
  { codigo: "6001", nombre: "Impuesto sobre la Renta", type: "debit", estado_financiero: "Estado de Resultados", grupo: "Impuestos", subgrupo: "Provisiones" },
  { codigo: "6002", nombre: "Participación de Utilidades a Trabajadores", type: "debit", estado_financiero: "Estado de Resultados", grupo: "Impuestos", subgrupo: "Provisiones" },

  // Si ya te aparece 7001 en tu BD actual, lo dejamos como legacy
  { codigo: "7001", nombre: "Impuestos (Legacy)", type: "debit", estado_financiero: "Estado de Resultados", grupo: "Impuestos", subgrupo: "General" },
];

/**
 * Inferencia de clasificación (fallback) por código
 * (se usa si el doc no trae estado_financiero/grupo/subgrupo).
 */
function deriveClasificacionFromCodigo(codigoRaw) {
  const codigo = toStr(codigoRaw);
  const n = parseInt(codigo, 10);

  let estado_financiero = "Sin estado";
  let grupo = "Sin grupo";
  let subgrupo = "General";

  if (!codigo) return { estado_financiero, grupo, subgrupo };

  const first = codigo[0];

  // Estado financiero
  if (first === "1" || first === "2" || first === "3") estado_financiero = "Balance General";
  else estado_financiero = "Estado de Resultados";

  // Grupo (con excepción para 52xx que en tu UI cae en "Otros Ingresos y Gastos")
  if (first === "1") grupo = "Activos";
  else if (first === "2") grupo = "Pasivos";
  else if (first === "3") grupo = "Capital Contable";
  else if (first === "4") grupo = "Ingresos";
  else if (first === "5") grupo = "Egresos";
  else if (first === "6") grupo = "Impuestos";
  else if (first === "7") grupo = "Impuestos";
  else grupo = "General";

  if (!Number.isNaN(n)) {
    // Balance General
    if (first === "1") {
      if (n >= 1000 && n < 1200) subgrupo = "Activo Circulante";
      else if (n >= 1200 && n < 1300) subgrupo = "Activo No Circulante";
      else if (n >= 1300 && n < 1400) subgrupo = "Activo Diferido";
      else subgrupo = "General";
    } else if (first === "2") {
      if (n >= 2000 && n < 2100) subgrupo = "Pasivo Corto Plazo";
      else if (n >= 2100 && n < 2200) subgrupo = "Pasivo Largo Plazo";
      else subgrupo = "General";
    } else if (first === "3") {
      if (n >= 3000 && n < 3100) subgrupo = "Capital Contribuido";
      else if (n >= 3100 && n < 3200) subgrupo = "Capital Ganado";
      else if (n >= 3200 && n < 3300) subgrupo = "Capital Reembolsado";
      else subgrupo = "General";
    }

    // Estado de Resultados
    if (first === "4") {
      if (n >= 4000 && n < 4100) subgrupo = "Ingresos por Ventas";
      else if (n >= 4100 && n < 4200) subgrupo = "Otros Ingresos";
      else subgrupo = "General";
    }

    if (first === "5") {
      if (n >= 5000 && n < 5100) subgrupo = "Costo de Ventas";
      else if (n >= 5100 && n < 5200) subgrupo = "Gastos de Operación";
      else if (n >= 5200 && n < 5300) {
        grupo = "Otros Ingresos y Gastos";
        subgrupo = "Resultados No Operativos";
      } else if (n >= 5300 && n < 5400) subgrupo = "Depreciaciones y Amortizaciones";
      else if (n >= 5400 && n < 5500) subgrupo = "Gastos Financieros";
      else if (n >= 5500 && n < 5600) subgrupo = "Otros Gastos";
      else subgrupo = "General";
    }

    if (first === "6") {
      subgrupo = "Provisiones";
    }
  }

  return { estado_financiero, grupo, subgrupo };
}

/**
 * Heurística para subcuentas:
 * - requieren parentCode
 * - y el código termina en -01, .01, /01, etc
 */
function looksLikeSubcuenta(doc) {
  const parentCode = toStr(doc.parentCode);
  if (!parentCode) return false;

  const codigo = toStr(doc.codigo ?? doc.code);
  return /[-./]\d+$/.test(codigo);
}

/**
 * Normaliza salida (ES + EN) + clasificación contable
 */
function normalizeAccountOut(doc) {
  const codigo = toStr(doc.codigo ?? doc.code);
  const nombre = toStr(doc.nombre ?? doc.name);

  const estado_financiero_in = toStr(doc.estado_financiero ?? doc.estadoFinanciero);
  const grupo_in = toStr(doc.grupo);
  const subgrupo_in = toStr(doc.subgrupo);

  const derived =
    !estado_financiero_in || !grupo_in || !subgrupo_in
      ? deriveClasificacionFromCodigo(codigo)
      : null;

  const estado_financiero = estado_financiero_in || derived?.estado_financiero || "Sin estado";
  const grupo = grupo_in || derived?.grupo || "Sin grupo";
  const subgrupo = subgrupo_in || derived?.subgrupo || "General";

  return {
    id: doc._id,
    _id: doc._id,

    codigo,
    nombre,
    code: codigo,
    name: nombre,

    type: doc.type ?? null,
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
 * ✅ Auto-seed: asegura un catálogo mínimo completo.
 * - Solo inserta lo que falta (upsert + $setOnInsert).
 * - No pisa cambios del usuario.
 */
async function ensureDefaultChart(owner, { minCount = 25 } = {}) {
  const count = await Account.countDocuments({ owner });
  if (count >= minCount) return { seeded: false, before: count, after: count };

  const ops = DEFAULT_CHART.map((a) => {
    const codigo = toStr(a.codigo);
    const nombre = toStr(a.nombre);

    // fallback por si faltan clasificaciones
    let estado_financiero = toStr(a.estado_financiero);
    let grupo = toStr(a.grupo);
    let subgrupo = toStr(a.subgrupo);
    if (!estado_financiero || !grupo || !subgrupo) {
      const d = deriveClasificacionFromCodigo(codigo);
      estado_financiero = estado_financiero || d.estado_financiero;
      grupo = grupo || d.grupo;
      subgrupo = subgrupo || d.subgrupo;
    }

    return {
      updateOne: {
        filter: {
          owner,
          $or: [{ codigo }, { code: codigo }],
        },
        update: {
          $setOnInsert: {
            owner,

            codigo,
            nombre,
            code: codigo,
            name: nombre,

            type: a.type || null,
            category: a.category || "general",
            parentCode: a.parentCode ? toStr(a.parentCode) : null,

            estado_financiero,
            grupo,
            subgrupo,

            isDefault: true,
            isActive: true,
          },
        },
        upsert: true,
      },
    };
  });

  // bulkWrite ordenado=false para que no se caiga por una sola colisión
  await Account.bulkWrite(ops, { ordered: false });

  const after = await Account.countDocuments({ owner });
  return { seeded: true, before: count, after };
}

// Soporta montajes:
//  - app.use("/api/cuentas", router) => GET /
//  - app.use("/api", router)        => GET /cuentas
router.get(["/", "/cuentas"], ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;

    // ✅ por defecto, asegura catálogo si está “vacío”
    const ensureDefaults = String(req.query.ensureDefaults ?? "true") === "true";
    if (ensureDefaults) {
      await ensureDefaultChart(owner, { minCount: 25 });
    }

    const q = { owner };

    // active=true|false
    if (typeof req.query.active !== "undefined") {
      q.isActive = String(req.query.active) === "true";
    }

    /**
     * Params:
     * - includeSubcuentas=true  => incluye también subcuentas “-01”
     * - onlySubcuentas=true     => sólo subcuentas “-01”
     */
    const includeSubcuentas = String(req.query.includeSubcuentas || "false") === "true";
    const onlySubcuentas = String(req.query.onlySubcuentas || "false") === "true";

    const items = await Account.find(q)
      .sort({ codigo: 1, code: 1 })
      .lean();

    let filtered = items;

    if (onlySubcuentas) {
      filtered = items.filter(looksLikeSubcuenta);
    } else if (!includeSubcuentas) {
      filtered = items.filter((x) => !looksLikeSubcuenta(x));
    }

    return res.json({ ok: true, data: filtered.map(normalizeAccountOut) });
  } catch (err) {
    console.error("GET /api/cuentas error:", err);
    return res.status(500).json({ ok: false, message: "Error cargando cuentas" });
  }
});

router.post(["/", "/cuentas"], ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;

    const codigo = toStr(req.body?.codigo ?? req.body?.code);
    const nombre = toStr(req.body?.nombre ?? req.body?.name);
    const type = toStr(req.body?.type);
    const category = toStr(req.body?.category || "general");
    const parentCodeRaw = req.body?.parentCode ?? null;
    const parentCode = parentCodeRaw ? toStr(parentCodeRaw) : null;

    let estado_financiero = toStr(req.body?.estado_financiero ?? req.body?.estadoFinanciero);
    let grupo = toStr(req.body?.grupo);
    let subgrupo = toStr(req.body?.subgrupo);

    if (!estado_financiero || !grupo || !subgrupo) {
      const d = deriveClasificacionFromCodigo(codigo);
      estado_financiero = estado_financiero || d.estado_financiero;
      grupo = grupo || d.grupo;
      subgrupo = subgrupo || d.subgrupo;
    }

    if (!codigo) return res.status(400).json({ ok: false, message: "Falta 'codigo'." });
    if (!nombre) return res.status(400).json({ ok: false, message: "Falta 'nombre'." });
    if (!type) return res.status(400).json({ ok: false, message: "Falta 'type'." });

    const created = await Account.create({
      owner,

      codigo,
      nombre,
      code: codigo,
      name: nombre,

      type,
      category,

      parentCode: parentCode || null,

      estado_financiero,
      grupo,
      subgrupo,

      isDefault: false,
      isActive: true,
    });

    return res.status(201).json({
      ok: true,
      data: normalizeAccountOut(created.toObject?.() || created),
    });
  } catch (err) {
    if (err && err.code === 11000) {
      return res.status(409).json({
        ok: false,
        message: "Ya existe una cuenta con ese código para este usuario.",
      });
    }
    console.error("POST /api/cuentas error:", err);
    return res.status(500).json({ ok: false, message: "Error creando cuenta" });
  }
});

router.put(["/:id", "/cuentas/:id"], ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;
    const { id } = req.params;

    const current = await Account.findOne({ _id: id, owner }).lean();
    if (!current) return res.status(404).json({ ok: false, message: "Cuenta no encontrada." });

    const patch = {};

    if (typeof req.body?.codigo !== "undefined" || typeof req.body?.code !== "undefined") {
      const nextCodigo = toStr(req.body?.codigo ?? req.body?.code);
      patch.codigo = nextCodigo;
      patch.code = nextCodigo;

      const hasClasif =
        typeof req.body?.estado_financiero !== "undefined" ||
        typeof req.body?.estadoFinanciero !== "undefined" ||
        typeof req.body?.grupo !== "undefined" ||
        typeof req.body?.subgrupo !== "undefined";

      if (!hasClasif) {
        const d = deriveClasificacionFromCodigo(nextCodigo);
        patch.estado_financiero = d.estado_financiero;
        patch.grupo = d.grupo;
        patch.subgrupo = d.subgrupo;
      }
    }

    if (typeof req.body?.nombre !== "undefined" || typeof req.body?.name !== "undefined") {
      const nextNombre = toStr(req.body?.nombre ?? req.body?.name);
      patch.nombre = nextNombre;
      patch.name = nextNombre;
    }

    if (typeof req.body?.type !== "undefined") patch.type = toStr(req.body.type);
    if (typeof req.body?.category !== "undefined") patch.category = toStr(req.body.category);
    if (typeof req.body?.parentCode !== "undefined") {
      patch.parentCode = req.body.parentCode ? toStr(req.body.parentCode) : null;
    }

    if (typeof req.body?.estado_financiero !== "undefined" || typeof req.body?.estadoFinanciero !== "undefined") {
      patch.estado_financiero = toStr(req.body?.estado_financiero ?? req.body?.estadoFinanciero);
    }
    if (typeof req.body?.grupo !== "undefined") patch.grupo = toStr(req.body.grupo);
    if (typeof req.body?.subgrupo !== "undefined") patch.subgrupo = toStr(req.body.subgrupo);

    if (typeof req.body?.isActive !== "undefined") patch.isActive = toBool(req.body.isActive);

    const updated = await Account.findOneAndUpdate(
      { _id: id, owner },
      { $set: patch },
      { new: true }
    ).lean();

    return res.json({ ok: true, data: normalizeAccountOut(updated) });
  } catch (err) {
    if (err && err.code === 11000) {
      return res.status(409).json({
        ok: false,
        message: "Ya existe una cuenta con ese código para este usuario.",
      });
    }
    console.error("PUT /api/cuentas/:id error:", err);
    return res.status(500).json({ ok: false, message: "Error actualizando cuenta" });
  }
});

router.delete(["/:id", "/cuentas/:id"], ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;
    const { id } = req.params;

    const current = await Account.findOne({ _id: id, owner }).lean();
    if (!current) return res.status(404).json({ ok: false, message: "Cuenta no encontrada." });

    await Account.findOneAndDelete({ _id: id, owner }).lean();
    return res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/cuentas/:id error:", err);
    return res.status(500).json({ ok: false, message: "Error eliminando cuenta" });
  }
});

module.exports = router;
