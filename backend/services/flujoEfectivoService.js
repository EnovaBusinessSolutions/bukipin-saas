const Account = require("../models/Account");
const JournalEntry = require("../models/JournalEntry");

function money(n) {
  const x = Number(n || 0);
  return Number.isFinite(x) ? x : 0;
}

/**
 * Devuelve asientos en formato legacy:
 * { id, numero_asiento, fecha, descripcion, detalle_asientos:[{cuenta_codigo,debe,haber,descripcion}] }
 */
exports.listAsientosForFlujoEfectivo = async ({ ownerId, start, endExclusive }) => {
  // Trae asientos del periodo del usuario y populates de cuentas para obtener "code"
  const entries = await JournalEntry.find({
    owner: ownerId,
    date: { $gte: start, $lt: endExclusive },
  })
    .sort({ date: -1 })
    .populate({
      path: "lines.account",
      select: "code name descripcion",
    })
    .lean();

  return (entries || []).map((e) => {
    const lines = Array.isArray(e.lines) ? e.lines : [];

    return {
      id: String(e._id),
      numero_asiento: String(e.number || e.numero_asiento || e.folio || ""), // ajusta si tu campo se llama distinto
      fecha: (e.date ? new Date(e.date).toISOString() : new Date().toISOString()),
      descripcion: String(e.description || e.descripcion || ""),
      detalle_asientos: lines.map((ln) => {
        const acc = ln.account || {};
        const code = String(acc.code || acc.codigo || acc.accountCode || "");
        const desc = String(ln.description || ln.descripcion || acc.name || acc.descripcion || "");

        return {
          cuenta_codigo: code,
          debe: money(ln.debit),
          haber: money(ln.credit),
          descripcion: desc,
        };
      }),
    };
  });
};
