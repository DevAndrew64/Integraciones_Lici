import { describe, it, expect, vi } from 'vitest';
import { resolverProcesoIdParaFicha, type CandidatoProceso } from './resolver-proceso-ficha';

const FORTUL: CandidatoProceso = {
  _dbId: 7050, codigoProceso: 'No. 001-2026', entidad: 'CONCEJO MUNICIPAL DE FORTUL', externalId: '11786506',
};

describe('Caso 1 — Solicitud histórica sin procesoId (Honor & Laurel vs. Fortul)', () => {
  it('no relaciona con Proceso 7050 aunque comparta codigoProceso', async () => {
    const buscarCandidatos = vi.fn(async () => [FORTUL]);

    const dbId = await resolverProcesoIdParaFicha({
      codigoProceso: 'No. 001-2026',
      entidad: 'El Grupo Honor & Laurel',
      procesoId: null,       // Solicitud.procesoId = NULL
      externalId: null,      // Solicitud.externalId = NULL
      buscarCandidatos,
    });

    expect(dbId).toBeNull(); // ← nunca 7050
    expect(buscarCandidatos).toHaveBeenCalledWith('No. 001-2026');
  });
});

describe('Caso 2 — Solicitud manual vinculada a su propio Proceso', () => {
  it('usa el procesoId propio, nunca busca ni cae a Fortul', async () => {
    const buscarCandidatos = vi.fn(async () => [FORTUL]); // aunque exista Fortul en los candidatos

    const dbId = await resolverProcesoIdParaFicha({
      codigoProceso: 'No. 001-2026',
      entidad: 'El Grupo Honor & Laurel',
      procesoId: 9001,       // ya vinculada a su Proceso manual propio
      externalId: null,
      buscarCandidatos,
    });

    expect(dbId).toBe(9001);
    expect(buscarCandidatos).not.toHaveBeenCalled(); // resuelve directo, sin búsqueda de texto
  });

  it('si el Proceso manual también aparece como candidato, se distingue correctamente por llave de negocio', async () => {
    const HONOR_LAUREL: CandidatoProceso = {
      _dbId: 9001, codigoProceso: 'No. 001-2026', entidad: 'El Grupo Honor & Laurel', externalId: null,
    };
    const buscarCandidatos = vi.fn(async () => [FORTUL, HONOR_LAUREL]);

    const dbId = await resolverProcesoIdParaFicha({
      codigoProceso: 'No. 001-2026',
      entidad: 'El Grupo Honor & Laurel',
      procesoId: null, // simula el momento ANTES de vincular procesoId
      externalId: null,
      buscarCandidatos,
    });

    expect(dbId).toBe(9001); // resuelve por llave de negocio exacta, no por el primero de la lista
  });
});

describe('Caso 3 — mismo código, entidades diferentes, coexisten sin mezclar', () => {
  it('Fortul resuelve a 7050 por su propia llave', async () => {
    const buscarCandidatos = vi.fn(async () => [FORTUL]);
    const dbId = await resolverProcesoIdParaFicha({
      codigoProceso: 'No. 001-2026', entidad: 'CONCEJO MUNICIPAL DE FORTUL',
      procesoId: null, externalId: '11786506', buscarCandidatos,
    });
    expect(dbId).toBe(7050);
  });

  it('Honor & Laurel no resuelve a 7050 aunque busque el mismo código', async () => {
    const buscarCandidatos = vi.fn(async () => [FORTUL]);
    const dbId = await resolverProcesoIdParaFicha({
      codigoProceso: 'No. 001-2026', entidad: 'El Grupo Honor & Laurel',
      procesoId: null, externalId: null, buscarCandidatos,
    });
    expect(dbId).toBeNull();
  });
});

describe('Caso 4 — resolución por externalId (sin procesoId)', () => {
  it('resuelve por externalId exacto antes de intentar llave de negocio', async () => {
    const buscarCandidatos = vi.fn(async () => [FORTUL]);
    const dbId = await resolverProcesoIdParaFicha({
      codigoProceso: 'No. 001-2026', entidad: 'cualquier variante de texto de la entidad',
      procesoId: null, externalId: '11786506', buscarCandidatos,
    });
    expect(dbId).toBe(7050); // externalId manda, aunque la entidad enviada no coincida textualmente
  });
});

