// backend/config/db.js
const mongoose = require("mongoose");

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI);
    console.log("MongoDB conectado:", conn.connection.host);
  } catch (err) {
    console.error("Error conectando a MongoDB", err);
    process.exit(1);
  }
};

module.exports = connectDB;
