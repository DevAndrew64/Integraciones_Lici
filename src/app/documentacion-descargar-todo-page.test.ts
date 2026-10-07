/**
 * Ajuste "DOCUMENTACIÓN — DESCARGAR TODO (ZIP)" — tests de texto fuente
 * del bloque "Documentos (N)" en `VistFicha` (page.tsx). Mismo patrón que
 * el resto de *-page.test.ts (sin harness de render de componentes en
 * este repo) — la lógica de negocio real (armado del ZIP, permisos,
 * SSRF) se prueba en `descargar-todo/route.test.ts` y
 * `documentos-zip.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PAGE_TSX = readFileSync(join(__dirname, 'page.tsx'), 'utf-8');

/** Extrae el bloque "── DOCUMENTACIÓN ──" completo de `VistFicha` (la
 * ficha de la captura del usuario) — acotado por su siguiente hermano de
 * tab conocido en el mismo componente. */
function extraerBloqueDocumentacion(): string {
  const inicio = PAGE_TSX.indexOf("{/* ── DOCUMENTACIÓN ── */}");
  const fin = PAGE_TSX.indexOf('{/* ── ADENDAS', inicio);
  if (inicio === -1) throw new Error('No se encontró el bloque de Documentación en page.tsx');
  return fin === -1 ? PAGE_TSX.slice(inicio, inicio + 6000) : PAGE_TSX.slice(inicio, fin);
}
const BLOQUE = extraerBloqueDocumentacion();

describe('1) Botón "Descargar todo" aparece cuando hay documentos', () => {
  it('condición de visibilidad cubre documentos con url/ruta/link O base64 (no solo url, a diferencia del placeholder original)', () => {
    expect(BLOQUE).toContain("docArr.some((d:DocumentoDinamico)=>String(d.ruta||d.url||d.link||'')||String((d as any).base64||''))");
  });
  it('el botón tiene onClick conectado a descargarTodoZip (ya no es un placeholder sin función)', () => {
    expect(BLOQUE).toContain('<button onClick={descargarTodoZip} disabled={descargandoZip}');
  });
});

describe('2) No aparece / queda deshabilitado cuando no hay documentos', () => {
  it('el botón está DENTRO del `docArr.some(...)&&(` — con docArr vacío, `.some` es false y el botón no se renderiza', () => {
    const idxCond = BLOQUE.indexOf("docArr.some((d:DocumentoDinamico)=>String(d.ruta||d.url||d.link||'')||String((d as any).base64||''))&&(");
    const idxBoton = BLOQUE.indexOf('<button onClick={descargarTodoZip}');
    expect(idxCond).toBeGreaterThan(-1);
    expect(idxBoton).toBeGreaterThan(idxCond);
  });
});

describe('3) Mantiene intactos los botones de descarga individual y el selector grid/lista', () => {
  it('descargarDoc (individual) sigue existiendo sin cambios en su lógica base64/url', () => {
    expect(PAGE_TSX).toContain('const descargarDoc=(d:DocumentoDinamico)=>{');
    expect(PAGE_TSX).toContain("}else if(url){window.open(url,'_blank');}");
  });
  it('el selector grid/lista (setDocVista) sigue presente sin cambios', () => {
    expect(BLOQUE).toContain("{([{v:'grid'},{v:'list'}] as {v:'grid'|'list'}[]).map(({v})=>(");
    expect(BLOQUE).toContain('onClick={()=>setDocVista(v)}');
  });
  it('el botón "Descargar" individual de la vista lista sigue llamando a descargarDoc(d)', () => {
    expect(BLOQUE).toContain('onClick={()=>descargarDoc(d)}');
  });
});

describe('11) Estados del botón "Descargar todo" — normal / generando / deshabilitado', () => {
  it('estado normal: "Descargar todo"; estado de carga: "Generando ZIP..." (mismo botón, texto condicional)', () => {
    expect(BLOQUE).toContain("{descargandoZip?'Generando ZIP...':'Descargar todo'}");
  });
  it('disabled={descargandoZip} — deshabilitado mientras genera', () => {
    expect(BLOQUE).toContain('disabled={descargandoZip}');
  });
});

