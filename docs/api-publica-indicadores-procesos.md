# API pública de indicadores de Procesos — LICYCOLBA

**Servidor oficial:** `https://your-domain.example/api/public/v1`
**Versión:** v1 (solo lectura) · **Formato:** JSON · **Auth:** header `X-API-Key`

## Autenticación

Toda solicitud debe llevar el header:

```
X-API-Key: lcb_xxxxxxxxxxxx_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

- La clave **no** se acepta en la URL ni en query params.
- Cada consumidor tiene su propia clave, con scopes, empresas permitidas, rate limit y expiración independientes.
- En el servidor solo se almacena el hash SHA-256 de la clave (tabla `api_clients`); si se pierde la clave hay que generar una nueva.

### Scopes

| Scope | Da acceso a |
|---|---|
| `procesos:indicadores:read` | `/resumen`, `/mensual`, `/anual` |
| `procesos:detalle:read` | `/detalle` |

### Rate limit

Por clave, ventana fija de 1 minuto (`rateLimitPorMinuto` del cliente; default 60). Al exceder: HTTP 429 `rate_limit`.
*Limitación conocida:* el contador vive en memoria del proceso; con una sola instancia del proceso es exacto. Si se escala horizontalmente debe migrarse a Postgres/Redis.

## Modelo de datos y clasificación

- **Unidad de conteo:** modelo `Proceso` (único por `sourceKey`). `ProcesoNuevo` es staging de detección y **se excluye** para evitar doble conteo. Si un proceso tiene varias `Solicitud`, se usa la más reciente (`updatedAt`).
- **Clasificación** (`clasificarPresentacion`, `src/lib/public-api/clasificacion.ts`):

| Categoría | Regla |
|---|---|
| `PRESENTADO` | Evidencia real: última asignación con `estadoRevision` ∈ PRESENTADO/CERRADO_ADJUDICADO/CERRADO_NO_ADJUDICADO/CERRADO_NO_CUMPLIMIENTO, o `estadoSolicitud` contiene "presentado", o `resultadoFinal` ∈ Adjudicado/No adjudicado |
| `NO_PRESENTADO` | Decisión definitiva sin presentar: `estadoRevision=RECHAZADO`, `resultadoFinal=No favorable`, o solicitud cerrada sin evidencia de presentación |
| `PENDIENTE` | Solicitud aún en gestión, o proceso sin gestionar cuyo cierre no ha vencido |
| `NO_APLICA` | Proceso `noViable`, oculto, o solicitud cancelada |
| `SIN_INFORMACION` | Sin datos suficientes (p. ej. venció sin haberse gestionado) |

## Fórmulas

```
porcentajePresentacion            = presentados / (presentados + noPresentados) × 100
participacionPresentadosSobreTotal = presentados / totalProcesos × 100
```

Si el denominador es 0, el indicador es `null` (nunca 0 engañoso). Son **dos indicadores distintos**: el primero mide efectividad sobre decisiones tomadas; el segundo, participación sobre el universo total.

## Filtros comunes (whitelist)

| Parámetro | Tipo | Notas |
|---|---|---|
| `anio` | int 2000–2100 | |
| `mes` | int 1–12 | requiere `anio` |
| `fechaDesde`, `fechaHasta` | `YYYY-MM-DD` | rango sobre la fecha de referencia |
| `fechaReferencia` | `registro` (default) \| `publicacion` \| `vencimiento` | `registro` = fecha de ingreso al sistema (`createdAt`, nunca nula) |
| `empresa` | texto | mapea a `Proceso.perfil` (p. ej. ASEOCOLBA) |
| `fuente` | texto | mapea a `Proceso.aliasFuente` (S1, S2, …) |
| `departamento` | texto | |
| `modalidad` | texto | |
| `categoria` | una de las 5 categorías | solo en `/detalle` tiene efecto de filtro |
| `responsable` | texto | mapea a `Solicitud.usuarioRegistro` |

No se aceptan nombres de columnas arbitrarios; cualquier otro valor → HTTP 400 `filtro_invalido`.
*Brecha documentada:* `regional` y `tipoProceso` no existen como campos del modelo `Proceso` (el tipo de proceso vive en `ProcesoDetalleSecop.tipoProceso` y requeriría un join adicional) — no se exponen en v1.

## Endpoints

### 1. Resumen

```
GET https://your-domain.example/api/public/v1/procesos/indicadores/resumen?anio=2026&mes=7
```

```json
{
  "success": true,
  "data": {
    "periodo": { "anio": 2026, "mes": 7, "fechaDesde": null, "fechaHasta": null, "fechaReferencia": "registro" },
    "totales": {
      "totalProcesos": 120, "presentados": 45, "noPresentados": 30,
      "pendientes": 25, "noAplica": 15, "sinInformacion": 5, "sinFecha": 0
    },
    "indicadores": { "porcentajePresentacion": 60, "participacionPresentadosSobreTotal": 37.5 }
  },
  "meta": { "version": "v1", "generatedAt": "2026-07-11T17:00:00.000Z", "requestId": "…" }
}
```

`sinFecha`: procesos que cumplen los demás filtros pero no tienen la fecha de referencia elegida (solo aplica con `publicacion`/`vencimiento`; no entran en `totalProcesos` cuando hay filtro de periodo).

### 2. Mensual

```
GET https://your-domain.example/api/public/v1/procesos/indicadores/mensual?anio=2026
```

Devuelve **siempre los 12 meses** (`data.meses[0..11]`), con totales en cero e indicadores `null` en meses sin registros.

### 3. Anual

```
GET https://your-domain.example/api/public/v1/procesos/indicadores/anual?anioDesde=2025&anioHasta=2026
```

Rango máximo 20 años; devuelve todos los años del rango aunque estén vacíos.

### 4. Detalle (scope `procesos:detalle:read`)

```
GET https://your-domain.example/api/public/v1/procesos/indicadores/detalle?anio=2026&categoria=PRESENTADO&page=1&pageSize=25
```

Paginación: `page` (default 1), `pageSize` (default 25, máx. 100). Respuesta: `data.items[]` (id, codigoProceso, nombre, entidad, fuente, aliasFuente, modalidad, empresa, departamento, fechaPublicacion, fechaVencimiento, valor, estadoFuente, categoria) + `data.pagination {page,pageSize,total,totalPages}`. No se exponen rawJson, observaciones internas ni datos de contacto.

## Errores

| HTTP | code | Causa |
|---|---|---|
| 400 | `filtro_invalido` | Parámetro fuera de la whitelist o mal formado |
| 401 | `clave_ausente` / `clave_invalida` | Falta el header o la clave no existe/no coincide |
| 403 | `clave_deshabilitada` / `clave_expirada` / `scope_insuficiente` | |
| 429 | `rate_limit` | Se excedió el límite por minuto |
| 503 | `api_deshabilitada` | `PUBLIC_API_ENABLED=false` |
| 500 | `error_interno` | Incluir `meta.requestId` al reportar |

Formato de error: `{ "success": false, "error": { "code", "message" }, "meta": { "version", "generatedAt", "requestId" } }`

## Ejemplos

### curl

```bash
curl -s "https://your-domain.example/api/public/v1/procesos/indicadores/resumen?anio=2026&mes=7" \
  -H "X-API-Key: $LICY_API_KEY"
