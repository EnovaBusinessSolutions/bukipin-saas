// backend/utils/cronJobs.js
const cron = require("node-cron");
const mongoose = require("mongoose");

/**
 * Devuelve true si `fecha` es el último día de su mes.
 */
function esUltimoDiaDelMes(fecha) {
  const siguiente = new Date(fecha);
  siguiente.setDate(siguiente.getDate() + 1);
  return siguiente.getDate() === 1;
}

/**
 * Registra todos los cron jobs de la aplicación.
 * Llamar una sola vez desde server.js después de conectar a DB.
 */
function initCronJobs() {
  // Corre a las 23:00 los días 28-31 de cada mes.
  // Dentro verifica si realmente es el último día del mes antes de actuar.
  cron.schedule("0 23 28-31 * *", async () => {
    const hoy = new Date();

    if (!esUltimoDiaDelMes(hoy)) {
      console.log(`[cron] depreciaciones – ${hoy.toISOString()} no es el último día del mes. Omitiendo.`);
      return;
    }

    const mes = hoy.getMonth() + 1;
    const ano = hoy.getFullYear();

    console.log(`[cron] depreciaciones – Iniciando generación automática para ${mes}/${ano}`);

    let generarDepreciacionesParaOwner;
    try {
      ({ generarDepreciacionesParaOwner } = require("../routes/depreciaciones"));
    } catch (err) {
      console.error("[cron] depreciaciones – No se pudo cargar la lógica de generación:", err?.message);
      return;
    }

    // Obtener todos los owners que tienen inversiones activas con depreciación
    let User;
    try {
      User = require("../models/User");
    } catch (err) {
      console.error("[cron] depreciaciones – No se pudo cargar el modelo User:", err?.message);
      return;
    }

    let Capex;
    try {
      Capex = require("../models/Capex");
    } catch (err) {
      console.error("[cron] depreciaciones – No se pudo cargar el modelo Capex:", err?.message);
      return;
    }

    try {
      // Obtener los owners únicos que tienen activos elegibles
      const ownersConActivos = await Capex.distinct("owner", {
        estado: "activo",
        valor_depreciacion_mensual: { $gt: 0 },
      });

      if (!ownersConActivos || ownersConActivos.length === 0) {
        console.log("[cron] depreciaciones – No hay usuarios con activos elegibles.");
        return;
      }

      console.log(`[cron] depreciaciones – Procesando ${ownersConActivos.length} usuario(s)`);

      let totalCreados = 0;
      let totalExistentes = 0;
      let totalErrores = 0;

      for (const owner of ownersConActivos) {
        try {
          const resultado = await generarDepreciacionesParaOwner({ owner, mes, ano });
          totalCreados += resultado.asientos_creados || 0;
          totalExistentes += resultado.asientos_existentes || 0;
          if (resultado.errores && resultado.errores.length > 0) {
            totalErrores += resultado.errores.length;
            console.warn(
              `[cron] depreciaciones – Errores para owner ${owner}:`,
              resultado.errores
            );
          }
        } catch (err) {
          totalErrores++;
          console.error(
            `[cron] depreciaciones – Error al procesar owner ${owner}:`,
            err?.message || err
          );
        }
      }

      console.log(
        `[cron] depreciaciones – Finalizado ${mes}/${ano}. ` +
          `Creados: ${totalCreados}, Ya existían: ${totalExistentes}, Errores: ${totalErrores}`
      );
    } catch (err) {
      console.error("[cron] depreciaciones – Error general en cron:", err?.message || err);
    }
  });

  console.log("✅ Cron jobs registrados (depreciaciones: días 28-31 a las 23:00)");
}

module.exports = { initCronJobs };
