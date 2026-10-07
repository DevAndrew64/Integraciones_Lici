/**
 * Auditoría de cierre Fase B — correcciones a hallazgos menores 1/2/3, y
 * evolución posterior en vivo del bloque "Resumen Servicios no continuos"
 * (feedback iterativo, culminando en "MEJOR QUE EL RESUMEN SEA POR TIPO DE
 * SERVICIO Y EL VALOR TOTAL Y LISTO"):
 *
 * 1) El comentario cercano al selector de UEN en `ModalServicioNoContinuo`
 *    ya no describe UEN como solo-lectura/no-filtrante — refleja el
 *    adelanto puntual de Fase C realmente vigente.
 * 2) La tabla "Resumen Servicios no continuos" quedó simplificada a UNA
 *    fila por servicio (servicio + `calcularTotalesServicioNoContinuo(s,
 *    ...).total`) — nunca una fila por cargo/insumo/equipo/otro costo, y
 *    nunca una fórmula paralela: la MISMA fuente canónica que arma
 *    `totalServiciosNoContinuos`.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PAGE_TSX = readFileSync(join(__dirname, '../../app/page.tsx'), 'utf-8');

describe('hallazgo 1 — comentario del selector de UEN refleja el estado real (adelanto de Fase C)', () => {
  it('ya no afirma que UEN es solo lectura ni que el filtrado queda pendiente para Fase C', () => {
    expect(PAGE_TSX).not.toContain('UEN sigue siendo SOLO LECTURA');
    expect(PAGE_TSX).not.toContain('el filtrado UEN→Servicio y la asignación\n                // automática de código por UEN quedan para Fase C');
  });
  it('documenta explícitamente que UEN es seleccionable, filtra el servicio y limpia la selección previa al cambiar', () => {
    const inicio = PAGE_TSX.indexOf('Ajuste "REORDENAR UEN/CÓDIGO/SERVICIO"');
    expect(inicio).toBeGreaterThan(-1);
    const b = PAGE_TSX.slice(inicio, inicio + 700);
    expect(b).toContain('UEN ahora ES seleccionable y');
    expect(b).toContain('filtra la lista de "Servicio no continuo"');
    expect(b).toContain('cambiar la UEN limpia el');
    expect(b).toContain('servicio previamente elegido');
    expect(b).toContain('adelanto puntual');
  });
});

describe('"Resumen Servicios no continuos" — una fila por servicio, con su total canónico', () => {
  it('filasResumenServiciosNoContinuos mapea 1:1 con serviciosNoContinuos (nunca flatMap por bloque), leyendo calcularTotalesServicioNoContinuo(s,...).total', () => {
    expect(PAGE_TSX).toContain('const filasResumenServiciosNoContinuos=serviciosNoContinuos.map(s=>({');
    expect(PAGE_TSX).toContain('valor:calcularTotalesServicioNoContinuo(s,totalesManoObraPorServicioNoContinuo.get(s.id)??0).total,');
  });
  it('la tabla ya no tiene columna CARGO ni celdas combinadas (rowSpan) — solo SERVICIO/VALOR, una fila por servicio', () => {
    const inicio = PAGE_TSX.indexOf("{['SERVICIO','VALOR'].map((h,i)=>(");
    expect(inicio).toBeGreaterThan(-1);
    const b = PAGE_TSX.slice(inicio, inicio + 900);
    expect(b).not.toContain('rowSpan');
    expect(b).not.toContain("'CARGO'");
  });
});
