// backend/routes/cuentas.js
const express = require("express");
const router = express.Router();

const ensureAuth = require("../middleware/ensureAuth");
const Account = require("../models/Account");

function toStr(v) {
  if (v === null || typeof v === "undefined") return "";
  return String(v).trim();
}

function toBool(v) {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v === 1;
  if (typeof v === "string") return v.toLowerCase() === "true";
  return false;
}

/**
 * Inferencia de clasificación (fallback) por código:
 * - 1xxx Activos (Balance General)
 * - 2xxx Pasivos (Balance General)
 * - 3xxx Capital (Balance General)
 * - 4xxx Ingresos (Estado de Resultados)
 * - 5xxx/6xxx Egresos (Estado de Resultados)
 * - 7xxx Impuestos (Estado de Resultados)
 */
function deriveClasificacionFromCodigo(codigoRaw) {
  const codigo = toStr(codigoRaw);
  const n = parseInt(codigo, 10);

  // Defaults razonables
  let estado_financiero = "Sin estado";
  let grupo = "Sin grupo";
  let subgrupo = "General";

  if (!codigo) return { estado_financiero, grupo, subgrupo };

  const first = codigo[0];

  // Estado financiero
  if (first === "1" || first === "2" || first === "3") estado_financiero = "Balance General";
  else estado_financiero = "Estado de Resultados";

  // Grupo
  if (first === "1") grupo = "Activos";
  else if (first === "2") grupo = "Pasivos";
  else if (first === "3") grupo = "Capital Contable";
  else if (first === "4") grupo = "Ingresos";
  else if (first === "5" || first === "6") grupo = "Egresos";
  else if (first === "7") grupo = "Impuestos";
  else grupo = "General";

  // Subgrupos por rango (MVP, pero suficiente para replicar Bukipin2)
  if (!Number.isNaN(n)) {
    if (first === "1") {
      if (n >= 1000 && n < 1200) subgrupo = "Activo Circulante";
      else if (n >= 1200 && n < 1300) subgrupo = "Activo No Circulante";
      else if (n >= 1300 && n < 1400) subgrupo = "Activo Diferido";
      else subgrupo = "General";
    } else if (first === "2") {
      if (n >= 2000 && n < 2100) subgrupo = "Pasivo Corto Plazo";
      else if (n >= 2100 && n < 2200) subgrupo = "Pasivo Largo Plazo";
      else subgrupo = "General";
    } else if (first === "3") {
      if (n >= 3000 && n < 3100) subgrupo = "Capital Contribuido";
      else if (n >= 3100 && n < 3200) subgrupo = "Capital Ganado";
      else if (n >= 3200 && n < 3300) subgrupo = "Capital Reembolsado";
      else subgrupo = "General";
    } else {
      // Para resultados, puedes extender luego. Por ahora:
      subgrupo = "General";
    }
  }

  return { estado_financiero, grupo, subgrupo };
}

/**
 * Heurística para "subcuenta" (las que crea tu módulo de subcuentas):
 * típicamente tienen parentCode y terminan en -01, .01, /01, etc.
 * Esto evita duplicarlas en el catálogo principal.
 */
function looksLikeSubcuenta(doc) {
  const parentCode = toStr(doc.parentCode);
  if (!parentCode) return false;

  const codigo = toStr(doc.codigo ?? doc.code);
  return /[-./]\d+$/.test(codigo); // 4001-01, 4001.01, 4001/01
}

/**
 * Normaliza salida (ES + EN) + clasificación contable
 */
