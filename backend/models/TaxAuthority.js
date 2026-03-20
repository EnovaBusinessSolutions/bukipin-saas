// backend/models/TaxAuthority.js
const mongoose = require("mongoose");

function asTrim(v, def = "") {
  if (v === undefined || v === null) return def;
  return String(v).trim();
}

const taxAuthoritySchema = new mongoose.Schema(
  {
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    nombre: { type: String, required: true, trim: true },
    rfc: { type: String, default: "", trim: true },
    logoUrl: { type: String, default: "", trim: true },

    pais: { type: String, default: "México", trim: true },

    telefono: { type: String, default: "", trim: true },
    email: { type: String, default: "", trim: true },
    sitioWeb: { type: String, default: "", trim: true },
    direccion: { type: String, default: "", trim: true },
    cuentaBancaria: { type: String, default: "", trim: true },
    notas: { type: String, default: "", trim: true },

    isActive: { type: Boolean, default: true },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform: (_doc, ret) => {
        ret.id = String(ret._id);

        ret.logo_url = ret.logoUrl || "";
        ret.sitio_web = ret.sitioWeb || "";
        ret.cuenta_bancaria = ret.cuentaBancaria || "";

        ret.created_at = ret.createdAt ? new Date(ret.createdAt).toISOString() : null;
        ret.updated_at = ret.updatedAt ? new Date(ret.updatedAt).toISOString() : null;

        delete ret._id;
        delete ret.__v;
        delete ret.logoUrl;
        delete ret.sitioWeb;
        delete ret.cuentaBancaria;
        return ret;
      },
    },
    toObject: { virtuals: true },
  }
);

taxAuthoritySchema.pre("validate", function (next) {
  try {
    this.nombre = asTrim(this.nombre);
    this.rfc = asTrim(this.rfc);
    this.logoUrl = asTrim(this.logoUrl);
    this.pais = asTrim(this.pais, "México");
    this.telefono = asTrim(this.telefono);
    this.email = asTrim(this.email);
    this.sitioWeb = asTrim(this.sitioWeb);
    this.direccion = asTrim(this.direccion);
    this.cuentaBancaria = asTrim(this.cuentaBancaria);
    this.notas = asTrim(this.notas);

    if (!this.nombre) {
      const err = new Error("El nombre de la autoridad fiscal es requerido.");
      err.statusCode = 400;
      throw err;
    }

    next();
  } catch (err) {
    next(err);
  }
});

taxAuthoritySchema.index({ owner: 1, nombre: 1 });

module.exports = mongoose.model("TaxAuthority", taxAuthoritySchema);