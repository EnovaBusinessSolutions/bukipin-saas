// backend/routes/institucionesFinancieras.js
const express = require("express");
const mongoose = require("mongoose");
const ensureAuth = require("../middleware/ensureAuth");

const router = express.Router();

// =====================================================
// Model (safe/fallback)
// =====================================================
function getFinancialInstitutionModel() {
  if (mongoose.models.FinancialInstitution) return mongoose.models.FinancialInstitution;

  const FinancialInstitutionSchema = new mongoose.Schema(
    {
      owner: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: null,
        index: true,
      },

      // system = catálogo base compartido
      // user   = catálogo personalizado por usuario
      scope: {
        type: String,
        enum: ["system", "user"],
        default: "user",
        index: true,
      },

      nombre: {
        type: String,
        required: true,
        trim: true,
        index: true,
      },

      alias: {
        type: String,
        trim: true,
        default: "",
      },

      slug: {
        type: String,
        trim: true,
        default: "",
        index: true,
      },

      tipo: {
        type: String,
        trim: true,
        enum: [
          "banco",
          "fintech",
          "sofol",
          "arrendadora",
          "union_credito",
          "caja_popular",
          "proveedor",
          "accionista",
          "intercompania",
          "gobierno",
          "otro",
        ],
        default: "banco",
        index: true,
      },

      categoria: {
        type: String,
        trim: true,
        enum: [
          "bancario",
          "financiero",
          "proveedor",
          "accionista",
          "intercompania",
          "gobierno",
          "otro",
        ],
        default: "financiero",
        index: true,
      },

      codigo: {
        type: String,
        trim: true,
        default: "",
        index: true,
      },

      descripcion: {
        type: String,
        trim: true,
        default: "",
      },

      telefono: {
        type: String,
        trim: true,
        default: "",
      },

      email: {
        type: String,
        trim: true,
        default: "",
      },

      sitio_web: {
        type: String,
        trim: true,
        default: "",
      },

      contacto_nombre: {
        type: String,
        trim: true,
        default: "",
      },

      contacto_puesto: {
        type: String,
        trim: true,
        default: "",
      },

      notas: {
        type: String,
        trim: true,
        default: "",
      },

      activo: {
        type: Boolean,
        default: true,
        index: true,
      },
    },
    { timestamps: true, minimize: false }
  );

  FinancialInstitutionSchema.index({ owner: 1, activo: 1, nombre: 1 });
  FinancialInstitutionSchema.index({ owner: 1, tipo: 1, categoria: 1 });
  FinancialInstitutionSchema.index({ scope: 1, activo: 1, nombre: 1 });

  return mongoose.model("FinancialInstitution", FinancialInstitutionSchema);
}

const FinancialInstitution = getFinancialInstitutionModel();

// =====================================================
// Catálogo base del sistema
// =====================================================
const SYSTEM_INSTITUTIONS = [
  { id: "sys:bbva", nombre: "BBVA", tipo: "banco", categoria: "bancario", codigo: "BBVA", alias: "" },
  { id: "sys:banorte", nombre: "Banorte", tipo: "banco", categoria: "bancario", codigo: "BANORTE", alias: "" },
  { id: "sys:banamex", nombre: "Citibanamex", tipo: "banco", categoria: "bancario", codigo: "BANAMEX", alias: "" },
  { id: "sys:santander", nombre: "Santander", tipo: "banco", categoria: "bancario", codigo: "SANTANDER", alias: "" },
  { id: "sys:hsbc", nombre: "HSBC", tipo: "banco", categoria: "bancario", codigo: "HSBC", alias: "" },
  { id: "sys:scotiabank", nombre: "Scotiabank", tipo: "banco", categoria: "bancario", codigo: "SCOTIABANK", alias: "" },
  { id: "sys:inbursa", nombre: "Inbursa", tipo: "banco", categoria: "bancario", codigo: "INBURSA", alias: "" },
  { id: "sys:bajio", nombre: "Banco del Bajío", tipo: "banco", categoria: "bancario", codigo: "BAJIO", alias: "BanBajío" },
  { id: "sys:nu", nombre: "Nu", tipo: "fintech", categoria: "financiero", codigo: "NU", alias: "Nu México" },
  { id: "sys:mercadopago", nombre: "Mercado Pago", tipo: "fintech", categoria: "financiero", codigo: "MP", alias: "" },
  { id: "sys:klar", nombre: "Klar", tipo: "fintech", categoria: "financiero", codigo: "KLAR", alias: "" },
  { id: "sys:konfio", nombre: "Konfío", tipo: "fintech", categoria: "financiero", codigo: "KONFIO", alias: "" },
  { id: "sys:stori", nombre: "Stori", tipo: "fintech", categoria: "financiero", codigo: "STORI", alias: "" },
  { id: "sys:acreedor-diverso", nombre: "Acreedor Diverso", tipo: "otro", categoria: "otro", codigo: "ACREEDOR_DIVERSO", alias: "" },
];

