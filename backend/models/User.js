// backend/models/User.js
const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "El nombre es obligatorio"],
      trim: true,
      minlength: 2,
      maxlength: 120,
    },

    email: {
      type: String,
      required: [true, "El correo es obligatorio"],
      trim: true,
      lowercase: true,
      maxlength: 180,
      // 👇 NO usamos unique:true aquí como “validación” porque no es confiable en Mongoose;
      // el índice se declara abajo. (Aun así puedes dejarlo, pero prefiero controlarlo en indexes)
    },

    // 🔐 Ocultar por defecto
    passwordHash: {
      type: String,
      required: [true, "La contraseña es obligatoria"],
      select: false,
    },

    // ✅ Estado de verificación de correo
    isVerified: {
      type: Boolean,
      default: false,
    },

    // 🔐 Ocultar por defecto
    verificationToken: { type: String, select: false },
    verificationTokenExpires: { type: Date, select: false },

    // ✅ Campos para recuperación de contraseña (ocultos)
    resetPasswordToken: { type: String, select: false },
    resetPasswordTokenExpires: { type: Date, select: false },

    // (Opcional) Futuro: status / plan / empresa, etc.
    // plan: { type: String, default: "free" },
  },
  { timestamps: true }
);

/**
 * ✅ Índice único case-insensitive por email
 * Esto evita duplicados con mayúsculas/minúsculas.
 */
userSchema.index(
  { email: 1 },
  {
    unique: true,
    collation: { locale: "en", strength: 2 }, // case-insensitive
  }
);

module.exports = mongoose.model("User", userSchema);
