# Mapa de LICYCOLBA — endpoints propios e integraciones consumidas

> Generado por inspección del código en `main` (commit `1c8a68e`).
> Cifras verificadas: **144 archivos `route.ts`** bajo `src/app/api/**` (excluyendo `*.test.ts`),
> **4 endpoints públicos v1**, **7 servicios externos consumidos**, **4 jobs cron internos**.

---

## 1. Vista general

Aplicación **Next.js 16 (App Router)** monolítica: un único front (`src/app/page.tsx`, 44.428 líneas,
`'use client'`) que habla exclusivamente con las rutas `/api/*` del mismo despliegue. Toda la lógica de
negocio vive en `src/lib/**` y se consume desde los route handlers.

```
NAVEGADOR
  src/app/page.tsx  (SPA monolítica)  +  src/components/**
        |
        |  fetch('/api/...')   ·   cookie licy_session
        v
src/proxy.ts   (middleware Next 16, matcher /api/:path*)
  · verifica HMAC-SHA256 del token licy_session
  · sliding expiration 40 min (re-firma la cookie en cada request)
  · bypass: /api/public/*, /api/auth/login, /api/auth/logout, /api/uploadthing
  · bypass N8N (Bearer N8N_SYNC_TOKEN) SOLO en /api/lectura/rag/ingestar
        |
        v
144 route handlers   src/app/api/**/route.ts
  guard adicional en handler: getSession + requireAdmin / requireAdminOrN8N /
  requireEditarCostos / requireNoMercadeo / hasPermiso / autenticarApiKey
        |
        +--> PostgreSQL       (Prisma 7, DATABASE_URL)
        +--> Data API procesos (DATA_API_BASE_URL / DATA_API_KEY)
        +--> ERP Grupo Colba  (Laravel, grupocolba.com/service/public)
        +--> datos.gov.co     (TRM)
        +--> Google AI        (Gemini + embeddings + Document AI)
        +--> Anthropic        (Claude)
        +--> UploadThing      (CDN de archivos)
```

### Capas de autenticación (3 esquemas distintos)

| Esquema | Dónde | Mecanismo | Consumidor |
|---|---|---|---|
| `licy_session` | todas las `/api/*` salvo bypass | Cookie httpOnly, payload base64url + HMAC-SHA256 (`SESSION_SECRET`), `sv` (sessionVersion) revalidado contra BD en `getSession` | SPA propia |
| `Authorization: Bearer <N8N_SYNC_TOKEN>` | `/api/lectura/rag/ingestar` (proxy) + `requireAdminOrN8N` en handlers de sync | comparación literal del header | automatizaciones N8N / cron externo |
| `X-API-Key: lcb_<12hex>_<40hex>` | `/api/public/v1/**` | SHA-256 + `timingSafeEqual` contra `api_clients.apiKeyHash`, scopes, empresas permitidas, rate limit por minuto en memoria | terceros |

> **Importante:** los ~19 handlers que no invocan ningún guard interno (`/api/procesos/gestionados`,
> `/api/solicitudes/dashboard`, `/api/dotacion-ext`, …) **no son públicos**: siguen exigiendo
> `licy_session` en `src/proxy.ts`. La ausencia de guard significa solo "cualquier rol autenticado".

---

## 2. Endpoints propios — inventario por dominio

Leyenda de guard: `sesión` = solo proxy · `admin` = `requireAdmin` · `admin|n8n` = `requireAdminOrN8N` ·
`api-key` = `autenticarApiKey`.

### 2.1 `procesos` — 23 rutas (el dominio más grande)

