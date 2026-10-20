# Bitácora — puente LiciColba → oferta inicial (completitud)

Rama: `fix/puente-licicolba-completitud` (sale de `feat/puente-contratos` en 8156092). Encargo de John del 2026-10-20 (reemplaza a Sergio en este frente). Se trabaja en la sesión en la nube, sin acceso a las bases vivas.

## Objetivo, en mis palabras

Que cada oferta adjudicada en LiciColba quede en «oferta inicial» (las tablas `almacen.fc_contratos_*_iniciales` y vecinas que lee la pantalla FoxPro «Oferta Inicial Contratos») con todo lo que LiciColba tiene y esas tablas pueden guardar. Aplica a Aseocolba, Tempocolba y Transcolba. Cada vacío o cero que quede debe estar justificado: un campo rojo, un dato que LiciColba no captura, o un dato que el destino no tiene. Además hay que demostrar por qué `id_oferta_adjudicada` llega en 0 en la oferta 950.

## Fase 0 · Recorrido actual (leído en el código)

| Capa | Dónde | Qué hace |
|---|---|---|
| Entrada | `src/app/page.tsx` → `enviarAContratos()` | La pantalla de costos manda `costosDto` (totales y líneas ya calculadas), los `cargos`, y la UEN, el concepto y las tarifas elegidas. |
| Extracción | `src/app/api/costos-estructura/[id]/enviar-a-contratos/route.ts` (Next.js + Prisma, PostgreSQL de LiciColba) | Lee `Solicitud` (NIT, entidad, perfil, adjudicación) y `CostoEstructura` (módulo Resultado: A.I.U., valor mes, plazo). Valida que los totales de la pantalla cuadren. |
| Transformación 1 | `src/lib/contratos-puente/payload.ts`, `cargos.ts`, `tarifas.ts` | Arma el «contrato v1» (JSON). |
| Transformación 2 | `puente-contratos/src/validar.js` y `oferta.js` | Valida el contrato y arma una fila por tabla destino (planes). |
| Carga | `puente-contratos/src/escritor-mysql.js` vía `src/lib/contratos-puente/directo.ts` → `motor.js` | Escribe directo en MySQL 5.x (`almacen` en 10.152.0.13) con mysql2, en una transacción. Por defecto es dry-run; escribe solo con `CONTRATOS_MODO=escritura`. |

Tablas destino (una pestaña cada una): `fc_contratos_tarifa_inicial` (Tarifa), `fc_contratos_cargos_iniciales` (Mano de Obra), `fc_elemxcont` (Insumos), `fc_contratos_costos_admtivos_iniciales`, `fc_contratos_equipos_iniciales`, `fc_contratos_no_continuos_iniciales`, `fc_contratos_vlrs_agregs_iniciales`, `fc_preciosventas_oferta` (Listas de Precio). A eso se suman la cabecera `fc_ofertas_adjudicadas` y el contador `fc_control`.

Idempotencia: hoy no se hace upsert. El reenvío se detecta por la marca `pc_add = LICICOLBA:<id de la Solicitud>:<huella 12>` y responde 409 YA_ENVIADA sin escribir ni gastar número (`escritor-mysql.js`, prueba «el reenvío de la misma solicitud no crea otra oferta»). Por eso el «47» de la 950 es el id de la Solicitud en LiciColba (Clínica Abaton).

Diferencias entre empresas. Todas son configuración, no hay ramas de código:
- La empresa sale del perfil de la Solicitud, buscada por nombre en `fc_empresas.rsocial` (`destino.js`). Visto en datos: Aseocolba = 01 y Tempocolba = 02. Transcolba = 03 se dedujo de `gl_undnegocios` (BAQ 03), no está verificado en `fc_empresas`.
- La UEN es una de las que tienen contador en `fc_control` para la empresa.
- La nómina de cargos sale de `gl_undnegocios.dbnomina` (01: nominabq y nominamn). `NOMINAS_DE_EMPRESA` en `puente-contratos/src/nomina.js` fija 02 → nominatmb y nominatmb2, y 03 → nominatr.
- Sin verificar: si Transcolba guarda sus ofertas en `almacen` o en `almacentr`. La memoria del proyecto dice que en `almacentr` solo aparece `fc_contratos_cargos_iniciales`.

