// backend/server.js
require("dotenv").config();

const path = require("path");
const express = require("express");
const cookieParser = require("cookie-parser");

const connectDB = require("./config/db");

const app = express();
const PORT = process.env.PORT || 3000;

// ✅ IMPORTANTE en Render/Proxies (para cookies secure en producción)
app.set("trust proxy", 1);

// 🔌 Conectar a Mongo Atlas
connectDB();

// 🧱 Middlewares base
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ✅ Necesario para leer cookies (JWT)
app.use(cookieParser());

// 📁 Carpeta raíz de estáticos (public/)
const publicRoot = path.join(__dirname, "..", "public");
app.use(express.static(publicRoot));

/**
 * =========================
 * ✅ API ROUTES
 * =========================
 */

// Auth
app.use("/api/auth", require("./routes/auth"));

// ✅ Registros / Catálogos (API en español)
app.use("/api/cuentas", require("./routes/cuentas"));
app.use("/api/subcuentas", require("./routes/subcuentas"));
app.use("/api/productos", require("./routes/productos"));
app.use("/api/clientes", require("./routes/clientes"));
app.use("/api/ingresos", require("./routes/ingresos"));
app.use("/api/transacciones", require("./routes/transacciones"));
app.use("/api/inventario", require("./routes/inventario"));

/**
 * Healthcheck para Render / monitoreo
 * GET /api/health
 */
app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    status: "ok",
    app: "bukipin-saas",
    time: new Date().toISOString(),
  });
});

/**
 * =========================
 * ✅ SPA ROUTES (Frontend)
 * =========================
 */

// Ruta común al index del SPA de landing + login
const loginIndexPath = path.join(publicRoot, "login", "index.html");
const dashboardIndexPath = path.join(publicRoot, "dashboard", "index.html");

/**
 * Ruta raíz "/"
 */
app.get("/", (req, res) => {
  res.sendFile(loginIndexPath);
});

/**
 * LOGIN (SPA)
 */
app.get("/login*", (req, res) => {
  res.sendFile(loginIndexPath);
});

/**
 * RECUPERACIÓN DE CONTRASEÑA (SPA)
 */
app.get("/recuperacion*", (req, res) => {
  res.sendFile(loginIndexPath);
});

/**
 * DASHBOARD (SPA)
 */
app.get("/dashboard*", (req, res) => {
  res.sendFile(dashboardIndexPath);
});

/**
 * =========================
 * ✅ 404 / Error handlers
 * =========================
 */

// Si llega aquí y es /api/* => 404 JSON
app.use("/api", (req, res) => {
  res.status(404).json({ ok: false, message: "Endpoint no encontrado" });
});

// Catch-all para rutas no encontradas (no API)
app.use((req, res) => {
  res.status(404).send("Ruta no encontrada");
});

app.listen(PORT, () => {
  console.log(`🚀 Bukipin backend escuchando en puerto ${PORT}`);
});
