# Diseño — Formulario guiado de captura del requisito operativo (Mano de Obra)

**Fecha:** 2026-07-14 · **Alcance:** exclusivamente Mano de Obra de ASEOCOLBA, sección "Requisito operativo".
**Fuera de alcance:** EPP, dotación, exámenes, maquinaria, costos administrativos, otras pestañas, fórmulas financieras, `ParametrosLaborales`.
**Estado:** APROBADO con 12 ajustes (2026-07-14) — autorizadas MO-F1 a MO-F4. MO-F5 (integración en `page.tsx` + liquidación) **no autorizada todavía**.
**Depende de:** `docs/plan-implementacion-mano-obra.md` (MO-1/MO-2/MO-3 ya implementados: `tipos-mo-v2.ts`, `schema-mo-v2.ts`, `liquidador-mo.ts`, `motor-mano-obra.ts` extendido). Este documento diseña la **captura** (MO-0, anterior a MO-4 en el orden de dependencia); MO-4/5/6 consumen su salida.

---

## 0. Ajustes aprobados (2026-07-14) — reemplazan las secciones correspondientes abajo

1. **Confirmación explícita**: ningún campo pasa a `confirmado` por blur. `EstadoCampo` reemplaza el booleano `confirmado`: `'pendiente' | 'capturado' | 'confirmado' | 'contradiccion' | 'no_aplica'`. Solo el usuario, confirmando el campo o el resumen del cargo, mueve algo a `'confirmado'`.
2. **Orden del cuestionario**: operativo primero (cargo → ciudad → sedes → cantidad solicitada → días → horarios → descanso → domingos → festivos → cobertura continua → trabajadores por turno → condiciones especiales); salario/ARL/auxilio van al final, no bloquean el avance.
3. **Fuente principal en modo formulario**: los datos estructurados mandan; el texto generado es narrativa/vista previa/entrada para Claude, no la fuente de verdad.
4. **Rol de Claude acotado**: valida inconsistencias, horarios complejos, cruces de medianoche, bloques continuos, multi-cargo/turno, relevo/turnante, información faltante, escenarios — no reinfiere campos simples ya confirmados.
5. **Sin placeholders en el texto**: `generarRequisitoDesdeFormulario` omite cláusulas de campos sin dato — nunca escribe `[cargo sin definir]`. Para Claude se arma un payload separado `{ datosConfirmados, datosPendientes, requisitoNarrativo }`.
6. **4 opciones por pregunta**: responder / no informado / pendiente de validar / no aplica → mapean a `capturado` / `pendiente` / `capturado` (con confirmación diferida) / `no_aplica`.
7. **Sin campo "Jornada" libre**: se elimina como input independiente; la jornada descriptiva sale siempre de días+horarios+descanso+cobertura vía el generador.
8. **Cobertura continua = bloque único**: `diaInicio/horaInicio/diaFin/horaFin/duracionExactaHoras/cruzaMedianoche/cruzaVariosDias/condicionFestiva`, reutilizando `expandirBloqueContinuo`/`calcularHorasBloqueContinuo` del motor (MO-3) — nunca se divide el cálculo a las 23:59; la tabla solo lo *muestra* partido por día.
9. **Edición del texto no sobrescribe en silencio**: se detecta diferencia campo a campo y se ofrece mantener formulario / usar texto / editar manual (mismo banner de contradicciones §5), no un re-análisis automático.
10. **`CampoConEstado` usa `estado: EstadoCampo`**, no un booleano.
11. **Cantidad de trabajadores en 3 campos**: `solicitada` (usuario), `calculada` (motor, no editable directo), `confirmadaParaCosteo` (la que se usa) — nunca se pisa `solicitada` con lo que calcule el motor.
12. **Fases autorizadas ahora: MO-F1 a MO-F4.** MO-F5 (integrar en `page.tsx`, conectar liquidación) queda pendiente de autorización aparte.

