const express = require("express");
const router = express.Router();
const ensureAuth = require("../middleware/ensureAuth");
const DepreciationRecommendation = require("../models/DepreciationRecommendation");

const DEFAULT_RECOMMENDATIONS = [
  {
    categoria_activo: "edificios",
    anos_recomendados: 20,
    anos_minimos: 20,
    anos_maximos: 50,
    descripcion: "Construcciones e inmuebles usados en la operación.",
  },
  {
    categoria_activo: "maquinaria",
    anos_recomendados: 10,
    anos_minimos: 5,
    anos_maximos: 15,
    descripcion: "Maquinaria y equipo productivo.",
  },
  {
    categoria_activo: "vehiculos",
    anos_recomendados: 4,
    anos_minimos: 4,
    anos_maximos: 5,
    descripcion: "Automóviles, transporte y unidades de reparto.",
  },
  {
    categoria_activo: "mobiliario",
    anos_recomendados: 10,
    anos_minimos: 5,
    anos_maximos: 10,
    descripcion: "Muebles y equipo de oficina.",
  },
  {
    categoria_activo: "equipo_oficina",
    anos_recomendados: 10,
    anos_minimos: 5,
    anos_maximos: 10,
    descripcion: "Equipo complementario de oficina.",
  },
  {
    categoria_activo: "equipo_computo",
    anos_recomendados: 3,
    anos_minimos: 3,
    anos_maximos: 4,
    descripcion: "Computadoras, laptops, servidores y periféricos.",
  },
  {
    categoria_activo: "otro",
    anos_recomendados: 5,
    anos_minimos: 3,
    anos_maximos: 10,
    descripcion: "Categoría general para activos no clasificados.",
  },
];

async function ensureDefaults() {
  const count = await DepreciationRecommendation.countDocuments();
  if (count > 0) return;

  await DepreciationRecommendation.insertMany(DEFAULT_RECOMMENDATIONS, { ordered: false }).catch(() => {});
}

router.get("/", ensureAuth, async (_req, res) => {
  try {
    await ensureDefaults();

    const docs = await DepreciationRecommendation.find({})
      .sort({ categoria_activo: 1 })
      .lean();

    return res.json({
      ok: true,
      data: docs,
      items: docs,
    });
  } catch (err) {
    console.error("GET /api/recomendaciones-depreciacion error:", err);
    return res.status(500).json({
      ok: false,
      error: "SERVER_ERROR",
      message: err?.message || "SERVER_ERROR",
    });
  }
});

module.exports = router;