# LICYCOLBA

Sistema de gestión de licitaciones y procesos contractuales del Grupo Colba
(Next.js 16 · App Router · Prisma · PostgreSQL · TypeScript).

---

## Arquitectura de adquisición de procesos

La adquisición / sincronización de procesos no forma parte de este repositorio.
La aplicación la delega en un **servicio de datos de procesos** HTTP y
autenticado, cuyo endpoint y clave se configuran por entorno
(`DATA_API_BASE_URL`, `DATA_API_KEY`).

```
┌──────────────────┐   HTTP autenticado    ┌───────────────────────────────┐
│  esta aplicación │ ────────────────────► │  servicio de datos de procesos │
│   (este repo)    │   DATA_API_BASE_URL   │   (configurado por entorno)    │
│                  │   DATA_API_KEY        │                               │
└──────────────────┘                       └───────────────────────────────┘
```

- El endpoint y la clave del servicio se aportan por entorno.
- **El frontend/backend entregado NUNCA accede directamente a la fuente pública
  de procesos.** No hay scraping, ni fetch directo a la fuente, ni pipeline
  legacy de adquisición en el runtime. La única vía de adquisición es el
  servicio configurado por entorno.
- La aplicación sí usa una conexión directa a PostgreSQL (`DATABASE_URL`) para su
  propio dominio: solicitudes, notificaciones, usuarios, configuración, análisis
  de costos, etc. La adquisición de procesos es lo único que pasa por el
  servicio de datos.
- Por defecto la adquisición está **apagada** (`DATA_API_RUNTIME_ENABLED=false`,
  `SYNC_RUNTIME_MODE=disabled`). Al clonar y arrancar, la aplicación opera en
  modo lectura para procesos y no inicia ningún job de sincronización.

---

## Requisitos

- Node.js **>= 20.19.0**
- PostgreSQL 14+ accesible por `DATABASE_URL`
- npm

## Puesta en marcha

```bash
# 1. Dependencias
npm install

# 2. Variables de entorno
cp .env.example .env
#   Editar .env y completar al menos DATABASE_URL y SESSION_SECRET.
#   Las variables de la Data API solo son necesarias si se va a activar
#   la adquisición de procesos (ver más abajo).

# 3. Cliente Prisma
npx prisma generate

# 4. Esquema de base de datos
npx prisma migrate deploy      # aplica prisma/migrations/ a la BD de DATABASE_URL

# 5. Build de producción
npm run build

# 6. Arranque
npm start                      # sirve en http://localhost:3000
```

Desarrollo local: `npm run dev`.

Pruebas: `npm test` (Vitest).

---

## Variables de entorno

Ver [`.env.example`](.env.example) para la lista completa con comentarios. Grupos:

| Grupo | Variables | Notas |
|---|---|---|
| Base de datos | `DATABASE_URL` | Obligatoria. Dominio propio de la app. |
| Sesión | `SESSION_SECRET` | Obligatoria. Firma HMAC de la cookie de sesión. |
| IA | `AI_DEFAULT_PROVIDER`, `GOOGLE_AI_API_KEY`, `GEMINI_MODEL`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, … | Solo backend. Gemini es el proveedor principal. |
| OCR | `GOOGLE_CLOUD_*`, `DOCUMENT_AI_*` | Opcional (OCR de documentos escaneados). |
| API pública | `PUBLIC_API_ENABLED`, `PUBLIC_API_RATE_LIMIT_DEFAULT`, `APP_PUBLIC_URL` | `APP_PUBLIC_URL` es solo para enlaces/documentación. |
| Servicio de datos de procesos | `DATA_API_BASE_URL`, `DATA_API_KEY`, `DATA_API_TIMEOUT_MS` | Endpoint y credencial del servicio de adquisición configurado por entorno. Se aportan al desplegar. |
| Runtime de adquisición | `DATA_API_RUNTIME_ENABLED` (default `false`), `SYNC_RUNTIME_MODE` (default `disabled`) | Interruptores de la sincronización. Dejar apagados salvo instrucción expresa. |
| Guardrail de escritura | `DATA_API_RUNTIME_WRITE_ENABLED` (default `false`), `DATA_API_RUNTIME_DATABASE_URL`, `DATA_API_RUNTIME_EXPECTED_SYSTEM_IDENTIFIER`, `DATA_API_RUNTIME_FORBIDDEN_SYSTEM_IDENTIFIER` (opcional) | El runner de sincronización aborta ANTES de cualquier escritura si el destino no confirma su identidad positiva (`system_identifier` real === esperado) con la escritura habilitada explícitamente. |
| Integraciones | `UPLOADTHING_TOKEN`, `N8N_SYNC_TOKEN` | `N8N_SYNC_TOKEN` solo desbloquea la ingestión RAG (`/api/lectura/rag/ingestar`); nunca rutas de adquisición de procesos. |

### Modos de `SYNC_RUNTIME_MODE`

- `disabled` — no adquiere procesos; ninguna escritura por sync. **Default.**
- `data-api` — adquisición vía la Data API. Requiere `DATA_API_RUNTIME_ENABLED=true`
  y las variables del guardrail de escritura correctamente pobladas.
- `legacy` — **no seleccionable** en este repositorio. Si se pasa, se interpreta
  como `disabled` con una advertencia en log. El pipeline legacy de adquisición
  no es alcanzable desde el runtime.

---

## Stack

- [Next.js](https://nextjs.org) 16 — App Router
- [Prisma](https://prisma.io) — ORM sobre PostgreSQL
- TypeScript · Vitest

## Proveedores de IA

LICYCOLBA usa dos proveedores de IA, siempre desde el backend (las claves nunca
llegan al frontend):

- **Google Gemini** — proveedor principal (lectura de pliegos, chat, RAG, costos, …).
- **Anthropic Claude (Haiku)** — segundo proveedor para análisis de bajo costo,
  mediante la capa común `src/lib/ai/`. No está conectado a los análisis
  productivos de licitaciones.

Selección de proveedor:

```ts
import { analyzeText } from '@/lib/ai/aiProviderFactory';

await analyzeText({ provider: 'gemini',    systemPrompt, userPrompt });
await analyzeText({ provider: 'anthropic', systemPrompt, userPrompt });
```

Reglas: `request.provider` → `AI_DEFAULT_PROVIDER` → `gemini`. Solo se aceptan
valores de la lista permitida (`gemini` | `anthropic`); no hay fallback automático
entre proveedores ni cambio silencioso a modelos más costosos. Todo corre en
backend; no se registran prompts (solo proveedor, modelo, tokens, duración,
módulo y éxito/error).

## Documentación técnica

Documentos de diseño y especificaciones vigentes: ver [`docs/README.md`](docs/README.md).
