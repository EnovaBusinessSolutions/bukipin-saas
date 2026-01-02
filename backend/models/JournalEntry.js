const mongoose = require("mongoose");

const journalLineSchema = new mongoose.Schema(
  {
    accountCodigo: { type: String, default: "" }, // MVP por código
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

    numeroAsiento: { type: String, default: null, index: true },

    source: { type: String, default: "", index: true }, // ingreso, pago_cxp, etc.
    sourceId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },

    lines: { type: [journalLineSchema], default: [] },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform: (_doc, ret) => {
        ret.id = String(ret._id);
        ret.created_at = ret.createdAt ? new Date(ret.createdAt).toISOString() : null;
        ret.updated_at = ret.updatedAt ? new Date(ret.updatedAt).toISOString() : null;

        ret.user_id = ret.owner ? String(ret.owner) : null;

        delete ret._id;
        delete ret.__v;
        delete ret.createdAt;
        delete ret.updatedAt;
        return ret;
      },
    },
    toObject: { virtuals: true },
  }
);

journalEntrySchema.index({ owner: 1, date: -1 });
journalEntrySchema.index({ owner: 1, source: 1, date: -1 });
journalEntrySchema.index({ owner: 1, source: 1, sourceId: 1 });
journalEntrySchema.index({ owner: 1, numeroAsiento: 1 }, { unique: true, sparse: true });


module.exports = mongoose.model("JournalEntry", journalEntrySchema);
