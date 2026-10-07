/**
 * Ajuste "DOCUMENTACIÓN — DESCARGAR TODO (ZIP)" — tests de integración de
 * `GET /api/solicitudes/[id]/documentos/descargar-todo`. Mismo patrón de
 * fixture/mock (fake Prisma en memoria, `vi.mock('@/lib/session')`) que
 * `seguimiento/route.test.ts`.
 *
 * `jszip` se usa SOLO aquí, para leer de vuelta el ZIP generado y afirmar
 * sobre sus entradas — NO es una dependencia nueva: ya está instalada de
 * forma transitiva como dependencia directa de `exceljs` (ver
 * package-lock.json), reutilizada únicamente en este archivo de test.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import JSZip from 'jszip';

let solicitud: Record<string, unknown> | null;
let sesionActual: { id: number; email: string; rol: string; usuario: string } | null;

function resetFixture(docData: unknown[], overrides: Record<string, unknown> = {}) {
  solicitud = { id: 950, codigoProceso: 'SED-LP-2026-0091', docData, ...overrides };
  sesionActual = { id: 101, email: 'oscar.pallares@grupocolba.com', rol: 'Analista Comercial', usuario: 'oscar.pallares' };
}

const fakeImpl = {
  solicitud: {
    async findUnique({ where }: { where: { id: number } }) {
      return solicitud && where.id === solicitud.id ? JSON.parse(JSON.stringify(solicitud)) : null;
    },
  },
};

vi.mock('@/lib/prisma', () => ({ default: fakeImpl }));
vi.mock('@/lib/session', () => ({ getSession: async () => sesionActual }));

function req() {
  return new NextRequest('http://localhost/api/solicitudes/950/documentos/descargar-todo');
}
function ctx(id = '950') { return { params: Promise.resolve({ id }) }; }

const PDF_BASE64 = Buffer.from('%PDF-1.4 contenido de prueba').toString('base64');

describe('Autorización', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('sin sesión → 401', async () => {
    resetFixture([{ nombre: 'Acta.pdf', base64: PDF_BASE64 }]);
    sesionActual = null;
    const { GET } = await import('./route');
    const res = await GET(req(), ctx());
    expect(res.status).toBe(401);
  });

  it('con sesión (cualquier usuario autenticado, mismo criterio que GET /api/solicitudes/[id]) → 200', async () => {
    resetFixture([{ nombre: 'Acta.pdf', base64: PDF_BASE64 }]);
    const { GET } = await import('./route');
    const res = await GET(req(), ctx());
    expect(res.status).toBe(200);
  });

  it('solicitud inexistente → 404', async () => {
    resetFixture([{ nombre: 'Acta.pdf', base64: PDF_BASE64 }]);
    const { GET } = await import('./route');
    const res = await GET(req(), ctx('99999'));
    expect(res.status).toBe(404);
  });

  it('id inválido (no numérico) → 400', async () => {
    resetFixture([{ nombre: 'Acta.pdf', base64: PDF_BASE64 }]);
    const { GET } = await import('./route');
    const res = await GET(req(), ctx('abc'));
    expect(res.status).toBe(400);
  });
});

describe('Headers de la respuesta', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('Content-Type: application/zip', async () => {
    resetFixture([{ nombre: 'Acta.pdf', base64: PDF_BASE64 }]);
    const { GET } = await import('./route');
    const res = await GET(req(), ctx());
    expect(res.headers.get('Content-Type')).toBe('application/zip');
  });

  it('Content-Disposition: attachment con nombre Documentos_<codigoProceso>_<fecha>.zip', async () => {
    resetFixture([{ nombre: 'Acta.pdf', base64: PDF_BASE64 }]);
    const { GET } = await import('./route');
    const res = await GET(req(), ctx());
    const cd = res.headers.get('Content-Disposition') || '';
    expect(cd).toContain('attachment;');
    expect(cd).toMatch(/filename="Documentos_SED-LP-2026-0091_\d{4}-\d{2}-\d{2}\.zip"/);
  });
});

describe('Contenido del ZIP (leído de vuelta con jszip)', () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => { vi.unstubAllGlobals(); });

  it('ZIP con 1 solo documento (base64) — se puede descargar igual, mismo comportamiento consistente', async () => {
    resetFixture([{ nombre: 'Acta.pdf', base64: PDF_BASE64 }]);
    const { GET } = await import('./route');
    const res = await GET(req(), ctx());
    const buf = Buffer.from(await res.arrayBuffer());
    const zip = await JSZip.loadAsync(buf);
    expect(Object.keys(zip.files)).toEqual(['Acta.pdf']);
  });

  it('caso real de la captura: 5 documentos → ZIP con los 5 archivos', async () => {
    resetFixture([
      { nombre: '06.- Servicios Campamentos Urbanos 2026 - SEFYCU 276902.pdf', base64: PDF_BASE64 },
      { nombre: 'Acta Apertura sobre A y B - SEFYCU 294059.pdf', base64: PDF_BASE64 },
      { nombre: 'Acta adjudicación - SEFYCU 322693.pdf', base64: PDF_BASE64 },
      { nombre: 'Acta valoración sobre B y apertura sobre C - SEFYCU 306659.pdf', base64: PDF_BASE64 },
      { nombre: 'Acta valoración sobre C - SEFYCU 313901.pdf', base64: PDF_BASE64 },
    ]);
    const { GET } = await import('./route');
    const res = await GET(req(), ctx());
    const buf = Buffer.from(await res.arrayBuffer());
    const zip = await JSZip.loadAsync(buf);
    expect(Object.keys(zip.files)).toHaveLength(5);
    expect(Object.keys(zip.files)).toContain('Acta adjudicación - SEFYCU 322693.pdf');
  });

  it('conserva el contenido original de cada archivo (roundtrip base64)', async () => {
    resetFixture([{ nombre: 'Acta.pdf', base64: PDF_BASE64 }]);
    const { GET } = await import('./route');
    const res = await GET(req(), ctx());
    const buf = Buffer.from(await res.arrayBuffer());
    const zip = await JSZip.loadAsync(buf);
    const contenido = await zip.files['Acta.pdf'].async('nodebuffer');
    expect(contenido.toString('utf-8')).toBe('%PDF-1.4 contenido de prueba');
  });

  it('conserva extensiones distintas (pdf/imagen/zip existente)', async () => {
    resetFixture([
      { nombre: 'Pliego', extension: 'pdf', base64: PDF_BASE64 },
      { nombre: 'Foto', extension: 'png', base64: Buffer.from('imagen-fake').toString('base64') },
      { nombre: 'Anexos.zip', base64: Buffer.from('PK-fake-zip-content').toString('base64') },
    ]);
    const { GET } = await import('./route');
    const res = await GET(req(), ctx());
    const buf = Buffer.from(await res.arrayBuffer());
    const zip = await JSZip.loadAsync(buf);
    expect(Object.keys(zip.files).sort()).toEqual(['Anexos.zip', 'Foto.png', 'Pliego.pdf']);
  });

  it('un .zip entre los documentos se incluye TAL CUAL, sin descomprimirlo (sigue siendo una sola entrada binaria)', async () => {
    const contenidoZipOriginal = 'contenido-binario-de-un-zip-real-simulado';
    resetFixture([{ nombre: 'anexos.zip', base64: Buffer.from(contenidoZipOriginal).toString('base64') }]);
    const { GET } = await import('./route');
    const res = await GET(req(), ctx());
    const buf = Buffer.from(await res.arrayBuffer());
    const zip = await JSZip.loadAsync(buf);
    expect(Object.keys(zip.files)).toEqual(['anexos.zip']);
    const contenido = await zip.files['anexos.zip'].async('nodebuffer');
    expect(contenido.toString('utf-8')).toBe(contenidoZipOriginal);
  });

  it('nombres duplicados no se pisan: Acta.pdf + Acta.pdf → Acta.pdf + Acta (2).pdf', async () => {
    resetFixture([
      { nombre: 'Acta.pdf', base64: Buffer.from('contenido-1').toString('base64') },
      { nombre: 'Acta.pdf', base64: Buffer.from('contenido-2').toString('base64') },
    ]);
    const { GET } = await import('./route');
    const res = await GET(req(), ctx());
    const buf = Buffer.from(await res.arrayBuffer());
    const zip = await JSZip.loadAsync(buf);
    expect(Object.keys(zip.files).sort()).toEqual(['Acta (2).pdf', 'Acta.pdf']);
    expect((await zip.files['Acta.pdf'].async('nodebuffer')).toString()).toBe('contenido-1');
    expect((await zip.files['Acta (2).pdf'].async('nodebuffer')).toString()).toBe('contenido-2');
  });

  it('documento con URL externa: usa fetch (mismo mecanismo que la descarga individual), nunca confía en una URL enviada por el cliente en el request', async () => {
    resetFixture([{ nombre: 'Externo.pdf', url: 'https://community.secop.gov.co/doc.pdf' }]);
    const fetchMock = vi.fn(async () => new Response('contenido-remoto', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { GET } = await import('./route');
    const res = await GET(req(), ctx());
    expect(fetchMock).toHaveBeenCalledWith('https://community.secop.gov.co/doc.pdf', expect.any(Object));
    const buf = Buffer.from(await res.arrayBuffer());
    const zip = await JSZip.loadAsync(buf);
    expect((await zip.files['Externo.pdf'].async('nodebuffer')).toString()).toBe('contenido-remoto');
  });
});

describe('SSRF — no acepta URLs peligrosas aunque vengan de docData', () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => { vi.unstubAllGlobals(); });

  it('URL apuntando a red interna/localhost se descarta (no se agrega al ZIP, no revienta el resto)', async () => {
    resetFixture([
      { nombre: 'Malicioso.pdf', url: 'http://169.254.169.254/latest/meta-data/' },
      { nombre: 'Bueno.pdf', base64: PDF_BASE64 },
    ]);
    const fetchMock = vi.fn(async () => new Response('no debería llamarse', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { GET } = await import('./route');
    const res = await GET(req(), ctx());
    expect(fetchMock).not.toHaveBeenCalled();
    const buf = Buffer.from(await res.arrayBuffer());
    const zip = await JSZip.loadAsync(buf);
    expect(Object.keys(zip.files)).toEqual(['Bueno.pdf']);
  });
});

describe('Fallos parciales — 1 documento falla, los demás se entregan igual', () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => { vi.unstubAllGlobals(); });

  it('un fetch fallido (HTTP 404) no elimina los demás documentos del ZIP', async () => {
    resetFixture([
      { nombre: 'Roto.pdf', url: 'https://community.secop.gov.co/roto.pdf' },
      { nombre: 'Bueno.pdf', base64: PDF_BASE64 },
    ]);
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      url.includes('roto') ? new Response('', { status: 404 }) : new Response('ok', { status: 200 }),
    ));
    const { GET } = await import('./route');
    const res = await GET(req(), ctx());
    expect(res.status).toBe(200);
    const buf = Buffer.from(await res.arrayBuffer());
    const zip = await JSZip.loadAsync(buf);
    expect(Object.keys(zip.files)).toEqual(['Bueno.pdf']);
  });

  it('un documento sin url ni base64 se omite sin afectar a los demás', async () => {
    resetFixture([{ nombre: 'SinContenido.pdf' }, { nombre: 'Bueno.pdf', base64: PDF_BASE64 }]);
    const { GET } = await import('./route');
    const res = await GET(req(), ctx());
    const buf = Buffer.from(await res.arrayBuffer());
    const zip = await JSZip.loadAsync(buf);
    expect(Object.keys(zip.files)).toEqual(['Bueno.pdf']);
  });

  it('ningún documento descargable → error controlado (502), nunca un ZIP vacío ni un 200 engañoso', async () => {
    resetFixture([{ nombre: 'A.pdf' }, { nombre: 'B.pdf' }]);
    const { GET } = await import('./route');
    const res = await GET(req(), ctx());
    expect(res.status).toBe(502);
    const data = await res.json();
    expect(data.ok).toBe(false);
  });

  it('sin documentos en absoluto (docData=[]) → 404 explícito, nunca un ZIP vacío', async () => {
    resetFixture([]);
    const { GET } = await import('./route');
    const res = await GET(req(), ctx());
    expect(res.status).toBe(404);
  });
});