Las secciones 1–10 originales quedan como contexto de diseño general; donde haya conflicto, **manda esta sección 0**.

---

## 1. Diseño visual

### 1.0. Punto de entrada — botón en el bloque "Requisito operativo" actual

Sobre la UI que ya existe hoy (textarea + "Analizar con IA"), se agrega un botón nuevo en la
misma barra inferior, a la izquierda del botón "Analizar con IA":

```
┌─────────────────────────────────────────────────────────────────┐
│  REQUISITO OPERATIVO                                             │
│  Describe el turno o requisito operativo — Ej. Vigilante...      │
│  [......................... textarea .......................]   │
├─────────────────────────────────────────────────────────────────┤
│ La IA extrae horas y recargos automáticamente                    │
│                        [📋 Diligenciar por preguntas] [⚡Analizar IA]│
└─────────────────────────────────────────────────────────────────┘
```

Click en **"Diligenciar por preguntas"** abre el **cuestionario guiado** (modal, mismo estilo
que el modal "Resumen del análisis operativo" ya existente): una pregunta a la vez, con
botones Atrás/Siguiente, que va acumulando `CargoFormularioMO` (§2) pregunta por pregunta.
Al terminar (o al cerrar en cualquier punto — se guarda el progreso), genera el texto
(§3) y lo deja en el textarea, exactamente igual que si el usuario lo hubiera escrito
a mano — el modo "Formulario guiado" de una sola página (§1.1) queda como **vista de
resumen/edición** de lo que el cuestionario ya recolectó, no como una segunda forma de
captura separada.

**Por qué cuestionario y no un formulario de una sola pantalla:** son la misma estructura
de datos (§2) con dos interacciones distintas. El cuestionario reduce la carga cognitiva
inicial (una decisión a la vez, con la pregunta siguiente ajustada a lo ya respondido —
ej. si "cobertura continua" se marca, la siguiente pregunta pide día/hora de fin); el
formulario de resumen sirve para revisar/editar todo junto antes de generar el texto o
tras que Claude devuelva su interpretación. Ambos operan sobre el mismo `CargoFormularioMO`.

### 1.0.1. Guion del cuestionario (orden de preguntas)

Cada pregunta corresponde a uno o más campos de `CargoFormularioMO` (§2). El orden agrupa
por sección (Datos generales → Programación → Condiciones especiales) y salta preguntas
no aplicables según respuestas previas (ej.: si "auxilio" = "no aplica", no pregunta el
modo proporcional; si "cobertura continua" = no, no pregunta día/hora de fin extendido):

```
1.  ¿Qué cargo se requiere?                         → cargo
2.  ¿En qué ciudad?                                 → ciudad
3.  ¿Cuántas sedes?                                 → numeroSedes
4.  ¿Cuántos trabajadores?                          → cantidadTrabajadores
5.  ¿Cuál es el salario base mensual? (opcional)     → salarioBaseMensual
6.  ¿Clase de riesgo ARL? (opcional, sugerible)      → arl
7.  ¿Auxilio de transporte?  aplica/no aplica/       → auxilioTransporte
    proporcional/pendiente
— Programación (repite por cada turno; al final: "¿Agregar otro turno?") —
8.  ¿Qué días de la semana?                         → turno.diasSemana
9.  ¿Hora de inicio? ¿Hora de fin?                  → turno.horaInicio/horaFin
10. ¿Hay descanso? ¿Cuántos minutos? ¿Remunerado?    → turno.descansoMinutos/Remunerado
    (si el usuario no sabe → queda pendiente, NUNCA se asume 0)
11. ¿Trabaja domingos? ¿Cuántos al mes?             → turno.domingosMes
12. ¿Incluye festivos?                              → turno.festivosIncluidos
13. ¿Es una cobertura continua de varios días        → activa sub-cuestionario
    (ej. sábado a lunes)?                              BloqueContinuoMOv2
14. ¿Cuántos trabajadores en este turno? ¿Qué sede?  → turno.cantidadTrabajadores/sede
    (si hay varias sedes)
15. ¿Agregar otro turno?                            → vuelve a 8, o continúa
— Condiciones especiales (una pregunta multi-selección) —
16. ¿Aplica alguna de estas condiciones? [alturas]   → actividadesEspeciales
    [alimentos] [químicos] [nocturno] [conducción]
    [requiere relevo]
17. ¿Observaciones adicionales? (opcional)           → observaciones
— Cierre —
18. Vista previa del requisito generado (§3) +        → confirmar / editar texto /
    completitud (§8) + [Generar y continuar]            volver a una pregunta
```