## Insumos

| Insumo | Estado |
|---|---|
| Acta de compromiso (.docx) | **No está en esta sesión.** Sí está su texto de decisiones y compromisos #1–#12 en `Boveda LiciColba/LiciColba/Automatización de procesos de contratos (LiciColba - Contratos).md`. Faltan §5 (lista del semáforo campo por campo) y §7 (texto de RQ1/RQ2). |
| Imagen del flujo | Leída: `Boveda LiciColba/LiciColba/Imagenes/flujo_requerimientos_contratos (1) 1.png`. Nuestro tramo es «Importar desde LiciColba en Contratos (RQ1 · RQ2)». |
| `950_contrats_tarifa.json` | **No está en esta sesión.** Se usan los hallazgos que John copió en el encargo. |
| Plantillas de Excel de carga | **No están.** Lo más cercano: `fc_contratos_servs_agregs_iniciales` y la hoja «Vlrs Agregs» de la plantilla que importa Contratos (vista el 2026-10-19). |
| Otra documentación | `Boveda LiciColba/01-analisis-y-propuesta.md` (209 campos clasificados por semáforo; su carpeta `02-mapping/` no está aquí), `informes/MapaCampos_LiciColba_Contratos.xlsx` (232 filas, base de la matriz). |
| Bases vivas (LiciColba y almacen) | **Sin acceso desde la nube.** La sesión de Claude en ANA-LICITACIONES3 sí lee, pero solo recibe mensajes de John: no se le puede pedir nada desde aquí. |

## Desviaciones frente al acta y al encargo

- El acta pide «importar desde LiciColba en Contratos». El puente no importa desde Contratos: es LiciColba quien escribe en las tablas que lee la pantalla Oferta Inicial. Para el usuario el efecto es el mismo (no hay plantilla), pero no existe un botón «Importar» en Contratos.
- Hay un `fc_ofertas_adjudicadas` por oferta y no por servicio. La tarifa puede tener varios `consec` (desde f18a086).
- El encargo propone upsert por `empresa + num_oferta + consec`. El diseño acordado con John (2026-10-14) es «lo enviado queda pactado»: un reenvío no reescribe nada y responde con la oferta existente. Se mantiene y se prueba que re-ejecutar no duplica (ver Decisiones).

## Decisiones

| # | Decisión | Alternativas | Motivo |
|---|---|---|---|
| D-1 | Subo la rama `fix/puente-licicolba-completitud` al repo de trabajo DevAndrew64/Integraciones_Lici. No se toca `main` ni GrupoColba. | No subir nada. | El contenedor de la nube se borra solo: sin push el trabajo se pierde. Es reversible (se borra la rama). |
| D-2 | Mantengo el reenvío 409 (sin upsert). | Upsert por empresa + num_oferta + consec. | Un upsert reescribiría una oferta que Contratos ya pudo editar a mano. La regla de John es no cambiar cómo trabaja Contratos. |
| D-3 | Todo lo que exige datos vivos queda «no verificado» y con su consulta lista en el informe. | Suponer. | Regla 1 del encargo. |
| D-4 | `codmun` de la tarifa = `codmun` de la UEN, el mismo que ya llevan las demás pestañas (d79c06e). | Dejarlo vacío. | Las otras tablas del envío ya usan ese valor y la pantalla lo muestra vacío. No es un relleno: es el dato real de la UEN. |
| D-5 | `personas` y `por_estampilla` siguen en 0. | `personas` = suma de cargos; `por_estampilla` = % de Estampillas del costeo. | El formulario manual (`cmdGrabar`) no graba `personas`. La unidad del % de estampillas no está verificada. Escribirlos sin evidencia sería rellenar. Queda para John. |
| D-6 | No ejecuto el UPDATE que repara las tarifas ya cargadas con `id_oferta_adjudicada = 0`. Queda en el informe. | Ejecutarlo. | Toca producción y no se puede deshacer limpio. |
| D-7 | Paro el código nuevo en esta rama y la dejo de referencia. | Seguir en paralelo. | La sesión de Claude en ANA-LICITACIONES3 hace el mismo encargo, con acceso a las bases, en `Licycolba-completitud` y la misma rama. Dos versiones se pisarían. |

