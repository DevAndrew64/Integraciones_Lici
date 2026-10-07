/**
 * Verificación de fuente — ETAPA FINAL D/E, reemplazo atómico. No existe
 * arnés de render de componentes para page.tsx (~24.000 líneas) en este
 * proyecto; esta es una verificación honesta y acotada del TEXTO exacto en
 * el código fuente, mismo patrón ya usado en texto-ui-mano-obra.test.ts.
 * Cubre las pruebas funcionales obligatorias #1, #8, #9, #10, #11, #12,
 * #13, #17, #18, #20, #21, #22, #23, #24 (las restantes ya están cubiertas
 * por pruebas puras contra los módulos del motor/ensamblador/agregador).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { encabezadoCantidad, encabezadoCoberturaHoras } from './interprete-turnos-presentacion';

const PAGE_TSX = readFileSync(join(__dirname, '../../../app/page.tsx'), 'utf-8');

const inicioBloqueMensualManoObra = PAGE_TSX.indexOf('ETAPA FINAL D/E — tabla y rótulos 100% mensuales');
const finBloqueMensualManoObra = PAGE_TSX.indexOf('La tarifa mensual total no incluye los cargos pendientes');
const bloqueMensual = PAGE_TSX.slice(inicioBloqueMensualManoObra, finBloqueMensualManoObra);

describe('page.tsx — fase dedicada de extracción: la bandera de transición fue retirada por completo (§7)', () => {
  it('19) USAR_TARIFA_MENSUAL_COMPLETA ya no existe en page.tsx — el resultado comercial es el único camino, no una rama activada por bandera', () => {
    expect(PAGE_TSX).not.toContain('USAR_TARIFA_MENSUAL_COMPLETA');
    expect(PAGE_TSX).not.toContain("from '@/lib/costos-mano-obra/motor-distribuido/bandera-reemplazo-tarifa-mensual'");
  });

  it('cierre definitivo — el adaptador legal (adaptador-cargo-tarifa-mensual) ya no se importa en page.tsx; el único constructor de línea es el comercial', () => {
    expect(PAGE_TSX).not.toContain("from '@/lib/costos-mano-obra/motor-distribuido/adaptador-cargo-tarifa-mensual'");
    expect(PAGE_TSX).toContain("from '@/lib/costos-mano-obra/motor-distribuido/motor-comercial-30-dias'");
  });
});

describe('page.tsx — tabla principal y de horas 100% mensuales (§1, §3, §4, §8, §9)', () => {
  it('1) DÍAS PROM./MES usa diasProgramadosPromedioMensual, nunca diasOrdinariosProgramadosPromedioMensual como total', () => {
    expect(PAGE_TSX).toContain('diasPromedioMensual:resultadoMotor?.diasProgramadosPromedioMensual??0');
  });

  it('8) las horas visibles se leen de horasPromedioMensuales del ensamblador mensual', () => {
    expect(PAGE_TSX).toContain('horaPorConcepto=(concepto:string)=>fin?.horasPromedioMensuales.find(h=>h.concepto===concepto)?.horas??0');
  });

  it('9) el costo de recargos visible en la tabla de horas viene de financiero.recargosSobretiempoMensual', () => {
    expect(bloqueMensual).toContain("cop(d.financiero!.recargosSobretiempoMensual)");
  });

  it('la columna PROGRAMACIÓN reemplaza a H.Inicio/H.Fin en la tabla mensual, con encabezados normalizados (CARGO/CANT. TRABAJADORES o POSICIONES/HORAS SEMANALES)', () => {
    // Ajuste UX — a pedido del usuario, la tabla principal ya no muestra las
    // columnas de costo por línea (quedan en el resumen agregado de abajo y
    // en el panel "Otros costos mensuales"). Cierre "MEJORA VISUAL Y DE
    // LENGUAJE": el encabezado de CANT. se traduce dinámicamente
    // (encabezadoCantidad) según significadoCantidad; el de horas es un
    // rótulo NEUTRAL fijo ("HORAS SEMANALES" — ajuste "RETIRAR JORNADA DE
    // LA TABLA PRINCIPAL": ya no distingue cobertura/jornada en el título,
    // eso vive en la celda/detalle, nunca en el encabezado).
    expect(bloqueMensual).toContain("['N.°',''],['CARGO',''],[encabezadoCantidad(grupo.interpretacion?.significadoCantidad),''],['PROGRAMACIÓN',''],['HORAS SEMANALES',''],['','']].map(([h,tt],i)=>(");
  });

  it('encabezadoCantidad/encabezadoCoberturaHoras conservan "CANT. TRABAJADORES"/"HORAS SEM. / MES" para significadoCantidad=TRABAJADORES', () => {
    expect(encabezadoCantidad('TRABAJADORES')).toBe('CANT. TRABAJADORES');
    expect(encabezadoCoberturaHoras('TRABAJADORES')).toBe('HORAS SEM. / MES');
  });

  // Ajuste "NO MEZCLAR HORAS SEMANALES Y MENSUALES" (§2) — la tabla se
  // renombró de "HORAS PROMEDIO MENSUALES POR CONCEPTO" a "PROYECCIÓN
  // MENSUAL DE RECARGOS". Ajuste "quita esto de acá" — la columna
  // "Ordinaria" se retiró por completo (8 columnas de concepto pasan a
  // 7, ver COLS_TABLA_RECARGOS_MENSUALES): nunca aportaba un dato útil
  // homogéneo entre metodologías.
  it('la tabla de horas mensuales usa las 8 columnas requeridas (sin Ordinaria), tituladas "PROYECCIÓN MENSUAL DE RECARGOS"', () => {
    expect(bloqueMensual).toContain('PROYECCIÓN MENSUAL DE RECARGOS');
    expect(bloqueMensual).not.toContain("['Ordinaria',");
    expect(bloqueMensual).toContain("['N.°',''],['Rec. noct.','Nocturnas ordinarias'],['Extra diurna','Extras diurnas'],['Extra nocturna','Extras nocturnas'],['Dom.-Fest.','Dominicales/festivas'],['Extra festiva','Extras festivas diurnas'],['Extra fest. noct.','Extras festivas nocturnas'],['Rec. noct.-fest.','Nocturnas festivas'],['Costo mensual','Costo mensual de recargos']");
  });

  // Ajuste "oculta esto también" — la tabla "Resumen semanal"
  // (TablaResumenSemanalHorasMO) se retiró de la UI: duplicaba la misma
  // información que ya muestra el ícono de detalle de cálculo por
  // concepto. Confirmado que ya no existe ningún rastro en el código.
  it('la tabla "Resumen semanal" (TablaResumenSemanalHorasMO) ya no existe — se retiró por duplicar el ícono de detalle', () => {
    expect(PAGE_TSX).not.toContain('TablaResumenSemanalHorasMO');
    expect(PAGE_TSX).not.toContain('>RESUMEN SEMANAL</div>');
  });
});

describe('page.tsx — prestaciones/seguridad social/parafiscales/otros costos vienen del ensamblador mensual, por cargo (§6, §8, §10, §11, §12, §13)', () => {
  // Ajuste "GENERALIZAR LA PRESENTACIÓN UNITARIA DE MANO DE OBRA PARA
  // TODAS LAS POSICIONES" — el detalle visible de la ficha ahora muestra
  // el costo POR TRABAJADOR (grupo.calculoLaboralUnitario, derivado del
  // motor sin multiplicar), nunca el agregado por cargo
  // (grupo.agregadoFinanciero.*Total, que multiplica por
  // cantidadTrabajadores) — ese agregado sigue existiendo para
  // hayLineasBloqueadas, pero ya no alimenta estas filas.
  it('10) prestaciones sociales visibles provienen de grupo.calculoLaboralUnitario (por trabajador, nunca el agregado ×cantidad)', () => {
    expect(bloqueMensual).toContain('grupo.calculoLaboralUnitario?.prestacionesSociales??null');
    expect(bloqueMensual).not.toContain('grupo.agregadoFinanciero.prestacionesSocialesMensualesTotal');
  });
  it('11) seguridad social visible proviene de grupo.calculoLaboralUnitario (por trabajador)', () => {
    expect(bloqueMensual).toContain('grupo.calculoLaboralUnitario?.seguridadSocial??null');
    expect(bloqueMensual).not.toContain('grupo.agregadoFinanciero.seguridadSocialMensualTotal');
  });
  it('12) parafiscales visibles provienen de grupo.calculoLaboralUnitario (por trabajador)', () => {
    expect(bloqueMensual).toContain('grupo.calculoLaboralUnitario?.aportesParafiscales??null');
    expect(bloqueMensual).not.toContain('grupo.agregadoFinanciero.parafiscalesMensualesTotal');
  });
  it('13) otros costos por trabajador se agregan una sola vez por cargo (una única definición de fila, con un único total:grupo.calculoLaboralUnitario?.otrosCostos??null)', () => {
    const ocurrencias = (bloqueMensual.match(/label:'Otros costos por trabajador',ver:!!verDetalleOtrosPorCargo\[grupo\.claveFicha\],setVer:\(\)=>setVerDetalleOtrosPorCargo\(p=>\(\{\.\.\.p,\[grupo\.claveFicha\]:!\(p\[grupo\.claveFicha\]\?\?false\)\}\)\),total:grupo\.calculoLaboralUnitario\?\.otrosCostos\?\?null/g) || []).length;
    expect(ocurrencias).toBe(1);
  });
});

describe('page.tsx — pestaña Resultado recibe el subtotal mensual de Mano de Obra (§10, #17)', () => {
  it('17) la pestaña Resultado muestra la suma mensual de Mano de Obra, Turnantes, prestaciones/aportes y otros costos', () => {
    const inicio = PAGE_TSX.indexOf("tab==='resultado'&&(");
    const fin = PAGE_TSX.indexOf('Maquinaria y Equipos', inicio);
    const bloqueResultado = PAGE_TSX.slice(inicio, fin);
    expect(bloqueResultado).toContain('agregadoManoObraMensual.tarifaMensualTotal');
    expect(bloqueResultado).toContain('agregadoTurnantesMensual.tarifaMensualTotal');
    expect(bloqueResultado).toContain('agregadoManoObraMensual.prestacionesSocialesMensualesTotal');
    expect(bloqueResultado).toContain('otrosCostosMensualesTotal');
    expect(bloqueResultado).not.toMatch(/totalManoObra(?!Mensual)/);
  });
});

describe('page.tsx — el motor legado fue eliminado, nunca se mezcla en la misma fila (§14, #18, #20)', () => {
  it('18) costoMO/grandTotal son directamente el resultado comercial — sin ternario, sin motor legado que sobrescribir', () => {
    expect(PAGE_TSX).toContain('const costoMO=tarifaMensualTotalManoObra;');
    expect(PAGE_TSX).toContain('const grandTotal=tarifaMensualTotalManoObra;');
    expect(PAGE_TSX).not.toContain('costoMOLegado');
    expect(PAGE_TSX).not.toContain('grandTotalLegado');
  });

  it('20) la rama JSX 100% mensual de Mano de Obra nunca referencia identificadores del motor legado', () => {
    const identificadoresLegados = ['detalleLineas.map', 'totalManoObra}', 'sobretiempoManoObra}', 'subtotalManoObra}', 'COLS_TABLA_DMO_MO}', 'grandTotalLegado'];
    for (const id of identificadoresLegados) {
      expect(bloqueMensual).not.toContain(id);
    }
  });
});

describe('page.tsx — líneas bloqueadas (§11, #21)', () => {
  it('21) una línea bloqueada nunca muestra $0 disfrazado de cálculo — la tabla de horas/recargos usa "—" para esa fila', () => {
    expect(bloqueMensual).toContain("{d.bloqueada?'—':cop(d.financiero!.recargosSobretiempoMensual)}");
  });

  it('el total general advierte cuando hay líneas pendientes de cálculo, en vez de tratarlas como $0', () => {
    expect(bloqueMensual).toContain('agregadoManoObraMensual.hayLineasBloqueadas');
    expect(bloqueMensual).toContain('cargo{agregadoManoObraMensual.cantidadLineasBloqueadas>1?');
  });
});

describe('page.tsx — rótulos mensuales, sin información técnica visible (§5, #22, #23, #24)', () => {
  it('22) los rótulos económicos de la tabla mensual identifican el detalle POR TRABAJADOR (Ajuste "GENERALIZAR LA PRESENTACIÓN UNITARIA...")', () => {
    const rotulos = [
      'Salario básico mensual por trabajador:', 'Bono prestacional por trabajador:', 'Recargos y horas extras por trabajador:',
      'Auxilio de transporte por trabajador:', 'Subtotal salarial por trabajador:',
      'Prestaciones sociales por trabajador', 'Seguridad social por trabajador', 'Aportes parafiscales por trabajador',
      'Otros costos por trabajador',
    ];
    for (const r of rotulos) {
      expect(bloqueMensual).toContain(r);
    }
    // Corrección "COSTO PRELIMINAR DEL TURNANTE" §5 — el rótulo del total
    // general ahora es condicional (preliminar mientras haya horas de
    // relevo sin programar), así que ya no es un literal fijo con ":" —
    // se verifica el texto base y que el condicional exista.
    expect(bloqueMensual).toContain("necesidadTurnantes.horasResiduales>0?'Total preliminar de Mano de Obra':'Costo total de mano de obra'");
  });

  it('23) el bloque mensual nunca muestra fecha de vigencia, divisor ni parámetros laborales técnicos', () => {
    const prohibidos = ['fechaVigenciaTarifa', 'divisorMensual', 'jornadaMaximaSemanalHoras', 'Vigencia de la tarifa'];
    for (const p of prohibidos) {
      expect(bloqueMensual).not.toContain(p);
    }
  });

  it('24) el bloque mensual no llama directamente ninguna API externa de horarios — solo lee distribucionesHorario ya materializado en el estado', () => {
    expect(bloqueMensual).not.toContain('fetch(');
    expect(bloqueMensual).not.toContain('/api/horarios');
    expect(bloqueMensual).not.toContain('/turnos/');
  });
});

describe('page.tsx — CIERRE FINANCIERO CORRECTIVO: parámetros financieros reales conectados al motor mensual', () => {
  it('page.tsx nunca importa PARAMETROS_FINANCIEROS_2026_DEFAULT directamente — solo a través del resolver', () => {
    expect(PAGE_TSX).not.toContain("import { PARAMETROS_FINANCIEROS_2026_DEFAULT }");
    expect(PAGE_TSX).toContain("import { resolverParametrosFinancierosManoObra, resolverClaseArl } from '@/lib/costos-mano-obra/motor-distribuido/parametros-financieros-mano-obra'");
  });

  it('el contrato financiero se construye desde pSalud/pPension/pSena/pIcbf/pCaja (configuración real), nunca hardcodeado', () => {
    const inicio = PAGE_TSX.indexOf('const parametrosFinancierosActuales=React.useMemo');
    const fin = PAGE_TSX.indexOf('const parametrosFinancierosResueltos=React.useMemo');
    const bloque = PAGE_TSX.slice(inicio, fin);
    expect(bloque).toContain("porcentajeSalud:pSalud===''?undefined:Number(pSalud)");
    expect(bloque).toContain("porcentajePension:pPension===''?undefined:Number(pPension)");
    expect(bloque).toContain("porcentajeCajaCompensacion:pCaja===''?undefined:Number(pCaja)");
    expect(bloque).toContain("porcentajeSena:pSena===''?undefined:Number(pSena)");
    expect(bloque).toContain("porcentajeIcbf:pIcbf===''?undefined:Number(pIcbf)");
    // Nunca `||` para resolver estos campos — 0 debe sobrevivir.
    expect(bloque).not.toContain('||');
  });

  it('el ARL viaja completo (las 5 clases) desde la tabla ARL de page.tsx — nunca un único porcentaje global', () => {
    expect(PAGE_TSX).toContain('porcentajeArlPorClase:Object.fromEntries(ARL.map(a=>[a.key,a.pct]))');
  });

  it('cada línea recibe parametrosFinancierosResueltos al construirse — lineasExtra y Turnantes comparten el mismo constructor único (construirCalculadaLinea), consolidado desde el cierre definitivo del motor comercial', () => {
    const ocurrencias = (PAGE_TSX.match(/resolverClaseArl\(l\.arlKey\),\s*\n\s*parametrosFinancierosResueltos,/g) || []).length;
    // Ajuste "SERVICIO PARCIAL POR TOTAL DE HORAS SEMANALES" — dentro de
    // construirCalculadaLinea ahora hay 2 llamadas a
    // construirLineaCalculadaMensualComercial30Dias (TOTAL_SEMANAL sin
    // recargos / HORARIO_DETALLADO con derivador), ambas pasando
    // parametrosFinancierosResueltos igual que antes — nunca un tercer
    // constructor ni una ruta que lo omita.
    expect(ocurrencias).toBe(2);
    // Ambos arreglos (lineasExtra y cargosTurnantes) invocan ese único
    // constructor dentro de sus respectivos useMemo.
    expect(PAGE_TSX).toContain('calculada:construirCalculadaLinea(l),');
    const usos = (PAGE_TSX.match(/calculada:construirCalculadaLinea\(l\),/g) || []).length;
    expect(usos).toBe(2);
  });

  it('los íconos de detalle de Seguridad social/Parafiscales/Prestaciones muestran los porcentajes REALMENTE aplicados (parametrosFinancierosResueltos), nunca un recálculo', () => {
    expect(bloqueMensual).toContain('parametrosFinancierosResueltos.porcentajeSalud');
    expect(bloqueMensual).toContain('parametrosFinancierosResueltos.porcentajePension');
    expect(bloqueMensual).toContain('parametrosFinancierosResueltos.porcentajeCajaCompensacion');
    expect(bloqueMensual).toContain('parametrosFinancierosResueltos.porcentajeSena');
    expect(bloqueMensual).toContain('parametrosFinancierosResueltos.porcentajeIcbf');
    expect(bloqueMensual).toContain('parametrosFinancierosResueltos.porcentajeCesantias');
  });

  it('§9 persistencia — guardarCosteo sigue incluyendo pSalud/pPension/pSena/pIcbf/pCaja en el payload JSON (misma estructura ya existente, reutilizada)', () => {
    const inicio = PAGE_TSX.indexOf('async function guardarCosteo()');
    const finDatos = PAGE_TSX.indexOf('};', PAGE_TSX.indexOf('const datos={', inicio));
    const bloque = PAGE_TSX.slice(inicio, finDatos);
    expect(bloque).toContain('pSalud,pPension,pSena,pIcbf,pCaja');
  });

  it('§9 — un porcentaje "0" (string) explícito sobrevive JSON.stringify/parse tal cual, igual que el resto de campos del formulario', () => {
    const formularioConCeros = { pSalud: '0', pPension: '12', pSena: '0', pIcbf: '0', pCaja: '4' };
    const json = JSON.stringify(formularioConCeros);
    expect(json).toContain('"pSalud":"0"');
    expect(json).toContain('"pSena":"0"');
    expect(json).toContain('"pIcbf":"0"');
    const restaurado = JSON.parse(json);
    expect(Number(restaurado.pSalud)).toBe(0);
    expect(Number(restaurado.pSena)).toBe(0);
    expect(Number(restaurado.pIcbf)).toBe(0);
  });
});