Navegación: "Atrás" vuelve a la pregunta anterior sin perder lo ya respondido; el modal
muestra progreso ("Pregunta 8 de ~18") y permite saltar a "Vista previa" en cualquier
momento (equivalente a "terminar por ahora, completar después" — coherente con que el
borrador se puede guardar incompleto, §8). Cerrar el modal a mitad de camino no descarta
las respuestas: quedan en `CargoFormularioMO` con su `fuente:'formulario'` normal.

### 1.1. Formulario guiado — vista de resumen/edición (sin cambios respecto al diseño previo)

```
┌─────────────────────────────────────────────────────────────────┐
│  Requisito operativo                                             │
│  [ Formulario guiado ]  [ Escribir requisito ]      ← selector   │
├─────────────────────────────────────────────────────────────────┤
│  (modo Formulario guiado)                                        │
│                                                                    │
│  DATOS GENERALES                                                  │
│  ┌───────────────┬───────────┬──────────┬──────────┬───────────┐│
│  │ Cargo         │ Ciudad    │ N.° sedes│ Trabaj.  │ Salario   ││
│  │ [Operario▾]   │ [Baq  ▾]  │ [1]      │ [2]      │ [$______] ││
│  └───────────────┴───────────┴──────────┴──────────┴───────────┘│
│  ARL: [Riesgo II ▾]   Auxilio: (•)Aplica ( )No aplica            │
│                        ( )Proporcional ( )Pendiente               │
│                                                                    │
│  PROGRAMACIÓN                          [+ Agregar turno]          │
│  ┌─ Turno 1 ──────────────────────────────────────────┐          │
│  │ Días: [L][M][X][J][V][ ][ ]  Inicio [08:00] Fin[17:00]│       │
│  │ Descanso [60] min  ☐ remunerado                      │        │
│  │ Domingos: [0/mes]  ☐ Festivos incluidos              │        │
│  │ ☐ Cobertura continua (multi-día) → [expande sub-form]│        │
│  │ Trabajadores en este turno: [2]  Sede: [Principal▾]  │        │
│  │                                          [Duplicar][✕]│        │
│  └───────────────────────────────────────────────────────┘       │
│                                                                    │
│  CONDICIONES ESPECIALES                                           │
│  ☐ Alturas ☐ Alimentos ☐ Químicos ☐ Nocturno ☐ Conducción         │
│  ☐ Horarios distintos por día  ☐ Varias sedes  ☐ Requiere relevo  │
│  Observaciones: [________________________________]                │
│                                                                    │
│  Completitud del requisito: ▓▓▓▓▓▓▓▓░░ 8 de 10 campos confirmados │
│                                                                    │
│  [Generar requisito]  [Limpiar]                                   │
├─────────────────────────────────────────────────────────────────┤
│  Requisito generado (editable, vínculo con datos estructurados)  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ "Se requieren 2 operarios de aseo en Barranquilla para    │    │
│  │  una sede, de lunes a viernes, de 08:00 a.m. a 05:00 p.m.,│    │
│  │  con 60 minutos de descanso no remunerado. Aplica auxilio│    │
│  │  de transporte. Clase de riesgo sugerida: Riesgo II."     │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                          [⚡ Analizar con IA]     │
└─────────────────────────────────────────────────────────────────┘
```

