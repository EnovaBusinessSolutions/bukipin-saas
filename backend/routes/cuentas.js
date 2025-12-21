// backend/routes/cuentas.js
const express = require("express");
const router = express.Router();

const ensureAuth = require("../middleware/ensureAuth");
const Account = require("../models/Account");

// Helpers
const s = (v) => (typeof v === "string" ? v.trim() : v);

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
 * Normaliza una cuenta a un formato seguro (ES + EN) para compatibilidad:
 * - id y _id
 * - codigo y code
 * - nombre y name
 */
function normalizeAccountOut(doc) {
  const codigo = doc.codigo ?? doc.code ?? null;
  const nombre = doc.nombre ?? doc.name ?? null;

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

    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

/**
 * Determina si una cuenta "doc" es cuenta madre:
 * parentCode == null/undefined
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
     * Por defecto: SOLO cuentas madre
     * - includeSubcuentas=true => incluye todo
     * - onlySubcuentas=true    => sólo subcuentas
     */
    const includeSubcuentas = String(req.query.includeSubcuentas || "false") === "true";
    const onlySubcuentas = String(req.query.onlySubcuentas || "false") === "true";

    if (!includeSubcuentas) {
      if (onlySubcuentas) {
        q.parentCode = { $exists: true, $ne: null };
      } else {
        // cuentas madre
        q.$or = [{ parentCode: null }, { parentCode: { $exists: false } }];
      }
    }

    const items = await Account.find(q)
      .sort({ codigo: 1, code: 1 })
      .lean();

    return res.json({ ok: true, data: items.map(normalizeAccountOut) });
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

    // Esta ruta es para CUENTAS MADRE. Si te mandan parentCode, mejor guiar.
    if (parentCode) {
      return res.status(400).json({
        ok: false,
        message: "Para crear subcuentas usa POST /api/subcuentas (no /api/cuentas).",
      });
    }

    if (!codigo) return res.status(400).json({ ok: false, message: "Falta 'codigo'." });
    if (!nombre) return res.status(400).json({ ok: false, message: "Falta 'nombre'." });
    if (!type) return res.status(400).json({ ok: false, message: "Falta 'type'." });

    // Canonical ES + alias EN
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

    // Acepta parches ES o EN y normaliza a ES+EN
    const patch = {};

    const nextCodigo =
      typeof req.body?.codigo !== "undefined" || typeof req.body?.code !== "undefined"
        ? toStr(req.body?.codigo ?? req.body?.code)
        : null;

    if (nextCodigo !== null) {
      // Si es cuenta madre y cambia el código, no permitir si tiene subcuentas
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

    // Esta ruta NO debe convertir una cuenta madre en subcuenta.
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

    // Si es cuenta madre, no permitir borrar si tiene subcuentas
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

    const deleted = await Account.findOneAndDelete({ _id: id, owner }).lean();
    return res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/cuentas/:id error:", err);
    return res.status(500).json({ ok: false, message: "Error eliminando cuenta" });
  }
});

module.exports = router;
