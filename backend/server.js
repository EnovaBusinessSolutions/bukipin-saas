// backend/server.js
require("dotenv").config();
const path = require("path");
const express = require("express");
const cookieParser = require("cookie-parser");

const connectDB = require("./config/db");

const app = express();
const PORT = process.env.PORT || 3000;

// ✅ IMPORTANTE en Render/Proxies (cookies secure en producción)
app.set("trust proxy", 1);

// 🔌 Conectar a Mongo Atlas
connectDB();

// 🧱 Middlewares base
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// 📁 Carpeta raíz de estáticos (public/)
const publicRoot = path.join(__dirname, "..", "public");
app.use(express.static(publicRoot));

// ==============================
// ✅ API
// ==============================

// Auth
app.use("/api/auth", require("./routes/auth"));

// Registros / Catálogos (rutas en español)
app.use("/api", require("./routes/cuentas"));
app.use("/api", require("./routes/subcuentas"));
app.use("/api", require("./routes/productos"));
app.use("/api", require("./routes/clientes"));
app.use("/api", require("./routes/ingresos"));
app.use("/api", require("./routes/transacciones"));
app.use("/api", require("./routes/inventario"));

// ✅ Placeholders temporales (para que el dashboard no reviente con 404 mientras migras)
app.use("/api", require("./routes/placeholders"));

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

// ==============================
// ✅ SPAs
// ==============================

// Ruta común al index del SPA de landing + login
const loginIndexPath = path.join(publicRoot, "login", "index.html");

app.get("/", (req, res) => res.sendFile(loginIndexPath));
app.get("/login*", (req, res) => res.sendFile(loginIndexPath));
app.get("/recuperacion*", (req, res) => res.sendFile(loginIndexPath));

// Dashboard SPA
app.get("/dashboard*", (req, res) => {
  res.sendFile(path.join(publicRoot, "dashboard", "index.html"));
});

// Catch-all
app.use((req, res) => res.status(404).send("Ruta no encontrada"));

app.listen(PORT, () => console.log(`🚀 Bukipin backend escuchando en puerto ${PORT}`));
