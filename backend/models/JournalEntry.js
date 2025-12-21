const mongoose = require("mongoose");

const journalLineSchema = new mongoose.Schema(
  {
    accountCodigo: { type: String, default: "" }, // MVP: por código
    debit: { type: Number, default: 0 },
    credit: { type: Number, default: 0 },
    memo: { type: String, default: "" },
  },
  { _id: false }
);

const journalEntrySchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },

    date: { type: Date, default: Date.now, index: true },
    concept: { type: String, default: "", trim: true },

    source: { type: String, default: "" }, // ingreso, pago_cxp, etc.
    sourceId: { type: mongoose.Schema.Types.ObjectId, default: null },

    lines: { type: [journalLineSchema], default: [] },
  },
  { timestamps: true }
);

journalEntrySchema.index({ owner: 1, date: -1 });

module.exports = mongoose.model("JournalEntry", journalEntrySchema);
