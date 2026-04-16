# Prompt 6.1 — Fix subida de imágenes E2E en todo Bukipin

## Diagnóstico raíz

Hay **3 rutas de upload que no existen** en el backend (el frontend las llama pero el servidor
devuelve 404) y **1 modelo sin campo imagen**:

| Panel | Frontend llama a | ¿Existe en backend? | Estado |
|---|---|---|---|
| CAPEX / Inversiones | `POST /api/uploads/activos` | ❌ NO | Siempre 404 |
| Inventario Productos | `POST /api/uploads/product-image` | ❌ NO | Siempre 404 |
| Comprobantes de Egresos | `POST /api/uploads/comprobante-egreso` | ❌ NO | Siempre 404 |
| Expense Products | `POST /api/productos-egresos` (multipart) | ✅ SÍ | OK |
| Autoridades Fiscales | `POST /api/uploads/autoridades-fiscales/logo` | ✅ SÍ | OK |

Además, el modelo `Product` no tiene campo `imagen_url`.

---

## CAMBIO 1 — Crear `backend/routes/uploadsGeneral.js` (archivo nuevo)

Crear el archivo `backend/routes/uploadsGeneral.js` con el siguiente contenido completo:

```js
// backend/routes/uploadsGeneral.js
// Rutas de upload de imágenes para: activos (CAPEX) y productos de inventario
const express = require("express");
const fs = require("fs");
const path = require("path");
const multer = require("multer");

const ensureAuth = require("../middleware/ensureAuth");

const router = express.Router();

// ──────────────────────────────────────────────────────
// Helper: crear storage de multer para un subdirectorio
// ──────────────────────────────────────────────────────
function makeStorage(subfolder) {
  const uploadDir = path.join(__dirname, "..", "..", "public", "uploads", subfolder);
  fs.mkdirSync(uploadDir, { recursive: true });

  return multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname || "").toLowerCase() || ".png";
      const safeBase = path
        .basename(file.originalname || "img", ext)
        .replace(/[^a-zA-Z0-9-_]/g, "_")
        .slice(0, 60);
      const owner = req.user?._id ? String(req.user._id) : "anon";
      const stamp = Date.now();
      cb(null, `${owner}-${stamp}-${safeBase}${ext}`);
    },
  });
}

function makeUpload(subfolder, limitMB = 5, allowPdf = false) {
  return multer({
    storage: makeStorage(subfolder),
    limits: { fileSize: limitMB * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const isImage = file.mimetype && file.mimetype.startsWith("image/");
      const isPdf = allowPdf && file.mimetype === "application/pdf";
      if (!isImage && !isPdf) {
        return cb(new Error(allowPdf ? "Solo se permiten imágenes o PDF." : "Solo se permiten imágenes."));
      }
      cb(null, true);
    },
  });
}

// ──────────────────────────────────────────────────────
// POST /api/uploads/activos/logo
// Usado por RegistroInversionForm.tsx para imágenes CAPEX
// ──────────────────────────────────────────────────────
const uploadActivos = makeUpload("activos");

router.post("/activos", ensureAuth, uploadActivos.single("file"), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ ok: false, message: "No se recibió ningún archivo." });
    }
    const url = `/uploads/activos/${req.file.filename}`;
    return res.status(201).json({
      ok: true,
      data: {
        url,
        publicUrl: url,
        imagen_url: url,
        filename: req.file.filename,
        size: req.file.size,
        mimetype: req.file.mimetype,
      },
    });
  } catch (err) {
    console.error("POST /api/uploads/activos error:", err);
    return res.status(500).json({ ok: false, message: "Error al subir imagen de activo." });
  }
});

// ──────────────────────────────────────────────────────
// POST /api/uploads/product-image
// Usado por useProductos.tsx (hook de inventario de productos)
// ──────────────────────────────────────────────────────
const uploadProductos = makeUpload("productos");

router.post("/product-image", ensureAuth, uploadProductos.single("file"), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ ok: false, message: "No se recibió ningún archivo." });
    }
    const url = `/uploads/productos/${req.file.filename}`;
    return res.status(201).json({
      ok: true,
      data: {
        url,
        publicUrl: url,
        imagen_url: url,
        filename: req.file.filename,
        size: req.file.size,
        mimetype: req.file.mimetype,
      },
    });
  } catch (err) {
    console.error("POST /api/uploads/product-image error:", err);
    return res.status(500).json({ ok: false, message: "Error al subir imagen de producto." });
  }
});

// ──────────────────────────────────────────────────────
// POST /api/uploads/comprobante-egreso
// Usado por ResumenEgresos.tsx para subir comprobantes de pago
// Espera campo "file" + campo opcional "transaccionId"
// ──────────────────────────────────────────────────────
const uploadComprobantes = makeUpload("comprobantes", 10, true); // 10 MB, acepta imágenes Y PDFs

router.post("/comprobante-egreso", ensureAuth, uploadComprobantes.single("file"), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ ok: false, message: "No se recibió ningún archivo." });
    }
    const url = `/uploads/comprobantes/${req.file.filename}`;
    return res.status(201).json({
      ok: true,
      data: {
        url,
        publicUrl: url,
        imagen_comprobante: url,
        filename: req.file.filename,
        size: req.file.size,
        mimetype: req.file.mimetype,
      },
    });
  } catch (err) {
    console.error("POST /api/uploads/comprobante-egreso error:", err);
    return res.status(500).json({ ok: false, message: "Error al subir comprobante." });
  }
});

module.exports = router;
```