## Fase 1 · `id_oferta_adjudicada` en 0

**Causa (confirmada, hipótesis 1).** El INSERT de `fc_contratos_tarifa_inicial` no incluía la columna, así que tomaba su `DEFAULT '0'`. Además la tarifa se insertaba antes que `fc_ofertas_adjudicadas`, así que su id todavía no existía.

Evidencia:
- Código: `planDeTarifa` (oferta.js) no generaba la columna. `escritor-mysql.js` armaba la tarifa antes de la transacción e insertaba la oferta después.
- Reproducción local (MariaDB en el contenedor, `test/mysql.integracion.test.js`): se esperaba 4 y salió 0. Tras ee44656 sale el id de la oferta, también con dos tarifas y con id manual.
- Datos vivos (los leyó la sesión de ANA): la 950 tiene `fc_ofertas_adjudicadas.id` = 10. Hay 10 ofertas cargadas por el puente con la tarifa en 0, de las empresas 01 y 02. La 950 está adjudicada (Solicitud 47, CERRADO_ADJUDICADO).
- No verificado: Transcolba (03). No hay oferta enviada.

**Arreglo:** ee44656. Ahora la oferta se inserta primero y su `insertId` va en cada fila de tarifa.

Reparación de las ya cargadas (**no ejecutada**, ver D-6):
```sql
UPDATE fc_contratos_tarifa_inicial t
JOIN fc_ofertas_adjudicadas oa ON oa.empresa=t.empresa AND oa.undnegocio=t.undnegocio AND oa.num_oferta=t.num_oferta
SET t.id_oferta_adjudicada=oa.id
WHERE t.user_add='LICICOLBA' AND t.id_oferta_adjudicada=0;
```

## Fase 2 · Pérdidas silenciosas encontradas (parcial)

| Hallazgo | Estado |
|---|---|
| Insumos sin código de elemento: no entraban a Insumos ni a la lista de precios, y no se avisaba (`fc_elemxcont` no tiene columna de descripción). | Ahora se avisa (0adf153). Su valor sigue en la tarifa. |
| Descripciones de equipos (>254) y de no continuos (>250) recortadas o vacías. | Ahora se avisa (0adf153). |
| `codmun` vacío en la tarifa. | Corregido (d79c06e). |
| `personas` = 0, `por_estampilla` = 0. | Pendiente de decisión (D-5). |
| `tar_dotacion` y `tar_examenes` = 0. | Correcto: van dentro de la mano de obra. |
| `ncontrato` vacío. | Campo rojo: lo asigna Contratos. |
| Ya conocidos: `nom_punto` AMBQ frente a BAQ; no continuos con frecuencia 13/14/15 dejan `cant_servs_contrato` en 0; `origen.procesoCodigo` no se guarda; plazo (compromiso #9). | Sin cambio, no verificados con datos. |
| Conceptos desconocidos → OTROS; no continuos sin código; EPP. | Ya avisaban. |

Pendiente, depende de datos vivos: `docs/matriz_campos.md` completa, conciliación de 5 ofertas por empresa (fase 4) y medición de velocidad (fase 5). Lo hace la sesión de ANA, que tiene acceso.
