import { describe, it, expect } from 'vitest';
import {
  CANONICO_A_BANDEJA, ESTADOS_CANONICOS_CUBIERTOS, estadosCanonicosDeBandeja,
  sqlListaComillas, SQL_NO_TERMINAL,
} from './bandeja-canonico';

describe('bandeja-canonico — mapa central P0', () => {
  it('cada estado canónico cubierto pertenece a EXACTAMENTE una bandeja (nunca dos)', () => {
    for (const estado of ESTADOS_CANONICOS_CUBIERTOS) {
      const bandejas = (['POR_VALIDAR', 'EN_OBSERVACION', 'EN_EJECUCION', 'EN_EVALUACION', 'CERRADOS'] as const)
        .filter((b) => estadosCanonicosDeBandeja(b).includes(estado));
      expect(bandejas).toHaveLength(1);
      expect(bandejas[0]).toBe(CANONICO_A_BANDEJA[estado]);
    }
  });

  it('APROBADO_ELABORACION y EN_ELABORACION mapean a EN_EJECUCION (caso de los 11 procesos recuperados)', () => {
    expect(CANONICO_A_BANDEJA.APROBADO_ELABORACION).toBe('EN_EJECUCION');
    expect(CANONICO_A_BANDEJA.EN_ELABORACION).toBe('EN_EJECUCION');
  });

  it('PRESENTADO mapea a EN_EVALUACION', () => {
    expect(CANONICO_A_BANDEJA.PRESENTADO).toBe('EN_EVALUACION');
  });

  it('ASIGNADO_REVISION y EN_REVISION mapean a POR_VALIDAR', () => {
    expect(CANONICO_A_BANDEJA.ASIGNADO_REVISION).toBe('POR_VALIDAR');
    expect(CANONICO_A_BANDEJA.EN_REVISION).toBe('POR_VALIDAR');
  });

  it('EN_OBSERVACION mapea a EN_OBSERVACION', () => {
    expect(CANONICO_A_BANDEJA.EN_OBSERVACION).toBe('EN_OBSERVACION');
  });

  it('CERRADA y CANCELADA mapean a CERRADOS', () => {
    expect(CANONICO_A_BANDEJA.CERRADA).toBe('CERRADOS');
    expect(CANONICO_A_BANDEJA.CANCELADA).toBe('CERRADOS');
  });

  it('REVISION_FINALIZADA mapea DIRECTO a EN_EJECUCION — ya no hay aprobación posterior de Coordinador/Director (P0.1 revisado)', () => {
    expect(ESTADOS_CANONICOS_CUBIERTOS).toContain('REVISION_FINALIZADA');
    expect(CANONICO_A_BANDEJA.REVISION_FINALIZADA).toBe('EN_EJECUCION');
  });

  it('REVISION_FINALIZADA nunca vuelve a Por validar', () => {
    expect(estadosCanonicosDeBandeja('POR_VALIDAR')).not.toContain('REVISION_FINALIZADA');
  });

  it('estadosCanonicosDeBandeja(EN_EJECUCION) incluye REVISION_FINALIZADA además de APROBADO_ELABORACION/EN_ELABORACION', () => {
    expect(estadosCanonicosDeBandeja('EN_EJECUCION').sort()).toEqual(['APROBADO_ELABORACION', 'EN_ELABORACION', 'REVISION_FINALIZADA'].sort());
  });

  it('SELECCION_PROCESO/REVISION_COMERCIAL (preselección) no están cubiertos', () => {
    expect(ESTADOS_CANONICOS_CUBIERTOS).not.toContain('SELECCION_PROCESO');
    expect(ESTADOS_CANONICOS_CUBIERTOS).not.toContain('REVISION_COMERCIAL');
  });

  it('sqlListaComillas produce una lista IN() válida', () => {
    expect(sqlListaComillas(['A', 'B'])).toBe(`'A','B'`);
    expect(sqlListaComillas([])).toBe('');
  });

  it('SQL_NO_TERMINAL excluye variantes legadas y canónicas de cerrado/cancelado', () => {
    // Verificación textual de la expresión (la semántica SQL real se prueba
    // en la verificación de integración de solo lectura contra la BD).
    expect(SQL_NO_TERMINAL).toContain(`NOT ILIKE '%cerrad%'`);
    expect(SQL_NO_TERMINAL).toContain(`NOT ILIKE '%cancelad%'`);
  });
});
