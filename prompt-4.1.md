# Prompt 4.1 — Impuestos por Pagar en Cuentas por Pagar

## Contexto

Cuando un impuesto se registra como `tipoPago: "credito"` o `"parcial"` en `TaxISRRecord`,
debe aparecer en la página Cuentas por Pagar bajo un cuadro separado llamado
**"Impuestos por Pagar"**. No es un proveedor ni un acreedor diverso — es la autoridad fiscal.

Hoy los registros de `TaxISRRecord` con saldo pendiente NO aparecen en CXP. Se requiere:
1. Endpoint en backend para listar impuestos pendientes
2. Soporte de pago en `cxp.js` para `source: "impuesto"`
3. El hook `useCuentasPorPagarAgrupadas` que los incluya
4. UI en `CuentasPorPagar.tsx` con la misma UX que los demás cuadros

---

## CAMBIO 1 — Backend: nuevo endpoint en `backend/routes/impuestos.js`

Ubica el bloque:
```js
router.get("/isr/registros", ensureAuth, async (req, res) => {
```

ANTES de ese bloque, inserta el siguiente endpoint completo:

```js
// GET /api/impuestos/isr/pendientes
// Devuelve TaxISRRecords con saldo pendiente > 0 (para CXP)
router.get("/isr/pendientes", ensureAuth, async (req, res) => {
  try {
    const owner = req.user._id;
    const registros = await TaxISRRecord.find({
      owner,
      saldoPendiente: { $gt: 0 },
      estado: { $ne: "pagado" },
    })
      .sort({ ano: -1, mes: -1, createdAt: -1 })
      .lean();

    const MESES = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

    const data = registros.map((r) => ({
      id: String(r._id),
      descripcion: `ISR ${MESES[(r.mes || 1) - 1]} ${r.ano || ""}`.trim(),
      autoridad_nombre: r.autoridadNombreSnapshot || "Autoridad Fiscal",
      monto_total: toNum(r.isrRealTotal, 0),
      monto_pagado: toNum(r.montoPagado, 0),
      monto_pendiente: toNum(r.saldoPendiente, 0),
      saldo_pendiente: toNum(r.saldoPendiente, 0),
      fecha_vencimiento: toYMD(r.fechaVencimiento),
      tipo_pago: r.tipoPago || "",
      estado: r.estado || "pendiente",
      mes: r.mes,
      ano: r.ano,
    }));

    return res.json({ ok: true, data });
  } catch (err) {
    console.error("GET /api/impuestos/isr/pendientes error:", err);
    return res.status(500).json({ ok: false, message: "Error al obtener impuestos pendientes" });
  }
});
```

---

## CAMBIO 2 — Backend: soporte `source === "impuesto"` en `backend/routes/cxp.js`

Busca el bloque que comienza con:
```js
if (source !== "egreso" && source !== "capex") {
  return res.status(400).json({ ok: false, error: "NOT_SUPPORTED", ...
```

Reemplaza ese `if` (la condición completa) para que diga:
```js
if (source !== "egreso" && source !== "capex" && source !== "impuesto") {
  return res.status(400).json({ ok: false, error: "NOT_SUPPORTED", message: "source no soportado." });
}
```

Luego, ANTES del bloque de `source === "capex"` (búscalo por `// Flujo CAPEX` o `if (source === "capex")`),
inserta el siguiente bloque completo de impuesto:

```js
// ──────────────────────────────────────────────
// Flujo IMPUESTO (source === "impuesto")
// ──────────────────────────────────────────────
if (source === "impuesto") {
  const TaxISRRecord = (() => {
    try { return require("../models/TaxISRRecord"); } catch (_) { return null; }
  })();
  if (!TaxISRRecord) {
    return res.status(500).json({ ok: false, message: "Modelo TaxISRRecord no disponible" });
  }

  const taxRecord = await TaxISRRecord.findOne({ _id: facturaId, owner });
  if (!taxRecord) {
    return res.status(404).json({ ok: false, message: "Registro de impuesto no encontrado" });
  }
  if (taxRecord.estado === "pagado") {
    return res.status(400).json({ ok: false, message: "Este impuesto ya está pagado" });
  }
  const pendiente = toNum(taxRecord.saldoPendiente, 0);
  if (pendiente <= 0) {
    return res.status(400).json({ ok: false, message: "No hay saldo pendiente en este impuesto" });
  }
  if (monto > pendiente + 0.01) {
    return res.status(400).json({ ok: false, message: `Monto excede el saldo pendiente ($${pendiente})` });
  }

  // Cuenta de pago según método
  const paymentAccountCodigo = metodoPago === "efectivo" ? "1001" : "1002";

  // Asiento contable: Débito 2005 (Impuestos por Pagar) / Crédito 1001 o 1002
  const journalLines = [
    {
      accountCodigo: "2005",
      debit: monto,
      credit: 0,
      memo: `Pago impuesto ${taxRecord.autoridadNombreSnapshot || ""} | ${metodoPago}`,
    },
    {
      accountCodigo: paymentAccountCodigo,
      debit: 0,
      credit: monto,
      memo: `Pago impuesto ${taxRecord.autoridadNombreSnapshot || ""} | ${metodoPago}`,
    },
  ];

  const journalEntry = await JournalEntry.create({
    owner,
    date: new Date(),
    source: "pago_cxp_impuesto",
    description: `Pago ISR ${metodoPago} $${monto}`,
    lines: journalLines,
  });

  // Actualizar TaxISRRecord
  const nuevoPagado = toNum(taxRecord.montoPagado, 0) + monto;
  const nuevoPendiente = Math.max(0, toNum(taxRecord.isrRealTotal, 0) - nuevoPagado);
  taxRecord.montoPagado = nuevoPagado;
  taxRecord.saldoPendiente = nuevoPendiente;
  taxRecord.estado = nuevoPendiente <= 0 ? "pagado" : "parcial";
  await taxRecord.save();

  return res.json({
    ok: true,
    pago_id: String(journalEntry._id),
    asiento_id: String(journalEntry._id),
    meta: {
      monto_pagado: nuevoPagado,
      monto_pendiente: nuevoPendiente,
    },
  });
}
// ──────────────────────────────────────────────
```

---

## CAMBIO 3 — Frontend: `useCuentasPorPagarAgrupadas.tsx`

### 3a — Ampliar tipos

Localiza:
```typescript
export interface FacturaCxP {
```

Busca la línea:
```typescript
  tipo_transaccion: "egreso" | "capex";
```
Cámbiala a:
```typescript
  tipo_transaccion: "egreso" | "capex" | "impuesto";
```

Luego localiza:
```typescript
export interface TipoCxP {
  id: "inventario" | "capex" | "operativos" | "acreedores";
```
Cámbiala a:
```typescript
export interface TipoCxP {
  id: "inventario" | "capex" | "operativos" | "acreedores" | "impuestos";
```

### 3b — Importar icono

Busca la línea de imports de lucide-react:
```typescript
import { Package, Building2, Receipt, Users } from "lucide-react";
```
Reemplázala por:
```typescript
import { Package, Building2, Receipt, Users, Scale } from "lucide-react";
```

### 3c — Fetch de impuestos pendientes

Dentro de la función `queryFn` de `useCuentasPorPagarAgrupadas`, busca:
```typescript
      const egresosRaw = await safeGetArray("/api/transacciones/egresos?estado=activo&pendiente_gt=0");
      const inversionesRaw = await safeGetArray("/api/inversiones/capex?pendiente_gt=0");
```
Reemplázalo por:
```typescript
      const egresosRaw = await safeGetArray("/api/transacciones/egresos?estado=activo&pendiente_gt=0");
      const inversionesRaw = await safeGetArray("/api/inversiones/capex?pendiente_gt=0");
      const impuestosRaw = await safeGetArray("/api/impuestos/isr/pendientes");
```

### 3d — Mapear impuestos a FacturaCxP

Busca la sección que comienza con:
```typescript
      // Convertir inversiones CAPEX a formato de factura
```
Inmediatamente DESPUÉS del bloque de CAPEX (después de `});`), inserta:

```typescript
      // Convertir impuestos pendientes a formato de factura
      const impuestosPendientes: FacturaCxP[] = (impuestosRaw || []).map((imp) => {
        return {
          id: safeStr(imp.id || imp._id || ""),
          descripcion: safeStr(imp.descripcion || "ISR Pendiente"),
          monto_total: toNum(imp.monto_total, 0),
          monto_pagado: toNum(imp.monto_pagado, 0),
          monto_pendiente: toNum(imp.monto_pendiente ?? imp.saldo_pendiente, 0),
          fecha_vencimiento: safeStr(imp.fecha_vencimiento || "", "") || null,
          created_at: safeStr(imp.created_at || new Date().toISOString()),
          tipo_pago: safeStr(imp.tipo_pago || "credito"),
          metodo_pago: null,
          estado: safeStr(imp.estado || "pendiente"),
          tipo_transaccion: "impuesto" as const,
          proveedor_nombre: safeStr(imp.autoridad_nombre || "Autoridad Fiscal"),
          proveedor_email: null,
          proveedor_telefono: null,
          proveedor_rfc: null,
        };
      }).filter((f) => f.monto_pendiente > 0);
```

### 3e — Agregar el 5to tipo "impuestos"

Busca el array `tipos: TipoCxP[]` y al final de los 4 elementos (después del objeto de "acreedores" y antes del `]`), agrega:

```typescript
        {
          id: "impuestos",
          nombre: "Impuestos por Pagar",
          descripcion: "ISR y contribuciones pendientes de pago a autoridades fiscales",
          icon: Scale,
          color: "hsl(var(--chart-5))",
          totalPendiente: impuestosPendientes.reduce((sum, f) => sum + toNum(f.monto_pendiente, 0), 0),
          totalFacturas: impuestosPendientes.length,
          totalProveedores: new Set(impuestosPendientes.map((f) => f.proveedor_nombre || "Autoridad")).size,
          proveedores: agruparPorProveedor(impuestosPendientes),
        },
```

---

## CAMBIO 4 — Frontend: `CuentasPorPagar.tsx`

### 4a — Ampliar TipoMenuProveedores

Busca:
```typescript
type TipoMenuProveedores = "inventario" | "capex" | "operativos";
```
Cámbialo a:
```typescript
type TipoMenuProveedores = "inventario" | "capex" | "operativos" | "impuestos";
```

### 4b — Obtener tipoImpuestos

Busca el bloque:
```typescript
  const tipoInventario = getTipo("inventario");
  const tipoCapex = getTipo("capex");
  const tipoOperativos = getTipo("operativos");
  const tipoAcreedoresDiversos = getTipo("acreedores");
```
Reemplázalo por:
```typescript
  const tipoInventario = getTipo("inventario");
  const tipoCapex = getTipo("capex");
  const tipoOperativos = getTipo("operativos");
  const tipoAcreedoresDiversos = getTipo("acreedores");
  const tipoImpuestos = getTipo("impuestos");
```

### 4c — Ampliar tipo de registrarPagoMutation

Busca:
```typescript
      tipo: "egreso" | "capex";
```
(dentro del tipo de la mutación de pago). Cámbialo a:
```typescript
      tipo: "egreso" | "capex" | "impuesto";
```

### 4d — Agregar heroConfig para "impuestos"

Dentro del `switch (tipoSeleccionado)` de `heroConfig`, busca el case:
```typescript
      case "acreedores":
        return {
```
ANTES de ese case, inserta:
```typescript
      case "impuestos":
        return {
          breadcrumb: "/ Impuestos por Pagar",
          title: "Impuestos por Pagar",
          subtitle: "ISR y contribuciones pendientes de pago a autoridades fiscales",
          amountLabel: "Total pendiente",
          gradient: "from-amber-950 via-orange-900 to-amber-900",
          panelBg: "bg-white/10 border-white/10",
          textSoft: "text-amber-100",
          Icon: Scale,
        };
```

### 4e — Agregar el cuadro "Impuestos por Pagar" en la pantalla principal

Busca el Card de "Acreedores Diversos" en el JSX (busca `"Acreedores Diversos"` dentro del JSX):
```typescript
                <Card
                  className={cn(
                    "cursor-pointer overflow-hidden border-0",
                    "bg-gradient-to-br from-emerald-950 via-emerald-900 to-teal-900 text-white",
```