**Modo "Escribir requisito"**: el textarea libre actual (sin cambios visuales), con el mismo botón "Analizar con IA". Al analizar, si Claude extrae campos, el sistema **cambia automáticamente al modo Formulario guiado** con los campos pre-llenados y marcados `fuente: 'IA'` para revisión — nunca deja el resultado solo en el texto sin pasar por el panel de campos.

**Multi-cargo**: encima de "DATOS GENERALES" va una lista de pestañas/acordeón de cargos (`[Cargo 1: Operario de Aseo] [Cargo 2: Conserje] [+ Agregar cargo]`), cada una con su propio bloque completo (Datos generales + Programación + Condiciones especiales + Completitud). "Duplicar cargo" clona todo el bloque con `fuente` reseteada a `'manual'` en los campos copiados (para que el usuario los revise, no arrastrar confirmaciones de otro cargo).

**Indicador de campo por fuente** (chip pequeño junto a cada input): 🖊 manual · 📄 texto · 🤖 IA · 📚 catálogo · ⏳ pendiente. Click en el chip abre el detalle (valor anterior si fue sobrescrito, nivel de confianza).

---

## 2. Modelo de datos

Reutiliza el modelo `CargoMOv2`/`TurnoMOv2`/`BloqueContinuoMOv2` ya implementado en `tipos-mo-v2.ts` (MO-1) — **no se crea un modelo paralelo**. Se agrega un wrapper de estado por campo, y un tipo de "formulario" que envuelve el cargo con ese estado.

```ts
// src/lib/costos-mano-obra/tipos-formulario-mo.ts (NUEVO)

export type FuenteCampo = 'formulario' | 'texto' | 'IA' | 'catalogo' | 'manual' | 'pendiente';

export interface CampoConEstado<T> {
  valor: T;
  fuente: FuenteCampo;
  confirmado: boolean;
  modificado: boolean;          // true si el usuario cambió lo que vino de IA/catálogo
  confianza: 'alto' | 'medio' | 'bajo';
}

function campoPendiente<T>(valorVacio: T): CampoConEstado<T> {
  return { valor: valorVacio, fuente: 'pendiente', confirmado: false, modificado: false, confianza: 'bajo' };
}

// Espejo de CargoMOv2, campo por campo envuelto en CampoConEstado.
// Los arrays (turnos, actividadesEspeciales) llevan estado a nivel de la lista completa,
// no por elemento — granularidad suficiente para el panel de revisión.
export interface CargoFormularioMO {
  id: string;
  cargo: CampoConEstado<string>;                 // cargoDetectado/cargoNormalizado combinados en UI
  ciudad: CampoConEstado<string>;
  numeroSedes: CampoConEstado<number | null>;
  cantidadTrabajadores: CampoConEstado<number | null>;
  salarioBaseMensual: CampoConEstado<number | null>;
  arl: CampoConEstado<'I' | 'II' | 'III' | 'IV' | 'V' | null>;
  auxilioTransporte: CampoConEstado<'aplica' | 'no_aplica' | 'proporcional' | 'pendiente'>;
  turnos: CampoConEstado<TurnoFormularioMO[]>;
  actividadesEspeciales: CampoConEstado<ActividadEspecial[]>;
  observaciones: CampoConEstado<string>;
  requisitoGenerado: string;                     // texto editable, SIEMPRE vinculado a este objeto
  requisitoEditadoManualmente: boolean;           // true si el usuario tocó el texto tras generarlo
}

export interface TurnoFormularioMO extends TurnoMOv2 {
  numeroTurno: number;
  coberturaContinua: BloqueContinuoMOv2 | null;   // sub-formulario expandible cuando se marca el checkbox
  requiereRelevo: boolean;
}

export interface FormularioMOState {
  modo: 'formulario' | 'texto';
  cargos: CargoFormularioMO[];
  cargoActivoId: string;
  estadoCosteo: 'borrador' | 'listo_para_calculo' | 'confirmado'; // ya definido en el plan MO
}

// Estado del modal de cuestionario (§1.0.1) — separado de FormularioMOState porque es
// puramente de navegación/UI; al cerrar el modal, lo único que persiste es el
// CargoFormularioMO ya actualizado (el wizard no tiene estado propio de negocio).
export type PreguntaId =
  | 'cargo' | 'ciudad' | 'numeroSedes' | 'cantidadTrabajadores' | 'salario' | 'arl' | 'auxilio'
  | 'turnoDias' | 'turnoHorario' | 'turnoDescanso' | 'turnoDomingos' | 'turnoFestivos'
  | 'turnoCoberturaContinua' | 'turnoTrabajadoresSede' | 'turnoAgregarOtro'
  | 'condicionesEspeciales' | 'observaciones' | 'vistaPrevia';

export interface CuestionarioMOState {
  abierto: boolean;
  cargoId: string;
  preguntaActual: PreguntaId;
  historialPreguntas: PreguntaId[];  // pila para "Atrás"
  turnoEnEdicion: number;            // índice del turno que el sub-guion 8-15 está llenando
}
```

