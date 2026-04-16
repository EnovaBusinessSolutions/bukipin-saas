// backend/routes/uploadsGeneral.js
// Rutas de upload de imágenes para: activos (CAPEX) y productos de inventario
const express = require("express");
const fs = require("fs");
const path = require("path");
const multer = require("multer");

const ensureAuth = require("../middleware/ensureAuth");

const router = express.Router();

// ──────────────────────────────────────────────────────
// Helper: crear storage de multer para un subdirectorio
// ──────────────────────────────────────────────────────
function makeStorage(subfolder) {
  const uploadDir = path.join(__dirname, "..", "..", "public", "uploads", subfolder);
  fs.mkdirSync(uploadDir, { recursive: true });

  return multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname || "").toLowerCase() || ".png";
      const safeBase = path
        .basename(file.originalname || "img", ext)
        .replace(/[^a-zA-Z0-9-_]/g, "_")
        .slice(0, 60);
      const owner = req.user?._id ? String(req.user._id) : "anon";
      const stamp = Date.now();
      cb(null, `${owner}-${stamp}-${safeBase}${ext}`);
    },
  });
}

function makeUpload(subfolder, limitMB = 5, allowPdf = false) {
  return multer({
    storage: makeStorage(subfolder),
    limits: { fileSize: limitMB * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const isImage = file.mimetype && file.mimetype.startsWith("image/");
      const isPdf = allowPdf && file.mimetype === "application/pdf";
      if (!isImage && !isPdf) {
        return cb(new Error(allowPdf ? "Solo se permiten imágenes o PDF." : "Solo se permiten imágenes."));
      }
      cb(null, true);
    },
  });
}

// ──────────────────────────────────────────────────────
// POST /api/uploads/activos
// Usado por RegistroInversionForm.tsx para imágenes CAPEX
// ──────────────────────────────────────────────────────
const uploadActivos = makeUpload("activos");

router.post("/activos", ensureAuth, uploadActivos.single("file"), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ ok: false, message: "No se recibió ningún archivo." });
    }
    const url = `/uploads/activos/${req.file.filename}`;
    return res.status(201).json({
      ok: true,
      data: {
        url,
        publicUrl: url,
        imagen_url: url,
        filename: req.file.filename,
        size: req.file.size,
        mimetype: req.file.mimetype,
      },
    });
  } catch (err) {
    console.error("POST /api/uploads/activos error:", err);
    return res.status(500).json({ ok: false, message: "Error al subir imagen de activo." });
  }
});

// ──────────────────────────────────────────────────────
// POST /api/uploads/product-image
// Usado por useProductos.tsx (hook de inventario de productos)
// ──────────────────────────────────────────────────────
const uploadProductos = makeUpload("productos");

router.post("/product-image", ensureAuth, uploadProductos.single("file"), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ ok: false, message: "No se recibió ningún archivo." });
    }
    const url = `/uploads/productos/${req.file.filename}`;
    return res.status(201).json({
      ok: true,
      data: {
        url,
        publicUrl: url,
        imagen_url: url,
        filename: req.file.filename,
        size: req.file.size,
        mimetype: req.file.mimetype,
      },
    });
  } catch (err) {
    console.error("POST /api/uploads/product-image error:", err);
    return res.status(500).json({ ok: false, message: "Error al subir imagen de producto." });
  }
});

// ──────────────────────────────────────────────────────
// POST /api/uploads/comprobante-egreso
// Usado por ResumenEgresos.tsx para subir comprobantes de pago
// Espera campo "file" + campo opcional "transaccionId"
// ──────────────────────────────────────────────────────
const uploadComprobantes = makeUpload("comprobantes", 10, true); // 10 MB, acepta imágenes Y PDFs

router.post("/comprobante-egreso", ensureAuth, uploadComprobantes.single("file"), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ ok: false, message: "No se recibió ningún archivo." });
    }
    const url = `/uploads/comprobantes/${req.file.filename}`;
    return res.status(201).json({
      ok: true,
      data: {
        url,
        publicUrl: url,
        imagen_comprobante: url,
        filename: req.file.filename,
        size: req.file.size,
        mimetype: req.file.mimetype,
      },
    });
  } catch (err) {
    console.error("POST /api/uploads/comprobante-egreso error:", err);
    return res.status(500).json({ ok: false, message: "Error al subir comprobante." });
  }
});

// ──────────────────────────────────────────────────────
// POST /api/uploads/instituciones-financieras
// Usado por InstitucionFinancieraSelector.tsx para el logo de la institución
// ──────────────────────────────────────────────────────
const uploadInstitucionesFinancieras = makeUpload("instituciones-financieras");

router.post("/instituciones-financieras", ensureAuth, uploadInstitucionesFinancieras.single("file"), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ ok: false, message: "No se recibió ningún archivo." });
    }
    const url = `/uploads/instituciones-financieras/${req.file.filename}`;
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
    console.error("POST /api/uploads/instituciones-financieras error:", err);
    return res.status(500).json({ ok: false, message: "Error al subir logo de institución." });
  }
});

module.exports = router;
