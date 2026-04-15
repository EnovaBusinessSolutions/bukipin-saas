# Bug 3.3 — Inversiones no aparecen en Balanza de Comprobación

## Contexto
El usuario registra inversiones (CAPEX) que crean JournalEntry con `source: "inversion"` y líneas tipo `{ accountCodigo: "1205", debit: X }`. La Balanza de Comprobación (`/api/contabilidad/asientos`) usa `aggregateByAccount` que SÍ incluye esas cuentas en `saldosPorCuenta`. Sin embargo, el objeto retornado no incluye `estado_financiero` ni nombre de cuenta —esos campos quedan vacíos.

El frontend (`useAsientosBalanza.tsx`) tiene un "fast path": si el backend manda `saldosPorCuenta`, lo usa directamente y solo llama `resolveCuentaMeta` para enriquecer. `resolveCuentaMeta` depende de `cuentasMap` (construido desde `/api/cuentas`). Si ese mapa no está listo o falla, `estado_financiero` queda `null`, y en `BalanzaComprobacion.tsx` las cuentas van a la sección "No clasificado" en vez de "Balance General > Activos > Activo No Circulante".

**Raíz real del bug:** `handleGetAsientos` en `contabilidad.js` no agrega `estado_financiero`, `grupo`, `subgrupo` ni `cuenta_nombre` al objeto `saldosPorCuenta` antes de enviarlo. El frontend no debería depender de una segunda llamada a `/api/cuentas` para clasificar correctamente las cuentas.

## Cambios a realizar

---

### CAMBIO 1 — `backend/routes/contabilidad.js`

#### 1a. Agregar `require` del modelo Account (al inicio, junto a los otros requires):
```js
const Account = require("../models/Account");
```

#### 1b. Agregar estas funciones helper (después de las funciones existentes, antes de las routes):

```js
function inferEstadoFinanciero(codigo) {
  const d = String(codigo || "").charAt(0);
  if (["1", "2", "3"].includes(d)) return "Balance General";
  if (["4", "5", "6"].includes(d)) return "Estado de Resultados";
  return null;
}

function inferGrupoCodigo(codigo) {
  const d = String(codigo || "").charAt(0);
  if (d === "1") return "Activos";
  if (d === "2") return "Pasivos";
  if (d === "3") return "Capital Contable";
  if (d === "4") return "Ingresos";
  if (d === "5" || d === "6") return "Egresos";
  return "General";
}

function inferSubgrupoCodigo(codigo, grupo) {
  const c = String(codigo || "");
  if (grupo === "Activos") {
    if (c.startsWith("10") || c.startsWith("11")) return "Activo Circulante";
    if (c.startsWith("12")) return "Activo No Circulante";
    if (c.startsWith("13")) return "Activo Diferido";
  }
  if (grupo === "Pasivos") {
    if (c.startsWith("20")) return "Pasivo Circulante";
    if (c.startsWith("21")) return "Pasivo No Circulante";
  }
  if (grupo === "Capital Contable") {
    if (c.startsWith("30")) return "Capital Contribuido";
    if (c.startsWith("31")) return "Capital Ganado";
    if (c.startsWith("32")) return "Capital Reembolsado";
  }
  if (grupo === "Ingresos") return c.startsWith("41") ? "Otros Ingresos" : "Ingresos por Ventas";
  if (grupo === "Egresos") {
    if (c.startsWith("50")) return "Costo de Ventas";
    if (["5109", "5110"].includes(c) || c.startsWith("53")) return "Depreciaciones y Amortizaciones";
    if (c === "5201" || c.startsWith("54")) return "Gastos Financieros";
    if (c === "5204" || c.startsWith("55")) return "Otros Gastos";
    return "Gastos de Operación";
  }
  return "General";
}
```

#### 1c. En `handleGetAsientos`, DESPUÉS de construir `saldosPorCuenta` y ANTES de `return res.json(...)`:

Busca esta línea en `handleGetAsientos`:
```js
    return res.json({
      ok: true,
      data: {
        asientos,
```

Justo ANTES de ese `return res.json(...)`, agrega este bloque:

```js
    // ─── Enriquecer saldosPorCuenta con clasificación y nombres ───
    try {
      const todosLosCodigos = Object.keys(saldosPorCuenta);
      if (todosLosCodigos.length > 0) {
        // Paso 1: clasificación por prefijo (cubre todas las cuentas sin DB lookup)
        for (const codigo of todosLosCodigos) {
          const entry = saldosPorCuenta[codigo];
          if (!entry.estado_financiero) {
            const grupo = inferGrupoCodigo(codigo);
            entry.estado_financiero = inferEstadoFinanciero(codigo);
            entry.grupo = grupo;
            entry.subgrupo = inferSubgrupoCodigo(codigo, grupo);
          }
        }

        // Paso 2: enriquecer nombre desde Account collection (solo si hay doc)
        const accountDocs = await Account.find({
          owner,
          code: { $in: todosLosCodigos },
        })
          .select("code name")
          .lean();

        for (const doc of accountDocs) {
          const code = String(doc.code || "").trim();
          if (!code || !saldosPorCuenta[code]) continue;
          if (doc.name) {
            saldosPorCuenta[code].cuenta_nombre = String(doc.name).trim();
          }
        }
      }
    } catch (enrichErr) {
      // Non-fatal: la balanza igual funciona con nombres vacíos
      console.warn("⚠️ saldosPorCuenta enrichment error:", enrichErr?.message);
    }
    // ─── Fin enriquecimiento ───
```

---

### CAMBIO 2 — `bukipin-dashboard/src/pages/BalanzaComprobacion.tsx`

