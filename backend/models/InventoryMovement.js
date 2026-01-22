// backend/models/InventoryMovement.js
const mongoose = require("mongoose");

const inventoryMovementSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },

    fecha: { type: Date, default: Date.now, index: true },

    // venta | compra | ajuste | entrada | salida | ajuste_entrada | ajuste_salida
    tipo: {
      type: String,
      default: "venta",
      trim: true,
      index: true,
      enum: ["venta", "compra", "ajuste", "entrada", "salida", "ajuste_entrada", "ajuste_salida"],
    },

    // ✅ Estado canónico
    status: {
      type: String,
      default: "activo",
      trim: true,
      index: true,
      enum: ["activo", "cancelado"],
    },

    // ✅ Campo real (ref)
    productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product", default: null, index: true },

    // ✅ Campos reales (fuente de verdad)
    qty: { type: Number, default: 0 },
    unitCost: { type: Number, default: 0 },
    total: { type: Number, default: 0 },

    // Texto
    nota: { type: String, default: "" },
    referencia: { type: String, default: "" },

    // Trazabilidad
    source: { type: String, default: "" }, // ui | inventario | venta | compra | etc.
    sourceId: { type: mongoose.Schema.Types.ObjectId, default: null },

    // ✅ Contabilidad
    asientoId: { type: mongoose.Schema.Types.ObjectId, ref: "JournalEntry", default: null, index: true },
    asiento_reversion_id: { type: mongoose.Schema.Types.ObjectId, ref: "JournalEntry", default: null, index: true },

    // ✅ Cancelación (para dejar rastro)
    motivo_cancelacion: { type: String, default: null },
    fecha_cancelacion: { type: Date, default: null },
    movimiento_reversion_id: { type: mongoose.Schema.Types.ObjectId, default: null },
  },
  { timestamps: true }
);

// Para que los virtuals salgan en responses si los conviertes a JSON/obj
inventoryMovementSchema.set("toJSON", { virtuals: true });
inventoryMovementSchema.set("toObject", { virtuals: true });

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
// ✅ Virtual populate CORRECTO
// (evita 500 si alguien hace populate("productoId"))
// ----------------------------
inventoryMovementSchema.virtual("productoId", {
  ref: "Product",
  localField: "productId",
  foreignField: "_id",
  justOne: true,
});
inventoryMovementSchema.virtual("producto_id", {
  ref: "Product",
  localField: "productId",
  foreignField: "_id",
  justOne: true,
});
inventoryMovementSchema.virtual("product", {
  ref: "Product",
  localField: "productId",
  foreignField: "_id",
  justOne: true,
});

// ----------------------------
// ✅ Aliases de lectura/escritura (compat payload/UI)
// (Estas NO se deben usar para populate)
// ----------------------------

// estado -> status
inventoryMovementSchema
  .virtual("estado")
  .get(function () {
    return this.status;
  })
  .set(function (v) {
    this.status = v;
  });

// type / tipo_movimiento / tipoMovimiento -> tipo
inventoryMovementSchema
  .virtual("type")
  .get(function () {
    return this.tipo;
  })
  .set(function (v) {
    this.tipo = v;
  });

inventoryMovementSchema
  .virtual("tipo_movimiento")
  .get(function () {
    return this.tipo;
  })
  .set(function (v) {
    this.tipo = v;
  });

inventoryMovementSchema
  .virtual("tipoMovimiento")
  .get(function () {
    return this.tipo;
  })
  .set(function (v) {
    this.tipo = v;
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

// ✅ Compat contable: asiento_id / journalEntryId / journal_entry_id -> asientoId
inventoryMovementSchema
  .virtual("asiento_id")
  .get(function () {
    return this.asientoId;
  })
  .set(function (v) {
    this.asientoId = v;
  });

inventoryMovementSchema
  .virtual("journalEntryId")
  .get(function () {
    return this.asientoId;
  })
  .set(function (v) {
    this.asientoId = v;
  });

inventoryMovementSchema
  .virtual("journal_entry_id")
  .get(function () {
    return this.asientoId;
  })
  .set(function (v) {
    this.asientoId = v;
  });

// ----------------------------
// ✅ NORMALIZACIÓN AUTOMÁTICA (E2E)
// - Normaliza "$40" / "1,200"
// - Deriva total/unitCost si faltan
// - Guarda fecha_cancelacion cuando status pasa a cancelado
// ----------------------------
inventoryMovementSchema.pre("validate", function (next) {
  try {
    const qty = toNum(this.qty);
    const unitCost = toNum(this.unitCost);
    const total = toNum(this.total);

    if (Number.isFinite(qty)) this.qty = qty;
    if (Number.isFinite(unitCost)) this.unitCost = unitCost;
    if (Number.isFinite(total)) this.total = total;

    // Si qty inválido o 0, no hay nada que derivar
    if (!Number.isFinite(this.qty) || this.qty === 0) {
      if (!this.status) this.status = "activo";
      return next();
    }

    const hasUC = Number.isFinite(this.unitCost) && this.unitCost > 0;
    const hasT = Number.isFinite(this.total) && this.total > 0;

    if (!hasT && hasUC) {
      this.total = Math.abs(this.unitCost) * Math.abs(this.qty);
    } else if (!hasUC && hasT) {
      this.unitCost = Math.abs(this.total) / Math.abs(this.qty);
    }

    if (!Number.isFinite(this.unitCost) || this.unitCost < 0) this.unitCost = 0;
    if (!Number.isFinite(this.total) || this.total < 0) this.total = Math.abs(this.total || 0);

    if (!this.status) this.status = "activo";

    return next();
  } catch (e) {
    return next(e);
  }
});

// Si cambia status a cancelado, deja rastro automáticamente
inventoryMovementSchema.pre("save", function (next) {
  try {
    if (this.isModified("status") && String(this.status) === "cancelado") {
      if (!this.fecha_cancelacion) this.fecha_cancelacion = new Date();
    }
    return next();
  } catch (e) {
    return next(e);
  }
});

// Index compuesto útil
inventoryMovementSchema.index({ owner: 1, fecha: -1 });
inventoryMovementSchema.index({ owner: 1, productId: 1, fecha: -1 });

module.exports = mongoose.model("InventoryMovement", inventoryMovementSchema);
