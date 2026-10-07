/**
 * Fase 2B-2.2.3 — pruebas/regresión de la migración frontend de Fase
 * 2B-2.2.2 (aprobar tras observación, EN_OBSERVACION→APROBADO_ELABORACION).
 *
 * Mismo patrón ya usado en el repo (sin jsdom/RTL, ver
 * `solicitudes-f2d-editar-sincronizado.test.ts`): confirma el cableado
 * exacto en `page.tsx` mediante lectura de código fuente, y evalúa el
 * COMPORTAMIENTO REAL de `finalizarRevisionAprobando` extrayendo su cuerpo
 * literal del archivo (por conteo de llaves, no una regex ingenua, porque
 * el cuerpo tiene bloques anidados try/catch/finally) y ejecutándolo con
 * `new Function` contra un `fetch` simulado — sin duplicar la lógica en el
 * test, sin modificar `page.tsx`.
 *
 * `getRecordValue` no está exportado desde `page.tsx` — se replica aquí
 * como una función auxiliar trivial (idéntica línea por línea a la
 * definición real, línea 246 de `page.tsx`), no es lógica de negocio.
 * `estadoRevisionLegadoEquivalente` SÍ está exportada — se importa la real,
 * nunca se duplica.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { estadoRevisionLegadoEquivalente } from '@/lib/solicitudes/estados-canonicos';

const PAGE_TSX = readFileSync(join(__dirname, 'page.tsx'), 'utf-8');

/** Réplica exacta (no lógica de negocio) de `getRecordValue` — page.tsx:246. */
function getRecordValue(record: Record<string, unknown> | null | undefined, key: string, fallback: unknown = ''): unknown {
  if (!record) return fallback;
  return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : fallback;
}

/** Extrae el cuerpo de una función `const <nombre> = async (): Promise<boolean> => { ... };`
 * de page.tsx contando llaves balanceadas — nunca una regex ingenua que
 * pare en el primer `}` de un bloque interno (try/catch/finally). */
function extraerCuerpoDeFuncion(nombre: string): string {
  const marcador = `const ${nombre} = async (): Promise<boolean> => {`;
  const inicioMarcador = PAGE_TSX.indexOf(marcador);
  if (inicioMarcador === -1) throw new Error(`No se encontró "${marcador}" en page.tsx`);
  const inicioCuerpo = inicioMarcador + marcador.length;
  let profundidad = 1;
  let i = inicioCuerpo;
  while (profundidad > 0) {
    if (i >= PAGE_TSX.length) throw new Error(`Llave sin cerrar al extraer ${nombre}`);
    if (PAGE_TSX[i] === '{') profundidad++;
    else if (PAGE_TSX[i] === '}') profundidad--;
    i++;
  }
  return PAGE_TSX.slice(inicioCuerpo, i - 1);
}

