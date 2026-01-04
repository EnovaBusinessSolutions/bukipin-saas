// backend/routes/cuentas.js
const express = require("express");
const router = express.Router();

const ensureAuth = require("../middleware/ensureAuth");
const Account = require("../models/Account");

// Helpers
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

function getCodigo(doc) {
  return toStr(doc?.codigo ?? doc?.code ?? doc?.cuenta_codigo ?? "");
}
function getNombre(doc) {
  return toStr(doc?.nombre ?? doc?.name ?? doc?.descripcion ?? "");
}

/**
 * Inferencias estilo Bukipin 2 para estado/grupo/subgrupo a partir del código.
 * (solo se usan si el documento no trae esos campos)
 */
function inferEstadoGrupoSubgrupoByCodigo(codigo) {
  const c = String(codigo || "").replace(/\s+/g, "");
  const n1 = c.slice(0, 1); // 1..7
  const n2 = c.slice(0, 2); // 11,12,13,21...

  let estado_financiero = "Estado de Resultados";
  let grupo = "Otros Ingresos y Gastos";

  if (n1 === "1") {
    estado_financiero = "Balance General";
    grupo = "Activos";
  } else if (n1 === "2") {
    estado_financiero = "Balance General";
    grupo = "Pasivos";
  } else if (n1 === "3") {
    estado_financiero = "Balance General";
    grupo = "Capital Contable";
  } else if (n1 === "4") {
    estado_financiero = "Estado de Resultados";
    grupo = "Ingresos";
  } else if (n1 === "5") {
    estado_financiero = "Estado de Resultados";
    grupo = "Egresos";
  } else if (n1 === "6") {
    estado_financiero = "Estado de Resultados";
    grupo = "Impuestos";
  } else if (n1 === "7") {
    estado_financiero = "Estado de Resultados";
    grupo = "Otros Ingresos y Gastos";
  }

  let subgrupo = "General";

  if (grupo === "Activos") {
    if (n2 === "11") subgrupo = "Activo Circulante";
    else if (n2 === "12") subgrupo = "Activo No Circulante";
    else if (n2 === "13") subgrupo = "Activo Diferido";
    else subgrupo = "Activo Circulante";
  }

  if (grupo === "Pasivos") {
    if (n2 === "21") subgrupo = "Pasivo Corto Plazo";
    else if (n2 === "22") subgrupo = "Pasivo Largo Plazo";
    else if (n2 === "23") subgrupo = "Pasivo Diferido";
    else subgrupo = "Pasivo Corto Plazo";
  }

  if (grupo === "Capital Contable") {
    if (n2 === "31") subgrupo = "Capital Contribuido";
    else if (n2 === "32") subgrupo = "Capital Ganado";
    else subgrupo = "Capital Contribuido";
  }

  if (grupo === "Ingresos") {
    if (n2 === "41") subgrupo = "Ingresos Operativos";
    else if (n2 === "42") subgrupo = "Otros Ingresos";
    else subgrupo = "Ingresos Operativos";
  }

  if (grupo === "Egresos") {
    if (n2 === "51") subgrupo = "Costo de Ventas";
    else if (n2 === "52") subgrupo = "Gastos Operativos";
    else if (n2 === "53") subgrupo = "Gastos Financieros";
    else subgrupo = "Gastos Operativos";
  }

  if (grupo === "Impuestos") subgrupo = "Impuestos";
  if (grupo === "Otros Ingresos y Gastos") subgrupo = "Otros";

  return { estado_financiero, grupo, subgrupo };
}

/**
 * Normaliza una cuenta a un formato seguro (ES + EN) + campos financieros.
 */
function normalizeAccountOut(doc) {
  const codigo = getCodigo(doc);
  const nombre = getNombre(doc);

  const estado_financiero_raw = toStr(doc?.estado_financiero ?? doc?.estadoFinanciero ?? "");
  const grupo_raw = toStr(doc?.grupo ?? doc?.group ?? doc?.categoria ?? "");
  const subgrupo_raw = toStr(doc?.subgrupo ?? doc?.subGrupo ?? "");

  const inferred = inferEstadoGrupoSubgrupoByCodigo(codigo);

  const estado_financiero = estado_financiero_raw || inferred.estado_financiero;
  const grupo = grupo_raw || inferred.grupo;
  const subgrupo = subgrupo_raw || inferred.subgrupo;

  return {
    id: doc._id,
    _id: doc._id,

    // canonical
    codigo,
    nombre,

    // alias compat
    code: codigo,
    name: nombre,

    type: doc.type ?? null,
    category: doc.category ?? "general",
    parentCode: doc.parentCode ?? null,

    isActive: typeof doc.isActive === "boolean" ? doc.isActive : true,
    isDefault: typeof doc.isDefault === "boolean" ? doc.isDefault : false,

    // ✅ campos contables que necesita el frontend
    estado_financiero,
    grupo,
    subgrupo,

    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

/**
 * Determina si una cuenta "doc" es cuenta madre: parentCode == null/undefined
 */
function isParentAccount(doc) {
  return !doc.parentCode;
}

/**
 * Revisa si existen subcuentas hijas de un codigo (parentCode)
 */
async function hasChildren({ owner, parentCode }) {
  return !!(await Account.exists({ owner, parentCode }));
}

// Soporta montajes:
//  - app.use("/api/cuentas", router) => GET /
//  - app.use("/api", router)        => GET /cuentas
const GET_PATHS = ["/", "/cuentas"];
const POST_PATHS = ["/", "/cuentas"];

router.get(GET_PATHS, ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;
    const q = { owner };

    // active=true|false
    if (typeof req.query.active !== "undefined") {
      q.isActive = String(req.query.active) === "true";
    }

    /**
     * ✅ NUEVO comportamiento:
     * - Por defecto: trae TODO (madres + subcuentas) para alimentar el catálogo completo.
     *
     * Params soportados:
     * - onlyMadres=true      => solo cuentas madre
     * - onlySubcuentas=true  => solo subcuentas
     * - includeSubcuentas=... (compat legacy)
     */
    const onlyMadres = String(req.query.onlyMadres || "false") === "true";
    const onlySubcuentas = String(req.query.onlySubcuentas || "false") === "true";
    const includeSubcuentas = String(req.query.includeSubcuentas || "true") === "true"; // ✅ default true

    if (onlySubcuentas) {
      q.parentCode = { $exists: true, $ne: null };
    } else if (onlyMadres || !includeSubcuentas) {
      q.$or = [{ parentCode: null }, { parentCode: { $exists: false } }];
    }
    // else: includeSubcuentas=true => no filtro extra

    const items = await Account.find(q).lean();

    const normalized = items
      .map(normalizeAccountOut)
      .filter((c) => c.codigo);

    // orden por codigo (numérico si puede)
    normalized.sort((a, b) => String(a.codigo).localeCompare(String(b.codigo)));

    return res.json({ ok: true, data: normalized });
  } catch (err) {
    console.error("GET /api/cuentas error:", err);
    return res.status(500).json({ ok: false, message: "Error cargando cuentas" });
  }
});