| Ruta | Métodos | Guard | Consume fuera |
|---|---|---|---|
| `/api/procesos` | GET | sesión | — (Postgres) |
| `/api/procesos/nuevos` | GET | sesión | — |
| `/api/procesos/sin-gestionar` | GET | sesión | — |
| `/api/procesos/gestionados` | GET | sesión | — |
| `/api/procesos/insertar` | POST | sesión | — |
| `/api/procesos/buscar-colba` | GET | sesión | — |
| `/api/procesos/filtros/departamentos` | GET | sesión | — |
| `/api/procesos/detalle-unspsc` | GET | sesión | — (ya migrado: solo caché en BD, 409 `migrado` si falta) |
| `/api/procesos/sync` | GET·POST·PUT | admin\|n8n | **Data API** (`/v1/sync/procesos`, `/v1/procesos/:id/resolver-link`) |
| `/api/procesos/sync-profundo` | GET | admin\|n8n | **Data API** (full resync rotativo por página) |
| `/api/procesos/actualizar-ficha` | PUT | sesión | **Data API** (`/v1/procesos/:id/actualizar`) |
| `/api/procesos/actualizar-cronograma` | POST | admin\|n8n | **Data API** |
| `/api/procesos/actualizar-documentos` | POST | admin\|n8n | **Data API** |
| `/api/procesos/resolver-link-detalle` | POST | `N8N_SYNC_TOKEN` | **Data API** |
| `/api/procesos/[id]/documentos` | GET | sesión | — |
| `/api/procesos/[id]/adendas` | GET | sesión | — |
| `/api/procesos/[id]/limpiar-docs` | DELETE | sesión | — |
| `/api/procesos/[id]/reclasificar-docs` | GET·POST | admin | — |
| `/api/procesos/[id]/no-viable` | PATCH | sesión + `hasPermiso` | — |
| `/api/procesos/[id]/analisis-economico` | GET·POST·PATCH | sesión | — |
| `/api/procesos/[id]/analisis-economico/[docId]/analizar` | POST | sesión | **Gemini** (`gemini-economico.ts`) |
| `/api/procesos/[id]/analisis-economico/conjunto/[conjuntoId]` | PATCH | sesión | — |
| `/api/procesos/[id]/analisis-economico/regla/[reglaId]` | PATCH | sesión | — |

### 2.2 `solicitudes` — 17 rutas (flujo de gestión y SQR)

| Ruta | Métodos | Guard | Consume fuera |
|---|---|---|---|
| `/api/solicitudes` | GET·POST·PATCH·DELETE | sesión (+`canAccessSolicitud`) | **ERP Colba** `POST /api/sqr` (abre la SQR al crear solicitud) |
| `/api/solicitudes/[id]` | GET·PATCH | sesión + admin | — |
| `/api/solicitudes/[id]/cerrar` | POST | sesión | **ERP Colba** `POST /api/sqr/cerrar` (multipart con soporte) |
| `/api/solicitudes/cerrar-sqr` | POST | sesión | **ERP Colba** `POST /api/sqr/cerrar` |
| `/api/solicitudes/[id]/transicion` | POST | sesión | — |
| `/api/solicitudes/[id]/observaciones` | POST | sesión | — |
| `/api/solicitudes/[id]/seguimiento` | POST·PATCH·DELETE | sesión | — |
| `/api/solicitudes/[id]/finalizar-revision` | POST | sesión | — |
| `/api/solicitudes/[id]/reenviar-revision` | POST | sesión | — |
| `/api/solicitudes/[id]/documentos/descargar-todo` | GET | sesión | descarga blobs de **UploadThing / storage Colba** y los empaqueta con `archiver` |
| `/api/solicitudes/dashboard` | GET | sesión | — |
| `/api/solicitudes/resumen` | GET | sesión | — |
| `/api/solicitudes/mis-asignaciones` | GET | sesión | — |
| `/api/solicitudes/gestionados-ids` | GET | sesión | — |
| `/api/solicitudes/siguiente-numero` | GET | sesión | — |
| `/api/solicitudes/indicadores-financieros` | GET | sesión | — |
| `/api/solicitudes/rag-indexar` | POST | admin | `pdf-parse` + `mammoth` + **embeddings Gemini** |

### 2.3 `lectura` — 17 rutas (análisis IA de pliegos + RAG)

