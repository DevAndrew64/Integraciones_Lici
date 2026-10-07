/**
 * Fase 2B-2.2.9 — migración de `cerrarGerencial` (ModuloProcesosEnEjecucion,
 * page.tsx) del PATCH genérico (que ya no puede producir
 * `CERRADO_NO_ADJUDICADO` en `asignaciones[].estadoRevision`, ver
 * `deteccion-cambio-flujo.ts`) a la autoridad dedicada `POST .../cerrar`.
 *
 * Mismo patrón ya usado en el repo (sin jsdom/RTL, ver
 * `solicitudes-2b-2-2-2-finalizar-revision.test.ts`): confirma el cableado
 * exacto en `page.tsx` mediante lectura de código fuente, y evalúa el
 * COMPORTAMIENTO REAL de `cerrarGerencial` extrayendo su cuerpo literal del
 * archivo (por conteo de llaves) y ejecutándolo con `new Function` contra
 * un `fetch` simulado — sin duplicar la lógica en el test, sin modificar
 * `page.tsx`.
 *
 * `safeArray`/`getRecordValue` no están exportadas desde `page.tsx` — se
 * replican aquí línea por línea (idénticas a las definiciones reales,
 * líneas 233 y 246), no son lógica de negocio.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PAGE_TSX = readFileSync(join(__dirname, 'page.tsx'), 'utf-8');

/** Réplica exacta (no lógica de negocio) de `safeArray` — page.tsx:233. */
function safeArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

/** Réplica exacta (no lógica de negocio) de `getRecordValue` — page.tsx:246. */
function getRecordValue(record: Record<string, unknown> | null | undefined, key: string, fallback: unknown = ''): unknown {
  if (!record) return fallback;
  return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : fallback;
}

/** Extrae el cuerpo de `const cerrarGerencial=async()=>{ ... };` de
 * page.tsx contando llaves balanceadas — nunca una regex ingenua que pare
 * en el primer `}` de un bloque interno (try/catch/finally). */
function extraerCuerpoDeCerrarGerencial(): string {
  const marcador = 'const cerrarGerencial=async()=>{';
  const inicioMarcador = PAGE_TSX.indexOf(marcador);
  if (inicioMarcador === -1) throw new Error(`No se encontró "${marcador}" en page.tsx`);
  const inicioCuerpo = inicioMarcador + marcador.length;
  let profundidad = 1;
  let i = inicioCuerpo;
  while (profundidad > 0) {
    if (i >= PAGE_TSX.length) throw new Error('Llave sin cerrar al extraer cerrarGerencial');
    if (PAGE_TSX[i] === '{') profundidad++;
    else if (PAGE_TSX[i] === '}') profundidad--;
    i++;
  }
  return PAGE_TSX.slice(inicioCuerpo, i - 1);
}

/** `new Function` ejecuta el cuerpo como JS puro — las anotaciones de tipo
 * genérico de TypeScript (ej. `safeArray<Record<string,unknown>>(...)`) no
 * son JS válido y romperían el parseo. Se despoja únicamente la sintaxis de
 * tipos (nunca lógica), igual que hace el propio `tsc`/`esbuild` al
 * transpilar — el comportamiento ejecutado sigue siendo el real. */
function despojarTipoGenerico(cuerpo: string): string {
  return cuerpo.split('safeArray<Record<string,unknown>>').join('safeArray');
}

