// backend/routes/cuentas.js
const express = require("express");
const router = express.Router();

const ensureAuth = require("../middleware/ensureAuth");
const Account = require("../models/Account");

// Helpers
function toStr(v) {
  return typeof v === "string" ? v.trim() : String(v || "").trim();
}
function toBool(v) {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v === 1;
  if (typeof v === "string") return v.toLowerCase() === "true";
  return false;
}

/**
 * Normaliza una cuenta a un SOLO formato de salida (ES):
 *  - codigo
 *  - nombre
 *  - type
 *  - category
 *  - parentCode
 *  - isActive
 *  - isDefault
 */
function normalizeAccountOut(doc) {
  return {
    id: doc._id,
    codigo: doc.codigo ?? doc.code ?? null,
    nombre: doc.nombre ?? doc.name ?? null,
    type: doc.type ?? null,
    category: doc.category ?? "general",
    parentCode: doc.parentCode ?? null,
    isActive: typeof doc.isActive === "boolean" ? doc.isActive : true,
    isDefault: typeof doc.isDefault === "boolean" ? doc.isDefault : false,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
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
    if (typeof req.query.active !== "undefined") {
      q.isActive = String(req.query.active) === "true";
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

    if (!codigo) return res.status(400).json({ ok: false, message: "Falta 'codigo'." });
    if (!nombre) return res.status(400).json({ ok: false, message: "Falta 'nombre'." });
    if (!type) return res.status(400).json({ ok: false, message: "Falta 'type'." });

    // Guardamos en ES como canonical,
    // y dejamos alias EN por compatibilidad (si tu schema lo permite).
    const created = await Account.create({
      owner,
      // Canonical ES:
      codigo,
      nombre,
      // Alias EN (si existen en tu schema, no estorban; si no existen, Mongoose los ignora si strict=true)
      code: codigo,
      name: nombre,

      type,
      category,
      parentCode,

      isDefault: false,
      isActive: true,
    });

    return res.status(201).json({ ok: true, data: normalizeAccountOut(created.toObject?.() || created) });
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
//  - /api/cuentas/cuentas/:id (si montas raro)
//  - /api/cuentas/:id si montas en /api y ruta /cuentas/:id
const PUT_PATHS = ["/:id", "/cuentas/:id"];
const DELETE_PATHS = ["/:id", "/cuentas/:id"];

router.put(PUT_PATHS, ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;
    const { id } = req.params;

    // Acepta parches ES o EN y normaliza a ES
    const patch = {};

    if (typeof req.body?.codigo !== "undefined" || typeof req.body?.code !== "undefined") {
      const v = toStr(req.body?.codigo ?? req.body?.code);
      patch.codigo = v;
      patch.code = v; // alias
    }

    if (typeof req.body?.nombre !== "undefined" || typeof req.body?.name !== "undefined") {
      const v = toStr(req.body?.nombre ?? req.body?.name);
      patch.nombre = v;
      patch.name = v; // alias
    }

    if (typeof req.body?.type !== "undefined") patch.type = toStr(req.body.type);
    if (typeof req.body?.category !== "undefined") patch.category = toStr(req.body.category);

    if (typeof req.body?.parentCode !== "undefined") {
      patch.parentCode = req.body.parentCode ? toStr(req.body.parentCode) : null;
    }

    if (typeof req.body?.isActive !== "undefined") patch.isActive = toBool(req.body.isActive);

    const updated = await Account.findOneAndUpdate(
      { _id: id, owner },
      { $set: patch },
      { new: true }
    ).lean();

    if (!updated) return res.status(404).json({ ok: false, message: "Cuenta no encontrada." });

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

    const deleted = await Account.findOneAndDelete({ _id: id, owner }).lean();
    if (!deleted) return res.status(404).json({ ok: false, message: "Cuenta no encontrada." });

    return res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/cuentas/:id error:", err);
    return res.status(500).json({ ok: false, message: "Error eliminando cuenta" });
  }
});

module.exports = router;