| Ruta | Métodos | Guard | Consume fuera |
|---|---|---|---|
| `/api/lectura/analizar` | POST | sesión | **Gemini** |
| `/api/lectura/analizar-unico` + `/estado` | POST / GET | sesión | **Gemini** (patrón job + polling de estado) |
| `/api/lectura/analizar-proceso-completo` + `/estado` | POST / GET | sesión | **Gemini** |
| `/api/lectura/analizar-profundo` | POST | sesión | **Gemini** + `mammoth` |
| `/api/lectura/formato-docs` | POST | sesión | descarga documentos externos |
| `/api/lectura/pdf` | GET | sesión | proxy de `urlDocumento` guardada en BD (SSRF mitigado: la URL no viene del request) |
| `/api/lectura/export-pdf` | POST | sesión | **Puppeteer** (Chromium headless local) |
| `/api/lectura/historial` | GET | sesión | — |
| `/api/lectura/consumo` | GET | sesión | — |
| `/api/lectura/checklist` | PATCH | sesión | — |
| `/api/lectura/trazabilidad` | PATCH | sesión | — |
| `/api/lectura/rag/ingestar` | POST | admin\|n8n | `pdf-parse` + **embeddings Gemini** |
| `/api/lectura/rag/preguntar` | POST | sesión | **Gemini** + pgvector |
| `/api/lectura/rag/documentos` + `/[id]` | GET / DELETE | sesión / admin | — |

El pipeline de extracción (`src/lib/lectura/pipeline/`) detecta tipo de archivo y enruta a
`extraer-pdf-texto` (pdfjs-dist), `extraer-excel` (exceljs), `extraer-word` (mammoth) o
`extraer-pdf-ocr` → **Google Document AI** cuando `detectar-pdf-escaneado` da positivo.

### 2.4 `admin` — 11 rutas

`audit-log` (GET) · `conocimiento` (GET·POST) y `conocimiento/[id]` (PUT·DELETE) → regeneran
**embeddings Gemini** · `memories` (GET·POST) y `memories/[id]` (PATCH·DELETE) ·
`gemini/limpiar-pii` (POST) · `lectura/limpiar-blobs` (POST) · `normalizar-perfiles` (POST) ·
`proceso-raw` (GET) · `proceso-recalcular-fecha` (POST) · `resolver-links-batch` (GET → **Data API**).
Todas `requireAdmin` salvo `memories*` (solo sesión).

### 2.5 Costos y mano de obra — 10 rutas

`costos-estructura` (GET·POST), `costos-estructura/[id]` (GET·PUT·DELETE, admin),
`costos-estructura/[id]/exportar` (POST, **exceljs**), `.../exportar-mano-obra` (POST),
`costos/mano-obra/[id]` (GET·PATCH), `.../estado` (POST), `.../recalcular` (POST),
`costos/alertas/[alertaId]` (PATCH), `costos/preguntas/[pregId]` (PATCH),
`costos/analizar-requisito` (POST → **Gemini + Anthropic**, único endpoint con los dos proveedores).
La escritura usa `requireEditarCostos` (admin o Equipo Comercial).

### 2.6 Proxies al ERP Grupo Colba — 10 rutas

Estas rutas existen únicamente para que el navegador no llame al ERP directamente:

| Ruta | Métodos | Destino ERP | Cómo |
|---|---|---|---|
| `/api/cargos` | GET | `POST /api/cargos` | `AbortSignal.timeout` |
| `/api/horarios` | GET·POST·PUT·DELETE | `POST /api/turnos`, `/turnos/obtener`, `/turnos/crear` | admin; timeout explícito |
| `/api/dotacion-ext` | POST | `POST http://…/api/dotacion` | **HTTP plano** |
| `/api/epp-ext` | POST | `POST http://…/api/epp` | **HTTP plano** |
| `/api/insumos-ext` | POST | `POST http://…/api/insumos` (`{empresa, uen}`) | **HTTP plano** |
| `/api/equipos-ext` | GET·POST | `POST http://…/api/equipos` | **HTTP plano** |
| `/api/equipos-especializados-ext` | GET | `GET http://…/api/equipos/obtener_espec` | **HTTP plano** |
| `/api/servicios-no-continuos-ext` | POST | `POST /api/no_continuos` (`{empresa}`) | vía `servicios-no-continuos-buscar.ts` |
| `/api/examenes` · `/api/examenes/por-grupo` | GET / POST | `GET /api/examenes` | caché en `examenes-cache.ts` |
| `/api/cursos` · `/api/cursos/grupos` | POST | `POST /api/cursos`, `/api/grupo_cursos` | caché en `cursos-cache.ts` |