describe('Cableado 2B-2.2.9 en page.tsx (verificación de código fuente)', () => {
  it('existe cerrarGerencial()', () => {
    expect(PAGE_TSX).toContain('const cerrarGerencial=async()=>{');
  });

  it('(a) apunta con POST a /api/solicitudes/${sol.id}/cerrar', () => {
    const cuerpo = extraerCuerpoDeCerrarGerencial();
    expect(cuerpo).toContain('fetch(`/api/solicitudes/${sol.id}/cerrar`');
    expect(cuerpo).toContain("method:'POST'");
  });

  it('(b) ya NO usa el PATCH genérico /api/solicitudes', () => {
    const cuerpo = extraerCuerpoDeCerrarGerencial();
    expect(cuerpo).not.toContain("fetch('/api/solicitudes'");
    expect(cuerpo).not.toContain("method:'PATCH'");
  });

  it('(c) envía exactamente el contrato de /cerrar: resultadoEstado, idAsignacion, filaExtra', () => {
    const cuerpo = extraerCuerpoDeCerrarGerencial();
    expect(cuerpo).toContain("resultadoEstado:'Cerrada'");
    expect(cuerpo).toContain('idAsignacion:idAsignacionActual');
    expect(cuerpo).toContain('filaExtra');
  });

  it('(d) filaExtra representa CERRADO_NO_ADJUDICADO con la rama gerencial que cerrar/route.ts ya valida (tipoCausa), nunca resultadoFinal', () => {
    const cuerpo = extraerCuerpoDeCerrarGerencial();
    expect(cuerpo).toContain("estadoRevision:'CERRADO_NO_ADJUDICADO'");
    expect(cuerpo).toContain("tipoCausa:'Determinación gerencial'");
    expect(cuerpo).toContain('causaEspecifica');
    expect(cuerpo).not.toContain('resultadoFinal');
  });

  it('construye idAsignacion desde la fila objetivo (getRecordValue), nunca manda estadoSolicitud/asignaciones en el body (fuera del contrato de /cerrar)', () => {
    const cuerpo = extraerCuerpoDeCerrarGerencial();
    expect(cuerpo).toContain("getRecordValue(ultimaAsig,'idAsignacion')");
    expect(cuerpo).not.toContain('estadoSolicitud:');
    expect(cuerpo).not.toContain('asignaciones:asigActualizadas');
  });

  it('(g) maneja 409 (doble cierre concurrente) igual que el dispatcher real guardar() — usa data.error, refresca sin lanzar', () => {
    const cuerpo = extraerCuerpoDeCerrarGerencial();
    expect(cuerpo).toContain('res.status===409');
  });
});

