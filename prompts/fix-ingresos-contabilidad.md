# Fix — Desalineamientos contables en Registro de Ingresos

## Contexto del sistema

Bukipin es un SaaS de contabilidad para PyMEs mexicanas. El módulo de Registro de
Ingresos está en:

- **Backend**: `backend/routes/ingresos.js` — handler `POST /api/ingresos`
- **Frontend**: `bukipin-dashboard/src/pages/registros/RegistroIngresos.tsx`

El sistema usa partida doble. Cada ingreso genera un `JournalEntry` con líneas
`debit/credit`. Los asientos deben estar **perfectamente balanceados** y usar las
**cuentas contables correctas** del catálogo base (`backend/utils/seedDefaults.js`).

---

## BUG 1 — Cuenta contable incorrecta para descuentos

### Diagnóstico

**Archivo**: `backend/routes/ingresos.js`, línea 1744

```js
const COD_DESCUENTOS = "4002";
```

**El catálogo base (`backend/utils/seedDefaults.js`) tiene:**

```js
{ code: "4002", name: "Devoluciones sobre Ventas", type: "ingreso" },
{ code: "4003", name: "Descuentos sobre Ventas",   type: "ingreso" },
```

**Impacto contable**: Cada vez que se registra un ingreso con descuento, el asiento
contable queda así (ejemplo: venta $100 con descuento $20):

```
DR 4002  Devoluciones sobre Ventas   $20   ← ❌ INCORRECTO
DR 1001  Caja                        $80
CR 4001  Ventas                     $100
```

Debe quedar:
```
DR 4003  Descuentos sobre Ventas     $20   ← ✅ CORRECTO
DR 1001  Caja                        $80
CR 4001  Ventas                     $100
```

Una **devolución** es cuando el cliente devuelve la mercancía. Un **descuento** es una
rebaja en el precio. Son conceptos contables distintos con cuentas distintas. Registrar
descuentos como devoluciones contamina los reportes financieros.

### Fix exacto — 1 línea

En `backend/routes/ingresos.js`, busca la línea:
```js
const COD_DESCUENTOS = "4002";
```

Reemplaza por:
```js
const COD_DESCUENTOS = "4003";
```

No hay ningún otro cambio necesario. La lógica del asiento ya está correcta,
solo apuntaba a la cuenta equivocada.

---

## BUG 2 — Descuento mayor al total pasa sin error (venta en $0 silenciosa)

### Diagnóstico

**Archivo**: `backend/routes/ingresos.js`, líneas 1708–1713

```js
if (!total || total <= 0) {
  return res.status(400).json({ ok: false, message: "montoTotal debe ser > 0." });
}
if (descuento < 0) {
  return res.status(400).json({ ok: false, message: "montoDescuento no puede ser negativo." });
}
```

Y en línea 1664:
```js
const neto = Math.max(0, total - Math.max(0, descuento));
```

**El problema**: Si alguien envía `total=100` y `descuento=150`, el backend
hace `Math.max(0, 100 - 150)` = `$0` y registra la venta con neto=$0 sin rechazar
la petición. El resultado es un ingreso guardado en base de datos con valor cero,
generando un asiento contable de $0 con una línea de descuento de $150 que no balancea.

**En el frontend** ocurre lo mismo: `bukipin-dashboard/src/pages/registros/RegistroIngresos.tsx`
línea 1741 calcula `descuento = hasDiscount ? Number(discountAmount || '0') : 0` pero
nunca valida que `descuento <= montoTotal`.

### Fix — Backend

En `backend/routes/ingresos.js`, busca el bloque de validaciones (después de la línea
que rechaza `descuento < 0`):

```js
if (descuento < 0) {
  return res.status(400).json({ ok: false, message: "montoDescuento no puede ser negativo." });
}
```

INMEDIATAMENTE DESPUÉS de esa línea, agrega:

```js
if (descuento > 0 && descuento >= total) {
  return res.status(400).json({
    ok: false,
    message: `El descuento ($${descuento}) no puede ser igual o mayor al total ($${total}). Si es una devolución total, cancela la transacción.`,
  });
}
```

### Fix — Frontend

En `bukipin-dashboard/src/pages/registros/RegistroIngresos.tsx`, busca la función
`getValidationErrors` (alrededor de la línea 990). Dentro de esa función, busca la
validación del monto total:

```typescript
if (selectedIncomeType !== 'precargados' && selectedIncomeType !== 'inventariados' && (!montoTotal || parseFloat(montoTotal) <= 0)) errors.push('Monto Total');
```

INMEDIATAMENTE DESPUÉS de esa línea, agrega:

```typescript
// Validar que el descuento no supere el total
if (discountAmount && montoTotal) {
  const descuentoNum = parseFloat(discountAmount) || 0;
  const totalNum = parseFloat(montoTotal) || 0;
  if (descuentoNum > 0 && descuentoNum >= totalNum) {
    errors.push('El descuento no puede ser igual o mayor al monto total');
  }
}
```

---

## BUG 3 — Descuento en productos de inventario tampoco valida contra el subtotal

### Diagnóstico

**Archivo**: `bukipin-dashboard/src/pages/registros/RegistroIngresos.tsx`

Cuando el usuario registra ventas de productos del inventario (`selectedIncomeType === 'inventariados'`
o `'precargados'`), cada producto tiene su propio `descuento`. El cálculo en líneas ~834 y ~889:

```typescript
const descuento = productDiscountType === "porcentaje"
  ? subtotalSinDescuento * (discountValue / 100)
  : discountValue;

const subtotal = Math.max(0, subtotalSinDescuento - descuento);
```

Si el usuario ingresa un descuento de monto fijo mayor al subtotal del producto,
`Math.max(0, ...)` silencia el error y el producto queda en $0.

### Fix — Frontend

En `bukipin-dashboard/src/pages/registros/RegistroIngresos.tsx`, busca la función
que agrega un producto al carrito. Hay dos lugares — uno para productos precargados
(alrededor de línea 829) y otro para inventariados (alrededor de línea 884).

En ambos lugares, busca el bloque que calcula `descuento` y `subtotal`. Después del
cálculo de `descuento`, y ANTES de actualizar el estado, agrega esta validación:

**Bloque 1** (alrededor de línea 837, después de calcular `const subtotal = Math.max(...)`):

```typescript
// Validar que el descuento de monto fijo no supere el subtotal
if (productDiscountType === "monto" && descuentoNum > 0 && descuentoNum >= subtotalSinDescuento) {
  toast({
    title: "⚠️ Descuento inválido",
    description: `El descuento ($${descuentoNum}) no puede ser igual o mayor al precio del producto ($${subtotalSinDescuento}).`,
    variant: "destructive",
  });
  return;
}
```

**Nota importante**: La variable del descuento en cada bloque puede llamarse `descuento`
o `descuentoNum` dependiendo del contexto exacto. Leer el código del bloque y adaptar
el nombre de variable correctamente antes de insertar.

---

## Resumen de archivos a modificar

| Archivo | Cambio |
|---|---|
| `backend/routes/ingresos.js` | Cambiar `"4002"` → `"4003"` en `COD_DESCUENTOS` |
| `backend/routes/ingresos.js` | Agregar validación `descuento >= total` → 400 |
| `bukipin-dashboard/src/pages/registros/RegistroIngresos.tsx` | Agregar validación `descuentoNum >= totalNum` en `getValidationErrors` |
| `bukipin-dashboard/src/pages/registros/RegistroIngresos.tsx` | Agregar validación de descuento por producto en flujo inventario |

---

## Verificación

### Backend
```bash
node --check backend/routes/ingresos.js
```

### Frontend
```bash
cd bukipin-dashboard && npx tsc --noEmit 2>&1 | head -30
```

### Prueba manual del BUG 1 (cuenta 4002 → 4003)
1. Registrar un ingreso general con monto $1,000 y descuento $100
2. Ir a Balanza de Comprobación
3. Verificar que aparece movimiento en cuenta **4003** "Descuentos sobre Ventas" (no en 4002)
4. Verificar que el asiento balancea: DR 4003 $100 + DR 1001/1002 $900 = CR 4001 $1,000

### Prueba manual del BUG 2 (descuento >= total)
1. Intentar registrar un ingreso con monto $500 y descuento $500 o $600
2. El backend debe responder con **status 400** y mensaje de error claro
3. El frontend debe mostrar el error de validación **antes** de enviar la petición

---

## Contexto contable adicional (para referencia)

El catálogo de cuentas relevante para ingresos:

```
4001  Ventas                          → Ingreso principal por ventas
4002  Devoluciones sobre Ventas       → Mercancía devuelta por el cliente
4003  Descuentos sobre Ventas         → Rebaja concedida en el precio ← USAR AQUÍ
4004  Ventas inventarios
4101  Productos Financieros
4102  Otros Productos
```

La distinción contable es importante:
- **Devolución** (4002): el cliente regresa la mercancía, hay una salida física de inventario
- **Descuento** (4003): el cliente paga menos, NO hay devolución de mercancía

Usar 4002 para descuentos infla artificialmente la cuenta de devoluciones y distorsiona
el análisis de ventas, márgenes y comportamiento de clientes en los reportes financieros.
