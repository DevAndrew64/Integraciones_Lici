/**
 * Ajuste "SERIALIZACIÓN HTTP '1'/'0'" (confirmado con evidencia real) —
 * un intento real de cierre (SQR 272702, Solicitud #129) fue rechazado
 * por GrupoColba enviando los literales `"true"`/`"false"`:
 * `{"errors":{"estadoFinalSqr":["The estado final sqr field must be true
 * or false."]}}`. La API receptora valida boolean estilo Laravel, que
 * exige los textuales `"1"`/`"0"`. Estos tests fijan ese contrato en el
 * único punto de serialización HTTP y evitan una regresión futura a
 * `"true"`/`"false"`.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cerrarSqrEnGrupoColba, clasificarErrorCierreSqrExterno } from './cerrar-sqr-externo';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('cerrarSqrEnGrupoColba — serialización HTTP de estadoFinalSqr', () => {
  it('estadoFinalSqr===true -> FormData contiene "1" (nunca "true")', async () => {
    const fetchSpy = vi.fn(async () => ({ ok: true, status: 200, text: async () => 'ok' }));
    vi.stubGlobal('fetch', fetchSpy);

    const resultado = await cerrarSqrEnGrupoColba({
      sqrNumero: 'SQR-1', observacion: 'obs', estadoFinalSqr: true,
    });

    expect(resultado.ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const body = (fetchSpy.mock.calls[0] as unknown as [string, { body: FormData }])[1].body;
    expect(body.get('estadoFinalSqr')).toBe('1');
    expect(body.get('estadoFinalSqr')).not.toBe('true');
  });

  it('estadoFinalSqr===false -> FormData contiene "0" (nunca "false")', async () => {
    const fetchSpy = vi.fn(async () => ({ ok: true, status: 200, text: async () => 'ok' }));
    vi.stubGlobal('fetch', fetchSpy);

    const resultado = await cerrarSqrEnGrupoColba({
      sqrNumero: 'SQR-2', observacion: 'obs', estadoFinalSqr: false,
    });

    expect(resultado.ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const body = (fetchSpy.mock.calls[0] as unknown as [string, { body: FormData }])[1].body;
    expect(body.get('estadoFinalSqr')).toBe('0');
    expect(body.get('estadoFinalSqr')).not.toBe('false');
  });

  it('estadoFinalSqr===null/undefined -> NO llama a fetch, devuelve error interno', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    // `estadoFinalSqr` está tipado `boolean` en la firma — este test fuerza
    // el caso defensivo (nulabilidad indefinida) igual que haría un fallo
    // de tipado en tiempo de ejecución, para blindar la rama `else`.
    const resultado = await cerrarSqrEnGrupoColba({
      sqrNumero: 'SQR-3', observacion: 'obs', estadoFinalSqr: null as unknown as boolean,
    });

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) {
      expect(resultado.error).toContain('En proceso');
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('nunca serializa el booleano como los literales "true"/"false" (regresión)', async () => {
    const fetchSpy = vi.fn(async () => ({ ok: true, status: 200, text: async () => 'ok' }));
    vi.stubGlobal('fetch', fetchSpy);

    await cerrarSqrEnGrupoColba({ sqrNumero: 'SQR-4', observacion: 'obs', estadoFinalSqr: true });
    await cerrarSqrEnGrupoColba({ sqrNumero: 'SQR-5', observacion: 'obs', estadoFinalSqr: false });

    for (const call of fetchSpy.mock.calls as unknown as [string, { body: FormData }][]) {
      const valor = call[1].body.get('estadoFinalSqr');
      expect(valor).not.toBe('true');
      expect(valor).not.toBe('false');
      expect(['0', '1']).toContain(valor);
    }
  });
});

describe('cerrarSqrEnGrupoColba — clasificación interna de errores externos (solo diagnóstico)', () => {
  it('422 + errors.estadoFinalSqr -> VALIDATION_ERROR', async () => {
    const rawText = JSON.stringify({
      message: 'The given data was invalid.',
      errors: { estadoFinalSqr: ['The estado final sqr field must be true or false.'] },
    });
    const fetchSpy = vi.fn(async () => ({ ok: false, status: 422, text: async () => rawText }));
    vi.stubGlobal('fetch', fetchSpy);

    const resultado = await cerrarSqrEnGrupoColba({ sqrNumero: 'SQR-6', observacion: 'obs', estadoFinalSqr: false });

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) {
      expect(resultado.status).toBe(422);
      expect(resultado.codigo).toBe('VALIDATION_ERROR');
      expect(resultado.error).toBe(rawText); // el cuerpo real de GrupoColba se conserva, nunca se reemplaza
    }
  });

  it('mensaje "estado ... En Proceso" -> EXTERNAL_NOT_IN_PROCESS, y NUNCA marca la SQR como cerrada', async () => {
    const rawText = JSON.stringify({
      message: 'Error al cerrar la SQR. Verifique que la SQR esté en estado "En Proceso" e intente nuevamente.',
    });
    const fetchSpy = vi.fn(async () => ({ ok: false, status: 400, text: async () => rawText }));
    vi.stubGlobal('fetch', fetchSpy);

    const resultado = await cerrarSqrEnGrupoColba({ sqrNumero: 'SQR-7', observacion: 'obs', estadoFinalSqr: false });

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) {
      expect(resultado.codigo).toBe('EXTERNAL_NOT_IN_PROCESS');
      expect(resultado.error).toBe(rawText);
    }
    // El contrato del resultado nunca incluye ni implica sqrCerrada/sqrCierreEstado —
    // eso lo decide únicamente `resultado.ok`, que aquí es `false`.
    expect('ok' in resultado && resultado.ok).toBe(false);
  });

  it('500 / texto genérico no reconocido -> EXTERNAL_GENERIC_ERROR', async () => {
    const rawText = '<html>Internal Server Error</html>';
    const fetchSpy = vi.fn(async () => ({ ok: false, status: 500, text: async () => rawText }));
    vi.stubGlobal('fetch', fetchSpy);

    const resultado = await cerrarSqrEnGrupoColba({ sqrNumero: 'SQR-8', observacion: 'obs', estadoFinalSqr: false });

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) {
      expect(resultado.status).toBe(500);
      expect(resultado.codigo).toBe('EXTERNAL_GENERIC_ERROR');
    }
  });

  it('error de red (fetch lanza excepción) -> EXTERNAL_GENERIC_ERROR, sin status', async () => {
    const fetchSpy = vi.fn(async () => { throw new Error('ECONNRESET'); });
    vi.stubGlobal('fetch', fetchSpy);

    const resultado = await cerrarSqrEnGrupoColba({ sqrNumero: 'SQR-9', observacion: 'obs', estadoFinalSqr: false });

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) {
      expect(resultado.codigo).toBe('EXTERNAL_GENERIC_ERROR');
      expect(resultado.status).toBeUndefined();
      expect(resultado.error).toBe('ECONNRESET');
    }
  });

  it('clasificarErrorCierreSqrExterno es conservador: 422 sin "errors" no es VALIDATION_ERROR', () => {
    const codigo = clasificarErrorCierreSqrExterno(422, JSON.stringify({ message: 'algo distinto' }));
    expect(codigo).toBe('EXTERNAL_GENERIC_ERROR');
  });

  it('clasificarErrorCierreSqrExterno: "estado" sin "en proceso" no dispara EXTERNAL_NOT_IN_PROCESS', () => {
    const codigo = clasificarErrorCierreSqrExterno(400, JSON.stringify({ message: 'El estado del recurso es inválido' }));
    expect(codigo).toBe('EXTERNAL_GENERIC_ERROR');
  });
});