> ⚠️ Cinco de estas rutas llaman al ERP por **`http://`** (`dotacion`, `epp`, `insumos`, `equipos`,
> `equipos/obtener_espec`) mientras el resto del código usa `https://` contra el mismo host.

### 2.7 `equipos-activos` — 5 rutas

`equipos-activos` (POST), `/grupos` (POST), `/subtipos` (POST), `/mantenimiento` (POST),
`/sincronizar` (POST·GET, `admin|n8n`). `sincronizar` recorre en cadena
`grupo_activo → subtipo_activo → equipos/obtener` del ERP y persiste una **réplica local versionada**
(`EquipoActivoCatalogoSync` / `EquipoActivoCatalogo`); responde de inmediato y trabaja
fire-and-forget, el avance se consulta por GET.

### 2.8 Resto

- **`auth`** (4): `login` (POST), `logout` (POST), `permisos` (GET), `set-password` (POST). Las dos
  primeras están en el bypass del proxy; `login` usa rate limit persistente en Postgres.
- **`users`** (5) + `roles` (1) + `deleted-users` (1) + `deleted-solicitudes` (1): todas `requireAdmin`
  salvo `users/asignables` y `users/cambiar-password`.
- **`colba`** (4): `preguntar` (POST → **Gemini**, con `detectarIntentWeb` + memoria + base de
  conocimiento), `empresa` (GET·POST·DELETE, admin), `stats` (GET), `usage` (GET, admin).
- **`licy/chat`** (POST → **Gemini**), **`ai/analizar-turno`** (POST → **Anthropic**),
  **`ai/anthropic/test`** (POST → **Anthropic**, diagnóstico de clave/modelo).
- **`trm`** (2): `/api/trm` (GET) y `/api/trm/proyeccion-decimal` (GET), ambas con `requireNoMercadeo`
  → **datos.gov.co**.
- **`ponderacion`** (3) + **`simulaciones/ponderacion`** (2) + **`simulacion/sugerir`** (1):
  `extract-from-document` y `sugerir` usan **Gemini**; el acceso a simulaciones se filtra por
  `canAccessSimulacionPonderacion` (creador / empresa / permiso `sim_ver_consolidado`).
- **`docs`** (5): maestro de documentos, proxy a **Laravel Colba** `api/documentos` + `public/storage/`;
  `docs/analizar` usa **Gemini** + `pdf-parse`.
- **`notificaciones`** (5): `route` (GET·PATCH·POST), `[id]` (PATCH), `sync` (GET),
  `limpiar` (POST, admin), `alertas-manifestacion` (GET·POST).
- **`upload`** (POST) y **`uploadthing`** (GET·POST): el segundo es el route handler de UploadThing;
  su `middleware` exige `licy_session` y devuelve `file.ufsUrl`.
- **`pdf-proxy`** (GET): proxy genérico de PDFs con sesión + `validarUrlProxied`.
- **`secop/detalle`** (POST): exige que la URL contenga `community.secop.gov.co` y delega en la
  **Data API** (`obtenerDetallePublico`).
- **`config/runtime`** (GET), **`informes/procesos-adjudicados`** (GET),
  **`mantenimiento-equipos`** (GET), **`servicios-no-continuos-tarifas`** (GET).

---

## 3. Endpoints que LICYCOLBA expone a terceros — API pública v1

Base: `/api/public/v1/procesos/indicadores`. Solo lectura, JSON, `X-API-Key` obligatoria en header
(nunca en query). Contrato detallado en [`docs/api-publica-indicadores-procesos.md`](api-publica-indicadores-procesos.md).

| Endpoint | Scope | Devuelve |
|---|---|---|
| `GET /resumen` | `procesos:indicadores:read` | agregados + `porcentajePresentacion` |
| `GET /mensual` | `procesos:indicadores:read` | serie por mes |
| `GET /anual` | `procesos:indicadores:read` | serie por año |
| `GET /detalle` | `procesos:detalle:read` | filas paginadas |

