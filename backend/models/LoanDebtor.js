const mongoose = require("mongoose");

const { Schema } = mongoose;

const loanDebtorSchema = new Schema(
  {
    owner: {
      type: Schema.Types.ObjectId,
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
    rfc: {
      type: String,
      trim: true,
      default: "",
      uppercase: true,
      index: true,
    },
    tipo: {
      type: String,
      trim: true,
      enum: ["persona", "empresa"],
      default: "persona",
      index: true,
    },
    contacto: {
      type: String,
      trim: true,
      default: "",
    },
    telefono: {
      type: String,
      trim: true,
      default: "",
    },
    email: {
      type: String,
      trim: true,
      default: "",
      lowercase: true,
    },
    comentarios: {
      type: String,
      trim: true,
      default: "",
    },
    activo: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  {
    timestamps: true,
    minimize: false,
  }
);

loanDebtorSchema.index({ owner: 1, activo: 1, nombre: 1 });
loanDebtorSchema.index({ owner: 1, rfc: 1 });

loanDebtorSchema.pre("validate", function (next) {
  this.nombre = String(this.nombre || "").trim();
  this.rfc = String(this.rfc || "").trim().toUpperCase();
  this.contacto = String(this.contacto || "").trim();
  this.telefono = String(this.telefono || "").trim();
  this.email = String(this.email || "").trim().toLowerCase();
  this.comentarios = String(this.comentarios || "").trim();
  next();
});

module.exports =
  mongoose.models.LoanDebtor || mongoose.model("LoanDebtor", loanDebtorSchema);