// =====================================================
// Helpers
// =====================================================
function asTrim(v, def = "") {
  if (v === undefined || v === null) return def;
  return String(v).trim();
}

function asBool(v, def = null) {
  if (v === undefined || v === null || v === "") return def;
  const s = String(v).trim().toLowerCase();
  if (["true", "1", "yes", "y", "si", "sí"].includes(s)) return true;
  if (["false", "0", "no", "n"].includes(s)) return false;
  return def;
}

function slugify(v) {
  return String(v || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function uniqBy(arr, getKey) {
  const seen = new Set();
  const out = [];
  for (const item of arr || []) {
    const key = getKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function textIncludes(haystack, needle) {
  return String(haystack || "").toLowerCase().includes(String(needle || "").toLowerCase());
}

function mapInstitutionForUI(doc) {
  const d = doc?.toObject ? doc.toObject() : doc || {};
  const id = String(d._id || d.id || "");

  return {
    id,
    _id: d._id || null,

    nombre: d.nombre || "",
    alias: d.alias || "",
    slug: d.slug || slugify(d.nombre || ""),
    tipo: d.tipo || "otro",
    categoria: d.categoria || "otro",
    codigo: d.codigo || "",

    descripcion: d.descripcion || "",
    telefono: d.telefono || "",
    email: d.email || "",
    sitio_web: d.sitio_web || "",
    sitioWeb: d.sitio_web || "",

    contacto_nombre: d.contacto_nombre || "",
    contactoNombre: d.contacto_nombre || "",
    contacto_puesto: d.contacto_puesto || "",
    contactoPuesto: d.contacto_puesto || "",

    notas: d.notas || "",

    activo: !!d.activo,
    scope: d.scope || "user",
    owner: d.owner || null,
    isSystem: d.scope === "system",

    created_at: d.createdAt || null,
    updated_at: d.updatedAt || null,
    createdAt: d.createdAt || null,
    updatedAt: d.updatedAt || null,
  };
}

function mapSystemInstitutionForUI(item) {
  const now = null;
  return {
    id: item.id,
    _id: null,

    nombre: item.nombre || "",
    alias: item.alias || "",
    slug: slugify(item.nombre || ""),
    tipo: item.tipo || "otro",
    categoria: item.categoria || "otro",
    codigo: item.codigo || "",

    descripcion: item.descripcion || "",
    telefono: "",
    email: "",
    sitio_web: "",
    sitioWeb: "",

    contacto_nombre: "",
    contactoNombre: "",
    contacto_puesto: "",
    contactoPuesto: "",

    notas: "",

    activo: true,
    scope: "system",
    owner: null,
    isSystem: true,

    created_at: now,
    updated_at: now,
    createdAt: now,
    updatedAt: now,
  };
}

function normalizeTipo(v) {
  const s = asTrim(v).toLowerCase();
  const allowed = new Set([
    "banco",
    "fintech",
    "sofol",
    "arrendadora",
    "union_credito",
    "caja_popular",
    "proveedor",
    "accionista",
    "intercompania",
    "gobierno",
    "otro",
  ]);
  return allowed.has(s) ? s : "otro";
}

function normalizeCategoria(v) {
  const s = asTrim(v).toLowerCase();
  const allowed = new Set([
    "bancario",
    "financiero",
    "proveedor",
    "accionista",
    "intercompania",
    "gobierno",
    "otro",
  ]);
  return allowed.has(s) ? s : "otro";
}

async function loadMergedInstitutions({ owner, activo = null, q = "", tipo = "", categoria = "" }) {
  const filter = {
    $or: [{ scope: "system" }, { owner, scope: "user" }],
  };

  if (activo !== null) filter.activo = !!activo;
  if (tipo) filter.tipo = normalizeTipo(tipo);
  if (categoria) filter.categoria = normalizeCategoria(categoria);

  const docs = await FinancialInstitution.find(filter).sort({ nombre: 1, createdAt: -1 }).lean();
  const dbItems = docs.map(mapInstitutionForUI);

  const systemFallback = SYSTEM_INSTITUTIONS.map(mapSystemInstitutionForUI);

  // Mezclar catálogo base con DB evitando duplicados por nombre+tipo cuando ya exista versión en DB
  const merged = uniqBy(
    [...dbItems, ...systemFallback],
    (x) => `${String(x.nombre || "").toLowerCase()}::${String(x.tipo || "").toLowerCase()}`
  );

  let items = merged;

  if (activo !== null) {
    items = items.filter((x) => !!x.activo === !!activo);
  }
  if (tipo) {
    const t = normalizeTipo(tipo);
    items = items.filter((x) => x.tipo === t);
  }
  if (categoria) {
    const c = normalizeCategoria(categoria);
    items = items.filter((x) => x.categoria === c);
  }
  if (q) {
    items = items.filter((x) =>
      [
        x.nombre,
        x.alias,
        x.codigo,
        x.tipo,
        x.categoria,
        x.descripcion,
        x.contacto_nombre,
        x.contacto_puesto,
      ].some((v) => textIncludes(v, q))
    );
  }

  items.sort((a, b) => String(a.nombre || "").localeCompare(String(b.nombre || ""), "es", { sensitivity: "base" }));
  return items;
}

// =====================================================
// Routes
// =====================================================

/**
 * GET /api/instituciones-financieras
 * Devuelve ARRAY por default para dropdowns
 * Soporta wrap=1 => { ok, data, items }
 *
 * Query params:
 * - activo=true|false
 * - q=texto
 * - tipo=banco|fintech|...
 * - categoria=bancario|financiero|...
 * - wrap=1
 */
router.get("/", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;
    const wrap = asTrim(req.query.wrap) === "1";
    const activo = asBool(req.query.activo, true);
    const q = asTrim(req.query.q, "");
    const tipo = asTrim(req.query.tipo, "");
    const categoria = asTrim(req.query.categoria, "");

    const items = await loadMergedInstitutions({
      owner,
      activo,
      q,
      tipo,
      categoria,
    });

    if (!wrap) return res.json(items);
    return res.json({ ok: true, data: items, items });
  } catch (err) {
    console.error("GET /api/instituciones-financieras error:", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR", message: err?.message || "SERVER_ERROR" });
  }
});

/**
 * GET /api/instituciones-financieras/catalogo/tipos
 */
router.get("/catalogo/tipos", ensureAuth, async (_req, res) => {
  const items = [
    { value: "banco", label: "Banco" },
    { value: "fintech", label: "Fintech" },
    { value: "sofol", label: "SOFOL" },
    { value: "arrendadora", label: "Arrendadora" },
    { value: "union_credito", label: "Unión de crédito" },
    { value: "caja_popular", label: "Caja popular" },
    { value: "proveedor", label: "Proveedor" },
    { value: "accionista", label: "Accionista" },
    { value: "intercompania", label: "Intercompañía" },
    { value: "gobierno", label: "Gobierno" },
    { value: "otro", label: "Otro" },
  ];
  return res.json({ ok: true, data: items, items });
});

/**
 * GET /api/instituciones-financieras/catalogo/categorias
 */
router.get("/catalogo/categorias", ensureAuth, async (_req, res) => {
  const items = [
    { value: "bancario", label: "Bancario" },
    { value: "financiero", label: "Financiero" },
    { value: "proveedor", label: "Proveedor" },
    { value: "accionista", label: "Accionista" },
    { value: "intercompania", label: "Intercompañía" },
    { value: "gobierno", label: "Gobierno" },
    { value: "otro", label: "Otro" },
  ];
  return res.json({ ok: true, data: items, items });
});

/**
 * GET /api/instituciones-financieras/:id
 * Soporta ids de sistema: sys:bbva, etc.
 */
router.get("/:id", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;
    const id = asTrim(req.params.id, "");

    if (!id) {
      return res.status(400).json({ ok: false, error: "VALIDATION", message: "id requerido" });
    }

    if (id.startsWith("sys:")) {
      const found = SYSTEM_INSTITUTIONS.find((x) => x.id === id);
      if (!found) return res.status(404).json({ ok: false, error: "NOT_FOUND" });
      const item = mapSystemInstitutionForUI(found);
      return res.json({ ok: true, data: item, item, ...item });
    }

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ ok: false, error: "VALIDATION", message: "id inválido" });
    }

    const doc = await FinancialInstitution.findOne({
      _id: id,
      $or: [{ scope: "system" }, { owner, scope: "user" }],
    }).lean();

    if (!doc) return res.status(404).json({ ok: false, error: "NOT_FOUND" });

    const item = mapInstitutionForUI(doc);
    return res.json({ ok: true, data: item, item, ...item });
  } catch (err) {
    console.error("GET /api/instituciones-financieras/:id error:", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR", message: err?.message || "SERVER_ERROR" });
  }
});