---

## CAMBIO 2 — Montar las nuevas rutas en `backend/server.js`

Busca en `server.js` la línea que ya monta uploads:
```js
app.use("/api/uploads/autoridades-fiscales", require("./routes/uploadsAutoridadesFiscales"));
```

INMEDIATAMENTE DESPUÉS de esa línea, agrega:
```js
app.use("/api/uploads", require("./routes/uploadsGeneral"));
```

---

## CAMBIO 3 — Agregar `imagen_url` al modelo `Product` (`backend/models/Product.js`)

Abre `backend/models/Product.js` y busca el bloque `const productSchema = new mongoose.Schema({`.

Dentro del schema, busca la línea que tiene `isActive`:
```js
    isActive: { type: Boolean, default: true },
```

INMEDIATAMENTE DESPUÉS de esa línea, agrega:
```js
    imagen_url: { type: String, trim: true, default: "" },
```

Luego busca en el archivo si hay un `.toJSON` transform o una línea que construye el objeto de respuesta.
Si existe un bloque `transform` en `toJSON`, agrega dentro de él:
```js
        ret.imagen_url = doc.imagen_url || "";
```

Si no existe bloque `transform`, no es necesario agregar nada más.

---

## CAMBIO 4 — Aceptar `imagen_url` en `backend/routes/productos.js`

### 4a — En el handler POST (crear producto)

Busca el handler `router.post("/", ...)` en `productos.js`.
Dentro del handler, busca donde se lee el body para crear el producto (busca `name` o `nombre`).

Agrega la lectura de `imagen_url`:
```js
    const imagen_url = s(String(req.body?.imagen_url ?? req.body?.imagenUrl ?? ""));
```

Y donde se llama a `Product.create({...})`, agrega `imagen_url` al objeto:
```js
      imagen_url: imagen_url || "",
```

### 4b — En el handler PUT/PATCH (actualizar producto)

Busca el handler `router.put("/:id", ...)` o `router.patch("/:id", ...)`.

En el bloque donde se construye el objeto de actualización (busca `$set` o `patch`), agrega:
```js
    if (typeof req.body?.imagen_url !== "undefined") {
      patch.imagen_url = s(String(req.body.imagen_url ?? ""));
    } else if (typeof req.body?.imagenUrl !== "undefined") {
      patch.imagen_url = s(String(req.body.imagenUrl ?? ""));
    }
```

### 4c — En el handler GET (listar/obtener productos)

Busca cómo se mapean los productos al responder (normalmente `.lean()` + `.map()`).
Si hay un `map` o una función que construye el objeto de respuesta, agrega:
```js
      imagen_url: p?.imagen_url || "",
```

Si los productos se devuelven directamente con `.lean()` sin mapeo, MongoDB ya incluirá `imagen_url`
automáticamente cuando esté en el schema.

---

## CAMBIO 5 — Asegurar que `productosEgresos.js` crea el directorio al inicio

