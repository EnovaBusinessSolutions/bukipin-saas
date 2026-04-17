# Prompt 8.2 — Frontend: Página de entrada + Tab Registro (Depósitos en Garantía)

## Contexto

Se implementa el frontend del módulo Depósitos en Garantía.
El backend ya existe en `/api/depositos-garantia` (ver prompt-8.1).

Ruta: `/registros/depositos-garantia`
Tabs: Registro | Transacciones | Analítica | Base de datos

En este prompt se implementan:
- Hook `useDepositosGarantia.tsx`
- Página `RegistroDepositosGarantia.tsx` con la página de entrada y el tab Registro completo
- Los otros 3 tabs quedan como placeholders (se completarán en el siguiente prompt)
- Ruta en `App.tsx` + enlace en `Sidebar.tsx`

---

## CAMBIO 1 — Crear `bukipin-dashboard/src/hooks/useDepositosGarantia.tsx` (archivo nuevo)

```typescript
// bukipin-dashboard/src/hooks/useDepositosGarantia.tsx
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

// ─── Types ───────────────────────────────────────────────────────────────────

export type TipoDeposito = "recibido" | "realizado";

export interface DepositoGarantia {
  id: string;
  tipo: TipoDeposito;
  entidad_nombre: string;
  entidad_rfc: string;
  entidad_tipo: "empresa" | "persona";
  saldo_actual: number;
  fecha_inicio: string | null;
  referencia: string;
  estado: "activo" | "liquidado";
  created_at: string | null;
}

export interface DepositoMovimiento {
  id: string;
  deposito_id: string;
  entidad_nombre: string;
  tipo_movimiento: "nuevo" | "aumento" | "disminucion" | "devolucion" | "liquidacion";
  monto: number;
  monto_con_signo: number;
  metodo_pago: "caja" | "bancos";
  fecha: string | null;
  referencia: string;
  created_at: string | null;
}

export interface ResumenDepositos {
  total_saldo: number;
  total_entidades: number;
  total_movimientos: number;
}

export interface NuevoDepositoPayload {
  tipo: TipoDeposito;
  entidad_nombre: string;
  entidad_rfc?: string;
  entidad_tipo?: "empresa" | "persona";
  monto_inicial: number;
  metodo_pago?: "caja" | "bancos";
  fecha?: string;
  referencia?: string;
}

export interface NuevoMovimientoPayload {
  tipo_movimiento: "aumento" | "disminucion" | "devolucion" | "liquidacion";
  monto: number;
  metodo_pago?: "caja" | "bancos";
  fecha?: string;
  referencia?: string;
}

// ─── Hook principal ───────────────────────────────────────────────────────────

export const useDepositosResumen = () => {
  return useQuery({
    queryKey: ["depositos-garantia-resumen"],
    queryFn: async () => {
      const json = await apiFetch("/api/depositos-garantia/resumen", { method: "GET" });
      const data = json?.data ?? json ?? {};
      return {
        recibidos: (data.recibidos ?? {}) as ResumenDepositos,
        realizados: (data.realizados ?? {}) as ResumenDepositos,
      };
    },
    staleTime: 30_000,
  });
};

export const useDepositos = (tipo: TipoDeposito, estado: "activo" | "liquidado" | "todos" = "activo") => {
  return useQuery({
    queryKey: ["depositos-garantia", tipo, estado],
    queryFn: async () => {
      const json = await apiFetch(`/api/depositos-garantia?tipo=${tipo}&estado=${estado}`, { method: "GET" });
      const raw = json?.data ?? json ?? [];
      return Array.isArray(raw) ? (raw as DepositoGarantia[]) : [];
    },
    staleTime: 30_000,
  });
};

export const useDepositoDetalle = (id: string | null) => {
  return useQuery({
    queryKey: ["depositos-garantia-detalle", id],
    queryFn: async () => {
      const json = await apiFetch(`/api/depositos-garantia/${id}`, { method: "GET" });
      return json?.data ?? json ?? null;
    },
    enabled: !!id,
    staleTime: 15_000,
  });
};

export const useDepositosMovimientos = (tipo?: TipoDeposito) => {
  return useQuery({
    queryKey: ["depositos-garantia-movimientos", tipo ?? "todos"],
    queryFn: async () => {
      const url = tipo
        ? `/api/depositos-garantia/movimientos?tipo=${tipo}`
        : "/api/depositos-garantia/movimientos";
      const json = await apiFetch(url, { method: "GET" });
      const raw = json?.data ?? json ?? [];
      const totales = json?.totales ?? { entradas: 0, salidas: 0, neto: 0 };
      return { movimientos: Array.isArray(raw) ? (raw as DepositoMovimiento[]) : [], totales };
    },
    staleTime: 30_000,
  });
};

export const useDepositosAnalitica = (tipo: TipoDeposito) => {
  return useQuery({
    queryKey: ["depositos-garantia-analitica", tipo],
    queryFn: async () => {
      const json = await apiFetch(`/api/depositos-garantia/analitica?tipo=${tipo}`, { method: "GET" });
      const raw = json?.data ?? json ?? [];
      return Array.isArray(raw) ? raw : [];
    },
    staleTime: 30_000,
  });
};

export const useDepositosMutations = () => {
  const qc = useQueryClient();

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["depositos-garantia"] });
    qc.invalidateQueries({ queryKey: ["depositos-garantia-resumen"] });
    qc.invalidateQueries({ queryKey: ["depositos-garantia-movimientos"] });
    qc.invalidateQueries({ queryKey: ["depositos-garantia-analitica"] });
    qc.invalidateQueries({ queryKey: ["depositos-garantia-detalle"] });
  };

  const crearDeposito = useMutation({
    mutationFn: async (payload: NuevoDepositoPayload) => {
      const json = await apiFetch("/api/depositos-garantia", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!json?.ok) throw new Error(json?.message || "Error al crear depósito");
      return json.data;
    },
    onSuccess: invalidateAll,
  });

  const agregarMovimiento = useMutation({
    mutationFn: async ({ depositoId, payload }: { depositoId: string; payload: NuevoMovimientoPayload }) => {
      const json = await apiFetch(`/api/depositos-garantia/${depositoId}/movimiento`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!json?.ok) throw new Error(json?.message || "Error al registrar movimiento");
      return json.data;
    },
    onSuccess: invalidateAll,
  });

  return { crearDeposito, agregarMovimiento };
};
```

