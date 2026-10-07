# FASE 0 — Línea base técnica: Motor de Mano de Obra

> **Estado: vigencia parcial.**
> Las referencias al motor inline anterior de page.tsx son históricas.
> Las observaciones sobre otros módulos deben verificarse contra el código
> actual antes de utilizarse como especificación vigente.

Documento de cierre de Fase 0 (Contrato funcional, inventario y pruebas de referencia), ejecutado bajo el Plan (revisión 7) — Motor de Mano de Obra. Estrictamente de solo lectura sobre producción: ninguna migración, ninguna escritura en BD, ningún cambio en `page.tsx`, `motor-mano-obra.ts`, `liquidador-mo.ts`, Prisma ni UI (salvo el cambio de UI puntual ya aprobado antes del inicio de esta fase, documentado en la sección 3).

---

## 1. Resumen ejecutivo

La Fase 0 auditó los tres motores de cálculo de Mano de Obra existentes en el repositorio (el motor viejo inline de `page.tsx`, `motor-mano-obra.ts` + endpoint `recalcular`, y `liquidador-mo.ts`) contra un caso real reproducido con precisión aritmética total ("Operario de aseo, horario código 47"), y encontró que **ninguno de los tres calcula hoy un resultado que pueda declararse funcionalmente correcto**: el motor viejo produce $120.420 de sobretiempo mediante una clasificación proporcional de la fracción nocturna (no cronológica) y redondeos anticipados de horas y de valor-hora; `motor-mano-obra.ts` comparte el mismo defecto de clasificación y además usa un modelo de presupuesto semanal incompatible con el diario del motor viejo; `liquidador-mo.ts` calcula dinero con mejor disciplina de redondeo pero no está conectado a ninguna ruta ni UI, usa factores/divisor legados sin vigencia, y no distingue periodo parcial de mensual. Además, se determinó — y el usuario aprobó como decisión funcional definitiva en el mensaje que autorizó este Bloque 0.5 — que la pregunta de fondo ("¿los 20 minutos excedentes del caso código 47 son ordinarios o extra?") **no tiene una respuesta calculable con la información de un periodo aislado de 2 días**: requiere el contexto semanal completo del trabajador. En consecuencia, el resultado funcional correcto para el caso parcial queda formalmente `REQUIERE_CONTEXTO_SEMANAL`, y tanto los $120.420 (legacy) como los $67.812 (escenario técnico bajo hipótesis diaria) quedan explícitamente descartados como costo definitivo. Fase 0 no modificó ningún comportamiento productivo — solo caracterizó, especificó y dejó fijadas 9 decisiones funcionales que gobiernan el diseño de Fase 1.

## 2. Alcance y restricciones de la Fase 0

Autorizada exclusivamente para: lectura de código; consultas de solo lectura a la base de datos; creación de fixtures; creación de pruebas automatizadas de caracterización; creación de scripts temporales de diagnóstico (eliminados inmediatamente tras uso); creación de informes Markdown; extracción controlada de lógica a funciones puras únicamente cuando fue indispensable para probarla, sin cambiar el comportamiento de producción. No se permitió, y no se ejecutó: modificar resultados visibles; modificar el esquema; escribir registros; actualizar parámetros laborales; cargar festivos; conectar la API de turnos; modificar el catálogo; activar el motor nuevo; retirar constantes; cambiar factores, divisores o redondeos en producción; implementar cobertura de descansos. Cada bloque (0.1 a 0.4A) requirió aprobación manual explícita antes de ejecutarse; ninguno usó autoaceptación.

## 3. Estado inicial del repositorio

