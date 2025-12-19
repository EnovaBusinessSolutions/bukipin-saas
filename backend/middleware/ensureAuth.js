// backend/middleware/ensureAuth.js
const jwt = require("jsonwebtoken");
const User = require("../models/User");

module.exports = async function ensureAuth(req, res, next) {
  try {
    const token = req.cookies?.bukipin_token;
    if (!token) {
      return res.status(401).json({ message: "No autenticado." });
    }

    const payload = jwt.verify(token, process.env.JWT_SECRET || "dev-secret");
    const user = await User.findById(payload.id).select("_id name email isVerified");

    if (!user) {
      return res.status(401).json({ message: "Sesión inválida." });
    }
    if (!user.isVerified) {
      return res.status(403).json({ message: "Cuenta no verificada." });
    }

    req.user = user; // ✅ CLAVE: aquí vive el tenant (owner)
    next();
  } catch (err) {
    return res.status(401).json({ message: "Token inválido o expirado." });
  }
};