Filtros en whitelist (`anio`, `mes`, `fechaDesde/Hasta`, `fechaReferencia`, `empresa`, `fuente`,
`departamento`, `modalidad`, `categoria`, `responsable`); cualquier otro → 400 `filtro_invalido`.
Errores normalizados: 401 `clave_ausente`/`clave_invalida`, 403 `clave_deshabilitada`/`clave_expirada`/
`scope_insuficiente`, 429 `rate_limit`, 503 `api_deshabilitada` (`PUBLIC_API_ENABLED=false`).
Toda respuesta lleva `meta.requestId` (UUID) y `meta.generatedAt`.

---

## 4. Integraciones consumidas — detalle de "cómo"

### 4.1 Data API de procesos (`DATA_API_BASE_URL`) — única vía de adquisición

Cliente: [`src/lib/data-api/cliente.ts`](../src/lib/data-api/cliente.ts). **No hay scraping ni fetch
directo a SECOP en runtime.**

| Operación del cliente | Llamada HTTP |
|---|---|
| `sincronizarProcesos({cursor, limite})` | `GET /v1/sync/procesos?cursor=&limite=` |
| `actualizarFicha(id)` | `POST /v1/procesos/:id/actualizar` |
| `resolverLinkDetalle(id)` | `POST /v1/procesos/:id/resolver-link` |
| `salud()` | `GET /v1/salud` |
| `descargarDocumento(id, docId)` | `GET /v1/procesos/:id/documento/:docId/descargar` (binario) |

Cómo lo hace:

- Headers `X-API-Key: DATA_API_KEY` + `X-Contract-Version` (versión validada contra
  `CONTRATO_VERSIONES_SOPORTADAS`; la clave **nunca** viaja en query string).
- `AbortController` con `DATA_API_TIMEOUT_MS` (default 10 s).
- **Ningún error crudo se propaga**: todo sale como `ErrorCanonico {codigo, mensaje, reintentar}`;
  mensajes truncados a 300 caracteres, sin stack traces ni nombres de proveedor (hay un
  `contrato-guardrail.test.ts` que lo verifica). Mapeo por status: 401/403 → `NO_AUTORIZADO`,
  410 → `CURSOR_EXPIRADO`, 429 → `LIMITE_EXCEDIDO` (reintentable), ≥500 → `NO_DISPONIBLE`.
- Acceso siempre a través de `fachadaSync` (`src/lib/data-api/sync/fachadaSync.ts`), que consulta
  `modoSyncRuntime()`: con `SYNC_RUNTIME_MODE != 'data-api'` devuelve `{estado:'deshabilitado'}` y
  los handlers responden **503**, sin tocar la red.
- Exclusión mutua doble en el runner: bandera in-process + `pg_advisory_lock`.
- Operaciones ya retiradas lanzan `OperacionMigradaDataApiError` → 409/410 `migrado`.

### 4.2 ERP Grupo Colba (Laravel, `grupocolba.com/service/public`)

Sin variable de entorno: **URLs hardcodeadas** y **sin credenciales** en el código.

| Recurso | Método | Consumidor en el repo |
|---|---|---|
| `api/sqr` | POST `{objeto}` | `abrirSqr` en `api/solicitudes/route.ts` |
| `api/sqr/cerrar` | POST `multipart` (`novedad_id`, `observacion`, `estadoFinalSqr` `'1'`/`'0'`, `soporte`) | `lib/solicitudes/cerrar-sqr-externo.ts` |
| `api/cargos` | POST | `api/cargos/route.ts` |
| `api/turnos`, `/obtener`, `/crear` | POST | `api/horarios/route.ts` |
| `api/dotacion`, `api/epp` | POST | `api/dotacion-ext`, `api/epp-ext` |
| `api/insumos` | POST `{empresa, uen}` | `api/insumos-ext`, `lib/costos-estructura/calculo-insumos.ts` |
| `api/equipos`, `api/equipos/obtener`, `api/equipos/obtener_espec` | POST / GET | `api/equipos-ext`, `lib/equipos-activos-*.ts` |
| `api/grupo_activo`, `api/subtipo_activo` | POST | `lib/equipos-activos-cache.ts` |
| `api/no_continuos` | POST `{empresa}` | `lib/servicios-no-continuos-buscar.ts` |
| `api/examenes` | GET | `lib/examenes-cache.ts` |
| `api/cursos`, `api/grupo_cursos` | POST | `lib/cursos-cache.ts` |
| `api/documentos`, `public/storage/` | POST / GET | `api/docs/**` |