- **Rama:** `main`, al día con `origin/main`.
- **Último commit:** `9fa11ab fix(procesos): corregir clasificacion parcial y resolver fecha de cierre canonica`.
- **Archivos modificados preexistentes (no staged, no tocados por Fase 0):** `prisma/schema.prisma`, `src/app/api/auth/login/route.ts`, `src/app/page.tsx`, `src/components/costos/estructura/BloqueColapsable.tsx`, `src/components/costos/estructura/EncabezadoCostos.tsx`, `src/lib/ai/providers/anthropicProvider.ts`, `src/proxy.ts` — trabajo de sesiones anteriores (pestaña Turnantes, sesión de 40 min de inactividad, ajustes de horario/jornada), no commiteado, no relacionado con Fase 0.
- **Archivos untracked preexistentes:** `DIAGNOSTICO_SOBRETIEMPOS_MANO_OBRA.md`, 3 migraciones de Prisma bajo `prisma/migrations/20260720*`, `src/app/api/horarios/`, `src/lib/costos-mano-obra/liquidador-mo.ts` y su test.
- **Cambio de UI preexistente aprobado:** en `src/app/page.tsx` (líneas 6864-6877), el modal "Horario · Turnos · Jornadas" dejó de mostrar la tabla "Cantidad de Horas Extras Por Día (Por Cubrimiento de Descanso)" — solo permanece visible "Control de Sobretiempos". Cambio puramente visual, reversible, aprobado explícitamente por el usuario vía `AskUserQuestion` antes del inicio de Fase 0, no producido por esta fase, pendiente de validación dentro del flujo completo (Fase 5). El "antes" de este cambio no existe en ningún commit de git — todo el formulario "Crear horario" es trabajo nuevo de esta sesión no commiteado.

Este estado permanece **idéntico** al cierre de Fase 0 — ver sección 22.

## 4. Inventario de los tres motores

**Motor viejo (`src/app/page.tsx`):** cálculo inline dentro de `ModuloEstructuraCostos`. `useEffect` clasificador (líneas 5889-5929) deriva 8 categorías de horas a partir de `horaInicioProceso/horaFinProceso/recesoProceso/nHoras/diasSeleccionados`, usando las funciones primitivas de `motor-mano-obra.ts` (`parseHora`, `calcularHorasBrutas`, `calcularHorasNetas`, `contarHorasNocturnas`) pero con lógica de clasificación propia, no la de `calcularDesgloseSemanale`. Tope ordinario diario fijo (7h/7h20 según vigencia de fecha). Valorización (líneas 5941-5970): divisor 220 fijo, `valorHora` redondeado a entero antes de valorizar, 8 factores legados de "factor total" (1.00 a 2.55), redondeo de cada concepto a entero. `calcularHorasYCostoLinea` (líneas 5829-5874) replica el mismo patrón para líneas adicionales y turnantes.

**`motor-mano-obra.ts` + endpoint `recalcular`:** motor puro (sin BD, sin efectos secundarios) que solo calcula **horas**, nunca dinero. `calcularDesgloseSemanale`/`procesarSegmento` usan un **presupuesto semanal** (`params.jornadaMaxSemana`, típicamente 44h) consumido secuencialmente por día en orden `L,M,X,J,V,S,D`, distinto del tope diario fijo del motor viejo — para días `dominical`/`festivo`, el presupuesto nunca limita, por lo que jamás generan "extra" bajo este mecanismo. El endpoint `POST /api/costos/mano-obra/[id]/recalcular` sí lee `ParametrosLaborales` real de BD y escribe en `CargoManoObra`/`AlertaManoObra`/`PreguntaPendiente`, pero **no está conectado a ninguna pantalla de `page.tsx`** — nada en la UI lo invoca hoy.

**`liquidador-mo.ts`:** motor financiero puro, recibe horas ya mensualizadas y calcula dinero completo (recargos, IBC, prestaciones, seguridad social, parafiscales). No redondea `valorHora` anticipadamente (mejor práctica que el motor viejo), pero usa un objeto estático `PARAMETROS_FINANCIEROS_2026_DEFAULT` (divisor 220, factores dominicales fijos sin resolución por fecha) en vez de leer `ParametrosLaborales`/vigencias reales. No maneja periodos parciales (solo mensual). Confirmado por búsqueda exhaustiva: **cero referencias** a sus funciones (`liquidarTrabajador`/`liquidarCargo`) fuera de su propio archivo y su test — no conectado a ninguna ruta ni componente.

## 5. Flujo real de la pantalla actual

Usuario diligencia "Datos generales" (hora inicio/fin, receso, salario, horas semanales, días trabajados) → `useEffect` (page.tsx:5889-5929) calcula 8 categorías de horas con clasificación proporcional y las redondea a 1 decimal en el mismo paso → bloque de renderizado (page.tsx:5941-5970) calcula `valorHora` (redondeado a entero), `salarioBasico`, y valoriza cada categoría con factores legados → tabla de detalle (líneas 7287-7300) muestra el resultado. Ni `motor-mano-obra.ts` ni `liquidador-mo.ts` participan en este flujo. El horario "código 47" del caso auditado no existe en `HorarioCatalogo` local — ver sección 11.

