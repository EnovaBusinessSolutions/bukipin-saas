const path = require("path");
const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;

// 👉 Ahora apuntamos a /public/login
const publicPath = path.join(__dirname, "..", "public", "login");

// Servir archivos estáticos del build de Vite
app.use(express.static(publicPath));

// Ejemplo de ruta API
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", app: "bukipin-saas" });
});

// Cualquier ruta devuelve index.html (SPA)
app.get("*", (req, res) => {
  res.sendFile(path.join(publicPath, "index.html"));
});

app.listen(PORT, () => {
  console.log(`Bukipin backend escuchando en puerto ${PORT}`);
});