Cómo lo hace: `fetch` con `AbortSignal.timeout(TIMEOUT_MS)` en las rutas de catálogo
(el host externo puede colgarse en DNS), `cache: 'no-store'` en las de SQR, cachés en memoria por
módulo (`*-cache.ts`) y réplica persistente versionada para equipos activos. El cierre de SQR
serializa `estadoFinalSqr` con comparación estricta y **rechaza el cierre** si el valor es
`null`/`undefined`, en vez de enviar `'0'`.

### 4.3 datos.gov.co — TRM

`src/lib/trm/trmFetchDatosGov.ts` → `GET https://www.datos.gov.co/resource/32sa-8pi3.json?$limit=N&$order=vigenciahasta DESC`,
`cache: 'no-store'`, sin autenticación. Expande rangos de vigencia a un mapa día→valor y propaga el
último valor conocido hasta hoy. Cadena de resolución en `trmService.ts`:
**caché en BD (`trm_historico`) → fetch datos.gov.co → fallback último valor conocido**.

### 4.4 Google

| Servicio | SDK / transporte | Clave | Usos |
|---|---|---|---|
| **Gemini** (generación) | `@google/generative-ai` | `GOOGLE_AI_API_KEY` \| `GEMINI_API_KEY` | 12 rutas: lectura (5), `colba/preguntar`, `licy/chat`, `docs/analizar`, `ponderacion/extract-from-document`, `simulacion/sugerir`, análisis económico, `costos/analizar-requisito` |
| **Gemini embeddings** | mismo SDK | idem | `lib/embeddings.ts` — `gemini-embedding-001`, 3072 dims, texto truncado a 8.000 chars; se guardan en pgvector |
| **Document AI (OCR)** | `fetch` REST + `google-auth-library` | `GOOGLE_APPLICATION_CREDENTIALS_JSON` (JSON o base64) → token OAuth scope `cloud-platform` | `lib/lectura/extractors/extraer-pdf-ocr.ts` → `POST https://{LOCATION}-documentai.googleapis.com/v1/projects/{PROJECT}/locations/{LOC}/processors/{PROC}:process` con `rawDocument.content` base64, por lotes de páginas |

### 4.5 Anthropic

`@anthropic-ai/sdk` en `src/lib/ai/providers/anthropicProvider.ts`: cliente singleton,
`ANTHROPIC_MODEL` (default `claude-haiku-4-5`), `timeout` = `ANTHROPIC_TIMEOUT`×1000 (default 45 s),
`maxRetries: 1`, recorte de entrada a `ANTHROPIC_MAX_INPUT_CHARS`. Los errores del SDK se traducen a
códigos estables (`clave_invalida`, `modelo_no_autorizado`, `saldo_insuficiente`, `rate_limit`,
`timeout`, `error_red`) — nunca se devuelve la respuesta cruda. Consumidores: `ai/analizar-turno`,
`ai/anthropic/test`, `costos/analizar-requisito`. `aiProviderFactory.ts` elige proveedor según
`AI_DEFAULT_PROVIDER`; el código legado sigue llamando a Gemini directamente.

### 4.6 UploadThing

`api/uploadthing/route.ts` (`createRouteHandler`) + `core.ts`: file router `documentoPDF`,
solo `pdf`, máx. 128 MB, `middleware` que exige `licy_session` (si no hay sesión, lanza y el upload se
rechaza) y devuelve `{url: file.ufsUrl, name, key}`. En el cliente, `lib/uploadthing.ts` genera
`UploadButton`/`UploadDropzone`. La CSP de `next.config.ts` abre `connect-src` a
`uploadthing.com`, `*.uploadthing.com`, `utfs.io`, `*.utfs.io`.

