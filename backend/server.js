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

// ✅ NECESARIO para que req.cookies exista
app.use(cookieParser());

// 📁 Carpeta raíz de estáticos (public/)
const publicRoot = path.join(__dirname, "..", "public");
app.use(express.static(publicRoot));

// 🧩 Rutas API (auth)
app.use("/api/auth", require("./routes/auth"));

/**
 * Healthcheck para Render / monitoreo
 * GET /api/health
 */
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    app: "bukipin-saas",
    time: new Date().toISOString(),
  });
});

// Ruta común al index del SPA de landing + login
const loginIndexPath = path.join(publicRoot, "login", "index.html");

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
  res.sendFile(path.join(publicRoot, "dashboard", "index.html"));
});

/**
 * Catch-all para rutas no encontradas
 */
app.use((req, res) => {
  res.status(404).send("Ruta no encontrada");
});

app.listen(PORT, () => {
  console.log(`🚀 Bukipin backend escuchando en puerto ${PORT}`);
});
