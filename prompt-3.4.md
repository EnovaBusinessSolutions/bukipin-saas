# Bug 3.4 — Pago de deuda de inversión a crédito (CXP + Balanza)

## Contexto del problema

Cuando el usuario registra una inversión a crédito (`tipo_pago: "credito"`), se crea:
1. Un documento CAPEX con `monto_pendiente = valor_total` y `tipo_pago = "credito"`
2. Un JournalEntry: `Debit 1205 (u otra cuenta del activo), Credit 2001 (Proveedores)`

La Balanza ya refleja ese JournalEntry (fix 3.3). Pero el flujo de **pago** desde la pantalla "Cuentas por Pagar" está completamente roto:

**Flujo actual (roto):**
- Frontend `CuentasPorPagar.tsx` llama `POST /api/cxp/pagos` con `{ facturaId, source: "capex", monto, metodo }`
- Backend `cxp.js` línea ~389 tiene: `if (source !== "egreso") return 400 "Solo soporta source=egreso"`
- El pago se rechaza → no se crea JournalEntry → CAPEX no se actualiza → Balanza nunca refleja el pago

## Archivos involucrados

- `backend/routes/cxp.js` — contiene `POST /api/cxp/pagos` (el único cambio de backend)
- No se requieren cambios en el frontend (el frontend ya está correcto: invalida `asientos-balanza` en success)

## CapexModel en cxp.js

El archivo `cxp.js` actualmente NO carga CapexModel. Debes cargarlo dinámicamente al inicio del archivo (igual que en `inversiones.js`), justo después de los otros requires existentes:

```js
// Cargar CapexModel dinámicamente (igual que inversiones.js)
let CapexModel = null;
const tryModelsCapex = ["Capex", "CAPEX", "Investment", "Inversion", "InversionCapex", "CapexTransaction"];
for (const modelName of tryModelsCapex) {
  try {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    CapexModel = require(`../models/${modelName}`);
    if (CapexModel) break;
  } catch (_) { /* modelo no existe, continuar */ }
}
```

## Cambio en `POST /api/cxp/pagos`

El handler actual (líneas ~372-481) debe ser modificado para soportar `source: "capex"` además de `source: "egreso"`.

### Paso 1: cambiar la validación de source

Busca:
```js
    if (source !== "egreso") {
      return res.status(400).json({ ok: false, error: "NOT_SUPPORTED", message: "Solo soporta source=egreso por ahora." });
    }
```

Reemplaza por:
```js
    if (source !== "egreso" && source !== "capex") {
      return res.status(400).json({
        ok: false,
        error: "NOT_SUPPORTED",
        message: "source debe ser 'egreso' o 'capex'",
      });
    }
```

### Paso 2: separar el flujo por source

Después de la validación anterior, el código actual hace:
```js
    const tx = await ExpenseTransaction.findOne({ owner, _id: new mongoose.Types.ObjectId(facturaId) });
    if (!tx) return res.status(404).json(...);
    ...
```

Necesitas bifurcar el flujo. La estructura completa del handler después de las validaciones iniciales (`facturaId`, `monto`, `metodoPago`) debe quedar así:

