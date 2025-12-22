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

// ✅ Evita 304/ETag (MUY importante para APIs JSON con fetch)
app.set("etag", false);

// 🔌 Conectar a Mongo Atlas
connectDB();

// 🧱 Middlewares base
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// ✅ No-cache SOLO para /api (evita respuestas 304 con body vacío)
app.use("/api", (req, res, next) => {
  res.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, proxy-revalidate"
  );
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Surrogate-Control", "no-store");
  next();
});

// 📁 Carpeta raíz de estáticos (public/)
const publicRoot = path.join(__dirname, "..", "public");
app.use(express.static(publicRoot));

// ==============================
// ✅ API
// ==============================

// Healthcheck para Render / monitoreo (ponlo arriba para debugging rápido)
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    app: "bukipin-saas",
    time: new Date().toISOString(),
  });
});

// Auth
app.use("/api/auth", require("./routes/auth"));

// Registros / Catálogos (rutas en español)
app.use("/api/cuentas", require("./routes/cuentas"));
app.use("/api/subcuentas", require("./routes/subcuentas"));
app.use("/api/productos", require("./routes/productos"));
app.use("/api/clientes", require("./routes/clientes"));
app.use("/api/ingresos", require("./routes/ingresos"));
app.use("/api/transacciones", require("./routes/transacciones"));
app.use("/api/inventario", require("./routes/inventario"));
app.use("/api/contabilidad", require("./routes/contabilidad"));
app.use("/api/movimientos-inventario", require("./routes/movimientosInventario"));
app.use("/api/asientos", require("./routes/asientos"));
app.use("/api/productos-egresos", require("./routes/productosEgresos"));



// ✅ Legacy endpoints (agrégalos aquí cuando los crees)
// Ejemplo: UI está pidiendo /api/movimientos-inventario (404 hoy)
// app.use("/api/movimientos-inventario", require("./routes/movimientosInventario"));

// ✅ Placeholders temporales (para que el dashboard no reviente con 404 mientras migras)
// OJO: deben ir al final de /api para no “pisar” rutas reales.
app.use("/api", require("./routes/placeholders"));

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

app.listen(PORT, () =>
  console.log(`🚀 Bukipin backend escuchando en puerto ${PORT}`)
);
