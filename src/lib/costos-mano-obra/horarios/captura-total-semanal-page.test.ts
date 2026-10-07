/**
 * Ajuste "CORRECCIÓN UX MÍNIMA — CAMPO DIRECTO DE HORAS SEMANALES" —
 * pruebas de fuente (patrón ya establecido: escanear page.tsx como texto,
 * sin jsdom/RTL) para la captura TOTAL_SEMANAL en línea, directamente en
 * la pantalla principal del modal "Horario · Turnos · Jornadas" — nunca
 * abre una segunda pantalla, nunca solicita días/bloques/horas de
 * entrada-salida.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PAGE_TSX = readFileSync(join(__dirname, '../../../app/page.tsx'), 'utf-8');

describe('prueba 1/3 — sin programación se muestra el campo de horas, en la pantalla principal (nunca abre otra pantalla)', () => {
  it('el campo "Horas semanales"/"Aplicar" vive en el mismo bloque que "+ Agregar horario", dentro del editor CERRADO — nunca dispara modoEditorDistribucion', () => {
    expect(PAGE_TSX).toContain('O registrar únicamente el total semanal:');
    expect(PAGE_TSX).toContain('onClick={aplicarHorasSemanalesInline}');
    // aplicarHorasSemanalesInline nunca llama a setModoEditorDistribucion —
    // confirma que "Aplicar" no abre el editor de días/bloques.
    const inicio = PAGE_TSX.indexOf('function aplicarHorasSemanalesInline()');
    const fin = PAGE_TSX.indexOf('function iniciarEdicionHorasSemanalesInline', inicio);
    const bloque = PAGE_TSX.slice(inicio, fin);
    expect(bloque).not.toContain('setModoEditorDistribucion');
    expect(bloque).not.toContain('setCreandoHorario');
  });
});

describe('prueba 2 — el botón "Registrar horas semanales" ya no existe', () => {
  it('no queda ningún rastro del botón ni de la función que abría la segunda pantalla', () => {
    expect(PAGE_TSX).not.toContain('Registrar horas semanales');
    expect(PAGE_TSX).not.toContain('iniciarNuevaDistribucionTotalSemanal');
    expect(PAGE_TSX).not.toContain('confirmarDistribucionTotalSemanal');
    expect(PAGE_TSX).not.toContain('capturaTotalSemanal');
  });
});

describe('prueba 4/5 — no se solicitan días ni se crean bloques horarios', () => {
  it('aplicarHorasSemanalesInline construye la distribución con diasSemana:[] y bloques:[] siempre, sin leer diasSeleccionadosDraft', () => {
    const inicio = PAGE_TSX.indexOf('function aplicarHorasSemanalesInline()');
    const fin = PAGE_TSX.indexOf('function iniciarEdicionHorasSemanalesInline', inicio);
    const bloque = PAGE_TSX.slice(inicio, fin);
    expect(bloque).toContain('diasSemana:[],bloques:[]');
    expect(bloque).not.toContain('diasSeleccionadosDraft');
    expect(bloque).not.toContain('horaInicio');
    expect(bloque).not.toContain('horaFin');
  });
});

describe('prueba 6/7/16 — cálculos: horas mensuales (×4,33) y salario proporcional, nunca 24,08', () => {
  it('la tarjeta TOTAL_SEMANAL usa calcularHorasServicioMes (FACTOR_SEMANAS_MES, nunca 24,08) para las horas mensuales proyectadas', () => {
    expect(PAGE_TSX).toContain('calcularHorasServicioMes(distribucionTotalSemanal.horasSemanalesManual||0)');
    expect(PAGE_TSX).not.toContain('horasSemanalesManual*24.08');
    expect(PAGE_TSX).not.toContain('horasSemanalesManual*24,08');
  });
  it('el salario proporcional sigue calculándose con calcularSalarioProporcionalServicio (construirCalculadaLinea, único punto de entrada monetario para TOTAL_SEMANAL)', () => {
    expect(PAGE_TSX).toContain('calcularSalarioProporcionalServicio(salarioMensualL,horasSemanalesTotal)');
  });
});

describe('prueba 8 — después de guardar se muestra la tarjeta TOTAL_SEMANAL', () => {
  it('la tarjeta "Servicio por total semanal" existe y muestra horas semanales + horas mensuales proyectadas, sin datos de días/franjas', () => {
    expect(PAGE_TSX).toContain('Servicio por total semanal');
    expect(PAGE_TSX).toContain('h semanales');
    expect(PAGE_TSX).toContain('h mensuales proyectadas');
  });
});

describe('prueba 9/10 — modalidades excluyentes en la pantalla principal', () => {
  it('con TOTAL_SEMANAL existente se oculta "+ Agregar horario" (el botón solo se renderiza cuando !distribucionTotalSemanal)', () => {
    const inicio = PAGE_TSX.indexOf('onClick={iniciarNuevaDistribucion}');
    const contexto = PAGE_TSX.slice(inicio - 300, inicio);
    expect(contexto).toContain('!editorAbierto&&!distribucionTotalSemanal&&(');
  });
  it('con HORARIO_DETALLADO existente se oculta el campo de horas semanales (solo se muestra cuando !tieneHorarioDetallado)', () => {
    const inicio = PAGE_TSX.indexOf('O registrar únicamente el total semanal:');
    const contexto = PAGE_TSX.slice(inicio - 300, inicio);
    expect(contexto).toContain('!tieneHorarioDetallado&&(');
  });
});

describe('prueba 11 — no se pueden mezclar ambas modalidades', () => {
  it('aplicarHorasSemanalesInline rechaza si ya existe una distribución que no es TOTAL_SEMANAL (protección en la función de guardado, no solo en la UI)', () => {
    const inicio = PAGE_TSX.indexOf('function aplicarHorasSemanalesInline()');
    const fin = PAGE_TSX.indexOf('function iniciarEdicionHorasSemanalesInline', inicio);
    const bloque = PAGE_TSX.slice(inicio, fin);
    expect(bloque).toContain("d.tipoCapturaHorario!=='TOTAL_SEMANAL'");
  });
  it('confirmarDistribucion (HORARIO_DETALLADO) rechaza si ya existe una distribución TOTAL_SEMANAL', () => {
    const inicio = PAGE_TSX.indexOf('async function confirmarDistribucion():Promise<boolean>{');
    const bloque = PAGE_TSX.slice(inicio, inicio + 700);
    expect(bloque).toContain("d.tipoCapturaHorario==='TOTAL_SEMANAL'");
  });
});

describe('prueba 12 — editar solo modifica las horas, nunca abre el editor de días/bloques', () => {
  it('iniciarEdicionHorasSemanalesInline/guardarEdicionHorasSemanalesInline solo tocan horasSemanalesManual — nunca setModoEditorDistribucion/setCreandoHorario', () => {
    const inicioIniciar = PAGE_TSX.indexOf('function iniciarEdicionHorasSemanalesInline');
    const finIniciar = PAGE_TSX.indexOf('function guardarEdicionHorasSemanalesInline');
    const finGuardar = PAGE_TSX.indexOf('function cancelarEdicionHorasSemanalesInline');
    const bloqueCompleto = PAGE_TSX.slice(inicioIniciar, finGuardar);
    expect(bloqueCompleto).not.toContain('setModoEditorDistribucion');
    expect(bloqueCompleto).not.toContain('setCreandoHorario');
    expect(PAGE_TSX.slice(finIniciar, finGuardar)).toContain('horasSemanalesManual:horas');
  });
});

describe('prueba 13 — eliminar permite volver a escoger una modalidad', () => {
  it('eliminarDistribucion sigue siendo una simple desasociación por idCliente — tras eliminar el único TOTAL_SEMANAL, distribucionTotalSemanal vuelve a ser null y ambas opciones reaparecen', () => {
    expect(PAGE_TSX).toContain('function eliminarDistribucion(idCliente:string){');
    expect(PAGE_TSX).toContain('distribucionesActuales.filter(d=>d.idCliente!==idCliente)');
    // La tarjeta TOTAL_SEMANAL usa eliminarDistribucion, igual que las
    // tarjetas de horario detallado — mismo mecanismo, sin caso especial.
    expect(PAGE_TSX).toContain('eliminarDistribucion(distribucionTotalSemanal.idCliente)');
  });
});

describe('prueba 14 — se oculta el checkbox de festivos cuando existe TOTAL_SEMANAL', () => {
  it('el checkbox "Incluir días festivos en la programación" solo se renderiza cuando !distribucionTotalSemanal', () => {
    const inicioGate = PAGE_TSX.indexOf('!editorAbierto&&!distribucionTotalSemanal&&(\n              <div style={{marginTop:12,paddingTop:12');
    expect(inicioGate).toBeGreaterThan(-1);
    const inicioTexto = PAGE_TSX.indexOf('>Incluir días festivos en la programación</span>');
    expect(inicioTexto).toBeGreaterThan(inicioGate);
    expect(inicioTexto - inicioGate).toBeLessThan(600);
  });
});

describe('prueba 15 — TOTAL_SEMANAL no genera recargos', () => {
  it('construirCalculadaLinea (rama TOTAL_SEMANAL) usa DISTRIBUCION_HORAS_METODO_COMERCIAL_VACIA, nunca pasa horasExtraSemanales', () => {
    const inicio = PAGE_TSX.indexOf('const construirCalculadaLinea=React.useCallback');
    const fin = PAGE_TSX.indexOf('const obtenerInterpretacionLinea=React.useCallback', inicio);
    const bloque = PAGE_TSX.slice(inicio, fin);
    expect(bloque).toContain('esLineaTotalSemanal(l)');
    expect(bloque).toContain('distribucionHoras:DISTRIBUCION_HORAS_METODO_COMERCIAL_VACIA,salarioMensual:salarioProporcional');
    const llamadaTotalSemanal = bloque.slice(
      bloque.indexOf('distribucionHoras:DISTRIBUCION_HORAS_METODO_COMERCIAL_VACIA'),
      bloque.indexOf('DISTRIBUCION_HORAS_METODO_COMERCIAL_VACIA') + 400,
    );
    expect(llamadaTotalSemanal).not.toContain('horasExtraSemanales');
  });
  it('la tarjeta muestra el mensaje discreto de recargos exigido', () => {
    expect(PAGE_TSX).toContain('Este registro calcula jornada y salario proporcional. Para calcular recargos debe utilizar un horario detallado.');
  });
});

describe('prueba 17 — HORARIO_DETALLADO no cambia', () => {
  it('"+ Agregar horario"/"+ Agregar otro horario", el editor de bloques y confirmarDistribucion siguen existiendo sin modificar su lógica', () => {
    expect(PAGE_TSX).toContain("distribucionesActuales.length===0?'+ Agregar horario':'+ Agregar otro horario'");
    expect(PAGE_TSX).toContain('onClick={iniciarNuevaDistribucion}');
    expect(PAGE_TSX).toContain('bloquesEditorHorario.map((b,i)=>{');
    expect(PAGE_TSX).toContain('async function confirmarDistribucion():Promise<boolean>{');
    expect(PAGE_TSX).toContain('guardarNuevoHorario()');
  });
});

describe('registros existentes se restauran como HORARIO_DETALLADO (compatibilidad histórica, sin cambios en este ajuste)', () => {
  it('esLineaTotalSemanal solo es true con comparación estricta a TOTAL_SEMANAL — un registro sin tipoCapturaHorario (undefined) nunca cumple la condición', () => {
    expect(PAGE_TSX).toContain("d.tipoCapturaHorario==='TOTAL_SEMANAL'");
    expect(PAGE_TSX).not.toContain("d.tipoCapturaHorario!=='HORARIO_DETALLADO'");
  });
});

describe('el salario base original nunca se sobrescribe (popover "Cálculo del salario proporcional" en la tabla de costos)', () => {
  it('el onChange del campo Salario sigue escribiendo únicamente en salarioBase/salBase (más la marca salarioEditadoManualmente, § turnantes) — el proporcional se muestra en un popover de solo lectura, nunca editable', () => {
    expect(PAGE_TSX).toContain("esLinea1?setSalBase(v):patch({salarioBase:v,salarioEditadoManualmente:true});");
    expect(PAGE_TSX).toContain('Cálculo del salario proporcional');
    expect(PAGE_TSX).toContain('Salario mensual del servicio:');
  });
});

describe('§10 no modificar — límites del ajuste', () => {
  it('no se agregaron nuevos modelos Prisma para este ajuste', () => {
    const schema = readFileSync(join(__dirname, '../../../../prisma/schema.prisma'), 'utf-8');
    expect(schema).not.toContain('model ServicioParcialTotalSemanal');
    expect(schema).not.toContain('model CapturaTotalSemanal');
  });
});