describe('cerrarGerencial — comportamiento real (función extraída de page.tsx, fetch simulado)', () => {
  const cuerpo = despojarTipoGenerico(extraerCuerpoDeCerrarGerencial());

  type InitFetch = { method: string; headers: Record<string, string>; body: string };

  function crear(deps: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fetchImpl: (...args: any[]) => Promise<unknown>;
    sol?: Record<string, unknown>;
    notaCierre?: string;
  }) {
    const setGuardandoCierre = vi.fn();
    const setModalCierreGerencial = vi.fn();
    const setNotaCierre = vi.fn();
    const setSeleccionados = vi.fn();
    const cargar = vi.fn(async () => {});
    const alertImpl = vi.fn();
    const sol = deps.sol ?? { id: 400, asignaciones: [{ idAsignacion: 'ASG-1' }] };
    const modalCierreGerencial = { sol };
    const notaCierre = deps.notaCierre ?? '';
    // eslint-disable-next-line no-new-func
    const fn = new Function(
      'modalCierreGerencial', 'setGuardandoCierre', 'safeArray', 'getRecordValue', 'notaCierre',
      'fetch', 'setModalCierreGerencial', 'setNotaCierre', 'setSeleccionados', 'cargar', 'alert',
      `return (async () => { ${cuerpo} })();`,
    ) as (...args: unknown[]) => Promise<void>;
    const ejecutar = () => fn(
      modalCierreGerencial, setGuardandoCierre, safeArray, getRecordValue, notaCierre,
      deps.fetchImpl, setModalCierreGerencial, setNotaCierre, setSeleccionados, cargar, alertImpl,
    );
    return { ejecutar, setGuardandoCierre, setModalCierreGerencial, setNotaCierre, setSeleccionados, cargar, alertImpl, sol };
  }

  function respuesta(ok: boolean, status: number, data: Record<string, unknown>) {
    return { ok, status, json: async () => data };
  }

  it('(e) éxito (200): cierra el modal, limpia la nota, refresca la lista — sin alert', async () => {
    const fetchImpl = vi.fn(async () => respuesta(true, 200, { ok: true, solicitud: { id: 400, estadoSolicitud: 'Cerrada' } }));
    const { ejecutar, setGuardandoCierre, setModalCierreGerencial, setNotaCierre, setSeleccionados, cargar, alertImpl } = crear({ fetchImpl });
    await ejecutar();
    expect(setGuardandoCierre).toHaveBeenNthCalledWith(1, true);
    expect(setGuardandoCierre).toHaveBeenLastCalledWith(false);
    expect(setModalCierreGerencial).toHaveBeenCalledWith(null);
    expect(setNotaCierre).toHaveBeenCalledWith('');
    expect(setSeleccionados).toHaveBeenCalledWith([]);
    expect(cargar).toHaveBeenCalledTimes(1);
    expect(alertImpl).not.toHaveBeenCalled();
  });

  it('(c)(d) envía exactamente el body {resultadoEstado, idAsignacion, filaExtra} a la URL correcta, con la causaEspecifica escrita por el usuario', async () => {
    const fetchImpl = vi.fn(async (_url: string, _init: InitFetch) => respuesta(true, 200, { ok: true, solicitud: {} }));
    const { ejecutar, sol } = crear({ fetchImpl, notaCierre: '  Motivo real de la gerencia  ' });
    await ejecutar();
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(`/api/solicitudes/${(sol as { id: number }).id}/cerrar`);
    expect(init.method).toBe('POST'); // confirmado en el fetch simulado, no solo por inspección estática
    const body = JSON.parse(init.body);
    expect(body).toEqual({
      resultadoEstado: 'Cerrada',
      idAsignacion: 'ASG-1',
      filaExtra: {
        estadoRevision: 'CERRADO_NO_ADJUDICADO',
        tipoCausa: 'Determinación gerencial',
        causaEspecifica: 'Motivo real de la gerencia',
      },
    });
  });

  it('nota vacía: usa el texto por defecto "Cierre por determinación gerencial", igual que el backend', async () => {
    const fetchImpl = vi.fn(async (_url: string, _init: InitFetch) => respuesta(true, 200, { ok: true, solicitud: {} }));
    const { ejecutar } = crear({ fetchImpl, notaCierre: '   ' });
    await ejecutar();
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.filaExtra.causaEspecifica).toBe('Cierre por determinación gerencial');
  });

  it('(g) 409 (ya cerrada por otro usuario): alerta con el mensaje del servidor, refresca y cierra el modal igualmente — no lanza', async () => {
    const fetchImpl = vi.fn(async () => respuesta(false, 409, { ok: false, error: 'La solicitud ya fue cerrada por otro usuario.' }));
    const { ejecutar, setModalCierreGerencial, cargar, alertImpl } = crear({ fetchImpl });
    await expect(ejecutar()).resolves.toBeUndefined();
    expect(alertImpl).toHaveBeenCalledWith('La solicitud ya fue cerrada por otro usuario.');
    expect(setModalCierreGerencial).toHaveBeenCalledWith(null);
    expect(cargar).toHaveBeenCalledTimes(1);
  });

  it('(f) 400/403: alerta con data.error, NO cierra el modal ni refresca (permite reintentar)', async () => {
    const fetchImpl = vi.fn(async () => respuesta(false, 400, { ok: false, error: 'filaExtra.estadoRevision es requerido.' }));
    const { ejecutar, setModalCierreGerencial, cargar, alertImpl } = crear({ fetchImpl });
    await ejecutar();
    expect(alertImpl).toHaveBeenCalledWith('filaExtra.estadoRevision es requerido.');
    expect(setModalCierreGerencial).not.toHaveBeenCalled();
    expect(cargar).not.toHaveBeenCalled();
  });

  it('(h)(i) error de conexión/fetch: no lanza, alerta, setGuardandoCierre(false) por finally', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('network down'); });
    const { ejecutar, setGuardandoCierre, alertImpl } = crear({ fetchImpl });
    await expect(ejecutar()).resolves.toBeUndefined();
    expect(alertImpl).toHaveBeenCalledWith('network down');
    expect(setGuardandoCierre).toHaveBeenLastCalledWith(false);
  });

  it('usa el idAsignacion de la ÚLTIMA fila de asignaciones[] (comportamiento ya existente, preservado tal cual)', async () => {
    const fetchImpl = vi.fn(async (_url: string, _init: InitFetch) => respuesta(true, 200, { ok: true, solicitud: {} }));
    const sol = { id: 401, asignaciones: [{ idAsignacion: 'ASG-VIEJA' }, { idAsignacion: 'ASG-ULTIMA' }] };
    const { ejecutar } = crear({ fetchImpl, sol });
    await ejecutar();
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.idAsignacion).toBe('ASG-ULTIMA');
  });
});