Busca en `backend/routes/productosEgresos.js` la función `saveImageIfAny`:
```js
function saveImageIfAny(file) {
  const uploadsDir = path.join(process.cwd(), "public", "uploads", "egresos");
  fs.mkdirSync(uploadsDir, { recursive: true });
```

Verifica que `fs.mkdirSync` esté llamado con `{ recursive: true }`.
Si ya está, no hay que cambiar nada. Si no está, agrégalo.

También verifica que `fs` y `path` estén importados al inicio del archivo:
```js
const fs = require("fs");
const path = require("path");
```

Si faltan, agrégalos.

---

## CAMBIO 6 — Agregar ruta `/api/uploads/instituciones-financieras` en `uploadsGeneral.js`

Al final del archivo `backend/routes/uploadsGeneral.js` (justo antes de `module.exports = router;`), agrega:

```js
// ──────────────────────────────────────────────────────
// POST /api/uploads/instituciones-financieras
// Usado por InstitucionFinancieraSelector.tsx para el logo de la institución
// ──────────────────────────────────────────────────────
const uploadInstitucionesFinancieras = makeUpload("instituciones-financieras");

router.post("/instituciones-financieras", ensureAuth, uploadInstitucionesFinancieras.single("file"), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ ok: false, message: "No se recibió ningún archivo." });
    }
    const url = `/uploads/instituciones-financieras/${req.file.filename}`;
    return res.status(201).json({
      ok: true,
      data: {
        url,
        publicUrl: url,
        logo_url: url,
        filename: req.file.filename,
        size: req.file.size,
        mimetype: req.file.mimetype,
      },
    });
  } catch (err) {
    console.error("POST /api/uploads/instituciones-financieras error:", err);
    return res.status(500).json({ ok: false, message: "Error al subir logo de institución." });
  }
});
```

---

## CAMBIO 7 — Agregar campo `logo_url` al modelo en `backend/routes/institucionesFinancieras.js`

### 7a — En el schema

Busca el bloque del campo `notas`:
```js
      notas: {
        type: String,
        trim: true,
        default: "",
      },
```

INMEDIATAMENTE DESPUÉS de ese bloque (antes de `activo:`), inserta:
```js
      logo_url: {
        type: String,
        trim: true,
        default: "",
      },
```

### 7b — En `mapInstitutionForUI`

Busca la línea:
```js
    notas: d.notas || "",
```

INMEDIATAMENTE DESPUÉS de esa línea, agrega:
```js
    logo_url: d.logo_url || "",
```

### 7c — En `mapSystemInstitutionForUI`

Busca la línea:
```js
    notas: "",
```
(dentro de `mapSystemInstitutionForUI`)

INMEDIATAMENTE DESPUÉS de esa línea, agrega:
```js
    logo_url: "",
```

### 7d — En el handler POST (crear institución)

Busca la línea donde se leen los campos del body antes del `if (!nombre)`:
```js
    const activo = asBool(req.body?.activo, true);
```

INMEDIATAMENTE DESPUÉS de esa línea, agrega:
```js
    const logo_url = asTrim(req.body?.logo_url || req.body?.logoUrl, "");
```

Y dentro de `FinancialInstitution.create({...})`, busca:
```js
      notas,
      activo: activo !== null ? activo : true,
```

Reemplaza por:
```js
      notas,
      logo_url,
      activo: activo !== null ? activo : true,
```

### 7e — En el handler PATCH (actualizar institución)

Busca la línea:
```js
    if (req.body?.notas !== undefined) patch.notas = asTrim(req.body?.notas, "");
```

INMEDIATAMENTE DESPUÉS de esa línea, agrega:
```js
    if (req.body?.logo_url !== undefined || req.body?.logoUrl !== undefined) {
      patch.logo_url = asTrim(req.body?.logo_url || req.body?.logoUrl, "");
    }
```

---

## CAMBIO 8 — Agregar upload de logo en `bukipin-dashboard/src/components/Financiamientos/InstitucionFinancieraSelector.tsx`

### 8a — Agregar `logo_url` al tipo `NewInstitutionForm`

