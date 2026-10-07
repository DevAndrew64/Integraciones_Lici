/**
 * Ajuste "NO EXPONER ERRORES INTERNOS DE UPLOADTHING AL USUARIO" —
 * `handleRechazar` (ModalEditarAsignacion, page.tsx) sube el soporte de
 * "Decisión gerencial" a `/api/upload` antes de registrar el rechazo. Este
 * test confirma el COMPORTAMIENTO REAL de esa función extrayéndola de
 * page.tsx (por conteo de llaves) y ejecutándola con `new Function` contra
 * un `fetch` simulado — mismo patrón ya usado en el repo (ver
 * `solicitudes-2b-2-2-9-cerrar-gerencial.test.ts`), sin duplicar lógica de
 * negocio ni modificar page.tsx.
 *
 * Objetivo central: si la carga del soporte falla (por el motivo que sea —
 * token de UploadThing ausente/inválido, red, etc.), el rechazo NUNCA se
 * registra (nunca se llama a `/cerrar`), el modal NUNCA se cierra, y el
 * mensaje mostrado al usuario NUNCA es el detalle técnico crudo del SDK.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { payloadRechazoCausal } from '@/lib/solicitudes/payload-cierre';

const PAGE_TSX = readFileSync(join(__dirname, 'page.tsx'), 'utf-8');

/** Réplica exacta (no lógica de negocio) de `safeString` — page.tsx:233. */
function safeString(value: unknown, fallback = ''): string {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  return fallback;
}

/** Extrae el cuerpo de `const handleRechazar = async () => { ... };` de
 * page.tsx contando llaves balanceadas — nunca una regex que pare en el
 * primer `}` de un bloque interno (try/catch/if). */
function extraerCuerpoDeHandleRechazar(): string {
  const marcador = 'const handleRechazar = async () => {';
  const inicioMarcador = PAGE_TSX.indexOf(marcador);
  if (inicioMarcador === -1) throw new Error(`No se encontró "${marcador}" en page.tsx`);
  const inicioCuerpo = inicioMarcador + marcador.length;
  let profundidad = 1;
  let i = inicioCuerpo;
  while (profundidad > 0) {
    if (i >= PAGE_TSX.length) throw new Error('Llave sin cerrar al extraer handleRechazar');
    if (PAGE_TSX[i] === '{') profundidad++;
    else if (PAGE_TSX[i] === '}') profundidad--;
    i++;
  }
  return PAGE_TSX.slice(inicioCuerpo, i - 1);
}

describe('Cableado del ajuste en page.tsx (verificación de código fuente)', () => {
  const cuerpo = extraerCuerpoDeHandleRechazar();

  it('existe handleRechazar()', () => {
    expect(PAGE_TSX).toContain('const handleRechazar = async () => {');
  });

  it('nunca usa e.message/String(e) para mostrar una excepción cruda al usuario (solo aparece en comentarios, nunca en código ejecutable — ambos catch son sin identificador)', () => {
    expect(cuerpo).not.toContain('catch (e)');
    expect(cuerpo).not.toContain('catch(e)');
    expect(cuerpo).not.toContain('instanceof Error');
    expect(cuerpo).toContain('} catch {');
  });

  it('si la subida falla, retorna de inmediato (nunca continúa hacia /cerrar)', () => {
    // Ambas ramas de fallo del bloque de subida (`!upRes.ok||!upData?.ok` y
    // el catch de red) terminan en `return;` ANTES de construir `payload`.
    const idxSubida = cuerpo.indexOf("fetch('/api/upload'");
    const idxCerrar = cuerpo.indexOf('/cerrar`');
    expect(idxSubida).toBeGreaterThan(-1);
    expect(idxCerrar).toBeGreaterThan(idxSubida);
  });
});

/** `new Function` ejecuta el cuerpo como JS puro — la única anotación de
 * tipo TypeScript dentro de `handleRechazar` (`let upData: {...} | null`)
 * no es JS válido y rompería el parseo. Se despoja únicamente la sintaxis
 * de tipos (nunca lógica), igual que hace `tsc`/`esbuild` al transpilar. */
function despojarTipos(cuerpo: string): string {
  return cuerpo
    .replace('let urlEvidencia: string | null = null;', 'let urlEvidencia = null;')
    .replace(
      'let upData: { ok?: boolean; error?: string; url?: string; path?: string } | null = null;',
      'let upData = null;',
    );
}