**Por qué envolver en vez de reusar `CargoMOv2` directo:** `CargoMOv2` (schema Zod, MO-1) es el contrato de **intercambio con la IA** — debe seguir siendo plano para que `.strict()` lo valide sin ambigüedad. `CargoFormularioMO` es el estado de **UI**; se **proyecta hacia** `CargoMOv2` (función `aCargoMOv2()`) antes de llamar al extractor/liquidador, y se **reconstruye desde** `CargoMOv2` (función `desdeExtraccionIA()`) cuando la IA devuelve resultados. Mantiene MO-1 sin tocar.

---

## 3. Función `generarRequisitoDesdeFormulario`

Determinística, sin IA, pura (mismo espíritu que `motor-mano-obra.ts`: cero llamadas externas).

```ts
// src/lib/costos-mano-obra/generador-requisito.ts (NUEVO)

export function generarRequisitoDesdeFormulario(cargo: CargoFormularioMO): string {
  const partes: string[] = [];

  // Cantidad + cargo (obligatorios; si faltan, frase genérica marcando el vacío)
  const n = cargo.cantidadTrabajadores.valor;
  const nombreCargo = cargo.cargo.valor || '[cargo sin definir]';
  partes.push(`Se requiere${n && n > 1 ? 'n' : ''} ${n ?? '[cantidad sin definir]'} ${pluralizar(nombreCargo, n)}`);

  // Ciudad + sedes
  if (cargo.ciudad.valor) {
    const sedes = cargo.numeroSedes.valor;
    partes.push(`en ${cargo.ciudad.valor}${sedes ? ` para ${sedes === 1 ? 'una sede' : `${sedes} sedes`}` : ''}`);
  }

  // Programación (una cláusula por turno; turnos con cobertura continua usan
  // la redacción "desde <día> <hora> hasta <día> <hora>", igual que el patrón
  // ya usado en prompt-mo.ts para bloques continuos)
  for (const turno of cargo.turnos.valor) {
    partes.push(', ' + describirTurno(turno)); // "de lunes a viernes, de 08:00 a.m. a 05:00 p.m."
  }

  // Descanso (solo si está definido — igual que el motor, NUNCA inventa)
  const turnoConDescanso = cargo.turnos.valor.find(t => t.descansoMinutos != null);
  if (turnoConDescanso) {
    partes.push(`, con ${turnoConDescanso.descansoMinutos} minutos de descanso ${turnoConDescanso.descansoRemunerado ? 'remunerado' : 'no remunerado'}`);
  }

  // Auxilio
  const AUX_TEXTO = { aplica: 'Aplica auxilio de transporte.', no_aplica: 'No aplica auxilio de transporte.', proporcional: 'Auxilio de transporte proporcional.', pendiente: '' };
  if (AUX_TEXTO[cargo.auxilioTransporte.valor]) partes.push(' ' + AUX_TEXTO[cargo.auxilioTransporte.valor]);

  // ARL (siempre como sugerencia, nunca como afirmación cerrada)
  if (cargo.arl.valor) partes.push(` Clase de riesgo sugerida: Riesgo ${cargo.arl.valor}.`);

  // Condiciones especiales y observaciones al final, una frase por cada una activa
  partes.push(...describirCondicionesEspeciales(cargo.actividadesEspeciales.valor));
  if (cargo.observaciones.valor) partes.push(` ${cargo.observaciones.valor}`);

  return capitalizar(partes.join('')).trim();
}
```

