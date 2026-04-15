// backend/routes/depreciaciones.js
const express = require("express");
const router = express.Router();
const ensureAuth = require("../middleware/ensureAuth");
const Capex = require("../models/Capex");
const JournalEntry = require("../models/JournalEntry");

/**
 * Mapa de categoría de activo → cuenta de depreciación acumulada (crédito)
 */
const DEPRECIACION_ACUMULADA_POR_CATEGORIA = {
  edificios: "1221",
  maquinaria: "1231",
  vehiculos: "1241",
  mobiliario: "1251",
  equipo_oficina: "1251",
  equipo_computo: "1261",
  otro: "1291",
};

const DEFAULT_DEPRECIACION_ACUMULADA = "1291";
const GASTO_DEPRECIACION = "5109";

function getCuentaDepAcumulada(categoriaActivo) {
  const cat = String(categoriaActivo || "otro").toLowerCase().trim();
  return DEPRECIACION_ACUMULADA_POR_CATEGORIA[cat] || DEFAULT_DEPRECIACION_ACUMULADA;
}

/**
 * Genera depreciaciones para un owner en un período mes/ano dado.
 * Puede ser llamada desde el endpoint HTTP o desde el cron job.
 *
 * @param {Object} params
 * @param {*}      params.owner  – ObjectId o string del usuario
 * @param {number} params.mes    – 1-12
 * @param {number} params.ano    – e.g. 2025
 * @returns {Object} resultado con contadores y detalles
 */
async function generarDepreciacionesParaOwner({ owner, mes, ano }) {
  const periodo = `${ano}${String(mes).padStart(2, "0")}`; // YYYYMM

  const activos = await Capex.find({
    owner,
    estado: "activo",
    valor_depreciacion_mensual: { $gt: 0 },
  }).lean();

  const fechaCorte = new Date(ano, mes - 1, 1); // primer día del mes seleccionado

  let asientos_creados = 0;
  let asientos_existentes = 0;
  const detalles = [];
  const errores = [];

  for (const activo of activos) {
    try {
      // Verificar que el activo ya haya iniciado depreciación en este período
      const fechaInicio = activo.fecha_inicio_depreciacion
        ? new Date(activo.fecha_inicio_depreciacion)
        : new Date(activo.fecha_adquisicion);

      const primerDiaMesInicio = new Date(
        fechaInicio.getFullYear(),
        fechaInicio.getMonth(),
        1
      );

      if (primerDiaMesInicio > fechaCorte) {
        continue;
      }

      const numeroAsiento = `DEP-${periodo}-${activo._id}`;

      // Verificar si ya existe el asiento para este período y activo
      const existente = await JournalEntry.findOne({ owner, numeroAsiento }).lean();

      if (existente) {
        asientos_existentes++;
        detalles.push({
          activo: activo.producto_nombre,
          numero_asiento: numeroAsiento,
          monto: activo.valor_depreciacion_mensual,
          estado: "ya_existe",
        });
        continue;
      }

      const cuentaCredito = getCuentaDepAcumulada(activo.categoria_activo);
      const monto = activo.valor_depreciacion_mensual;

      // Fecha del asiento: último día del mes seleccionado
      const fechaAsiento = new Date(ano, mes, 0); // día 0 del mes siguiente = último día del mes

      await JournalEntry.create({
        owner,
        date: fechaAsiento,
        concept: `Depreciación mensual – ${activo.producto_nombre} (${periodo})`,
        numeroAsiento,
        source: "depreciacion_inversion",
        sourceId: activo._id,
        transaccionId: activo._id,
        source_id: activo._id,
        references: [
          { source: "capex", id: String(activo._id), numero: numeroAsiento },
          { source: "inversion", id: String(activo._id), numero: numeroAsiento },
        ],
        lines: [
          {
            accountCodigo: GASTO_DEPRECIACION,
            debit: monto,
            credit: 0,
            memo: `Gasto depreciación – ${activo.producto_nombre} ${periodo}`,
          },
          {
            accountCodigo: cuentaCredito,
            debit: 0,
            credit: monto,
            memo: `Depreciación acumulada – ${activo.categoria_activo} ${periodo}`,
          },
        ],
      });

      asientos_creados++;
      detalles.push({
        activo: activo.producto_nombre,
        numero_asiento: numeroAsiento,
        monto,
        estado: "creado",
      });
    } catch (err) {
      errores.push(`${activo.producto_nombre}: ${err?.message || "Error desconocido"}`);
    }
  }

  return {
    success: true,
    mes,
    ano,
    periodo,
    total_activos: activos.length,
    asientos_creados,
    asientos_existentes,
    errores,
    detalles,
  };
}

/**
 * POST /api/depreciaciones/generar
 *
 * Body (opcional): { mes: 1-12, ano: 2025 }
 * Si no se envían, usa el mes y año actuales.
 */
router.post("/generar", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;
    const ahora = new Date();

    const mes = req.body?.mes ? parseInt(String(req.body.mes), 10) : ahora.getMonth() + 1;
    const ano = req.body?.ano ? parseInt(String(req.body.ano), 10) : ahora.getFullYear();

    if (!Number.isFinite(mes) || mes < 1 || mes > 12) {
      return res.status(400).json({ ok: false, message: "mes debe ser un número entre 1 y 12." });
    }
    if (!Number.isFinite(ano) || ano < 2000 || ano > 2100) {
      return res.status(400).json({ ok: false, message: "ano inválido." });
    }

    const resultado = await generarDepreciacionesParaOwner({ owner, mes, ano });

    return res.json({ ok: true, data: resultado, ...resultado });
  } catch (err) {
    console.error("POST /api/depreciaciones/generar error:", err);
    return res.status(500).json({
      ok: false,
      message: err?.message || "Error interno del servidor",
    });
  }
});

module.exports = router;
module.exports.generarDepreciacionesParaOwner = generarDepreciacionesParaOwner;
