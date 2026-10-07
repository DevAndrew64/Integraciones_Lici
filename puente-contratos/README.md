# Puente LiciColba → Contratos

Servicio pequeño (Node + Express, **sin Prisma**) que vive en este repositorio. LiciColba (Next.js) le envía un JSON; el puente lo valida y, cuando el módulo MySQL esté habilitado, lo escribe en MySQL 5.5 con `mysql2`, de donde lo lee Contratos (Visual FoxPro). Así Next.js y Prisma no necesitan hablar con MySQL 5.5 y, si Contratos cambia de base de datos, solo cambia este servicio.

```
Next.js ──POST /contratos (JSON + token)──▶ puente ──mysql2──▶ MySQL 5.5 ◀── Visual FoxPro
```

## Módulos (de lo más simple a lo más complejo)

| # | Módulo | Estado |
|---|---|---|
| 1 | **Puente en modo prueba:** servicio, token, contrato JSON v1 (cliente y datos generales), validación, huella; responde lo que escribiría | ✅ |
| 2 | Next.js → puente: cliente HTTP, ruta que arma el JSON desde la solicitud y el costeo, botón «Enviar a Contratos» | ⏳ |
| 3 | Conexión a MySQL 5.5: `mysql2`, charset/`sql_mode` estrictos, lectura de las longitudes reales de las columnas | ⏳ necesita host, base y usuario |
| 4 | Datos generales → MySQL (una fila, idempotente) | ⏳ necesita tabla y columnas |
| 5 | Operación del contrato (los 6 totales) | ⏳ |
| 6 | Cargos (Hoja 3/4) | ⏳ |
| 7 | Equipos, insumos y costos administrativos | ⏳ |
| 8 | Servicios no continuos, valores agregados y puntos de entrega | ⏳ |

Cada módulo agrega secciones al JSON sin cambiar las anteriores (`version: 1`).

## Uso

```bash
cd puente-contratos
npm install
PUENTE_TOKEN=<mínimo 16 caracteres> npm start     # escucha en 127.0.0.1:4010
npm test
```

```bash
curl -X POST http://127.0.0.1:4010/contratos \
  -H "Authorization: Bearer $PUENTE_TOKEN" -H "Content-Type: application/json" \
  -d '{"version":1,"origen":{"solicitudId":42,"procesoCodigo":"SED-LP-2026-0091"},
       "cliente":{"razonSocial":"Cliente S.A.S.","nit":"900123456","direccion":null},
       "contrato":{"objeto":"Servicio de aseo","porcentajeAIU":12.32,"valorMensual":5000000,"plazoMeses":12}}'
```

Variables: ver `.env.example`. Respuestas: `200` válido (con `huella` y `advertencias`) · `401` sin token · `422` datos inválidos (todos los errores a la vez) · `400` JSON inválido · `501` modo `escritura` aún sin MySQL.

## Contrato JSON v1

| Sección | Campo | Regla |
|---|---|---|
| — | `version` | Debe ser `1` |
| `origen` | `solicitudId` | Entero ≥ 1 · obligatorio |
| `origen` | `procesoCodigo` | Texto · obligatorio |
| `cliente` | `razonSocial` | Texto ≤ 200 · obligatorio |
| `cliente` | `nit` | 5 a 15 dígitos, sin puntos ni dígito de verificación · obligatorio |
| `cliente` | `direccion` | Texto ≤ 200 |
| `contrato` | `objeto` | Texto ≤ 4000 (es «Descripción» y «Objeto» del formulario) |
| `contrato` | `porcentajeAIU` | 0–100, máx. 2 decimales (A.I.U. **con** la «A») |
| `contrato` | `valorMensual` | ≥ 0, máx. 2 decimales (el valor del contrato es **mensual**, con IVA) |
| `contrato` | `plazoMeses` | Entero 1–600 |

Lo opcional que llega vacío no bloquea: queda `null` y se informa como advertencia («se completa en Contratos»). Un campo que no está en la tabla se rechaza. Los límites de longitud son provisionales hasta el módulo 3.

## Seguridad

- Token compartido obligatorio (el servicio no arranca sin él) y comparación en tiempo constante; `/health` es lo único público y no revela datos.
- Debe correr **solo en la red interna**: en Docker, `PUENTE_HOST=0.0.0.0` sin publicar el puerto hacia afuera.
- Los registros no incluyen el cuerpo de las peticiones ni datos del cliente; los errores internos no se devuelven al llamante.
- Nunca se trunca ni se redondea en silencio: lo que no cabe se rechaza.