function normalizeAccountOut(doc) {
  const codigo = toStr(doc.codigo ?? doc.code);
  const nombre = toStr(doc.nombre ?? doc.name);

  const estado_financiero_in = toStr(doc.estado_financiero ?? doc.estadoFinanciero);
  const grupo_in = toStr(doc.grupo);
  const subgrupo_in = toStr(doc.subgrupo);

  const derived =
    !estado_financiero_in || !grupo_in || !subgrupo_in
      ? deriveClasificacionFromCodigo(codigo)
      : null;

  const estado_financiero = estado_financiero_in || derived?.estado_financiero || "Sin estado";
  const grupo = grupo_in || derived?.grupo || "Sin grupo";
  const subgrupo = subgrupo_in || derived?.subgrupo || "General";

  return {
    id: doc._id,
    _id: doc._id,

    // canonical + alias
    codigo,
    nombre,
    code: codigo,
    name: nombre,

    type: doc.type ?? null,
    category: doc.category ?? "general",
    parentCode: doc.parentCode ?? null,

    isActive: typeof doc.isActive === "boolean" ? doc.isActive : true,
    isDefault: typeof doc.isDefault === "boolean" ? doc.isDefault : false,

    // ✅ CLASIFICACIÓN (lo que tu UI necesita)
    estado_financiero,
    grupo,
    subgrupo,

    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

// Soporta montajes:
//  - app.use("/api/cuentas", router) => GET /
//  - app.use("/api", router)        => GET /cuentas
router.get(["/", "/cuentas"], ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;

    const q = { owner };

    // active=true|false
    if (typeof req.query.active !== "undefined") {
      q.isActive = String(req.query.active) === "true";
    }

    /**
     * Comportamiento por defecto (FIX):
     * - Devuelve TODAS las cuentas (incluyendo las que tengan parentCode),
     *   pero EXCLUYE subcuentas “-01” para que no se dupliquen.
     *
     * Params:
     * - includeSubcuentas=true  => incluye también subcuentas “-01”
     * - onlySubcuentas=true     => sólo subcuentas “-01”
     */
    const includeSubcuentas = String(req.query.includeSubcuentas || "false") === "true";
    const onlySubcuentas = String(req.query.onlySubcuentas || "false") === "true";

    const items = await Account.find(q)
      .sort({ codigo: 1, code: 1 })
      .lean();

    let filtered = items;

    if (onlySubcuentas) {
      filtered = items.filter(looksLikeSubcuenta);
    } else if (!includeSubcuentas) {
      filtered = items.filter((x) => !looksLikeSubcuenta(x));
    }

    return res.json({ ok: true, data: filtered.map(normalizeAccountOut) });
  } catch (err) {
    console.error("GET /api/cuentas error:", err);
    return res.status(500).json({ ok: false, message: "Error cargando cuentas" });
  }
});

router.post(["/", "/cuentas"], ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;

    // Acepta ES o EN
    const codigo = toStr(req.body?.codigo ?? req.body?.code);
    const nombre = toStr(req.body?.nombre ?? req.body?.name);
    const type = toStr(req.body?.type);
    const category = toStr(req.body?.category || "general");
    const parentCodeRaw = req.body?.parentCode ?? null;
    const parentCode = parentCodeRaw ? toStr(parentCodeRaw) : null;

    // Campos de clasificación (opcionales)
    let estado_financiero = toStr(req.body?.estado_financiero ?? req.body?.estadoFinanciero);
    let grupo = toStr(req.body?.grupo);
    let subgrupo = toStr(req.body?.subgrupo);

    // Si no vienen, los derivamos
    if (!estado_financiero || !grupo || !subgrupo) {
      const d = deriveClasificacionFromCodigo(codigo);
      estado_financiero = estado_financiero || d.estado_financiero;
      grupo = grupo || d.grupo;
      subgrupo = subgrupo || d.subgrupo;
    }

    if (!codigo) return res.status(400).json({ ok: false, message: "Falta 'codigo'." });
    if (!nombre) return res.status(400).json({ ok: false, message: "Falta 'nombre'." });
    if (!type) return res.status(400).json({ ok: false, message: "Falta 'type'." });

    const created = await Account.create({
      owner,

      codigo,
      nombre,
      code: codigo,
      name: nombre,

      type,
      category,

      parentCode: parentCode || null,

      estado_financiero,
      grupo,
      subgrupo,

      isDefault: false,
      isActive: true,
    });

    return res.status(201).json({
      ok: true,
      data: normalizeAccountOut(created.toObject?.() || created),
    });
  } catch (err) {
    if (err && err.code === 11000) {
      return res.status(409).json({
        ok: false,
        message: "Ya existe una cuenta con ese código para este usuario.",
      });
    }
    console.error("POST /api/cuentas error:", err);
    return res.status(500).json({ ok: false, message: "Error creando cuenta" });
  }
});

