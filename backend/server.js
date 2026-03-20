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
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
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

// Healthcheck para Render / monitoreo
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    app: "bukipin-saas",
    time: new Date().toISOString(),
  });
});

// ------------------------------
// Auth
// ------------------------------
app.use("/api/auth", require("./routes/auth"));

// ------------------------------
// Rutas más específicas PRIMERO
// (para evitar que rutas generales las "secuesten")
// ------------------------------

// ✅ Uploads autoridades fiscales
app.use("/api/uploads/autoridades-fiscales", require("./routes/uploadsAutoridadesFiscales"));

// ✅ Transacciones Egresos (más específico que /api/transacciones)
app.use("/api/transacciones/egresos", require("./routes/transaccionesEgresos"));

// ✅ Inventario movimientos (más específico que /api/inventario si algún router comparte paths)
app.use("/api/movimientos-inventario", require("./routes/movimientosInventario"));

// ------------------------------
// Registros / Catálogos
// ------------------------------
app.use("/api/cuentas", require("./routes/cuentas"));
app.use("/api/subcuentas", require("./routes/subcuentas"));
app.use("/api/productos", require("./routes/productos"));
app.use("/api/clientes", require("./routes/clientes"));
app.use("/api/proveedores", require("./routes/proveedores"));
app.use("/api/recomendaciones-depreciacion", require("./routes/recomendacionesDepreciacion"));

// ✅ NUEVO: Accionistas / Capital
app.use("/api/accionistas", require("./routes/accionistas"));
app.use("/api/capital", require("./routes/capital"));

app.use("/api/ingresos", require("./routes/ingresos"));
app.use("/api/transacciones", require("./routes/transacciones"));

app.use("/api/inventario", require("./routes/inventario"));
app.use("/api/productos-egresos", require("./routes/productosEgresos"));

app.use("/api/asientos", require("./routes/asientos"));
app.use("/api/contabilidad", require("./routes/contabilidad"));

// ✅ NUEVO: Impuestos
app.use("/api/impuestos", require("./routes/impuestos"));

app.use("/api/flujo-efectivo", require("./routes/flujoEfectivo"));

// ✅ Financiamientos
app.use("/api/financiamientos", require("./routes/financiamientos"));

// ✅ Catálogo de instituciones financieras
app.use("/api/instituciones-financieras", require("./routes/institucionesFinancieras"));

app.use("/api/egresos", require("./routes/egresos"));

// ==============================
// ✅ CxC / Cobros-Pagos
// ==============================

// Cobros / Pagos (historial)
app.use("/api/cobros-pagos", require("./routes/cobrosPagos"));

// CxC nuevo
app.use("/api/cxc", require("./routes/cxc"));

// ✅ Alias legacy para compat con frontend viejo:
// POST /api/cuentas-por-cobrar/registrar-pago
app.use("/api/cuentas-por-cobrar", require("./routes/cxc"));

app.use("/api/cxp", require("./routes/cxp"));

app.use("/api/inversiones", require("./routes/inversiones"));

// ==============================
// ✅ Placeholders temporales (al final para no pisar rutas reales)
// ==============================
app.use("/api", require("./routes/placeholders"));

// 404 SOLO para /api (después de todas las rutas)
app.use("/api", (req, res) => {
  return res.status(404).json({
    ok: false,
    message: "Ruta API no encontrada",
    path: req.originalUrl,
  });
});

// Error handler (después de rutas /api)
app.use((err, req, res, _next) => {
  const status = err?.statusCode || err?.status || 500;
  console.error("🔥 API Error:", err);
  return res.status(status).json({
    ok: false,
    message: err?.message || "Error interno del servidor",
  });
});

// ==============================
// ✅ SPAs
// ==============================

const loginIndexPath = path.join(publicRoot, "login", "index.html");

app.get("/", (req, res) => res.sendFile(loginIndexPath));
app.get("/login*", (req, res) => res.sendFile(loginIndexPath));
app.get("/recuperacion*", (req, res) => res.sendFile(loginIndexPath));

app.get("/dashboard*", (req, res) => {
  res.sendFile(path.join(publicRoot, "dashboard", "index.html"));
});

// Catch-all (no API)
app.use((req, res) => res.status(404).send("Ruta no encontrada"));

app.listen(PORT, () => console.log(`🚀 Bukipin backend escuchando en puerto ${PORT}`));