/**
 * POST /api/instituciones-financieras
 * Crea institución personalizada del usuario
 */
router.post("/", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;

    const nombre = asTrim(req.body?.nombre || req.body?.name);
    const alias = asTrim(req.body?.alias, "");
    const tipo = normalizeTipo(req.body?.tipo);
    const categoria = normalizeCategoria(req.body?.categoria);
    const codigo = asTrim(req.body?.codigo, "");
    const descripcion = asTrim(req.body?.descripcion, "");
    const telefono = asTrim(req.body?.telefono, "");
    const email = asTrim(req.body?.email, "");
    const sitio_web = asTrim(req.body?.sitio_web || req.body?.sitioWeb, "");
    const contacto_nombre = asTrim(req.body?.contacto_nombre || req.body?.contactoNombre, "");
    const contacto_puesto = asTrim(req.body?.contacto_puesto || req.body?.contactoPuesto, "");
    const notas = asTrim(req.body?.notas, "");
    const activo = asBool(req.body?.activo, true);

    if (!nombre) {
      return res.status(400).json({
        ok: false,
        error: "VALIDATION",
        message: "nombre es requerido.",
      });
    }

    const created = await FinancialInstitution.create({
      owner,
      scope: "user",
      nombre,
      alias,
      slug: slugify(nombre),
      tipo,
      categoria,
      codigo,
      descripcion,
      telefono,
      email,
      sitio_web,
      contacto_nombre,
      contacto_puesto,
      notas,
      activo: activo !== null ? activo : true,
    });

    const item = mapInstitutionForUI(created);
    return res.status(201).json({ ok: true, data: item, item, ...item });
  } catch (err) {
    console.error("POST /api/instituciones-financieras error:", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR", message: err?.message || "SERVER_ERROR" });
  }
});

