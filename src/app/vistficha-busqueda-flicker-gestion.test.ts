/**
 * Ajuste "FLICKER — ESTADO DE GESTIÓN AÚN CARGANDO" (bug real reportado,
 * caso SQR proceso No 26001209) — en `Búsqueda de procesos → Todos los
 * procesos` (`ModuloBusquedaProcesos`, alias `ModuloBusquedaFinal`), la
 * ficha (`VistFichaBusqueda`) mostraba brevemente "No disponible para
 * gestionar" (panel rojo) antes de corregirse a "Proceso ya gestionado".
 *
 * CAUSA RAÍZ: `yaGestionado={procesosGestionados.has(mkGestKey(...))}` —
 * `procesosGestionados` es un `Set` que arranca VACÍO y se puebla recién
 * cuando resuelve `fetch('/api/solicitudes/gestionados-ids')` (un fetch
 * aparte del que trae el listado de procesos, sin ningún flag de carga
 * propio). Mientras ese fetch está en vuelo, `.has(...)` da `false` para
 * CUALQUIER proceso — incluidos los que sí están gestionados — así que la
 * ausencia temporal de datos se leía como "no está en etapa de gestión".
 *
 * CORRECCIÓN: estado explícito `cargandoGestionados`/`errorGestionados`
 * (nuevo, no reutiliza `cargando`/`error` — esos gobiernan el listado
 * principal, un fetch distinto) que se pasa a `VistFichaBusqueda` como
 * `cargandoGestion`/`errorGestion`/`onReintentarGestion` (props opcionales,
 * default `false`/`undefined` — los otros 3 call sites de
 * `VistFichaBusqueda`, que usan `yaGestionado` ESTÁTICO sin fetch, no las
 * usan y no cambian de comportamiento). Dentro de `VistFichaBusqueda`, el
 * panel de acción ahora resuelve en este orden: cargando → error → ya
 * gestionado → sin permiso → estado no habilitado → acción de gestionar.
 *
 * Mismo patrón de texto fuente que el resto de *-page.test.ts (sin harness
 * de render de componentes en este repo).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PAGE_TSX = readFileSync(join(__dirname, 'page.tsx'), 'utf-8');

function extraerBloque(inicioMarker: string, finMarker: string): string {
  const inicio = PAGE_TSX.indexOf(inicioMarker);
  const fin = PAGE_TSX.indexOf(finMarker, inicio);
  if (inicio === -1 || fin === -1) throw new Error(`No se encontró el bloque ${inicioMarker} → ${finMarker}`);
  return PAGE_TSX.slice(inicio, fin);
}

const BLOQUE_MODULO_BUSQUEDA = extraerBloque('function ModuloBusquedaProcesos(', 'function DptoMultiSelect(');
const BLOQUE_VISTFICHA_BUSQUEDA = extraerBloque('function VistFichaBusqueda(', 'function DptoMultiSelect(');

describe('1) Componente exacto y variables implicadas', () => {
  it('la ficha de "Todos los procesos" es VistFichaBusqueda, dentro de ModuloBusquedaProcesos (alias ModuloBusquedaFinal)', () => {
    expect(PAGE_TSX).toContain('const ModuloBusquedaFinal=ModuloBusquedaProcesos;');
    expect(BLOQUE_MODULO_BUSQUEDA).toContain('<VistFichaBusqueda');
  });
  it('yaGestionado sale de procesosGestionados.has(mkGestKey(...)) — un Set poblado por un fetch aparte de gestionados-ids', () => {
    expect(BLOQUE_MODULO_BUSQUEDA).toContain("yaGestionado={procesosGestionados.has(mkGestKey(fichaAbierta.codigoProceso,fichaAbierta.entidad))}");
    expect(BLOQUE_MODULO_BUSQUEDA).toContain("fetch('/api/solicitudes/gestionados-ids')");
  });
});

describe('2) Estado inicial causante — procesosGestionados arranca vacío, sin flag de carga (antes del fix)', () => {
  it('procesosGestionados sigue siendo un Set inicializado vacío (no se cambió su valor inicial — se agregó un flag de carga aparte)', () => {
    expect(BLOQUE_MODULO_BUSQUEDA).toContain('const [procesosGestionados,setProcesosGestionados]=useState<Set<string>>(new Set());');
  });
  it('nuevo estado explícito cargandoGestionados/errorGestionados, distinto de cargando/error (que gobiernan el listado principal, fetch distinto)', () => {
    expect(BLOQUE_MODULO_BUSQUEDA).toContain('const [cargandoGestionados,setCargandoGestionados]=useState(true);');
    expect(BLOQUE_MODULO_BUSQUEDA).toContain('const [errorGestionados,setErrorGestionados]=useState(false);');
    expect(BLOQUE_MODULO_BUSQUEDA).toContain("const [cargando,setCargando]=useState(true);");
  });
});

describe('3) Traza de carga — cargarGestionados actualiza el flag en todos los caminos (éxito/error/finally)', () => {
  it('cargarGestionados marca cargando=true al iniciar y cargando=false en el finally (siempre, éxito o error)', () => {
    const idx = BLOQUE_MODULO_BUSQUEDA.indexOf('const cargarGestionados=useCallback(()=>{');
    expect(idx).toBeGreaterThan(-1);
    const tramo = BLOQUE_MODULO_BUSQUEDA.slice(idx, idx + 600);
    expect(tramo).toContain('setCargandoGestionados(true);setErrorGestionados(false);');
    expect(tramo).toContain('.finally(()=>setCargandoGestionados(false));');
  });
  it('el catch marca errorGestionados=true (antes era completamente silencioso: .catch(()=>{}))', () => {
    const idx = BLOQUE_MODULO_BUSQUEDA.indexOf('const cargarGestionados=useCallback(()=>{');
    const tramo = BLOQUE_MODULO_BUSQUEDA.slice(idx, idx + 600);
    expect(tramo).toContain('.catch(()=>{setErrorGestionados(true);})');
  });
  it('el useEffect de montaje llama a cargarGestionados() (mismo momento que consultar(1), sin cambiar el timing real del fetch)', () => {
    expect(BLOQUE_MODULO_BUSQUEDA).toContain('consultar(1);\n    cargarGestionados();');
  });
});

describe('4) Props nuevas pasadas a VistFichaBusqueda (solo en el call site de "Todos los procesos")', () => {
  it('cargandoGestion/errorGestion/onReintentarGestion se pasan con las variables correctas', () => {
    expect(BLOQUE_MODULO_BUSQUEDA).toContain('cargandoGestion={cargandoGestionados}');
    expect(BLOQUE_MODULO_BUSQUEDA).toContain('errorGestion={errorGestionados}');
    expect(BLOQUE_MODULO_BUSQUEDA).toContain('onReintentarGestion={cargarGestionados}');
  });
});

describe('5) VistFichaBusqueda — orden de evaluación: cargando -> error -> gestionado -> sin permiso -> no habilitado -> acción', () => {
  it('cargandoGestion se evalúa PRIMERO (antes que yaGestionado/puedeGestionar/estadoHabilitado)', () => {
    const idxCargando = BLOQUE_VISTFICHA_BUSQUEDA.indexOf('if(cargandoGestion) return(');
    const idxError = BLOQUE_VISTFICHA_BUSQUEDA.indexOf('if(errorGestion) return(');
    const idxGestionado = BLOQUE_VISTFICHA_BUSQUEDA.indexOf('if(yaGestionado) return(');
    const idxPermiso = BLOQUE_VISTFICHA_BUSQUEDA.indexOf('if(!puedeGestionar) return(');
    const idxHabilitado = BLOQUE_VISTFICHA_BUSQUEDA.indexOf('if(!estadoHabilitado) return(');
    expect(idxCargando).toBeGreaterThan(-1);
    expect(idxError).toBeGreaterThan(idxCargando);
    expect(idxGestionado).toBeGreaterThan(idxError);
    expect(idxPermiso).toBeGreaterThan(idxGestionado);
    expect(idxHabilitado).toBeGreaterThan(idxPermiso);
  });
  it('mientras carga NO se muestra "No disponible para gestionar" ni "Estado: —" — texto neutro "Consultando estado del proceso…"', () => {
    const idx = BLOQUE_VISTFICHA_BUSQUEDA.indexOf('if(cargandoGestion) return(');
    const idxSiguiente = BLOQUE_VISTFICHA_BUSQUEDA.indexOf('if(errorGestion) return(', idx);
    const bloque = BLOQUE_VISTFICHA_BUSQUEDA.slice(idx, idxSiguiente);
    expect(bloque).toContain('Consultando estado del proceso…');
    expect(bloque).not.toContain('No disponible para gestionar');
    expect(bloque).not.toContain('Estado: {');
  });
  it('props cargandoGestion/errorGestion tienen default false — los otros 3 call sites (estáticos) no cambian de comportamiento', () => {
    expect(PAGE_TSX).toContain('cargandoGestion=false,errorGestion=false,onReintentarGestion,');
  });
});

describe('3) Fetch termina con yaGestionado=true → "Proceso ya gestionado" (sin cambios de esa rama)', () => {
  it('el bloque "Proceso ya gestionado" + "Ver en..." no fue modificado', () => {
    expect(BLOQUE_VISTFICHA_BUSQUEDA).toContain('Proceso ya gestionado');
    expect(BLOQUE_VISTFICHA_BUSQUEDA).toContain('{irSolicitudLabel}');
  });
});

describe('4) Fetch termina con realmente no disponible → panel rojo (sin cambios de esa rama, solo se evalúa DESPUÉS del loading)', () => {
  it('el panel "No disponible para gestionar" con "Estado: {sol.estadoFuente||\'—\'}" sigue existiendo tal cual', () => {
    expect(BLOQUE_VISTFICHA_BUSQUEDA).toContain('No disponible para gestionar');
    expect(BLOQUE_VISTFICHA_BUSQUEDA).toContain("Estado: {sol.estadoFuente||'—'}");
    expect(BLOQUE_VISTFICHA_BUSQUEDA).toContain('El proceso no está en etapa de gestión');
  });
});

describe('5) Error de fetch → mensaje de error de carga, nunca "Estado: —"', () => {
  it('el panel de error usa un mensaje distinto al de "no disponible", con botón Reintentar condicional', () => {
    const idx = BLOQUE_VISTFICHA_BUSQUEDA.indexOf('if(errorGestion) return(');
    expect(idx).toBeGreaterThan(-1);
    const idxSiguiente = BLOQUE_VISTFICHA_BUSQUEDA.indexOf('if(yaGestionado) return(', idx);
    const bloque = BLOQUE_VISTFICHA_BUSQUEDA.slice(idx, idxSiguiente);
    expect(bloque).toContain('No fue posible consultar el estado de gestión.');
    expect(bloque).toContain('onReintentarGestion&&');
    expect(bloque).toContain('Reintentar');
    expect(bloque).not.toContain('Estado: {sol.estadoFuente');
  });
});

describe('6) Transición loading -> gestionado nunca pasa visualmente por "no_disponible" (garantía estructural del orden de ifs)', () => {
  it('cargandoGestion=true hace return ANTES de evaluar yaGestionado/estadoHabilitado — mismo render, un único if temprano', () => {
    const idxCargando = BLOQUE_VISTFICHA_BUSQUEDA.indexOf('if(cargandoGestion) return(');
    const idxHabilitado = BLOQUE_VISTFICHA_BUSQUEDA.indexOf('if(!estadoHabilitado) return(');
    expect(idxHabilitado).toBeGreaterThan(idxCargando);
  });
});

describe('7) Botón "Ver en Procesos Privados/Públicos" (onIrSolicitud) sigue funcionando, sin cambios de lógica', () => {
  it('onIrSolicitud sigue derivándose de procesosGestionados.has(...) + getModuloDestino, sin tocar', () => {
    expect(BLOQUE_MODULO_BUSQUEDA).toContain('onIrSolicitud={procesosGestionados.has(mkGestKey(fichaAbierta.codigoProceso,fichaAbierta.entidad))&&onModuleChange?');
    expect(BLOQUE_MODULO_BUSQUEDA).toContain('getModuloDestino(_k)');
  });
});

describe('8) Mismo patrón en otras variantes que reutilizan VistFichaBusqueda — auditado, sin el bug (yaGestionado estático, sin fetch)', () => {
  it('ModuloProcesosGestionados usa yaGestionado={true} estático (nunca depende de un fetch en vuelo)', () => {
    expect(PAGE_TSX).toContain("puedeGestionar={false} yaGestionado={true} ocultarNoViable={true}");
  });
  it('ModuloProcesosNoViables usa yaGestionado={false} estático', () => {
    const idx = PAGE_TSX.indexOf('Cargando procesos no viables...');
    expect(idx).toBeGreaterThan(-1);
    const tramo = PAGE_TSX.slice(idx, idx + 700);
    expect(tramo).toContain('yaGestionado={false}');
  });
  it('ModuloProcesosSinGestionar usa yaGestionado={false} estático', () => {
    expect(PAGE_TSX).toContain("yaGestionado={false} ocultarNoViable={false}");
  });
});

describe('No se tocó: permisos, estados reales del proceso, endpoint (salvo el flag de carga agregado), lógica de gestión, navegación', () => {
  it('el endpoint /api/solicitudes/gestionados-ids no cambió de URL/forma', () => {
    expect(BLOQUE_MODULO_BUSQUEDA).toContain("fetch('/api/solicitudes/gestionados-ids')");
  });
  it('handleGestionar (POST de creación de Solicitud) no fue tocado', () => {
    expect(BLOQUE_MODULO_BUSQUEDA).toContain("const handleGestionar=async(p:LiciProceso)=>{");
  });
  it('puedeGestionar del módulo (permiso real, puedeConBD) sigue igual, sin relación con el nuevo flag de carga', () => {
    expect(PAGE_TSX).toContain("puedeGestionar={puedeConBD(sesion?.rol,'busqueda','gestionar',sesion?.permisosRol)} yaGestionado={false} ocultarNoViable={false}");
  });
});
