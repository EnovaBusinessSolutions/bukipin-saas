# Prompt 8.1 — Backend: Módulo Depósitos en Garantía

## Contexto

Se crea un nuevo módulo llamado **Depósitos en Garantía**. Un depósito en garantía es dinero
que entra o sale como colateral de un contrato (ej. renta de bodega, acuerdo comercial).
**No es ingreso, gasto ni préstamo** — vive en cuentas de balance y siempre hay que devolverlo.

Dos sub-tipos:
| Sub-tipo | Tipo contable | Cuenta |
|---|---|---|
| Recibido | Pasivo No Circulante | **2104** Depósitos en Garantía Recibidos |
| Realizado | Activo No Circulante | **1241** Depósitos en Garantía Realizados |

Asientos contables:
| Acción | Realizados (1241 Activo) | Recibidos (2104 Pasivo) |
|---|---|---|
| nuevo / aumento | DR 1241 / CR 1001\|1002 | DR 1001\|1002 / CR 2104 |
| disminucion / devolucion / liquidacion | DR 1001\|1002 / CR 1241 | DR 2104 / CR 1001\|1002 |

---

## CAMBIO 1 — Crear `backend/models/DepositoGarantia.js` (archivo nuevo)

```js
// backend/models/DepositoGarantia.js
const mongoose = require("mongoose");

const { Schema } = mongoose;

const depositoGarantiaSchema = new Schema(
  {
    owner: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // "recibido" = Pasivo (alguien nos dejó dinero, lo debemos regresar)
    // "realizado" = Activo (nosotros dimos dinero, nos lo tienen que regresar)
    tipo: {
      type: String,
      enum: ["recibido", "realizado"],
      required: true,
      index: true,
    },

    // Datos de la contraparte (deudor o acreedor)
    entidad_nombre: {
      type: String,
      required: true,
      trim: true,
    },
    entidad_rfc: {
      type: String,
      trim: true,
      default: "",
    },
    entidad_tipo: {
      type: String,
      enum: ["empresa", "persona"],
      default: "empresa",
    },

    // Saldo vigente (se actualiza con cada movimiento)
    saldo_actual: {
      type: Number,
      default: 0,
    },

    // Fecha del depósito inicial
    fecha_inicio: {
      type: Date,
      default: null,
    },

    referencia: {
      type: String,
      trim: true,
      default: "",
    },

    // "activo" mientras haya saldo pendiente, "liquidado" cuando saldo = 0
    estado: {
      type: String,
      enum: ["activo", "liquidado"],
      default: "activo",
      index: true,
    },
  },
  { timestamps: true }
);

depositoGarantiaSchema.index({ owner: 1, tipo: 1, estado: 1 });
depositoGarantiaSchema.index({ owner: 1, entidad_nombre: 1 });

module.exports =
  mongoose.models.DepositoGarantia ||
  mongoose.model("DepositoGarantia", depositoGarantiaSchema);
```

---

## CAMBIO 2 — Crear `backend/models/DepositoGarantiaMovimiento.js` (archivo nuevo)

```js
// backend/models/DepositoGarantiaMovimiento.js
const mongoose = require("mongoose");

const { Schema } = mongoose;

const depositoGarantiaMovimientoSchema = new Schema(
  {
    owner: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    deposito_id: {
      type: Schema.Types.ObjectId,
      ref: "DepositoGarantia",
      required: true,
      index: true,
    },

    // "nuevo"       = apertura de posición
    // "aumento"     = se incrementa el depósito existente
    // "disminucion" = devolución parcial
    // "devolucion"  = alias de disminucion (mismo flujo)
    // "liquidacion" = cierre total, saldo queda en 0
    tipo_movimiento: {
      type: String,
      enum: ["nuevo", "aumento", "disminucion", "devolucion", "liquidacion"],
      required: true,
    },

    monto: {
      type: Number,
      required: true,
      min: 0,
    },

    // Cómo se mueve el dinero
    metodo_pago: {
      type: String,
      enum: ["caja", "bancos"],
      default: "bancos",
    },

    fecha: {
      type: Date,
      default: Date.now,
    },

    referencia: {
      type: String,
      trim: true,
      default: "",
    },

    // Referencia al asiento contable generado
    journal_entry_id: {
      type: Schema.Types.ObjectId,
      ref: "JournalEntry",
      default: null,
    },
  },
  { timestamps: true }
);

depositoGarantiaMovimientoSchema.index({ owner: 1, deposito_id: 1 });
depositoGarantiaMovimientoSchema.index({ owner: 1, fecha: -1 });

module.exports =
  mongoose.models.DepositoGarantiaMovimiento ||
  mongoose.model("DepositoGarantiaMovimiento", depositoGarantiaMovimientoSchema);
```

