/**
 * Ajuste "TARIFA REGULADA — LUNES A DOMINGOS Y FESTIVOS (30 DÍAS)"
 * (decisión explícita del usuario, confirmada vía AskUserQuestion) — la
 * alternativa "Lunes a Domingos y Festivos" (30 días/mes) en el selector
 * "Días de prestación del servicio" de la pestaña Tarifa Regulada solo
 * debe aparecer/quedar seleccionable cuando el turno elegido es Servicio
 * 24 Horas — la fuente oficial no demuestra un valor independiente para
 * Turno 1/Turno 2. Mismo patrón de texto fuente que el resto de
 * *-page.test.ts (sin harness de render de componentes en este repo).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PAGE_TSX = readFileSync(join(__dirname, '../../app/page.tsx'), 'utf-8');

function extraerTabTarifaRegulada(): string {
  const inicio = PAGE_TSX.indexOf("tab==='tarifaRegulada'&&(()=>{");
  const fin = PAGE_TSX.indexOf('{modalTarifaSNCAbierto', inicio);
  if (inicio === -1) throw new Error('No se encontró la pestaña Tarifa Regulada en page.tsx');
  return fin === -1 ? PAGE_TSX.slice(inicio, inicio + 20000) : PAGE_TSX.slice(inicio, fin);
}
const TAB = extraerTabTarifaRegulada();

describe('1/7) La opción "Lunes a Domingos y Festivos" aparece en el catálogo/selector UI', () => {
  it('ETIQUETA_PATRON_TR incluye la nueva alternativa con "30 días/mes"', () => {
    expect(TAB).toContain("LUNES_A_DOMINGOS_Y_FESTIVOS:'Lunes a Domingos y Festivos (30 días/mes)'");
  });
});

describe('Las 7 alternativas actuales conservan exactamente sus etiquetas (sin alterar nada)', () => {
  it('ETIQUETA_PATRON_TR conserva las 7 etiquetas originales, byte a byte', () => {
    expect(TAB).toContain("LUNES_A_VIERNES_SIN_FESTIVOS:'Lunes a Viernes sin festivos (20 días/mes)'");
    expect(TAB).toContain("LUNES_A_VIERNES_CON_FESTIVOS:'Lunes a Viernes con festivos (22 días/mes)'");
    expect(TAB).toContain("LUNES_A_SABADOS_SIN_FESTIVOS:'Lunes a Sábados sin festivos (24 días/mes)'");
    expect(TAB).toContain("LUNES_A_SABADOS_CON_FESTIVOS:'Lunes a Sábados con festivos (26 días/mes)'");
    expect(TAB).toContain("FESTIVOS:'Festivos (2 días/mes)'");
    expect(TAB).toContain("SABADOS_Y_DOMINGOS:'Sábados y Domingos (8 días/mes)'");
    expect(TAB).toContain("SABADOS_DOMINGOS_Y_FESTIVOS:'Sábados, Domingos y Festivos (10 días/mes)'");
  });
  it('PATRONES_DIAS_TR_BASE (las 7 de siempre) no cambia de contenido', () => {
    expect(TAB).toContain("const PATRONES_DIAS_TR_BASE=['LUNES_A_VIERNES_SIN_FESTIVOS','LUNES_A_VIERNES_CON_FESTIVOS','LUNES_A_SABADOS_SIN_FESTIVOS','LUNES_A_SABADOS_CON_FESTIVOS','FESTIVOS','SABADOS_Y_DOMINGOS','SABADOS_DOMINGOS_Y_FESTIVOS'] as const;");
  });
});

describe('Combinaciones de turno inválidas quedan bloqueadas en la UI (no aparece la opción)', () => {
  it('el <select> de "Días de prestación del servicio" solo agrega la nueva opción cuando pos.turno===SERVICIO_24H — Turno 1/Turno 2 solo ven las 7 de siempre', () => {
    expect(TAB).toContain("{(pos.turno==='SERVICIO_24H'?[...PATRONES_DIAS_TR_BASE,'LUNES_A_DOMINGOS_Y_FESTIVOS'] as const:PATRONES_DIAS_TR_BASE).map(v=><option key={v} value={v}>{ETIQUETA_PATRON_TR[v]}</option>)}");
  });
});

describe('8) Guardar/reabrir conserva la selección', () => {
  it('patronDias se guarda/lee como un campo plano más de PosicionTarifaReguladaVigicolba (mismo mecanismo genérico que tipoServicio/modalidad/turno, sin serialización especial para el nuevo valor)', () => {
    expect(PAGE_TSX).toContain('actualizarPosicionTarifaRegulada(pos.id,{patronDias:(e.target.value||undefined) as PatronDiasVigilanciaVigicolba|undefined})');
  });
});

describe('Ajuste "TARIFA REGULADA — PRIMA SEGURO DE VIDA VISIBLE" — campo informativo en UI', () => {
  it('el campo "Prima Seguro de Vida" aparece junto a los demás valores resueltos de la posición, no escondido dentro del total', () => {
    expect(TAB).toContain('Prima Seguro de Vida (incluida)');
    expect(TAB).toContain("resolucion.estado==='RESUELTA'?cop(resolucion.valorPrimaSeguroVida):'—'");
  });
  it('es de SOLO LECTURA (texto plano, nunca un <input>/<select> editable para este campo)', () => {
    const inicio = TAB.indexOf('Prima Seguro de Vida (incluida)');
    const bloque = TAB.slice(inicio, inicio + 260);
    expect(bloque).not.toMatch(/<input|<select/);
  });
  it('NO se persiste como campo propio de la posición — se deriva siempre de resolverTarifaPosicionRegulada, nunca se escribe con actualizarPosicionTarifaRegulada', () => {
    expect(PAGE_TSX).not.toMatch(/actualizarPosicionTarifaRegulada\(pos\.id,\{valorPrimaSeguroVida/);
  });
  it('no duplica el total: "Valor total de oferta" sigue viniendo exclusivamente de valorOferta (calcularValorOfertaPosicionRegulada), sin sumar la prima aparte', () => {
    const idxValorTotal = TAB.indexOf('Valor total de oferta</div>');
    expect(idxValorTotal).toBeGreaterThan(-1);
    const bloque = TAB.slice(idxValorTotal, idxValorTotal + 220);
    expect(bloque).toContain('{cop(valorOferta)}');
    expect(bloque).not.toContain('valorPrimaSeguroVida');
  });
});

describe('Ajuste "TARIFA REGULADA — HORAS DE SERVICIO POR TURNO" — campo condicional en UI', () => {
  it('1/2) el campo "Horas de servicio" solo se renderiza cuando pos.turno es TURNO_1 o TURNO_2', () => {
    expect(TAB).toContain("{(pos.turno==='TURNO_1'||pos.turno==='TURNO_2')&&(");
    expect(TAB).toContain('Horas de servicio');
  });
  it('3) Servicio 24 Hrs no muestra el campo — el bloque completo del input está DENTRO del gate anterior, nunca fuera', () => {
    const idxGate = TAB.indexOf("{(pos.turno==='TURNO_1'||pos.turno==='TURNO_2')&&(");
    const idxInput = TAB.indexOf('Horas de servicio', idxGate);
    const idxCierreDias = TAB.indexOf('Días de prestación del servicio');
    expect(idxGate).toBeGreaterThan(-1);
    expect(idxInput).toBeGreaterThan(idxGate);
    expect(idxInput).toBeLessThan(idxCierreDias); // el campo vive antes del bloque de Días, dentro del gate condicional
  });
  it('4/5) al cambiar de turno se precarga la jornada completa (13 Turno 1, 11 Turno 2) — mismo resultado que el cálculo actual si no se toca', () => {
    expect(TAB).toContain("actualizarPosicionTarifaRegulada(pos.id,{turno:v,horasServicio:v==='TURNO_1'||v==='TURNO_2'?HORAS_JORNADA_TURNO_VIGILANCIA_VIGICOLBA[v]:undefined});");
  });
  it('14) al cambiar a Servicio 24 Hrs, horasServicio se limpia (undefined) — nunca deja un prorrateo fraccionado "fantasma" activo', () => {
    // Misma línea de arriba: el ternario asigna `undefined` para
    // cualquier valor de turno que NO sea TURNO_1/TURNO_2 (incluido
    // SERVICIO_24H y la deselección "Sin seleccionar").
    expect(TAB).toContain("?HORAS_JORNADA_TURNO_VIGILANCIA_VIGICOLBA[v]:undefined});");
  });
  it('15) validaciones de rango: min=1, max=jornada del turno elegido (13 Turno 1, 11 Turno 2), enteros (step=1) — el propio input nunca permite 0/negativos/exceso', () => {
    expect(TAB).toContain('<input type="number" min="1" max={HORAS_JORNADA_TURNO_VIGILANCIA_VIGICOLBA[pos.turno]} step="1"');
    expect(TAB).toContain('Math.min(max,Math.max(1,Math.round(Number(e.target.value)||1)))');
  });
  it('13) se guarda/lee como campo plano de la posición — mismo mecanismo genérico que patronDias/turno, sin serialización especial', () => {
    expect(TAB).toContain('actualizarPosicionTarifaRegulada(pos.id,{horasServicio:Math.min(max,Math.max(1,Math.round(Number(e.target.value)||1)))});');
  });
});