router.put(["/:id", "/cuentas/:id"], ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;
    const { id } = req.params;

    const current = await Account.findOne({ _id: id, owner }).lean();
    if (!current) return res.status(404).json({ ok: false, message: "Cuenta no encontrada." });

    const patch = {};

    if (typeof req.body?.codigo !== "undefined" || typeof req.body?.code !== "undefined") {
      const nextCodigo = toStr(req.body?.codigo ?? req.body?.code);
      patch.codigo = nextCodigo;
      patch.code = nextCodigo;

      // si cambia código, recalcular clasificación si no mandan nada
      const hasClasif =
        typeof req.body?.estado_financiero !== "undefined" ||
        typeof req.body?.estadoFinanciero !== "undefined" ||
        typeof req.body?.grupo !== "undefined" ||
        typeof req.body?.subgrupo !== "undefined";

      if (!hasClasif) {
        const d = deriveClasificacionFromCodigo(nextCodigo);
        patch.estado_financiero = d.estado_financiero;
        patch.grupo = d.grupo;
        patch.subgrupo = d.subgrupo;
      }
    }

    if (typeof req.body?.nombre !== "undefined" || typeof req.body?.name !== "undefined") {
      const nextNombre = toStr(req.body?.nombre ?? req.body?.name);
      patch.nombre = nextNombre;
      patch.name = nextNombre;
    }

    if (typeof req.body?.type !== "undefined") patch.type = toStr(req.body.type);
    if (typeof req.body?.category !== "undefined") patch.category = toStr(req.body.category);
    if (typeof req.body?.parentCode !== "undefined") patch.parentCode = req.body.parentCode ? toStr(req.body.parentCode) : null;

    if (typeof req.body?.estado_financiero !== "undefined" || typeof req.body?.estadoFinanciero !== "undefined") {
      patch.estado_financiero = toStr(req.body?.estado_financiero ?? req.body?.estadoFinanciero);
    }
    if (typeof req.body?.grupo !== "undefined") patch.grupo = toStr(req.body.grupo);
    if (typeof req.body?.subgrupo !== "undefined") patch.subgrupo = toStr(req.body.subgrupo);

    if (typeof req.body?.isActive !== "undefined") patch.isActive = toBool(req.body.isActive);

    const updated = await Account.findOneAndUpdate(
      { _id: id, owner },
      { $set: patch },
      { new: true }
    ).lean();

    return res.json({ ok: true, data: normalizeAccountOut(updated) });
  } catch (err) {
    if (err && err.code === 11000) {
      return res.status(409).json({
        ok: false,
        message: "Ya existe una cuenta con ese código para este usuario.",
      });
    }
    console.error("PUT /api/cuentas/:id error:", err);
    return res.status(500).json({ ok: false, message: "Error actualizando cuenta" });
  }
});

router.delete(["/:id", "/cuentas/:id"], ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;
    const { id } = req.params;

    const current = await Account.findOne({ _id: id, owner }).lean();
    if (!current) return res.status(404).json({ ok: false, message: "Cuenta no encontrada." });

    await Account.findOneAndDelete({ _id: id, owner }).lean();
    return res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/cuentas/:id error:", err);
    return res.status(500).json({ ok: false, message: "Error eliminando cuenta" });
  }
});

module.exports = router;
