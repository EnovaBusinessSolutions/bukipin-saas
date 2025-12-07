// backend/routes/auth.js
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");

const User = require("../models/User");
const sendEmail = require("../utils/sendEmail");

const router = express.Router();

// Pequeño helper para normalizar la URL base del cliente
function getClientUrl() {
  const base = process.env.CLIENT_URL || "https://bukipin.com";
  return base.replace(/\/$/, "");
}

/**
 * POST /api/auth/register
 * Crea usuario, genera token de verificación y envía correo
 */
router.post("/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({
        message: "Nombre, correo y contraseña son obligatorios.",
      });
    }

    const existing = await User.findOne({ email });
    if (existing) {
      return res
        .status(400)
        .json({ message: "Este correo ya está registrado." });
    }

    // Hasheamos la contraseña
    const passwordHash = await bcrypt.hash(password, 10);

    // Token de verificación
    const verificationToken = crypto.randomBytes(40).toString("hex");
    const verificationTokenExpires = new Date(
      Date.now() + 1000 * 60 * 60 * 24 * 3 // 3 días
    );

    const user = await User.create({
      name,
      email,
      passwordHash,
      isVerified: false,
      verificationToken,
      verificationTokenExpires,
    });

    // URL que irá en el correo (pega directo al backend)
    const clientUrl = getClientUrl();
    const verifyUrl = `${clientUrl}/api/auth/verify-email?token=${verificationToken}`;

    const html = `
      <h1>Confirma tu correo en Bukipin</h1>
      <p>Hola ${name},</p>
      <p>Gracias por registrarte en <strong>Bukipin</strong>. Para activar tu cuenta haz clic en el siguiente enlace:</p>
      <p><a href="${verifyUrl}" target="_blank">Verificar mi cuenta</a></p>
      <p>Si tú no creaste esta cuenta, puedes ignorar este correo.</p>
    `;

    try {
      await sendEmail({
        to: email,
        subject: "Confirma tu cuenta en Bukipin",
        html,
      });
    } catch (emailErr) {
      console.error("❌ Error enviando correo de verificación:", emailErr);

      // Opción 1 (más segura): informar que no se pudo enviar el correo
      return res.status(500).json({
        message:
          "Tu cuenta se creó, pero no pudimos enviar el correo de verificación. Intenta más tarde o contacta a soporte.",
      });
    }

    return res.status(201).json({
      message:
        "Usuario registrado. Revisa tu bandeja de entrada para confirmar tu correo.",
    });
  } catch (err) {
    console.error("❌ Error en /api/auth/register:", err);
    return res
      .status(500)
      .json({ message: "Error inesperado al registrar tu cuenta." });
  }
});

/**
 * GET /api/auth/verify-email?token=...
 * Marca al usuario como verificado y redirige al login
 */
router.get("/verify-email", async (req, res) => {
  try {
    const { token } = req.query;

    if (!token) {
      return res.status(400).send("Token de verificación faltante.");
    }

    const user = await User.findOne({
      verificationToken: token,
      verificationTokenExpires: { $gt: new Date() },
    });

    if (!user) {
      return res.status(400).send("Token inválido o expirado.");
    }

    user.isVerified = true;
    user.verificationToken = undefined;
    user.verificationTokenExpires = undefined;
    await user.save();

    const clientUrl = getClientUrl();
    // Después de verificar, lo mandamos al login con un flag
    return res.redirect(`${clientUrl}/login?verified=1`);
  } catch (err) {
    console.error("❌ Error en /api/auth/verify-email:", err);
    return res
      .status(500)
      .send("Ocurrió un error al verificar tu correo. Intenta más tarde.");
  }
});

/**
 * POST /api/auth/login
 * Login clásico con email + password
 */
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res
        .status(400)
        .json({ message: "Correo y contraseña son obligatorios." });
    }

    const user = await User.findOne({ email });
    if (!user || !user.passwordHash) {
      return res.status(400).json({ message: "Credenciales inválidas." });
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      return res.status(400).json({ message: "Credenciales inválidas." });
    }

    if (!user.isVerified) {
      return res
        .status(403)
        .json({ message: "Debes confirmar tu correo antes de iniciar sesión." });
    }

    const token = jwt.sign(
      { id: user._id },
      process.env.JWT_SECRET || "dev-secret",
      { expiresIn: "7d" }
    );

    return res.json({
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
      },
    });
  } catch (err) {
    console.error("❌ Error en /api/auth/login:", err);
    return res
      .status(500)
      .json({ message: "Error inesperado al iniciar sesión." });
  }
});

module.exports = router;
