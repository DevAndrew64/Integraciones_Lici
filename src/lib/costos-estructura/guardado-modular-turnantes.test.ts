/**
 * Corrección "INDEPENDENCIA REAL DE GUARDADO POR PESTAÑA" — Turnantes deja
 * de compartir el guardado/baseline/dirty de Mano de Obra y pasa a tener
 * los suyos propios, conectados al mismo endpoint modular genérico
 * (PUT /api/costos-estructura/[id], modulo:'turnantes'). No existe arnés de
 * render de componentes para page.tsx (~25.000 líneas, sin jsdom/RTL en
 * este proyecto — ver guardado-modular-page.test.ts); mismo patrón de
 * verificación de TEXTO exacto del código fuente ya usado ahí. La prueba
 * de "un resync que no cambia nada no ensucia Turnantes" se hace con la
 * función pura real (sincronizarLineasTurnantesAutomaticas), sin
 * readFileSync — ver el último describe.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sincronizarLineasTurnantesAutomaticas, construirGruposNecesidadTurnantes,
  type LineaAutomaticaExistente, type GrupoNecesidadTurnantes, type PosicionElegibleTurnante,
} from '../costos-mano-obra/turnantes/calculo-turnantes';
import type { DiaSemanaHorario } from '../costos-mano-obra/horarios/tipos';

const PAGE_TSX = readFileSync(join(__dirname, '../../app/page.tsx'), 'utf-8');
const GUARDADO_MODULAR = readFileSync(join(__dirname, 'guardado-modular.ts'), 'utf-8');

describe('Propiedad de datos — cargosTurnantes ya NO es de Mano de Obra (§3)', () => {
  it('construirDatosEntradaManoObra ya no incluye cargosTurnantes en su payload', () => {
    const inicio = PAGE_TSX.indexOf('function construirDatosEntradaManoObra()');
    const fin = PAGE_TSX.indexOf('\n  }', inicio);
    const bloque = PAGE_TSX.slice(inicio, fin);
    expect(bloque).not.toContain('cargosTurnantes');
  });

  it('construirDatosEntradaTurnantes existe y retorna exclusivamente cargosTurnantes (con override opcional para el guardado compuesto, ver ajuste "MANO DE OBRA COMPLETADA PERO TURNANTES NUNCA QUEDA GUARDADO")', () => {
    const inicio = PAGE_TSX.indexOf('function construirDatosEntradaTurnantes(override?:LineaMOExtra[])');
    expect(inicio).toBeGreaterThan(-1);
    const fin = PAGE_TSX.indexOf('\n  }', inicio);
    const bloque = PAGE_TSX.slice(inicio, fin);
    expect(bloque).toContain('return { cargosTurnantes: override??cargosTurnantes };');
  });

  it('la tabla de propiedad canónica documenta a turnantes como dueño de sus propias líneas', () => {
    expect(GUARDADO_MODULAR).toContain('| líneas propias de Turnantes');
    expect(GUARDADO_MODULAR).toContain('turnantes');
  });

  it("CLAVES_MODULO incluye 'turnantes'", () => {
    expect(GUARDADO_MODULAR).toContain("'turnantes',");
  });
});

describe('Baseline y dirty independientes (nunca cruzados entre Mano de Obra y Turnantes)', () => {
  it('el efecto de dirty de Mano de Obra ya NO depende de cargosTurnantes', () => {
    // Corrección "STEPPER: MANO DE OBRA COMPLETADA APARECE PENDIENTE AL
    // NAVEGAR" — el cuerpo del efecto cambió (ver `actual`/
    // capturarBaselinesTrasRestaurarRef en el test de guardado-modular-page),
    // pero su arreglo de DEPENDENCIAS (lo que prueba este test) sigue sin
    // incluir cargosTurnantes.
    const inicio = PAGE_TSX.indexOf('const manoObraBaseline=useRef');
    expect(inicio).toBeGreaterThan(-1);
    const fin = PAGE_TSX.indexOf('if(turnantesBaseline.current===null)turnantesBaseline.current=', inicio);
    expect(fin).toBeGreaterThan(inicio);
    const bloque = PAGE_TSX.slice(inicio, fin);
    const finDeps = bloque.lastIndexOf(']);');
    const deps = bloque.slice(0, finDeps + 3);
    expect(deps).not.toContain('cargosTurnantes');
  });

  it('turnantesBaseline y su efecto de dirty existen, dependiendo EXCLUSIVAMENTE de cargosTurnantes', () => {
    const inicio = PAGE_TSX.indexOf('const turnantesBaseline=useRef<string|null>(null);');
    expect(inicio).toBeGreaterThan(-1);
    const fin = PAGE_TSX.indexOf('// Cierre correctivo S5', inicio);
    const bloque = PAGE_TSX.slice(inicio, fin);
    // Corrección "STEPPER: MANO DE OBRA COMPLETADA APARECE PENDIENTE AL
    // NAVEGAR" — mismo criterio de comparación (turnantesBaseline!==actual),
    // ahora con la excepción de adoptar el valor como baseline mientras
    // seguimos dentro de la ventana de restauración (nunca marca sucio un
    // resync disparado por la propia carga, ver comentario del bloque).
    expect(bloque).toContain('const actual=JSON.stringify(construirDatosEntradaTurnantes());');
    expect(bloque).toContain('if(capturarBaselinesTrasRestaurarRef.current){');
    expect(bloque).toContain('turnantesBaseline.current=actual;');
    expect(bloque).toContain('setHayCambiosSinGuardarTurnantes(turnantesBaseline.current!==actual);');
    expect(bloque).toContain('},[cargosTurnantes]);');
  });

  it('guardarModuloManoObra nunca toca turnantesBaseline/hayCambiosSinGuardarTurnantes', () => {
    const inicio = PAGE_TSX.indexOf('async function guardarModuloManoObra');
    const fin = PAGE_TSX.indexOf('async function guardarAvanceManoObra', inicio);
    const bloque = PAGE_TSX.slice(inicio, fin);
    expect(bloque).not.toContain('turnantesBaseline');
    expect(bloque).not.toContain('setHayCambiosSinGuardarTurnantes');
  });

  it('guardarModuloTurnantes nunca toca manoObraBaseline/hayCambiosSinGuardarManoObra', () => {
    const inicio = PAGE_TSX.indexOf('async function guardarModuloTurnantes');
    const fin = PAGE_TSX.indexOf('async function guardarAvanceTurnantes', inicio);
    const bloque = PAGE_TSX.slice(inicio, fin);
    expect(bloque).not.toContain('manoObraBaseline');
    expect(bloque).not.toContain('setHayCambiosSinGuardarManoObra');
  });
});

describe('Guardado de Turnantes — mismo núcleo genérico, sin duplicar la lógica de red', () => {
  it('ejecutarGuardadoModuloCosteo es el único lugar que hace fetch a /api/costos-estructura (ambos módulos lo comparten)', () => {
    const ocurrencias = PAGE_TSX.split("fetch('/api/costos-estructura").length - 1;
    // Una función que crea (POST) y otra que actualiza (PUT), ambas dentro
    // de ejecutarGuardadoModuloCosteo — nunca repetidas en cada wrapper de
    // módulo. Los otros usos de /api/costos-estructura en el archivo son
    // de solo lectura (listado, detalle) y usan la ruta con querystring o
    // "/'+regId" fuera de esta función.
    expect(ocurrencias).toBeGreaterThanOrEqual(2);
    const inicioEjec = PAGE_TSX.indexOf('async function ejecutarGuardadoModuloCosteo');
    const finEjec = PAGE_TSX.indexOf('\n  }\n\n  /** Unico punto de persistencia', inicioEjec);
    expect(PAGE_TSX.indexOf("fetch('/api/costos-estructura',{", inicioEjec)).toBeLessThan(finEjec);
  });

  it('guardarModuloTurnantes llama a ejecutarGuardadoModuloCosteo con la clave turnantes y su propia versión conocida', () => {
    const inicio = PAGE_TSX.indexOf('async function guardarModuloTurnantes');
    const fin = PAGE_TSX.indexOf('async function guardarAvanceTurnantes', inicio);
    const bloque = PAGE_TSX.slice(inicio, fin);
    expect(bloque).toContain("ejecutarGuardadoModuloCosteo('turnantes',estadoDestino,datosEntrada,turnantesUltimaActualizacion)");
  });

  it('el guardado de Turnantes NO envía un segundo "totales.costoMO" — costoMO (guardado por Mano de Obra) ya incluye la contribución de Turnantes', () => {
    const inicio = PAGE_TSX.indexOf('async function guardarModuloTurnantes');
    const fin = PAGE_TSX.indexOf('async function guardarAvanceTurnantes', inicio);
    const bloque = PAGE_TSX.slice(inicio, fin);
    expect(bloque).not.toContain('totales:');
    expect(bloque).not.toContain('costoMO');
  });

  it('Ajuste "A CADA PESTAÑA QUITA ESO DE FINALIZAR QUE SOLO QUEDE GUARDAR" — guardarAvanceTurnantes guarda directamente con COMPLETADO', () => {
    expect(PAGE_TSX).toContain("guardarModuloTurnantes('COMPLETADO')");
    expect(PAGE_TSX).not.toContain('function finalizarTurnantes()');
  });

  it('guardandoModuloTurnantesRef es un guard de re-entrada independiente del de Mano de Obra', () => {
    expect(PAGE_TSX).toContain('const guardandoModuloTurnantesRef=useRef(false);');
    expect(PAGE_TSX).toContain('const guardandoModuloTurnantes=guardandoAvanceTurnantes;');
    const inicio = PAGE_TSX.indexOf('async function guardarModuloTurnantes');
    const fin = PAGE_TSX.indexOf('async function guardarAvanceTurnantes', inicio);
    const bloque = PAGE_TSX.slice(inicio, fin);
    expect(bloque).toContain('if(guardandoModuloTurnantesRef.current)return false;');
  });
});

describe('Restauración de un registro guardado — Turnantes tiene su propio módulo v2, con respaldo histórico', () => {
  it('aplicarDatosGuardados resuelve el módulo turnantes con obtenerModulo, independiente del de manoObra', () => {
    const inicio = PAGE_TSX.indexOf('function aplicarDatosGuardados');
    const fin = PAGE_TSX.indexOf('setCargo(d.cargo', inicio);
    const bloque = PAGE_TSX.slice(inicio, fin);
    expect(bloque).toContain("obtenerModulo<{cargosTurnantes?:unknown}>(dCrudo,'turnantes')");
    // Ajuste "NO_APLICA EN 4 MÓDULOS" — Turnantes está EXCLUIDO de esa
    // regla (nunca puede quedar en NO_APLICA); `comoEstadoModulo` es el
    // narrowing defensivo que lo garantiza en tiempo de compilación,
    // aunque el motor genérico de guardado ahora devuelva un tipo más
    // amplio (`EstadoModuloResultado`) para los 4 módulos que sí aplican.
    expect(bloque).toContain('setEstadoModuloTurnantes(comoEstadoModulo(moduloTurnantesResuelto.estado));');
  });

  it('cargosTurnantes se restaura preferentemente del módulo propio, con d.cargosTurnantes solo como respaldo histórico', () => {
    const inicio = PAGE_TSX.indexOf('const cargosTurnantesCrudo=Array.isArray(moduloTurnantesResuelto?.datos?.cargosTurnantes)');
    expect(inicio).toBeGreaterThan(-1);
    const bloque = PAGE_TSX.slice(inicio, inicio + 260);
    expect(bloque).toContain('moduloTurnantesResuelto?.datos?.cargosTurnantes');
    expect(bloque).toContain(':d.cargosTurnantes;');
  });

  it('Ajuste "ya estaba guardado y no permite" — verDetallesCosteo marca el ref capturarBaselinesTrasRestaurarRef en vez de leer el baseline sincrónicamente (aplicarDatosGuardados solo llama setState, que React aún no aplicó en esa misma línea)', () => {
    const inicio = PAGE_TSX.indexOf('async function verDetallesCosteo');
    const fin = PAGE_TSX.indexOf('\n  }', inicio);
    const bloque = PAGE_TSX.slice(inicio, fin);
    expect(bloque).toContain('capturarBaselinesTrasRestaurarRef.current=true;');
  });

  it('el efecto que captura los baselines tras restaurar reinicia el de Turnantes por separado del de Mano de Obra, leyendo el estado YA actualizado', () => {
    const inicio = PAGE_TSX.indexOf('const capturarBaselinesTrasRestaurarRef=useRef(false);');
    const fin = PAGE_TSX.indexOf('\n  });', inicio);
    const bloque = PAGE_TSX.slice(inicio, fin);
    expect(bloque).toContain('turnantesBaseline.current=JSON.stringify(construirDatosEntradaTurnantes());');
    expect(bloque).toContain('setHayCambiosSinGuardarTurnantes(false);');
  });
});

describe('UI de Turnantes — botones y pie de estado propios (nunca comparten los de Mano de Obra)', () => {
  it('Ajuste "un solo guardado" — existe el botón "Guardar Turnantes" con su propia bandera de guardando; ya no hay botón "Finalizar" separado', () => {
    expect(PAGE_TSX).toContain('onClick={guardarAvanceTurnantes} disabled={guardandoModuloTurnantes}');
    expect(PAGE_TSX).not.toContain("'Finalizar Turnantes'");
  });

  it('el pie de estado de Turnantes usa sus propias variables (estadoModuloTurnantes/turnantesUltimaActualizacion/turnantesMsg)', () => {
    const inicio = PAGE_TSX.indexOf('Guardado modular por etapas — pie fijo de Turnantes');
    expect(inicio).toBeGreaterThan(-1);
    const fin = PAGE_TSX.indexOf('{/* ══ EPP ══', inicio);
    const bloque = PAGE_TSX.slice(inicio, fin);
    expect(bloque).toContain('estadoModuloTurnantes');
    expect(bloque).toContain('turnantesUltimaActualizacion');
    expect(bloque).toContain('turnantesMsg');
    expect(bloque).not.toContain('estadoModuloManoObra');
    expect(bloque).not.toContain('manoObraMsg');
  });
});

describe('Navegación entre pestañas internas — nunca pierde datos, nunca pide confirmación', () => {
  it('el onClick de cada pestaña es setTab(key) directo, sin pasar por el guard de Mano de Obra', () => {
    expect(PAGE_TSX).toContain('<button onClick={()=>setTab(key)}');
  });

  it('el botón "Volver" sigue usando el guard, ahora considerando ambos módulos conectados', () => {
    const inicio = PAGE_TSX.indexOf('const modulosConCambiosSinGuardar:string[]=[');
    const fin = PAGE_TSX.indexOf('];', inicio);
    const bloque = PAGE_TSX.slice(inicio, fin);
    expect(bloque).toContain("hayCambiosSinGuardarManoObra?['Mano de Obra']:[]");
    expect(bloque).toContain("hayCambiosSinGuardarTurnantes?['Turnantes']:[]");
    expect(PAGE_TSX).toContain('if(modulosConCambiosSinGuardar.length===0){accion();return;}');
  });
});

describe('Resultado — advierte cuando cualquier módulo conectado está sucio, sin volverse editable', () => {
  it('el badge de estado (resolverEstadoResultadoGeneral) y el banner "Resultado preliminar — existen cambios sin guardar" se retiraron de Resultado a pedido explícito del usuario ("QUITAR ESTO") — la vista ejecutiva de Tarifa del servicio ya no los muestra', () => {
    expect(PAGE_TSX).not.toContain('Resultado preliminar — existen cambios sin guardar');
  });

  it('el bloque de Resultado no agrega ningún botón de guardado propio', () => {
    const inicio = PAGE_TSX.indexOf("{tab==='resultado'&&(");
    const fin = PAGE_TSX.indexOf('{/* ══ ', inicio + 10);
    const bloque = PAGE_TSX.slice(inicio, fin);
    expect(bloque).not.toContain('guardarModuloResultado');
    expect(bloque).not.toContain("onClick={guardarAvanceResultado}");
  });
});

// ── Resync sin cambios reales — no debe ensuciar Turnantes ──────────────
// La independencia del baseline de Turnantes se apoya en que el useEffect
// de sincronización (page.tsx, línea ~6999) conserva la MISMA referencia
// de array cuando sincronizarLineasTurnantesAutomaticas no detecta ningún
// cambio real (`if(!huboCambio)return prev;`) — por lo tanto `cargosTurnantes`
// ni siquiera cambia de referencia, y el efecto de dirty de Turnantes no
// se dispara. Se verifica aquí con la función pura real (ya usada por ese
// useEffect), sin necesidad de montar React.
const SMLMV_PRUEBA = 1750905;
const minutosPorDiaHomogeneo = (horas: number): Record<DiaSemanaHorario, number> => {
  const min = horas * 60;
  return { L: min, M: min, X: min, J: min, V: min, S: min, D: min };
};
function posicion(overrides: Partial<PosicionElegibleTurnante> & { id: string; cantidad: number; salarioBase: number; arlKey: string }): PosicionElegibleTurnante {
  return {
    requiereCoberturaDescanso: true,
    // 12h/día L-D — excepción de negocio (paradigma de bloques 21/42h),
    // para que esta prueba de MECÁNICA de sincronización sea independiente
    // de la modalidad HORAS_REALES.
    minutosPorDia: minutosPorDiaHomogeneo(12),
    conBonoPrestacional: false, bonoPrestacionalValor: 0,
    conBonoAlimentacion: false, bonoAlimentacionValor: 0,
    conBonoTransporte: false, bonoTransporteValor: 0,
    conBonoProductividad: false, bonoProductividadValor: 0,
    conBonoOcasional: false, bonoOcasionalValor: 0,
    otrosCostosPorTrabajadorFirma: 0,
    perfilCargo: 'ASEO',
    horaInicioReferencia: '',
    ...overrides,
  };
}
function grupoDeUnaPosicion(cantidad: number, salarioBase: number, arlKey: string): GrupoNecesidadTurnantes {
  const grupos = construirGruposNecesidadTurnantes([posicion({ id: 'p', cantidad, salarioBase, arlKey })], SMLMV_PRUEBA);
  return grupos[0];
}
interface LineaFixture extends LineaAutomaticaExistente { id: number }

describe('Ajuste "STEPPER: MANO DE OBRA COMPLETADA APARECE PENDIENTE AL NAVEGAR" (2ª parte) — resync tardío de Turnantes adopta su propio resultado como baseline', () => {
  // Causa raíz confirmada con datos reales: `gruposNecesidadTurnantes`
  // depende de `otrosCostosMensualesTotal` (total derivado de EPP/Exámenes,
  // que puede terminar de hidratar en un render POSTERIOR al cierre de la
  // ventana `capturarBaselinesTrasRestaurarRef`). Si ese resync cambia
  // `cargosTurnantes` DESPUÉS de que la ventana ya cerró, la corrección
  // anterior (adoptar baseline solo mientras la ventana sigue abierta) no
  // alcanza a cubrirlo — por eso el efecto de resync (línea ~8945) ahora
  // adopta su propio resultado como baseline en el momento exacto en que
  // lo genera, sin depender de esa ventana de tiempo.
  it('el efecto de resync automático de Turnantes actualiza turnantesBaseline y limpia hayCambiosSinGuardarTurnantes en el mismo lugar donde llama a setCargosTurnantes', () => {
    const inicio = PAGE_TSX.indexOf('React.useEffect(()=>{\n    setCargosTurnantes(prev=>{');
    expect(inicio).toBeGreaterThan(-1);
    // Ajuste "MANO DE OBRA COMPLETADA PERO TURNANTES NUNCA QUEDA GUARDADO" —
    // el cuerpo del efecto ahora delega el cálculo en `construirTurnantesSincronizados`
    // (misma función que usa `guardarAvanceManoObra` para el snapshot
    // sincrónico al guardar) — el efecto solo decide si adoptar el
    // resultado como nuevo baseline. El arreglo de dependencias gana
    // `construirTurnantesSincronizados` además de `gruposNecesidadTurnantes`.
    const fin = PAGE_TSX.indexOf('},[gruposNecesidadTurnantes,construirTurnantesSincronizados]);', inicio);
    expect(fin).toBeGreaterThan(inicio);
    const bloque = PAGE_TSX.slice(inicio, fin);
    expect(bloque).toContain('const{siguiente,huboCambio}=construirTurnantesSincronizados(prev);');
    expect(bloque).toContain('turnantesBaseline.current=JSON.stringify({cargosTurnantes:siguiente});');
    expect(bloque).toContain('setHayCambiosSinGuardarTurnantes(false);');
    // Nunca se salta el caso "sin cambios reales" (huboCambio, que ya
    // combina sincronización + despojo de bonos dentro de
    // construirTurnantesSincronizados) — la adopción de baseline solo
    // ocurre cuando el efecto REALMENTE produce un valor nuevo, nunca en
    // cada render.
    expect(bloque.indexOf('if(!huboCambio)return prev;')).toBeLessThan(bloque.indexOf('turnantesBaseline.current=JSON.stringify({cargosTurnantes:siguiente});'));
  });

  it('turnantesBaseline existe como una única declaración (ref compartida entre el efecto de resync y el resto del mecanismo de baseline/dirty)', () => {
    // La posición TEXTUAL de la declaración respecto al efecto de resync
    // (línea ~8945) no importa para corrección en tiempo de ejecución: el
    // callback de un `useEffect` es un closure diferido que se invoca
    // DESPUÉS de que el cuerpo completo del componente ya corrió (React
    // programa los efectos tras el render, nunca los ejecuta en línea) —
    // por eso `turnantesBaseline` sigue viviendo junto al resto de refs de
    // baseline (más abajo en el archivo), sin necesidad de reubicarla antes
    // del efecto que la usa. Lo único que este test fija es que exista una
    // ÚNICA declaración (nunca una ref paralela para el resync).
    const ocurrencias = PAGE_TSX.split('const turnantesBaseline=useRef<string|null>(null);').length - 1;
    expect(ocurrencias).toBe(1);
  });
});

describe('Un resync que produce contenido IDÉNTICO no marca Turnantes como sucio', () => {
  it('sincronizarLineasTurnantesAutomaticas conserva la MISMA referencia de cargosTurnantes cuando nada cambió realmente', () => {
    const grupo = grupoDeUnaPosicion(10, 1750905, 'II'); // 10 posiciones → 5 bloques integrados de 42h, sin remanente
    const previas: LineaFixture[] = [
      { id: 1, claveGrupoTurnante: grupo.claveGrupo, esTurnanteAutomatico: true, cantOpeFijos: '5', salarioBase: '1750905', arlKey: 'II', horasSemanal: '42' },
    ];
    const { siguientes, huboCambio } = sincronizarLineasTurnantesAutomaticas<LineaFixture>(previas, [grupo], () => {
      throw new Error('no debería crear una línea nueva — ya existe una compatible');
    });
    expect(huboCambio).toBe(false);
    expect(siguientes[0]).toBe(previas[0]); // misma referencia — evita ensuciar el baseline por JSON.stringify
  });
});
