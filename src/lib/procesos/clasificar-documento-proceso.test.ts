import { describe, it, expect } from 'vitest';
import { clasificarDocumentoProceso } from './clasificar-documento-proceso';

describe('clasificarDocumentoProceso', () => {
  it('nombre que empieza por "Adenda" -> ADENDA, incluso en primera sincronización', () => {
    expect(clasificarDocumentoProceso({ nombre: 'Adenda No. 1', esPrimeraSincronizacion: true })).toBe('ADENDA');
    expect(clasificarDocumentoProceso({ nombre: 'Adendo modificatorio', esPrimeraSincronizacion: false })).toBe('ADENDA');
  });

  it('palabra "modificacion"/"alcance" -> MODIFICACION', () => {
    expect(clasificarDocumentoProceso({ nombre: 'Modificacion al cronograma', esPrimeraSincronizacion: false })).toBe('MODIFICACION');
    expect(clasificarDocumentoProceso({ nombre: 'Alcance al pliego de condiciones', esPrimeraSincronizacion: false })).toBe('MODIFICACION');
  });

  it('primera sincronización sin palabra clave -> DOCUMENTO_INICIAL', () => {
    expect(clasificarDocumentoProceso({ nombre: 'Estudios previos', esPrimeraSincronizacion: true })).toBe('DOCUMENTO_INICIAL');
  });

  it('documento posterior sin palabra clave -> DOCUMENTO_NUEVO (nunca ADENDA por defecto)', () => {
    expect(clasificarDocumentoProceso({ nombre: 'Acta de adjudicación', esPrimeraSincronizacion: false })).toBe('DOCUMENTO_NUEVO');
    expect(clasificarDocumentoProceso({ nombre: 'Informe de evaluación de ofertas', esPrimeraSincronizacion: false })).toBe('DOCUMENTO_NUEVO');
  });

  it('"observaciones" posterior a la creación ya NO se asume adenda (corrige el comportamiento legado)', () => {
    expect(clasificarDocumentoProceso({ nombre: 'Respuesta a observaciones', esPrimeraSincronizacion: false })).toBe('OTRO');
  });

  it('es insensible a mayúsculas y tildes', () => {
    expect(clasificarDocumentoProceso({ nombre: 'ADÉNDA número 2', esPrimeraSincronizacion: false })).toBe('ADENDA');
  });
});