describe('12/14) Loading evita doble clic', () => {
  it('descargarTodoZip retorna de inmediato si ya hay una descarga en curso (guard al inicio de la función)', () => {
    const inicio = PAGE_TSX.indexOf('const descargarTodoZip=async()=>{');
    expect(inicio).toBeGreaterThan(-1);
    const cuerpo = PAGE_TSX.slice(inicio, inicio + 600);
    expect(cuerpo).toContain('if(descargandoZip)return;');
    expect(cuerpo).toContain('setDescargandoZip(true);');
  });
  it('setDescargandoZip(false) en el finally — nunca deja el botón bloqueado si falla', () => {
    const inicio = PAGE_TSX.indexOf('const descargarTodoZip=async()=>{');
    const fin = PAGE_TSX.indexOf('const getDocExt=', inicio);
    const cuerpo = PAGE_TSX.slice(inicio, fin);
    expect(cuerpo).toContain('}finally{');
    expect(cuerpo).toContain('setDescargandoZip(false);');
  });
});

/** Ajuste "REGRESIÓN — VistFichaBusqueda (Búsqueda de procesos →
 * Procesos gestionados → Documentación)" — hallazgo real del usuario:
 * "Descargar todo" se había conectado SOLO en `VistFicha`, pero esta
 * pantalla la renderiza un componente COMPLETAMENTE distinto
 * (`VistFichaBusqueda`, su propio `docArr`/`docVista`/bloque de
 * Documentación independiente) que nunca tuvo el botón. Extrae el
 * bloque delimitado por los límites reales de la función, para no
 * confundirlo con el de `VistFicha` (que usa exactamente los mismos
 * textos "Documentos {docArr.length...}"/"Descargar todo"). */
function extraerVistFichaBusqueda(): string {
  const inicio = PAGE_TSX.indexOf('function VistFichaBusqueda(');
  const fin = PAGE_TSX.indexOf('function VistFichaAsignacion(', inicio);
  if (inicio === -1 || fin === -1) throw new Error('No se encontró VistFichaBusqueda en page.tsx');
  return PAGE_TSX.slice(inicio, fin);
}
const BLOQUE_BUSQUEDA = extraerVistFichaBusqueda();

describe('REGRESIÓN — VistFichaBusqueda (Procesos gestionados → Documentación, 17 documentos reales)', () => {
  it('tiene su PROPIO estado descargandoZip (no depende del de VistFicha, componente distinto)', () => {
    expect(BLOQUE_BUSQUEDA).toContain('const [descargandoZip,setDescargandoZip]=React.useState(false);');
  });
  it('tiene su PROPIO handler descargarTodoZip, apuntando a sol.id (mismo id que usa su propio docArr=safeArray(sol.docData), no solActual.id)', () => {
    expect(BLOQUE_BUSQUEDA).toContain('const descargarTodoZip=async()=>{');
    expect(BLOQUE_BUSQUEDA).toContain('const docArr = safeArray<DocumentoDinamico>(sol.docData);');
    expect(BLOQUE_BUSQUEDA).toContain('fetch(`/api/solicitudes/${sol.id}/documentos/descargar-todo`)');
  });
  it('el botón está conectado (onClick={descargarTodoZip}) en el header de "Documentos (N)" de ESTE componente, a la izquierda del selector grid/lista', () => {
    const idxHeader = BLOQUE_BUSQUEDA.indexOf("Documentos {docArr.length>0&&`(${docArr.length})`}");
    const idxBoton = BLOQUE_BUSQUEDA.indexOf('<button onClick={descargarTodoZip}', idxHeader);
    const idxGridLista = BLOQUE_BUSQUEDA.indexOf("{([{v:'grid'},{v:'list'}]", idxHeader);
    expect(idxHeader).toBeGreaterThan(-1);
    expect(idxBoton).toBeGreaterThan(idxHeader);
    expect(idxBoton).toBeLessThan(idxGridLista);
  });
  it('visibilidad: al menos 1 documento con url/ruta/link O base64 — MISMA condición ampliada que VistFicha, sin depender de PDF/estado del proceso/grid-lista', () => {
    const idxHeader = BLOQUE_BUSQUEDA.indexOf("Documentos {docArr.length>0&&`(${docArr.length})`}");
    const tramo = BLOQUE_BUSQUEDA.slice(idxHeader, idxHeader + 400);
    expect(tramo).toContain("docArr.some((d:DocumentoDinamico)=>String(d.ruta||d.url||d.link||'')||String((d as any).base64||''))");
  });
  it('estado "Generando ZIP..." y disabled mientras descarga', () => {
    expect(BLOQUE_BUSQUEDA).toContain("{descargandoZip?'Generando ZIP...':'Descargar todo'}");
    expect(BLOQUE_BUSQUEDA).toContain('disabled={descargandoZip}');
  });
  it('descargarDoc individual y el selector grid/lista de ESTE componente siguen intactos', () => {
    expect(BLOQUE_BUSQUEDA).toContain("const descargarDoc=(d:DocumentoDinamico)=>{const url=String(d.ruta||d.url||d.link||'');");
    expect(BLOQUE_BUSQUEDA).toContain('onClick={()=>setDocVista(v)}');
  });
});

