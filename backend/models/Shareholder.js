// backend/models/Shareholder.js
const mongoose = require("mongoose");

function asTrim(v, def = "") {
  if (v === undefined || v === null) return def;
  return String(v).trim();
}

function toNum(v, def = 0) {
  const n = Number(String(v ?? "").replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : def;
}

const shareholderSchema = new mongoose.Schema(
  {
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    nombre: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },

    porcentaje_participacion: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },

    email: {
      type: String,
      default: "",
      trim: true,
    },

    telefono: {
      type: String,
      default: "",
      trim: true,
    },

    rfc: {
      type: String,
      default: "",
      trim: true,
    },

    activo: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform: (_doc, ret) => {
        ret.id = String(ret._id);
        ret.user_id = ret.owner ? String(ret.owner) : "";

        ret.nombre = asTrim(ret.nombre, "");
        ret.porcentaje_participacion = toNum(ret.porcentaje_participacion, 0);
        ret.email = asTrim(ret.email, "");
        ret.telefono = asTrim(ret.telefono, "");
        ret.rfc = asTrim(ret.rfc, "");
        ret.activo = !!ret.activo;

        ret.created_at = ret.createdAt ? new Date(ret.createdAt).toISOString() : null;
        ret.updated_at = ret.updatedAt ? new Date(ret.updatedAt).toISOString() : null;

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

shareholderSchema.index({ owner: 1, activo: 1, nombre: 1 });
shareholderSchema.index({ owner: 1, nombre: 1 });

module.exports = mongoose.model("Shareholder", shareholderSchema);