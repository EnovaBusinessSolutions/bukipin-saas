// backend/routes/uploadsAutoridadesFiscales.js
const express = require("express");
const fs = require("fs");
const path = require("path");
const multer = require("multer");

const ensureAuth = require("../middleware/ensureAuth");

const router = express.Router();

const uploadDir = path.join(__dirname, "..", "..", "public", "uploads", "autoridades-fiscales");

fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase() || ".png";
    const safeBase = path
      .basename(file.originalname || "logo", ext)
      .replace(/[^a-zA-Z0-9-_]/g, "_")
      .slice(0, 60);

    const owner = req.user?._id ? String(req.user._id) : "anon";
    const stamp = Date.now();

    cb(null, `${owner}-${stamp}-${safeBase}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 2 * 1024 * 1024,
  },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype || !file.mimetype.startsWith("image/")) {
      return cb(new Error("Solo se permiten imágenes."));
    }
    cb(null, true);
  },
});

router.post("/logo", ensureAuth, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        ok: false,
        message: "No se recibió ningún archivo.",
      });
    }

    const url = `/uploads/autoridades-fiscales/${req.file.filename}`;

    return res.status(201).json({
      ok: true,
      data: {
        url,
        publicUrl: url,
        logo_url: url,
        filename: req.file.filename,
        size: req.file.size,
        mimetype: req.file.mimetype,
      },
    });
  } catch (err) {
    console.error("POST /api/uploads/autoridades-fiscales/logo error:", err);
    return res.status(500).json({
      ok: false,
      message: err?.message || "Error subiendo logo",
    });
  }
});

module.exports = router;