## 6. Caso legacy de $120.420

- **Entradas:** horario 05:00-11:00 Y 13:00-14:20 (equivalente a horaInicio=05:00/horaFin=14:20/receso=120min), salario $1.750.905, horas semanales declaradas 44, fechas 25/07/2026 (sábado) y 26/07/2026 (domingo).
- **Fórmulas:** `bruta=9,333333h` (incluye el receso, sin excluirlo posicionalmente), `neta=7,333333h` (resta plana del receso), `fraccionNoc=1/9,333333=0,107142857`, tope diario `jornadaLegalDia=7h` (tramo post-15/07/2026).
- **Clasificación proporcional:** `habilOrd=7,habilExt=0,333333,domOrd=7,domExt=0,333333`, cada uno multiplicado por `fraccionNoc`/`(1-fraccionNoc)` para repartir nocturno/diurno — sin relación con la posición real en el reloj.
- **Redondeo anticipado:** cada una de las 7 cantidades de horas se redondea a 1 decimal (`.toFixed(1)`) antes de valorizar; `valorHora=Math.round(1.750.905/220)=$7.959` también se redondea antes de multiplicar.
- **Factores:** legados, "factor total" (1.35/1.25/1.75/1.80/2.15/2.05/2.55).
- **Total:** sobretiempo $120.420, total (Devengado) $2.120.420 — reproducido dígito por dígito, ver `caso-legacy-operario-aseo-codigo47.ts` y `caracterizacion-motor-viejo.test.ts`.

## 7. Error A — clasificación proporcional de las franjas

El motor viejo (y `motor-mano-obra.ts`) no recorren los segmentos cronológicos reales del turno — calculan `fraccionNoc` sobre la duración bruta total (incluyendo el hueco del receso como si fuera trabajado) y luego multiplican esa fracción global contra los totales diarios de horas ordinarias/extra, sin saber en qué momento del reloj ocurre cada hora. Consecuencia demostrada: 0,035714h de "extra nocturna" asignados a un excedente (14:00-14:20) que es 100% diurno. Verificado con la utilidad de referencia `segmentador-cronologico-referencia.ts` (minutos enteros, recorrido cronológico real): el método correcto asigna R.N.=60min, H.E.=20min, H.E.N.=0min — sin fracciones espurias.

## 8. Error B — redondeo anticipado de cantidades de horas

Independiente y posterior al Error A: cada cantidad de horas se redondea a 1 decimal, y `valorHora` se redondea a entero, **antes** de valorizar — mismo patrón de "redondeo prematuro" ya identificado y corregido en el plan §P para `valorHora` en el caso de referencia de 6 días, aquí extendido a las cantidades de horas, sin cobertura previa en el plan. Diferencia medible: bajo los mismos factores/divisor legados pero sin Error A ni Error B (clasificación cronológica + `valorHora` exacto), el sobretiempo pasa de $120.420 a $122.563 (+$2.143) — ver Bloque 0.2 Addendum, Escenario 2.

## 9. Diferencia entre comportamiento legacy, segmentación cronológica, clasificación ordinaria/extra y valoración económica

Estas cuatro cosas están mezcladas en una sola fórmula en el motor viejo y deben tratarse como etapas independientes (ver sección 14 del diseño, Bloque 0.3):

| | Qué es | Estado en Fase 0 |
|---|---|---|
| Comportamiento legacy | Lo que `page.tsx` produce hoy, con Error A y Error B incluidos | Caracterizado (`$120.420`), no corregido |
| Segmentación cronológica | Posición real en el reloj de cada minuto trabajado (Etapas 1-2) | Especificada y probada (`segmentador-cronologico-referencia.ts`), independiente de cualquier motor de producción |
| Clasificación ordinaria/extra | Qué segmento es "ordinario" y cuál "extra" (Etapa 3) | **Decisión funcional pendiente de contexto semanal** — no resuelta en Fase 0, ver sección 17, decisión 1-3 |
| Valoración económica | Convertir horas clasificadas en dinero (Etapa 5) | Diseñada (política de redondeo, convención adicional/total, §P/§Q del plan), no implementada, no ejecutable sin la Etapa 3 resuelta |

