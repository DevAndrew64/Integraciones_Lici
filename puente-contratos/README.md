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
| 4 | **Oferta y tarifas:** número de oferta, cliente, A.I.U. y los 6 totales de «Operación del Contrato» (ver «Módulo 4») | `fc_contratos_tarifa_inicial` (lee `fc_clientes`, `fc_conceptos`, `fc_control`) | ✅ probado contra un MySQL 5.5 real con un usuario de permisos mínimos; por confirmar con Contratos |
| 5 | **Cargos (Hoja 3/4):** una fila por línea de cargo, con código consecutivo por oferta, ítem, horario y valores (ver «Módulo 5») | `fc_contratos_cargos_iniciales` (lee `fc_horarios`) | ✅ probado contra un MySQL 5.5 real; LiciColba ya los envía; por confirmar con Contratos |
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
       "contrato":{"objeto":"Servicio de aseo","porcentajeAIU":12.32,"valorMensual":5000000,"plazoMeses":12},
       "oferta":{"empresa":"01","undnegocio":"BAQ","tipoAdm":"A","origenProceso":"LIC","codServicio":"ASE"},
       "tarifa":{"manoObra":61155743,"insumos":0,"maquinaria":0,"administrativos":5000000,"valorAgregado":0,"serviciosNoContinuos":0}}'
```

Variables: ver `.env.example`. Respuestas: `200` válido (con `huella`, `advertencias`, lo que escribiría —o escribió— y `noEscrito`) · `401` sin token · `422` datos inválidos o que Contratos no puede recibir (todos los errores a la vez, cada uno con su campo) · `400` JSON inválido · `409` `YA_ENVIADA` (con la oferta que ya existe), `OCUPADO`, `CONTADOR_AMBIGUO` o `NUMERO_OFERTA_EN_USO` · `503` base de Contratos sin conexión · `501` modo `escritura` sin escritor.

`GET /health` (público) responde `{ok, servicio, modo, bd}` con `bd` = `sin_configurar` · `ok` · `esquema_distinto` · `sin_conexion`. Solo una palabra: ni tablas ni mensajes.

### Pruebas contra un MySQL 5.5 real

`npm test` no necesita base de datos. Las pruebas contra el servidor real usan una base de PRUEBA en Docker (`mysql:5.5`, latin1, sin modo estricto, igual que la de Contratos) con la estructura de las tablas y sin ningún dato:

```bash
npm run mysql:prueba:arriba   # levanta la base y crea las tablas (test/mysql/esquema.sql)
npm run test:mysql            # 29 pruebas: modo estricto, latin1, DECIMAL/fechas, rollback InnoDB vs MyISAM, esquema, arranque del servicio y los módulos 4 y 5
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
| `oferta` | `empresa` | Código de Contratos (letras y números, ≤ 6) · obligatorio para escribir: debe tener contador en `fc_control` |
| `oferta` | `undnegocio` | Código de la UEN (≤ 9) · obligatorio para escribir |
| `oferta` | `tipoAdm` | `A` (Administración) o `C` (Administración y costos asumidos) · obligatorio para escribir: el formulario no deja guardar una tarifa sin él |
| `oferta` | `origenProceso` | `LIC` (licitación pública) o `INV` (invitación privada) · obligatorio para escribir |
| `oferta` | `codServicio` | Concepto de facturación (≤ 3): debe existir en `fc_conceptos` · obligatorio para escribir |
| `oferta` | `descripcionServicio` | Texto ≤ 254 · opcional (la tarifa admite descripción vacía) |
| `tarifa` | `manoObra`, `insumos`, `maquinaria`, `administrativos`, `valorAgregado`, `serviciosNoContinuos` | Pesos **enteros** ≥ 0, con el A.I.U. incluido y antes de IVA: son los seis valores de la hoja «Contratos» del Excel de costos. Obligatorios para escribir |
| `cargos[]` | `nombre` | Texto ≤ 100 · obligatorio |
| `cargos[]` | `cantidad` | Personas: entero 1–99.999 · obligatorio |
| `cargos[]` | `horasSemana` | Entero 1–168 · obligatorio para escribir |
| `cargos[]` | `jornada` | Horas por día, 0–24 con máx. 2 decimales (0 si el cargo no tiene jornada diaria, p. ej. el turnante automático) · obligatorio para escribir |
| `cargos[]` | `salario` | Pesos enteros ≥ 0 · obligatorio para escribir |
| `cargos[]` | `riesgo` | Clase ARL, 1 a 5 · obligatorio para escribir |
| `cargos[]` | `valorUnitario`, `valorTotal` | Costo mensual por trabajador y de toda la línea, **sin A.I.U. ni IVA**, con hasta 5 decimales · obligatorios |
| `cargos[]` | `codigoHorario` | Código ≤ 5 que debe existir en `fc_horarios` · opcional |