DESPUÉS del cierre de ese Card (`</Card>`), inserta el nuevo cuadro:

```typescript
                <Card
                  className={cn(
                    "cursor-pointer overflow-hidden border-0",
                    "bg-gradient-to-br from-amber-950 via-orange-900 to-amber-900 text-white",
                    "shadow-lg shadow-amber-900/10 hover:shadow-xl hover:shadow-amber-900/20 transition-all"
                  )}
                  onClick={() => {
                    setTipoSeleccionado("impuestos");
                    setExpandedProveedores(new Set());
                    setSearchTerm("");
                    setEstadoFiltroLista("todos");
                    setOrdenLista("monto_desc");
                  }}
                >
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-4">
                      <div className="space-y-1">
                        <CardTitle className="text-xl font-semibold tracking-tight">Impuestos por Pagar</CardTitle>
                        <CardDescription className="text-amber-100">
                          ISR y contribuciones pendientes a autoridades fiscales
                        </CardDescription>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="rounded-xl bg-white/10 p-2">
                          <Scale className="h-5 w-5 text-white" />
                        </div>
                        <span className="text-sm text-amber-100">Ver detalle →</span>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="text-4xl font-bold">{formatCurrency(tipoImpuestos?.totalPendiente || 0)}</div>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div className="rounded-xl bg-white/5 p-3 border border-white/10">
                        <div className="text-amber-100">Registros pendientes</div>
                        <div className="text-lg font-semibold">{tipoImpuestos?.totalFacturas || 0}</div>
                      </div>
                      <div className="rounded-xl bg-white/5 p-3 border border-white/10">
                        <div className="text-amber-100">Autoridades</div>
                        <div className="text-lg font-semibold">{tipoImpuestos?.totalProveedores || 0}</div>
                      </div>
                    </div>
                    <div className="text-xs text-amber-100">
                      Haz click para ver el listado y registrar pagos.
                    </div>
                  </CardContent>
                </Card>
```

### 4f — Importar Scale en CuentasPorPagar.tsx

Busca la línea de imports de lucide-react en `CuentasPorPagar.tsx` (contiene: `Landmark`, `BriefcaseBusiness`, `Users`, etc.).
Agrega `Scale` al final de esa importación si no está ya presente.

### 4g — Cambiar label "Proveedor" → "Autoridad Fiscal" para impuestos

Busca en el JSX del listado de proveedores/acreedores esta línea (que ya tiene la condición para "acreedores"):
```typescript
                            {tipoSeleccionado === "acreedores" ? "Acreedor" : "Proveedor"}
```
Cámbiala a:
```typescript
                            {tipoSeleccionado === "acreedores" ? "Acreedor" : tipoSeleccionado === "impuestos" ? "Autoridad Fiscal" : "Proveedor"}
```

---

## Verificación

Después de aplicar todos los cambios:

```bash
# Backend
node --check backend/routes/impuestos.js
node --check backend/routes/cxp.js

# Frontend
cd bukipin-dashboard && npx tsc --noEmit 2>&1 | head -30
```

## Efecto esperado

- En Cuentas por Pagar aparece un nuevo cuadro **"Impuestos por Pagar"** con fondo ámbar
- Muestra el total pendiente, registros pendientes y autoridades fiscales
- Al hacer click muestra el listado de TaxISRRecords con saldo > 0
- El botón "Pagar" registra el JournalEntry: Débito 2005 / Crédito 1001|1002
- Actualiza `saldoPendiente` y `estado` en TaxISRRecord
- Invalida queries `["cuentas-por-pagar-agrupadas"]` y `["asientos-balanza"]` en éxito

## Nota importante

El cuadro de "Acreedores Diversos" (emerald) y el nuevo de "Impuestos por Pagar" (ámbar)
deben quedar como **cards separados** a nivel visual en la pantalla de selección.
Si el layout actual usa `grid grid-cols-1 lg:grid-cols-2`, el nuevo card cabe en esa grilla.
Si la grilla no puede acomodar un 3er card en 2 columnas, amplía a `lg:grid-cols-2` con
el nuevo card ocupando su celda individual (no es necesario que sea 3 columnas, basta que fluya).