---

## CAMBIO 3 — Crear `backend/routes/depositosGarantia.js` (archivo nuevo)

Crear el archivo completo con el siguiente contenido:

```js
// backend/routes/depositosGarantia.js
const express = require("express");
const mongoose = require("mongoose");
const ensureAuth = require("../middleware/ensureAuth");
const DepositoGarantia = require("../models/DepositoGarantia");
const DepositoGarantiaMovimiento = require("../models/DepositoGarantiaMovimiento");

let JournalEntry = null;
try {
  JournalEntry = require("../models/JournalEntry");
} catch (_) {}

const router = express.Router();

// =====================================================
// Helpers
// =====================================================
function toNum(v, def = 0) {
  const n = Number(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : def;
}

function asTrim(v, def = "") {
  if (v === undefined || v === null) return def;
  return String(v).trim();
}

function asDateOrNull(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function normalizeTipo(v) {
  const s = asTrim(v).toLowerCase();
  return s === "realizado" ? "realizado" : "recibido";
}

function normalizeMetodoPago(v) {
  const s = asTrim(v).toLowerCase();
  if (["caja", "efectivo", "cash"].includes(s)) return "caja";
  return "bancos";
}

function normalizeTipoMovimiento(v) {
  const s = asTrim(v).toLowerCase();
  const map = {
    nuevo: "nuevo",
    aumento: "aumento",
    incremento: "aumento",
    disminucion: "disminucion",
    disminución: "disminucion",
    devolucion: "devolucion",
    devolución: "devolucion",
    retorno: "devolucion",
    liquidacion: "liquidacion",
    liquidación: "liquidacion",
    cierre: "liquidacion",
  };
  return map[s] || "disminucion";
}

// Indica si el movimiento aumenta el saldo (+) o lo disminuye (-)
function esMovimientoPositivo(tipoMov) {
  return tipoMov === "nuevo" || tipoMov === "aumento";
}

function mapDepositoForUI(doc) {
  const d = doc?.toObject ? doc.toObject() : doc || {};
  return {
    id: String(d._id),
    _id: d._id,
    tipo: d.tipo || "recibido",
    entidad_nombre: d.entidad_nombre || "",
    entidad_rfc: d.entidad_rfc || "",
    entidad_tipo: d.entidad_tipo || "empresa",
    saldo_actual: toNum(d.saldo_actual, 0),
    fecha_inicio: d.fecha_inicio || null,
    referencia: d.referencia || "",
    estado: d.estado || "activo",
    created_at: d.createdAt || null,
    updated_at: d.updatedAt || null,
  };
}

function mapMovimientoForUI(doc, depositoNombre = "") {
  const d = doc?.toObject ? doc.toObject() : doc || {};
  const tipoMov = d.tipo_movimiento || "disminucion";
  const esPositivo = esMovimientoPositivo(tipoMov);
  return {
    id: String(d._id),
    _id: d._id,
    deposito_id: d.deposito_id ? String(d.deposito_id) : "",
    entidad_nombre: depositoNombre,
    tipo_movimiento: tipoMov,
    monto: toNum(d.monto, 0),
    monto_con_signo: esPositivo ? toNum(d.monto, 0) : -toNum(d.monto, 0),
    metodo_pago: d.metodo_pago || "bancos",
    fecha: d.fecha || null,
    referencia: d.referencia || "",
    journal_entry_id: d.journal_entry_id ? String(d.journal_entry_id) : null,
    created_at: d.createdAt || null,
  };
}

// =====================================================
// Journal Entry (best-effort, no bloquea si falla)
// =====================================================
async function crearAsientoContable({ owner, deposito, movimiento, movimientoId }) {
  try {
    if (!JournalEntry) return null;

    const tipo = deposito.tipo; // "recibido" | "realizado"
    const tipoMov = movimiento.tipo_movimiento;
    const monto = toNum(movimiento.monto, 0);
    if (monto <= 0) return null;

    const metodo = normalizeMetodoPago(movimiento.metodo_pago || "bancos");
    const fondoCodigo = metodo === "caja" ? "1001" : "1002";
    const fondoNombre = metodo === "caja" ? "Caja" : "Bancos";

    const lines = [];
    const pushDebit = (code, name, amount, memo = "") => {
      if (amount > 0) lines.push({ accountCode: code, accountCodigo: code, accountName: name, debit: amount, credit: 0, memo });
    };
    const pushCredit = (code, name, amount, memo = "") => {
      if (amount > 0) lines.push({ accountCode: code, accountCodigo: code, accountName: name, debit: 0, credit: amount, memo });
    };

    const memo = movimiento.referencia || `${tipoMov} - ${deposito.entidad_nombre}`;

    if (tipo === "realizado") {
      // Activo 1241
      if (esMovimientoPositivo(tipoMov)) {
        // Dinero sale para el depósito: DR 1241 / CR Fondos
        pushDebit("1241", "Depósitos en Garantía Realizados", monto, memo);
        pushCredit(fondoCodigo, fondoNombre, monto, memo);
      } else {
        // Dinero regresa: DR Fondos / CR 1241
        pushDebit(fondoCodigo, fondoNombre, monto, memo);
        pushCredit("1241", "Depósitos en Garantía Realizados", monto, memo);
      }
    } else {
      // tipo === "recibido" → Pasivo 2104
      if (esMovimientoPositivo(tipoMov)) {
        // Dinero entra: DR Fondos / CR 2104
        pushDebit(fondoCodigo, fondoNombre, monto, memo);
        pushCredit("2104", "Depósitos en Garantía Recibidos", monto, memo);
      } else {
        // Dinero sale (devolución): DR 2104 / CR Fondos
        pushDebit("2104", "Depósitos en Garantía Recibidos", monto, memo);
        pushCredit(fondoCodigo, fondoNombre, monto, memo);
      }
    }

    if (!lines.length) return null;

    const concept = memo;
    const entry = await JournalEntry.create({
      owner,
      source: "deposito_garantia",
      sourceId: movimientoId,
      transaccionId: movimientoId,
      concept,
      concepto: concept,
      descripcion: concept,
      date: movimiento.fecha || new Date(),
      fecha: movimiento.fecha || new Date(),
      lines,
      detalle_asientos: lines,
      references: [
        { source: "deposito_garantia_movimiento", id: String(movimientoId) },
        { source: "deposito_garantia", id: String(deposito._id) },
      ],
    });

    return entry._id;
  } catch (err) {
    console.error("crearAsientoContable deposito garantia error:", err.message);
    return null;
  }
}

// =====================================================
// GET /api/depositos-garantia/resumen
// Totales para la página de entrada (dos tarjetas)
// =====================================================
router.get("/resumen", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;

    const [recibidos, realizados] = await Promise.all([
      DepositoGarantia.find({ owner, tipo: "recibido", estado: "activo" }).lean(),
      DepositoGarantia.find({ owner, tipo: "realizado", estado: "activo" }).lean(),
    ]);

    const sumarSaldos = (arr) => arr.reduce((acc, d) => acc + toNum(d.saldo_actual, 0), 0);
    const totalMovimientos = async (tipo) => {
      const ids = (tipo === "recibido" ? recibidos : realizados).map((d) => d._id);
      return DepositoGarantiaMovimiento.countDocuments({ owner, deposito_id: { $in: ids } });
    };

    const [movRecibidos, movRealizados] = await Promise.all([
      totalMovimientos("recibido"),
      totalMovimientos("realizado"),
    ]);

    return res.json({
      ok: true,
      data: {
        recibidos: {
          total_saldo: sumarSaldos(recibidos),
          total_entidades: recibidos.length,
          total_movimientos: movRecibidos,
        },
        realizados: {
          total_saldo: sumarSaldos(realizados),
          total_entidades: realizados.length,
          total_movimientos: movRealizados,
        },
      },
    });
  } catch (err) {
    console.error("GET /api/depositos-garantia/resumen error:", err);
    return res.status(500).json({ ok: false, message: "Error al obtener resumen." });
  }
});

// =====================================================
// GET /api/depositos-garantia/movimientos
// Todos los movimientos del usuario (hoja Transacciones)
// Query: tipo=recibido|realizado, deposito_id, desde, hasta
// =====================================================
router.get("/movimientos", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;
    const { tipo, deposito_id, desde, hasta } = req.query;

    let depositoIds = null;

    if (deposito_id && mongoose.Types.ObjectId.isValid(deposito_id)) {
      depositoIds = [new mongoose.Types.ObjectId(deposito_id)];
    } else if (tipo) {
      const deps = await DepositoGarantia.find({
        owner,
        tipo: normalizeTipo(tipo),
      }).select("_id").lean();
      depositoIds = deps.map((d) => d._id);
    }

    const filter = { owner };
    if (depositoIds) filter.deposito_id = { $in: depositoIds };
    if (desde || hasta) {
      filter.fecha = {};
      if (desde) filter.fecha.$gte = new Date(desde);
      if (hasta) filter.fecha.$lte = new Date(hasta);
    }

    const movimientos = await DepositoGarantiaMovimiento.find(filter)
      .sort({ fecha: -1 })
      .lean();

    // Enriquecer con nombre de la entidad
    const depositoMap = new Map();
    const uniqueDepositoIds = [...new Set(movimientos.map((m) => String(m.deposito_id)))];
    const depositos = await DepositoGarantia.find({
      _id: { $in: uniqueDepositoIds },
    }).select("_id entidad_nombre tipo").lean();
    depositos.forEach((d) => depositoMap.set(String(d._id), d));

    const data = movimientos.map((m) => {
      const dep = depositoMap.get(String(m.deposito_id)) || {};
      return mapMovimientoForUI(m, dep.entidad_nombre || "");
    });

    // Totales
    const entradas = data.filter((m) => m.monto_con_signo > 0).reduce((s, m) => s + m.monto, 0);
    const salidas = data.filter((m) => m.monto_con_signo < 0).reduce((s, m) => s + m.monto, 0);

    return res.json({
      ok: true,
      data,
      totales: { entradas, salidas, neto: entradas - salidas },
      total: data.length,
    });
  } catch (err) {
    console.error("GET /api/depositos-garantia/movimientos error:", err);
    return res.status(500).json({ ok: false, message: "Error al obtener movimientos." });
  }
});

// =====================================================
// GET /api/depositos-garantia/analitica
// Datos para gráfica de barras horizontal
// Query: tipo=recibido|realizado
// =====================================================
router.get("/analitica", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;
    const tipo = normalizeTipo(req.query.tipo || "recibido");

    const depositos = await DepositoGarantia.find({ owner, tipo, estado: "activo" })
      .sort({ saldo_actual: -1 })
      .lean();

    const data = depositos.map((d) => ({
      id: String(d._id),
      entidad_nombre: d.entidad_nombre || "Sin nombre",
      entidad_tipo: d.entidad_tipo || "empresa",
      saldo: toNum(d.saldo_actual, 0),
    }));

    return res.json({ ok: true, data, total: data.length });
  } catch (err) {
    console.error("GET /api/depositos-garantia/analitica error:", err);
    return res.status(500).json({ ok: false, message: "Error al obtener analítica." });
  }
});

// =====================================================
// GET /api/depositos-garantia
// Lista de posiciones (con ?tipo=recibido|realizado, ?estado=activo|liquidado|todos)
// =====================================================
router.get("/", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;
    const { tipo, estado = "activo", q } = req.query;

    const filter = { owner };
    if (tipo) filter.tipo = normalizeTipo(tipo);
    if (estado && estado !== "todos") filter.estado = estado;
    if (q) {
      filter.entidad_nombre = { $regex: asTrim(q), $options: "i" };
    }

    const depositos = await DepositoGarantia.find(filter)
      .sort({ entidad_nombre: 1, createdAt: -1 })
      .lean();

    const data = depositos.map(mapDepositoForUI);
    return res.json({ ok: true, data, total: data.length });
  } catch (err) {
    console.error("GET /api/depositos-garantia error:", err);
    return res.status(500).json({ ok: false, message: "Error al obtener depósitos." });
  }
});

// =====================================================
// POST /api/depositos-garantia
// Crear nueva posición + primer movimiento "nuevo"
// Body: tipo, entidad_nombre, entidad_rfc, entidad_tipo,
//       monto_inicial, metodo_pago, fecha, referencia
// =====================================================
router.post("/", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;
    const body = req.body || {};

    const tipo = normalizeTipo(body.tipo);
    const entidad_nombre = asTrim(body.entidad_nombre || body.nombre);
    const entidad_rfc = asTrim(body.entidad_rfc || body.rfc, "");
    const entidad_tipo = ["empresa", "persona"].includes(asTrim(body.entidad_tipo).toLowerCase())
      ? asTrim(body.entidad_tipo).toLowerCase()
      : "empresa";
    const monto = toNum(body.monto_inicial ?? body.monto, 0);
    const metodo_pago = normalizeMetodoPago(body.metodo_pago || "bancos");
    const fecha = asDateOrNull(body.fecha) || new Date();
    const referencia = asTrim(body.referencia || body.notas, "");

    if (!entidad_nombre) {
      return res.status(400).json({ ok: false, message: "El nombre de la entidad es requerido." });
    }
    if (monto <= 0) {
      return res.status(400).json({ ok: false, message: "El monto inicial debe ser mayor a 0." });
    }

    // Crear la posición
    const deposito = await DepositoGarantia.create({
      owner,
      tipo,
      entidad_nombre,
      entidad_rfc,
      entidad_tipo,
      saldo_actual: monto,
      fecha_inicio: fecha,
      referencia,
      estado: "activo",
    });

    // Crear el movimiento inicial
    const movimiento = await DepositoGarantiaMovimiento.create({
      owner,
      deposito_id: deposito._id,
      tipo_movimiento: "nuevo",
      monto,
      metodo_pago,
      fecha,
      referencia,
    });

    // Asiento contable (best-effort)
    const journalId = await crearAsientoContable({
      owner,
      deposito,
      movimiento,
      movimientoId: movimiento._id,
    });
    if (journalId) {
      await DepositoGarantiaMovimiento.findByIdAndUpdate(movimiento._id, { journal_entry_id: journalId });
    }

    return res.status(201).json({
      ok: true,
      data: {
        deposito: mapDepositoForUI(deposito),
        movimiento: mapMovimientoForUI(movimiento, entidad_nombre),
      },
    });
  } catch (err) {
    console.error("POST /api/depositos-garantia error:", err);
    return res.status(500).json({ ok: false, message: "Error al crear depósito en garantía." });
  }
});

// =====================================================
// GET /api/depositos-garantia/:id
// Detalle de una posición con sus movimientos
// =====================================================
router.get("/:id", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ ok: false, message: "ID inválido." });
    }

    const deposito = await DepositoGarantia.findOne({ _id: id, owner }).lean();
    if (!deposito) {
      return res.status(404).json({ ok: false, message: "Depósito no encontrado." });
    }

    const movimientos = await DepositoGarantiaMovimiento.find({ deposito_id: deposito._id, owner })
      .sort({ fecha: -1 })
      .lean();

    return res.json({
      ok: true,
      data: {
        deposito: mapDepositoForUI(deposito),
        movimientos: movimientos.map((m) => mapMovimientoForUI(m, deposito.entidad_nombre)),
      },
    });
  } catch (err) {
    console.error("GET /api/depositos-garantia/:id error:", err);
    return res.status(500).json({ ok: false, message: "Error al obtener detalle." });
  }
});

// =====================================================
// POST /api/depositos-garantia/:id/movimiento
// Agregar un movimiento a una posición existente
// Body: tipo_movimiento, monto, metodo_pago, fecha, referencia
// =====================================================
router.post("/:id/movimiento", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;
    const { id } = req.params;
    const body = req.body || {};

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ ok: false, message: "ID inválido." });
    }

    const deposito = await DepositoGarantia.findOne({ _id: id, owner });
    if (!deposito) {
      return res.status(404).json({ ok: false, message: "Depósito no encontrado." });
    }
    if (deposito.estado === "liquidado") {
      return res.status(400).json({ ok: false, message: "Este depósito ya está liquidado." });
    }

    const tipo_movimiento = normalizeTipoMovimiento(body.tipo_movimiento || "disminucion");
    const monto = toNum(body.monto, 0);
    const metodo_pago = normalizeMetodoPago(body.metodo_pago || "bancos");
    const fecha = asDateOrNull(body.fecha) || new Date();
    const referencia = asTrim(body.referencia || body.notas, "");

    if (monto <= 0) {
      return res.status(400).json({ ok: false, message: "El monto debe ser mayor a 0." });
    }

    // Calcular nuevo saldo
    const positivo = esMovimientoPositivo(tipo_movimiento);
    let nuevoSaldo = positivo
      ? deposito.saldo_actual + monto
      : deposito.saldo_actual - monto;

    if (nuevoSaldo < 0) {
      return res.status(400).json({
        ok: false,
        message: `El monto excede el saldo actual (${deposito.saldo_actual.toLocaleString("es-MX", { style: "currency", currency: "MXN" })}).`,
      });
    }

    // Si es liquidación o el saldo queda en 0, marcar como liquidado
    const esLiquidacion = tipo_movimiento === "liquidacion" || nuevoSaldo === 0;
    if (esLiquidacion) nuevoSaldo = 0;

    // Guardar movimiento
    const movimiento = await DepositoGarantiaMovimiento.create({
      owner,
      deposito_id: deposito._id,
      tipo_movimiento: esLiquidacion ? "liquidacion" : tipo_movimiento,
      monto,
      metodo_pago,
      fecha,
      referencia,
    });

    // Actualizar saldo y estado de la posición
    deposito.saldo_actual = nuevoSaldo;
    deposito.estado = esLiquidacion ? "liquidado" : "activo";
    await deposito.save();

    // Asiento contable (best-effort)
    const journalId = await crearAsientoContable({
      owner,
      deposito,
      movimiento,
      movimientoId: movimiento._id,
    });
    if (journalId) {
      await DepositoGarantiaMovimiento.findByIdAndUpdate(movimiento._id, { journal_entry_id: journalId });
    }

    return res.status(201).json({
      ok: true,
      data: {
        deposito: mapDepositoForUI(deposito),
        movimiento: mapMovimientoForUI(movimiento, deposito.entidad_nombre),
      },
    });
  } catch (err) {
    console.error("POST /api/depositos-garantia/:id/movimiento error:", err);
    return res.status(500).json({ ok: false, message: "Error al registrar movimiento." });
  }
});

module.exports = router;
```