**Reglas duras** (idénticas al espíritu de `prompt-mo.ts`/MO-1 — "no inventar"):
- Un campo `pendiente` (sin valor) genera un placeholder visible en el texto (`[cantidad sin definir]`), **nunca** un valor por defecto (nunca asume 44h, nunca asume ARL II).
- Formato de hora: reusa `formatHora12h()` (nuevo helper, mismo criterio que `<input type="time">` ya usado en la UI — `08:00`→`08:00 a.m.`).
- La función es **idempotente**: mismo `CargoFormularioMO` → mismo texto, siempre. Esto es lo que permite detectar contradicciones (§5): se compara el texto que el motor generaría *ahora* contra el texto que el usuario tiene en pantalla.

---

## 4. Reglas de prioridad de fuentes

Orden fijo, aplicado campo por campo (no por objeto completo) al fusionar una fuente nueva sobre el estado existente:

```
1. formulario   — el usuario llenó el campo a mano en el formulario guiado y lo confirmó
2. texto        — el usuario editó el texto libre y ese campo se re-extrajo de ahí
3. IA           — Claude/Gemini lo dedujo del texto, sin edición humana posterior
4. catálogo     — vino de normalizacion-mo.ts (alias de cargo/ciudad), no del requisito
5. pendiente    — sin valor
```

**Algoritmo de fusión** (`fusionarCampo<T>`):

```ts
function fusionarCampo<T>(actual: CampoConEstado<T>, propuesto: { valor: T; fuente: FuenteCampo }): CampoConEstado<T> {
  const rango: Record<FuenteCampo, number> = { formulario: 1, texto: 2, IA: 3, catalogo: 4, manual: 1, pendiente: 5 };

  // Un campo YA CONFIRMADO por el usuario (fuente formulario/texto/manual) nunca se
  // pisa automáticamente con algo de rango igual o menor prioridad (IA/catálogo).
  if (actual.confirmado && rango[propuesto.fuente] >= rango[actual.fuente]) {
    return actual; // la IA no reemplaza sin avisar — ver §5 contradicciones
  }
  return { valor: propuesto.valor, fuente: propuesto.fuente, confirmado: false, modificado: actual.fuente !== 'pendiente', confianza: propuesto.fuente === 'IA' ? 'medio' : 'alto' };
}
```

Esto es exactamente el comportamiento que pide "Claude no debe reemplazar datos confirmados del formulario sin avisar": un campo con `confirmado:true` es intocable por fusión automática; solo se actualiza vía §5 (contradicción explícita, resuelta por el usuario).

---

## 5. Manejo de contradicciones

Se activa cuando `fusionarCampo` detecta que el valor propuesto (IA) **difiere** del valor actual **confirmado**:

```ts
interface ContradiccionCampo {
  campo: keyof CargoFormularioMO;
  valorFormulario: unknown;
  valorIA: unknown;
  resuelta: boolean;
}
```

**UI de contradicción** (banner igual de estilo al ya usado en el modal "Resumen del análisis operativo"):