```js
    const metodoPago = normalizeMetodoPago(metodoPagoRaw);
    if (!metodoPago) {
      return res.status(400).json({ ok: false, error: "VALIDATION", message: "metodo es requerido" });
    }

    const PROVEEDORES_2001 = process.env.CTA_CXP || "2001";
    const OTROS_ACREEDORES_2003 = process.env.CTA_OTROS_ACREEDORES || "2003";
    const creditInfo = resolveCreditAccountByMetodoPago(metodoPago);

    // ─────────────────────────────────────────────────────────
    // FLUJO CAPEX (inversiones a crédito)
    // ─────────────────────────────────────────────────────────
    if (source === "capex") {
      if (!CapexModel) {
        return res.status(500).json({
          ok: false,
          error: "MISSING_MODEL",
          message: "Modelo CAPEX no disponible",
        });
      }

      const capex = await CapexModel.findOne({
        _id: new mongoose.Types.ObjectId(facturaId),
        $or: [{ owner }, { user: owner }, { userId: owner }],
      });

      if (!capex) {
        return res.status(404).json({ ok: false, error: "NOT_FOUND", message: "Inversión no encontrada" });
      }

      const estadoCapex = String(capex.estado ?? capex.status ?? "activo").toLowerCase();
      if (["cancelado", "cancelada"].includes(estadoCapex)) {
        return res.status(400).json({ ok: false, error: "VALIDATION", message: "No se puede pagar una inversión cancelada" });
      }

      const pendienteActual = toNum(capex.monto_pendiente ?? capex.montoPendiente, 0);
      if (!(pendienteActual > 0)) {
        return res.status(400).json({ ok: false, error: "VALIDATION", message: "Esta inversión ya no tiene saldo pendiente" });
      }
      if (monto > pendienteActual + 0.01) {
        return res.status(400).json({ ok: false, error: "VALIDATION", message: "El monto no puede ser mayor al saldo pendiente" });
      }

      // Cuenta del activo fijo (para referencia en concepto)
      const cuentaActivo = String(capex.cuenta_codigo ?? capex.cuentaCodigo ?? "1205").trim();
      const nombreInversion = String(capex.producto_nombre ?? capex.nombre ?? capex.descripcion ?? "Inversión").trim();
      const conceptText = `Pago CxP CAPEX: ${nombreInversion} (${metodoPago})`;

      // Asiento contable: Debit 2001 (cancela pasivo), Credit 1001/1002 (salida de efectivo)
      const lines = [
        {
          accountCodigo: PROVEEDORES_2001,
          debit: monto,
          credit: 0,
          memo: `Liquidación pasivo proveedor - ${nombreInversion}`,
        },
        {
          accountCodigo: String(creditInfo.cuentaCodigo),
          debit: 0,
          credit: monto,
          memo: `Salida por ${creditInfo.tipo} - ${nombreInversion}`,
        },
      ];

      const asiento = await JournalEntry.create({
        owner,
        date: fechaPago,
        concept: conceptText,
        source: "pago_cxp_capex",
        sourceId: capex._id,
        transaccionId: capex._id,
        source_id: capex._id,
        lines,
        references: [
          {
            source: "capex",
            id: String(capex._id),
            numero: String(capex.journalEntryId || ""),
          },
        ],
      });

      // Actualizar CAPEX: monto_pagado y monto_pendiente
      const nuevoPagado = toNum(capex.monto_pagado ?? capex.montoPagado, 0) + monto;
      const nuevoTotal = toNum(capex.valor_total ?? capex.monto_total ?? capex.montoTotal, 0);
      const nuevoPendiente = Math.max(0, nuevoTotal - nuevoPagado);

      await CapexModel.updateOne(
        { _id: capex._id },
        {
          $set: {
            monto_pagado: nuevoPagado,
            montoPagado: nuevoPagado,
            monto_pendiente: nuevoPendiente,
            montoPendiente: nuevoPendiente,
            ...(nuevoPendiente <= 0
              ? { tipo_pago: "contado", tipoPago: "contado", metodo_pago: metodoPago, metodoPago }
              : { tipo_pago: "parcial", tipoPago: "parcial", metodo_pago: metodoPago, metodoPago }),
          },
        }
      );

      return res.json({
        ok: true,
        pago_id: String(asiento._id),
        asiento_id: String(asiento._id),
        factura_id: String(capex._id),
        data: { ok: true },
        meta: {
          monto_pagado: nuevoPagado,
          monto_pendiente: nuevoPendiente,
          timezoneOffsetMinutes: TZ_OFFSET_MINUTES,
        },
      });
    }

    // ─────────────────────────────────────────────────────────
    // FLUJO EGRESO (comportamiento original, sin cambios)
    // ─────────────────────────────────────────────────────────
    const tx = await ExpenseTransaction.findOne({ owner, _id: new mongoose.Types.ObjectId(facturaId) });
    if (!tx) return res.status(404).json({ ok: false, error: "NOT_FOUND", message: "Factura (egreso) no encontrada" });

    if (String(tx.estado || "").toLowerCase() === "cancelado") {
      return res.status(400).json({ ok: false, error: "VALIDATION", message: "No se puede pagar un egreso cancelado" });
    }

    const pendienteActual = toNum(tx.montoPendiente, 0);
    if (!(pendienteActual > 0)) {
      return res.status(400).json({ ok: false, error: "VALIDATION", message: "Esta factura ya no tiene saldo pendiente" });
    }
    if (monto > pendienteActual) {
      return res.status(400).json({ ok: false, error: "VALIDATION", message: "El monto no puede ser mayor al saldo pendiente" });
    }

    const cuentaPendiente = isOtrosGastosFromTx(tx) ? OTROS_ACREEDORES_2003 : PROVEEDORES_2001;
    const conceptText = `Pago CxP: ${tx.descripcion || "Egreso"} (${metodoPago})`;

    const lines = [
      {
        accountCodigo: String(cuentaPendiente),
        debit: monto,
        credit: 0,
        memo: `Aplicación a ${cuentaPendiente} (${isOtrosGastosFromTx(tx) ? "Acreedores" : "Proveedores"})`,
      },
      {
        accountCodigo: String(creditInfo.cuentaCodigo),
        debit: 0,
        credit: monto,
        memo: `Salida por ${creditInfo.tipo}`,
      },
    ];

    const asiento = await JournalEntry.create({
      owner,
      date: fechaPago,
      concept: conceptText,
      source: "pago_cxp",
      sourceId: tx._id,
      transaccionId: tx._id,
      source_id: tx._id,
      lines,
      references: [{ source: "egreso", id: String(tx._id), numero: String(tx.numeroAsiento || "") }],
    });

    const nuevoPagado = toNum(tx.montoPagado, 0) + monto;
    tx.montoPagado = nuevoPagado;
    tx.montoPendiente = Math.max(0, toNum(tx.montoTotal, 0) - nuevoPagado);

    if (tx.montoPendiente <= 0) {
      tx.tipoPago = "contado";
      tx.metodoPago = metodoPago;
    } else {
      tx.tipoPago = "parcial";
      tx.metodoPago = metodoPago;
    }

    await tx.save();

    return res.json({
      ok: true,
      pago_id: String(asiento._id),
      asiento_id: String(asiento._id),
      factura_id: String(tx._id),
      data: { ok: true },
      meta: { timezoneOffsetMinutes: TZ_OFFSET_MINUTES },
    });
```

