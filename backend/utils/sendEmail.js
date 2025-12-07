// backend/utils/sendEmail.js
const nodemailer = require("nodemailer");

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

    const info = await transporter.sendMail({
      from: process.env.EMAIL_FROM,
      to,
      subject,
      html,
    });

    console.log("📧 Email enviado correctamente:", info.messageId);
  } catch (err) {
    console.error("❌ Error enviando correo:", err);
    throw err; // re-lanzamos para que lo capture el controlador y responda 500
  }
}

module.exports = sendEmail;