describe('handleRechazar — comportamiento real (función extraída de page.tsx, fetch simulado)', () => {
  const cuerpo = despojarTipos(extraerCuerpoDeHandleRechazar());

  function crear(deps: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fetchImpl: (...args: any[]) => Promise<unknown>;
    archivo?: unknown;
    esDecisionGerencial?: boolean;
    // Ajuste "OTRA CAUSA — RECHAZO" — nueva referencia externa que
    // `handleRechazar` ahora usa (`esOtraCausa`, const de componente,
    // igual que `esDecisionGerencial`) — debe inyectarse aquí igual que
    // las demás o `new Function` lanzaría ReferenceError al ejecutar.
    esOtraCausa?: boolean;
    causal?: string;
    obsRechazo?: string;
    guardando?: boolean;
  }) {
    const setError = vi.fn();
    const setGuardando = vi.fn();
    const onGuardado = vi.fn();
    const onClose = vi.fn();
    const sol = { id: 500 };
    const seleccionAsigRechazo = { asigActual: { idAsignacion: 'ASG-9' } };
    const fn = new Function(
      'guardando', 'causal', 'setError', 'esDecisionGerencial', 'esOtraCausa', 'archivo', 'safeString',
      'seleccionAsigRechazo', 'setGuardando', 'sol', 'payloadRechazoCausal', 'obsRechazo',
      'fetch', 'onGuardado', 'onClose', 'FormData',
      `return (async () => { ${cuerpo} })();`,
    ) as (...args: unknown[]) => Promise<void>;
    const ejecutar = () => fn(
      deps.guardando ?? false, deps.causal ?? 'DECISION_GERENCIAL', setError,
      deps.esDecisionGerencial ?? true, deps.esOtraCausa ?? false, 'archivo' in deps ? deps.archivo : { name: 'soporte.png' }, safeString,
      seleccionAsigRechazo, setGuardando, sol, payloadRechazoCausal, deps.obsRechazo ?? 'motivo',
      deps.fetchImpl, onGuardado, onClose, FormData,
    );
    return { ejecutar, setError, setGuardando, onGuardado, onClose, sol };
  }

  function respuesta(ok: boolean, status: number, data: Record<string, unknown>) {
    return { ok, status, json: async () => data };
  }

  it('1) sin adjuntar soporte (esDecisionGerencial=false): nunca llama a /api/upload, va directo a /cerrar', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).not.toContain('/api/upload');
      return respuesta(true, 200, { ok: true, solicitud: {} });
    });
    const { ejecutar, onClose, onGuardado } = crear({ fetchImpl, esDecisionGerencial: false, archivo: null });
    await ejecutar();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onGuardado).toHaveBeenCalledTimes(1);
  });

  it('2) Decisión gerencial SIN archivo: exige el soporte, nunca llama a fetch', async () => {
    const fetchImpl = vi.fn();
    const { ejecutar, setError, onClose } = crear({ fetchImpl, esDecisionGerencial: true, archivo: null });
    await ejecutar();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(setError).toHaveBeenCalledWith('Adjunta el soporte de la instrucción gerencial.');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('3) subida exitosa: continúa y registra el rechazo normalmente (/cerrar recibe urlEvidencia)', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === '/api/upload') return respuesta(true, 200, { ok: true, url: 'https://ufs.example/evidencia.png' });
      return respuesta(true, 200, { ok: true, solicitud: { id: 500, estadoSolicitud: 'Cerrada' } });
    });
    const { ejecutar, setError, onClose, onGuardado } = crear({ fetchImpl });
    await ejecutar();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const callCerrar = fetchImpl.mock.calls[1] as unknown as [string, { body: string }];
    const body = JSON.parse(callCerrar[1].body);
    expect(body.filaExtra.urlEvidenciaRechazo).toBe('https://ufs.example/evidencia.png');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onGuardado).toHaveBeenCalledTimes(1);
    expect(setError).not.toHaveBeenCalledWith(expect.stringContaining('Invalid token'));
  });

  it('4) la subida falla (mensaje ya sanitizado por /api/upload, p.ej. el caso real "token inválido"): NO llama a /cerrar, NO cierra el modal, muestra el mensaje seguro devuelto por la API', async () => {
    const MENSAJE_SEGURO = 'No fue posible cargar el archivo en este momento. Intenta nuevamente o contacta al administrador.';
    const fetchImpl = vi.fn(async () => respuesta(false, 503, { ok: false, error: MENSAJE_SEGURO }));
    const { ejecutar, setError, onClose, onGuardado } = crear({ fetchImpl });
    await ejecutar();
    expect(fetchImpl).toHaveBeenCalledTimes(1); // nunca llegó a /cerrar
    expect(setError).toHaveBeenCalledWith(MENSAJE_SEGURO);
    expect(setError).not.toHaveBeenCalledWith(expect.stringContaining('Invalid token'));
    expect(setError).not.toHaveBeenCalledWith(expect.stringContaining('apiKey'));
    expect(onClose).not.toHaveBeenCalled();
    expect(onGuardado).not.toHaveBeenCalled();
  });

  it('5) la subida falla por excepción de red (fetch rechaza la promesa): mensaje genérico local, nunca el de la excepción, NO llama a /cerrar ni cierra el modal', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('network fetch failed: ECONNRESET'); });
    const { ejecutar, setError, onClose } = crear({ fetchImpl });
    await ejecutar();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(setError).toHaveBeenCalledWith('No fue posible cargar el archivo en este momento. Intenta nuevamente o contacta al administrador.');
    expect(setError).not.toHaveBeenCalledWith(expect.stringContaining('ECONNRESET'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('6) /cerrar falla DESPUÉS de una subida exitosa: no usa el mensaje crudo de excepción, tampoco cierra el modal', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === '/api/upload') return respuesta(true, 200, { ok: true, url: 'https://ufs.example/e.png' });
      return respuesta(false, 400, { ok: false, error: 'filaExtra.estadoRevision es requerido.' });
    });
    const { ejecutar, setError, onClose } = crear({ fetchImpl });
    await ejecutar();
    expect(setError).toHaveBeenCalledWith('filaExtra.estadoRevision es requerido.');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('7) doble clic (guardando=true): no hace nada, nunca llama a fetch', async () => {
    const fetchImpl = vi.fn();
    const { ejecutar } = crear({ fetchImpl, guardando: true });
    await ejecutar();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  // Ajuste "OTRA CAUSA — RECHAZO"
  it('8) OTRA_CAUSA con obsRechazo vacío: nunca llama a fetch, muestra el error de detalle obligatorio (3)', async () => {
    const fetchImpl = vi.fn();
    const { ejecutar, setError, onClose } = crear({
      fetchImpl, causal: 'OTRA_CAUSA', esDecisionGerencial: false, esOtraCausa: true, obsRechazo: '', archivo: null,
    });
    await ejecutar();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(setError).toHaveBeenCalledWith('Debes indicar el detalle cuando seleccionas Otra causa.');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('9) OTRA_CAUSA con obsRechazo en blanco (solo espacios): igual bloqueado, nunca llama a fetch', async () => {
    const fetchImpl = vi.fn();
    const { ejecutar, setError } = crear({
      fetchImpl, causal: 'OTRA_CAUSA', esDecisionGerencial: false, esOtraCausa: true, obsRechazo: '   ', archivo: null,
    });
    await ejecutar();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(setError).toHaveBeenCalledWith('Debes indicar el detalle cuando seleccionas Otra causa.');
  });

  it('10) OTRA_CAUSA con detalle real: continúa y registra el rechazo, el detalle viaja como observacionRechazo (4)', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).not.toContain('/api/upload'); // sin archivo, nunca sube nada
      return respuesta(true, 200, { ok: true, solicitud: { id: 500, estadoSolicitud: 'Cerrada' } });
    });
    const { ejecutar, setError, onClose, onGuardado } = crear({
      fetchImpl, causal: 'OTRA_CAUSA', esDecisionGerencial: false, esOtraCausa: true,
      obsRechazo: 'El cliente cambió las condiciones del servicio.', archivo: null,
    });
    await ejecutar();
    expect(setError).not.toHaveBeenCalledWith('Debes indicar el detalle cuando seleccionas Otra causa.');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const call = fetchImpl.mock.calls[0] as unknown as [string, { body: string }];
    const body = JSON.parse(call[1].body);
    expect(body.filaExtra.causalRechazo).toBe('OTRA_CAUSA');
    expect(body.filaExtra.observacionRechazo).toBe('El cliente cambió las condiciones del servicio.');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onGuardado).toHaveBeenCalledTimes(1);
  });
});