```

### JavaScript

```js
const res = await fetch(
  'https://your-domain.example/api/public/v1/procesos/indicadores/mensual?anio=2026',
  { headers: { 'X-API-Key': process.env.LICY_API_KEY } },
);
const { success, data } = await res.json();
if (success) console.table(data.meses.map(m => ({ mes: m.mes, ...m.totales })));
```

### Power BI

Obtener datos → Web → Avanzado:
- URL: `https://your-domain.example/api/public/v1/procesos/indicadores/mensual?anio=2026`
- Encabezado HTTP: `X-API-Key` = *(la clave)*

O en Power Query:

```m
let
  Origen = Json.Document(Web.Contents(
    "https://your-domain.example/api/public/v1/procesos/indicadores/mensual",
    [ Query = [anio = "2026"], Headers = [#"X-API-Key" = "lcb_..."] ]
  )),
  Meses = Table.FromRecords(Origen[data][meses])
in Meses
```

## Gestión de claves

```bash
# Crear (imprime la clave UNA sola vez)
npx dotenv -e .env -- npx tsx scripts/generar-api-key.ts crear "Power BI Gerencia"
# Con scopes/empresas/límite/expiración:
npx dotenv -e .env -- npx tsx scripts/generar-api-key.ts crear "Integración X" \
  "procesos:indicadores:read,procesos:detalle:read" "ASEOCOLBA" 120 365

# Listar
npx dotenv -e .env -- npx tsx scripts/generar-api-key.ts listar

# Revocar (efecto inmediato)
npx dotenv -e .env -- npx tsx scripts/generar-api-key.ts revocar <id>
```

## Despliegue

1. **Variables** (configuración de entorno del servicio): opcionales `PUBLIC_API_ENABLED=true`, `PUBLIC_API_RATE_LIMIT_DEFAULT=60`, `APP_PUBLIC_URL=https://your-domain.example`. La API funciona sin ellas (habilitada por defecto; el acceso real lo controlan las claves). `DATABASE_URL` ya existe.
2. **Migración**: `npx prisma migrate deploy` (aplica `20260711120000_add_api_clients`: tabla `api_clients` + índice `Solicitud(procesoId)` justificado por el join de la API).
3. **Build**: el `npm run build` existente (`prisma generate && next build`) no cambia.
4. **Validación post-deploy**:
   ```bash
   # 401 esperado (sin clave) = la ruta está viva y protegida
   curl -i https://your-domain.example/api/public/v1/procesos/indicadores/resumen
   # 200 con clave
   curl -s https://your-domain.example/api/public/v1/procesos/indicadores/resumen -H "X-API-Key: <clave>"
   ```

## Rendimiento

Agregaciones 100% en PostgreSQL (`GROUP BY` sobre un `CASE` de clasificación + `LEFT JOIN LATERAL` a la solicitud más reciente); nunca se cargan todos los procesos en memoria; detalle paginado con `LIMIT/OFFSET`. Índice agregado: `Solicitud(procesoId)` (el join lo usa en cada consulta; `procesoSourceKey` ya estaba indexado).
