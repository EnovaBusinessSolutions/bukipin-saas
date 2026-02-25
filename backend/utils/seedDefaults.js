// backend/utils/seedDefaults.js
const mongoose = require("mongoose");
const Account = require("../models/Account");

function toStr(v) {
  if (v === null || typeof v === "undefined") return "";
  return String(v).trim();
}

/**
 * ✅ Cuentas contables base por usuario (multi-tenant).
 * Importante: cada documento SIEMPRE lleva owner = userId
 *
 * NOTAS:
 * - type permitido: activo|pasivo|capital|ingreso|gasto|orden
 * - Si tuvieras data vieja con type:"costo", normalízalo a "gasto".
 * - parentCode: para colgar subcuentas (ej. 5002/5003/5004 bajo 5001)
 */
const DEFAULT_ACCOUNTS = [
  // =======================
  // ACTIVOS (Circulante)
  // =======================
  { code: "1001", name: "Caja", type: "activo" },
  { code: "1002", name: "Bancos", type: "activo" },

  { code: "1003", name: "Cuentas por Cobrar Clientes", type: "activo" },

  { code: "1004", name: "Documentos por Cobrar", type: "activo" },
  { code: "1005", name: "Inventario de Mercancías", type: "activo" },
  { code: "1006", name: "Inventario de Materias Primas", type: "activo" },
  { code: "1007", name: "IVA Acreditable", type: "activo" },
  { code: "1008", name: "Gastos Pagados por Anticipado", type: "activo" },
  { code: "1009", name: "Deudores Diversos", type: "activo" },

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
  // EGRESOS (Costo de Ventas)
  // =======================
  { code: "5001", name: "Costo de Ventas", type: "gasto" },
  { code: "5002", name: "Costo de Ventas Inventario", type: "gasto" },
  { code: "5003", name: "Devoluciones sobre Compras", type: "gasto" },
  { code: "5004", name: "Descuentos sobre Compras", type: "gasto" },

  // =======================
  // EGRESOS (Gastos de Operación)
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
  // EGRESOS (Depreciaciones y Amortizaciones)
  // =======================
  { code: "5109", name: "Depreciaciones", type: "gasto" },
  { code: "5110", name: "Amortizaciones", type: "gasto" },

  // =======================
  // EGRESOS (Gastos Financieros)
  // =======================
  { code: "5201", name: "Intereses Pagados", type: "gasto" },

  // =======================
  // Otros Ingresos y Gastos (Resultados No Operativos)
  // =======================
  { code: "5202", name: "Comisiones Bancarias", type: "gasto" },
  { code: "5203", name: "Pérdida en Venta de Activos", type: "gasto" },

  // =======================
  // EGRESOS (Otros Gastos)
  // =======================
  { code: "5204", name: "Otros gastos", type: "gasto" },

  // =======================
  // Impuestos (Provisiones)
  // =======================
  { code: "6001", name: "Impuesto sobre la Renta", type: "gasto" },
  { code: "6002", name: "Participación de Utilidades a Trabajadores", type: "gasto" },
];

async function seedDefaultsForUser(userId) {
  if (!userId) throw new Error("seedDefaultsForUser: userId es requerido");

  // Normaliza a ObjectId si llega como string
  const owner =
    typeof userId === "string" ? new mongoose.Types.ObjectId(userId) : userId;

  // Upsert por (owner, code) para evitar duplicados
  // ✅ Importante: NO pisar cambios del usuario -> $setOnInsert
  const ops = DEFAULT_ACCOUNTS.map((a) => {
    const rawType = toStr(a.type).toLowerCase();
    const normalizedType = rawType === "costo" ? "gasto" : rawType;

    return {
      updateOne: {
        filter: { owner, code: toStr(a.code) },
        update: {
          $setOnInsert: {
            owner,
            code: toStr(a.code),
            name: toStr(a.name),
            type: normalizedType,
            category: toStr(a.category || "general"),
            parentCode: a.parentCode ? toStr(a.parentCode) : null,
            isDefault: true,
            isActive: true,
            createdAt: new Date(),
          },
        },
        upsert: true,
      },
    };
  });

  await Account.bulkWrite(ops, { ordered: false });
}

module.exports = { seedDefaultsForUser };