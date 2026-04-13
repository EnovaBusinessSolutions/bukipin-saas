// backend/routes/accionistas.js
const express = require("express");
const mongoose = require("mongoose");
const ensureAuth = require("../middleware/ensureAuth");
const Shareholder = require("../models/Shareholder");

const router = express.Router();
const MAX_ACTIVE_SHAREHOLDERS = 99;
const PERCENT_TOLERANCE = 0.01;

function asTrim(v, def = "") {
  if (v === undefined || v === null) return def;
  return String(v).trim();
}

function toNum(v, def = 0) {
  const n = Number(String(v ?? "").replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : def;
}

function asBool(v, def = null) {
  if (v === undefined || v === null || v === "") return def;
  const s = String(v).trim().toLowerCase();
  if (["true", "1", "yes", "y", "si", "sí"].includes(s)) return true;
  if (["false", "0", "no", "n"].includes(s)) return false;
  return def;
}

function isValidObjectId(v) {
  return mongoose.Types.ObjectId.isValid(asTrim(v, ""));
}

function normalizeItem(doc) {
  return doc?.toJSON ? doc.toJSON() : doc;
}

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function getMajorityPolicy() {
  const rawThreshold = toNum(process.env.SHAREHOLDER_MAJORITY_THRESHOLD, 50.01);
  return {
    enforce: String(process.env.SHAREHOLDER_MAJORITY_ENFORCED || "0").trim() === "1",
    mode: asTrim(process.env.SHAREHOLDER_MAJORITY_MODE, "threshold") || "threshold",
    threshold: Math.max(0, Math.min(100, rawThreshold)),
  };
}

function evaluateMajority(activeShareholders) {
  const items = (activeShareholders || []).map((item) => ({
    ...item,
    porcentaje_participacion: round2(toNum(item?.porcentaje_participacion, 0)),
  }));

  const maxParticipacion = items.reduce(
    (max, item) => Math.max(max, toNum(item?.porcentaje_participacion, 0)),
    0
  );

  const leaders = items.filter(
    (item) =>
      Math.abs(toNum(item?.porcentaje_participacion, 0) - maxParticipacion) < PERCENT_TOLERANCE &&
      maxParticipacion > 0
  );

  const policy = getMajorityPolicy();
  const hasThresholdMajority = items.some(
    (item) => toNum(item?.porcentaje_participacion, 0) >= policy.threshold
  );

  return {
    policy,
    maxParticipacion,
    leaders,
    hasMajority: policy.mode === "threshold" ? hasThresholdMajority : leaders.length === 1,
  };
}

function buildShareholderValidationError(message) {
  const err = new Error(message);
  err.statusCode = 400;
  err.code = "VALIDATION";
  return err;
}

function validateShareholderState(nextDocs, { requireExactTotal = false } = {}) {
  const activeDocs = (nextDocs || []).filter((item) => item && item.activo !== false);
  const activeCount = activeDocs.length;
  const totalParticipacion = round2(
    activeDocs.reduce((sum, item) => sum + toNum(item?.porcentaje_participacion, 0), 0)
  );

  if (activeCount > MAX_ACTIVE_SHAREHOLDERS) {
    throw buildShareholderValidationError(
      `Solo se permiten ${MAX_ACTIVE_SHAREHOLDERS} accionistas activos.`
    );
  }

  if (totalParticipacion > 100 + PERCENT_TOLERANCE) {
    throw buildShareholderValidationError(
      `La suma de participación no puede exceder 100%. Actual: ${totalParticipacion.toFixed(2)}%.`
    );
  }

  if (requireExactTotal && Math.abs(totalParticipacion - 100) > PERCENT_TOLERANCE) {
    throw buildShareholderValidationError(
      `La redistribución debe sumar exactamente 100%. Actual: ${totalParticipacion.toFixed(2)}%.`
    );
  }

  const majority = evaluateMajority(activeDocs);
  if (majority.policy.enforce && !majority.hasMajority) {
    throw buildShareholderValidationError(
      "La política vigente requiere un accionista mayoritario y actualmente no se cumple."
    );
  }

  return {
    activeCount,
    totalParticipacion,
    majority,
  };
}

async function listOwnerShareholders(owner, session) {
  let query = Shareholder.find({ owner }).sort({ nombre: 1, createdAt: -1 });
  if (session) query = query.session(session);
  return query;
}

/**
 * GET /api/accionistas
 * GET /api/accionistas?include_inactive=1
 */
router.get("/", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;
    const includeInactive =
      String(req.query.include_inactive || req.query.includeInactive || "0").trim() === "1" ||
      String(req.query.all || "0").trim() === "1";

    const q = asTrim(req.query.q, "");
    const wrap = String(req.query.wrap || "").trim() === "1";

    const filter = { owner };
    if (!includeInactive) filter.activo = true;

    if (q) {
      filter.$or = [
        { nombre: { $regex: q, $options: "i" } },
        { email: { $regex: q, $options: "i" } },
        { telefono: { $regex: q, $options: "i" } },
        { rfc: { $regex: q, $options: "i" } },
      ];
    }

    const docs = await Shareholder.find(filter).sort({ nombre: 1, createdAt: -1 });
    const items = docs.map(normalizeItem);

    if (!wrap) return res.json(items);
    return res.json({ ok: true, data: items, items });
  } catch (err) {
    console.error("GET /api/accionistas error:", err);
    return res.status(500).json({
      ok: false,
      error: "SERVER_ERROR",
      message: err?.message || "SERVER_ERROR",
    });
  }
});

