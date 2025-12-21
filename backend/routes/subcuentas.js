// backend/routes/subcuentas.js
const express = require("express");
const router = express.Router();

const ensureAuth = require("../middleware/ensureAuth");
const Account = require("../models/Account");

// Helper: normaliza strings
const s = (v) => (typeof v === "string" ? v.trim() : v);

function pad(n, size = 2) {
  return String(n).padStart(size, "0");
}

async function findParentAccount({ owner, parentCode }) {
  // Soporta esquemas con code/codigo
  return Account.findOne({
    owner,
    $or: [{ code: parentCode }, { codigo: parentCode }],
    parentCode: { $in: [null, undefined] }, // cuenta madre no debe tener parentCode
  }).lean();
}

async function generateNextSubaccountCode({ owner, parentCode }) {
  // Códigos tipo: 4001-01, 4001-02, ...
  const existing = await Account.find({ owner, parentCode })
    .select({ code: 1, codigo: 1 })
    .lean();

  const used = new Set(
    existing
      .map((x) => String(x.code || x.codigo || "").trim())
      .filter(Boolean)
  );

  for (let i = 1; i <= 999; i++) {
    const candidate = `${parentCode}-${pad(i, 2)}`;
    if (!used.has(candidate)) return candidate;
  }

  throw new Error("No hay códigos disponibles para subcuentas (límite alcanzado).");
}

/**
 * GET /api/subcuentas
 * Query opcional:
 *  - parentCode=XXXX
 *  - active=true|false
 */
router.get("/", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;

    const q = {
      owner,
      parentCode: { $exists: true, $ne: null },
    };

    if (req.query.parentCode) q.parentCode = s(String(req.query.parentCode));
    if (typeof req.query.active !== "undefined") {
      q.isActive = String(req.query.active) === "true";
    }

    const items = await Account.find(q).sort({ code: 1 }).lean();
    return res.json({ ok: true, data: items });
  } catch (err) {
    console.error("GET /api/subcuentas error:", err);
    return res.status(500).json({ ok: false, message: "Error cargando subcuentas" });
  }
});

/**
 * POST /api/subcuentas
 * ✅ E2E para tu UI: NO exige code.
 * Body (acepta variantes):
 *  - nombre | name (requerido)
 *  - parentCode (requerido)
 *  - type (opcional) -> si no viene, se hereda de la cuenta madre
 *  - category (opcional) -> si no viene, se hereda de la cuenta madre
 *  - code (opcional) -> si viene, lo respeta; si no, lo genera
 */
router.post("/", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;

    // 🔎 Tip de debug (déjalo unos minutos si quieres confirmar que pega aquí)
    // console.log("POST /api/subcuentas body =", req.body);

    const name = s(String(req.body?.nombre || req.body?.name || ""));
    const parentCode = s(String(req.body?.parentCode || req.body?.cuentaCodigo || ""));
    const incomingCode = s(String(req.body?.code || req.body?.codigo || ""));
    const incomingType = s(String(req.body?.type || ""));
    const incomingCategory = req.body?.category ? s(String(req.body.category)) : "";

    if (!name) return res.status(400).json({ ok: false, message: "Falta 'nombre'." });
    if (!parentCode) return res.status(400).json({ ok: false, message: "Falta 'parentCode'." });

    // Validar que exista la cuenta padre del mismo usuario (por code o codigo)
    const parent = await findParentAccount({ owner, parentCode });
    if (!parent) {
      return res.status(404).json({
        ok: false,
        message: `No existe la cuenta padre con code='${parentCode}' para este usuario.`,
      });
    }

    // Si el frontend no manda code (caso real), lo generamos
    const code = incomingCode || (await generateNextSubaccountCode({ owner, parentCode }));

    // Heredar type/category si no vienen
    const type = incomingType || parent.type || "general";
    const category = incomingCategory || parent.category || "general";

    const created = await Account.create({
      owner,
      // soporta ambos esquemas
      code,
      codigo: code,
      name,
      nombre: name,
      type,
      category,
      parentCode,
      isDefault: false,
      isActive: true,
    });

    return res.status(201).json({ ok: true, data: created });
  } catch (err) {
    if (err && err.code === 11000) {
      return res.status(409).json({
        ok: false,
        message: "Ya existe una subcuenta con ese código para este usuario.",
      });
    }
    console.error("POST /api/subcuentas error:", err);
    return res.status(500).json({ ok: false, message: "Error creando subcuenta" });
  }
});

/**
 * PUT /api/subcuentas/:id
 */
router.put("/:id", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;
    const { id } = req.params;

    const allowed = ["code", "codigo", "name", "nombre", "type", "category", "parentCode", "isActive"];
    const patch = {};

    for (const k of allowed) {
      if (typeof req.body?.[k] !== "undefined") patch[k] = req.body[k];
    }

    // Normaliza y mantiene espejos (code/codigo y name/nombre)
    if (typeof patch.code !== "undefined" || typeof patch.codigo !== "undefined") {
      const nextCode = s(String(patch.code || patch.codigo || ""));
      patch.code = nextCode;
      patch.codigo = nextCode;
    }

    if (typeof patch.name !== "undefined" || typeof patch.nombre !== "undefined") {
      const nextName = s(String(patch.name || patch.nombre || ""));
      patch.name = nextName;
      patch.nombre = nextName;
    }

    if (typeof patch.type !== "undefined") patch.type = s(String(patch.type));
    if (typeof patch.category !== "undefined") patch.category = s(String(patch.category));

    if (typeof patch.parentCode !== "undefined") {
      patch.parentCode = patch.parentCode ? s(String(patch.parentCode)) : null;
    }

    // Si te cambian parentCode, valida que exista (por code o codigo)
    if (typeof patch.parentCode !== "undefined" && patch.parentCode) {
      const parent = await findParentAccount({ owner, parentCode: patch.parentCode });
      if (!parent) {
        return res.status(404).json({
          ok: false,
          message: `No existe la cuenta padre con code='${patch.parentCode}' para este usuario.`,
        });
      }
    }

    // Aseguramos que siga siendo subcuenta (parentCode no null)
    const updated = await Account.findOneAndUpdate(
      { _id: id, owner, parentCode: { $exists: true, $ne: null } },
      { $set: patch },
      { new: true }
    ).lean();

    if (!updated) {
      return res.status(404).json({ ok: false, message: "Subcuenta no encontrada." });
    }

    return res.json({ ok: true, data: updated });
  } catch (err) {
    if (err && err.code === 11000) {
      return res.status(409).json({
        ok: false,
        message: "Ya existe una subcuenta con ese código para este usuario.",
      });
    }
    console.error("PUT /api/subcuentas/:id error:", err);
    return res.status(500).json({ ok: false, message: "Error actualizando subcuenta" });
  }
});

/**
 * DELETE /api/subcuentas/:id
 */
router.delete("/:id", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;
    const { id } = req.params;

    const deleted = await Account.findOneAndDelete({
      _id: id,
      owner,
      parentCode: { $exists: true, $ne: null },
    }).lean();

    if (!deleted) {
      return res.status(404).json({ ok: false, message: "Subcuenta no encontrada." });
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/subcuentas/:id error:", err);
    return res.status(500).json({ ok: false, message: "Error eliminando subcuenta" });
  }
});

module.exports = router;