**IMPORTANTE:** El bloque completo anterior reemplaza TODO el contenido actual del handler desde la validación de `metodoPago` hasta el `return res.json(...)` final del egreso. Asegúrate de no duplicar la línea `} catch (err) {` que ya existe al final.

## Notas de implementación

- El asiento CAPEX usa `source: "pago_cxp_capex"` para distinguirlo del pago de egresos
- `resolveCreditAccountByMetodoPago` ya existe en cxp.js y es reutilizable para ambos flujos
- `PROVEEDORES_2001` ya existe en el scope del handler original — mantenerla
- La invalidación de `asientos-balanza` ya está en el frontend (`CuentasPorPagar.tsx` línea 216), no se requieren cambios en el frontend
- El `tipoPorSource("pago_cxp_capex")` en `useAsientosBalanza.tsx` retornará "Otro" — está bien por ahora

## Verificación post-implementación

1. `node --check backend/routes/cxp.js` — sin errores de sintaxis
2. Prueba manual:
   - Registrar una inversión a crédito → debe aparecer en Balanza (cuenta 1205 Activo, cuenta 2001 Pasivo)
   - Ir a Cuentas por Pagar → debe aparecer la deuda CAPEX
   - Pagar la deuda → debe crear JournalEntry (Debit 2001, Credit 1002)
   - La Balanza debe actualizarse: 2001 se reduce, 1002 se reduce
   - El CAPEX debe mostrar `monto_pendiente = 0` si se pagó completo

## Convenciones
- Backend CommonJS (`require`/`module.exports`)
- Respuestas `{ ok: boolean, data?, message? }`
- Siempre filtrar por `owner` para multi-tenancy
- No crear archivos nuevos — todo va en `backend/routes/cxp.js`
