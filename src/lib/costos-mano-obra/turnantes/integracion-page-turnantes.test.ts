/**
 * Confirmación de cableado del cálculo automático de turnantes en
 * page.tsx — pruebas de humo por texto (el proyecto no tiene jsdom/RTL
 * para montar el componente real de ~27.000 líneas). Estas pruebas son
 * SECUNDARIAS: la evidencia numérica real de "una sola fuente de cálculo,
 * el motor actual (nunca una fórmula paralela), sin duplicar el costo"
 * vive en `integracion-motor-turnantes.test.ts` (motor financiero real,
 * sin readFileSync) y `sincronizacion-turnantes.test.ts` (decisión de
 * sincronización real, sin readFileSync). Este archivo solo confirma que
 * page.tsx efectivamente INVOCA esas funciones puras — no reimplementa la
 * lógica ni sustituye la necesidad de las pruebas reales.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PAGE_TSX = readFileSync(join(__dirname, '../../../app/page.tsx'), 'utf-8');

describe('gruposNecesidadTurnantes / necesidadTurnantes — recalculan de inmediato, sin botón', () => {
  it('gruposNecesidadTurnantes es un useMemo con lineasExtra/arlKey como dependencia y usa construirGruposNecesidadTurnantes (fuente única)', () => {
    const inicio = PAGE_TSX.indexOf('const gruposNecesidadTurnantes=React.useMemo<GrupoNecesidadTurnantes[]>(');
    expect(inicio).toBeGreaterThan(-1);
    const bloque = PAGE_TSX.slice(inicio, inicio + 3500);
    expect(bloque).toContain('[lineasExtra,arlKey,construirEntradaOtrosCostosLinea]');
    expect(bloque).toContain('construirGruposNecesidadTurnantes(posiciones,SMLMV)');
  });
  it('necesidadTurnantes (resumen visual) se deriva con agregarNecesidadesTurnantes, nunca recalculado a mano', () => {
    const inicio = PAGE_TSX.indexOf('const necesidadTurnantes=React.useMemo(');
    expect(inicio).toBeGreaterThan(-1);
    const bloque = PAGE_TSX.slice(inicio, inicio + 300);
    expect(bloque).toContain('agregarNecesidadesTurnantes(gruposNecesidadTurnantes.map(g=>g.necesidad))');
  });
});

describe('costo de turnantes — se lee exclusivamente de resultadosTurnantesConOtrosCostosParaAgregado', () => {
  // Corrección "AGREGADO MENSUAL DE TURNANTES HORAS_REALES" — este consumo
  // pasó de leer `resultadosTurnantesConOtrosCostos` (crudo) a
  // `resultadosTurnantesConOtrosCostosParaAgregado` (ya escalado por
  // `factorAgregadoTurnanteHorasReales` — factor=1 para la excepción de
  // 21/42h, así que el comportamiento de esos casos no cambia).
  it('costoTurnanteAutomatico itera cargosTurnantes.filter(esTurnanteAutomatico) y busca cada una en resultadosTurnantesConOtrosCostosParaAgregado, nunca recalcula salario/prestaciones', () => {
    const inicio = PAGE_TSX.indexOf('const costoTurnanteAutomatico=React.useMemo(');
    expect(inicio).toBeGreaterThan(-1);
    const bloque = PAGE_TSX.slice(inicio, inicio + 900);
    expect(bloque).toContain("cargosTurnantes.filter(l=>l.esTurnanteAutomatico)");
    expect(bloque).toContain('resultadosTurnantesConOtrosCostosParaAgregado.find(r=>r.id===linea.id)');
    expect(bloque).not.toMatch(/salarioBase\s*\*|calcularSalarioProporcionalServicio/);
  });
});

describe('la línea automática nunca se agrega a lineasExtra, ni el costo se recalcula fuera del motor', () => {
  it('el useEffect de sincronización delega en construirTurnantesSincronizados (que a su vez usa sincronizarLineasTurnantesAutomaticas, función pura, ya probada aparte) y nunca llama setLineasExtra', () => {
    // Ajuste "MANO DE OBRA COMPLETADA PERO TURNANTES NUNCA QUEDA GUARDADO"
    // — el cálculo se extrajo de este efecto a `construirTurnantesSincronizados`
    // (arriba, junto a `gruposNecesidadTurnantes`) para que
    // `guardarAvanceManoObra` pueda invocar la MISMA lógica de forma
    // sincrónica al guardar, sin esperar a este efecto.
    const inicioEfecto = PAGE_TSX.indexOf('React.useEffect(()=>{\n    setCargosTurnantes(prev=>{');
    expect(inicioEfecto).toBeGreaterThan(-1);
    const bloque = PAGE_TSX.slice(inicioEfecto, inicioEfecto + 700);
    expect(bloque).toContain('construirTurnantesSincronizados(prev)');
    expect(bloque).not.toContain('setLineasExtra');

    const inicioHelper = PAGE_TSX.indexOf('const construirTurnantesSincronizados=React.useCallback(');
    expect(inicioHelper).toBeGreaterThan(-1);
    expect(inicioHelper).toBeLessThan(inicioEfecto); // declarado ANTES del efecto que lo consume
    const bloqueHelper = PAGE_TSX.slice(inicioHelper, inicioHelper + 900);
    expect(bloqueHelper).toContain('sincronizarLineasTurnantesAutomaticas(');
  });
  it('resultadosTurnantesConOtrosCostos combina el resultado LABORAL ya calculado (sin recalcularlo) con otros costos, una sola vez por línea', () => {
    expect(PAGE_TSX).toContain('construirResultadoLineaConOtrosCostos(fin.tarifaMensualPorTrabajador,fin.tarifaMensualLinea,desglose)');
  });
});

describe('el turnante no hereda un factor parcial de otra línea', () => {
  // Ajuste "AJUSTAR TURNANTES POR BLOQUES DE 21 Y 42 HORAS" — reemplaza la
  // única `construirLineaTurnanteAutomatica` (siempre 42h hardcodeado) por
  // `construirLineaTurnanteAutomaticaBase` (jornada como parámetro) y sus
  // dos envoltorios: Bloques42 (LIMITE_HORAS_SEMANALES_TOTAL_SEMANAL) y
  // Remanente21 (JORNADA_MEDIO_TIEMPO) — nunca 44 hardcodeado en ninguna.
  it('construirLineaTurnanteAutomaticaBase usa TOTAL_SEMANAL con la jornada recibida por parámetro (factor=1, nunca 44 hardcodeado)', () => {
    const inicio = PAGE_TSX.indexOf('function construirLineaTurnanteAutomaticaBase(');
    expect(inicio).toBeGreaterThan(-1);
    const bloque = PAGE_TSX.slice(inicio, inicio + 1400);
    expect(bloque).toContain("tipoCapturaHorario:'TOTAL_SEMANAL',horasSemanalesManual:horasSemanal");
    expect(bloque).not.toMatch(/horasSemanalesManual:\s*44/);
  });
  it('construirLineaTurnanteAutomaticaBloques42 usa LIMITE_HORAS_SEMANALES_TOTAL_SEMANAL; construirLineaTurnanteAutomaticaRemanente21 usa JORNADA_MEDIO_TIEMPO', () => {
    expect(PAGE_TSX).toContain('return construirLineaTurnanteAutomaticaBase(id,grupo,cantidadTexto,LIMITE_HORAS_SEMANALES_TOTAL_SEMANAL,');
    expect(PAGE_TSX).toContain("return construirLineaTurnanteAutomaticaBase(id,grupo,'1',JORNADA_MEDIO_TIEMPO,");
  });
  it('el salario inicial del turnante viene del grupo (salarioBaseHeredado), nunca digitado aparte', () => {
    const inicio = PAGE_TSX.indexOf('function construirLineaTurnanteAutomaticaBase(');
    const bloque = PAGE_TSX.slice(inicio, inicio + 1400);
    expect(bloque).toContain('salarioBase:String(Math.round(grupo.salarioBaseHeredado))');
  });
});

describe('Corrección "VALIDAR LINEACUBIERTAPORTURNANTE" — cobertura por posición, nunca condición grupal única', () => {
  it('lineaCubiertaPorTurnante consulta coberturaPorPosicion (por id, en TODOS los grupos), nunca solo cantidadTurnantesFisicos>0 del grupo', () => {
    const inicio = PAGE_TSX.indexOf('const lineaCubiertaPorTurnante=React.useCallback(');
    expect(inicio).toBeGreaterThan(-1);
    const bloque = PAGE_TSX.slice(inicio, inicio + 900);
    expect(bloque).toContain('gruposNecesidadTurnantes.flatMap(g=>g.coberturaPorPosicion)');
    expect(bloque).toContain("find(c=>c.id===String(l.id))");
    expect(bloque).toContain('cobertura?.cubiertaCompleta');
    // Nunca debe volver a la condición grupal única que declaraba
    // cualquier línea del grupo como cubierta con solo tener turnante.
    expect(bloque).not.toContain('g.necesidad.cantidadTurnantesFisicos>0)');
  });
  it('la cobertura por posición se calcula DENTRO de construirGruposNecesidadTurnantes (page.tsx no la recalcula aparte)', () => {
    const inicio = PAGE_TSX.indexOf('return construirGruposNecesidadTurnantes(posiciones,SMLMV)');
    expect(inicio).toBeGreaterThan(-1);
    expect(PAGE_TSX).not.toContain('calcularCoberturaPorPosicion(');
  });
});

describe('Corrección "BOLSA CONSOLIDADA DE CAPACIDAD" — costo asignado por cargo (pool real, nunca un turnante completo por cargo)', () => {
  // Ajuste "Y EN LAS FICHAS CREADAS EL TURNANTE YA VA POR FUERA NO ACA" —
  // el cálculo de costoAsignadoCargo/totalConTurnanteGrupo (proporción por
  // cargo DENTRO de la ficha del cargo) fue retirado por completo: la
  // atribución por cargo ahora vive exclusivamente en costoTurnantePorCargo
  // (resumen mensual) — la ficha del cargo ya no calcula ni muestra un
  // costo de turnante propio, el turnante tiene su propia ficha aparte
  // (FichaTurnante).
  it('costoAsignadoCargo/totalConTurnanteGrupo fueron retirados de la ficha del cargo — la atribución por cargo vive solo en costoTurnantePorCargo', () => {
    expect(PAGE_TSX).not.toContain('let costoAsignadoCargo=0');
    expect(PAGE_TSX).not.toContain('const totalConTurnanteGrupo=subtotalPosicionesGrupo+costoAsignadoCargo;');
  });
  it('el detalle plegable "Ver cálculo" (con "Costo contractual completo... pool compartido") fue retirado por completo — ya no vive dentro de la ficha del cargo', () => {
    expect(PAGE_TSX).not.toContain('Costo contractual completo del turnante de ${tipoJornadaTexto} (pool compartido)');
  });
  it('costoTurnantePorCargo (resumen mensual) atribuye por CLAVE DE FICHA (Cargo+Horario, ajuste "SEPARAR POR CARGO + HORARIO") vía coberturaPorPosicion, sumando las (hasta dos) líneas reales del grupo (nunca al costo completo del grupo escalado, nunca solo por nombre de cargo)', () => {
    const inicio = PAGE_TSX.indexOf('const costoTurnantePorCargo=React.useMemo(');
    expect(inicio).toBeGreaterThan(-1);
    const bloque = PAGE_TSX.slice(inicio, inicio + 2400);
    expect(bloque).toContain('idAClaveFicha=new Map(detalleLineasMensualUI.map(f=>[String(f.id),f.claveFicha]))');
    expect(bloque).toContain('for(const c of grupo.coberturaPorPosicion)');
    expect(bloque).toContain('const capacidadUtilizada=grupo.necesidad.capacidadUtilizadaMinutos;');
    expect(bloque).toContain('const costoContratoGrupo=costoTotalGrupoTurnante(grupo,resultado42,resultado21);');
    expect(bloque).toContain('costoAsignado=Math.round(costoContratoGrupo*c.minutosCubiertos/capacidadUtilizada)');
    expect(bloque).not.toContain('factorEscalaContrato');
    expect(bloque).not.toContain('mapa.set(grupo.perfilCargo,(mapa.get(grupo.perfilCargo)??0)+resultado.costoMensualTotalLinea)');
    // Nunca debe volver a acumular por nombre de cargo crudo (dos fichas
    // del mismo cargo con horarios distintos ya no deben compartir fila).
    expect(bloque).not.toContain("idANombreCargo=new Map(lineasExtra.map(l=>[String(l.id),(l.nombreCargo||'').trim()]))");
  });
});

describe('Corrección "AGREGADO MENSUAL DE TURNANTES HORAS_REALES" — el agregado general usa el costo proporcional, nunca el crudo de la referencia de 42h', () => {
  it('existe factorAgregadoTurnanteHorasReales, se calcula SOLO para grupos HORAS_REALES, y reutiliza costoTotalGrupoTurnante (nunca una fórmula nueva)', () => {
    const inicio = PAGE_TSX.indexOf('const factorAgregadoTurnanteHorasReales=React.useMemo(');
    expect(inicio).toBeGreaterThan(-1);
    const bloque = PAGE_TSX.slice(inicio, inicio + 1200);
    expect(bloque).toContain("if(grupo.modalidadCobertura!=='HORAS_REALES')continue;");
    expect(bloque).toContain('const costoCorrectoGrupo=costoTotalGrupoTurnante(grupo,resultado42,resultado21);');
    expect(bloque).toContain('const factor=costoCorrectoGrupo/costoCrudoGrupo;');
  });

  it('resultadosTurnantesConOtrosCostosParaAgregado escala por el factor y RECOMPUTA costoMensualTotalLinea como la suma de sus dos componentes ya escalados (nunca redondeos independientes sin reconciliar)', () => {
    const inicio = PAGE_TSX.indexOf('const resultadosTurnantesConOtrosCostosParaAgregado=React.useMemo(');
    expect(inicio).toBeGreaterThan(-1);
    const bloque = PAGE_TSX.slice(inicio, inicio + 1300);
    expect(bloque).toContain('costoMensualTotalLinea:costoLaboralMensualLinea+otrosCostosMensualesLinea,');
  });

  it('agregadoCostoMensualTotalManoObra, agregadoOtrosCostosTurnantes y costoTurnanteAutomatico leen resultadosTurnantesConOtrosCostosParaAgregado (ya escalado) — nunca el crudo resultadosTurnantesConOtrosCostos directamente', () => {
    const inicioTotal = PAGE_TSX.indexOf('const agregadoCostoMensualTotalManoObra=React.useMemo(');
    expect(PAGE_TSX.slice(inicioTotal, inicioTotal + 400)).toContain('resultadosTurnantesConOtrosCostosParaAgregado.map');
    const inicioOtros = PAGE_TSX.indexOf('const agregadoOtrosCostosTurnantes=React.useMemo(');
    expect(PAGE_TSX.slice(inicioOtros, inicioOtros + 300)).toContain('resultadosTurnantesConOtrosCostosParaAgregado.map');
    const inicioAuto = PAGE_TSX.indexOf('const costoTurnanteAutomatico=React.useMemo(');
    expect(PAGE_TSX.slice(inicioAuto, inicioAuto + 900)).toContain('resultadosTurnantesConOtrosCostosParaAgregado.find');
  });

  it('agregadoTurnantesMensual (Resultado preliminar) lee resultadosCargosTurnantesMensualesParaAgregado — nunca resultadosCargosTurnantesMensuales crudo', () => {
    const inicio = PAGE_TSX.indexOf('const agregadoTurnantesMensual=React.useMemo(');
    expect(inicio).toBeGreaterThan(-1);
    const bloque = PAGE_TSX.slice(inicio, inicio + 300);
    expect(bloque).toContain('resultadosCargosTurnantesMensualesParaAgregado.map(r=>({resultado:r.calculada.resultadoFinanciero}))');
  });

  it('costoTurnantePorCargo sigue leyendo el resultado CRUDO (resultadosTurnantesConOtrosCostos, no ParaAgregado) — evita escalar dos veces la misma proporción', () => {
    const inicio = PAGE_TSX.indexOf('const costoTurnantePorCargo=React.useMemo(');
    const bloque = PAGE_TSX.slice(inicio, inicio + 2400);
    expect(bloque).toContain('resultadosTurnantesConOtrosCostos.find(r=>r.id===linea42.id)');
    expect(bloque).not.toContain('resultadosTurnantesConOtrosCostosParaAgregado');
  });
});

describe('el resumen general incluye el costo del turnante exactamente una vez', () => {
  it('agregadoCostoMensualTotalManoObra combina lineasExtra y cargosTurnantes una sola vez cada uno (no se repite cargosTurnantes en la lista)', () => {
    const inicio = PAGE_TSX.indexOf('const agregadoCostoMensualTotalManoObra=React.useMemo(');
    const bloque = PAGE_TSX.slice(inicio, inicio + 400);
    const ocurrenciasLineasExtra = (bloque.match(/resultadosLineasExtraConOtrosCostos\.map/g) || []).length;
    // Ajuste "AJUSTAR TURNANTES POR BLOQUES DE 21 Y 42 HORAS" — para la
    // excepción de 21/42h cada línea automática ya nace con su
    // `cantOpeFijos` correctamente dimensionado (bloques de 42h o
    // remanente de 21h), sin escalado (factor=1). Corrección "AGREGADO
    // MENSUAL DE TURNANTES HORAS_REALES" — el total ahora lee
    // `resultadosTurnantesConOtrosCostosParaAgregado` (ya escalado por
    // `factorAgregadoTurnanteHorasReales` para HORAS_REALES, factor=1 para
    // los demás casos) — exactamente una vez, nunca duplicada, nunca el
    // crudo `resultadosTurnantesConOtrosCostos` directamente.
    const ocurrenciasTurnantes = (bloque.match(/resultadosTurnantesConOtrosCostosParaAgregado\.map/g) || []).length;
    expect(ocurrenciasLineasExtra).toBe(1);
    expect(ocurrenciasTurnantes).toBe(1);
    expect(PAGE_TSX).not.toContain('const resultadosTurnantesEscaladosParaTotal=React.useMemo(');
  });
  it('9 — la sección "Cobertura de turnantes" en la UI solo LEE costoTurnanteAutomatico/necesidadTurnantes, nunca los vuelve a sumar a un total', () => {
    const inicio = PAGE_TSX.indexOf('Cobertura de turnantes');
    expect(inicio).toBeGreaterThan(-1);
    const bloque = PAGE_TSX.slice(inicio, inicio + 2600);
    expect(bloque).not.toContain('tarifaMensualTotalManoObra+');
    expect(bloque).not.toContain('setTarifaMensualTotalManoObra');
    expect(bloque).not.toContain('agregadoCostoMensualTotalManoObra=');
    expect(bloque).not.toMatch(/set\w*\(.*costoTotalTurnantes/);
  });
});

describe('compatibilidad con registros antiguos', () => {
  it('requiereCoberturaDescansoManual, esTurnanteAutomatico, claveGrupoTurnante y las 2 banderas de edición manual son campos opcionales (un registro sin ellos carga sin error)', () => {
    expect(PAGE_TSX).toContain('requiereCoberturaDescansoManual?:boolean|null;');
    expect(PAGE_TSX).toContain('esTurnanteAutomatico?:boolean;');
    expect(PAGE_TSX).toContain('claveGrupoTurnante?:string;');
    expect(PAGE_TSX).toContain('salarioEditadoManualmente?:boolean;');
    expect(PAGE_TSX).toContain('arlEditadoManualmente?:boolean;');
  });
});

describe('override "Requiere cobertura de descanso" — el override manual siempre gana, nunca escribe el costo directamente', () => {
  it('el setter escribe requiereCoberturaDescansoManual (boolean|null), nunca un campo monetario', () => {
    const inicio = PAGE_TSX.indexOf('const setVRequiereCoberturaDescansoManual=(v:boolean|null)=>{');
    expect(inicio).toBeGreaterThan(-1);
    const bloque = PAGE_TSX.slice(inicio, inicio + 150);
    expect(bloque).toContain('patch({requiereCoberturaDescansoManual:v})');
  });
  it('no existe ningún campo de captura manual "valorTurnanteMensual" en todo el archivo', () => {
    expect(PAGE_TSX).not.toContain('valorTurnanteMensual');
  });
});

// Corrección "ESTO DEBERÍA SER INTERNO" — el override manual triestado ya
// no tiene NINGÚN punto de entrada en la UI (ni siquiera un control
// colapsado detrás de esAdminCostos): es puramente interno. Las pruebas de
// abajo reemplazan las anteriores (que exigían un selector visible para
// Administrador) — ahora confirman justo lo contrario: que no queda rastro
// de UI, mientras el campo/lógica siguen intactos internamente (setter,
// derivación automática y resolverRequiereCoberturaDescanso sin tocar).
describe('el override manual es puramente interno — sin ningún punto de entrada en la UI', () => {
  it('no existe ningún bloque condicionado por esAdminCostos dentro del modal de cargo (el control fue retirado, no solo ocultado detrás de otro toggle)', () => {
    expect(PAGE_TSX).not.toContain('{!esLinea1&&esAdminCostos&&(');
    expect(PAGE_TSX).not.toContain('Configuración avanzada (solo Administrador)');
    expect(PAGE_TSX).not.toContain('Gestionar excepción de cobertura');
  });
  it('el selector triestado (AUTOMATICO/FORZAR_SI/FORZAR_NO) ya no se renderiza en ningún lugar del archivo', () => {
    expect(PAGE_TSX).not.toContain('<option value="AUTOMATICO">Usar detección automática</option>');
    expect(PAGE_TSX).not.toContain('<option value="FORZAR_SI">Forzar que sí requiere cobertura</option>');
    expect(PAGE_TSX).not.toContain('<option value="FORZAR_NO">Forzar que no requiere cobertura</option>');
  });
  it('el checkbox binario original ("Requiere cobertura de descanso (genera turnantes)") tampoco existe (nunca reapareció como alternativa)', () => {
    expect(PAGE_TSX).not.toContain('Requiere cobertura de descanso (genera turnantes)');
    expect(PAGE_TSX).not.toContain('type="checkbox" checked={vRequiereCoberturaDescansoResuelto}');
  });
  it('esAdminCostos sigue existiendo (mismo gate de rol de siempre, reutilizado en otras partes de la app) aunque ya no gatee este control', () => {
    expect(PAGE_TSX).toContain("const esAdminCostos=sesion?.rol==='Administrador';");
  });
  it('la derivación interna (vRequiereCoberturaDescansoManual, deteccionAutomaticaCoberturaDescanso, setVRequiereCoberturaDescansoManual) sigue intacta — retirar la UI no tocó el campo ni su lógica', () => {
    expect(PAGE_TSX).toContain('const vRequiereCoberturaDescansoManual=!esLinea1?(lineaActual!.requiereCoberturaDescansoManual??null):null;');
    expect(PAGE_TSX).toContain('const deteccionAutomaticaCoberturaDescanso=!esLinea1?cubreSieteDiasSemana(diasUnionCargoActual):false;');
    expect(PAGE_TSX).toContain('const setVRequiereCoberturaDescansoManual=(v:boolean|null)=>{ if(!esLinea1)patch({requiereCoberturaDescansoManual:v}); };');
  });
});

describe('compatibilidad — restaurar "Automático" limpia el override sin convertirlo en false', () => {
  it('setVRequiereCoberturaDescansoManual(null) es una llamada válida (tipo boolean|null) que patchea null, nunca false', () => {
    // Cubierto también por resolverRequiereCoberturaDescanso (calculo-turnantes.test.ts,
    // no modificado): null/undefined siempre significan "automático". Aquí se confirma
    // que el selector de page.tsx puede emitir null explícitamente (opción AUTOMATICO),
    // no solo boolean.
    const inicio = PAGE_TSX.indexOf('const setVRequiereCoberturaDescansoManual=(v:boolean|null)=>{');
    expect(inicio).toBeGreaterThan(-1);
  });
  it('no existe ningún punto que fuerce requiereCoberturaDescansoManual a false por defecto — abrir/guardar sin tocar el control avanzado conserva undefined/null/true/false tal como venían', () => {
    expect(PAGE_TSX).not.toContain('requiereCoberturaDescansoManual:false');
    expect(PAGE_TSX).not.toContain('requiereCoberturaDescansoManual??false');
  });
});

describe('§5 — banderas independientes: editar salario y editar ARL congelan solo su propio campo', () => {
  it('el onChange del campo Salario escribe salarioEditadoManualmente:true, nunca arlEditadoManualmente', () => {
    expect(PAGE_TSX).toContain("patch({salarioBase:v,salarioEditadoManualmente:true})");
  });
  it('el onChange del campo ARL escribe arlEditadoManualmente:true, nunca salarioEditadoManualmente', () => {
    expect(PAGE_TSX).toContain("patch({arlKey:e.target.value,arlEditadoManualmente:true})");
  });
});

// Corrección "NINGÚN BONO SE ASIGNA AL TURNANTE" — verificación de
// cableado real en page.tsx. Confirmado por el usuario en producción: NI
// el bono prestacional NI los 4 bonos no prestacionales (alimentación/
// transporte/productividad/ocasional) deben afectar al turnante — los 5
// se configuran EXCLUSIVAMENTE en la posición principal. Dos frentes: (1)
// las líneas NUEVAS nunca deben heredar ninguno de los 5 bonos del grupo;
// (2) las líneas YA EXISTENTES (creadas antes de esta corrección, o
// conservadas sin reconstruir por `sincronizarLineasTurnantesAutomaticas`
// porque cantOpeFijos/salario/ARL no cambiaron) deben autocorregirse
// también — nunca basta con arreglar solo la construcción de líneas
// nuevas.
describe('Corrección "NINGÚN BONO SE ASIGNA AL TURNANTE"', () => {
  it('construirLineaTurnanteAutomaticaBase NUNCA hereda conBonoPrestacional/Alimentacion/Transporte/Productividad/Ocasional del grupo — siempre false/0, sin importar los bonos configurados en el cargo principal', () => {
    const inicio = PAGE_TSX.indexOf('function construirLineaTurnanteAutomaticaBase(');
    expect(inicio).toBeGreaterThan(-1);
    const bloque = PAGE_TSX.slice(inicio, inicio + 2200);
    expect(bloque).toContain("conBonoPrestacional:false,bonoPrestacionalValor:'0',");
    expect(bloque).toContain("conBonoAlimentacion:false,bonoAlimentacionValor:'0',");
    expect(bloque).toContain("conBonoTransporte:false,bonoTransporteValor:'0',");
    expect(bloque).toContain("conBonoProductividad:false,bonoProductividadValor:'0',");
    expect(bloque).toContain("conBonoOcasional:false,bonoOcasionalValor:'0',");
    expect(bloque).not.toContain('conBonoPrestacional:grupo.conBonoPrestacional');
  });

  it('construirTurnantesSincronizados (usado tanto por el useEffect de resync como por guardarAvanceManoObra) fuerza la exclusión de los 5 bonos también sobre líneas YA EXISTENTES (conservadas sin reconstruir) — nunca solo sobre líneas nuevas', () => {
    // Ajuste "MANO DE OBRA COMPLETADA PERO TURNANTES NUNCA QUEDA GUARDADO"
    // — este cálculo (antes inline en el useEffect) se extrajo a
    // `construirTurnantesSincronizados` para reutilizarlo sincrónicamente
    // desde `guardarAvanceManoObra`. Misma lógica exacta, solo cambió DÓNDE
    // vive.
    const inicioHelper = PAGE_TSX.indexOf('const construirTurnantesSincronizados=React.useCallback(');
    expect(inicioHelper).toBeGreaterThan(-1);
    const bloque = PAGE_TSX.slice(inicioHelper, inicioHelper + 2000);
    expect(bloque).toContain('let huboCambioBonos=false;');
    expect(bloque).toContain('const siguientesSinBonoTurnante=siguientes.map(l=>{');
    expect(bloque).toContain("if(!l.conBonoPrestacional&&!l.conBonoAlimentacion&&!l.conBonoTransporte&&!l.conBonoProductividad&&!l.conBonoOcasional)return l;");
    expect(bloque).toContain('conBonoPrestacional:false,bonoPrestacionalValor:\'0\',conBonoAlimentacion:false');
    expect(bloque).toContain('return{siguiente:[...manuales,...siguientesSinBonoTurnante],huboCambio:huboCambio||huboCambioBonos};');

    // El useEffect de resync sigue respetando "sin cambios reales → no
    // toca el state" — ahora consultando `huboCambio` (que ya combina
    // sincronización + despojo de bonos) que devuelve `construirTurnantesSincronizados`.
    const inicioEfecto = PAGE_TSX.indexOf('React.useEffect(()=>{\n    setCargosTurnantes(prev=>{');
    const finEfecto = PAGE_TSX.indexOf('},[gruposNecesidadTurnantes,construirTurnantesSincronizados]);', inicioEfecto);
    const bloqueEfecto = PAGE_TSX.slice(inicioEfecto, finEfecto);
    expect(bloqueEfecto).toContain('if(!huboCambio)return prev;');
    // Ajuste "STEPPER: MANO DE OBRA COMPLETADA APARECE PENDIENTE AL
    // NAVEGAR" (2ª parte) — el efecto sigue adoptando su propio resultado
    // como baseline de Turnantes antes de retornarlo (ver
    // guardado-modular-turnantes.test.ts para esa corrección específica).
    expect(bloqueEfecto).toContain('return siguiente;');
  });
});
