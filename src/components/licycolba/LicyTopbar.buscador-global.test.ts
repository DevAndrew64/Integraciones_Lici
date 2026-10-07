/**
 * Ajuste "BUSCADOR GLOBAL — ESTADOS DEL DROPDOWN" (bug real reportado) —
 * mientras se escribía en el buscador superior del header, aparecía un
 * "…" suelto (indicador de carga inline, `{buscando&&<span>…</span>}`,
 * dentro del `<form>`, fuera de cualquier contenedor con fondo/borde) — y
 * cuando la búsqueda no arrojaba resultados, el dropdown nunca se abría
 * (gateado por `resultados.length>0`), así que no había ningún mensaje.
 *
 * Corrección — un ÚNICO contenedor posicionado (mismo diseño de siempre:
 * fondo blanco, borde, sombra, z-index 9999, alineado al input) que ahora
 * cubre los 4 estados reales:
 *  - cargando (`buscando`): "Buscando..." dentro del contenedor;
 *  - error (`errorBusqueda`, nuevo estado): mensaje controlado;
 *  - sin resultados (`resultados.length===0`, ni cargando ni error):
 *    "No se encontraron resultados.";
 *  - con resultados: el listado de siempre, sin cambios.
 * Input vacío/con menos de 2 caracteres sigue sin mostrar nada
 * (`dropdownOpen` se pone en `false` en ese caso, comportamiento
 * preexistente sin cambios).
 *
 * NO se tocó: el endpoint (`/api/solicitudes?limit=8&q=...`), el debounce
 * (300ms), la navegación al elegir un resultado (`onAbrirSolicitud`/
 * `onBuscarGlobal`), ni permisos.
 *
 * Mismo patrón de texto fuente que el resto de *-page.test.ts (sin harness
 * de render de componentes en este repo).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(__dirname, 'LicyTopbar.tsx'), 'utf-8');

describe('1) Input vacío/corto (<2 caracteres) — no muestra nada', () => {
  it('el efecto de debounce cierra el dropdown y limpia resultados/error cuando q.length<2 (sin cambios de comportamiento)', () => {
    expect(SRC).toContain('if(q.length < 2){');
    expect(SRC).toContain('setResultados([]); setDropdownOpen(false); setErrorBusqueda(false);');
  });
});

describe('2) Cargando — estado claro ("Buscando..."), nunca un "…" suelto', () => {
  it('ya no existe el span flotante "…" dentro del form', () => {
    expect(SRC).not.toContain('{buscando&&<span style={{fontSize:10,color:\'#94a3b8\',marginRight:8,fontFamily:F}}>…</span>}');
    expect(SRC).not.toMatch(/<span[^>]*>…<\/span>/);
  });
  it('el estado de carga se muestra DENTRO del contenedor posicionado (mismo fondo/borde/sombra que el resto), con texto "Buscando..."', () => {
    const idx = SRC.indexOf('{buscando?(');
    expect(idx).toBeGreaterThan(-1);
    const tramo = SRC.slice(idx, idx + 200);
    expect(tramo).toContain('Buscando...');
  });
  it('dropdownOpen se pone en true YA al iniciar la búsqueda (no solo cuando llegan los resultados), para poder mostrar "Buscando..." de inmediato', () => {
    const idx = SRC.indexOf('setBuscando(true);');
    expect(idx).toBeGreaterThan(-1);
    const tramo = SRC.slice(idx, idx + 150);
    expect(tramo).toContain('setDropdownOpen(true);');
  });
});

describe('3) Con resultados — listado visible, sin cambios de comportamiento', () => {
  it('el bloque de resultados (código, entidad, objeto, "Ver todos los resultados") sigue intacto', () => {
    expect(SRC).toContain('{r.codigoProceso||\'—\'}');
    expect(SRC).toContain('Ver todos los resultados para');
  });
  it('el listado solo se renderiza cuando NO está cargando, sin error, y hay resultados', () => {
    expect(SRC).toContain('):resultados.length===0?(');
    expect(SRC).toContain('):(<>');
  });
});

describe('4) Sin resultados — "No se encontraron resultados." (antes: dropdown nunca se abría)', () => {
  it('existe la rama explícita para resultados.length===0 con el mensaje exacto', () => {
    const idx = SRC.indexOf('resultados.length===0?(');
    expect(idx).toBeGreaterThan(-1);
    const tramo = SRC.slice(idx, idx + 150);
    expect(tramo).toContain('No se encontraron resultados.');
  });
});

describe('5) Limpiar búsqueda — el dropdown desaparece (sin cambios de comportamiento)', () => {
  it('setDropdownOpen(false) sigue ejecutándose al vaciar el campo (misma rama q.length<2 del punto 1)', () => {
    expect(SRC).toContain('setResultados([]); setDropdownOpen(false); setErrorBusqueda(false);');
  });
  it('al seleccionar un resultado también se cierra el dropdown y se limpia el campo (sin cambios)', () => {
    const idx = SRC.indexOf('r.codigoProceso||\'—\'');
    const antes = SRC.slice(Math.max(0, idx - 1000), idx);
    expect(antes).toContain('setDropdownOpen(false);');
    expect(antes).toContain("setBusqueda('');");
  });
});

describe('6) Error — mensaje controlado, nuevo estado (antes: silencioso, sin distinguir de "sin resultados")', () => {
  it('existe errorBusqueda como estado propio, distinto de resultados vacíos', () => {
    expect(SRC).toContain("const [errorBusqueda, setErrorBusqueda] = useState(false);");
  });
  it('el catch del fetch marca errorBusqueda=true para un error real (nunca para un AbortError, ver bloque de carrera de búsquedas más abajo)', () => {
    expect(SRC).toContain('setResultados([]); setErrorBusqueda(true);');
  });
});

describe('Ajuste "BUSCADOR GLOBAL — CARRERA DE BÚSQUEDAS" — AbortController evita que una respuesta vieja pise una más reciente', () => {
  it('mantiene una referencia al AbortController de la búsqueda en curso', () => {
    expect(SRC).toContain('const abortBusquedaRef = useRef<AbortController | null>(null);');
  });
  it('1/2) antes de lanzar un nuevo fetch, aborta cualquier búsqueda anterior en vuelo y crea un controller nuevo', () => {
    const idx = SRC.indexOf('const controller = new AbortController();');
    expect(idx).toBeGreaterThan(-1);
    const antes = SRC.slice(Math.max(0, idx - 60), idx);
    expect(antes).toContain('abortBusquedaRef.current?.abort();');
    expect(SRC).toContain('abortBusquedaRef.current = controller;');
  });
  it('el fetch recibe signal:controller.signal', () => {
    expect(SRC).toContain('{ signal: controller.signal }');
  });
  it('3/4/5) una respuesta exitosa solo actualiza resultados si su controller sigue siendo el vigente (nunca una respuesta tardía/abortada)', () => {
    const idx = SRC.indexOf('{ signal: controller.signal }');
    expect(idx).toBeGreaterThan(-1);
    const tramo = SRC.slice(idx, idx + 250);
    expect(tramo).toContain('if(abortBusquedaRef.current !== controller) return;');
  });
  it('6) AbortError nunca activa errorBusqueda ni toca resultados — se descarta en silencio', () => {
    const idx = SRC.indexOf("}catch(err){");
    expect(idx).toBeGreaterThan(-1);
    const tramo = SRC.slice(idx, idx + 300);
    expect(tramo).toContain("if((err as { name?: string })?.name === 'AbortError') return;");
    // La línea que sí marca error real viene DESPUÉS del early-return de AbortError.
    const idxAbort = tramo.indexOf("AbortError");
    const idxErrorReal = tramo.indexOf('setErrorBusqueda(true);');
    expect(idxErrorReal).toBeGreaterThan(idxAbort);
  });
  it('7) un error real (no AbortError) sigue activando errorBusqueda, igual que antes', () => {
    const idx = SRC.indexOf("}catch(err){");
    const tramo = SRC.slice(idx, idx + 400);
    expect(tramo).toContain('setResultados([]); setErrorBusqueda(true);');
  });
  it('finally solo apaga "buscando" si sigue siendo el controller vigente (una carga vieja no puede reactivar/desactivar el loading de la nueva)', () => {
    expect(SRC).toContain('if(abortBusquedaRef.current === controller) setBuscando(false);');
  });
  it('8) limpiar el input (q.length<2) aborta la búsqueda en vuelo y apaga buscando/error/dropdown/resultados', () => {
    const idx = SRC.indexOf('if(q.length < 2){');
    const tramo = SRC.slice(idx, idx + 400);
    expect(tramo).toContain('abortBusquedaRef.current?.abort();');
    expect(tramo).toContain('setResultados([]); setDropdownOpen(false); setErrorBusqueda(false); setBuscando(false);');
  });
  it('9) al desmontar el componente se cancela el timeout pendiente y se aborta el fetch en vuelo', () => {
    const idx = SRC.lastIndexOf('return ()=>{');
    expect(idx).toBeGreaterThan(-1);
    const tramo = SRC.slice(idx, idx + 200);
    expect(tramo).toContain('if(debounceRef.current) clearTimeout(debounceRef.current);');
    expect(tramo).toContain('abortBusquedaRef.current?.abort();');
  });
});

describe('No se tocó: endpoint, debounce, navegación al seleccionar, permisos', () => {
  it('el endpoint y el debounce de 300ms siguen exactamente igual', () => {
    expect(SRC).toContain('/api/solicitudes?limit=8&q=');
    expect(SRC).toContain('}, 300);');
  });
  it('la navegación al elegir un resultado (onAbrirSolicitud/onBuscarGlobal) no fue tocada', () => {
    expect(SRC).toContain('if(onAbrirSolicitud){ onAbrirSolicitud(r.id); }');
    expect(SRC).toContain('onBuscarGlobal?.(q);');
  });
});

describe('Diseño del dropdown — alineado, fondo blanco, borde/sombra, z-index, sin desplazar el header', () => {
  it('un único contenedor posicionado (position:absolute, top calc(100% + 4px), left/right:0) cubre todos los estados', () => {
    expect(SRC).toContain("position:'absolute',top:'calc(100% + 4px)',left:0,right:0,minWidth:380,background:'white',border:'1px solid #e2e8f0',borderRadius:10,boxShadow:'0 8px 24px rgba(13,45,94,.15)',zIndex:9999,overflow:'hidden',fontFamily:F");
  });
  it('el wrapper del buscador sigue siendo position:relative (contexto de posicionamiento del dropdown, sin desplazar el resto del header)', () => {
    expect(SRC).toContain("<div ref={searchRef} style={{position:'relative'}}>");
  });
});
