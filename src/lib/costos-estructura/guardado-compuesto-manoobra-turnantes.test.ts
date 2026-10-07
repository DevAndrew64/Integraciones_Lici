/**
 * Ajuste "MANO DE OBRA COMPLETADA PERO TURNANTES NUNCA QUEDA GUARDADO".
 *
 * Causa raíz (confirmada por auditoría de código, no por instrumentación en
 * producción — ver hallazgo del ajuste previo "STEPPER: MANO DE OBRA
 * COMPLETADA APARECE PENDIENTE AL NAVEGAR", cuya corrección solo evitaba un
 * falso "cambios sin guardar" pero nunca revivía `estadoModuloTurnantes`
 * cuando Turnantes nunca se había persistido realmente): el chulo del
 * stepper para "Mano de Obra" exige que Turnantes también esté
 * `COMPLETADO`+sin cambios cuando el costeo lo requiere, pero:
 *  (a) la decisión "¿requiere Turnantes?" usaba `cargosTurnantes.length`
 *      (ESTADO, sincronizado por un `useEffect` — puede ir un render detrás
 *      de `gruposNecesidadTurnantes`, que es un `useMemo` SINCRÓNICO), y
 *  (b) el resultado de `guardarModuloTurnantes` se descartaba sin más en
 *      `guardarAvanceManoObra` — un fallo silencioso nunca impedía reportar
 *      "Mano de Obra completada".
 *
 * No existe arnés de render de componentes para page.tsx (~43.000 líneas,
 * sin jsdom/RTL en este proyecto — mismo patrón ya usado en
 * guardado-modular-turnantes.test.ts/guardado-modular-page.test.ts):
 * structural checks contra el TEXTO exacto del código fuente, más pruebas
 * de la MECÁNICA real con las funciones puras de calculo-turnantes.ts
 * (sincronizarLineasTurnantesAutomaticas/construirGruposNecesidadTurnantes),
 * sin necesidad de montar React.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  sincronizarLineasTurnantesAutomaticas, construirGruposNecesidadTurnantes,
  type LineaAutomaticaExistente, type GrupoNecesidadTurnantes, type PosicionElegibleTurnante,
} from '../costos-mano-obra/turnantes/calculo-turnantes';
import type { DiaSemanaHorario } from '../costos-mano-obra/horarios/tipos';

const PAGE_TSX = readFileSync(join(__dirname, '../../app/page.tsx'), 'utf-8');

// ── 1. requiereTurnantes es SINCRÓNICO (gruposNecesidadTurnantes), nunca cargosTurnantes.length ──
describe('requiereTurnantes — fuente única y sincrónica de "¿aplica Turnantes?"', () => {
  it('se declara como gruposNecesidadTurnantes.length>0, nunca cargosTurnantes.length', () => {
    const inicio = PAGE_TSX.indexOf('const requiereTurnantes=gruposNecesidadTurnantes.length>0;');
    expect(inicio).toBeGreaterThan(-1);
  });

  it('el stepper (estaCompletadaManoObra) usa !requiereTurnantes, ya NO cargosTurnantes.length===0', () => {
    const inicio = PAGE_TSX.indexOf('const estaCompletadaManoObra=');
    expect(inicio).toBeGreaterThan(-1);
    const fin = PAGE_TSX.indexOf('const completadoPorTab', inicio);
    const bloque = PAGE_TSX.slice(inicio, fin);
    expect(bloque).toContain('!requiereTurnantes');
    expect(bloque).not.toContain('cargosTurnantes.length');
    expect(bloque).toContain("estadoModuloManoObra==='COMPLETADO'&&!hayCambiosSinGuardarManoObra");
    expect(bloque).toContain("estadoModuloTurnantes==='COMPLETADO'&&!hayCambiosSinGuardarTurnantes");
  });

  it('completadoPorTab.manoObra usa esaCompletadaManoObra (fuente única, no una expresión paralela)', () => {
    expect(PAGE_TSX).toContain('manoObra:estaCompletadaManoObra,');
  });

  it('guardarAvanceManoObra decide guardar Turnantes con requiereTurnantes, nunca con cargosTurnantes.length>0', () => {
    const inicio = PAGE_TSX.indexOf('async function guardarAvanceManoObra');
    const fin = PAGE_TSX.indexOf('\n  }\n\n  /** Análogo de `guardarModuloManoObra`', inicio);
    expect(fin).toBeGreaterThan(inicio);
    const bloque = PAGE_TSX.slice(inicio, fin);
    expect(bloque).toContain('if(okManoObra&&requiereTurnantes){');
    expect(bloque).not.toContain('cargosTurnantes.length>0');
  });
});

// ── 2. Snapshot sincrónico — construirTurnantesSincronizados, sin duplicar la lógica ──
describe('turnantesParaGuardar — snapshot sincrónico en el mismo clic, misma función pura del resync', () => {
  it('construirTurnantesSincronizados existe una sola vez y la usan tanto el resync automático como guardarAvanceManoObra (nunca una segunda implementación)', () => {
    const ocurrencias = PAGE_TSX.split('const construirTurnantesSincronizados=React.useCallback(').length - 1;
    expect(ocurrencias).toBe(1);
    // El useEffect de resync delega en ella...
    const inicioEfecto = PAGE_TSX.indexOf('React.useEffect(()=>{\n    setCargosTurnantes(prev=>{');
    const finEfecto = PAGE_TSX.indexOf('},[gruposNecesidadTurnantes,construirTurnantesSincronizados]);', inicioEfecto);
    expect(PAGE_TSX.slice(inicioEfecto, finEfecto)).toContain('construirTurnantesSincronizados(prev)');
    // ...y guardarAvanceManoObra también, con el `cargosTurnantes` actual.
    const inicioGuardar = PAGE_TSX.indexOf('async function guardarAvanceManoObra');
    const finGuardar = PAGE_TSX.indexOf('\n  }\n\n  /** Análogo de `guardarModuloManoObra`', inicioGuardar);
    expect(PAGE_TSX.slice(inicioGuardar, finGuardar)).toContain('construirTurnantesSincronizados(cargosTurnantes)');
  });

  it('guardarModuloTurnantes acepta un override explícito y lo persiste — nunca depende de leer cargosTurnantes del cierre después de un setCargosTurnantes previo', () => {
    const inicio = PAGE_TSX.indexOf('async function guardarModuloTurnantes(estadoDestino:EstadoModulo,turnantesOverride?:LineaMOExtra[])');
    expect(inicio).toBeGreaterThan(-1);
    const fin = PAGE_TSX.indexOf('async function guardarAvanceTurnantes', inicio);
    const bloque = PAGE_TSX.slice(inicio, fin);
    expect(bloque).toContain('construirDatosEntradaTurnantes(turnantesOverride)');
  });

  it('guardarAvanceManoObra pasa turnantesParaGuardar EXPLÍCITAMENTE a guardarModuloTurnantes (nunca confía en el state recién seteado)', () => {
    const inicio = PAGE_TSX.indexOf('async function guardarAvanceManoObra');
    const fin = PAGE_TSX.indexOf('\n  }\n\n  /** Análogo de `guardarModuloManoObra`', inicio);
    const bloque = PAGE_TSX.slice(inicio, fin);
    expect(bloque).toContain('okTurnantes=await guardarModuloTurnantes(estadoDestino,turnantesParaGuardar);');
  });

  // ── TEST CRÍTICO (§9.3 pedido explícitamente) ──
  // Prueba, con la función pura REAL (sin React), que un snapshot correcto
  // de Turnantes puede construirse a partir de `cargosTurnantes=[]` (el
  // estado tal como quedaría si el useEffect de resync AÚN no ha corrido)
  // en cuanto `gruposNecesidadTurnantes` ya detecta la necesidad — es decir:
  // el guardado NUNCA depende de esperar otro render/efecto.
  const SMLMV_PRUEBA = 1750905;
  const minutosPorDiaHomogeneo = (horas: number): Record<DiaSemanaHorario, number> => {
    const min = horas * 60;
    return { L: min, M: min, X: min, J: min, V: min, S: min, D: min };
  };
  function posicion(overrides: Partial<PosicionElegibleTurnante> & { id: string; cantidad: number; salarioBase: number; arlKey: string }): PosicionElegibleTurnante {
    return {
      requiereCoberturaDescanso: true,
      minutosPorDia: minutosPorDiaHomogeneo(12), // L-D → dispara necesidad de cobertura
      conBonoPrestacional: false, bonoPrestacionalValor: 0,
      conBonoAlimentacion: false, bonoAlimentacionValor: 0,
      conBonoTransporte: false, bonoTransporteValor: 0,
      conBonoProductividad: false, bonoProductividadValor: 0,
      conBonoOcasional: false, bonoOcasionalValor: 0,
      otrosCostosPorTrabajadorFirma: 0,
      perfilCargo: 'PISCINERO/SALVAVIDA',
      horaInicioReferencia: '',
      ...overrides,
    };
  }
  interface LineaFixture extends LineaAutomaticaExistente { id: number }

  it('3. requiereTurnantes=true con cargosTurnantes state todavía vacío → el snapshot sincrónico SÍ genera las líneas necesarias, en la misma llamada (sin esperar otro render)', () => {
    const grupos: GrupoNecesidadTurnantes[] = construirGruposNecesidadTurnantes(
      [posicion({ id: 'p1', cantidad: 10, salarioBase: 1750905, arlKey: 'II' })],
      SMLMV_PRUEBA,
    );
    expect(grupos.length).toBeGreaterThan(0); // requiereTurnantes sería true

    const cargosTurnantesStateAunVacio: LineaFixture[] = []; // simula "el efecto de resync aún no corrió"
    let idsGenerados = 0;
    const { siguientes, huboCambio } = sincronizarLineasTurnantesAutomaticas<LineaFixture>(
      cargosTurnantesStateAunVacio, grupos,
      (grupo) => ({ id: 1000 + idsGenerados++, claveGrupoTurnante: grupo.claveGrupo, esTurnanteAutomatico: true, cantOpeFijos: '5', salarioBase: String(Math.round(grupo.salarioBaseHeredado)), arlKey: grupo.arlKey, horasSemanal: '42' }),
    );
    expect(huboCambio).toBe(true);
    expect(siguientes.length).toBeGreaterThan(0); // el snapshot NO queda vacío pese a partir de []
  });

  it('1. requiereTurnantes=false (sin cargos con cobertura de descanso) → grupos vacíos, ningún snapshot de turnantes que generar', () => {
    const grupos = construirGruposNecesidadTurnantes(
      [posicion({ id: 'p1', cantidad: 2, salarioBase: 1750905, arlKey: 'II', requiereCoberturaDescanso: false, minutosPorDia: minutosPorDiaHomogeneo(8) })],
      SMLMV_PRUEBA,
    );
    expect(grupos.length).toBe(0); // requiereTurnantes sería false
  });
});

// ── 3/4/5. Guardado compuesto — éxito solo si Mano de Obra Y Turnantes (cuando aplica) salieron bien ──
describe('Guardado compuesto — okCompuesto = okManoObra && okTurnantes', () => {
  function bloqueGuardarAvanceManoObra(): string {
    const inicio = PAGE_TSX.indexOf('async function guardarAvanceManoObra');
    const fin = PAGE_TSX.indexOf('\n  }\n\n  /** Análogo de `guardarModuloManoObra`', inicio);
    expect(fin).toBeGreaterThan(inicio);
    return PAGE_TSX.slice(inicio, fin);
  }

  it('4. si falla guardarModuloManoObra (okManoObra=false), NUNCA se llama guardarModuloTurnantes', () => {
    const bloque = bloqueGuardarAvanceManoObra();
    // La única llamada a guardarModuloTurnantes está dentro del `if(okManoObra&&requiereTurnantes){...}`.
    const inicioIf = bloque.indexOf('if(okManoObra&&requiereTurnantes){');
    const finIf = bloque.indexOf('\n    }', inicioIf);
    const dentroDelIf = bloque.slice(inicioIf, finIf);
    expect(dentroDelIf).toContain('guardarModuloTurnantes(');
    // Y fuera de ese bloque no hay ninguna otra invocación.
    const fueraDelIf = bloque.slice(0, inicioIf) + bloque.slice(finIf);
    expect(fueraDelIf).not.toContain('guardarModuloTurnantes(');
  });

  it('5. Mano de Obra OK pero Turnantes falla → okCompuesto queda false, el mensaje NO dice completada, se conserva el guardado real de Mano de Obra', () => {
    const bloque = bloqueGuardarAvanceManoObra();
    expect(bloque).toContain('const okCompuesto=okManoObra&&okTurnantes;');
    expect(bloque).toContain('!okCompuesto');
    expect(bloque).toContain('no fue posible guardar Turnantes');
    expect(bloque).toContain('Vuelve a pulsar "Guardar Mano de Obra" para reintentar.');
    // El guardado de Mano de Obra (ya ejecutado y persistido) nunca se revierte:
    // no existe ninguna llamada que "deshaga" o reintente automáticamente guardarModuloManoObra aquí.
    expect(bloque).not.toContain('guardarModuloManoObra(estadoDestino);\n    if(!ok');
  });

  it('el mensaje de éxito ("completada"/"guardado correctamente") solo se decide dentro de la rama okCompuesto, nunca solo con okManoObra', () => {
    const bloque = bloqueGuardarAvanceManoObra();
    const inicioOkCompuesto = bloque.indexOf('const okCompuesto=okManoObra&&okTurnantes;');
    expect(inicioOkCompuesto).toBeGreaterThan(-1);
    const inicioMsg = bloque.indexOf('setManoObraMsg(', inicioOkCompuesto);
    const finMsg = bloque.indexOf(');', inicioMsg);
    const cuerpoMsg = bloque.slice(inicioMsg, finMsg);
    expect(cuerpoMsg).toContain('!okCompuesto');
    expect(cuerpoMsg).toContain("'Mano de Obra completada.'");
  });
});

// ── 6. Históricos — el próximo guardado normaliza, sin backfill ──
describe('Datos históricos (ej. Mano de Obra COMPLETADO + Turnantes nunca persistido) — normalización solo vía guardado explícito', () => {
  it('no existe ningún mecanismo de autocorrección al SOLO abrir/restaurar la ficha (aplicarDatosGuardados nunca llama guardarModuloTurnantes)', () => {
    const inicio = PAGE_TSX.indexOf('function aplicarDatosGuardados');
    const fin = PAGE_TSX.indexOf('\n  }\n', inicio + 50);
    const bloque = PAGE_TSX.slice(inicio, fin > inicio ? fin : inicio + 8000);
    expect(bloque).not.toContain('guardarModuloTurnantes(');
    expect(bloque).not.toContain('guardarAvanceManoObra(');
  });

  it('la única vía de normalización es un guardado explícito del usuario — guardarAvanceManoObra recalcula requiereTurnantes/snapshot en cada invocación, nunca cachea un resultado de un guardado anterior', () => {
    const bloque = (() => {
      const inicio = PAGE_TSX.indexOf('async function guardarAvanceManoObra');
      const fin = PAGE_TSX.indexOf('\n  }\n\n  /** Análogo de `guardarModuloManoObra`', inicio);
      return PAGE_TSX.slice(inicio, fin);
    })();
    // requiereTurnantes y construirTurnantesSincronizados se leen del scope
    // del componente (no de un parámetro fijo ni de una constante módulo) —
    // por construcción, cada invocación de este `function` ve los valores
    // ACTUALES de `gruposNecesidadTurnantes`/`cargosTurnantes` de ese render.
    expect(bloque).toContain('requiereTurnantes');
    expect(bloque).toContain('construirTurnantesSincronizados(cargosTurnantes)');
  });
});

// ── 7. Ajuste previo se conserva (capturarBaselinesTrasRestaurarRef) ──
describe('El ajuste "STEPPER: MANO DE OBRA COMPLETADA APARECE PENDIENTE AL NAVEGAR" se conserva intacto', () => {
  it('capturarBaselinesTrasRestaurarRef sigue existiendo y sigue siendo usado por el mecanismo de baseline/dirty de Mano de Obra y Turnantes', () => {
    expect(PAGE_TSX).toContain('const capturarBaselinesTrasRestaurarRef=useRef(false);');
    const ocurrencias = PAGE_TSX.split('capturarBaselinesTrasRestaurarRef.current').length - 1;
    expect(ocurrencias).toBeGreaterThanOrEqual(3); // set en verDetallesCosteo + lectura en ambos efectos de dirty
  });
});

// ── 8. Regresión — el resto de módulos no cambia su condición de completado ──
describe('Regresión — EPP/Exámenes/Insumos/Maquinaria/SNC/Admin/Resultado/Valor agregado sin cambios', () => {
  it('las condiciones de completadoPorTab de los demás módulos son EXACTAMENTE las mismas de antes de este ajuste', () => {
    expect(PAGE_TSX).toContain("epp:estadoModuloDotacionEpp==='NO_APLICA'||(estadoModuloDotacionEpp==='COMPLETADO'&&!hayCambiosSinGuardarDotacionEpp&&tieneDatosDotacionEpp()),");
    expect(PAGE_TSX).toContain("examenes:estadoModuloExamenesMedicos==='NO_APLICA'||(estadoModuloExamenesMedicos==='COMPLETADO'&&!hayCambiosSinGuardarExamenesMedicos&&tieneDatosExamenesMedicos()),");
    expect(PAGE_TSX).toContain("insumos:estadoModuloInsumos==='NO_APLICA'||(estadoModuloInsumos==='COMPLETADO'&&!hayCambiosSinGuardarInsumos&&tieneDatosInsumos()),");
    expect(PAGE_TSX).toContain("maquinaria:estadoModuloMaquinariaEquipos==='NO_APLICA'||(estadoModuloMaquinariaEquipos==='COMPLETADO'&&!hayCambiosSinGuardarMaquinariaEquipos&&tieneDatosMaquinaria()),");
    expect(PAGE_TSX).toContain("serviciosNoContinuos:estadoModuloServiciosNoContinuos==='NO_APLICA'||(estadoModuloServiciosNoContinuos==='COMPLETADO'&&!hayCambiosSinGuardarServiciosNoContinuos),");
    expect(PAGE_TSX).toContain("admin:estadoModuloCostosAdministrativos==='COMPLETADO'&&!hayCambiosSinGuardarCostosAdministrativos,");
    expect(PAGE_TSX).toContain("resultado:estadoModuloResultado==='COMPLETADO'&&!hayCambiosSinGuardarResultado,");
    expect(PAGE_TSX).toContain("valorAgregado:estadoModuloValorAgregado==='NO_APLICA'||(estadoModuloValorAgregado==='COMPLETADO'&&!hayCambiosSinGuardarValorAgregado&&tieneDatosValorAgregado()),");
  });

  it('el texto inferior "Estado: Completado" de Mano de Obra NO se tocó en este ajuste (sigue describiendo solo su propio módulo)', () => {
    expect(PAGE_TSX).toContain("Estado: {hayCambiosSinGuardarManoObra&&estadoModuloManoObra==='COMPLETADO'?'Cambios sin guardar'");
    expect(PAGE_TSX).toContain(":estadoModuloManoObra==='COMPLETADO'?'Completado'");
  });
});