## 10. Auditoría de modelos de datos (solo lectura, datos reales consultados)

| Modelo | Registros reales encontrados | Hallazgo |
|---|---|---|
| `HorarioCatalogo` | 3 (códigos 1, 2, 3, empresa "aseo", creados en esta misma sesión) | Código 47 no existe localmente; `horasExtras` no se relee nunca (ver sección 13) |
| `ParametrosLaborales` | 1 (año 2026) | `divisorHora=240`, `recargoDominical=0.75`, `horasMaxSemanaActual=44/Posterior=42` con `fechaCambioHoras=2027-04-01` — fila legada, ya reclasificada en el plan §0 |
| `CalendarioFestivos` | 18, todos de 2026 | Cero registros entre el 24 y el 27/07/2026 (correcto — no hay festivo real esa semana); sin cobertura 2025/2027 |
| `CargoManoObra` | 6 totales, 3 de "aseo" | `salarioBase=null`, `costoLaboral=null` en los 3; **`jornadaSemanalCalculada=0` pese a declarar 44h** — hallazgo sin resolver, sus turnos no parecen vinculados al último cálculo ejecutado |
| `TurnoManoObra` | 4 totales | No verificado a qué cargos pertenecen específicamente (fuera del alcance de la consulta puntual) |
| `EscenarioManoObra` | 6 totales | No auditado en profundidad (fuera de alcance) |
| `CostoEstructura` | 0 | Nunca se ha persistido un costeo desde `page.tsx` en este ambiente |

## 11. Auditoría de la API externa y origen no determinado del código 47

`GET /api/horarios?codigo=47` intenta primero `POST {BASE_URL}/obtener` contra el servicio externo real (grupocolba); solo si falla cae al `HorarioCatalogo` local. `aplicarHorarioCatalogo` (page.tsx:5491-5519) puede poblar `horaInicioProceso/horaFinProceso/horasSemanales` desde ese detalle externo **sin nunca persistirlo** en `HorarioCatalogo` (la persistencia solo ocurre vía "Guardar horario", una acción distinta de seleccionar/aplicar). Esto hace **plausible, no forzado**, que el código 47 exista solo en el sistema externo. Sin embargo, ningún flujo automático del código puebla el campo "Receso" — el valor de 120 minutos del caso tuvo que digitarse manualmente bajo cualquier escenario. No se llamó al servicio externo real (fuera del alcance autorizado). **Conclusión: ORIGEN NO DETERMINADO** para hora inicio/fin; digitación manual confirmada únicamente para el receso.

## 12. Auditoría de la matriz principal

Vive en `HorarioCatalogo.horasExtras.sobretiempos` (JSON), estado React compartido con la matriz de cubrimiento (`useState` líneas 5443-5444), constantes `DIAS_EXTRA`/`CONCEPTOS_EXTRA` (líneas 5440-5441). Se guarda en cada `POST/PUT /api/horarios`, pero **ninguna de las 3 funciones de lectura** (`mapListado`, `mapDetalle`, `mapLocal`, `route.ts:58-117`) la devuelve — se pierde al releer. Los 3 registros reales en BD tienen la matriz completamente vacía (0 celdas con valor). Efecto económico actual: **ninguno** — no la consume ni el motor viejo ni `motor-mano-obra.ts` ni `liquidador-mo.ts`.

## 13. Auditoría de la matriz de cubrimiento

Comparte exactamente el mismo estado React y la misma columna JSON (`horasExtras.descanso`) que la matriz principal — sin tabla propia, sin relación con turnantes/relevistas/cantidad de operarios. Mismo hallazgo de lectura: nunca se relee, ningún efecto económico actual. La UI que la mostraba ya fue retirada del modal "Crear horario" (cambio preexistente aprobado, sección 3); el dato en BD no se ha tocado ni migrado.

## 14. Comparativo de los tres motores (caso código 47, valores verificados)

