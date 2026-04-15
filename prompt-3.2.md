Necesito modificar el módulo de depreciaciones de Bukipin. Estos son los cambios requeridos:

## 1. QUITAR el botón de generación manual
En `bukipin-dashboard/src/components/Inversiones/ResumenDepreciaciones.tsx`:
- Elimina el botón "Generar manualmente" y todo su flujo (dialog de confirmación, selector de mes/año, lógica de validación de período)
- Mantén el resto del componente intacto (tabla de activos, métricas, etc.)

## 2. AGREGAR en la UI dos nuevos indicadores (en ResumenDepreciaciones.tsx)
- **Días para próxima depreciación**: calcular cuántos días faltan para el último día del mes actual. Mostrarlo como un chip o badge informativo.
- **Depreciación esperada este mes**: sumar el campo `valor_depreciacion_mensual` de todos los activos con estado "activo" y `valor_depreciacion_mensual > 0`. Mostrarlo como un total en MXN.

## 3. CREAR el endpoint backend POST /api/depreciaciones/generar
Crea el archivo `backend/routes/depreciaciones.js` con el endpoint POST `/api/depreciaciones/generar`.

Lógica del endpoint:
- Recibe opcionalmente `{ mes, ano }` en el body; si no se envían, usa el mes y año actuales
- Obtiene todos los Capex con `owner = req.user._id` y `estado = "activo"` y `valor_depreciacion_mensual > 0`
- Para cada activo, verifica que `fecha_inicio_depreciacion` (o `fecha_adquisicion`) sea <= al mes/año seleccionado
- Busca en JournalEntry si ya existe una entrada con `source: "depreciacion_inversion"` y el capexId del activo para ese mes (buscar por periodo YYYYMM en el campo `numeroAsiento` o en metadata)
- Si no existe, crea un JournalEntry con:
  - `numeroAsiento`: `DEP-{YYYYMM}-{capex._id}`
  - Línea débito: cuenta 5109, monto = `valor_depreciacion_mensual`
  - Línea crédito: cuenta de depreciación acumulada correspondiente a la categoría del activo
  - `source`: "depreciacion_inversion"
  - `owner`: req.user._id
- Retorna `{ ok: true, asientos_creados, asientos_existentes, total_activos, detalles }`

Monta esta ruta en `backend/server.js` como `/api/depreciaciones`.

## 4. CREAR cron job automático en el backend
En `backend/server.js` o en un archivo nuevo `backend/utils/cronJobs.js`:
- Usa el paquete `node-cron` (instálalo si no está)
- Programa un cron que corra a las 23:00 del último día de cada mes: `0 23 28-31 * *`
- El cron debe verificar si hoy es realmente el último día del mes antes de ejecutar
- Si es el último día, llama internamente a la lógica de `/api/depreciaciones/generar` para todos los usuarios activos (iterar todos los users con inversiones activas)
- Loguea el resultado con console.log

Sigue las convenciones del proyecto: CommonJS (require/module.exports), respuestas con forma `{ ok: boolean, data?, message? }`, siempre filtra por `owner` para multi-tenancy.
