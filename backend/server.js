const path = require("path");
const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;

// 📁 Carpeta raíz de estáticos (public/)
const publicRoot = path.join(__dirname, "..", "public");

// Servir todos los assets estáticos (CSS, JS, imágenes, etc.)
app.use(express.static(publicRoot));

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
 * Muestra la landing (React se encarga de renderizar <Index /> en "/")
 */
app.get("/", (req, res) => {
  res.sendFile(loginIndexPath);
});

/**
 * LOGIN (SPA)
 * /login y cualquier subruta devuelven el mismo index del login
 * React Router decide si mostrar <Auth /> o NotFound
 */
app.get("/login*", (req, res) => {
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
 * (si más adelante tienes otras SPAs, se pueden añadir arriba
 *  antes de este middleware)
 */
app.use((req, res) => {
  res.status(404).send("Ruta no encontrada");
});

app.listen(PORT, () => {
  console.log(`🚀 Bukipin backend escuchando en puerto ${PORT}`);
});