### 4.7 Descarga genérica de documentos (SSRF)

`src/lib/ssrf-guard.ts`, dos niveles:

- `validarUrlAntiSSRF` — rutas con sesión: bloquea loopback, RFC-1918, link-local,
  `169.254.169.254`, `metadata.google.internal`, IPv6 `::1`/`fc`/`fd`, y **cualquier IP literal**
  (los documentos legítimos usan nombre de host).
- `validarUrlProxied` — `/api/pdf-proxy`: lo anterior **+ allowlist de dominios**
  (`community.secop.gov.co`, `*.contratos.gov.co`, `secop.gov.co`, `colombiacompra.gov.co`,
  `grupocolba.com`, `utfs.io`), extensible con `ALLOWED_DOCUMENT_HOSTS`, y exige HTTPS.

Las descargas usan `User-Agent: Mozilla/5.0 (compatible; LicycolbaBot/1.0)` y
`AbortSignal.timeout(30_000)`.

---

## 5. Jobs programados (`src/instrumentation.ts`)

Scheduler `node-cron` **dentro del proceso Next.js**, TZ `America/Bogota`, con guardia de registro
único (`schedulerRegistrado`) para no apilar cron en recargas de dev.

| Job | Cron (override) | Condición | Qué hace |
|---|---|---|---|
| Sync principal | `*/5 * * * *` (`SYNC_CRON`) | **solo** `modoSyncRuntime() === 'data-api'` | `ejecutarJobSyncProcesos({profundo:false})` |
| Sync profundo | `0 4 * * *` (`SYNC_PROFUNDO_CRON`) | idem | `ejecutarJobSyncProcesos({profundo:true})` |
| Limpiar notificaciones | `0 3 * * *` (`SYNC_LIMPIAR_CRON`) | siempre | borra notificaciones leídas > 30 días |
| TRM diario | `30 7,18 * * *` (`TRM_CRON`) | siempre | `jobTrmDiario()` — histórico + recalibración del modelo |

Además, `GET /api/procesos/sync` y `GET /api/procesos/sync-profundo` están diseñados para cron
**externo** (Hostinger Cron Jobs / N8N con Bearer): el primero rota un ciclo de 16 batches × 10 páginas
por ventanas de 4 h; el segundo calcula la página por día dentro de un ciclo de 50.

---

## 6. Matriz endpoint → servicio externo

| Servicio externo | Rutas que lo consumen |
|---|---|
| **Data API procesos** | `procesos/sync`, `procesos/sync-profundo`, `procesos/actualizar-ficha`, `procesos/actualizar-cronograma`, `procesos/actualizar-documentos`, `procesos/resolver-link-detalle`, `secop/detalle`, `admin/resolver-links-batch` |
| **ERP Grupo Colba** | `solicitudes` (POST), `solicitudes/[id]/cerrar`, `solicitudes/cerrar-sqr`, `cargos`, `horarios`, `docs/**`, `dotacion-ext`, `epp-ext`, `insumos-ext`, `equipos-ext`, `equipos-especializados-ext`, `equipos-activos/**`, `servicios-no-continuos-ext`, `examenes/**`, `cursos/**` |
| **datos.gov.co** | `trm`, `trm/proyeccion-decimal` (+ cron TRM) |
| **Gemini** | `lectura/analizar`, `lectura/analizar-unico`, `lectura/analizar-proceso-completo`, `lectura/analizar-profundo`, `lectura/rag/preguntar`, `colba/preguntar`, `licy/chat`, `docs/analizar`, `ponderacion/extract-from-document`, `simulacion/sugerir`, `procesos/[id]/analisis-economico/[docId]/analizar`, `costos/analizar-requisito` |
| **Gemini embeddings** | `admin/conocimiento`, `admin/conocimiento/[id]`, `lectura/rag/ingestar`, `solicitudes/rag-indexar` |
| **Google Document AI** | rutas de `lectura/*` cuando el PDF se detecta escaneado |
| **Anthropic** | `ai/analizar-turno`, `ai/anthropic/test`, `costos/analizar-requisito` |
| **UploadThing** | `uploadthing`, `upload`, `solicitudes/[id]/documentos/descargar-todo` |
| **Hosts arbitrarios (allowlist)** | `pdf-proxy`, `lectura/pdf`, `lectura/formato-docs` |