Busca:
```typescript
type NewInstitutionForm = {
  nombre: string;
  alias: string;
  tipo: string;
  categoria: string;
  codigo: string;
  descripcion: string;
  telefono: string;
  email: string;
  sitio_web: string;
  contacto_nombre: string;
  contacto_puesto: string;
  notas: string;
};
```

Reemplaza por:
```typescript
type NewInstitutionForm = {
  nombre: string;
  alias: string;
  tipo: string;
  categoria: string;
  codigo: string;
  descripcion: string;
  telefono: string;
  email: string;
  sitio_web: string;
  contacto_nombre: string;
  contacto_puesto: string;
  notas: string;
  logo_url: string;
};
```

### 8b — Agregar `logo_url` al `INITIAL_FORM`

Busca:
```typescript
const INITIAL_FORM: NewInstitutionForm = {
  nombre: "",
  alias: "",
  tipo: "banco",
  categoria: "financiero",
  codigo: "",
  descripcion: "",
  telefono: "",
  email: "",
  sitio_web: "",
  contacto_nombre: "",
  contacto_puesto: "",
  notas: "",
};
```

Reemplaza por:
```typescript
const INITIAL_FORM: NewInstitutionForm = {
  nombre: "",
  alias: "",
  tipo: "banco",
  categoria: "financiero",
  codigo: "",
  descripcion: "",
  telefono: "",
  email: "",
  sitio_web: "",
  contacto_nombre: "",
  contacto_puesto: "",
  notas: "",
  logo_url: "",
};
```

### 8c — Agregar estado para el archivo de logo

Busca (dentro del componente `InstitucionFinancieraSelector`):
```typescript
  const [open, setOpen] = useState(false);
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [formData, setFormData] = useState<NewInstitutionForm>(INITIAL_FORM);
```

Reemplaza por:
```typescript
  const [open, setOpen] = useState(false);
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [formData, setFormData] = useState<NewInstitutionForm>(INITIAL_FORM);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string>("");
  const [uploadingLogo, setUploadingLogo] = useState(false);
```

### 8d — Actualizar `resetForm` para limpiar estado del logo

Busca:
```typescript
  const resetForm = () => {
    setFormData(INITIAL_FORM);
  };
```

Reemplaza por:
```typescript
  const resetForm = () => {
    setFormData(INITIAL_FORM);
    setLogoFile(null);
    setLogoPreview("");
    setUploadingLogo(false);
  };
```

### 8e — Agregar lógica de upload en `handleCreate`

Busca:
```typescript
  const handleCreate = async () => {
    if (!formData.nombre.trim()) {
      toast({
        title: "⚠️ Campo requerido",
        description: "El nombre de la institución es obligatorio",
        variant: "destructive",
      });
      return;
    }

    try {
      const nuevaInstitucion = await crearInstitucion.mutateAsync({
```

Reemplaza por:
```typescript
  const handleCreate = async () => {
    if (!formData.nombre.trim()) {
      toast({
        title: "⚠️ Campo requerido",
        description: "El nombre de la institución es obligatorio",
        variant: "destructive",
      });
      return;
    }

    try {
      // Subir logo si hay archivo seleccionado
      let logo_url = formData.logo_url;
      if (logoFile) {
        setUploadingLogo(true);
        try {
          const fd = new FormData();
          fd.append("file", logoFile);
          const resp = await fetch("/api/uploads/instituciones-financieras", {
            method: "POST",
            credentials: "include",
            body: fd,
          });
          const json = await resp.json();
          if (json?.ok && json?.data?.logo_url) {
            logo_url = json.data.logo_url;
          }
        } catch (uploadErr) {
          console.warn("No se pudo subir el logo, se continuará sin imagen:", uploadErr);
        } finally {
          setUploadingLogo(false);
        }
      }

      const nuevaInstitucion = await crearInstitucion.mutateAsync({
```

Y dentro de `crearInstitucion.mutateAsync({...})`, busca la lista de campos:
```typescript
        notas: formData.notas.trim(),
      });
```

Reemplaza por:
```typescript
        notas: formData.notas.trim(),
        logo_url,
      });
```

### 8f — Agregar UI del campo logo en el Dialog

Busca el primer bloque de campos del dialog (el grid de Nombre + Alias):
```typescript
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="nombre">Nombre de la Institución *</Label>
                <Input
                  id="nombre"
                  value={formData.nombre}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, nombre: e.target.value }))
                  }
                  placeholder="Ej: BBVA"
                />
              </div>
```

