/**
 * Ajuste "EVIDENCIA VISIBLE PARA TODOS LOS QUE CONSULTAN" — la evidencia de
 * elaboración ya cargada es información de CONSULTA: debe verse/descargarse
 * sin importar si el usuario puede editar/gestionar el proceso (Mercadeo,
 * Comercial no responsable, etc.). Antes, la ÚNICA puerta de entrada al
 * panel completo (`GestionAsignacionInline`, que contiene la evidencia)
 * era el botón gateado por `puedeGestionarFicha` — una variable que mezcla
 * lectura y escritura. Este archivo verifica el cableado fuente (mismo
 * patrón que el resto de *-page.test.ts, sin harness de render en este
 * repo): que la puerta de entrada ahora es de lectura (`puedeVerFicha`) y
 * que la única mutación real que dispara ese botón (INICIAR_ELABORACION)
 * sigue exigiendo `puedeGestionarFicha` explícitamente.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PAGE_TSX = readFileSync(join(__dirname, 'page.tsx'), 'utf-8');

describe('puedeVerFicha — nueva puerta de LECTURA, separada de puedeGestionarFicha', () => {
  it('existe `const puedeVerFicha = true;`', () => {
    expect(PAGE_TSX).toContain('const puedeVerFicha = true;');
  });

  it('el botón de entrada al detalle (stepper + evidencia) usa puedeVerFicha, no puedeGestionarFicha', () => {
    expect(PAGE_TSX).toContain("{cargaResponsablesFicha.tipo!=='loading'&&puedeVerFicha&&!estadoGlobalAmbiguo&&etapaGlobal!=='CIERRE'&&(");
    expect(PAGE_TSX).not.toContain("{cargaResponsablesFicha.tipo!=='loading'&&puedeGestionarFicha&&!estadoGlobalAmbiguo&&etapaGlobal!=='CIERRE'&&(");
  });
});

describe('La mutación real (INICIAR_ELABORACION) sigue exigiendo autorización explícita', () => {
  // Ajuste "ELIMINAR SELECTOR DE RESPONSABLE — COMENZAR ELABORACIÓN" —
  // la condición pasó de `puedeGestionarFicha` (admin funcional en
  // general) a `puedeElaborar` (Admin global O asignación propia,
  // resuelta automáticamente) — más estricta, ver `page.tsx`.
  it('el disparo de la transición está condicionado a puedeElaborar, no solo al estado', () => {
    expect(PAGE_TSX).toContain("if(estadoGlobalCanonico==='APROBADO_ELABORACION'&&puedeElaborar){");
    expect(PAGE_TSX).not.toMatch(/if\(estadoGlobalCanonico==='APROBADO_ELABORACION'\)\{\s*setIniciandoElaboracion/);
  });

  it('la etiqueta del botón distingue "Comenzar elaboración" (con permiso) de "Ver proceso" (solo consulta)', () => {
    expect(PAGE_TSX).toContain("if(estadoGlobalCanonico==='APROBADO_ELABORACION')return puedeElaborar?'Comenzar elaboración':'Ver proceso';");
  });

  it('puedeElaborar = Administrador global O asignación propia — nunca administrador funcional en general', () => {
    expect(PAGE_TSX).toContain('const puedeElaborar = isAdmin(sesion.rol) || !!asignacionPropia;');
  });
});

describe('Evidencia: lectura sin permiso, escritura sin cambios', () => {
  it('la lista/ver/descargar de evidencias sigue sin ningún gate de permiso (solo evidencias.length>0)', () => {
    expect(PAGE_TSX).toContain('{evidencias.length > 0 && (');
  });

  it('subir y eliminar evidencia siguen exigiendo puedeActuar (rol/responsable) — sin ampliar escritura', () => {
    // >=2: botón "Eliminar" + dropzone de carga (una 3ra ocurrencia
    // preexistente gatea "Presentar proceso", ajena a este cambio).
    const ocurrencias = PAGE_TSX.split("puedeActuar && permiteCargarEvidencias(estadoRevision)").length - 1;
    expect(ocurrencias).toBeGreaterThanOrEqual(2);
  });

  it('el mensaje de "proceso presentado — no se pueden agregar más evidencias" sigue sin gate de permiso', () => {
    expect(PAGE_TSX).toContain("{motivoBloqueoEvidencias(estadoRevision) === 'PRESENTADO' && (");
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Ajuste "ELIMINAR SELECTOR DE RESPONSABLE — COMENZAR ELABORACIÓN" — el
// selector ("Elige sobre qué responsable ver/gestionar el detalle") se
// retiró POR COMPLETO de la ficha, en TODOS los estados (supera la
// exclusión previa, que solo lo ocultaba en PRESENTADO/CIERRE). "Ver
// evidencias" en PRESENTADO seguía sin depender de él (invariante
// preexistente, se reconfirma abajo).
// ═══════════════════════════════════════════════════════════════════════
describe('Selector de responsable — eliminado por completo (ya no existe en ningún estado)', () => {
  it('el bloque del selector ya no existe en absoluto (ni siquiera para EN_ELABORACION/APROBADO_ELABORACION)', () => {
    expect(PAGE_TSX).not.toContain("seleccionVisible.requiereSeleccionPrivilegiado&&estadoGlobalCanonico!=='PRESENTADO'");
    expect(PAGE_TSX).not.toContain('Elige sobre qué responsable ver/gestionar el detalle');
  });

  it('"Ver evidencias" en PRESENTADO sigue funcionando directamente, sin elegir responsable (invariante preexistente)', () => {
    expect(PAGE_TSX).toContain("if(estadoGlobalCanonico==='PRESENTADO'&&!idObjetivo){");
  });

  it('el selector fue eliminado — no queda ningún setter de selección manual en esta ficha', () => {
    expect(PAGE_TSX).not.toContain('setIdAsignacionElegidaFicha');
  });
});

describe('Agregación de evidencias de TODAS las filas en PRESENTADO sin idObjetivo (2, 3)', () => {
  it('cuando estadoGlobalCanonico es PRESENTADO y no hay idObjetivo (fila ambigua), agrega evidencias de todas las asignaciones', () => {
    expect(PAGE_TSX).toContain("if(estadoGlobalCanonico==='PRESENTADO'&&!idObjetivo){");
    expect(PAGE_TSX).toContain('const evidenciasAgregadas=filas.flatMap(f=>safeArray<Record<string,unknown>>(getRecordValue(f,\'evidencias\')).map(ev=>({...ev,_origenResponsable:safeString(f.analistaAsignado)})));');
  });

  it('conserva el responsable de origen como dato informativo (_origenResponsable), nunca usado para autorizar', () => {
    expect(PAGE_TSX).toContain('_origenResponsable:safeString(f.analistaAsignado)');
  });
});

describe('Quitar el gate NO otorga permiso de edición (5)', () => {
  it('page.tsx nunca duplica la lógica de permiteCargarEvidencias — sigue importándola de estados-canonicos.ts', () => {
    expect(PAGE_TSX).toContain('permiteCargarEvidencias');
    expect(PAGE_TSX).toContain("from '@/lib/solicitudes/estados-canonicos'");
  });

  it('subir/eliminar evidencia siguen exigiendo puedeActuar Y permiteCargarEvidencias juntos (sin cambios en este ajuste)', () => {
    const ocurrencias = PAGE_TSX.split('puedeActuar && permiteCargarEvidencias(estadoRevision)').length - 1;
    expect(ocurrencias).toBeGreaterThanOrEqual(2);
  });
});

describe('Comercial/Admin — sin regresión (6)', () => {
  it('seleccionVisible sigue calculándose (para observaciones/revisión/rechazo/cierre), ahora siempre con selección null (nunca manual)', () => {
    expect(PAGE_TSX).toContain("const seleccionVisible = React.useMemo(");
    expect(PAGE_TSX).toContain('seleccionarAsignacionVisible(asignaciones, { email: sesion.email || \'\', usuario: sesion.usuario || \'\', rol: sesion.rol }, null)');
  });
});