/**
 * POST /api/accionistas
 */
router.post("/", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;

    const nombre = asTrim(req.body?.nombre);
    const porcentaje = Math.max(
      0,
      Math.min(
        100,
        toNum(req.body?.porcentaje_participacion ?? req.body?.porcentajeParticipacion, 0)
      )
    );

    if (!nombre) {
      return res.status(400).json({
        ok: false,
        error: "VALIDATION",
        message: "nombre es requerido.",
      });
    }

    const existing = await listOwnerShareholders(owner);
    validateShareholderState([
      ...existing.map((item) => item.toObject ? item.toObject() : item),
      {
        owner,
        nombre,
        porcentaje_participacion: porcentaje,
        email: asTrim(req.body?.email, ""),
        telefono: asTrim(req.body?.telefono, ""),
        rfc: asTrim(req.body?.rfc, ""),
        activo: true,
      },
    ]);

    const created = await Shareholder.create({
      owner,
      nombre,
      porcentaje_participacion: porcentaje,
      email: asTrim(req.body?.email, ""),
      telefono: asTrim(req.body?.telefono, ""),
      rfc: asTrim(req.body?.rfc, ""),
      activo: true,
    });

    const item = normalizeItem(created);
    return res.status(201).json({ ok: true, data: item, item, ...item });
  } catch (err) {
    console.error("POST /api/accionistas error:", err);
    const status = err?.statusCode || 500;
    return res.status(status).json({
      ok: false,
      error: err?.code || "SERVER_ERROR",
      message: err?.message || "SERVER_ERROR",
    });
  }
});

/**
 * POST /api/accionistas/redistribucion
 * body: { nuevoAccionista?: {...}, ajustes:[{id, porcentaje_participacion}], require_exact_total?: boolean }
 */
router.post("/redistribucion", ensureAuth, async (req, res) => {
  const session = await mongoose.startSession();

  try {
    const owner = req.user._id;
    const requireExactTotal = req.body?.require_exact_total === true;
    const ajustes = Array.isArray(req.body?.ajustes) ? req.body.ajustes : [];
    const nuevoAccionista = req.body?.nuevoAccionista || null;

    const ajusteMap = new Map();
    for (const ajuste of ajustes) {
      const id = asTrim(ajuste?.id, "");
      if (!id || !isValidObjectId(id)) {
        throw buildShareholderValidationError("Todos los ajustes deben incluir un id válido.");
      }

      ajusteMap.set(id, Math.max(0, Math.min(100, toNum(ajuste?.porcentaje_participacion, 0))));
    }

    let result = null;

    await session.withTransaction(async () => {
      const docs = await listOwnerShareholders(owner, session);
      const activeDocs = docs.filter((item) => item.activo !== false);

      for (const id of ajusteMap.keys()) {
        const exists = activeDocs.some((item) => String(item._id) === id);
        if (!exists) {
          throw buildShareholderValidationError(
            "Todos los ajustes deben corresponder a accionistas activos existentes."
          );
        }
      }

      const candidateDocs = docs.map((item) => {
        const plain = item.toObject ? item.toObject() : item;
        const id = String(item._id);
        if (!ajusteMap.has(id)) return plain;

        return {
          ...plain,
          porcentaje_participacion: ajusteMap.get(id),
        };
      });

      let newShareholderPayload = null;
      if (nuevoAccionista) {
        const nombre = asTrim(nuevoAccionista?.nombre, "");
        if (!nombre) {
          throw buildShareholderValidationError("El nuevo accionista debe incluir nombre.");
        }

        newShareholderPayload = {
          owner,
          nombre,
          porcentaje_participacion: Math.max(
            0,
            Math.min(100, toNum(nuevoAccionista?.porcentaje_participacion, 0))
          ),
          email: asTrim(nuevoAccionista?.email, ""),
          telefono: asTrim(nuevoAccionista?.telefono, ""),
          rfc: asTrim(nuevoAccionista?.rfc, ""),
          activo: true,
        };

        candidateDocs.push(newShareholderPayload);
      }

      validateShareholderState(candidateDocs, { requireExactTotal });

      if (newShareholderPayload) {
        await Shareholder.create([newShareholderPayload], { session });
      }

      const bulkOps = Array.from(ajusteMap.entries()).map(([id, porcentaje_participacion]) => ({
        updateOne: {
          filter: { _id: id, owner },
          update: { $set: { porcentaje_participacion } },
        },
      }));

      if (bulkOps.length) {
        await Shareholder.bulkWrite(bulkOps, { session });
      }

      const updated = await listOwnerShareholders(owner, session);
      const items = updated.map(normalizeItem);
      const validation = validateShareholderState(updated.map((item) => item.toObject()), {
        requireExactTotal: false,
      });

      result = {
        items,
        validation,
      };
    });

    return res.json({
      ok: true,
      data: result,
      ...result,
    });
  } catch (err) {
    console.error("POST /api/accionistas/redistribucion error:", err);
    return res.status(err?.statusCode || 500).json({
      ok: false,
      error: err?.code || "SERVER_ERROR",
      message: err?.message || "SERVER_ERROR",
    });
  } finally {
    await session.endSession();
  }
});

