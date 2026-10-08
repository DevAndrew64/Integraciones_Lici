# Puente LiciColba → Contratos

Servicio pequeño (Node + Express, **sin Prisma**) que vive en este repositorio. LiciColba (Next.js) le envía un JSON; el puente lo valida y, cuando el módulo de escritura esté habilitado, lo escribe en MySQL 5.5 con `mysql2`, de donde lo lee Contratos (Visual FoxPro). Así Next.js y Prisma no necesitan hablar con MySQL 5.5 y, si Contratos cambia de base de datos, solo cambia este servicio.

```
Next.js ──POST /contratos (JSON + token)──▶ puente ──mysql2──▶ MySQL 5.5 ◀── Visual FoxPro
```

## Módulos (de lo más simple a lo más complejo)

Con el esquema real de la base (ver «Lo que dice la base de Contratos») la oferta vive en ocho tablas, todas con la misma clave: **(empresa, UEN, n.º de oferta)**. Por eso los módulos de escritura siguen esas tablas:

| # | Módulo | Tablas de Contratos | Estado |
|---|---|---|---|
| 1 | **Puente en modo prueba:** servicio, token, contrato JSON v1, validación, huella | — | ✅ |
| 2 | **Next.js → puente:** cliente HTTP, ruta que arma el JSON, botón «Enviar a Contratos» | — | ✅ |
| 3 | **Conexión a MySQL y contrato de esquema:** `mysql2` en modo estricto, comprobación de tablas y columnas, `/health` | `information_schema` | ✅ probado también contra un MySQL 5.5 real (Docker) |
| 4 | Oferta y tarifas: cliente, A.I.U. y los 6 totales de «Operación del Contrato» | `fc_contratos_tarifa_inicial` | ⏳ |
| 5 | Cargos (Hoja 3/4) | `fc_contratos_cargos_iniciales` | ⏳ |
| 6 | Equipos, insumos y costos administrativos | `fc_contratos_equipos_iniciales`, `fc_elemxcont`, `fc_preciosventas_oferta`, `fc_contratos_costos_admtivos_iniciales` | ⏳ |
| 7 | Servicios no continuos y valores agregados | `fc_contratos_no_continuos_iniciales`, `fc_contratos_vlrs_agregs_iniciales` | ⏳ |

Los datos generales del contrato (fechas, reajuste, suministros…) viven en `fc_contratos`, que se crea **después** de la oferta; dónde guardarlos antes de que exista el contrato lo define Contratos (ver el Excel de mapeo).

Cada módulo agrega secciones al JSON sin cambiar las anteriores (`version: 1`).

### Cómo lo usa LiciColba (módulo 2)

En la pantalla de **Costos** abierta desde la ficha de una solicitud, el botón **«Enviar a Contratos»** llama a `POST /api/costos-estructura/{id}/enviar-a-contratos` (permiso de editar costos). La ruta exige los módulos de costos resueltos y que la solicitud corresponda al costeo, arma el JSON v1 (`src/lib/contratos-puente/payload.ts`), lo envía con `src/lib/contratos-puente/cliente.ts` y devuelve al usuario lo que el puente respondió: éxito con lo que queda por completar en Contratos, o los errores por campo con su nombre legible. El valor mensual, el plazo y el A.I.U. salen de la pestaña **Resultado guardada**; sin ella viajan vacíos.

Variables en LiciColba (`.env.example`): `PUENTE_CONTRATOS_URL`, `PUENTE_CONTRATOS_TOKEN` (el mismo `PUENTE_TOKEN` del puente) y, opcional, `PUENTE_CONTRATOS_TIMEOUT_MS`. Sin ellas la integración queda apagada.

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

Variables: ver `.env.example`. Respuestas: `200` válido (con `huella`, `advertencias` y lo que escribiría) · `401` sin token · `422` datos inválidos (todos los errores a la vez) · `400` JSON inválido · `501` modo `escritura` aún sin escritor.

`GET /health` (público) responde `{ok, servicio, modo, bd}` con `bd` = `sin_configurar` · `ok` · `esquema_distinto` · `sin_conexion`. Solo una palabra: ni tablas ni mensajes.

### Pruebas contra un MySQL 5.5 real

`npm test` no necesita base de datos. Las pruebas contra el servidor real usan una base de PRUEBA en Docker (`mysql:5.5`, latin1, sin modo estricto, igual que la de Contratos) con la estructura de las tablas y sin ningún dato:

```bash
npm run mysql:prueba:arriba   # levanta la base y crea las tablas (test/mysql/esquema.sql)
npm run test:mysql            # 9 pruebas: modo estricto, latin1, DECIMAL/fechas, rollback InnoDB vs MyISAM, esquema, arranque del servicio
npm run mysql:prueba:abajo    # la apaga y la borra
```

Comprueban, contra el servidor real, que el esquema esperado coincide con lo que MySQL 5.5 reporta, que sin modo estricto MySQL corta un texto sin avisar y con él falla, que los bytes quedan en latin1 como los escribe Visual FoxPro, y que el servicio en modo `escritura` no arranca si una columna cambia. Estas pruebas insertan y borran filas: se niegan a correr contra una base cuyo nombre no termine en `_prueba` o `_test`.

### MySQL (módulo 3)

Se activa con `PUENTE_MYSQL_HOST` (+ `_USER`, `_PASSWORD`, `_DATABASE`). Cada conexión queda en `sql_mode = STRICT_ALL_TABLES`: lo que no cabe es un error, nunca un truncado silencioso. En modo `escritura` el servicio **no arranca** si la base no responde o si alguna tabla o columna que usa ya no es la esperada (`src/esquema-esperado.json`, solo estructura). Si Contratos cambia una tabla a propósito:

```bash
npm run esquema:actualizar               # muestra las diferencias contra el MySQL real
npm run esquema:actualizar -- --escribir  # actualiza el archivo (revisar el cambio en git antes de aprobarlo)
```

## Contrato JSON v1

| Sección | Campo | Regla |
|---|---|---|
| — | `version` | Debe ser `1` |
| `origen` | `solicitudId` | Entero ≥ 1 · obligatorio |
| `origen` | `procesoCodigo` | Texto · obligatorio |
| `cliente` | `razonSocial` | Texto ≤ 200 · obligatorio (se contrasta con el cliente de Contratos; no se escribe tal cual) |
| `cliente` | `nit` | 5 a 15 dígitos, sin puntos ni dígito de verificación · obligatorio. Contratos lo guarda como `base-DV`: el puente calcula el DV (módulo 11 de la DIAN) |
| `cliente` | `direccion` | Texto ≤ 200 · informativo (la dirección vive en el cliente de Contratos) |
| `contrato` | `objeto` | Texto ≤ 4000 (es «Descripción» y «Objeto» del formulario) |
| `contrato` | `porcentajeAIU` | 0–100, máx. 2 decimales (el «% de I.U.» del costeo, aplicado a todo el costo; Contratos lo llama A.I.U.) |
| `contrato` | `valorMensual` | ≥ 0, máx. 2 decimales (el valor de la oferta es **mensual**, con IVA) |
| `contrato` | `plazoMeses` | Entero 1–600 |

Lo opcional que llega vacío no bloquea: queda `null` y se informa como advertencia («se completa en Contratos»). Un campo que no está en la tabla se rechaza. Todo texto debe caber en latin1 (las tablas de Contratos lo son): un carácter como «≥», «→» o un emoji se rechaza con su lista, nunca se cambia por «?». Los límites de longitud son provisionales hasta el módulo 4, que toma el largo de la columna real donde se escribe cada dato.

## Lo que dice la base de Contratos

Hallado en el esquema de la copia de producción (2026-10-07; solo estructura, sin datos en el repositorio):

- **La oferta se identifica por (empresa, UEN, n.º de oferta)**, no solo por el número: 115 de 621 números de oferta se repiten entre empresas/UEN. Dentro de esa clave, una oferta tiene un solo cliente.
- **Motores mezclados:** `fc_contratos`, `fc_clientes` y `fc_elemxcont` son MyISAM (sin transacciones); las demás tablas de la oferta son InnoDB. Una escritura que toque `fc_elemxcont` no puede revertirse con `ROLLBACK`: se compensa con borrado de lo propio.
- **Charset latin1** en todas las tablas que se escriben (salvo `fc_horarios`, utf8).
- **NIT con dígito de verificación** (`900123456-8`) en el 97 % de los contratos y tarifas, a veces con espacios al final (se comparan sin ellos).
- **A.I.U. en dos escalas:** fracción en `fc_contratos_tarifa_inicial` y `fc_preciosventas_oferta` (0.10 = 10 %), porcentaje en `fc_contratos` (10.0). El valor es el «% de I.U.» de LiciColba aplicado a todo el costo (la plantilla de producción lo confirma y así quedó decidido el 2026-10-07): `porcentajeAIU` se envía tal cual, sin sumarle la «A».
- **Las tarifas llevan el A.I.U. incluido y van antes de IVA:** cada componente se guarda como `ROUND(costo × (1 + A.I.U.), 0)`; el IVA (19 % de un 10 % del costo) no se guarda.
- **Plantilla Excel de hoy** (la que importa VFP): 8 hojas de datos y ningún dato general del contrato. Una oferta de *tarifa global* (63 de 736) se guarda solo como tarifa + cargos, con insumos, equipos y administrativos repartidos en las líneas de Mano de Obra; las demás (itemizadas) también llevan líneas de insumos, equipos, administrativos y no continuos.
- **Los horarios nuevos se crean antes de la oferta** (en `fc_horarios`): el puente debe verificar que existan.
- **La base no exige ningún dato de la oferta:** de las 33 tablas del formulario solo una columna es NOT NULL sin valor por defecto (`fc_clientes.snbasertf`, tabla que el puente no escribe). Lo que hoy es obligatorio para los campos que LiciColba no tiene lo exige el formulario de VFP.
- **`fc_elemxcont` mezcla filas de oferta (`num_oferta > 0`) con filas de contratos vigentes** (el 73 % tiene `num_oferta = 0`): el puente solo toca lo suyo.
- `fc_control` y `fc_empresas` guardan usuario y clave de conexión en texto plano: el puente nunca las lee con `SELECT *`.

## Seguridad

- Token compartido obligatorio (el servicio no arranca sin él) y comparación en tiempo constante; `/health` es lo único público y no revela datos.
- Debe correr **solo en la red interna**: en Docker, `PUENTE_HOST=0.0.0.0` sin publicar el puerto hacia afuera.
- El usuario de MySQL del puente es propio y de permisos mínimos; la clave solo viaja por variable de entorno y nunca aparece en registros ni mensajes de error.
- Los registros no incluyen el cuerpo de las peticiones ni datos del cliente; los errores internos no se devuelven al llamante.
- Nunca se trunca ni se redondea en silencio: lo que no cabe se rechaza.