En la función `buildRowFromCodigo`, hay esta línea:
```ts
        saldo: Number(raw?.saldo || 0),
```

Reemplázala por:
```ts
        saldo: Number(raw?.saldo_final ?? raw?.saldo ?? 0),
```

Esto hace que se use `saldo_final` (lo que manda el backend) en vez de `saldo`, evitando que siempre muestre 0 para las cuentas nuevas.

---

### CAMBIO 3 — `bukipin-dashboard/src/pages/BalanzaComprobacion.tsx`

Busca el `useMemo` de `saldosUI` donde se construye el árbol. Localiza la línea de apertura del nodo de estado:

```ts
      const estadoNode: SaldosNode = {
        key: `estado:${estadoKey}`,
        label: estadoKey,
        level: "estado",
        totals: { debe: 0, haber: 0, saldo: 0 },
        cuentas: [],
        children: [],
      };
```

No es necesario cambiar la estructura, pero sí hay que asegurarse de que en la sección de rendering del árbol, los nodos de primer nivel (estado) empiecen **expandidos por defecto**. 

Busca en el JSX donde se renderizan los nodos y el estado de expansión. Si hay un `useState` para controlar qué nodos están abiertos/cerrados, asegúrate de que el estado inicial los tenga abiertos (`true`).

Si no existe un control de expansión, agregar uno así al inicio del componente (junto a los otros `useState`):

```ts
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(
    new Set(["estado:Balance General", "estado:Estado de Resultados"])
  );
  
  const toggleNode = (key: string) => {
    setExpandedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
```

Y en el rendering de cada nodo nivel "estado", usar `expandedNodes.has(node.key)` para controlar si está abierto.

**IMPORTANTE:** Solo agrega este control si actualmente los nodos usan un estado local (`useState`) para la expansión. Si ya existe esa lógica, solo cambia el valor inicial para que "Balance General" y "Estado de Resultados" empiecen expandidos.

Revisa primero el JSX del componente para entender cómo funciona la expansión actual antes de hacer cambios.

---

### CAMBIO 4 — `bukipin-dashboard/src/hooks/useAsientosBalanza.tsx` (fast path)

En el fast path (donde se procesa `saldosFastRaw`), asegúrate de que si el backend ya mandó `estado_financiero` en el row, se use directamente sin necesidad de `resolveCuentaMeta`:

Busca esta sección:
```ts
      if (fastHasAny) {
        const saldosFast: Record<string, SaldoCuenta> = {};
        for (const k of Object.keys(saldosFastRaw)) {
          const code = normalizeCode(k);
          const row = saldosFastRaw[k] ?? {};
          const saldoFinal = num(row?.saldo_final ?? row?.saldo ?? 0, 0);
          const saldoInicial = num(row?.saldo_inicial ?? 0, 0);
          const debeTotal = num(row?.debe_total ?? row?.debe ?? 0, 0);
          const haberTotal = num(row?.haber_total ?? row?.haber ?? 0, 0);

          const meta = resolveCuentaMeta(code, String(row?.cuenta_nombre ?? ""));
          saldosFast[code] = {
            cuenta_codigo: code,
            cuenta_nombre: meta.nombre || code,
            estado_financiero: row?.estado_financiero ?? meta.estado_financiero ?? null,
            saldo_inicial: saldoInicial,
            debe_total: debeTotal,
            haber_total: haberTotal,
            saldo_final: saldoFinal,
            saldo: saldoFinal,
          };
        }
```

Reemplaza por:
```ts
      if (fastHasAny) {
        const saldosFast: Record<string, SaldoCuenta> = {};
        for (const k of Object.keys(saldosFastRaw)) {
          const code = normalizeCode(k);
          const row = saldosFastRaw[k] ?? {};
          const saldoFinal = num(row?.saldo_final ?? row?.saldo ?? 0, 0);
          const saldoInicial = num(row?.saldo_inicial ?? 0, 0);
          const debeTotal = num(row?.debe_total ?? row?.debe ?? 0, 0);
          const haberTotal = num(row?.haber_total ?? row?.haber ?? 0, 0);

          // Si el backend ya mandó nombre y estado, úsalos directamente
          const nombreFromBackend = String(row?.cuenta_nombre ?? "").trim();
          const estadoFromBackend = row?.estado_financiero ?? null;

          // Solo llamamos resolveCuentaMeta si nos faltan datos del backend
          const meta = (!nombreFromBackend || !estadoFromBackend)
            ? resolveCuentaMeta(code, nombreFromBackend)
            : { nombre: nombreFromBackend, estado_financiero: estadoFromBackend };

          saldosFast[code] = {
            cuenta_codigo: code,
            cuenta_nombre: meta.nombre || nombreFromBackend || code,
            estado_financiero: estadoFromBackend ?? meta.estado_financiero ?? null,
            saldo_inicial: saldoInicial,
            debe_total: debeTotal,
            haber_total: haberTotal,
            saldo_final: saldoFinal,
            saldo: saldoFinal,
          };
        }
```

---

## Convenciones a respetar
- Backend: CommonJS (`require`/`module.exports`), respuestas `{ ok: boolean, data?, message? }`
- Frontend: TypeScript ESM, usa `apiFetch()` para llamadas, NO modificar lógica de auth
- Siempre filtra por `owner` en queries MongoDB
- No crear archivos nuevos innecesarios — todos los cambios van en archivos existentes

## Verificación post-implementación
1. Confirmar con `node --check backend/routes/contabilidad.js` que no hay errores de sintaxis
2. Confirmar con `npx tsc --noEmit` dentro de `bukipin-dashboard/` que no hay errores TypeScript
3. Si hay errores de lint, corrígelos
