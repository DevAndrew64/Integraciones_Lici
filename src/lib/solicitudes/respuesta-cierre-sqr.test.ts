import { describe, it, expect } from 'vitest';
import { construirRespuestaCierreSqrPresentacion, construirRespuestaCierreSqrTerminal } from './respuesta-cierre-sqr';

describe('construirRespuestaCierreSqrPresentacion', () => {
  it('con código y entidad', () => {
    const t = construirRespuestaCierreSqrPresentacion({ codigoProceso: 'X-1-2026', entidad: 'Alcaldía' });
    expect(t).toBe('Se remite respuesta a la SQR asociada al proceso X-1-2026, correspondiente a Alcaldía. La gestión comercial requerida fue atendida y se adjunta el soporte correspondiente para su validación y cierre.');
  });

  it('sin código ni entidad — nunca escribe "null"/"undefined"', () => {
    const t = construirRespuestaCierreSqrPresentacion({});
    expect(t).not.toMatch(/null|undefined/i);
    expect(t).toBe('Se remite respuesta a la SQR asociada. La gestión comercial requerida fue atendida y se adjunta el soporte correspondiente para su validación y cierre.');
  });
});

describe('construirRespuestaCierreSqrTerminal', () => {
  it('con código y entidad', () => {
    const t = construirRespuestaCierreSqrTerminal({ codigoProceso: 'X-2-2026', entidad: 'Gobernación' });
    expect(t).toBe('Se remite respuesta a la SQR asociada al proceso X-2-2026, correspondiente a Gobernación. El proceso finalizó su gestión comercial sin continuar a la etapa de presentación/evaluación.');
  });

  it('solo con código', () => {
    const t = construirRespuestaCierreSqrTerminal({ codigoProceso: 'X-3-2026', entidad: null });
    expect(t).toBe('Se remite respuesta a la SQR asociada al proceso X-3-2026. El proceso finalizó su gestión comercial sin continuar a la etapa de presentación/evaluación.');
  });

  it('sin código ni entidad — nunca escribe "null"/"undefined"', () => {
    const t = construirRespuestaCierreSqrTerminal({});
    expect(t).not.toMatch(/null|undefined/i);
    expect(t).toBe('Se remite respuesta a la SQR asociada. El proceso finalizó su gestión comercial sin continuar a la etapa de presentación/evaluación.');
  });
});