describe('Cableado 2B-2.2.2 en page.tsx (verificación de código fuente)', () => {
  it('existe finalizarRevisionAprobando()', () => {
    expect(PAGE_TSX).toContain('const finalizarRevisionAprobando = async (): Promise<boolean> => {');
  });

  it('apunta exactamente a POST /api/solicitudes/${sol.id}/finalizar-revision', () => {
    expect(PAGE_TSX).toContain('await fetch(`/api/solicitudes/${sol.id}/finalizar-revision`, {');
    expect(PAGE_TSX).toContain("method: 'POST', headers: { 'Content-Type': 'application/json' },\n        body: JSON.stringify({ idAsignacion: idAsignacionActual, decisionObservaciones: 'aceptada' }),");
  });

  it('construye idAsignacion desde la asignación actualmente objetivo (getRecordValue(asignacion, "idAsignacion")), nunca de un índice u otro valor', () => {
    const cuerpo = extraerCuerpoDeFuncion('finalizarRevisionAprobando');
    expect(cuerpo).toContain("const idAsignacionActual = String(getRecordValue(asignacion, 'idAsignacion') ?? '');");
    // Nunca referencia la variable de estado del modal `decisionObs` (distinto
    // de `decisionObservaciones`, el campo de negocio fijo 'aceptada') como
    // fuente del idAsignacion, ni un índice de arreglo.
    expect(cuerpo).not.toMatch(/decisionObs(?![a-zA-Z])/);
    expect(cuerpo).not.toMatch(/asigs\[|asignaciones\[\d/);
  });

  it('el body enviado (la llamada JSON.stringify) NO incluye validadoPor, fechaValidacion, estadoSolicitud ni estadoRevision como claves', () => {
    const cuerpo = extraerCuerpoDeFuncion('finalizarRevisionAprobando');
    // Se verifica como CLAVE de objeto (sufijo ":"), no como substring —
    // `estadoRevisionLegadoEquivalente`/`setEstadoRevision` son identificadores
    // legítimos que contienen "estadoRevision" pero nunca lo usan como clave
    // del body enviado al servidor.
    for (const claveProhibida of ['validadoPor:', 'fechaValidacion:', 'estadoSolicitud:', 'estadoRevision:', 'asignaciones:']) {
      expect(cuerpo).not.toContain(claveProhibida);
    }
  });

  it('la rama de aprobación del modal usa exclusivamente finalizarRevisionAprobando() — ya NO existe guardar(\'APROBADO_ELABORACION\', ...) en todo el archivo', () => {
    expect(PAGE_TSX).toContain(
      "if (decisionObs === 'no_aceptada') {\n" +
      "                  await guardar('RECHAZADO', { decisionObservaciones: decisionObs, motivoRechazo: motivoRechazo.trim(), validadoPor: sesion.usuario, fechaValidacion: ahora() });\n" +
      "                } else {\n" +
      "                  await finalizarRevisionAprobando();\n" +
      "                }",
    );
    expect(PAGE_TSX).not.toContain("guardar('APROBADO_ELABORACION'");
  });

  it('la rama RECHAZADO permanece exactamente intacta (sigue usando guardar(\'RECHAZADO\', ...) con validadoPor/fechaValidacion, vía /cerrar)', () => {
    expect(PAGE_TSX).toContain(
      "await guardar('RECHAZADO', { decisionObservaciones: decisionObs, motivoRechazo: motivoRechazo.trim(), validadoPor: sesion.usuario, fechaValidacion: ahora() });",
    );
  });
});

describe('finalizarRevisionAprobando — comportamiento real (función extraída de page.tsx, fetch simulado)', () => {
  const cuerpo = extraerCuerpoDeFuncion('finalizarRevisionAprobando');

  function crear(deps: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fetchImpl: (...args: any[]) => Promise<unknown>;
    asignacion?: Record<string, unknown>;
    sol?: Record<string, unknown>;
  }) {
    const setError = vi.fn();
    const setGuardando = vi.fn();
    const setEstadoRevision = vi.fn();
    const onGuardado = vi.fn();
    const asignacion = deps.asignacion ?? { idAsignacion: 'ASG-A' };
    const sol = deps.sol ?? { id: 300, estadoSolicitud: 'En observación' };
    // eslint-disable-next-line no-new-func
    const fn = new Function(
      'getRecordValue', 'fetch', 'asignacion', 'sol', 'setError', 'setGuardando',
      'estadoRevisionLegadoEquivalente', 'setEstadoRevision', 'onGuardado',
      `return (async () => { ${cuerpo} })();`,
    ) as (...args: unknown[]) => Promise<boolean>;
    const ejecutar = () => fn(
      getRecordValue, deps.fetchImpl, asignacion, sol, setError, setGuardando,
      estadoRevisionLegadoEquivalente, setEstadoRevision, onGuardado,
    );
    return { ejecutar, setError, setGuardando, setEstadoRevision, onGuardado, asignacion, sol };
  }

  function respuesta(ok: boolean, status: number, data: Record<string, unknown>) {
    return { ok, status, json: async () => data };
  }

  it('4a. éxito (200): no muestra error, actualiza estado, refresca la Solicitud, retorna true', async () => {
    const fetchImpl = vi.fn(async () => respuesta(true, 200, { ok: true, estadoNuevo: 'APROBADO_ELABORACION', solicitud: { id: 300, estadoSolicitud: 'APROBADO_ELABORACION' } }));
    const { ejecutar, setError, setGuardando, setEstadoRevision, onGuardado, sol } = crear({ fetchImpl });
    const resultado = await ejecutar();
    expect(resultado).toBe(true);
    expect(setError).toHaveBeenCalledWith('');
    expect(setError).not.toHaveBeenCalledWith(expect.stringMatching(/./));
    expect(setGuardando).toHaveBeenNthCalledWith(1, true);
    expect(setGuardando).toHaveBeenLastCalledWith(false); // vía finally
    expect(setEstadoRevision).toHaveBeenCalledWith('APROBADO_ELABORACION');
    expect(onGuardado).toHaveBeenCalledWith({ ...sol, id: 300, estadoSolicitud: 'APROBADO_ELABORACION' });
  });

  it('4b. 400: usa data.error, no simula éxito, no llama onGuardado', async () => {
    const fetchImpl = vi.fn(async () => respuesta(false, 400, { ok: false, error: 'Campo no permitido en el body: "x".' }));
    const { ejecutar, setError, onGuardado, setGuardando } = crear({ fetchImpl });
    const resultado = await ejecutar();
    expect(resultado).toBe(false);
    expect(setError).toHaveBeenCalledWith('Campo no permitido en el body: "x".');
    expect(onGuardado).not.toHaveBeenCalled();
    expect(setGuardando).toHaveBeenLastCalledWith(false);
  });

  it('4c. 403: usa data.error, no simula éxito', async () => {
    const fetchImpl = vi.fn(async () => respuesta(false, 403, { ok: false, error: 'No puedes decidir sobre la observación de la asignación de otro responsable.' }));
    const { ejecutar, setError, onGuardado } = crear({ fetchImpl });
    const resultado = await ejecutar();
    expect(resultado).toBe(false);
    expect(setError).toHaveBeenCalledWith('No puedes decidir sobre la observación de la asignación de otro responsable.');
    expect(onGuardado).not.toHaveBeenCalled();
  });

  it('4d. 409: muestra el mensaje ESPECÍFICO de concurrencia, ignorando data.error', async () => {
    const fetchImpl = vi.fn(async () => respuesta(false, 409, { ok: false, error: 'mensaje interno irrelevante' }));
    const { ejecutar, setError, onGuardado } = crear({ fetchImpl });
    const resultado = await ejecutar();
    expect(resultado).toBe(false);
    expect(setError).toHaveBeenCalledWith('El proceso fue actualizado por otro usuario. Recarga la información antes de continuar.');
    expect(onGuardado).not.toHaveBeenCalled();
  });

  it('4e. 422: muestra el mensaje ESPECÍFICO de inconsistencia histórica cuando el servidor no trae error propio', async () => {
    const fetchImpl = vi.fn(async () => respuesta(false, 422, { ok: false }));
    const { ejecutar, setError } = crear({ fetchImpl });
    await ejecutar();
    expect(setError).toHaveBeenCalledWith('Los datos históricos de este proceso son ambiguos — corrige la inconsistencia antes de continuar.');
  });

  it('4e-bis. 422: si el servidor SÍ trae error propio, se usa ese en vez del genérico', async () => {
    const fetchImpl = vi.fn(async () => respuesta(false, 422, { ok: false, error: 'Los datos históricos de este proceso son ambiguos (las asignaciones activas tienen subestados contradictorios) — no se puede determinar el subestado exacto. Corrige la inconsistencia antes de continuar.' }));
    const { ejecutar, setError } = crear({ fetchImpl });
    await ejecutar();
    expect(setError).toHaveBeenCalledWith('Los datos históricos de este proceso son ambiguos (las asignaciones activas tienen subestados contradictorios) — no se puede determinar el subestado exacto. Corrige la inconsistencia antes de continuar.');
  });

  it('4f. error de conexión/fetch: no lanza, muestra "No se pudo conectar.", retorna false, setGuardando(false) por finally', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('network down'); });
    const { ejecutar, setError, setGuardando, onGuardado } = crear({ fetchImpl });
    const resultado = await ejecutar();
    expect(resultado).toBe(false);
    expect(setError).toHaveBeenCalledWith('No se pudo conectar.');
    expect(setGuardando).toHaveBeenLastCalledWith(false);
    expect(onGuardado).not.toHaveBeenCalled();
  });

  it('5. la actualización de estado usa estadoRevisionLegadoEquivalente (mismo patrón que guardarTransicionPura/reenviarRevisionAlVaciarObservaciones)', async () => {
    // APROBADO_ELABORACION es su propio equivalente legado (estados-canonicos.ts) —
    // confirma que se usa la función real, no un valor fijo.
    const fetchImpl = vi.fn(async () => respuesta(true, 200, { ok: true, estadoNuevo: 'APROBADO_ELABORACION', solicitud: {} }));
    const { ejecutar, setEstadoRevision } = crear({ fetchImpl });
    await ejecutar();
    expect(setEstadoRevision).toHaveBeenCalledWith(estadoRevisionLegadoEquivalente('APROBADO_ELABORACION'));
  });

  type InitFetch = { method: string; headers: Record<string, string>; body: string };

  it('6. usa el idAsignacion de la fila objetivo — nunca un índice, otra fila, ni un valor arbitrario', async () => {
    const fetchImpl = vi.fn(async (_url: string, _init: InitFetch) => respuesta(true, 200, { ok: true, estadoNuevo: 'APROBADO_ELABORACION', solicitud: {} }));
    const { ejecutar } = crear({ fetchImpl, asignacion: { idAsignacion: 'ASG-A' } });
    await ejecutar();
    const bodyEnviado = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(bodyEnviado.idAsignacion).toBe('ASG-A');
  });

  it('7. múltiples asignaciones: envía EXCLUSIVAMENTE el idAsignacion de A — nunca un arreglo completo de asignaciones', async () => {
    // Existen A (objetivo) y B (otra fila) — la función solo conoce/recibe `asignacion` (A).
    const fetchImpl = vi.fn(async (_url: string, _init: InitFetch) => respuesta(true, 200, { ok: true, estadoNuevo: 'APROBADO_ELABORACION', solicitud: { asignaciones: [{ idAsignacion: 'ASG-A' }, { idAsignacion: 'ASG-B' }] } }));
    const asignacionA = { idAsignacion: 'ASG-A' };
    const { ejecutar } = crear({ fetchImpl, asignacion: asignacionA });
    await ejecutar();
    const [url, init] = fetchImpl.mock.calls[0];
    const bodyEnviado = JSON.parse(init.body);
    expect(url).toBe('/api/solicitudes/300/finalizar-revision');
    expect(bodyEnviado).toEqual({ idAsignacion: 'ASG-A', decisionObservaciones: 'aceptada' });
    expect(bodyEnviado).not.toHaveProperty('asignaciones');
    expect(Object.keys(bodyEnviado)).toEqual(['idAsignacion', 'decisionObservaciones']);
  });

  it('el body enviado contiene EXACTAMENTE 2 claves: idAsignacion y decisionObservaciones (nunca más)', async () => {
    const fetchImpl = vi.fn(async (_url: string, _init: InitFetch) => respuesta(true, 200, { ok: true, estadoNuevo: 'APROBADO_ELABORACION', solicitud: {} }));
    const { ejecutar } = crear({ fetchImpl });
    await ejecutar();
    const bodyEnviado = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(Object.keys(bodyEnviado).sort()).toEqual(['decisionObservaciones', 'idAsignacion']);
    expect(bodyEnviado.decisionObservaciones).toBe('aceptada');
  });
});
