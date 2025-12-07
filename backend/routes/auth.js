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
 * Construye el HTML del correo de verificación con el look & feel de Bukipin
 */
function buildVerificationEmail({ name, verifyUrl }) {
  const safeName = name || "hola";

  return `
  <!DOCTYPE html>
  <html lang="es">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Confirma tu cuenta en Bukipin</title>
    <style>
      body,table,td,p,a {
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        margin: 0;
        padding: 0;
      }
      img {
        border: 0;
        max-width: 100%;
        display: block;
      }
      a {
        color: inherit;
        text-decoration: none;
      }
      a[x-apple-data-detectors] {
        color: inherit !important;
        text-decoration: none !important;
      }
    </style>
  </head>
  <body style="background-color:#0f172a; margin:0; padding:24px;">
    <!-- Preheader -->
    <div style="display:none; max-height:0; overflow:hidden; opacity:0;">
      Activa tu cuenta en Bukipin con un solo clic.
    </div>

    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
      <tr>
        <td align="center">
          <!-- Card principal -->
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px; background-color:#0b1120; border-radius:24px; overflow:hidden; border:1px solid #1f2937;">
            <!-- Header con logo -->
            <tr>
              <td style="padding:24px 28px 8px 28px; background:radial-gradient(circle at top left,#1d4ed8,#0b1120);">
                <table role="presentation" width="100%">
                  <tr>
                    <td align="left">
                      <table role="presentation">
                        <tr>
                          <td valign="middle" style="padding-right:8px;">
                            <!-- 👇 Cambia la URL del logo por la tuya -->
                            <img src="https://bukipin.com/logo-email.png" alt="Bukipin" width="40" height="40" style="border-radius:12px; background:#0f172a;" />
                          </td>
                          <td valign="middle">
                            <div style="font-size:20px; font-weight:700; color:#e5e7eb; letter-spacing:0.14em; text-transform:uppercase;">
                              BUKI<span style="color:#38bdf8;">PIN</span>
                            </div>
                            <div style="font-size:11px; color:#9ca3af; letter-spacing:0.18em; text-transform:uppercase; margin-top:2px;">
                              Business Intelligence &amp; FP&amp;A
                            </div>
                          </td>
                        </tr>
                      </table>
                    </td>
                    <td align="right" style="font-size:11px; color:#9ca3af;">
                      Notificación de seguridad
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- Contenido -->
            <tr>
              <td style="padding:24px 28px 8px 28px; background-color:#020617;">
                <h1 style="margin:0 0 12px 0; font-size:22px; line-height:1.3; color:#f9fafb; font-weight:700;">
                  Confirma tu correo en Bukipin
                </h1>

                <p style="margin:0 0 8px 0; font-size:14px; line-height:1.6; color:#e5e7eb;">
                  Hola ${safeName},
                </p>

                <p style="margin:0 0 12px 0; font-size:14px; line-height:1.6; color:#9ca3af;">
                  Gracias por registrarte en <strong style="color:#e5e7eb;">Bukipin</strong>. 
                  Para activar tu cuenta y empezar a gestionar tus finanzas empresariales con mayor claridad,
                  necesitamos que confirmes que este correo te pertenece.
                </p>

                <p style="margin:0 0 20px 0; font-size:14px; line-height:1.6; color:#9ca3af;">
                  Haz clic en el siguiente botón para verificar tu cuenta:
                </p>

                <!-- Botón principal -->
                <table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 0 18px 0;">
                  <tr>
                    <td>
                      <a href="${verifyUrl}"
                         style="display:inline-block; padding:12px 28px; border-radius:999px;
                                background:linear-gradient(135deg,#1d4ed8,#38bdf8);
                                color:#f9fafb; font-size:14px; font-weight:600; text-align:center;">
                        Verificar mi cuenta
                      </a>
                    </td>
                  </tr>
                </table>

                <!-- Fallback link plano -->
                <p style="margin:0 0 16px 0; font-size:12px; line-height:1.6; color:#6b7280;">
                  Si el botón no funciona, copia y pega este enlace en tu navegador:
                </p>
                <p style="margin:0 0 24px 0; font-size:11px; line-height:1.6; color:#9ca3af; word-break:break-all;">
                  <a href="${verifyUrl}" style="color:#38bdf8; text-decoration:underline;">
                    ${verifyUrl}
                  </a>
                </p>

                <p style="margin:0 0 8px 0; font-size:12px; line-height:1.6; color:#6b7280;">
                  Si tú no creaste esta cuenta, puedes ignorar este correo. Tu dirección de correo
                  no será asociada a ningún perfil en Bukipin.
                </p>
              </td>
            </tr>

            <!-- Footer -->
            <tr>
              <td style="padding:16px 28px 20px 28px; background-color:#020617; border-top:1px solid #111827;">
                <table role="presentation" width="100%">
                  <tr>
                    <td align="left" style="font-size:11px; color:#4b5563;">
                      © ${new Date().getFullYear()} Bukipin. Todos los derechos reservados.
                    </td>
                    <td align="right" style="font-size:11px; color:#6b7280;">
                      <a href="https://bukipin.com" style="color:#9ca3af; text-decoration:none;">Sitio web</a>
                      <span style="color:#4b5563;"> · </span>
                      <a href="mailto:contact@bukipin.com" style="color:#9ca3af; text-decoration:none;">Soporte</a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>

          <!-- Nota inferior -->
          <div style="max-width:560px; margin-top:16px; font-size:11px; line-height:1.5; color:#6b7280;">
            Estás recibiendo este mensaje porque se registró una cuenta en Bukipin
            utilizando esta dirección de correo. Si no reconoces esta acción, 
            puedes ignorar este correo de forma segura.
          </div>
        </td>
      </tr>
    </table>
  </body>
  </html>
  `;
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

    // URL que irá en el correo (backend expone /api/auth/verify-email)
    const clientUrl = getClientUrl();
    const verifyUrl = `${clientUrl}/api/auth/verify-email?token=${verificationToken}`;

    const html = buildVerificationEmail({ name, verifyUrl });

    try {
      await sendEmail({
        to: email,
        subject: "Confirma tu cuenta en Bukipin",
        html,
      });
    } catch (emailErr) {
      console.error("❌ Error enviando correo de verificación:", emailErr);

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