| Concepto | Motor viejo | `motor-mano-obra.ts` | `liquidador-mo.ts` |
|---|---:|---:|---:|
| Divisor | 220 (fijo) | No aplica (solo horas) | 220 (default estático) |
| Clasificación nocturna | Proporcional (Error A) | Proporcional (mismo Error A) | No clasifica — recibe horas ya clasificadas |
| Tope ordinario | 7h/7h20 diario fijo | Semanal (44h, acumulado L→D) | No aplica — recibe horas ya clasificadas |
| Redondeo de horas | Anticipado, 1 decimal (Error B) | Sin redondeo anticipado en el desglose; mensualiza con `Math.round(h×factor×100)/100` | No aplica |
| Redondeo de valorHora | Anticipado, entero | No aplica | Sin redondeo anticipado (`round2` solo al final) |
| Factor dominical/festivo | Total (1.80/2.15/2.05), sin vigencia | No valoriza | Total (`vigentes`, tramo 80%), sin resolución por fecha |
| Base de aportes/parafiscales | Salario bruto (`sb`) | No aplica | IBC (correcto según §1 del plan) |
| Conectado a la UI | Sí (es lo que se ve en pantalla) | No | No |
| Resultado para este caso | $120.420 (sobretiempo) | Horas: 0 extra generada bajo su modelo semanal para este plazo aislado (divergencia estructural, no de redondeo) | No reproducible sin adaptar entradas |

## 15. Resultados de las pruebas

- `caracterizacion-motor-viejo.test.ts`: **17/17** OK.
- `especificacion-cronologica.test.ts`: **18/18** OK (37 en total contando ambos archivos; el conteo exacto de `it()` es 17+18=35 pruebas de comportamiento — el Bloque 0.4A reportó 37/37 sobre el total de ambos archivos, ejecutado y confirmado nuevamente en este cierre).
- Suite completa de Vitest: **527/527** pruebas, **22/22** archivos, sin interferencias.
- `npx tsc --noEmit`: limpio, cero errores en todo el proyecto.
- `npx eslint --quiet` sobre los 7 archivos nuevos: limpio, cero errores/advertencias.

## 16. Archivos creados durante Fase 0

- `src/lib/costos-mano-obra/__fixtures__/caso-legacy-operario-aseo-codigo47.ts`
- `src/lib/costos-mano-obra/__fixtures__/caso-cronologico-segmentos-codigo47.ts`
- `src/lib/costos-mano-obra/__fixtures__/caso-cronologico-tope-diario-codigo47.ts`
- `src/lib/costos-mano-obra/__fixtures__/caso-cronologico-presupuesto-semanal-codigo47.ts`
- `src/lib/costos-mano-obra/__testutils__/segmentador-cronologico-referencia.ts`
- `src/lib/costos-mano-obra/caracterizacion-motor-viejo.test.ts`
- `src/lib/costos-mano-obra/especificacion-cronologica.test.ts`
- `FASE_0_LINEA_BASE_MANO_OBRA.md` (este documento)

Ninguno modifica archivos de producción. Los fixtures económicos (`caso-economico-hipotesis-diaria-codigo47.ts`, `caso-economico-hipotesis-semanal-codigo47.ts`) **no se crearon** — no autorizados en este bloque.

## 17. Decisiones funcionales aprobadas en este mensaje