describe('Ambigüedad y datos insuficientes', () => {
  it('si hay más de un candidato con la misma llave de negocio, no elige ninguno', async () => {
    const dup1: CandidatoProceso = { _dbId: 1, codigoProceso: '001-2026', entidad: 'Empresa Duplicada', externalId: null };
    const dup2: CandidatoProceso = { _dbId: 2, codigoProceso: '001-2026', entidad: 'Empresa Duplicada', externalId: null };
    const buscarCandidatos = vi.fn(async () => [dup1, dup2]);

    const dbId = await resolverProcesoIdParaFicha({
      codigoProceso: '001-2026', entidad: 'Empresa Duplicada',
      procesoId: null, externalId: null, buscarCandidatos,
    });
    expect(dbId).toBeNull(); // ambiguo — no elige el primero ni el último
  });

  it('sin procesoId, externalId ni código, no busca nada y devuelve null', async () => {
    const buscarCandidatos = vi.fn(async () => [FORTUL]);
    const dbId = await resolverProcesoIdParaFicha({
      codigoProceso: '', entidad: '', procesoId: null, externalId: null, buscarCandidatos,
    });
    expect(dbId).toBeNull();
    expect(buscarCandidatos).not.toHaveBeenCalled();
  });

  it('coincidencia parcial de código ("1001-2026" contiene "001-2026") no se confunde', async () => {
    const parecido: CandidatoProceso = { _dbId: 99, codigoProceso: '1001-2026', entidad: 'Empresa X', externalId: null };
    const buscarCandidatos = vi.fn(async () => [parecido]);
    const dbId = await resolverProcesoIdParaFicha({
      codigoProceso: '001-2026', entidad: 'Empresa X', procesoId: null, externalId: null, buscarCandidatos,
    });
    expect(dbId).toBeNull();
  });
});

