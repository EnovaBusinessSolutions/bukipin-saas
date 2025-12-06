// backend/server.js
const path = require("path");
const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;

// Ruta absoluta a la carpeta "public" (subimos un nivel desde backend/)
const publicPath = path.join(__dirname, "..", "public");

// Servir archivos estáticos del build de Vite
app.use(express.static(publicPath));

// Ejemplo de ruta API (para probar más adelante)
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", app: "bukipin-saas" });
});

// Cualquier otra ruta devuelve index.html (SPA / React Router)
app.get("*", (req, res) => {
  res.sendFile(path.join(publicPath, "index.html"));
});

app.listen(PORT, () => {
  console.log(`Bukipin backend escuchando en puerto ${PORT}`);
});
