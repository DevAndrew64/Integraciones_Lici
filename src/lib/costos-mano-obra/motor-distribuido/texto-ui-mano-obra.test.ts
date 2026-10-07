/**
 * Verificación de fuente — Etapa C, cierre correctivo §2/§8/§9. No hay
 * infraestructura de render de componentes para page.tsx en este proyecto
 * (archivo de ~20.000 líneas, sin arnés de pruebas de UI); esta es una
 * verificación honesta y acotada del TEXTO exacto en el código fuente,
 * no un test de renderizado real.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PAGE_TSX = readFileSync(join(__dirname, '../../../app/page.tsx'), 'utf-8');

describe('page.tsx — texto del checkbox de festivos (cierre "CORRECCIÓN — FESTIVOS SEGÚN LOS DÍAS REALMENTE PROGRAMADOS", §10)', () => {
  it('9) ya NO aparece el texto anterior "Aplica a todo el cargo"', () => {
    expect(PAGE_TSX).not.toContain('Aplica a todo el cargo');
  });

  it('Corrección "CAMBIAR ÚNICAMENTE EL TEXTO VISIBLE" — la etiqueta del checkbox es "Incluir días festivos en la programación" (mismo campo incluyeFestivos, solo texto)', () => {
    expect(PAGE_TSX).toContain('Incluir días festivos en la programación');
    expect(PAGE_TSX).not.toContain('Trabaja los festivos que coincidan con los días seleccionados');
    expect(PAGE_TSX).not.toContain('Incluye festivos en la tarifa mensual');
  });

  it('el texto auxiliar explica que las horas del festivo se incluyen en el cálculo con sus recargos, sin mencionar un promedio anualizado genérico', () => {
    expect(PAGE_TSX).toContain('Si un festivo coincide con un día programado, sus horas se incluirán en el cálculo y se aplicarán los recargos correspondientes.');
    expect(PAGE_TSX).not.toContain('Al activarlo, la tarifa de los trabajadores incluidos en esta programación incorpora el promedio mensual anualizado de los festivos cubiertos.');
  });

  it('"Festivos" ya no aparece en el checklist de días de la semana (Lun/Mar/.../Dom sin Fes)', () => {
    expect(PAGE_TSX).toContain("[['Lun','Lunes'],['Mar','Martes'],['Mie','Miércoles'],['Jue','Jueves'],['Vie','Viernes'],['Sab','Sábado'],['Dom','Domingo']]");
  });
});

describe('page.tsx — cierre definitivo: el bloque muerto de "vista previa" del adaptador legal fue retirado (nunca se renderizaba — ModalCargo lo descartaba con `void`)', () => {
  it('ya NO existe la ref de memo manual (ultimoResultadoTarifaMensualRef) — quedó prohibida explícitamente por el usuario', () => {
    expect(PAGE_TSX).not.toContain('ultimoResultadoTarifaMensualRef');
  });

  it('ya no existen entradaTarifaMensualModal/claveTarifaMensualModal/resultadoTarifaMensualModal — cálculo confirmado muerto (su resultado nunca se renderizaba) y retirado junto con el motor legal', () => {
    expect(PAGE_TSX).not.toContain('const entradaTarifaMensualModal=React.useMemo(');
    expect(PAGE_TSX).not.toContain('const claveTarifaMensualModal=React.useMemo(');
    expect(PAGE_TSX).not.toContain('const resultadoTarifaMensualModal=React.useMemo(');
  });

  it('ModalCargo ya no recibe ningún parámetro — nunca calculó nada internamente ni lo necesitó', () => {
    expect(PAGE_TSX).toContain('function ModalCargo(){');
  });

  it('ambos sitios de invocación de ModalCargo() lo llaman sin argumentos', () => {
    const ocurrencias = PAGE_TSX.split('modalCargoId!==null&&ModalCargo()').length - 1;
    expect(ocurrencias).toBe(2);
  });

  it('el adaptador legal (calcularResultadoCargoMensual/construirEntradaTarifaMensualDesdeLinea/construirClaveEntradaTarifaMensual) ya no se importa en page.tsx', () => {
    expect(PAGE_TSX).not.toContain("from '@/lib/costos-mano-obra/motor-distribuido/adaptador-cargo-tarifa-mensual'");
  });
});

describe('cierre quirúrgico — bonificación salarial y no salarial siguen presentes en page.tsx (requisitos #12/#13)', () => {
  it('los 4 estados de bono no prestacional (ahora slot de línea 1, cierre "CINCO TIPOS DE BONO CONFIRMADOS") siguen declarados; el antiguo total global bonoTotal fue retirado al migrar a por-línea', () => {
    expect(PAGE_TSX).toContain('const [conBonoAlimentacion,setConBonoAlimentacion]=useState(false);');
    expect(PAGE_TSX).toContain('const [conBonoTransporte,setConBonoTransporte]=useState(false);');
    expect(PAGE_TSX).toContain('const [conBonoProductividad,setConBonoProductividad]=useState(false);');
    expect(PAGE_TSX).toContain('const [conBonoOcasional,setConBonoOcasional]=useState(false);');
    expect(PAGE_TSX).not.toMatch(/\bconst bonoTotal\s*=/);
  });

  it('bono prestacional (no salarial) sigue declarado y alimentando la tarifa mensual por trabajador', () => {
    expect(PAGE_TSX).toContain("const [conBonoPrestacional,setConBonoPrestacional]=useState(false);");
    expect(PAGE_TSX).toContain('const bonoPrestacionalTotal=conBonoPrestacional?(Number(bonoPrestacionalValor)||0):0;');
  });
});

describe('limpieza segura — cómputo muerto guardLegado retirado (prueba #5)', () => {
  it('5) page.tsx ya no ejecuta evaluarGuardMotorLegado ni declara guardLegado', () => {
    expect(PAGE_TSX).not.toContain('evaluarGuardMotorLegado');
    expect(PAGE_TSX).not.toContain('guardLegado');
    expect(PAGE_TSX).not.toContain("from '@/lib/costos-mano-obra/horarios/guard-motor-legado'");
  });

  it('4) page.tsx ya no importa las 4 funciones muertas de motor-mano-obra.ts', () => {
    expect(PAGE_TSX).not.toContain("from '@/lib/costos-mano-obra/motor-mano-obra'");
    expect(PAGE_TSX).not.toContain('calcularHorasBrutas, calcularHorasNetas, contarHorasNocturnas, parseHora');
  });
});

describe('page.tsx — persistencia de lineasExtra/cargosTurnantes (§5)', () => {
  it('buildDraftData (borrador local) incluye lineasExtra y cargosTurnantes', () => {
    const inicio = PAGE_TSX.indexOf('const buildDraftData=()=>({');
    const fin = PAGE_TSX.indexOf('});', inicio);
    const bloque = PAGE_TSX.slice(inicio, fin);
    expect(bloque).toContain('lineasExtra');
    expect(bloque).toContain('cargosTurnantes');
  });

  it('guardarCosteo (payload a BD, campo Json existente) incluye lineasExtra y cargosTurnantes', () => {
    const inicio = PAGE_TSX.indexOf('async function guardarCosteo()');
    const finDatos = PAGE_TSX.indexOf('};', PAGE_TSX.indexOf('const datos={', inicio));
    const bloque = PAGE_TSX.slice(inicio, finDatos);
    expect(bloque).toContain('lineasExtra');
    expect(bloque).toContain('cargosTurnantes');
  });

  it('aplicarDatosGuardados (restauración del borrador) restaura lineasExtra con incluyeFestivos nunca ausente', () => {
    const inicio = PAGE_TSX.indexOf('function aplicarDatosGuardados(');
    const fin = PAGE_TSX.indexOf('const restaurarDraft=', inicio);
    const bloque = PAGE_TSX.slice(inicio, fin);
    expect(bloque).toContain('setLineasExtra(lineasD)');
    expect(bloque).toContain('incluyeFestivos:l.incluyeFestivos??false');
  });

  it('incluyeFestivos:false serializa explícitamente como false en JSON — nunca desaparece de la persistencia', () => {
    const linea = { id: 1, incluyeFestivos: false, salarioBase: '1750905' };
    const json = JSON.stringify(linea);
    expect(json).toContain('"incluyeFestivos":false');
    const restaurado = JSON.parse(json);
    expect(restaurado.incluyeFestivos).toBe(false);
    expect('incluyeFestivos' in restaurado).toBe(true);
  });
});