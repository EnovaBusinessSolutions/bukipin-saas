# Prompt 5.1 — Subcuentas solo para Ingresos y Egresos/Gastos

## Contexto

El usuario ha decidido que las subcuentas solo tienen sentido en cuentas de tipo
**ingreso** y **gasto** (que cubre egresos y gastos). Actualmente la UI permite
crear subcuentas para cualquier cuenta (activos, pasivos, capital, etc.).

Se requiere:
1. **Backend**: validar que la cuenta madre sea tipo `ingreso` o `gasto`
2. **Frontend PlanCuentas.tsx**:
   - El selector de cuenta madre solo muestre cuentas de tipo ingreso/gasto
   - El catálogo solo muestre expansión de subcuentas para esas cuentas
   - La función `agregarSubcuenta` valide antes de llamar al API

---

## CAMBIO 1 — Backend: `backend/routes/subcuentas.js`

En el `router.post("/", ...)`, busca el bloque donde se valida que existe la cuenta padre:
```js
    const parent = await findParentAccount({ owner, parentCode });
    if (!parent) {
      return res.status(404).json({
```

INMEDIATAMENTE DESPUÉS del bloque del `if (!parent) { ... }` (después de su `}`), inserta:

```js
    // Solo se permiten subcuentas en cuentas de tipo ingreso o gasto
    const TIPOS_PERMITIDOS = ["ingreso", "gasto"];
    const parentType = String(parent.type || "").toLowerCase().trim();
    if (!TIPOS_PERMITIDOS.includes(parentType)) {
      return res.status(400).json({
        ok: false,
        message: `Solo se permiten subcuentas en cuentas de tipo ingreso o gasto. La cuenta '${parentCode}' es de tipo '${parent.type || "desconocido"}'.`,
      });
    }
```

---

## CAMBIO 2 — Frontend: `bukipin-dashboard/src/pages/PlanCuentas.tsx`

### 2a — Agregar `estadosFinancierosParaSubcuentas` (useMemo filtrado)

Busca el bloque de `estadosFinancieros` (el useMemo que termina con `buildEstadosFinancierosFromFlat`):
```typescript
  }, [cuentasData, todasLasCuentas]);
```
(ese es el cierre del useMemo de `estadosFinancieros`)

INMEDIATAMENTE DESPUÉS de esa línea, inserta el siguiente bloque:

```typescript
  // Solo Ingresos y Egresos pueden tener subcuentas
  const estadosFinancierosParaSubcuentas = useMemo(() => {
    const GRUPOS_PERMITIDOS = ["Ingresos", "Egresos"];
    const filtered: Record<string, Record<string, Record<string, any[]>>> = {};

    for (const [estado, grupos] of Object.entries(estadosFinancieros)) {
      for (const [grupo, subgrupos] of Object.entries(grupos as any)) {
        if (!GRUPOS_PERMITIDOS.includes(grupo)) continue;
        if (!filtered[estado]) filtered[estado] = {};
        filtered[estado][grupo] = subgrupos as any;
      }
    }

    return filtered;
  }, [estadosFinancieros]);
```

### 2b — Pasar `estadosFinancierosParaSubcuentas` al selector

Busca en el JSX (dentro del tab "subcuentas") la línea donde se usa `FriendlyAccountSelector`:
```typescript
                  <FriendlyAccountSelector
                    value={cuentaMadreSeleccionada}
                    onValueChange={(codigo) => setCuentaMadreSeleccionada(codigo)}
                    estadosFinancieros={estadosFinancieros}
                  />
```

Reemplázala por:
```typescript
                  <FriendlyAccountSelector
                    value={cuentaMadreSeleccionada}
                    onValueChange={(codigo) => setCuentaMadreSeleccionada(codigo)}
                    estadosFinancieros={estadosFinancierosParaSubcuentas}
                  />
```

### 2c — Validar tipo en `agregarSubcuenta`

Busca la función `agregarSubcuenta`:
```typescript
  const agregarSubcuenta = () => {
    const name = nombreSubcuenta.trim();
    const parentCode = cuentaMadreSeleccionada;

    if (!name || !parentCode) return;
```

Reemplaza el cuerpo inicial de esa función (desde `const name` hasta el primer `return`) por:
```typescript
  const agregarSubcuenta = () => {
    const name = nombreSubcuenta.trim();
    const parentCode = cuentaMadreSeleccionada;

    if (!name || !parentCode) return;

    // Validar que la cuenta madre sea ingreso o gasto
    const inheritedTypeRaw = String((cuentaMadreObj as any)?.type ?? "").trim().toLowerCase();
    const inferredType = inferTypeByCodigo(parentCode).toLowerCase();
    const tipo = inheritedTypeRaw || inferredType;

    if (tipo !== "ingreso" && tipo !== "gasto") {
      alert("Solo se pueden crear subcuentas en cuentas de tipo Ingreso o Gasto (Egreso).");
      return;
    }
```

(El resto de la función `agregarSubcuenta` permanece igual.)

### 2d — En el Catálogo, ocultar botón expand y subcuentas para tipos no permitidos

Busca en el tab "catalogo" la sección que renderiza cada `cuenta`:
```typescript
                                            const subcuentasDeLaCuenta = subcuentas.filter((s) => s.parentCode === codigoCuenta);
                                            const tieneSubcuentas = subcuentasDeLaCuenta.length > 0;
                                            const estaExpandida = cuentasExpandidas.has(codigoCuenta);
```

Reemplaza esas 3 líneas por:
```typescript
                                            const tipoCuenta = (getType(cuenta) || inferTypeByCodigo(codigoCuenta)).toLowerCase();
                                            const permiteSubcuentas = tipoCuenta === "ingreso" || tipoCuenta === "gasto";
                                            const subcuentasDeLaCuenta = permiteSubcuentas
                                              ? subcuentas.filter((s) => s.parentCode === codigoCuenta)
                                              : [];
                                            const tieneSubcuentas = subcuentasDeLaCuenta.length > 0;
                                            const estaExpandida = cuentasExpandidas.has(codigoCuenta);
```

---

## Verificación

```bash
# Backend
node --check backend/routes/subcuentas.js

# Frontend
cd bukipin-dashboard && npx tsc --noEmit 2>&1 | head -30
```

## Efecto esperado

- **Selector de cuenta madre** en "Gestión de Subcuentas" → solo muestra grupos
  "Ingresos" y "Egresos" (4xxx y 5xxx), sin Activos, Pasivos, Capital ni Impuestos
- **Botón Agregar** → si por algún motivo llega un tipo incorrecto, muestra alert
- **Backend** → rechaza con 400 si intentan crear subcuenta en cuenta tipo activo/pasivo/capital
- **Catálogo de Cuentas** → el expand de subcuentas solo aparece en cuentas 4xxx y 5xxx
  (las de activos/pasivos/capital no muestran indicador de subcuentas)

## Nota

NO modificar `FriendlyAccountSelector` ni `useSubcuentas` ni `subcuentas.js` GET/PUT/DELETE.
Solo los 4 cambios descritos arriba.