---

## CAMBIO 4 — Agregar cuentas 1241 y 2104 en `backend/utils/seedDefaults.js`

Abre `backend/utils/seedDefaults.js`.

### 4a — Agregar cuenta 1241 (Activo No Circulante)

Busca la línea:
```js
  { code: "1213", name: "Depreciación Acumulada Otros Activos", type: "activo" },
```

INMEDIATAMENTE DESPUÉS de esa línea, agrega:
```js
  { code: "1241", name: "Depósitos en Garantía Realizados", type: "activo" },
```

### 4b — Agregar cuenta 2104 (Pasivo No Circulante)

Busca la línea:
```js
  { code: "2103", name: "Documentos por Pagar Largo Plazo", type: "pasivo" },
```

INMEDIATAMENTE DESPUÉS de esa línea, agrega:
```js
  { code: "2104", name: "Depósitos en Garantía Recibidos", type: "pasivo" },
```

---

## CAMBIO 5 — Montar la nueva ruta en `backend/server.js`

Busca la línea:
```js
app.use("/api/financiamientos", require("./routes/financiamientos"));
```

INMEDIATAMENTE DESPUÉS de esa línea, agrega:
```js
app.use("/api/depositos-garantia", require("./routes/depositosGarantia"));
```

---

## Verificación