---

## CAMBIO 2 — Crear `bukipin-dashboard/src/pages/registros/RegistroDepositosGarantia.tsx` (archivo nuevo)

```typescript
// bukipin-dashboard/src/pages/registros/RegistroDepositosGarantia.tsx
import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Shield,
  ArrowRight,
  Plus,
  ArrowLeftRight,
  BarChart3,
  Database,
  ReceiptText,
  ClipboardList,
  ArrowLeft,
  Loader2,
  TrendingUp,
  TrendingDown,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  useDepositosResumen,
  useDepositos,
  useDepositosMutations,
  type TipoDeposito,
  type DepositoGarantia,
} from "@/hooks/useDepositosGarantia";

// ─── Tipos locales ────────────────────────────────────────────────────────────

type TabValue = "registro" | "transacciones" | "analitica" | "base-datos";
type AccionRegistro = "" | "nuevo" | "modificar";
type TipoMovimiento = "aumento" | "disminucion" | "devolucion" | "liquidacion";

const formatMXN = (v: number) =>
  v.toLocaleString("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 });

// ─── Formulario nuevo depósito ────────────────────────────────────────────────

interface FormNuevo {
  entidad_nombre: string;
  entidad_rfc: string;
  entidad_tipo: "empresa" | "persona";
  monto_inicial: string;
  metodo_pago: "caja" | "bancos";
  fecha: string;
  referencia: string;
}

const FORM_NUEVO_INIT: FormNuevo = {
  entidad_nombre: "",
  entidad_rfc: "",
  entidad_tipo: "empresa",
  monto_inicial: "",
  metodo_pago: "bancos",
  fecha: new Date().toISOString().split("T")[0],
  referencia: "",
};

// ─── Formulario de movimiento ─────────────────────────────────────────────────

interface FormMovimiento {
  tipo_movimiento: TipoMovimiento;
  monto: string;
  metodo_pago: "caja" | "bancos";
  fecha: string;
  referencia: string;
}

const FORM_MOV_INIT: FormMovimiento = {
  tipo_movimiento: "aumento",
  monto: "",
  metodo_pago: "bancos",
  fecha: new Date().toISOString().split("T")[0],
  referencia: "",
};

// ─── Componente principal ─────────────────────────────────────────────────────

const RegistroDepositosGarantia = () => {
  const { toast } = useToast();
  const [tipo, setTipo] = useState<TipoDeposito>("recibido");
  const [tabActiva, setTabActiva] = useState<TabValue>("registro");
  const [accion, setAccion] = useState<AccionRegistro>("");
  const [depositoSeleccionado, setDepositoSeleccionado] = useState<DepositoGarantia | null>(null);
  const [formNuevo, setFormNuevo] = useState<FormNuevo>(FORM_NUEVO_INIT);
  const [formMov, setFormMov] = useState<FormMovimiento>(FORM_MOV_INIT);

  const { data: resumen, isLoading: loadingResumen } = useDepositosResumen();
  const { data: depositos = [], isLoading: loadingDepositos } = useDepositos(tipo);
  const { crearDeposito, agregarMovimiento } = useDepositosMutations();

  const resumenActual = tipo === "recibido" ? resumen?.recibidos : resumen?.realizados;

  // ── Handlers ────────────────────────────────────────────────────────────────

  const handleCambiarTipo = (nuevoTipo: TipoDeposito) => {
    setTipo(nuevoTipo);
    setAccion("");
    setDepositoSeleccionado(null);
    setFormNuevo(FORM_NUEVO_INIT);
    setFormMov(FORM_MOV_INIT);
  };

  const handleTabChange = (val: string) => {
    setTabActiva(val as TabValue);
    setAccion("");
    setDepositoSeleccionado(null);
  };

  const handleSubmitNuevo = async () => {
    if (!formNuevo.entidad_nombre.trim()) {
      toast({ title: "Campo requerido", description: "El nombre de la entidad es obligatorio.", variant: "destructive" });
      return;
    }
    const monto = parseFloat(formNuevo.monto_inicial.replace(/,/g, ""));
    if (!monto || monto <= 0) {
      toast({ title: "Monto inválido", description: "Ingresa un monto mayor a 0.", variant: "destructive" });
      return;
    }
    try {
      await crearDeposito.mutateAsync({
        tipo,
        entidad_nombre: formNuevo.entidad_nombre.trim(),
        entidad_rfc: formNuevo.entidad_rfc.trim(),
        entidad_tipo: formNuevo.entidad_tipo,
        monto_inicial: monto,
        metodo_pago: formNuevo.metodo_pago,
        fecha: formNuevo.fecha,
        referencia: formNuevo.referencia.trim(),
      });
      toast({ title: "✅ Depósito registrado", description: `${formNuevo.entidad_nombre} — ${formatMXN(monto)}` });
      setFormNuevo(FORM_NUEVO_INIT);
      setAccion("");
    } catch (err: any) {
      toast({ title: "Error", description: err?.message || "Error inesperado.", variant: "destructive" });
    }
  };

  const handleSubmitMovimiento = async () => {
    if (!depositoSeleccionado) return;
    const monto = parseFloat(formMov.monto.replace(/,/g, ""));
    if (!monto || monto <= 0) {
      toast({ title: "Monto inválido", description: "Ingresa un monto mayor a 0.", variant: "destructive" });
      return;
    }
    try {
      await agregarMovimiento.mutateAsync({
        depositoId: depositoSeleccionado.id,
        payload: {
          tipo_movimiento: formMov.tipo_movimiento,
          monto,
          metodo_pago: formMov.metodo_pago,
          fecha: formMov.fecha,
          referencia: formMov.referencia.trim(),
        },
      });
      const etiqueta = { aumento: "Aumento", disminucion: "Disminución", devolucion: "Devolución", liquidacion: "Liquidación" }[formMov.tipo_movimiento];
      toast({ title: `✅ ${etiqueta} registrada`, description: `${depositoSeleccionado.entidad_nombre} — ${formatMXN(monto)}` });
      setFormMov(FORM_MOV_INIT);
      setDepositoSeleccionado(null);
      setAccion("");
    } catch (err: any) {
      toast({ title: "Error", description: err?.message || "Error inesperado.", variant: "destructive" });
    }
  };

  // ── Render helpers ──────────────────────────────────────────────────────────

  const esRecibido = tipo === "recibido";

  const tipoLabel = esRecibido ? "Depósitos recibidos" : "Depósitos realizados";
  const tipoDesc = esRecibido
    ? "Dinero que nos dejaron como garantía — debemos regresarlo"
    : "Dinero que entregamos como garantía — nos lo tienen que regresar";

  return (
    <div className="flex h-full flex-col overflow-hidden bg-slate-50/40">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="border-b bg-background">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-6 py-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 rounded-full border bg-white px-3 py-1 text-xs font-medium text-slate-600 shadow-sm">
                <Shield className="h-3.5 w-3.5" />
                Módulo financiero
              </div>
              <div>
                <h1 className="text-3xl font-bold tracking-tight text-foreground">
                  Depósitos en Garantía
                </h1>
                <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
                  Gestiona depósitos recibidos (Pasivo) y realizados (Activo) con trazabilidad contable automática.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-2xl border bg-white px-4 py-3 shadow-sm">
                <p className="text-xs text-muted-foreground">Registro</p>
                <p className="mt-1 text-sm font-semibold text-slate-900">Altas y ajustes</p>
              </div>
              <div className="rounded-2xl border bg-white px-4 py-3 shadow-sm">
                <p className="text-xs text-muted-foreground">Transacciones</p>
                <p className="mt-1 text-sm font-semibold text-slate-900">Historial</p>
              </div>
              <div className="rounded-2xl border bg-white px-4 py-3 shadow-sm">
                <p className="text-xs text-muted-foreground">Analítica</p>
                <p className="mt-1 text-sm font-semibold text-slate-900">Por entidad</p>
              </div>
              <div className="rounded-2xl border bg-white px-4 py-3 shadow-sm">
                <p className="text-xs text-muted-foreground">Base de datos</p>
                <p className="mt-1 text-sm font-semibold text-slate-900">Directorio</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Contenido ──────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto">
        <div className="mx-auto w-full max-w-7xl px-6 py-6">

          {/* Selector de modo: 2 tarjetas */}
          <div className="mb-6 grid gap-4 md:grid-cols-2">
            {/* Recibidos */}
            <button
              type="button"
              onClick={() => handleCambiarTipo("recibido")}
              className={`rounded-2xl border p-5 text-left shadow-sm transition-all ${
                esRecibido
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "bg-white hover:border-slate-300"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge variant="outline" className={esRecibido ? "border-slate-500 text-slate-200 bg-transparent" : "border-slate-300"}>
                      Pasivo
                    </Badge>
                  </div>
                  <p className={`text-base font-semibold ${esRecibido ? "text-white" : "text-slate-900"}`}>
                    Depósitos recibidos
                  </p>
                  <p className={`mt-1 text-sm ${esRecibido ? "text-slate-300" : "text-muted-foreground"}`}>
                    Alguien nos dejó dinero como garantía
                  </p>
                  {!loadingResumen && resumen && (
                    <p className={`mt-2 text-lg font-bold ${esRecibido ? "text-white" : "text-slate-800"}`}>
                      {formatMXN(resumen.recibidos?.total_saldo ?? 0)}
                    </p>
                  )}
                  {!loadingResumen && resumen && (
                    <p className={`text-xs mt-0.5 ${esRecibido ? "text-slate-400" : "text-muted-foreground"}`}>
                      {resumen.recibidos?.total_entidades ?? 0} entidades · {resumen.recibidos?.total_movimientos ?? 0} movimientos
                    </p>
                  )}
                </div>
                <TrendingDown className={`h-5 w-5 shrink-0 mt-1 ${esRecibido ? "text-slate-400" : "text-slate-400"}`} />
              </div>
            </button>

            {/* Realizados */}
            <button
              type="button"
              onClick={() => handleCambiarTipo("realizado")}
              className={`rounded-2xl border p-5 text-left shadow-sm transition-all ${
                !esRecibido
                  ? "border-emerald-700 bg-emerald-700 text-white"
                  : "bg-white hover:border-emerald-300"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge variant="outline" className={!esRecibido ? "border-emerald-500 text-emerald-200 bg-transparent" : "border-emerald-300 text-emerald-700"}>
                      Activo
                    </Badge>
                  </div>
                  <p className={`text-base font-semibold ${!esRecibido ? "text-white" : "text-slate-900"}`}>
                    Depósitos realizados
                  </p>
                  <p className={`mt-1 text-sm ${!esRecibido ? "text-emerald-100" : "text-muted-foreground"}`}>
                    Nosotros dimos dinero como garantía
                  </p>
                  {!loadingResumen && resumen && (
                    <p className={`mt-2 text-lg font-bold ${!esRecibido ? "text-white" : "text-slate-800"}`}>
                      {formatMXN(resumen.realizados?.total_saldo ?? 0)}
                    </p>
                  )}
                  {!loadingResumen && resumen && (
                    <p className={`text-xs mt-0.5 ${!esRecibido ? "text-emerald-200" : "text-muted-foreground"}`}>
                      {resumen.realizados?.total_entidades ?? 0} entidades · {resumen.realizados?.total_movimientos ?? 0} movimientos
                    </p>
                  )}
                </div>
                <TrendingUp className={`h-5 w-5 shrink-0 mt-1 ${!esRecibido ? "text-emerald-200" : "text-slate-400"}`} />
              </div>
            </button>
          </div>

          {/* Tabs */}
          <Tabs value={tabActiva} onValueChange={handleTabChange} className="w-full">
            <div className="rounded-2xl border bg-white p-2 shadow-sm">
              <TabsList className="grid h-auto w-full grid-cols-2 gap-2 bg-transparent md:grid-cols-4">
                <TabsTrigger value="registro" className="flex items-center gap-2 rounded-xl px-3 py-3 data-[state=active]:shadow-sm">
                  <ClipboardList className="h-4 w-4" />
                  <span>Registro</span>
                </TabsTrigger>
                <TabsTrigger value="transacciones" className="flex items-center gap-2 rounded-xl px-3 py-3 data-[state=active]:shadow-sm">
                  <ReceiptText className="h-4 w-4" />
                  <span>Transacciones</span>
                </TabsTrigger>
                <TabsTrigger value="analitica" className="flex items-center gap-2 rounded-xl px-3 py-3 data-[state=active]:shadow-sm">
                  <BarChart3 className="h-4 w-4" />
                  <span>Analítica</span>
                </TabsTrigger>
                <TabsTrigger value="base-datos" className="flex items-center gap-2 rounded-xl px-3 py-3 data-[state=active]:shadow-sm">
                  <Database className="h-4 w-4" />
                  <span>Base de datos</span>
                </TabsTrigger>
              </TabsList>
            </div>

            {/* ── TAB: REGISTRO ─────────────────────────────────────────────── */}
            <TabsContent value="registro" className="mt-6 space-y-6">
              <Card className="rounded-2xl border shadow-sm">
                <CardHeader className="space-y-1">
                  <CardTitle className="text-xl font-semibold">{tipoLabel}</CardTitle>
                  <CardDescription>{tipoDesc}</CardDescription>
                </CardHeader>
                <CardContent>
                  {/* Sin acción seleccionada: mostrar 2 opciones */}
                  {!accion && (
                    <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                      {/* Nuevo depósito */}
                      <button
                        type="button"
                        onClick={() => setAccion("nuevo")}
                        className="group rounded-2xl border bg-white p-6 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
                      >
                        <div className="flex items-start gap-4">
                          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-primary/10">
                            <Plus className="h-7 w-7 text-primary" />
                          </div>
                          <div className="min-w-0 space-y-1">
                            <p className="font-semibold text-slate-900">Nuevo depósito</p>
                            <p className="text-sm text-muted-foreground">
                              Registrar una nueva entidad y monto inicial de garantía.
                            </p>
                          </div>
                          <ArrowRight className="ml-auto h-5 w-5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                        </div>
                      </button>

                      {/* Modificar existente */}
                      <button
                        type="button"
                        onClick={() => setAccion("modificar")}
                        className="group rounded-2xl border bg-white p-6 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
                      >
                        <div className="flex items-start gap-4">
                          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-cyan-500/10">
                            <ArrowLeftRight className="h-7 w-7 text-cyan-600" />
                          </div>
                          <div className="min-w-0 space-y-1">
                            <p className="font-semibold text-slate-900">Modificar existente</p>
                            <p className="text-sm text-muted-foreground">
                              Aumentar, reducir o liquidar un depósito activo.
                            </p>
                          </div>
                          <ArrowRight className="ml-auto h-5 w-5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                        </div>
                      </button>
                    </div>
                  )}

                  {/* ── Formulario: Nuevo depósito ─────────────────────────── */}
                  {accion === "nuevo" && (
                    <div className="space-y-6">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setAccion("")}
                          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-slate-900"
                        >
                          <ArrowLeft className="h-4 w-4" />
                          Volver
                        </button>
                        <span className="text-sm font-medium text-slate-900">Registrar nuevo depósito en garantía</span>
                      </div>

                      <div className="grid gap-6 md:grid-cols-2">
                        {/* Nombre */}
                        <div className="space-y-2 md:col-span-2">
                          <Label htmlFor="entidad_nombre">
                            {esRecibido ? "Nombre del deudor *" : "Nombre del acreedor *"}
                          </Label>
                          <Input
                            id="entidad_nombre"
                            placeholder="Razón social o nombre completo"
                            value={formNuevo.entidad_nombre}
                            onChange={(e) => setFormNuevo((p) => ({ ...p, entidad_nombre: e.target.value }))}
                          />
                        </div>

                        {/* RFC */}
                        <div className="space-y-2">
                          <Label htmlFor="entidad_rfc">RFC</Label>
                          <Input
                            id="entidad_rfc"
                            placeholder="RFC con homoclave"
                            value={formNuevo.entidad_rfc}
                            onChange={(e) => setFormNuevo((p) => ({ ...p, entidad_rfc: e.target.value }))}
                          />
                        </div>

                        {/* Tipo entidad */}
                        <div className="space-y-2">
                          <Label>Tipo de entidad</Label>
                          <div className="flex gap-2">
                            {(["empresa", "persona"] as const).map((t) => (
                              <button
                                key={t}
                                type="button"
                                onClick={() => setFormNuevo((p) => ({ ...p, entidad_tipo: t }))}
                                className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium capitalize transition-colors ${
                                  formNuevo.entidad_tipo === t
                                    ? "border-slate-900 bg-slate-900 text-white"
                                    : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
                                }`}
                              >
                                {t === "empresa" ? "Empresa" : "Persona física"}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Monto */}
                        <div className="space-y-2">
                          <Label htmlFor="monto_inicial">Monto inicial (MXN) *</Label>
                          <Input
                            id="monto_inicial"
                            type="number"
                            min={0}
                            step={0.01}
                            placeholder="0.00"
                            value={formNuevo.monto_inicial}
                            onChange={(e) => setFormNuevo((p) => ({ ...p, monto_inicial: e.target.value }))}
                          />
                        </div>

                        {/* Fecha */}
                        <div className="space-y-2">
                          <Label htmlFor="fecha_nuevo">Fecha</Label>
                          <Input
                            id="fecha_nuevo"
                            type="date"
                            value={formNuevo.fecha}
                            onChange={(e) => setFormNuevo((p) => ({ ...p, fecha: e.target.value }))}
                          />
                        </div>

                        {/* Método de pago */}
                        <div className="space-y-2">
                          <Label>Método de {esRecibido ? "recepción" : "pago"}</Label>
                          <div className="flex gap-2">
                            {(["bancos", "caja"] as const).map((m) => (
                              <button
                                key={m}
                                type="button"
                                onClick={() => setFormNuevo((p) => ({ ...p, metodo_pago: m }))}
                                className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium capitalize transition-colors ${
                                  formNuevo.metodo_pago === m
                                    ? "border-slate-900 bg-slate-900 text-white"
                                    : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
                                }`}
                              >
                                {m === "bancos" ? "Bancos" : "Efectivo / Caja"}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Referencia */}
                        <div className="space-y-2 md:col-span-2">
                          <Label htmlFor="referencia_nuevo">Referencia / Contrato / Notas</Label>
                          <Input
                            id="referencia_nuevo"
                            placeholder="Contrato, concepto u observación..."
                            value={formNuevo.referencia}
                            onChange={(e) => setFormNuevo((p) => ({ ...p, referencia: e.target.value }))}
                          />
                        </div>
                      </div>

                      <div className="flex justify-end gap-2 pt-2">
                        <Button variant="outline" onClick={() => setAccion("")}>
                          Cancelar
                        </Button>
                        <Button
                          onClick={handleSubmitNuevo}
                          disabled={crearDeposito.isPending}
                        >
                          {crearDeposito.isPending ? (
                            <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Registrando...</>
                          ) : (
                            "Registrar nuevo depósito"
                          )}
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* ── Modificar existente ────────────────────────────────── */}
                  {accion === "modificar" && !depositoSeleccionado && (
                    <div className="space-y-4">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setAccion("")}
                          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-slate-900"
                        >
                          <ArrowLeft className="h-4 w-4" />
                          Volver
                        </button>
                        <span className="text-sm font-medium text-slate-900">Selecciona el depósito a modificar</span>
                      </div>

                      {loadingDepositos ? (
                        <div className="flex items-center justify-center py-10 text-muted-foreground">
                          <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Cargando...
                        </div>
                      ) : depositos.length === 0 ? (
                        <div className="rounded-2xl border border-dashed bg-slate-50 py-12 text-center">
                          <Shield className="mx-auto mb-3 h-10 w-10 text-slate-300" />
                          <p className="text-sm text-muted-foreground">No hay depósitos activos para este tipo.</p>
                          <Button variant="link" size="sm" onClick={() => setAccion("nuevo")} className="mt-2">
                            Registrar el primero
                          </Button>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {depositos.map((dep) => (
                            <button
                              key={dep.id}
                              type="button"
                              onClick={() => {
                                setDepositoSeleccionado(dep);
                                setFormMov(FORM_MOV_INIT);
                              }}
                              className="group flex w-full items-center justify-between rounded-2xl border bg-white px-5 py-4 text-left shadow-sm transition-all hover:border-slate-300 hover:shadow-md"
                            >
                              <div className="flex items-center gap-3 min-w-0">
                                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-bold text-slate-600">
                                  {(dep.entidad_nombre?.[0] ?? "?").toUpperCase()}
                                </div>
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-medium text-slate-900">{dep.entidad_nombre}</p>
                                  <p className="text-xs text-muted-foreground">{dep.entidad_rfc || dep.entidad_tipo}</p>
                                </div>
                              </div>
                              <div className="shrink-0 text-right">
                                <p className="text-sm font-semibold text-slate-900">{formatMXN(dep.saldo_actual)}</p>
                                <ArrowRight className="ml-auto h-4 w-4 text-slate-400 opacity-0 transition-opacity group-hover:opacity-100" />
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* ── Formulario de movimiento ───────────────────────────── */}
                  {accion === "modificar" && depositoSeleccionado && (
                    <div className="space-y-6">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setDepositoSeleccionado(null)}
                          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-slate-900"
                        >
                          <ArrowLeft className="h-4 w-4" />
                          Volver a la lista
                        </button>
                      </div>

                      {/* Info del depósito seleccionado */}
                      <div className="rounded-2xl border bg-slate-50 px-5 py-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="font-semibold text-slate-900">{depositoSeleccionado.entidad_nombre}</p>
                            <p className="text-xs text-muted-foreground">{depositoSeleccionado.entidad_rfc || depositoSeleccionado.entidad_tipo}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-xs text-muted-foreground">Saldo actual</p>
                            <p className="text-lg font-bold text-slate-900">{formatMXN(depositoSeleccionado.saldo_actual)}</p>
                          </div>
                        </div>
                      </div>

                      {/* Tipo de movimiento */}
                      <div className="space-y-2">
                        <Label>Tipo de movimiento</Label>
                        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                          {([
                            { key: "aumento", label: "Aumento" },
                            { key: "disminucion", label: "Disminución" },
                            { key: "devolucion", label: "Devolución" },
                            { key: "liquidacion", label: "Liquidación total" },
                          ] as const).map((op) => (
                            <button
                              key={op.key}
                              type="button"
                              onClick={() => setFormMov((p) => ({ ...p, tipo_movimiento: op.key }))}
                              className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                                formMov.tipo_movimiento === op.key
                                  ? op.key === "aumento"
                                    ? "border-emerald-700 bg-emerald-700 text-white"
                                    : "border-slate-900 bg-slate-900 text-white"
                                  : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
                              }`}
                            >
                              {op.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="grid gap-4 md:grid-cols-2">
                        {/* Monto */}
                        <div className="space-y-2">
                          <Label htmlFor="monto_mov">Monto (MXN) *</Label>
                          <Input
                            id="monto_mov"
                            type="number"
                            min={0}
                            step={0.01}
                            placeholder="0.00"
                            value={formMov.monto}
                            onChange={(e) => setFormMov((p) => ({ ...p, monto: e.target.value }))}
                          />
                        </div>

                        {/* Fecha */}
                        <div className="space-y-2">
                          <Label htmlFor="fecha_mov">Fecha</Label>
                          <Input
                            id="fecha_mov"
                            type="date"
                            value={formMov.fecha}
                            onChange={(e) => setFormMov((p) => ({ ...p, fecha: e.target.value }))}
                          />
                        </div>

                        {/* Método pago */}
                        <div className="space-y-2">
                          <Label>Método</Label>
                          <div className="flex gap-2">
                            {(["bancos", "caja"] as const).map((m) => (
                              <button
                                key={m}
                                type="button"
                                onClick={() => setFormMov((p) => ({ ...p, metodo_pago: m }))}
                                className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                                  formMov.metodo_pago === m
                                    ? "border-slate-900 bg-slate-900 text-white"
                                    : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
                                }`}
                              >
                                {m === "bancos" ? "Bancos" : "Caja"}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Referencia */}
                        <div className="space-y-2">
                          <Label htmlFor="ref_mov">Referencia / Notas</Label>
                          <Input
                            id="ref_mov"
                            placeholder="Contrato, motivo..."
                            value={formMov.referencia}
                            onChange={(e) => setFormMov((p) => ({ ...p, referencia: e.target.value }))}
                          />
                        </div>
                      </div>

                      <div className="flex justify-end gap-2 pt-2">
                        <Button variant="outline" onClick={() => setDepositoSeleccionado(null)}>
                          Cancelar
                        </Button>
                        <Button
                          onClick={handleSubmitMovimiento}
                          disabled={agregarMovimiento.isPending}
                        >
                          {agregarMovimiento.isPending ? (
                            <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Registrando...</>
                          ) : (
                            "Registrar movimiento"
                          )}
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

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
          </Tabs>
        </div>
      </div>
    </div>
  );
};

export default RegistroDepositosGarantia;
```

---

## CAMBIO 3 — Agregar ruta en `bukipin-dashboard/src/App.tsx`

### 3a — Agregar el import

Busca la línea:
```typescript
import RegistroImpuestos from "./pages/registros/RegistroImpuestos";
```

INMEDIATAMENTE DESPUÉS de esa línea, agrega:
```typescript
import RegistroDepositosGarantia from "./pages/registros/RegistroDepositosGarantia";
```

### 3b — Agregar la ruta

Busca el bloque:
```typescript
                <Route
                  path="/registros/impuestos"
                  element={<RegistroImpuestos />}
                />
```

INMEDIATAMENTE DESPUÉS de ese bloque, agrega:
```typescript
                <Route
                  path="/registros/depositos-garantia"
                  element={<RegistroDepositosGarantia />}
                />
```

---

## CAMBIO 4 — Agregar enlace en `bukipin-dashboard/src/components/Layout/Sidebar.tsx`

Busca el bloque del array `registrosItems` y dentro de él localiza la última entrada (Registro de Impuestos):
```typescript
    {
      name: "Registro de Impuestos",
      path: "/registros/impuestos",
      active: location.pathname === "/registros/impuestos",
    },
```

INMEDIATAMENTE DESPUÉS de esa entrada (todavía dentro del array, antes del cierre `]`), agrega:
```typescript
    {
      name: "Depósitos en Garantía",
      path: "/registros/depositos-garantia",
      active: location.pathname === "/registros/depositos-garantia",
    },
```

---

## Verificación

```bash
cd bukipin-dashboard && npx tsc --noEmit 2>&1 | head -30
```

Si hay errores de TypeScript, revisar y corregir antes de continuar.

---

## Efecto esperado

| Elemento | Resultado |
|---|---|
| Sidebar → Registros | ✅ Aparece "Depósitos en Garantía" al final de la sección |
| Ruta `/registros/depositos-garantia` | ✅ Carga la página |
| Entrada: 2 tarjetas | ✅ "Depósitos recibidos" (Pasivo) y "Depósitos realizados" (Activo) con saldos en tiempo real |
| Tab Registro → Nuevo depósito | ✅ Form completo: entidad, RFC, tipo, monto, fecha, método, referencia |
| Tab Registro → Modificar existente | ✅ Lista de depósitos activos → seleccionar → form aumento/disminución/devolución/liquidación |
| Tabs Transacciones / Analítica / Base de datos | ✅ Placeholders listos para completar en prompt-8.3 |
| Asiento contable | ✅ El backend lo genera automáticamente al crear o mover |
