/**
 * FASE B.4.5 — pruebas del guardrail de destino de RUNTIME
 * (`verificarDestinoProduccion`). Sin BD ni red: la consulta de
 * `system_identifier` es un fake inyectado. El guardrail NUNCA abre
 * conexiones.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  verificarDestinoProduccion,
  IdentidadDestinoProduccionNoConfirmadaError,
  type ConsultaIdentidadDestino,
  type EntornoDestinoProduccion,
} from './guardrailDestinoProduccion.js';

// SIDs de prueba — NO son identificadores de infraestructura real.
const SID_OK = '1000000000000000001';
const SID_PROHIBIDO = '2000000000000000002';

function envOk(over: Partial<EntornoDestinoProduccion> = {}): EntornoDestinoProduccion {
  return {
    DATA_API_RUNTIME_DATABASE_URL: 'postgres://u:p@host:5432/db',
    DATA_API_RUNTIME_WRITE_ENABLED: 'true',
    DATA_API_RUNTIME_EXPECTED_SYSTEM_IDENTIFIER: SID_OK,
    ...over,
  };
}
function consulta(devuelve: string | (() => Promise<string>)): ConsultaIdentidadDestino & { spy: ReturnType<typeof vi.fn> } {
  const spy = vi.fn(async () => (typeof devuelve === 'function' ? devuelve() : devuelve));
  return { obtenerSystemIdentifier: spy, spy };
}

describe('verificarDestinoProduccion — precondiciones (aborta ANTES de consultar)', () => {
  it('falta DATA_API_RUNTIME_DATABASE_URL → aborta, no consulta', async () => {
    const c = consulta(SID_OK);
    await expect(
      verificarDestinoProduccion(envOk({ DATA_API_RUNTIME_DATABASE_URL: undefined }), c),
    ).rejects.toBeInstanceOf(IdentidadDestinoProduccionNoConfirmadaError);
    expect(c.spy).not.toHaveBeenCalled();
  });

  it('DATA_API_RUNTIME_WRITE_ENABLED != "true" exacto → aborta, no consulta', async () => {
    const c = consulta(SID_OK);
    for (const v of [undefined, 'false', 'TRUE', '1', ' true ']) {
      await expect(
        verificarDestinoProduccion(envOk({ DATA_API_RUNTIME_WRITE_ENABLED: v }), c),
      ).rejects.toBeInstanceOf(IdentidadDestinoProduccionNoConfirmadaError);
    }
    expect(c.spy).not.toHaveBeenCalled();
  });

  it('falta / vacío DATA_API_RUNTIME_EXPECTED_SYSTEM_IDENTIFIER → aborta, no consulta', async () => {
    const c = consulta(SID_OK);
    for (const v of [undefined, '', '   ']) {
      await expect(
        verificarDestinoProduccion(envOk({ DATA_API_RUNTIME_EXPECTED_SYSTEM_IDENTIFIER: v }), c),
      ).rejects.toBeInstanceOf(IdentidadDestinoProduccionNoConfirmadaError);
    }
    expect(c.spy).not.toHaveBeenCalled();
  });
});

describe('verificarDestinoProduccion — identidad real', () => {
  it('coincide → OK, devuelve el system_identifier', async () => {
    const c = consulta(SID_OK);
    const r = await verificarDestinoProduccion(envOk(), c);
    expect(r).toEqual({ systemIdentifier: SID_OK });
    expect(c.spy).toHaveBeenCalledTimes(1);
    expect(c.spy).toHaveBeenCalledWith('postgres://u:p@host:5432/db');
  });

  it('tolera espacios alrededor del esperado', async () => {
    const c = consulta(SID_OK);
    const r = await verificarDestinoProduccion(
      envOk({ DATA_API_RUNTIME_EXPECTED_SYSTEM_IDENTIFIER: `  ${SID_OK}  ` }),
      c,
    );
    expect(r.systemIdentifier).toBe(SID_OK);
  });

  it('NO coincide → aborta (mensaje incluye ambos ids, nunca la URL)', async () => {
    const c = consulta('9999999999999999999');
    let err: Error | undefined;
    try {
      await verificarDestinoProduccion(envOk(), c);
    } catch (e) {
      err = e as Error;
    }
    expect(err).toBeInstanceOf(IdentidadDestinoProduccionNoConfirmadaError);
    expect(err!.message).toContain('9999999999999999999');
    expect(err!.message).toContain(SID_OK);
    expect(err!.message).not.toContain('postgres://');
  });

  it('el destino real resuelve a un SID marcado PROHIBIDO (env) → aborta aunque "coincida" el esperado', async () => {
    const c = consulta(SID_PROHIBIDO);
    await expect(
      verificarDestinoProduccion(
        envOk({
          DATA_API_RUNTIME_EXPECTED_SYSTEM_IDENTIFIER: SID_PROHIBIDO,
          DATA_API_RUNTIME_FORBIDDEN_SYSTEM_IDENTIFIER: SID_PROHIBIDO,
        }),
        c,
      ),
    ).rejects.toThrow(/PROHIBIDO/i);
  });

  it('sin DATA_API_RUNTIME_FORBIDDEN_SYSTEM_IDENTIFIER no hay lista negra: solo cuenta la identidad positiva', async () => {
    const c = consulta(SID_OK);
    const r = await verificarDestinoProduccion(envOk(), c);
    expect(r.systemIdentifier).toBe(SID_OK);
  });

  it('la consulta read-only devuelve vacío → aborta', async () => {
    await expect(verificarDestinoProduccion(envOk(), consulta(''))).rejects.toBeInstanceOf(
      IdentidadDestinoProduccionNoConfirmadaError,
    );
  });

  it('la consulta read-only lanza → aborta, envuelve el detalle, sin URL', async () => {
    const c = consulta(async () => {
      throw new Error('connection refused');
    });
    let err: Error | undefined;
    try {
      await verificarDestinoProduccion(envOk(), c);
    } catch (e) {
      err = e as Error;
    }
    expect(err).toBeInstanceOf(IdentidadDestinoProduccionNoConfirmadaError);
    expect(err!.message).toContain('connection refused');
    expect(err!.message).not.toContain('postgres://');
  });
});
