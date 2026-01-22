// backend/models/InventoryMovement.js
const mongoose = require("mongoose");

const inventoryMovementSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },

    fecha: { type: Date, default: Date.now, index: true },

    // venta | compra | ajuste (tu app también usa "entrada/salida" a veces)
    tipo: { type: String, default: "venta", trim: true },

    // ✅ Campo real
    productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product", default: null, index: true },

    // ✅ Campos reales (estos son los que Atlas te muestra)
    qty: { type: Number, default: 0 },
    unitCost: { type: Number, default: 0 },
    total: { type: Number, default: 0 },

    nota: { type: String, default: "" },

    source: { type: String, default: "" },
    sourceId: { type: mongoose.Schema.Types.ObjectId, default: null },
  },
  { timestamps: true }
);

// ----------------------------
// Helpers
// ----------------------------
function toNum(v) {
  if (v === null || typeof v === "undefined") return NaN;
  if (typeof v === "number") return Number.isFinite(v) ? v : NaN;
  const s = String(v).trim();
  if (!s) return NaN;
  const cleaned = s.replace(/[$,\s]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : NaN;
}

// ----------------------------
// ✅ ALIASES (para que NO se pierdan campos)
// ----------------------------

// productoId / producto_id / productId (ya existe) -> productId
inventoryMovementSchema
  .virtual("productoId")
  .get(function () {
    return this.productId;
  })
  .set(function (v) {
    this.productId = v;
  });

inventoryMovementSchema
  .virtual("producto_id")
  .get(function () {
    return this.productId;
  })
  .set(function (v) {
    this.productId = v;
  });

inventoryMovementSchema
  .virtual("product")
  .get(function () {
    return this.productId;
  })
  .set(function (v) {
    this.productId = v;
  });

// cantidad / unidades / quantity -> qty
inventoryMovementSchema
  .virtual("cantidad")
  .get(function () {
    return this.qty;
  })
  .set(function (v) {
    this.qty = v;
  });

inventoryMovementSchema
  .virtual("unidades")
  .get(function () {
    return this.qty;
  })
  .set(function (v) {
    this.qty = v;
  });

inventoryMovementSchema
  .virtual("quantity")
  .get(function () {
    return this.qty;
  })
  .set(function (v) {
    this.qty = v;
  });

// costoUnitario / costo_unitario / unit_cost -> unitCost
inventoryMovementSchema
  .virtual("costoUnitario")
  .get(function () {
    return this.unitCost;
  })
  .set(function (v) {
    this.unitCost = v;
  });

inventoryMovementSchema
  .virtual("costo_unitario")
  .get(function () {
    return this.unitCost;
  })
  .set(function (v) {
    this.unitCost = v;
  });

inventoryMovementSchema
  .virtual("unit_cost")
  .get(function () {
    return this.unitCost;
  })
  .set(function (v) {
    this.unitCost = v;
  });

// costoTotal / costo_total / monto_total -> total
inventoryMovementSchema
  .virtual("costoTotal")
  .get(function () {
    return this.total;
  })
  .set(function (v) {
    this.total = v;
  });

inventoryMovementSchema
  .virtual("costo_total")
  .get(function () {
    return this.total;
  })
  .set(function (v) {
    this.total = v;
  });

inventoryMovementSchema
  .virtual("monto_total")
  .get(function () {
    return this.total;
  })
  .set(function (v) {
    this.total = v;
  });

// descripcion -> nota
inventoryMovementSchema
  .virtual("descripcion")
  .get(function () {
    return this.nota;
  })
  .set(function (v) {
    this.nota = v;
  });

// ----------------------------
// ✅ NORMALIZACIÓN AUTOMÁTICA (E2E)
// - Si llega total=0 pero unitCost y qty existen => calcula total
// - Si llega unitCost=0 pero total y qty existen => calcula unitCost
// ----------------------------
inventoryMovementSchema.pre("validate", function (next) {
  try {
    const qty = toNum(this.qty);
    const unitCost = toNum(this.unitCost);
    const total = toNum(this.total);

    // Normaliza qty
    if (Number.isFinite(qty)) this.qty = qty;

    // Si qty no es válido o es 0, no hay nada que calcular
    if (!Number.isFinite(qty) || qty === 0) {
      // aún así normalizamos si vinieron strings
      if (Number.isFinite(unitCost)) this.unitCost = unitCost;
      if (Number.isFinite(total)) this.total = total;
      return next();
    }

    // Normaliza unitCost / total si vinieron como strings
    if (Number.isFinite(unitCost)) this.unitCost = unitCost;
    if (Number.isFinite(total)) this.total = total;

    // Derivaciones
    const hasUC = Number.isFinite(unitCost) && unitCost > 0;
    const hasT = Number.isFinite(total) && total > 0;

    if (!hasT && hasUC) {
      this.total = Math.abs(unitCost) * Math.abs(qty);
    } else if (!hasUC && hasT) {
      this.unitCost = Math.abs(total) / Math.abs(qty);
    } else if (!hasUC && !hasT) {
      // Ambos en 0: lo dejamos así (la ruta puede inyectar costo desde Product)
      this.unitCost = 0;
      this.total = 0;
    }

    return next();
  } catch (e) {
    return next(e);
  }
});

inventoryMovementSchema.index({ owner: 1, fecha: -1 });

module.exports = mongoose.model("InventoryMovement", inventoryMovementSchema);
