// backend/utils/seedDefaults.js
const mongoose = require("mongoose");
const Account = require("../models/Account");

/**
 * Cuentas contables base por usuario (multi-tenant).
 * Importante: cada documento SIEMPRE lleva owner = userId
 */
const DEFAULT_ACCOUNTS = [
  { code: "1001", name: "Caja", type: "activo" },
  { code: "1002", name: "Bancos", type: "activo" },
  { code: "1101", name: "Clientes", type: "activo" },

  { code: "2001", name: "Proveedores", type: "pasivo" },

  { code: "3001", name: "Capital", type: "capital" },

  { code: "4001", name: "Ventas", type: "ingreso" },

  { code: "5001", name: "Costo de ventas", type: "gasto" },
  { code: "6001", name: "Gastos operativos", type: "gasto" },

  { code: "7001", name: "Impuestos", type: "gasto" },
];

async function seedDefaultsForUser(userId) {
  if (!userId) {
    throw new Error("seedDefaultsForUser: userId es requerido");
  }

  // Normaliza a ObjectId si llega como string
  const owner = typeof userId === "string" ? new mongoose.Types.ObjectId(userId) : userId;

  // Upsert por (owner, code) para evitar duplicados
  const ops = DEFAULT_ACCOUNTS.map((a) => ({
    updateOne: {
      filter: { owner, code: a.code },
      update: {
        $set: {
          ...a,
          owner,
          isDefault: true,
          isActive: true,
        },
        // Si quieres marcar la primera creación con createdAt, déjalo al schema timestamps
        $setOnInsert: {
          createdAt: new Date(),
        },
      },
      upsert: true,
    },
  }));

  await Account.bulkWrite(ops, { ordered: false });
}

module.exports = { seedDefaultsForUser };