`cargos` es una lista (máximo 300) y siempre opcional: sin ella la oferta se crea sin mano de obra y se avisa. Las secciones `oferta` y `tarifa` son opcionales en modo prueba (los remitentes de los módulos 1 y 2 no las mandan: queda una advertencia por sección) y **obligatorias para escribir**. Lo opcional que llega vacío no bloquea: queda `null` y se informa como advertencia («se completa en Contratos»). Un campo que no está en la tabla se rechaza. Todo texto debe caber en latin1 (las tablas de Contratos lo son): un carácter como «≥», «→» o un emoji se rechaza con su lista, nunca se cambia por «?». Los límites de longitud de `oferta` y `tarifa` son los de la columna real de `fc_contratos_tarifa_inicial`; los de `cliente` y `contrato` son provisionales.

## Módulo 4 — cómo escribe la oferta

En modo `escritura`, por cada envío (con un candado por solicitud, `GET_LOCK`, para que dos envíos simultáneos de la misma solicitud no creen dos ofertas):

1. **¿Ya se envió?** La fila de tarifa lleva en `pc_add` (el equipo que creó el registro) la marca `LICICOLBA:<solicitud>:<huella>`. Si existe, responde `409 YA_ENVIADA` con la oferta que ya está en Contratos (y `sinCambios: false` si lo reenviado cambió); no crea otra ni gasta otro número. Si Contratos borra esa oferta, la solicitud puede enviarse de nuevo.
2. **El cliente debe existir** en `fc_clientes` (se busca por la base del NIT, con el de la misma UEN y la sucursal 00 primero). El NIT y la razón social se escriben **como están en Contratos** —así la tarifa une con el cliente igual que las digitadas a mano—; si la razón social o el dígito de verificación difieren de los de LiciColba, advertencia.
3. **Validaciones**, todas juntas en un solo `422` y sin reservar ningún número: la UEN tiene contador único en `fc_control`, el concepto existe en `fc_conceptos` (si es de otra empresa o UEN, advertencia), el A.I.U. no es 0 (el formulario lo exige) y cada valor cabe en su columna. La empresa, la UEN y el concepto se escriben como están en Contratos aunque lleguen en minúsculas.
4. **Número de oferta:** un solo `UPDATE fc_control SET num_oferta = LAST_INSERT_ID(num_oferta + 1)` (atómico: dos reservas simultáneas nunca reciben el mismo número) y la comprobación de que nadie lo usó (si el contador iba por detrás, salta al siguiente; hasta 3 intentos). `fc_control` es MyISAM: si algo falla después, el número se pierde, igual que en Visual FoxPro.
5. **INSERT de la tarifa (y de sus cargos, ver el módulo 5)** en una transacción (InnoDB, todo o nada): las 30 columnas del INSERT de `cmdGrabar.Click` en su mismo orden, más `tar_insumos`, `tar_maquinaria`, `tar_otros` y `tar_nocontinuos` (el formulario de octubre ya no las escribe, pero existen y las usaron las ofertas anteriores: así lo costeado en LiciColba no se pierde).

Cómo se llenan las columnas: `tarifa` = suma de los seis valores; `tar_manoobra` ← mano de obra (ya incluye turnantes, dotación/EPP y exámenes, por eso `tar_examenes`, `tar_dotacion` y los indicadores de venta quedan en 0); `tar_impuestos` ← costos administrativos (la columna conserva su nombre antiguo); `aiu` ← el «% de I.U.» como fracción (12,32 % → `0.1232`); `ncontrato` vacío (la oferta nace sin contrato); `consec` 1; `user_add` `LICICOLBA`; `fadd` `NOW()` del servidor.

**Lo que este módulo no escribe** (se digita en Contratos, que crea el contrato después de la oferta): `contrato.objeto`, `contrato.valorMensual`, `contrato.plazoMeses` y `cliente.direccion`. La respuesta los lista en `noEscrito` con su motivo: nada se pierde sin que se sepa.

## Módulo 5 — los cargos (mano de obra)

Si el envío trae `cargos`, se escriben en la **misma transacción** que la tarifa (todo o nada): una fila de `fc_contratos_cargos_iniciales` por línea, con las 47 columnas del INSERT de `cmdGrabar.Click` en su orden (más `codhorario` si el cargo trae horario).

