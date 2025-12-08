// backend/server.js
require("dotenv").config();
const path = require("path");
const express = require("express");
const connectDB = require("./config/db");

const app = express();
const PORT = process.env.PORT || 3000;

// 🔌 Conectar a Mongo Atlas
connectDB();

// 🧱 Middlewares base
app.use(express.json()); // para leer JSON del body

// 📁 Carpeta raíz de estáticos (public/)
const publicRoot = path.join(__dirname, "..", "public");

// Servir todos los assets estáticos (CSS, JS, imágenes, etc.)
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
 * Muestra la landing/login (React se encarga del contenido)
 */
app.get("/", (req, res) => {
  res.sendFile(loginIndexPath);
});

/**
 * LOGIN (SPA)
 * /login y cualquier subruta devuelven el mismo index del login
 */
app.get("/login*", (req, res) => {
  res.sendFile(loginIndexPath);
});

/**
 * RECUPERACIÓN DE CONTRASEÑA (SPA)
 * /recuperacion y cualquier subruta devuelven también el index del login
 * para que React Router maneje la ruta /recuperacion en el frontend
 */
app.get("/recuperacion*", (req, res) => {
  res.sendFile(loginIndexPath);
});

/**
 * DASHBOARD (SPA)
 * /dashboard y cualquier subruta devuelven el index del dashboard
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
