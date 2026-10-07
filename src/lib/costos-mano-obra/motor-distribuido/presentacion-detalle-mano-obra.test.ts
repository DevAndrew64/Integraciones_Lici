/**
 * Corrección "CONCENTRAR LA INTERPRETACIÓN EN UN ÚNICO DETALLE POR GRUPO"
 * — simplifica la presentación anterior (un badge/enlace por posición +
 * resumen siempre expandido) en una sola pieza `DetalleCoberturaGrupo`:
 * una franja compacta + UN único botón que abre/cierra UN único panel con
 * la interpretación de cada posición y el resumen consolidado. Pruebas de
 * humo por texto (sin jsdom/RTL, mismo patrón del resto del proyecto) que
 * confirman el cableado en page.tsx — la evidencia numérica real de la
 * detección 24/7 vive en `interprete-turnos-presentacion.test.ts` (función
 * pura, sin readFileSync). Estas pruebas nunca ejercitan cálculo,
 * turnantes, recargos, motor financiero, agregados ni persistencia — solo
 * confirman que el bloque visual quedó conectado como se pidió.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PAGE_TSX = readFileSync(join(__dirname, '../../../app/page.tsx'), 'utf-8');

function bloqueDetalleCoberturaGrupo(): string {
  const inicio = PAGE_TSX.indexOf('function DetalleCoberturaGrupo(');
  expect(inicio).toBeGreaterThan(-1);
  const fin = PAGE_TSX.indexOf('\n  }', inicio);
  return PAGE_TSX.slice(inicio, fin);
}

describe('1/4/5 — un único botón de detalle por grupo, sin enlaces repetidos por posición', () => {
  it('existe el componente DetalleCoberturaGrupo, pero la ficha del cargo ya no lo invoca (petición directa "QUITAR ESTO" sobre la franja "Ver detalle de programación")', () => {
    expect(PAGE_TSX).toContain('function DetalleCoberturaGrupo(');
    // Invocado fuera (después) del map de filas, nunca dentro de él.
    const inicioMapFilas = PAGE_TSX.indexOf('{grupo.filas.map(d=>(');
    const finMapFilas = PAGE_TSX.indexOf('grupo.agregadoFinanciero.hayLineasBloqueadas', inicioMapFilas);
    const bloqueMapFilas = PAGE_TSX.slice(inicioMapFilas, finMapFilas);
    expect(bloqueMapFilas).not.toContain('<DetalleCoberturaGrupo');
    expect(PAGE_TSX).not.toContain('<DetalleCoberturaGrupo grupo={grupo}/>');
  });
  it('los componentes retirados (InfoCoberturaPosicion, ResumenCoberturaGrupo, DetalleInterpretacionTurno) ya no existen', () => {
    expect(PAGE_TSX).not.toContain('function InfoCoberturaPosicion(');
    expect(PAGE_TSX).not.toContain('function ResumenCoberturaGrupo(');
    expect(PAGE_TSX).not.toContain('function DetalleInterpretacionTurno(');
  });
  it('solo existe UN botón visible (aria-label) con el texto "Ver detalle de programación" dentro de DetalleCoberturaGrupo (nunca uno por fila) — corrección "aca detalle de programacion"', () => {
    const bloque = bloqueDetalleCoberturaGrupo();
    // El botón se renderiza una sola vez (ternario abierto?'Ocultar...':'Ver...');
    // la 2ª ocurrencia del substring viene del título compartido
    // tituloBoton='Ver detalle de programación y jornada' (aria-label/title),
    // no de un segundo botón — confirmado por un solo <button> en el bloque.
    const ocurrenciasBoton = (bloque.match(/<button /g) || []).length;
    expect(ocurrenciasBoton).toBe(1);
    expect(bloque).toContain("abierto?'Ocultar detalle de programación':'Ver detalle de programación'");
  });
});

describe('3/6 — el detalle inicia cerrado y controla presentación mediante panelesDetalleInterpretacionAbiertos', () => {
  it('la clave de apertura es por GRUPO (grupo-{claveFicha}), nunca por posición individual', () => {
    const bloque = bloqueDetalleCoberturaGrupo();
    expect(bloque).toContain("const claveAbierto='grupo-'+grupo.claveFicha;");
    expect(bloque).toContain('const abierto=panelesDetalleInterpretacionAbiertos[claveAbierto]??false;');
  });
  it('el panel de detalle solo se renderiza cuando abierto es true (cerrado por defecto — useState/Record inicia vacío, ?? false)', () => {
    const bloque = bloqueDetalleCoberturaGrupo();
    expect(bloque).toContain('{abierto&&(');
  });
});

describe('4/7 — resumen consolidado y advertencia de relevo aparecen exactamente una vez, dentro del panel único', () => {
  it('el título visible "Resumen consolidado" se renderiza una sola vez (JSX), no una por fila', () => {
    const bloque = bloqueDetalleCoberturaGrupo();
    expect(bloque).toContain('<div style={{fontWeight:600,color:\'#0f172a\',marginBottom:2}}>Resumen consolidado</div>');
    const ocurrenciasJSX = (bloque.match(/>Resumen consolidado</g) || []).length;
    expect(ocurrenciasJSX).toBe(1);
  });
  it('la advertencia de relevo (advertenciaCobertura) se calcula UNA vez para el grupo y se renderiza UNA vez, nunca por fila', () => {
    const bloque = bloqueDetalleCoberturaGrupo();
    expect(bloque).toContain('const advertenciaRelevo=filasConCobertura[0]?advertenciaCobertura(');
    const ocurrenciasRender = (bloque.match(/\{advertenciaRelevo\}/g) || []).length;
    expect(ocurrenciasRender).toBe(1);
  });
});

describe('2/6 (contenido) — el panel muestra cada posición con horario, cobertura individual, semanal, jornada costeada e incluye festivos', () => {
  it('el panel itera grupo.filas y muestra los 4 datos por posición pedidos', () => {
    const bloque = bloqueDetalleCoberturaGrupo();
    expect(bloque).toContain('{grupo.filas.map((d,i)=>{');
    expect(bloque).toContain('<b>Horario:</b>');
    expect(bloque).toContain('<b>Cobertura individual:</b>');
    expect(bloque).toContain('<b>Cobertura semanal:</b>');
    expect(bloque).toContain('<b>Jornada ordinaria de referencia por trabajador:</b>');
    expect(bloque).toContain('Incluye festivos');
  });
});

describe('6 (consolidado) — el resumen muestra cobertura consolidada 24/7 y la cobertura semanal total', () => {
  it('usa detectarCoberturaConsolidada24x7 (función pura probada aparte) y expone coberturaSemanalTotal', () => {
    const bloque = bloqueDetalleCoberturaGrupo();
    expect(bloque).toContain('detectarCoberturaConsolidada24x7(');
    expect(bloque).toContain('grupo.filas.flatMap(d=>d.distribucionesHorario.map(dist=>({diasSemana:dist.diasSemana,bloques:dist.bloques})))');
    expect(bloque).toContain('const coberturaSemanalTotal=grupo.filas.reduce((s,d)=>s+d.horasCoberturaSemanal,0);');
    expect(bloque).toContain("consolidada24x7?'24/7'");
  });
  it('turnantes requeridos se lee del estado ya calculado (gruposNecesidadTurnantes), nunca recalculado', () => {
    const bloque = bloqueDetalleCoberturaGrupo();
    expect(bloque).toContain('gruposNecesidadTurnantes');
    expect(bloque).toContain('g.necesidad.cantidadTurnantesFisicos');
    expect(bloque).not.toContain('construirGruposNecesidadTurnantes(');
    expect(bloque).not.toContain('calcularNecesidadTurnantes(');
  });
});

describe('9 — un grupo no 24/7 muestra su interpretación correcta sin badge 24/7', () => {
  it('el rótulo del tipo de cobertura depende de consolidada24x7 — nunca fuerza "COBERTURA CONSOLIDADA 24/7" cuando es false', () => {
    const bloque = bloqueDetalleCoberturaGrupo();
    expect(bloque).toContain("const rotuloTipoCobertura=consolidada24x7?'COBERTURA CONSOLIDADA 24/7'");
    expect(bloque).toContain(':tiposCobertura.size===1?badgeTipoServicio([...tiposCobertura][0])');
  });
});

describe('10 — la vista principal (fila de cada posición) permanece compacta: sin badge, sin párrafo de cobertura individual, sin enlace', () => {
  it('la fila principal ya no incluye badgeTipoServicio ni "Ver cómo se interpreta"/"Ver detalle de programación" dentro del map de filas', () => {
    const inicioMapFilas = PAGE_TSX.indexOf('{grupo.filas.map(d=>(');
    const finMapFilas = PAGE_TSX.indexOf('grupo.agregadoFinanciero.hayLineasBloqueadas', inicioMapFilas);
    const bloqueMapFilas = PAGE_TSX.slice(inicioMapFilas, finMapFilas);
    expect(bloqueMapFilas).not.toContain('badgeTipoServicio');
    expect(bloqueMapFilas).not.toContain('Ver cómo se interpreta');
    expect(bloqueMapFilas).not.toContain('Ver detalle de programación');
    expect(bloqueMapFilas).not.toContain('Cobertura individual:');
  });
  it('la fila principal muestra únicamente las horas, sin caption ni jornada (ajustes "RETIRAR JORNADA DE LA TABLA PRINCIPAL" y "quitar aca" — la jornada de 42h y el rótulo "Cobertura" ya no se repiten aquí)', () => {
    expect(PAGE_TSX).toContain('{d.requiereCoberturaDescanso?(\n                        <>{d.horasCoberturaSemanal} h/sem.</>\n                      ):(');
    expect(PAGE_TSX).not.toContain('Jornada costeada: {d.horasJornadaLiquidadaSemanal} h/sem.');
    expect(PAGE_TSX).not.toContain(">Cobertura</div>");
  });
});

describe('7 (accesibilidad) — el botón de detalle tiene aria-label, title y aria-expanded', () => {
  it('el botón declara aria-label/title="Ver detalle de programación y jornada" y aria-expanded={abierto}', () => {
    const bloque = bloqueDetalleCoberturaGrupo();
    expect(bloque).toContain("const tituloBoton='Ver detalle de programación y jornada';");
    expect(bloque).toContain('aria-label={tituloBoton} title={tituloBoton}');
    expect(bloque).toContain('aria-expanded={abierto}');
  });
});

describe('5 — el botón vive en una franja después de las filas, nunca dentro de cada posición', () => {
  it('el botón (aria-label tituloBoton) está fuera del map de grupo.filas', () => {
    const inicioMapFilas = PAGE_TSX.indexOf('{grupo.filas.map(d=>(');
    const finMapFilas = PAGE_TSX.indexOf('grupo.agregadoFinanciero.hayLineasBloqueadas', inicioMapFilas);
    const bloqueMapFilas = PAGE_TSX.slice(inicioMapFilas, finMapFilas);
    expect(bloqueMapFilas).not.toContain('aria-label={tituloBoton}');
  });
});

describe('8 — los cambios visuales son de solo lectura: nunca tocan cálculo, turnantes, recargos, agregados ni persistencia', () => {
  it('DetalleCoberturaGrupo no llama a ningún setter económico ni de turnantes (solo el panel visual)', () => {
    const bloque = bloqueDetalleCoberturaGrupo();
    expect(bloque).not.toContain('setCargosTurnantes');
    expect(bloque).not.toContain('setLineasExtra');
    expect(bloque).not.toContain('patch(');
    expect(bloque).not.toContain('construirCalculadaLinea(');
    expect(bloque).not.toContain('construirGruposNecesidadTurnantes(');
    // El único estado que toca es el panel abierto/cerrado (puramente visual).
    expect(bloque).toContain('setPanelesDetalleInterpretacionAbiertos');
  });
});

describe('COSTO PARCIAL sigue retirado (invariante de la corrección anterior, no debe reaparecer)', () => {
  it('no existe el badge JSX ">COSTO PARCIAL<"', () => {
    expect(PAGE_TSX).not.toContain('>COSTO PARCIAL<');
  });
  it('avisoCostoParcial ya no se importa ni se usa en page.tsx', () => {
    expect(PAGE_TSX).not.toContain('avisoCostoParcial');
  });
});
