/**
 * Ajuste "FLICKER DE PERMISOS — MERCADEO" — bug real (captura): al entrar a
 * un proceso Privado, la ficha mostraba brevemente "No figuras como
 * responsable activo..." (y ocultaba los botones de acción) durante el
 * primer render, porque `puedeGestionarFicha` caía al fallback local
 * (`asignacionPropia||esAdministradorProcesosCliente`, que no conoce
 * Mercadeo) mientras `permisosBackend` todavía era `null` — luego, al
 * resolver el fetch, el mensaje desaparecía y aparecía la UI correcta.
 *
 * Corrección: se reutiliza el estado de carga de 3 valores YA EXISTENTE
 * (`cargaResponsablesFicha: EstadoCargaResponsables`, loading/error/
 * success) — `permisosBackend` se fija en el MISMO `.then()` que ese
 * estado, así que `cargaResponsablesFicha.tipo==='loading'` es la señal
 * fiable de "todavía no sabemos el permiso real". Nunca se agregó un
 * segundo fetch. La REGLA de autorización (`puedeGestionarFicha`,
 * `puedeCerrarSolicitud`, etc.) no cambió — solo CUÁNDO se confía en su
 * resultado.
 *
 * Mismo patrón de texto fuente que el resto de *-page.test.ts (sin
 * harness de render de componentes en este repo).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PAGE_TSX = readFileSync(join(__dirname, 'page.tsx'), 'utf-8');

describe('Ficha de proceso — sin falsa denegación mientras permisosBackend carga', () => {
  it('el mensaje "No figuras como responsable activo" solo se evalúa cuando cargaResponsablesFicha.tipo !== \'loading\' (condición adicional en la MISMA expresión && de siempre, nunca un texto de carga separado)', () => {
    // Ajuste "AVISO 'NO FIGURAS COMO RESPONSABLE' — NO APLICA A MERCADEO EN
    // SEGUIMIENTO" agregó `!esMercadeo(sesion.rol)` a esta misma expresión
    // (ver seguimiento-mercadeo-sin-aviso-responsable.test.ts) — la
    // protección contra flicker de este ajuste sigue intacta, solo cambió
    // el texto exacto esperado.
    expect(PAGE_TSX).toContain("{cargaResponsablesFicha.tipo!=='loading'&&!puedeGestionarFicha&&asignaciones.length>0&&!esMercadeo(sesion.rol)&&(");
  });

  it('mientras carga, no se renderiza NADA en ese espacio (ni texto "Cargando…" ni el mensaje de acceso restringido) — feedback explícito del usuario: un indicador de carga tampoco debe ser visible ahí', () => {
    const idx = PAGE_TSX.indexOf("{cargaResponsablesFicha.tipo!=='loading'&&!puedeGestionarFicha&&asignaciones.length>0&&!esMercadeo(sesion.rol)&&(");
    expect(idx).toBeGreaterThan(-1);
    const bloque = PAGE_TSX.slice(idx, idx + 400);
    expect(bloque).not.toContain('Cargando permisos');
    expect(bloque).not.toContain('Cargando…');
  });

  it('el botón que da acceso al panel de gestión (Comenzar elaboración/Ver evidencias/Revisar proceso) no se muestra como autorizado ni denegado mientras carga — se le agrega cargaResponsablesFicha.tipo!==\'loading\' como condición adicional, sin tocar puedeGestionarFicha', () => {
    // Ajuste "EVIDENCIA VISIBLE PARA TODOS LOS QUE CONSULTAN" — este gate
    // cambió de `puedeGestionarFicha` a `puedeVerFicha` (autorización de
    // LECTURA, separada de escritura) — la protección contra flicker
    // (`cargaResponsablesFicha.tipo!=='loading'`) sigue intacta.
    expect(PAGE_TSX).toContain("{cargaResponsablesFicha.tipo!=='loading'&&puedeVerFicha&&!estadoGlobalAmbiguo&&etapaGlobal!=='CIERRE'&&(");
  });

  it('el botón "Cerrar proceso sin presentar" (APROBADO_ELABORACION) tampoco aparece como definitivo mientras carga — misma condición adicional', () => {
    expect(PAGE_TSX).toContain("{cargaResponsablesFicha.tipo!=='loading'&&puedeActuar&&estadoGlobalCanonico==='APROBADO_ELABORACION'&&(");
  });

  it('el caso de error de red NO se confunde con "sin permisos" — cargaResponsablesFicha.tipo==='+"'error'"+' no es \'loading\', así que cae al comportamiento previo (fallback local ya existente), consistente con el bloque de error+"Reintentar" ya usado para la lista de responsables', () => {
    // El manejo de error de la lista de responsables (con botón Reintentar) sigue existiendo sin cambios — no se le agregó ninguna condición de este ajuste.
    const idxErrorResponsables = PAGE_TSX.indexOf("if (!mostrandoAlgo && cargaResponsablesFicha.tipo==='error')");
    expect(idxErrorResponsables).toBeGreaterThan(-1);
    const bloqueError = PAGE_TSX.slice(idxErrorResponsables, idxErrorResponsables + 700);
    expect(bloqueError).toContain('Reintentar');
  });

  it('la regla de autorización en sí (puedeGestionarFicha) no cambió — sigue siendo (puedeRevisarProceso ?? fallback) || puedeCerrarSolicitud, sin ninguna referencia nueva a estados de carga dentro de su propia expresión', () => {
    expect(PAGE_TSX).toContain(
      'const puedeGestionarFicha = (permisosBackend?.puedeRevisarProceso\n' +
      '    ?? (!!asignacionPropia || esAdministradorProcesosCliente))\n' +
      '    || (permisosBackend?.puedeCerrarSolicitud ?? false);'
    );
  });

  it('cargaResponsablesFicha y permisosBackend se fijan en el MISMO .then() (misma resolución de promesa) — nunca dos fetch independientes que puedan desincronizarse', () => {
    const idxThen = PAGE_TSX.indexOf('promesa.then((d:any)=>{');
    expect(idxThen).toBeGreaterThan(-1);
    const bloqueThen = PAGE_TSX.slice(idxThen, PAGE_TSX.indexOf('});', idxThen));
    expect(bloqueThen).toContain('setPermisosBackend(d.permisos??null);');
    expect(bloqueThen).toContain("setCargaResponsablesFicha({tipo:'success'");
  });
});
