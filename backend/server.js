// backend/server.js
require("dotenv").config();
const path = require("path");
const express = require("express");
const cookieParser = require("cookie-parser");

const connectDB = require("./config/db");

const app = express();
const PORT = process.env.PORT || 3000;

app.set("trust proxy", 1);

app.set("etag", false);

connectDB();

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.use("/api", (req, res, next) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Surrogate-Control", "no-store");
  next();
});

const publicRoot = path.join(__dirname, "..", "public");
app.use(express.static(publicRoot));

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    app: "bukipin-saas",
    time: new Date().toISOString(),
  });
});

app.use("/api/auth", require("./routes/auth"));


app.use("/api/uploads/autoridades-fiscales", require("./routes/uploadsAutoridadesFiscales"));
app.use("/api/uploads", require("./routes/uploadsGeneral"));

app.use("/api/transacciones/egresos", require("./routes/transaccionesEgresos"));

app.use("/api/movimientos-inventario", require("./routes/movimientosInventario"));

app.use("/api/cuentas", require("./routes/cuentas"));
app.use("/api/subcuentas", require("./routes/subcuentas"));
app.use("/api/productos", require("./routes/productos"));
app.use("/api/clientes", require("./routes/clientes"));
app.use("/api/proveedores", require("./routes/proveedores"));
app.use("/api/recomendaciones-depreciacion", require("./routes/recomendacionesDepreciacion"));

app.use("/api/accionistas", require("./routes/accionistas"));
app.use("/api/capital", require("./routes/capital"));

app.use("/api/ingresos", require("./routes/ingresos"));
app.use("/api/transacciones", require("./routes/transacciones"));

app.use("/api/inventario", require("./routes/inventario"));
app.use("/api/productos-egresos", require("./routes/productosEgresos"));

app.use("/api/asientos", require("./routes/asientos"));
app.use("/api/contabilidad", require("./routes/contabilidad"));

app.use("/api/impuestos", require("./routes/impuestos"));

app.use("/api/flujo-efectivo", require("./routes/flujoEfectivo"));

app.use("/api/dashboard", require("./routes/dashboard"));

app.use("/api/financiamientos", require("./routes/financiamientos"));
app.use("/api/deudores-financieros", require("./routes/deudoresFinancieros"));

app.use("/api/instituciones-financieras", require("./routes/institucionesFinancieras"));

app.use("/api/egresos", require("./routes/egresos"));

app.use("/api/cobros-pagos", require("./routes/cobrosPagos"));

app.use("/api/cxc", require("./routes/cxc"));

app.use("/api/cuentas-por-cobrar", require("./routes/cxc"));

app.use("/api/cxp", require("./routes/cxp"));

app.use("/api/inversiones", require("./routes/inversiones"));

app.use("/api/depreciaciones", require("./routes/depreciaciones"));

app.use("/api", require("./routes/placeholders"));

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

const loginIndexPath = path.join(publicRoot, "login", "index.html");

app.get("/", (req, res) => res.sendFile(loginIndexPath));
app.get("/login*", (req, res) => res.sendFile(loginIndexPath));
app.get("/recuperacion*", (req, res) => res.sendFile(loginIndexPath));

app.get("/dashboard*", (req, res) => {
  res.sendFile(path.join(publicRoot, "dashboard", "index.html"));
});

// Catch-all (no API)
app.use((req, res) => res.status(404).send("Ruta no encontrada"));

const { initCronJobs } = require("./utils/cronJobs");

app.listen(PORT, () => {
  console.log(`🚀 Bukipin backend escuchando en puerto ${PORT}`);
  initCronJobs();
});