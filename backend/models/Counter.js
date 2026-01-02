const mongoose = require("mongoose");

const CounterSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    key: { type: String, required: true }, // ej: "journal-2026"
    seq: { type: Number, default: 0 },
  },
  { timestamps: true }
);

CounterSchema.index({ owner: 1, key: 1 }, { unique: true });

module.exports = mongoose.model("Counter", CounterSchema);