---

## 7. Control de consumo de IA

- **Rate limit diario por endpoint** en `src/lib/rate-limit.ts`, persistido en Postgres (fail-open con
  log si la BD no responde): `analizar` 20 · `profundo` 10 · `completo` 5 · `chat` 100 · `rag` 100 ·
  `colba` 100 · `costos` 20 · `turno` 50 · `anthropic_test` 20.
- **Rate limit de login**: 5 intentos / 15 min por IP y por email.
- **Contabilidad de uso**: `lib/ai/aiUsage.ts` y `lib/gemini-usage.ts`, expuesta en
  `GET /api/colba/usage` (admin) y `GET /api/lectura/consumo`.
- `POST /api/admin/gemini/limpiar-pii` purga PII de los registros de uso.

---

## 8. Variables de entorno por integración

| Integración | Variables |
|---|---|
| Base de datos | `DATABASE_URL` |
| Sesión | `SESSION_SECRET` |
| Data API | `DATA_API_BASE_URL`, `DATA_API_KEY`, `DATA_API_TIMEOUT_MS`, `DATA_API_RUNTIME_ENABLED`, `DATA_API_RUNTIME_DATABASE_URL`, `SYNC_RUNTIME_MODE` |
| Automatizaciones | `N8N_SYNC_TOKEN` |
| Cron | `SYNC_CRON`, `SYNC_PROFUNDO_CRON`, `SYNC_LIMPIAR_CRON`, `TRM_CRON`, `TZ` |
| Gemini | `GOOGLE_AI_API_KEY`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `GOOGLE_API_KEY` |
| Anthropic | `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `ANTHROPIC_TIMEOUT`, `ANTHROPIC_MAX_INPUT_CHARS`, `ANTHROPIC_DEFAULT_MAX_TOKENS` |
| Selector IA | `AI_DEFAULT_PROVIDER` |
| Document AI | `DOCUMENT_AI_ENABLED`, `DOCUMENT_AI_OCR_PROCESSOR_ID`, `DOCUMENT_AI_MAX_INLINE_MB`, `DOCUMENT_AI_MAX_INLINE_PAGES`, `GOOGLE_APPLICATION_CREDENTIALS_JSON`, `GOOGLE_CLOUD_PROJECT_ID`, `GOOGLE_CLOUD_LOCATION` |
| API pública | `PUBLIC_API_ENABLED`, `PUBLIC_API_RATE_LIMIT_DEFAULT` |
| Descargas | `ALLOWED_DOCUMENT_HOSTS` |

El ERP Grupo Colba y datos.gov.co **no tienen variable de entorno** — sus URLs están en el código.

---

## 9. Observaciones del mapeo

1. **`page.tsx` de 44.428 líneas** concentra la SPA completa y ~110 llamadas `fetch('/api/...')`
   distintas; no hay capa de cliente API tipada.
2. **Cinco proxies al ERP usan `http://`** (`dotacion`, `epp`, `insumos`, `equipos`,
   `equipos/obtener_espec`) contra el mismo host que el resto consume por `https://`.
3. **`/api/procesos/resolver-link-detalle` se autentica solo con `N8N_SYNC_TOKEN`** leído en el
   handler; a diferencia de `/api/lectura/rag/ingestar`, esa ruta no está en `RUTAS_TOKEN_N8N` del
   proxy, así que en la práctica exige además `licy_session`.
4. El rate limit de la **API pública vive en memoria del proceso** — documentado como limitación: al
   escalar horizontalmente hay que migrarlo a Postgres/Redis.
5. `src/lib/authz.ts` contiene una **excepción por nombre de usuario** (`USUARIOS_EDITAR_MAESTRO_DOCS`
   = `nicole.ortiz`) en lugar de un permiso funcional en `PerfilRol`.
