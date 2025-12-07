// backend/routes/auth.js
const express = require("express");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");

const User = require("../models/User");
const sendEmail = require("../utils/sendEmail");

const router = express.Router();

/**
 * POST /api/auth/register
 * Registra usuario, guarda en Mongo y envía correo de verificación
 */
router.post("/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res
        .status(400)
        .json({ message: "Nombre, correo y contraseña son obligatorios." });
    }

    const existing = await User.findOne({ email });
    if (existing) {
      return res
        .status(400)
        .json({ message: "Ya existe una cuenta con este correo." });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const verificationToken = crypto.randomBytes(32).toString("hex");
    const verificationTokenExpires = new Date(
      Date.now() + 24 * 60 * 60 * 1000 // 24h
    );

    const user = await User.create({
      name,
      email,
      passwordHash,
      isVerified: false,
      verificationToken,
      verificationTokenExpires,
    });

    const appBaseUrl = process.env.APP_BASE_URL || "https://bukipin.com";
    const verifyUrl = `${appBaseUrl}/api/auth/verify-email?token=${verificationToken}`;

    const html = `
      <div style="font-family: system-ui, -apple-system, BlinkMacSystemFont,'Segoe UI',sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
        <h1 style="font-size: 24px; color: #003a5d;">Bienvenido a Bukipin, ${user.name} 👋</h1>
        <p style="font-size: 14px; color: #444;">
          Para activar tu cuenta, haz clic en el siguiente botón:
        </p>
        <p style="text-align: center; margin: 32px 0;">
          <a href="${verifyUrl}"
             style="background:#003a5d; color:#fff; text-decoration:none; padding:12px 24px; border-radius:999px; font-weight:600;">
            Activar mi cuenta
          </a>
        </p>
        <p style="font-size: 12px; color:#666;">
          Si el botón no funciona, copia y pega este enlace en tu navegador:<br/>
          <span style="word-break: break-all; color:#003a5d;">${verifyUrl}</span>
        </p>
        <p style="font-size: 12px; color:#999; margin-top:24px;">
          Este enlace caduca en 24 horas.
        </p>
      </div>
    `;

    await sendEmail({
      to: email,
      subject: "Activa tu cuenta en Bukipin",
      html,
    });

    return res.status(201).json({
      message: "Cuenta creada. Revisa tu correo para activar tu cuenta.",
    });
  } catch (err) {
    console.error("Error en /register", err);
    return res.status(500).json({ message: "Error al registrar usuario." });
  }
});

/**
 * GET /api/auth/verify-email?token=...
 * Marca la cuenta como verificada y redirige al LOGIN (Versión 1)
 */
router.get("/verify-email", async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) {
      return res.status(400).send("Token inválido.");
    }

    const user = await User.findOne({
      verificationToken: token,
      verificationTokenExpires: { $gt: new Date() },
    });

    if (!user) {
      return res
        .status(400)
        .send("El enlace de verificación no es válido o ha expirado.");
    }

    user.isVerified = true;
    user.verificationToken = undefined;
    user.verificationTokenExpires = undefined;
    await user.save();

    const appBaseUrl = process.env.APP_BASE_URL || "https://bukipin.com";
    // Versión 1: de vuelta al LOGIN
    return res.redirect(`${appBaseUrl}/login?verified=1`);
  } catch (err) {
    console.error("Error en /verify-email", err);
    return res.status(500).send("Error al verificar el correo.");
  }
});

/**
 * POST /api/auth/login
 * Comprueba credenciales e isVerified.
 * Versión 1: sin JWT todavía, solo responde OK y el frontend redirige a /dashboard.
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
    if (!user) {
      return res.status(400).json({ message: "Credenciales incorrectas." });
    }

    if (!user.isVerified) {
      return res.status(403).json({
        message: "Debes confirmar tu correo antes de iniciar sesión.",
      });
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      return res.status(400).json({ message: "Credenciales incorrectas." });
    }

    return res.json({
      message: "Login correcto.",
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
      },
    });
  } catch (err) {
    console.error("Error en /login", err);
    return res.status(500).json({ message: "Error al iniciar sesión." });
  }
});

module.exports = router;