```bash
node --check backend/routes/depositosGarantia.js
node --check backend/models/DepositoGarantia.js
node --check backend/models/DepositoGarantiaMovimiento.js
node --check backend/utils/seedDefaults.js
node --check backend/server.js
```

Si todos los checks pasan, inicia el servidor y prueba:

```bash
# Resumen (debe devolver { ok: true, data: { recibidos: {...}, realizados: {...} } })
curl -s http://localhost:3000/api/depositos-garantia/resumen -H "Cookie: bukipin_token=TU_TOKEN"

# Lista (debe devolver { ok: true, data: [] } si no hay registros aún)
curl -s http://localhost:3000/api/depositos-garantia -H "Cookie: bukipin_token=TU_TOKEN"
```

---

## Efecto esperado

| Endpoint | Resultado |
|---|---|
| `GET /api/depositos-garantia/resumen` | ✅ Totales para las 2 tarjetas de entrada |
| `GET /api/depositos-garantia?tipo=recibido` | ✅ Lista posiciones recibidas |
| `GET /api/depositos-garantia?tipo=realizado` | ✅ Lista posiciones realizadas |
| `POST /api/depositos-garantia` | ✅ Crea posición + movimiento inicial + asiento contable |
| `GET /api/depositos-garantia/:id` | ✅ Detalle con historial de movimientos |
| `POST /api/depositos-garantia/:id/movimiento` | ✅ Aumento / disminución / devolución / liquidación |
| `GET /api/depositos-garantia/movimientos` | ✅ Todos los movimientos (hoja Transacciones) |
| `GET /api/depositos-garantia/analitica` | ✅ Datos para gráfica de barras |
| `seedDefaults.js` | ✅ Cuentas 1241 y 2104 se crean al registrar nuevo usuario |
