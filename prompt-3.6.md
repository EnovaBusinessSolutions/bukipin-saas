# Prompt 3.6 — Fix Hoja Analítica: rubros vacíos + tooltip en donas

## Contexto del bug

La Hoja Analítica (BalanceGeneralAnalitico y EstadoResultadosAnalitico) muestra las gráficas
de dona casi vacías (solo 1 segmento o ninguno) y no pinta los demás rubros.

**Root cause**: El modelo `Account` en MongoDB no tiene los campos `subgrupo`,
`estado_financiero`, ni `grupo`. El hook `useCuentas.tsx` intenta leerlos del API,
pero como no existen, todas las cuentas quedan con `"Sin estado"` / `"Sin subgrupo"`.

Como consecuencia:
- `BalanceGeneralAnalitico` filtra `cuentasFlat.filter(c => c.subgrupo === "Activo Circulante")`
  → siempre vacío → `activosCirculantes = 0` → el segmento no se pinta
- `EstadoResultadosAnalitico` filtra `cuentasFlat.filter(c => isER(c))` donde `isER` revisa
  `estado_financiero === "Estado de Resultados"` → siempre vacío → todos los gráficos en blanco

## Fix — UN SOLO ARCHIVO: `bukipin-dashboard/src/hooks/useCuentas.tsx`

Agrega 3 funciones de inferencia basadas en el prefijo del código contable,
y úsalas como fallback en `normalizeCuenta` cuando los campos estén vacíos.

### CAMBIO 1 — Agregar funciones de inferencia ANTES de `normalizeCuenta`

Ubica esta línea en el archivo:
```
const normStr = (v: any) => String(v ?? "").trim();
```

Inmediatamente DESPUÉS de esa línea, inserta el siguiente bloque completo:

```typescript
// ---------------------------------------------------------------------------
// Inferencia de clasificación contable basada en prefijo del código
// (Mirror de la lógica en backend/routes/contabilidad.js)
// ---------------------------------------------------------------------------
function inferEstadoFinanciero(codigo: string): string {
  const d = codigo.charAt(0);
  if (["1", "2", "3"].includes(d)) return "Balance General";
  if (["4", "5", "6"].includes(d)) return "Estado de Resultados";
  return "";
}

function inferGrupo(codigo: string): string {
  const d = codigo.charAt(0);
  const map: Record<string, string> = {
    "1": "Activos",
    "2": "Pasivos",
    "3": "Capital",
    "4": "Ingresos",
    "5": "Egresos",
    "6": "Egresos",
  };
  return map[d] ?? "";
}

function inferSubgrupo(codigo: string): string {
  const p2 = codigo.substring(0, 2);
  const d = codigo.charAt(0);

  if (d === "1") {
    if (p2 === "10" || p2 === "11") return "Activo Circulante";
    if (p2 === "12") return "Activo No Circulante";
    if (p2 === "13" || p2 === "14") return "Activo Diferido";
    return "Activo Circulante"; // fallback para otros 1xxx
  }
  if (d === "2") {
    if (p2 === "20") return "Pasivo Circulante";
    return "Pasivo No Circulante"; // 21xx, 22xx, 23xx → largo plazo
  }
  if (d === "3") return "Capital Contable";
  if (d === "4") {
    if (p2 === "40") return "Ingresos por Ventas";
    return "Otros Ingresos"; // 41xx → Productos Financieros, Otros
  }
  if (d === "5") {
    if (p2 === "50") return "Costo de Ventas";
    if (p2 === "52") return "Otros Gastos"; // Intereses, comisiones, pérdidas
    return "Gastos de Operación"; // 51xx → Gastos de venta/admin
  }
  if (d === "6") return "Impuestos";
  return "";
}
```

### CAMBIO 2 — Usar inferencias como fallback en `normalizeCuenta`

Localiza el `return` final dentro de `normalizeCuenta` (actualmente se ve así):

```typescript
  return {
    codigo,
    nombre,
    estado_financiero: estado_financiero || "Sin estado",
    grupo: grupo || "Sin grupo",
    subgrupo: subgrupo || "Sin subgrupo",
  };
```

Reemplázalo por:

```typescript
  return {
    codigo,
    nombre,
    estado_financiero: estado_financiero || inferEstadoFinanciero(codigo) || "Sin estado",
    grupo: grupo || inferGrupo(codigo) || "Sin grupo",
    subgrupo: subgrupo || inferSubgrupo(codigo) || "Sin subgrupo",
  };
```

## Verificación

Después de aplicar los cambios, ejecuta dentro de `bukipin-dashboard/`:

```bash
npm run lint
```

No debe haber errores de TypeScript relacionados con los nuevos cambios.

## Efecto esperado

Con este único cambio en `useCuentas.tsx`:

1. **BalanceGeneralAnalitico** — las gráficas de dona ahora pintarán todos los segmentos:
   - "Activos Circulantes", "Activos Fijos", "Activos Diferidos" (tab Activos)
   - "Pasivos Circulantes", "Pasivos Largo Plazo" (tab Pasivos)
   - Los bar charts mostrarán cada cuenta individual con su nombre y saldo

2. **EstadoResultadosAnalitico** — los gráficos de Estado de Resultados mostrarán
   Ingresos por Ventas, Costo de Ventas, Gastos de Operación, Otros Ingresos/Gastos, Impuestos

3. **Tooltip en hover** — ya estaba implementado con `CustomDonutTooltip`; simplemente
   no disparaba porque no había segmentos. Con datos reales, el cuadrito aparecerá
   automáticamente al pasar el cursor sobre cada segmento de la dona.

## Notas

- NO modificar `BalanceGeneralAnalitico.tsx` ni `EstadoResultadosAnalitico.tsx`
- NO modificar el modelo Account ni el backend
- Solo `useCuentas.tsx` necesita cambiar
- El fix es compatible con cuentas que en el futuro sí tengan `subgrupo` en BD
  (el OR `||` priorizará el valor real sobre la inferencia)
