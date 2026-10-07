/**
 * FASE B.4.5 — capability booleana segura para el frontend.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { GET } from './route';

const ORIG = process.env.DATA_API_RUNTIME_ENABLED;
afterEach(() => {
  if (ORIG === undefined) delete process.env.DATA_API_RUNTIME_ENABLED;
  else process.env.DATA_API_RUNTIME_ENABLED = ORIG;
});

describe('GET /api/config/runtime', () => {
  it('flag OFF → { dataApiCutover: false }', async () => {
    delete process.env.DATA_API_RUNTIME_ENABLED;
    const body = await (await GET()).json();
    expect(body).toEqual({ dataApiCutover: false });
  });

  it('flag ON → { dataApiCutover: true }', async () => {
    process.env.DATA_API_RUNTIME_ENABLED = 'true';
    const body = await (await GET()).json();
    expect(body).toEqual({ dataApiCutover: true });
  });

  it('solo expone el booleano — nunca la env cruda ni otros campos', async () => {
    process.env.DATA_API_RUNTIME_ENABLED = 'true';
    const body = await (await GET()).json();
    expect(Object.keys(body)).toEqual(['dataApiCutover']);
    expect(JSON.stringify(body)).not.toContain('DATA_API_RUNTIME_ENABLED');
  });
});
