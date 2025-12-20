// backend/utils/seedDefaults.js
const Account = require("../models/Account");

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
  // Upsert por (owner, code) para evitar duplicados
  const ops = DEFAULT_ACCOUNTS.map((a) => ({
    updateOne: {
      filter: { owner: userId, code: a.code },
      update: { $setConfirm: { ...a, owner: userId, isDefault: true, isActive: true } },
      upsert: true,
    },
  }));

  // Nota: $setConfirm no existe, era para explicar intención.
  // Usamos $set:
  const fixedOps = DEFAULT_ACCOUNTS.map((a) => ({
    updateOne: {
      filter: { owner: userId, code: a.code },
      update: { $set: { ...a, owner: userId, isDefault: true, isActive: true } },
      upsert: true,
    },
  }));

  await Account.bulkWrite(fixedOps, { ordered: false });
}

module.exports = { seedDefaultsForUser };