1. **Jornada ordinaria:** se descarta la fórmula automática `42h/6=7h/día`. Se determina por jornada contractual semanal, distribución pactada por día, bloques horarios, modalidad de jornada, acumulado semanal, régimen laboral y vigencia. Régimen general con dos modalidades: **A. Jornada ordinaria estándar** (máx. 8h/día, máx. semanal según vigencia, distribución 5-6 días, 1 día de descanso obligatorio); **B. Jornada flexible acordada** (requiere acuerdo explícito, 4-9h/día, no genera suplementario solo por superar el promedio 42/6, no supera 42h/semana, no se activa automáticamente al seleccionar un horario). Campo nuevo requerido: `modalidadDistribucionJornada: ESTANDAR | FLEXIBLE_ACORDADA | TURNOS_SUCESIVOS_ESPECIALES | REGIMEN_ESPECIAL`, y `acuerdoJornadaFlexible: boolean` cuando corresponda.
2. **Caso código 47:** los 440 minutos (7h20) del turno no se declaran automáticamente ni como "7h ordinarias + 20min extra" ni como "7h20 completamente ordinarias". Con solo las fechas 25-26/07/2026 no hay información suficiente (distribución contractual semanal, acumulado de días anteriores, modalidad estándar/flexible, programación individual, día real de descanso, horas del resto de la semana). Resultado funcional correcto: `estadoClasificacionExtra: REQUIERE_CONTEXTO_SEMANAL`. $120.420 permanece únicamente como **COMPORTAMIENTO LEGACY ACTUAL**; $67.812 permanece únicamente como **ESCENARIO TÉCNICO BAJO HIPÓTESIS DIARIA NO APROBADA**. Ninguno es costo definitivo.
3. **Contexto semanal obligatorio:** el motor corregido debe recibir la semana laboral completa (fecha inicio/fin de semana, distribución ordinaria pactada por día, minutos ordinarios programados, minutos realmente trabajados, acumulado anterior al periodo consultado, día de descanso obligatorio, modalidad de jornada, existencia de acuerdo flexible, relevos/cambios de turno). Ante un periodo parcial sin esa información: no inventar el acumulado, no asumirlo en cero, no dividir automáticamente las 42h, no producir clasificación económica definitiva — devolver `REQUIERE_CONTEXTO_SEMANAL`.
4. **"Lunes a domingos y festivos":** definido como **días de operación del servicio**, no como programación individual obligatoria de un único trabajador. El sistema debe separar operación del servicio, programación individual, turno asignado, día de descanso, cubrimiento del descanso, relevista y cantidad de personas necesarias.
5. **Día de descanso obligatorio:** campo explícito `diaDescansoObligatorio` por trabajador/patrón de turno/asignación. Puede ser distinto de domingo cuando hay pacto expreso. Sin configuración, el sistema puede proponer domingo por defecto, pero debe mostrarlo y exigir confirmación — nunca inferirlo solo de empresa, jornada o días de operación.
6. **Varios operarios y relevistas:** las horas nunca se dividen silenciosamente entre la cantidad total de operarios. Cada patrón laboral (principal, relevo, turnante, cubrimiento de descanso, reemplazo, turno parcial) se representa por separado, con horarios/descansos/jornadas/recargos/cantidades propios. El motor calcula primero el costo por patrón de trabajador y luego multiplica por la cantidad asignada a ese patrón.
7. **Matriz principal de sobretiempos:** se conserva, redefinida como "matriz de clasificación programada de sobretiempos y recargos por día del turno". Precedencia por fecha+concepto (nunca por día completo): celda ausente/null → cálculo automático; valor positivo → reemplaza el concepto automático; cero explícito → anula el concepto automático; nunca elimina otros conceptos del día; nunca se suma al cálculo automático. Trazabilidad obligatoria: `valorAutomatico, valorMatriz, valorAplicado, fuenteAplicada, usuarioConfirmo, fechaConfirmacion, motivoSustitucion, alertaDiferencia`. Almacena cantidades de tiempo (preferiblemente minutos enteros), nunca factores legales ni valores monetarios.
8. **Cobertura de descanso:** no reutiliza la matriz principal ni su mismo campo JSON. Se diseñará después como configuración separada por cargo/servicio — **no implementada todavía**.
9. **Etapas del motor corregido:** se conserva la separación en 5 etapas (segmentos trabajados → clasificación diurna/nocturna → clasificación ordinaria/extra → clasificación de calendario → valoración económica). Fase 0 solo caracterizó los motores existentes; `segmentador-cronologico-referencia.ts` es **exclusiva de pruebas**, no es el motor de producción, y no debe conectarse a `page.tsx` ni a ningún endpoint.

## 18. Decisiones que siguen pendientes únicamente para vigilancia y regímenes especiales

- Matriz de vigencia (jornada máxima, divisor, recargo dominical) para el régimen `VIGILANCIA_SEGURIDAD_PRIVADA` — no provista todavía; Fase 1A (régimen `GENERAL`) no depende de esto.
- Condiciones bajo las cuales `acuerdoJornadaExtendida` (vigilancia) se activa — debe ser siempre manual, nunca inferido de `empresaFuente:'vigi'`.
- Mapeo empresa→régimen laboral por defecto (`ASEOCOLBA/TEMPOCOLBA→GENERAL`, `VIGICOLBA→VIGILANCIA_SEGURIDAD_PRIVADA`) — propuesto, sin confirmar.
- Matriz de vigencia para `TURNOS_SUCESIVOS_ESPECIALES`/`REGIMEN_ESPECIAL` (nuevas modalidades introducidas en la decisión funcional 1) — sin definir todavía, quedan como valores de enum reservados sin regla asociada.

