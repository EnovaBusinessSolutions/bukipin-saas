// backend/utils/sendEmail.js
const nodemailer = require("nodemailer");

// 🚀 Transporter SMTP
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT) || 465,
  secure: Number(process.env.SMTP_PORT) === 465, // true si usas 465 (SSL), false si usas 587
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

async function sendEmail({ to, subject, html }) {
  try {
    if (!to) {
      throw new Error("Falta el destinatario (to) en sendEmail");
    }

    // 🏷️ Nombre y correo que se verán en Gmail
    const fromName = process.env.SMTP_FROM_NAME || "Bukipin.com";
    const fromEmail =
      process.env.SMTP_FROM_EMAIL ||
      process.env.EMAIL_FROM || // compatibilidad con tu variable actual
      "contact@bukipin.com";

    const info = await transporter.sendMail({
      from: `"${fromName}" <${fromEmail}>`, // 👈 aquí se define lo que verá el usuario
      to,
      subject,
      html,
    });

    console.log("📧 Email enviado correctamente:", info.messageId);
  } catch (err) {
    console.error("❌ Error enviando correo:", err);
    // re-lanzamos para que lo capture el controlador y responda 500
    throw err;
  }
}

module.exports = sendEmail;