describe('Validación de procesoId histórico contra el Proceso real (ronda 2 — 32 procesos)', () => {
  // CASO A — MC-002-2026: Solicitud 73 (Cali) con procesoId histórico incorrecto (Contadero).
  it('CASO A — rechaza procesoId=3762 (Contadero) y resuelve 4289 (Cali) por externalId', async () => {
    const CONTADERO: CandidatoProceso = { _dbId: 3762, codigoProceso: 'MC-002-2026', entidad: 'NARIÑO - CONCEJO MUNICIPAL DE CONTADERO', externalId: '11608868' };
    const CALI: CandidatoProceso = { _dbId: 4289, codigoProceso: 'MC-002-2026', entidad: 'CONCEJO DISTRITAL DE SANTIAGO DE CALI', externalId: '11628835' };
    const buscarProcesoPorId = vi.fn(async (id: number) => (id === 3762 ? CONTADERO : null));
    const buscarCandidatos = vi.fn(async () => [CONTADERO, CALI]);

    const dbId = await resolverProcesoIdParaFicha({
      codigoProceso: 'MC-002-2026', entidad: 'CONCEJO DISTRITAL DE SANTIAGO DE CALI',
      procesoId: 3762, externalId: '11628835',
      buscarCandidatos, buscarProcesoPorId,
    });

    expect(dbId).toBe(4289); // nunca 3762
    expect(buscarProcesoPorId).toHaveBeenCalledWith(3762);
  });

  // CASO B — SAMC-012-2026: Solicitud 129 (Cucunubá) con procesoId histórico incorrecto (Soacha).
  it('CASO B — rechaza procesoId=6799 (Soacha) y resuelve 5674 (Cucunubá)', async () => {
    const SOACHA: CandidatoProceso = { _dbId: 6799, codigoProceso: 'SAMC-012-2026', entidad: 'MUNICIPIO DE SOACHA..', externalId: '11765043' };
    const CUCUNUBA: CandidatoProceso = { _dbId: 5674, codigoProceso: 'SAMC-012-2026', entidad: 'MUNICIPIO DE CUCUNUBÁ', externalId: '11695707' };
    const buscarProcesoPorId = vi.fn(async (id: number) => (id === 6799 ? SOACHA : null));
    const buscarCandidatos = vi.fn(async () => [SOACHA, CUCUNUBA]);

    const dbId = await resolverProcesoIdParaFicha({
      codigoProceso: 'SAMC-012-2026', entidad: 'MUNICIPIO DE CUCUNUBÁ',
      procesoId: 6799, externalId: '11695707',
      buscarCandidatos, buscarProcesoPorId,
    });

    expect(dbId).toBe(5674); // nunca 6799
  });

  // CASO C — CM-MC-001-2026: Solicitud 177 (Marinilla) con procesoId histórico incorrecto (Cachipay).
  it('CASO C — rechaza procesoId=4967 (Cachipay) y resuelve 6758 (Marinilla)', async () => {
    const CACHIPAY: CandidatoProceso = { _dbId: 4967, codigoProceso: 'CM-MC-001-2026', entidad: 'CUNDINAMARCA - CONCEJO MUNICIPIO DE CACHIPAY', externalId: '11619788' };
    const MARINILLA: CandidatoProceso = { _dbId: 6758, codigoProceso: 'CM-MC-001-2026', entidad: 'Concejo Municipal de Marinilla', externalId: '11761198' };
    const buscarProcesoPorId = vi.fn(async (id: number) => (id === 4967 ? CACHIPAY : null));
    const buscarCandidatos = vi.fn(async () => [CACHIPAY, MARINILLA]);

    const dbId = await resolverProcesoIdParaFicha({
      codigoProceso: 'CM-MC-001-2026', entidad: 'Concejo Municipal de Marinilla',
      procesoId: 4967, externalId: '11761198',
      buscarCandidatos, buscarProcesoPorId,
    });

    expect(dbId).toBe(6758); // nunca 4967
  });

  // CASO D — procesoId correcto: se conserva sin recurrir a buscarCandidatos.
  it('CASO D — procesoId coherente (externalId coincide) se conserva sin llamar a buscarCandidatos', async () => {
    const BOMBEROS: CandidatoProceso = { _dbId: 3764, codigoProceso: 'SAMC-001-2026', entidad: 'UNIDAD ADMINISTRATIVA ESPECIAL DIRECCION NACIONAL DE BOMBEROS', externalId: '11609688' };
    const buscarProcesoPorId = vi.fn(async () => BOMBEROS);
    const buscarCandidatos = vi.fn(async () => [BOMBEROS]);

    const dbId = await resolverProcesoIdParaFicha({
      codigoProceso: 'SAMC-001-2026', entidad: 'UNIDAD ADMINISTRATIVA ESPECIAL DIRECCION NACIONAL DE BOMBEROS',
      procesoId: 3764, externalId: '11609688',
      buscarCandidatos, buscarProcesoPorId,
    });

    expect(dbId).toBe(3764);
    expect(buscarProcesoPorId).toHaveBeenCalledWith(3764);
    expect(buscarCandidatos).not.toHaveBeenCalled(); // sin búsqueda ancha innecesaria
  });

  it('procesoId coherente por llave de negocio (sin externalId de la Solicitud) también se conserva sin búsqueda ancha', async () => {
    const PROCESO: CandidatoProceso = { _dbId: 42, codigoProceso: '001-2026', entidad: 'Empresa X', externalId: null };
    const buscarProcesoPorId = vi.fn(async () => PROCESO);
    const buscarCandidatos = vi.fn(async () => [PROCESO]);

    const dbId = await resolverProcesoIdParaFicha({
      codigoProceso: '001-2026', entidad: 'Empresa X',
      procesoId: 42, externalId: null,
      buscarCandidatos, buscarProcesoPorId,
    });

    expect(dbId).toBe(42);
    expect(buscarCandidatos).not.toHaveBeenCalled();
  });

  it('procesoId con llave de negocio que NO coincide se rechaza y cae a la resolución normal', async () => {
    const OTRO: CandidatoProceso = { _dbId: 42, codigoProceso: '001-2026', entidad: 'Empresa Y', externalId: null };
    const CORRECTO: CandidatoProceso = { _dbId: 99, codigoProceso: '001-2026', entidad: 'Empresa X', externalId: null };
    const buscarProcesoPorId = vi.fn(async () => OTRO);
    const buscarCandidatos = vi.fn(async () => [OTRO, CORRECTO]);

    const dbId = await resolverProcesoIdParaFicha({
      codigoProceso: '001-2026', entidad: 'Empresa X',
      procesoId: 42, externalId: null,
      buscarCandidatos, buscarProcesoPorId,
    });

    expect(dbId).toBe(99); // nunca 42
  });

  it('procesoId que ya no existe como Proceso real → se rechaza y cae a la resolución normal', async () => {
    const CORRECTO: CandidatoProceso = { _dbId: 99, codigoProceso: '001-2026', entidad: 'Empresa X', externalId: '555' };
    const buscarProcesoPorId = vi.fn(async () => null);
    const buscarCandidatos = vi.fn(async () => [CORRECTO]);

    const dbId = await resolverProcesoIdParaFicha({
      codigoProceso: '001-2026', entidad: 'Empresa X',
      procesoId: 12345, externalId: '555',
      buscarCandidatos, buscarProcesoPorId,
    });

    expect(dbId).toBe(99);
  });

  it('sin buscarProcesoPorId inyectado (caller antiguo) conserva el comportamiento previo: confía en procesoId sin validar', async () => {
    const dbId = await resolverProcesoIdParaFicha({
      codigoProceso: '001-2026', entidad: 'Empresa X',
      procesoId: 42, externalId: null,
      buscarCandidatos: vi.fn(async () => []),
    });
    expect(dbId).toBe(42);
  });
});
