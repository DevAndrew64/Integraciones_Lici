/**
 * Ajuste "editar/eliminar observaciones" — botones Editar/Eliminar sobre una
 * observación registrada, dentro de `GestionAsignacionInline` (panel
 * "Observaciones del proceso"). Reglas finales (revisión en vivo sobre el
 * requerimiento original "solo Administrador"):
 *  - Editar: Administrador de Procesos O cualquier usuario del proceso
 *    comercial (`esComercial`).
 *  - Eliminar: Administrador de Procesos O EXCLUSIVAMENTE quien creó esa
 *    observación (`o.usuario === sesion.usuario`) — un co-responsable que
 *    puede editar no necesariamente puede eliminar.
 *  - Ambos: renderizado condicional completo (el botón desaparece del árbol,
 *    no queda deshabilitado) y solo mientras el proceso sigue en revisión/
 *    observación (una vez cerrado, el panel completo deja de renderizarse).
 *
 * El comportamiento real (backend) se prueba con integración de PATCH en
 * `src/app/api/solicitudes/observaciones-admin.test.ts` (llamando al
 * handler real, no strings). Este archivo cubre lo que SOLO puede
 * verificarse en la fuente porque no existe harness de render de
 * componentes en este repo (sin jsdom/RTL, ver convención del resto del
 * proyecto).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PAGE_TSX = readFileSync(join(__dirname, 'page.tsx'), 'utf-8');

describe('Editar observación — gate de Administrador o proceso comercial', () => {
  it('el botón Editar está condicionado a permisos?.esAdministradorProcesos || esComercial', () => {
    const idx = PAGE_TSX.indexOf("(!!permisos?.esAdministradorProcesos || !!esComercial) && (estadoRevision === 'EN_REVISION'");
    expect(idx).toBeGreaterThan(-1);
    const bloque = PAGE_TSX.slice(idx, idx + 1700);
    expect(bloque).toContain('Editar');
    expect(bloque).not.toContain('Eliminar'); // el botón Eliminar tiene su PROPIO bloque condicional, separado
  });

  it('es un renderizado condicional completo (&&), no un atributo disabled', () => {
    const idx = PAGE_TSX.indexOf("(!!permisos?.esAdministradorProcesos || !!esComercial) && (estadoRevision === 'EN_REVISION'");
    const bloque = PAGE_TSX.slice(idx, idx + 1700);
    expect(bloque).not.toContain('disabled={!');
  });
});

describe('Eliminar observación — gate de Administrador o EXCLUSIVAMENTE quien la creó', () => {
  it('el botón Eliminar está condicionado a permisos?.esAdministradorProcesos || (o.usuario === sesion.usuario) — NO a esComercial', () => {
    const idx = PAGE_TSX.indexOf("(!!permisos?.esAdministradorProcesos || safeString(o.usuario) === sesion.usuario) && (estadoRevision === 'EN_REVISION'");
    expect(idx).toBeGreaterThan(-1);
    const bloque = PAGE_TSX.slice(idx, idx + 700);
    expect(bloque).toContain('Eliminar');
    expect(bloque).not.toContain('esComercial'); // pertenecer al proceso comercial NO basta para eliminar
  });

  it('es un renderizado condicional completo (&&), no un atributo disabled', () => {
    const idx = PAGE_TSX.indexOf("(!!permisos?.esAdministradorProcesos || safeString(o.usuario) === sesion.usuario) && (estadoRevision === 'EN_REVISION'");
    const bloque = PAGE_TSX.slice(idx, idx + 700);
    expect(bloque).not.toContain('disabled={!');
  });
});

describe('Confirmar Eliminar — elige el mecanismo correcto según el estado REAL de la fila (caso real SI 013 2026)', () => {
  // Bug real: el handler de confirmación de "Eliminar" llamaba SIEMPRE a
  // `reenviarRevisionAlVaciarObservaciones()` (el endpoint dedicado que exige
  // partir de EN_OBSERVACION) cuando el arreglo quedaba vacío, sin importar
  // si la fila YA estaba en EN_REVISION (p.ej. porque ya se registró una
  // decisión Aceptada/No aceptada) con una observación residual sin vaciar.
  // Eso producía SIEMPRE 409 ("La solicitud no está en observación...") para
  // ese caso — nunca se podía eliminar. Corrección: si la fila ya no está en
  // CON_OBSERVACIONES, se vacía por el PATCH genérico (sin tocar
  // estadoRevision), sin pasar por el endpoint de transición.
  const idxHandler = PAGE_TSX.indexOf('const nuevasObs=obsAcumuladas.filter((_,i)=>i!==idx);');

  it('el handler de Eliminar existe y distingue explícitamente CON_OBSERVACIONES antes de llamar al endpoint de transición', () => {
    expect(idxHandler).toBeGreaterThan(-1);
    const bloque = PAGE_TSX.slice(idxHandler, idxHandler + 1600);
    expect(bloque).toContain("estadoRevision==='CON_OBSERVACIONES'");
    expect(bloque).toContain('await reenviarRevisionAlVaciarObservaciones();');
  });

  it('cuando la fila YA no está en CON_OBSERVACIONES, vacía observaciones por el PATCH genérico (`guardar`) en vez del endpoint de transición', () => {
    const bloque = PAGE_TSX.slice(idxHandler, idxHandler + 1600);
    expect(bloque).toContain('await guardar(estadoRevision,{observaciones:[]});');
  });

  it('el caso "queda al menos una observación" sigue usando el PATCH genérico sin cambios', () => {
    const bloque = PAGE_TSX.slice(idxHandler, idxHandler + 1600);
    expect(bloque).toContain("await guardar('CON_OBSERVACIONES',{tieneObservaciones:true,observaciones:nuevasObs});");
  });
});

describe('Ambos gates reutilizan mecanismos ya existentes — sin permisos paralelos', () => {
  it('`permisos` sigue siendo un prop real de GestionAsignacionInline con `esAdministradorProcesos: boolean` en su firma (backend, calcularPermisosFicha)', () => {
    const firmaIdx = PAGE_TSX.indexOf('permisos?: { esAdministradorProcesos: boolean;');
    expect(firmaIdx).toBeGreaterThan(-1);
  });

  it('`esComercial` sigue siendo el mismo permiso ya usado en otras partes de este componente (`puedeConBD(sesion.rol,\'asignaciones\',\'editar\',sesion.permisosRol)`), no una variable nueva paralela', () => {
    expect(PAGE_TSX).toContain("const esComercial = puedeConBD(sesion.rol, 'asignaciones', 'editar', sesion.permisosRol);");
  });
});