/** Ajuste "REGRESIÓN — VistFichaAsignacion (3ra variante de ficha)" —
 * mismo patrón ya validado en VistFicha/VistFichaBusqueda, esta vez con
 * `solLocal.id` (no `sol.id` ciego): es el MISMO id que ya usa con éxito
 * el fetch real de documentos de este componente
 * (`/api/solicitudes/${solicitudId}?soloDocumentos=true`, la fuente real
 * de `docArr`/`docArrVisible`). */
function extraerVistFichaAsignacion(): string {
  const inicio = PAGE_TSX.indexOf('function VistFichaAsignacion(');
  const fin = PAGE_TSX.indexOf('function ModuloAsignacionesPorValidar(', inicio);
  if (inicio === -1 || fin === -1) throw new Error('No se encontró VistFichaAsignacion en page.tsx');
  return PAGE_TSX.slice(inicio, fin);
}
const BLOQUE_ASIGNACION = extraerVistFichaAsignacion();

describe('REGRESIÓN — VistFichaAsignacion (3ra ficha, mismo comportamiento consistente)', () => {
  it('1) tiene su PROPIO estado descargandoZip', () => {
    expect(BLOQUE_ASIGNACION).toContain('const [descargandoZip,setDescargandoZip]=React.useState(false);');
  });
  it('2/3) tiene su PROPIO handler descargarTodoZip, apuntando a solLocal.id (el MISMO id que ya usa el fetch real ?soloDocumentos=true de este componente, nunca sol.id ciego)', () => {
    expect(BLOQUE_ASIGNACION).toContain('const descargarTodoZip=async()=>{');
    expect(BLOQUE_ASIGNACION).toContain('fetch(`/api/solicitudes/${solLocal.id}/documentos/descargar-todo`)');
    expect(BLOQUE_ASIGNACION).toContain('fetch(`/api/solicitudes/${solicitudId}?soloDocumentos=true`)');
  });
  it('4) el botón está conectado en el header "Documentos (N)" de ESTE componente, a la izquierda del selector grid/lista', () => {
    const idxHeader = BLOQUE_ASIGNACION.indexOf("Documentos {docArrVisible.length>0&&`(${docArrVisible.length})`}");
    const idxBoton = BLOQUE_ASIGNACION.indexOf('<button onClick={descargarTodoZip}', idxHeader);
    const idxGridLista = BLOQUE_ASIGNACION.indexOf("{([{v:'grid'},{v:'list'}]", idxHeader);
    expect(idxHeader).toBeGreaterThan(-1);
    expect(idxBoton).toBeGreaterThan(idxHeader);
    expect(idxBoton).toBeLessThan(idxGridLista);
  });
  it('4) visibilidad: al menos 1 documento con url/ruta/link O base64 en docArrVisible', () => {
    const idxHeader = BLOQUE_ASIGNACION.indexOf("Documentos {docArrVisible.length>0&&`(${docArrVisible.length})`}");
    const tramo = BLOQUE_ASIGNACION.slice(idxHeader, idxHeader + 1200);
    expect(tramo).toContain("docArrVisible.some((d:DocumentoDinamico)=>String(d.ruta||d.url||d.link||'')||String((d as any).base64||''))");
  });
  it('5) estado "Generando ZIP..." y disabled mientras descarga', () => {
    expect(BLOQUE_ASIGNACION).toContain("{descargandoZip?'Generando ZIP...':'Descargar todo'}");
    expect(BLOQUE_ASIGNACION).toContain('disabled={descargandoZip}');
  });
  it('6) grid/lista de este componente sigue intacto', () => {
    expect(BLOQUE_ASIGNACION).toContain('onClick={()=>setDocVista(v)}');
  });
  it('7) descargarDoc individual de este componente sigue intacto', () => {
    expect(BLOQUE_ASIGNACION).toContain("onClick={()=>descargarDoc(d)}");
    expect(BLOQUE_ASIGNACION).toContain("else{alert('Este documento no tiene contenido descargable.');}");
  });
});

