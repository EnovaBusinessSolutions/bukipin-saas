const mongoose = require("mongoose");

function asTrim(v, def = "") {
  if (v === undefined || v === null) return def;
  return String(v).trim();
}

const depreciationRecommendationSchema = new mongoose.Schema(
  {
    categoria_activo: {
      type: String,
      required: true,
      trim: true,
      index: true,
      unique: true,
    },
    anos_recomendados: { type: Number, required: true, default: 5 },
    anos_minimos: { type: Number, required: true, default: 1 },
    anos_maximos: { type: Number, required: true, default: 10 },
    descripcion: { type: String, trim: true, default: "" },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform: (_doc, ret) => {
        ret.id = String(ret._id);
        ret.created_at = ret.createdAt ? new Date(ret.createdAt).toISOString() : null;
        ret.updated_at = ret.updatedAt ? new Date(ret.updatedAt).toISOString() : null;

        delete ret._id;
        delete ret.__v;
        delete ret.createdAt;
        delete ret.updatedAt;
        return ret;
      },
    },
    toObject: { virtuals: true },
  }
);

depreciationRecommendationSchema.pre("validate", function (next) {
  try {
    this.categoria_activo = asTrim(this.categoria_activo).toLowerCase();
    this.descripcion = asTrim(this.descripcion);

    this.anos_recomendados = Math.max(
      1,
      parseInt(String(this.anos_recomendados ?? 5), 10) || 5
    );
    this.anos_minimos = Math.max(
      1,
      parseInt(String(this.anos_minimos ?? 1), 10) || 1
    );
    this.anos_maximos = Math.max(
      this.anos_minimos,
      parseInt(String(this.anos_maximos ?? this.anos_recomendados ?? 10), 10) ||
        this.anos_recomendados ||
        10
    );

    if (this.anos_recomendados < this.anos_minimos) {
      this.anos_recomendados = this.anos_minimos;
    }
    if (this.anos_recomendados > this.anos_maximos) {
      this.anos_recomendados = this.anos_maximos;
    }

    next();
  } catch (err) {
    next(err);
  }
});

module.exports = mongoose.model(
  "DepreciationRecommendation",
  depreciationRecommendationSchema
);