/**
 * PATCH /api/instituciones-financieras/:id
 * Solo instituciones user-owned
 */
router.patch("/:id", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;
    const id = asTrim(req.params.id, "");

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ ok: false, error: "VALIDATION", message: "id inválido" });
    }

    const current = await FinancialInstitution.findOne({ _id: id, owner, scope: "user" }).lean();
    if (!current) {
      return res.status(404).json({
        ok: false,
        error: "NOT_FOUND",
        message: "Institución no encontrada o no editable.",
      });
    }

    const patch = {};

    if (req.body?.nombre !== undefined || req.body?.name !== undefined) {
      patch.nombre = asTrim(req.body?.nombre || req.body?.name, "");
      if (!patch.nombre) {
        return res.status(400).json({
          ok: false,
          error: "VALIDATION",
          message: "nombre no puede ir vacío.",
        });
      }
      patch.slug = slugify(patch.nombre);
    }

    if (req.body?.alias !== undefined) patch.alias = asTrim(req.body?.alias, "");
    if (req.body?.tipo !== undefined) patch.tipo = normalizeTipo(req.body?.tipo);
    if (req.body?.categoria !== undefined) patch.categoria = normalizeCategoria(req.body?.categoria);
    if (req.body?.codigo !== undefined) patch.codigo = asTrim(req.body?.codigo, "");
    if (req.body?.descripcion !== undefined) patch.descripcion = asTrim(req.body?.descripcion, "");
    if (req.body?.telefono !== undefined) patch.telefono = asTrim(req.body?.telefono, "");
    if (req.body?.email !== undefined) patch.email = asTrim(req.body?.email, "");
    if (req.body?.sitio_web !== undefined || req.body?.sitioWeb !== undefined) {
      patch.sitio_web = asTrim(req.body?.sitio_web || req.body?.sitioWeb, "");
    }
    if (req.body?.contacto_nombre !== undefined || req.body?.contactoNombre !== undefined) {
      patch.contacto_nombre = asTrim(req.body?.contacto_nombre || req.body?.contactoNombre, "");
    }
    if (req.body?.contacto_puesto !== undefined || req.body?.contactoPuesto !== undefined) {
      patch.contacto_puesto = asTrim(req.body?.contacto_puesto || req.body?.contactoPuesto, "");
    }
    if (req.body?.notas !== undefined) patch.notas = asTrim(req.body?.notas, "");
    if (req.body?.activo !== undefined) patch.activo = asBool(req.body?.activo, true);

    const updated = await FinancialInstitution.findOneAndUpdate(
      { _id: id, owner, scope: "user" },
      patch,
      { new: true }
    ).lean();

    if (!updated) return res.status(404).json({ ok: false, error: "NOT_FOUND" });

    const item = mapInstitutionForUI(updated);
    return res.json({ ok: true, data: item, item, ...item });
  } catch (err) {
    console.error("PATCH /api/instituciones-financieras/:id error:", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR", message: err?.message || "SERVER_ERROR" });
  }
});

/**
 * DELETE /api/instituciones-financieras/:id
 * Hard delete solo para instituciones user-owned
 */
router.delete("/:id", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;
    const id = asTrim(req.params.id, "");

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ ok: false, error: "VALIDATION", message: "id inválido" });
    }

    const deleted = await FinancialInstitution.findOneAndDelete({
      _id: id,
      owner,
      scope: "user",
    }).lean();

    if (!deleted) {
      return res.status(404).json({
        ok: false,
        error: "NOT_FOUND",
        message: "Institución no encontrada o no eliminable.",
      });
    }

    return res.json({ ok: true, data: { id }, id });
  } catch (err) {
    console.error("DELETE /api/instituciones-financieras/:id error:", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR", message: err?.message || "SERVER_ERROR" });
  }
});

module.exports = router;