```
⚠ Claude detectó una diferencia en "Salario base"
  Formulario: $1.750.905      Texto/IA: $1.800.000
  [Mantener formulario]  [Usar valor de IA]  [Editar manualmente]
```

No se aplica **ningún** lado automáticamente; el campo queda en un estado transitorio `contradiccion: true` (no bloquea el resto del formulario, pero sí cuenta como campo NO confirmado para la completitud §8 y para el estado `listo_para_calculo`).

---

## 6. Flujo Formulario → IA

```
1. Usuario llena DATOS GENERALES + PROGRAMACIÓN + CONDICIONES ESPECIALES
   (cada campo tocado → fuente:'formulario', confirmado:true al salir del input — blur)
2. Click "Generar requisito" → generarRequisitoDesdeFormulario(cargo) → texto al textarea
   (requisitoEditadoManualmente:false)
3. Usuario puede editar el texto libremente → requisitoEditadoManualmente:true
   (a partir de aquí el texto es la fuente de verdad narrativa, pero el objeto
   estructurado NO se toca todavía — el vínculo se mantiene, ver §2)
4. Click "Analizar con IA" → POST al extractor v2 (MO-1) con el texto actual
5. Respuesta de Claude se fusiona campo a campo (§4) contra CargoFormularioMO
   → contradicciones detectadas se muestran (§5); resto se aplica con fuente:'IA'
6. Alertas/preguntas de Claude (turnos complejos, cruces de medianoche, cobertura
   continua, necesidad de relevo/turnante) se muestran en el panel de revisión
   ya existente (modal "Resumen del análisis operativo"), sin cambios de ese modal
```

## 7. Flujo Texto → Formulario

```
1. Usuario pega/escribe un requisito completo en modo "Escribir requisito"
2. Click "Analizar con IA" → extractor v2 (multi-cargo, MO-1)
3. Por cada cargo devuelto, se construye un CargoFormularioMO nuevo
   (desdeExtraccionIA()), TODOS los campos con fuente:'IA', confirmado:false
4. La UI cambia automáticamente a modo "Formulario guiado" con esos cargos
   cargados — el usuario revisa/confirma campo por campo (mismo panel que §6.6)
5. Si el texto tenía varios cargos → aparecen como pestañas separadas (multi-cargo, §"MULTI-CARGO")
6. Nada se marca confirmado sin acción humana — evita que "texto libre" alimente
   el cálculo sin pasar por revisión, igual que exige el plan de MO-1
```

---

## 8. Validaciones

**Guardar como borrador**: sin restricciones — cualquier `CargoFormularioMO`, aunque todos sus campos estén `pendiente`, se puede guardar (mismo criterio que el estado `borrador` ya definido en `docs/plan-implementacion-mano-obra.md` §3).

**Campos obligatorios para pasar a `listo_para_calculo`** (deben estar `confirmado:true`, sin `contradiccion` abierta):
`cargo, ciudad, cantidadTrabajadores, numeroSedes, turnos (≥1 con días+horas), salarioBaseMensual, arl, auxilioTransporte` — y si `requiereTurnante`/cobertura compleja (calculado por el motor, MO-3): además `distribucion` confirmada por el usuario.

**Costeo definitivo (`confirmado`)**: además de lo anterior, cero preguntas críticas pendientes (mismo criterio ya definido en el plan MO, §12).

**Indicador de completitud** (§ interfaz del pedido): `camposConfirmados / camposObligatorios` — recalculado en cada blur/fusión, mostrado como barra + texto ("8 de 10 campos confirmados").

---

## 9. Archivos a modificar/crear