INMEDIATAMENTE ANTES de ese bloque (como primer hijo de `<div className="space-y-4">`), inserta:
```typescript
            {/* Logo de la institución */}
            <div className="space-y-2">
              <Label htmlFor="logo_file">Logo de la Institución</Label>
              <div className="flex items-center gap-3">
                {logoPreview ? (
                  <Avatar className="h-12 w-12 shrink-0">
                    <AvatarImage src={logoPreview} />
                    <AvatarFallback className="text-sm">
                      {formData.nombre?.[0] || "I"}
                    </AvatarFallback>
                  </Avatar>
                ) : (
                  <Avatar className="h-12 w-12 shrink-0">
                    <AvatarFallback className="text-sm">
                      {formData.nombre?.[0] || "I"}
                    </AvatarFallback>
                  </Avatar>
                )}
                <Input
                  id="logo_file"
                  type="file"
                  accept="image/*"
                  className="cursor-pointer"
                  onChange={(e) => {
                    const file = e.target.files?.[0] ?? null;
                    setLogoFile(file);
                    if (file) {
                      const reader = new FileReader();
                      reader.onload = (ev) => setLogoPreview(ev.target?.result as string ?? "");
                      reader.readAsDataURL(file);
                    } else {
                      setLogoPreview("");
                    }
                  }}
                />
              </div>
              <p className="text-xs text-muted-foreground">Imagen PNG, JPG o SVG. Máx 5 MB.</p>
            </div>
```

### 8g — Deshabilitar botón "Crear" durante upload de logo

Busca:
```typescript
              <Button onClick={handleCreate} disabled={crearInstitucion.isPending}>
                {crearInstitucion.isPending ? "Creando..." : "Crear Institución"}
              </Button>
```

Reemplaza por:
```typescript
              <Button onClick={handleCreate} disabled={crearInstitucion.isPending || uploadingLogo}>
                {uploadingLogo ? "Subiendo logo..." : crearInstitucion.isPending ? "Creando..." : "Crear Institución"}
              </Button>
```

---

## Verificación

```bash
# Backend: verificar sintaxis de los archivos modificados
node --check backend/routes/uploadsGeneral.js
node --check backend/server.js
node --check backend/routes/productos.js
node --check backend/models/Product.js
node --check backend/routes/productosEgresos.js
node --check backend/routes/institucionesFinancieras.js

# Frontend
cd bukipin-dashboard && npx tsc --noEmit 2>&1 | head -30
```

Si algún check falla, revisar y corregir antes de continuar.

---

## Efecto esperado después del fix

| Panel | Ruta upload | Resultado |
|---|---|---|
| CAPEX / Inversiones | `POST /api/uploads/activos` | ✅ Guarda en `/public/uploads/activos/` |
| Inventario Productos | `POST /api/uploads/product-image` | ✅ Guarda en `/public/uploads/productos/` |
| Comprobantes de Egresos | `POST /api/uploads/comprobante-egreso` | ✅ Guarda en `/public/uploads/comprobantes/` |
| Instituciones Financieras | `POST /api/uploads/instituciones-financieras` | ✅ Guarda en `/public/uploads/instituciones-financieras/` |
| Expense Products | `POST /api/productos-egresos` (multipart) | ✅ Ya funciona |
| Autoridades Fiscales | `POST /api/uploads/autoridades-fiscales/logo` | ✅ Ya funciona |
| Registro Ingresos | `POST /api/uploads/product-image` (vía useProductos) | ✅ Cubierto por Cambio 1 |

Las imágenes quedan disponibles en `https://bukipin.com/uploads/<carpeta>/<filename>` gracias al
middleware `express.static("public")` ya configurado en `server.js`.

---

## Nota sobre Render.com

Los archivos subidos a `/public/uploads/` persisten mientras el server no se redeploy.
En Render con **Persistent Disk** habilitado, los archivos sobreviven. Si el cliente reporta que
las imágenes desaparecen tras un redeploy, el siguiente paso sería migrar a Cloudinary o AWS S3.
Por ahora, con el disco efímero de Render el upload funciona durante la sesión del servidor.
