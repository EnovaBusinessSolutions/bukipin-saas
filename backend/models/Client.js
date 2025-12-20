// backend/models/Client.js
const mongoose = require("mongoose");

const clientSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },

    name: { type: String, required: true, trim: true },
    email: { type: String, trim: true, lowercase: true },
    phone: { type: String, trim: true },

    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

clientSchema.index({ owner: 1, name: 1 });

module.exports = mongoose.model("Client", clientSchema);