| Archivo | Cambio | Nuevo |
|---|---|---|
| `src/lib/costos-mano-obra/tipos-formulario-mo.ts` | Modelo §2 (`CampoConEstado`, `CargoFormularioMO`, `FormularioMOState`) | ✅ |
| `src/lib/costos-mano-obra/generador-requisito.ts` | `generarRequisitoDesdeFormulario` + helpers de redacción (§3) | ✅ |
| `src/lib/costos-mano-obra/fusion-campos-mo.ts` | `fusionarCampo`, detección de contradicciones (§4-5) | ✅ |
| `src/lib/costos-mano-obra/proyeccion-formulario-mo.ts` | `aCargoMOv2()` / `desdeExtraccionIA()` — puente entre `CargoFormularioMO` (UI) y `CargoMOv2`/`ExtraccionMOv2Zod` (MO-1, sin tocar) | ✅ |
| `src/components/costos/estructura/FormularioRequisitoMO.tsx` | Formulario guiado — vista de resumen/edición (§1.1): datos generales, programación multi-turno, condiciones especiales, completitud | ✅ |
| `src/components/costos/estructura/CuestionarioRequisitoMO.tsx` | Modal de cuestionario paso a paso (§1.0/§1.0.1) — punto de entrada principal desde el botón nuevo | ✅ |
| `src/components/costos/estructura/SelectorModoCaptura.tsx` | Pestañas `[Formulario guiado] [Escribir requisito]` | ✅ |
| `src/components/costos/estructura/BannerContradiccion.tsx` | UI de §5 | ✅ |
| `src/app/page.tsx` (solo bloque "Requisito operativo" de `ModuloEstructuraCostos`) | Reemplaza el textarea único por el selector de modo + los componentes nuevos; el resto de la pestaña Mano de Obra (Datos del puesto, Horario semanal, liquidación) **no se toca en esta fase** | edit |
| Tests | ver más abajo | ✅ |

**No se toca:** `tipos-mo-v2.ts`, `schema-mo-v2.ts`, `prompt-mo.ts`, `gemini-extractor.ts`, `liquidador-mo.ts`, `motor-mano-obra.ts`, `ParametrosLaborales`, ninguna otra pestaña.

**Tests a crear:** `generador-requisito.test.ts` (texto determinístico, campos pendientes → placeholder, idempotencia), `fusion-campos-mo.test.ts` (prioridad de fuentes, campo confirmado no se pisa, detección de contradicción), `proyeccion-formulario-mo.test.ts` (ida y vuelta `CargoFormularioMO` ↔ `CargoMOv2` sin pérdida de datos).

---

## 10. Plan de implementación propuesto

| Etapa | Contenido | Depende de |
|---|---|---|
| **MO-F1** | Modelo (§2) + `generarRequisitoDesdeFormulario` (§3) + tests puros, sin UI | MO-1 (ya hecho) |
| **MO-F2** | Fusión de fuentes + contradicciones (§4-5) + tests | MO-F1 |
| **MO-F3** | Puente `CargoFormularioMO` ↔ `CargoMOv2` (proyección/reconstrucción) + tests de ida y vuelta | MO-F1 |
| **MO-F4** | Componentes de UI: `CuestionarioRequisitoMO` (modal paso a paso, §1.0.1) + `FormularioRequisitoMO` (resumen/edición) + selector de modo + banner de contradicción | MO-F1..F3 |
| **MO-F5** | Integración en `page.tsx`: botón "Diligenciar por preguntas" junto a "Analizar con IA" (§1.0), reemplazo del textarea único por el flujo completo (§6-7), multi-cargo, completitud, borrador | MO-F4, y de MO-4 (ruta v2) para el paso "Analizar con IA" |

Cada etapa termina con tests + typecheck en verde antes de pasar a la siguiente, igual que MO-1/2/3.

**Nota de secuencia:** MO-F1-F3 son independientes de la ruta v2 (MO-4, todavía pendiente) — se pueden ejecutar en paralelo o antes. MO-F5 sí necesita que "Analizar con IA" hable con el extractor v2 (MO-4), porque hoy solo existe conectado el extractor v1.