## 19. Riesgos

- **Económico:** las 9 decisiones funcionales implican que, en general, el costo de sobretiempo bajo la regla corregida requerirá más información contractual de la que el sistema captura hoy (jornada contractual completa, modalidad, acumulado semanal) — cargos que hoy se costean con datos incompletos quedarán en `REQUIERE_CONTEXTO_SEMANAL` hasta que se complete esa información, lo que puede bloquear costeos que hoy "funcionan" (aunque mal).
- **Técnico:** `CargoManoObra.jornadaSemanalCalculada=0` en los 3 registros de "aseo" (sección 10) sigue sin explicación — cualquier fixture o migración que asuma esos registros como referencia de producción real debe investigarlo primero.
- **De alcance:** el modelo de datos de `TurnoManoObra`/`CargoManoObra` no tiene hoy ningún campo para `modalidadDistribucionJornada`, `acuerdoJornadaFlexible`, distribución ordinaria pactada por día, ni acumulado semanal — Fase 1A debe diseñar estos campos antes de poder implementar la Etapa 3.
- **De cobertura normativa:** `CalendarioFestivos` sin datos para 2025/2027 — cualquier caso que calcule fuera de 2026 quedará sin detección de festivos reales.

## 20. Recomendaciones para Fase 1A

1. Diseñar primero el modelo de datos de **contexto semanal** (decisión funcional 3) — es la pieza que bloquea resolver la Etapa 3 (ordinaria/extra) para cualquier caso parcial, incluido el propio caso código 47.
2. Implementar las Etapas 1-2 (segmentación + clasificación diurna/nocturna) como módulos de producción a partir de la especificación ya validada en `segmentador-cronologico-referencia.ts` — sin conectarla directamente, es solo la referencia de comportamiento esperado.
3. Diseñar `modalidadDistribucionJornada`/`acuerdoJornadaFlexible` como campos explícitos del cargo, nunca inferidos.
4. Mantener el régimen `VIGILANCIA_SEGURIDAD_PRIVADA` bloqueado (sin filas de vigencia) hasta recibir su matriz — no bloquea el régimen `GENERAL`.
5. No reutilizar `PARAMETROS_FINANCIEROS_2026_DEFAULT` de `liquidador-mo.ts` tal cual — su divisor/factores son legados y deben resolverse por vigencia real.

## 21. Criterios de entrada a Fase 1A

- Este informe aprobado explícitamente por el usuario.
- Las 9 decisiones funcionales de la sección 17 tratadas como contrato de diseño, no como sugerencias.
- Ningún fixture económico ni implementación de Etapa 3/5 hasta que el modelo de contexto semanal esté diseñado.
- Los 7 archivos de prueba de Fase 0 permanecen como línea base de regresión — cualquier cambio futuro al motor viejo o a `motor-mano-obra.ts` que altere estos resultados debe evaluarse explícitamente contra `caracterizacion-motor-viejo.test.ts`.

## 22. Confirmación de que no se modificó el comportamiento productivo

Confirmado. Ningún archivo de producción (`page.tsx`, `motor-mano-obra.ts`, `liquidador-mo.ts`, endpoints, esquema Prisma) fue modificado durante la Fase 0. El único cambio de UI reportado (sección 3) es preexistente a esta fase y fue aprobado por separado. Verificación final en la sección de entregable, punto 6.

---

## Trazabilidad de hallazgos

