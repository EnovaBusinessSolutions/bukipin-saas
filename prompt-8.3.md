# Prompt 8.3 — Frontend: Tabs Transacciones, Analítica y Base de datos (Depósitos en Garantía)

## Contexto

El módulo Depósitos en Garantía ya tiene el backend (prompt-8.1) y la página con el
tab Registro funcional (prompt-8.2). En este prompt se completan los 3 tabs
que quedaron como placeholders:

- **Transacciones**: tabla cronológica con filtros y totales
- **Analítica**: gráfica horizontal de barras por entidad (top 10 + popup paginado)
- **Base de datos**: directorio de todas las entidades con saldo y estado

Se crean 3 componentes nuevos y se actualiza la página principal para usarlos.

---

## CAMBIO 1 — Crear `bukipin-dashboard/src/components/DepositosGarantia/TransaccionesDepositosGarantia.tsx` (archivo nuevo)

```typescript
// bukipin-dashboard/src/components/DepositosGarantia/TransaccionesDepositosGarantia.tsx
import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ReceiptText, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { useDepositosMovimientos, useDepositos, type TipoDeposito } from "@/hooks/useDepositosGarantia";

const formatMXN = (v: number) =>
  v.toLocaleString("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 });

const formatFecha = (s: string | null) => {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" });
};

const TIPO_MOV_CONFIG: Record<string, { label: string; color: string }> = {
  nuevo:       { label: "Nuevo",       color: "bg-blue-100 text-blue-800" },
  aumento:     { label: "Aumento",     color: "bg-emerald-100 text-emerald-800" },
  disminucion: { label: "Disminución", color: "bg-amber-100 text-amber-800" },
  devolucion:  { label: "Dev. parcial",color: "bg-orange-100 text-orange-800" },
  liquidacion: { label: "Liquidación", color: "bg-slate-100 text-slate-700" },
};

interface Props {
  tipo: TipoDeposito;
}

const TransaccionesDepositosGarantia = ({ tipo }: Props) => {
  const [filtroDeposito, setFiltroDeposito] = useState<string>("todos");

  const { data: depositosLista = [] } = useDepositos(tipo, "todos");
  const { data, isLoading } = useDepositosMovimientos(tipo);

  const movimientos = data?.movimientos ?? [];
  const totales = data?.totales ?? { entradas: 0, salidas: 0, neto: 0 };

  const movFiltrados = filtroDeposito === "todos"
    ? movimientos
    : movimientos.filter((m) => m.deposito_id === filtroDeposito);

  const entradasFiltradas = movFiltrados.filter((m) => m.monto_con_signo > 0).reduce((s, m) => s + m.monto, 0);
  const salidasFiltradas  = movFiltrados.filter((m) => m.monto_con_signo < 0).reduce((s, m) => s + m.monto, 0);
  const netoFiltrado      = entradasFiltradas - salidasFiltradas;

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full rounded-2xl" />
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Totales */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <div className="rounded-2xl border bg-white px-4 py-3 shadow-sm">
          <p className="text-xs text-muted-foreground">Entradas</p>
          <p className="mt-1 text-lg font-bold text-emerald-600">{formatMXN(entradasFiltradas)}</p>
        </div>
        <div className="rounded-2xl border bg-white px-4 py-3 shadow-sm">
          <p className="text-xs text-muted-foreground">Salidas</p>
          <p className="mt-1 text-lg font-bold text-rose-600">{formatMXN(salidasFiltradas)}</p>
        </div>
        <div className="rounded-2xl border bg-white px-4 py-3 shadow-sm">
          <p className="text-xs text-muted-foreground">Neto</p>
          <p className={`mt-1 text-lg font-bold ${netoFiltrado >= 0 ? "text-slate-900" : "text-rose-600"}`}>
            {formatMXN(netoFiltrado)}
          </p>
        </div>
        <div className="rounded-2xl border bg-white px-4 py-3 shadow-sm">
          <p className="text-xs text-muted-foreground">Registros</p>
          <p className="mt-1 text-lg font-bold text-slate-900">{movFiltrados.length}</p>
        </div>
      </div>

      <Card className="rounded-2xl shadow-sm">
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="text-xl font-semibold">Historial de movimientos</CardTitle>
            <CardDescription>
              Todos los depósitos, aumentos, devoluciones y liquidaciones registradas.
            </CardDescription>
          </div>
          {/* Filtro por entidad */}
          <div className="w-56 shrink-0">
            <Select value={filtroDeposito} onValueChange={setFiltroDeposito}>
              <SelectTrigger className="rounded-xl">
                <SelectValue placeholder="Filtrar por entidad" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                {depositosLista.map((d) => (
                  <SelectItem key={d.id} value={d.id}>{d.entidad_nombre}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>

        <CardContent>
          {movFiltrados.length === 0 ? (
            <div className="rounded-2xl border border-dashed bg-slate-50 py-12 text-center">
              <ReceiptText className="mx-auto mb-3 h-10 w-10 text-slate-300" />
              <p className="text-sm text-muted-foreground">No hay movimientos registrados.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-xs text-muted-foreground">
                    <th className="py-3 text-left font-medium">Fecha</th>
                    <th className="py-3 text-left font-medium">Entidad</th>
                    <th className="py-3 text-left font-medium">Tipo</th>
                    <th className="py-3 text-right font-medium">Monto</th>
                    <th className="py-3 text-left font-medium pl-4">Notas</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {movFiltrados.map((mov) => {
                    const cfg = TIPO_MOV_CONFIG[mov.tipo_movimiento] ?? { label: mov.tipo_movimiento, color: "bg-slate-100 text-slate-700" };
                    const esPositivo = mov.monto_con_signo > 0;
                    return (
                      <tr key={mov.id} className="group hover:bg-slate-50/60 transition-colors">
                        <td className="py-3 text-muted-foreground whitespace-nowrap">{formatFecha(mov.fecha)}</td>
                        <td className="py-3 font-medium text-slate-900 max-w-[160px] truncate">{mov.entidad_nombre || "—"}</td>
                        <td className="py-3">
                          <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${cfg.color}`}>
                            {cfg.label}
                          </span>
                        </td>
                        <td className="py-3 text-right font-semibold whitespace-nowrap">
                          <span className={`flex items-center justify-end gap-1 ${esPositivo ? "text-emerald-600" : "text-rose-600"}`}>
                            {esPositivo ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
                            {esPositivo ? "+" : "-"}{formatMXN(mov.monto)}
                          </span>
                        </td>
                        <td className="py-3 pl-4 text-muted-foreground max-w-[200px] truncate">
                          {mov.referencia || "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default TransaccionesDepositosGarantia;
```

---

## CAMBIO 2 — Crear `bukipin-dashboard/src/components/DepositosGarantia/AnaliticaDepositosGarantia.tsx` (archivo nuevo)

```typescript
// bukipin-dashboard/src/components/DepositosGarantia/AnaliticaDepositosGarantia.tsx
import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { BarChart3 } from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Cell,
} from "recharts";
import { useDepositosAnalitica, type TipoDeposito } from "@/hooks/useDepositosGarantia";

const formatMXN = (v: number) =>
  v.toLocaleString("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 });

const COLORS = ["#0f172a", "#1e3a5f", "#1d4ed8", "#0284c7", "#0891b2", "#0d9488", "#059669", "#16a34a", "#65a30d", "#ca8a04"];

interface AnaliticaItem {
  id: string;
  entidad_nombre: string;
  entidad_tipo: string;
  saldo: number;
}

const CustomTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  const d: AnaliticaItem = payload[0]?.payload;
  return (
    <div className="rounded-xl border bg-white px-4 py-3 shadow-lg text-sm">
      <p className="font-semibold text-slate-900 mb-1">{d.entidad_nombre}</p>
      <p className="text-muted-foreground">{d.entidad_tipo === "empresa" ? "Empresa" : "Persona física"}</p>
      <p className="mt-2 font-bold text-slate-900">{formatMXN(d.saldo)}</p>
    </div>
  );
};

interface Props {
  tipo: TipoDeposito;
}

const PAGE_SIZE = 25;

const AnaliticaDepositosGarantia = ({ tipo }: Props) => {
  const [showDialog, setShowDialog] = useState(false);
  const [page, setPage] = useState(0);

  const { data: items = [], isLoading } = useDepositosAnalitica(tipo);

  const top10 = items.slice(0, 10);
  const chartData = top10.map((d: AnaliticaItem) => ({
    ...d,
    name: d.entidad_nombre.length > 22 ? d.entidad_nombre.slice(0, 20) + "…" : d.entidad_nombre,
  }));

  const totalPages = Math.ceil(items.length / PAGE_SIZE);
  const paginaItems = items.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const esRecibido = tipo === "recibido";

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-80 w-full rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="rounded-2xl shadow-sm">
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="text-xl font-semibold">
              {esRecibido ? "Deudores por garantía recibida" : "Acreedores por garantía otorgada"}
            </CardTitle>
            <CardDescription>
              Saldo vigente por entidad, ordenado de mayor a menor. Mostrando top {Math.min(10, items.length)}.
            </CardDescription>
          </div>
          {items.length > 10 && (
            <Button variant="outline" size="sm" onClick={() => { setShowDialog(true); setPage(0); }}>
              Ver todos ({items.length})
            </Button>
          )}
        </CardHeader>

        <CardContent>
          {items.length === 0 ? (
            <div className="rounded-2xl border border-dashed bg-slate-50 py-16 text-center">
              <BarChart3 className="mx-auto mb-3 h-10 w-10 text-slate-300" />
              <p className="text-sm text-muted-foreground">
                No hay depósitos activos para mostrar.
              </p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(280, top10.length * 52)}>
              <BarChart
                data={chartData}
                layout="vertical"
                margin={{ top: 4, right: 80, left: 8, bottom: 4 }}
              >
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
                <XAxis
                  type="number"
                  tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                  tick={{ fontSize: 11, fill: "#94a3b8" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={150}
                  tick={{ fontSize: 12, fill: "#334155" }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip content={<CustomTooltip />} cursor={{ fill: "#f8fafc" }} />
                <Bar dataKey="saldo" radius={[0, 6, 6, 0]} maxBarSize={36}>
                  {chartData.map((_: AnaliticaItem, idx: number) => (
                    <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Dialog: Ver todos paginado de 25 en 25 */}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {esRecibido ? "Todos los deudores" : "Todos los acreedores"}
            </DialogTitle>
            <DialogDescription>
              {items.length} entidades con depósito en garantía activo, ordenadas por saldo.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2 mt-2">
            {paginaItems.map((item: AnaliticaItem, idx: number) => (
              <div
                key={item.id}
                className="flex items-center justify-between rounded-xl border bg-white px-4 py-3 shadow-sm"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="w-6 text-sm font-bold text-muted-foreground text-center shrink-0">
                    {page * PAGE_SIZE + idx + 1}
                  </span>
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-bold text-slate-600">
                    {(item.entidad_nombre?.[0] ?? "?").toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900">{item.entidad_nombre}</p>
                    <p className="text-xs text-muted-foreground capitalize">{item.entidad_tipo}</p>
                  </div>
                </div>
                <p className="shrink-0 font-semibold text-slate-900">{formatMXN(item.saldo)}</p>
              </div>
            ))}
          </div>

          {/* Paginación */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-4 border-t">
              <Button
                variant="outline"
                size="sm"
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
              >
                Anterior
              </Button>
              <span className="text-sm text-muted-foreground">
                Página {page + 1} de {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages - 1}
                onClick={() => setPage((p) => p + 1)}
              >
                Siguiente
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AnaliticaDepositosGarantia;
```

---

## CAMBIO 3 — Crear `bukipin-dashboard/src/components/DepositosGarantia/BaseDatosDepositosGarantia.tsx` (archivo nuevo)

```typescript
// bukipin-dashboard/src/components/DepositosGarantia/BaseDatosDepositosGarantia.tsx
import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Database, Search } from "lucide-react";
import { useDepositos, type TipoDeposito } from "@/hooks/useDepositosGarantia";

const formatMXN = (v: number) =>
  v.toLocaleString("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 });

const formatFecha = (s: string | null) => {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" });
};

interface Props {
  tipo: TipoDeposito;
}

const BaseDatosDepositosGarantia = ({ tipo }: Props) => {
  const [busqueda, setBusqueda] = useState("");
  const [filtroEstado, setFiltroEstado] = useState<"activo" | "liquidado" | "todos">("todos");

  const { data: depositos = [], isLoading } = useDepositos(tipo, filtroEstado);

  const esFiltrado = busqueda.trim().length > 0;
  const depositosFiltrados = esFiltrado
    ? depositos.filter((d) =>
        d.entidad_nombre.toLowerCase().includes(busqueda.toLowerCase()) ||
        d.entidad_rfc?.toLowerCase().includes(busqueda.toLowerCase())
      )
    : depositos;

  const esRecibido = tipo === "recibido";

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-12 w-full rounded-xl" />
        <Skeleton className="h-16 w-full rounded-2xl" />
        <Skeleton className="h-16 w-full rounded-2xl" />
        <Skeleton className="h-16 w-full rounded-2xl" />
      </div>
    );
  }

  return (
    <Card className="rounded-2xl shadow-sm">
      <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle className="text-xl font-semibold">
            {esRecibido ? "Directorio de deudores" : "Directorio de acreedores"}
          </CardTitle>
          <CardDescription>
            {esRecibido
              ? "Entidades que nos han dejado un depósito en garantía."
              : "Entidades a las que hemos entregado un depósito en garantía."}
          </CardDescription>
        </div>
        <div className="flex items-center gap-2">
          {/* Filtro estado */}
          <Select value={filtroEstado} onValueChange={(v) => setFiltroEstado(v as any)}>
            <SelectTrigger className="w-36 rounded-xl">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos</SelectItem>
              <SelectItem value="activo">Activos</SelectItem>
              <SelectItem value="liquidado">Liquidados</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Búsqueda */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por nombre o RFC..."
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            className="pl-9 rounded-xl"
          />
        </div>

        {depositosFiltrados.length === 0 ? (
          <div className="rounded-2xl border border-dashed bg-slate-50 py-12 text-center">
            <Database className="mx-auto mb-3 h-10 w-10 text-slate-300" />
            <p className="text-sm text-muted-foreground">
              {esFiltrado ? "No se encontraron coincidencias." : "No hay entidades registradas."}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100 rounded-2xl border bg-white overflow-hidden">
            {depositosFiltrados.map((dep) => (
              <div
                key={dep.id}
                className="flex items-center justify-between px-5 py-4 hover:bg-slate-50/60 transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-bold text-slate-600">
                    {(dep.entidad_nombre?.[0] ?? "?").toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium text-slate-900 truncate">{dep.entidad_nombre}</p>
                      <Badge
                        variant="outline"
                        className={
                          dep.estado === "activo"
                            ? "border-emerald-300 text-emerald-700 text-[10px]"
                            : "border-slate-300 text-slate-500 text-[10px]"
                        }
                      >
                        {dep.estado === "activo" ? "Activo" : "Liquidado"}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {dep.entidad_rfc && <span className="mr-2">{dep.entidad_rfc}</span>}
                      <span className="capitalize">{dep.entidad_tipo}</span>
                      {dep.fecha_inicio && (
                        <span className="ml-2">· Desde {formatFecha(dep.fecha_inicio)}</span>
                      )}
                    </p>
                  </div>
                </div>

                <div className="shrink-0 text-right">
                  <p className={`text-sm font-bold ${dep.estado === "activo" ? "text-slate-900" : "text-muted-foreground line-through"}`}>
                    {formatMXN(dep.saldo_actual)}
                  </p>
                  {dep.referencia && (
                    <p className="text-xs text-muted-foreground truncate max-w-[140px]">{dep.referencia}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        <p className="text-xs text-muted-foreground text-right">
          {depositosFiltrados.length} {depositosFiltrados.length === 1 ? "registro" : "registros"}
        </p>
      </CardContent>
    </Card>
  );
};

export default BaseDatosDepositosGarantia;
```

---

## CAMBIO 4 — Actualizar `bukipin-dashboard/src/pages/registros/RegistroDepositosGarantia.tsx`

### 4a — Agregar los 3 imports nuevos

Busca la línea de imports del archivo (al principio, después de los imports de lucide-react):
```typescript
import {
  useDepositosResumen,
  useDepositos,
  useDepositosMutations,
  type TipoDeposito,
  type DepositoGarantia,
} from "@/hooks/useDepositosGarantia";
```

INMEDIATAMENTE DESPUÉS de ese bloque de imports, agrega:
```typescript
import TransaccionesDepositosGarantia from "@/components/DepositosGarantia/TransaccionesDepositosGarantia";
import AnaliticaDepositosGarantia from "@/components/DepositosGarantia/AnaliticaDepositosGarantia";
import BaseDatosDepositosGarantia from "@/components/DepositosGarantia/BaseDatosDepositosGarantia";
```

### 4b — Reemplazar el placeholder de Transacciones

Busca el bloque:
```typescript
            {/* ── TAB: TRANSACCIONES (placeholder) ──────────────────────────── */}
            <TabsContent value="transacciones" className="mt-6">
              <Card className="rounded-2xl border shadow-sm">
                <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                  <ReceiptText className="mb-4 h-12 w-12 text-slate-300" />
                  <p className="text-sm font-medium text-slate-500">Historial de transacciones</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Próximamente disponible — registra movimientos desde el tab Registro.
                  </p>
                </CardContent>
              </Card>
            </TabsContent>
```

Reemplaza por:
```typescript
            {/* ── TAB: TRANSACCIONES ────────────────────────────────────────── */}
            <TabsContent value="transacciones" className="mt-6">
              <TransaccionesDepositosGarantia tipo={tipo} />
            </TabsContent>
```

### 4c — Reemplazar el placeholder de Analítica

Busca el bloque:
```typescript
            {/* ── TAB: ANALÍTICA (placeholder) ───────────────────────────────── */}
            <TabsContent value="analitica" className="mt-6">
              <Card className="rounded-2xl border shadow-sm">
                <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                  <BarChart3 className="mb-4 h-12 w-12 text-slate-300" />
                  <p className="text-sm font-medium text-slate-500">Gráfica analítica por entidad</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Próximamente disponible.
                  </p>
                </CardContent>
              </Card>
            </TabsContent>
```

Reemplaza por:
```typescript
            {/* ── TAB: ANALÍTICA ────────────────────────────────────────────── */}
            <TabsContent value="analitica" className="mt-6">
              <AnaliticaDepositosGarantia tipo={tipo} />
            </TabsContent>
```

### 4d — Reemplazar el placeholder de Base de datos

Busca el bloque:
```typescript
            {/* ── TAB: BASE DE DATOS (placeholder) ───────────────────────────── */}
            <TabsContent value="base-datos" className="mt-6">
              <Card className="rounded-2xl border shadow-sm">
                <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                  <Database className="mb-4 h-12 w-12 text-slate-300" />
                  <p className="text-sm font-medium text-slate-500">Base de datos de entidades</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Próximamente disponible.
                  </p>
                </CardContent>
              </Card>
            </TabsContent>
```

Reemplaza por:
```typescript
            {/* ── TAB: BASE DE DATOS ────────────────────────────────────────── */}
            <TabsContent value="base-datos" className="mt-6">
              <BaseDatosDepositosGarantia tipo={tipo} />
            </TabsContent>
```

---

## Verificación

```bash
cd bukipin-dashboard && npx tsc --noEmit 2>&1 | head -30
```

Si hay errores de TypeScript, revisar y corregir antes de continuar.

---

## Efecto esperado

| Tab | Resultado |
|---|---|
| **Transacciones** | ✅ Tabla cronológica con filtro por entidad, totales (Entradas / Salidas / Neto / Registros), badges por tipo de movimiento |
| **Analítica** | ✅ Gráfica horizontal de barras, top 10 entidades por saldo, tooltip con detalle, botón "Ver todos" con dialog paginado (25 en 25) |
| **Base de datos** | ✅ Directorio de entidades con búsqueda por nombre/RFC, filtro por estado (Activo/Liquidado/Todos), saldo actual, fecha de inicio |
| Cambio de tipo (Recibido/Realizado) | ✅ Todos los tabs reaccionan al tipo seleccionado en las tarjetas superiores |