/** Ajuste "FIX — ID INVÁLIDO EN DESCARGAR TODO" — bug real reportado por
 * el usuario: "Procesos gestionados → Documentación" enviaba `id:0` al
 * endpoint (ficha sintética armada desde un `LiciProceso`, sin el
 * `Solicitud.id` real que YA devuelve `/api/procesos/gestionados` como
 * `solicitudId`). Cubre las 3 fichas: ninguna debe poder llamar al
 * endpoint con un id que no sea `Solicitud.id`. */
describe('FIX — ID inválido: las 3 fichas usan Solicitud.id real, nunca codigoProceso/id de Proceso/id externo', () => {
  it('LiciProceso declara solicitudId (Solicitud.id real resuelto server-side por /api/procesos/gestionados) — nunca confundir con id/_dbId/procesoId', () => {
    expect(PAGE_TSX).toContain('solicitudId?:number|null;');
  });
  it('ModuloProcesosGestionados ya NO usa id:0 fijo — usa fichaAbierta.solicitudId??0 (el Solicitud.id real cuando existe)', () => {
    expect(PAGE_TSX).toContain('const sol:Solicitud={id:fichaAbierta.solicitudId??0,procesoId:fc.procesoId,procesoSourceKey:\'\',codigoProceso:fc.numeroProceso??\'\',');
    // Ya no debe quedar ningún `id:0` fijo alimentando VistFichaBusqueda
    // en el flujo de "Procesos gestionados" (yaGestionado=true).
    const idxGestionados = PAGE_TSX.indexOf('function ModuloProcesosGestionados(');
    const idxFin = PAGE_TSX.indexOf('yaGestionado={true}', idxGestionados);
    const tramo = PAGE_TSX.slice(idxGestionados, idxFin + 30);
    expect(tramo).not.toContain('const sol:Solicitud={id:0,');
  });

  it('VistFicha: guard bloquea el fetch si solActual.id no es válido (nunca llama al endpoint con id<=0)', () => {
    const inicio = PAGE_TSX.indexOf('function VistFicha(');
    const finBusqueda = PAGE_TSX.indexOf('function VistFichaBusqueda(');
    const tramo = PAGE_TSX.slice(inicio, finBusqueda);
    expect(tramo).toContain('if(!solActual.id||solActual.id<=0){');
    const idxGuard = tramo.indexOf('if(!solActual.id||solActual.id<=0){');
    const idxSetTrue = tramo.indexOf('setDescargandoZip(true);', idxGuard);
    const idxFetch = tramo.indexOf('fetch(`/api/solicitudes/${solActual.id}/documentos/descargar-todo`)', idxGuard);
    expect(idxGuard).toBeLessThan(idxSetTrue); // el guard corre ANTES de mostrar el estado de carga
    expect(idxSetTrue).toBeLessThan(idxFetch);
  });
  it('VistFichaBusqueda: guard bloquea el fetch si sol.id no es válido', () => {
    const idxGuard = BLOQUE_BUSQUEDA.indexOf('if(!sol.id||sol.id<=0){');
    const idxSetTrue = BLOQUE_BUSQUEDA.indexOf('setDescargandoZip(true);', idxGuard);
    expect(idxGuard).toBeGreaterThan(-1);
    expect(idxGuard).toBeLessThan(idxSetTrue);
  });
  it('VistFichaAsignacion: guard bloquea el fetch si solLocal.id no es válido', () => {
    const idxGuard = BLOQUE_ASIGNACION.indexOf('if(!solLocal.id||solLocal.id<=0){');
    const idxSetTrue = BLOQUE_ASIGNACION.indexOf('setDescargandoZip(true);', idxGuard);
    expect(idxGuard).toBeGreaterThan(-1);
    expect(idxGuard).toBeLessThan(idxSetTrue);
  });
  it('ninguno de los 3 guards usa codigoProceso/numeroProceso como sustituto del id', () => {
    for (const bloque of [PAGE_TSX.slice(PAGE_TSX.indexOf('function VistFicha('), PAGE_TSX.indexOf('function VistFichaBusqueda(')), BLOQUE_BUSQUEDA, BLOQUE_ASIGNACION]) {
      const idxGuard = bloque.search(/if\(!sol(Actual|Local)?\.id\|\|sol(Actual|Local)?\.id<=0\)\{/);
      expect(idxGuard).toBeGreaterThan(-1);
      const cuerpoGuard = bloque.slice(idxGuard, idxGuard + 200);
      expect(cuerpoGuard).not.toMatch(/codigoProceso|numeroProceso/);
    }
  });
  it('el error de id inválido no deja el botón en "Generando ZIP..." — el guard corre y retorna ANTES de setDescargandoZip(true), nunca queda un estado sin restaurar', () => {
    for (const bloque of [BLOQUE_BUSQUEDA, BLOQUE_ASIGNACION]) {
      const idxGuard = bloque.search(/if\(!sol(Actual|Local)?\.id\|\|sol(Actual|Local)?\.id<=0\)\{/);
      const cuerpoGuard = bloque.slice(idxGuard, idxGuard + 220);
      expect(cuerpoGuard).toMatch(/alert\(/);
      expect(cuerpoGuard).toContain('return;');
      // El return del guard ocurre antes de cualquier setDescargandoZip(true) —
      // así el estado nunca se pone en "cargando" para un id inválido.
      const idxReturnGuard = idxGuard + cuerpoGuard.indexOf('return;');
      const idxSetTrue = bloque.indexOf('setDescargandoZip(true);', idxGuard);
      expect(idxReturnGuard).toBeLessThan(idxSetTrue);
    }
  });
});

describe('Fetch al endpoint backend — nunca arma el ZIP en el navegador', () => {
  it('descargarTodoZip llama a GET /api/solicitudes/[id]/documentos/descargar-todo (nunca JSZip/archiver en el cliente)', () => {
    expect(PAGE_TSX).toContain('const resp=await fetch(`/api/solicitudes/${solActual.id}/documentos/descargar-todo`);');
    expect(PAGE_TSX).not.toMatch(/import\s+.*from\s+['"]jszip['"]/i);
  });
  it('lee el nombre del archivo desde Content-Disposition (nunca inventa uno distinto al que decide el backend)', () => {
    const inicio = PAGE_TSX.indexOf('const descargarTodoZip=async()=>{');
    const fin = PAGE_TSX.indexOf('const getDocExt=', inicio);
    const cuerpo = PAGE_TSX.slice(inicio, fin);
    expect(cuerpo).toContain("resp.headers.get('Content-Disposition')");
    expect(cuerpo).toContain('/filename="([^"]+)"/');
  });
});