- **El código de cargo es un consecutivo por oferta** (1, 2, 3…), como exige el formulario de octubre: la misma información (nombre y salario) tiene el mismo código y dos cargos distintos nunca comparten uno. El **ítem** es el número de la línea, y nunca se repite dentro de (sección, cargo).
- **Valores sin A.I.U. ni IVA** (el A.I.U. se aplica en la tarifa). `valorTotal` es el costo mensual de toda la línea tal como lo calcula la pantalla de costos (laboral + dotación, EPP, exámenes, cursos y vacunas + bonos no prestacionales); `valorUnitario` es ese total ÷ las personas. El puente exige `valorTotal = valorUnitario × cantidad` (1 peso de holgura por el redondeo a 5 decimales) y **avisa** si los cargos, con A.I.U., no suman la mano de obra de la tarifa.
- LiciColba envía **una línea por cada línea de Mano de Obra** (menos las marcadas Valor Agregado, cuyo costo va a su propio subtotal) **más las líneas automáticas de turnantes**. En conjunto suman exactamente el total de Mano de Obra del panel de Resumen, y el servidor lo comprueba antes de enviar: si no cuadra, no envía nada.
- El horario (`codigoHorario`) debe existir en `fc_horarios`: Contratos lo crea antes de la oferta. Un horario que no existe es un error por línea, junto con los demás, y no se reserva ningún número.
- El archivo `test/fixtures/payload-licicolba.json` es el JSON que arma el código de LiciColba; sus pruebas comprueban que lo siguen produciendo y las del puente que lo validan y lo escriben contra un MySQL 5.5 real (`npm run test:mysql`). Si un lado cambia sin el otro, una de las dos suites falla.

**Lo que no escribe todavía** (queda en el valor con que el formulario inserta —el de la base— y se completa en Contratos): la sección de nómina (`cod_seccion`), los estudios y la experiencia, los grupos de dotación, EPP, exámenes y cursos, el tipo de contrato, el municipio, los bonos y los recargos. La respuesta lo lista en `noEscrito`.

**Por confirmar con Contratos (preguntas 4 y 8 del Excel):** cómo se relaciona el código consecutivo con el de nómina, si estudios y experiencia pueden ir vacíos, y si el formulario vigente guarda además el horario, los bonos y los importes «globales» (hoy el puente escribe el horario, que la plantilla de producción sí trae).

### Permisos mínimos de MySQL

Los permisos salen del mismo contrato de esquema que el servicio verifica, y solo de los módulos ya implementados (`src/modulos.js`):

```bash
npm run permisos:generar -- --usuario puente --base almacen
# GRANT SELECT, INSERT ON `almacen`.`fc_contratos_tarifa_inicial` TO 'puente'@'%';
# GRANT INSERT ON `almacen`.`fc_contratos_cargos_iniciales` TO 'puente'@'%';
# GRANT SELECT (undnegocio, nit, sucursal, rsocial) ON `almacen`.`fc_clientes` TO 'puente'@'%';
# GRANT SELECT (empresa, undnegocio, codcpto) ON `almacen`.`fc_conceptos` TO 'puente'@'%';
# GRANT SELECT (empresa, undnegocio, num_oferta), UPDATE (num_oferta) ON `almacen`.`fc_control` TO 'puente'@'%';
# GRANT SELECT (codigo) ON `almacen`.`fc_horarios` TO 'puente'@'%';
```

Sin DDL, sin DELETE, los cargos solo se insertan (el puente no los lee) y de `fc_control` solo el contador (la fila trae usuario y clave de conexión). `npm run test:mysql` crea un usuario con exactamente esos permisos y corre todo el módulo con él (incluido el arranque del servicio y su verificación de esquema); también comprueba que lo demás le está denegado.

### Por confirmar con Contratos (preguntas 4 a 7 del Excel de mapeo)

- La **versión del formulario**: el de octubre ya no escribe `tar_insumos`, `tar_maquinaria`, `tar_otros` ni `tar_nocontinuos`; hoy el puente sí, para no perder lo costeado.
- **Empresa y UEN** (hoy las elige quien envía en la pantalla de costos; falta la equivalencia con el perfil y la ciudad de LiciColba), **quién decide A o C**, y si `LIC`/`INV` equivalen a proceso público/privado.
- Si el puente puede **reservar el número** con ese `UPDATE` atómico, y si `pc_add` es un buen lugar para la marca de reenvío (alternativa: `id_oferta_adjudicada`, si está libre).

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