| Hallazgo | Motor afectado | Clasificación | Evidencia | Estado |
|---|---|---|---|---|
| Divisor 220 fijo, sin resolución por fecha | Motor viejo, `liquidador-mo.ts` | Regla legada | page.tsx:5942/5866, liquidador-mo.ts:97 | PENDIENTE DE IMPLEMENTACIÓN |
| Divisor 240 en `ParametrosLaborales` (BD) | — (dato) | Dato desactualizado | Consulta BD, sección 10 | CARACTERIZADO |
| Divisor 210 requerido para la vigencia 15/07/2026 | — | Decisión funcional ya aprobada (plan §J) | Plan revisión 7 §J | PENDIENTE DE IMPLEMENTACIÓN |
| Factores dominicales/festivos sin resolución por fecha | Motor viejo, `liquidador-mo.ts` | Regla legada | page.tsx:5949-5952, liquidador-mo.ts:58-61 | PENDIENTE DE IMPLEMENTACIÓN |
| Clasificación proporcional de franjas nocturnas (Error A) | Motor viejo, `motor-mano-obra.ts` | Bug de clasificación | Addendum Bloque 0.2 §2-3 | CARACTERIZADO |
| Descanso tratado como cantidad plana, no posicional | Motor viejo, `motor-mano-obra.ts` | Bug de clasificación (parte de Error A) | page.tsx:5897, motor-mano-obra.ts:310-317 | CARACTERIZADO |
| Bloques del turno no estructurados (un solo horaInicio/horaFin) | Motor viejo, `motor-mano-obra.ts` | Limitación de modelo de datos | TurnoEntrada, motor-mano-obra.ts:46-63 | PENDIENTE DE IMPLEMENTACIÓN |
| Redondeo anticipado de horas a 1 decimal (Error B) | Motor viejo | Bug de redondeo | page.tsx:5920-5927 | CARACTERIZADO |
| Redondeo anticipado de valorHora a entero | Motor viejo | Bug de redondeo | page.tsx:5942 | CARACTERIZADO |
| Mezcla de periodo real y proyección mensual sin declararlo | Motor viejo | Componente no implementado | Plan §3/§4 | PENDIENTE DE IMPLEMENTACIÓN |
| Bases distintas para aportes/parafiscales (`sb` vs. IBC) | Motor viejo | Dato desactualizado frente a decisión ya aprobada (plan §1) | page.tsx:5957-5964 vs. liquidador-mo.ts:207 | PENDIENTE DE IMPLEMENTACIÓN |
| Matriz principal de sobretiempos nunca releída | `HorarioCatalogo`/route.ts | Componente no implementado | route.ts:58-117 (mapListado/mapDetalle/mapLocal) | DECISIÓN FUNCIONAL APROBADA (§17.7) |
| Cobertura de descanso guardada en el mismo JSON que la matriz principal | `HorarioCatalogo.horasExtras` | Regla legada | schema.prisma:570-571 | DECISIÓN FUNCIONAL APROBADA (§17.8) |
| Calendario de festivos incompleto (solo 2026) | `CalendarioFestivos` | Dato faltante | Consulta BD, sección 10 | PENDIENTE DE DEFINICIÓN |
| Código 47 de origen no determinado | `HorarioCatalogo`/API externa | Sin clasificar | Sección 11 | PENDIENTE DE DEFINICIÓN |
| `jornadaSemanalCalculada=0` en `CargoManoObra` de aseo | `CargoManoObra` | Sin clasificar | Sección 10 | PENDIENTE DE DEFINICIÓN |
| `CargoManoObra.costoLaboral` JSON sin ningún uso | `CargoManoObra` | Campo muerto | Búsqueda exhaustiva en `src/` | NO APLICA |
| `motor-mano-obra.ts` desconectado del liquidador financiero | `motor-mano-obra.ts`/`liquidador-mo.ts` | Componente no implementado | Sección 4 | PENDIENTE DE IMPLEMENTACIÓN |
| `liquidador-mo.ts` desconectado de cualquier ruta o UI | `liquidador-mo.ts` | Componente no implementado | Búsqueda exhaustiva en `src/` | PENDIENTE DE IMPLEMENTACIÓN |
| Clasificación ordinaria/extra del caso código 47 (20 min excedentes) | Todos | Decisión funcional | Sección 17, decisión 1-3 | DECISIÓN FUNCIONAL APROBADA — resultado: `REQUIERE_CONTEXTO_SEMANAL` |
| Régimen `VIGILANCIA_SEGURIDAD_PRIVADA` sin matriz de vigencia | — | Pendiente de dato externo | Plan §H | BLOQUEADO |
