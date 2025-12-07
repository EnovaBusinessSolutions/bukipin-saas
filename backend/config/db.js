// backend/config/db.js
const mongoose = require("mongoose");

const connectDB = async () => {
  // 👀 1) Leemos SIEMPRE desde MONGO_URI
  const uri = process.env.MONGO_URI;

  // 2) Validación fuerte para no intentar conectar con undefined
  if (!uri) {
    console.error("❌ MONGO_URI no está definido. Revisa las variables de entorno (.env / Render).");
    process.exit(1);
  }

  try {
    await mongoose.connect(uri);
    console.log("✅ MongoDB conectado correctamente");
  } catch (err) {
    console.error("❌ Error conectando a MongoDB:", err.message);
    process.exit(1);
  }
};

module.exports = connectDB;