/**
 * PATCH /api/accionistas/:id
 */
router.patch("/:id", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;
    const id = asTrim(req.params.id, "");

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        ok: false,
        error: "VALIDATION",
        message: "id inválido",
      });
    }

    const current = await Shareholder.findOne({ _id: id, owner });
    if (!current) {
      return res.status(404).json({ ok: false, error: "NOT_FOUND" });
    }

    const patch = {};

    if (req.body?.nombre !== undefined) {
      patch.nombre = asTrim(req.body?.nombre, "");
      if (!patch.nombre) {
        return res.status(400).json({
          ok: false,
          error: "VALIDATION",
          message: "nombre no puede ir vacío.",
        });
      }
    }

    if (req.body?.porcentaje_participacion !== undefined || req.body?.porcentajeParticipacion !== undefined) {
      patch.porcentaje_participacion = Math.max(
        0,
        Math.min(
          100,
          toNum(req.body?.porcentaje_participacion ?? req.body?.porcentajeParticipacion, 0)
        )
      );
    }

    if (req.body?.email !== undefined) patch.email = asTrim(req.body?.email, "");
    if (req.body?.telefono !== undefined) patch.telefono = asTrim(req.body?.telefono, "");
    if (req.body?.rfc !== undefined) patch.rfc = asTrim(req.body?.rfc, "");
    if (req.body?.activo !== undefined) patch.activo = asBool(req.body?.activo, true) !== false;

    const existing = await listOwnerShareholders(owner);
    const simulated = existing.map((item) => {
      const plain = item.toObject ? item.toObject() : item;
      if (String(item._id) !== id) return plain;
      return {
        ...plain,
        ...patch,
      };
    });
    validateShareholderState(simulated);

    const updated = await Shareholder.findOneAndUpdate(
      { _id: id, owner },
      { $set: patch },
      { new: true }
    );

    const item = normalizeItem(updated);
    return res.json({ ok: true, data: item, item, ...item });
  } catch (err) {
    console.error("PATCH /api/accionistas/:id error:", err);
    return res.status(err?.statusCode || 500).json({
      ok: false,
      error: err?.code || "SERVER_ERROR",
      message: err?.message || "SERVER_ERROR",
    });
  }
});

/**
 * DELETE /api/accionistas/:id
 * Soft delete -> activo:false
 */
router.delete("/:id", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;
    const id = asTrim(req.params.id, "");

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        ok: false,
        error: "VALIDATION",
        message: "id inválido",
      });
    }

    const current = await Shareholder.findOne({ _id: id, owner });
    if (!current) {
      return res.status(404).json({ ok: false, error: "NOT_FOUND" });
    }

    const existing = await listOwnerShareholders(owner);
    const simulated = existing.map((item) => {
      const plain = item.toObject ? item.toObject() : item;
      if (String(item._id) !== id) return plain;
      return {
        ...plain,
        activo: false,
      };
    });
    validateShareholderState(simulated);

    const updated = await Shareholder.findOneAndUpdate(
      { _id: id, owner },
      { $set: { activo: false } },
      { new: true }
    );

    const item = normalizeItem(updated);
    return res.json({
      ok: true,
      data: item,
      item,
      message: "Accionista dado de baja correctamente",
    });
  } catch (err) {
    console.error("DELETE /api/accionistas/:id error:", err);
    return res.status(err?.statusCode || 500).json({
      ok: false,
      error: err?.code || "SERVER_ERROR",
      message: err?.message || "SERVER_ERROR",
    });
  }
});

module.exports = router;