router.post(POST_PATHS, ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;

    // Acepta ES o EN
    const codigo = toStr(req.body?.codigo ?? req.body?.code);
    const nombre = toStr(req.body?.nombre ?? req.body?.name);
    const type = toStr(req.body?.type);
    const category = toStr(req.body?.category || "general");
    const parentCodeRaw = req.body?.parentCode ?? null;
    const parentCode = parentCodeRaw ? toStr(parentCodeRaw) : null;

    // Esta ruta es para CUENTAS MADRE.
    if (parentCode) {
      return res.status(400).json({
        ok: false,
        message: "Para crear subcuentas usa POST /api/subcuentas (no /api/cuentas).",
      });
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
      parentCode: null,
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

// Soporta montajes:
//  - /api/cuentas/:id
//  - /api/cuentas/cuentas/:id
const PUT_PATHS = ["/:id", "/cuentas/:id"];
const DELETE_PATHS = ["/:id", "/cuentas/:id"];

router.put(PUT_PATHS, ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;
    const { id } = req.params;

    const current = await Account.findOne({ _id: id, owner }).lean();
    if (!current) return res.status(404).json({ ok: false, message: "Cuenta no encontrada." });

    const patch = {};

    const nextCodigo =
      typeof req.body?.codigo !== "undefined" || typeof req.body?.code !== "undefined"
        ? toStr(req.body?.codigo ?? req.body?.code)
        : null;

    if (nextCodigo !== null) {
      const currentCodigo = String(current.codigo ?? current.code ?? "").trim();
      if (isParentAccount(current) && nextCodigo && nextCodigo !== currentCodigo) {
        const children = await hasChildren({ owner, parentCode: currentCodigo });
        if (children) {
          return res.status(409).json({
            ok: false,
            message:
              "No puedes cambiar el código de esta cuenta porque tiene subcuentas asociadas. Elimina/migra subcuentas primero.",
          });
        }
      }
      patch.codigo = nextCodigo;
      patch.code = nextCodigo;
    }

    const nextNombre =
      typeof req.body?.nombre !== "undefined" || typeof req.body?.name !== "undefined"
        ? toStr(req.body?.nombre ?? req.body?.name)
        : null;

    if (nextNombre !== null) {
      patch.nombre = nextNombre;
      patch.name = nextNombre;
    }

    if (typeof req.body?.type !== "undefined") patch.type = toStr(req.body.type);
    if (typeof req.body?.category !== "undefined") patch.category = toStr(req.body.category);

    if (typeof req.body?.parentCode !== "undefined") {
      const requested = req.body.parentCode ? toStr(req.body.parentCode) : null;
      if (requested) {
        return res.status(400).json({
          ok: false,
          message:
            "No se permite asignar parentCode desde /api/cuentas. Para subcuentas usa /api/subcuentas.",
        });
      }
      patch.parentCode = null;
    }

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

router.delete(DELETE_PATHS, ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;
    const { id } = req.params;

    const current = await Account.findOne({ _id: id, owner }).lean();
    if (!current) return res.status(404).json({ ok: false, message: "Cuenta no encontrada." });

    if (isParentAccount(current)) {
      const currentCodigo = String(current.codigo ?? current.code ?? "").trim();
      const children = await hasChildren({ owner, parentCode: currentCodigo });
      if (children) {
        return res.status(409).json({
          ok: false,
          message:
            "No puedes eliminar esta cuenta porque tiene subcuentas asociadas. Elimina subcuentas primero.",
        });
      }
    }

    await Account.findOneAndDelete({ _id: id, owner }).lean();
    return res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/cuentas/:id error:", err);
    return res.status(500).json({ ok: false, message: "Error eliminando cuenta" });
  }
});

module.exports = router;
