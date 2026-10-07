import { describe, it, expect } from 'vitest';
import { seleccionarAsignacionVisible, coincideIdentidad, esRolPrivilegiadoParaAsignacion, esAsignacionValida, obtenerResponsablesActivos } from './seleccion-asignacion';

const OSCAR = { email: 'oscar.pallares@grupocolba.com', usuario: 'oscar.pallares', rol: 'Analista Comercial' };
const NICOLE = { email: 'nicole.ortiz@grupocolba.com', usuario: 'nicole.ortiz', rol: 'Analista Comercial' };
const ADMIN = { email: 'admin1@grupocolba.com', usuario: 'admin1', rol: 'Administrador' };
const DIRECTOR = { email: 'ricardo.mejia@grupocolba.com', usuario: 'ricardo.mejia', rol: 'Director Comercial' };
const COORDINADOR = { email: 'laura.buelvas@grupocolba.com', usuario: 'laura.buelvas', rol: 'Coordinador Comercial' };
const AJENO = { email: 'ajeno@grupocolba.com', usuario: 'ajeno', rol: 'Analista Comercial' };
const MERCADEO = { email: 'ana.rios@grupocolba.com', usuario: 'ana.rios', rol: 'Analista Mercadeo' };

const filaOscar = { idAsignacion: 'ASG-1', analistaAsignado: 'oscar.pallares' };
const filaNicole = { idAsignacion: 'ASG-2', analistaAsignado: 'nicole.ortiz' };
// Caso real reportado: proceso público IMC-2026-092, único responsable
// juan.davila, ASG-01, estado ASIGNADO_REVISION.
const filaJuanDavila = { idAsignacion: 'ASG-01', analistaAsignado: 'juan.davila', estadoRevision: 'ASIGNADO_REVISION', fechaAsignacion: '2026-07-28' };

describe('coincideIdentidad', () => {
  it('coincide por username exacto', () => expect(coincideIdentidad('oscar.pallares', OSCAR)).toBe(true));
  it('coincide por email completo', () => expect(coincideIdentidad('oscar.pallares@grupocolba.com', OSCAR)).toBe(true));
  it('coincide por prefijo de email', () => expect(coincideIdentidad('oscar.pallares', { ...OSCAR, usuario: 'otro' })).toBe(true));
  it('no coincide con un candidato distinto', () => expect(coincideIdentidad('nicole.ortiz', OSCAR)).toBe(false));
  it('no coincide con string vacío', () => expect(coincideIdentidad('', OSCAR)).toBe(false));
});

describe('esRolPrivilegiadoParaAsignacion', () => {
  it('Administrador, Director Comercial y Coordinador Comercial son privilegiados', () => {
    expect(esRolPrivilegiadoParaAsignacion('Administrador')).toBe(true);
    expect(esRolPrivilegiadoParaAsignacion('Director Comercial')).toBe(true);
    expect(esRolPrivilegiadoParaAsignacion('Coordinador Comercial')).toBe(true);
  });
  it('Analista Comercial no es privilegiado', () => expect(esRolPrivilegiadoParaAsignacion('Analista Comercial')).toBe(false));
});

describe('seleccionarAsignacionVisible', () => {
  it('responsable normal → su propia fila, sin importar la posición (primero)', () => {
    const r = seleccionarAsignacionVisible([filaOscar, filaNicole], OSCAR, null);
    expect(r.asigActual).toEqual(filaOscar);
    expect(r.consultandoComoPrivilegiado).toBe(false);
    expect(r.requiereSeleccionPrivilegiado).toBe(false);
  });

  it('responsable normal → su propia fila, sin importar la posición (segundo/último)', () => {
    const r = seleccionarAsignacionVisible([filaOscar, filaNicole], NICOLE, null);
    expect(r.asigActual).toEqual(filaNicole);
  });

  it('administrador CON fila propia → su propia fila, igual que cualquier responsable (no entra al modo privilegiado)', () => {
    const filaAdmin = { idAsignacion: 'ASG-3', analistaAsignado: 'admin1' };
    const r = seleccionarAsignacionVisible([filaOscar, filaAdmin], ADMIN, null);
    expect(r.asigActual).toEqual(filaAdmin);
    expect(r.consultandoComoPrivilegiado).toBe(false);
  });

  it('administrador SIN fila propia y SIN elección aún → asigActual=null, requiere selección explícita (nunca cae a la última fila)', () => {
    const r = seleccionarAsignacionVisible([filaOscar, filaNicole], ADMIN, null);
    expect(r.asigActual).toBeNull();
    expect(r.requiereSeleccionPrivilegiado).toBe(true);
    expect(r.consultandoComoPrivilegiado).toBe(false);
  });

  it('administrador SIN fila propia CON elección explícita → esa fila, marcado como "consultando como privilegiado"', () => {
    const r = seleccionarAsignacionVisible([filaOscar, filaNicole], ADMIN, 'ASG-2');
    expect(r.asigActual).toEqual(filaNicole);
    expect(r.consultandoComoPrivilegiado).toBe(true);
    expect(r.requiereSeleccionPrivilegiado).toBe(false);
  });

  it('coordinador SIN fila propia se comporta igual que administrador (selector explícito, nunca fila por defecto)', () => {
    const sinEleccion = seleccionarAsignacionVisible([filaOscar, filaNicole], COORDINADOR, null);
    expect(sinEleccion.asigActual).toBeNull();
    expect(sinEleccion.requiereSeleccionPrivilegiado).toBe(true);

    const conEleccion = seleccionarAsignacionVisible([filaOscar, filaNicole], COORDINADOR, 'ASG-1');
    expect(conEleccion.asigActual).toEqual(filaOscar);
    expect(conEleccion.consultandoComoPrivilegiado).toBe(true);
  });

  it('usuario NO asignado y NO privilegiado → ninguna fila accionable, sin selector', () => {
    const r = seleccionarAsignacionVisible([filaOscar, filaNicole], AJENO, null);
    expect(r.asigActual).toBeNull();
    expect(r.requiereSeleccionPrivilegiado).toBe(false); // no es privilegiado, no ve selector
    expect(r.consultandoComoPrivilegiado).toBe(false);
  });

  it('un responsable normal NUNCA puede usar idAsignacionElegida para "verse como" otra fila', () => {
    // Aunque Oscar tiene fila propia, si de algún modo llegara una
    // idAsignacionElegida apuntando a la fila de Nicole, debe ignorarse —
    // la selección administrativa solo aplica cuando no hay fila propia.
    const r = seleccionarAsignacionVisible([filaOscar, filaNicole], OSCAR, 'ASG-2');
    expect(r.asigActual).toEqual(filaOscar);
    expect(r.consultandoComoPrivilegiado).toBe(false);
  });

  it('sin asignaciones en absoluto → asigActual=null, sin selector (nada que elegir)', () => {
    const r = seleccionarAsignacionVisible([], ADMIN, null);
    expect(r.asigActual).toBeNull();
    expect(r.requiereSeleccionPrivilegiado).toBe(false);
  });

  it('idAsignacionElegida apunta a un id que ya no existe en el arreglo actual → no selecciona nada, sigue pidiendo elección', () => {
    const r = seleccionarAsignacionVisible([filaOscar, filaNicole], ADMIN, 'ASG-999-NO-EXISTE');
    expect(r.asignacionSeleccionadaPrivilegiado).toBeNull();
    expect(r.asigActual).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Ajuste "La implementación presenta un error visible después del cambio
// de administradores funcionales de Procesos" — caso real IMC-2026-092:
// una única asignación válida (juan.davila, ASG-01) mostraba el selector
// de "varios responsables" y dejaba el panel vacío. Causa raíz: la
// condición `requiereSeleccionPrivilegiado` comparaba
// `asignaciones.length > 0` en vez de `> 1` — CUALQUIER cantidad positiva
// de filas (incluida una sola) activaba el selector para un privilegiado
// sin fila propia, y no existía autoselección para el caso de una sola
// fila válida.
// ═══════════════════════════════════════════════════════════════════════

describe('esAsignacionValida', () => {
  it('fila con idAsignacion y analistaAsignado no vacíos: válida', () => {
    expect(esAsignacionValida(filaJuanDavila)).toBe(true);
  });
  it('fila sin idAsignacion: inválida', () => {
    expect(esAsignacionValida({ analistaAsignado: 'juan.davila' })).toBe(false);
  });
  it('fila sin analistaAsignado: inválida', () => {
    expect(esAsignacionValida({ idAsignacion: 'ASG-01' })).toBe(false);
  });
  it('fila con strings vacíos/solo espacios: inválida', () => {
    expect(esAsignacionValida({ idAsignacion: '  ', analistaAsignado: '' })).toBe(false);
  });
});

describe('Caso real IMC-2026-092 — Administrador/Director/Coordinador funcional + UNA sola asignación válida', () => {
  it('1) Administrador funcional + cero asignaciones: sin selector, responsable vacío', () => {
    const r = seleccionarAsignacionVisible([], ADMIN, null);
    expect(r.requiereSeleccionPrivilegiado).toBe(false);
    expect(r.asigActual).toBeNull();
    expect(r.asignacionesValidas).toEqual([]);
  });

  it('2) Administrador funcional + una asignación: AUTOSELECCIONADA, sin selector, responsable visible', () => {
    const r = seleccionarAsignacionVisible([filaJuanDavila], ADMIN, null);
    expect(r.requiereSeleccionPrivilegiado).toBe(false);
    expect(r.asigActual).toEqual(filaJuanDavila);
    expect(r.asigActual?.analistaAsignado).toBe('juan.davila');
    expect(r.consultandoComoPrivilegiado).toBe(true); // no es su propia fila, pero se muestra igual
  });

  it('2b) Director Comercial + una asignación: autoseleccionada, igual que Administrador', () => {
    const r = seleccionarAsignacionVisible([filaJuanDavila], DIRECTOR, null);
    expect(r.requiereSeleccionPrivilegiado).toBe(false);
    expect(r.asigActual).toEqual(filaJuanDavila);
  });

  it('2c) Coordinador Comercial + una asignación: autoseleccionada, igual que Administrador', () => {
    const r = seleccionarAsignacionVisible([filaJuanDavila], COORDINADOR, null);
    expect(r.requiereSeleccionPrivilegiado).toBe(false);
    expect(r.asigActual).toEqual(filaJuanDavila);
  });

  it('3) Administrador funcional + dos asignaciones: selector visible, ninguna elegida inicialmente; al elegir, se actualiza', () => {
    const sinEleccion = seleccionarAsignacionVisible([filaOscar, filaNicole], ADMIN, null);
    expect(sinEleccion.requiereSeleccionPrivilegiado).toBe(true);
    expect(sinEleccion.asigActual).toBeNull();

    const conEleccion = seleccionarAsignacionVisible([filaOscar, filaNicole], ADMIN, 'ASG-2');
    expect(conEleccion.requiereSeleccionPrivilegiado).toBe(false);
    expect(conEleccion.asigActual).toEqual(filaNicole);
  });

  it('4) responsable normal + su única asignación: abre la propia directamente, sin selector', () => {
    const r = seleccionarAsignacionVisible([filaJuanDavila], { email: 'juan.davila@grupocolba.com', usuario: 'juan.davila', rol: 'Analista Comercial' }, null);
    expect(r.requiereSeleccionPrivilegiado).toBe(false);
    expect(r.asigActual).toEqual(filaJuanDavila);
    expect(r.consultandoComoPrivilegiado).toBe(false); // es su propia fila, no "consultando como privilegiado"
  });

  it('5) una asignación válida + una fila vacía: se cuenta como UNA sola asignación, nunca "varios responsables"', () => {
    const filaVacia = { idAsignacion: '', analistaAsignado: '' };
    const r = seleccionarAsignacionVisible([filaJuanDavila, filaVacia], ADMIN, null);
    expect(r.asignacionesValidas.length).toBe(1);
    expect(r.requiereSeleccionPrivilegiado).toBe(false);
    expect(r.asigActual).toEqual(filaJuanDavila);
  });

  it('6) arreglo con duplicados del mismo idAsignacion: se deduplica, nunca se cuenta dos veces', () => {
    const duplicada = { ...filaJuanDavila };
    const r = seleccionarAsignacionVisible([filaJuanDavila, duplicada], ADMIN, null);
    expect(r.asignacionesValidas.length).toBe(1); // deduplicado por idAsignacion, conserva la primera aparición
    expect(r.requiereSeleccionPrivilegiado).toBe(false);
    expect(r.asigActual).toEqual(filaJuanDavila);
  });
});
describe('obtenerResponsablesActivos — eliminación del selector operativo', () => {
  it('cuenta solo filas válidas y activas, deduplicadas', () => {
    const asigs = [
      { idAsignacion: 'ASG-1', analistaAsignado: 'juan.davila' },
      { idAsignacion: 'ASG-2', analistaAsignado: 'laura.buelvas' },
    ];
    expect(obtenerResponsablesActivos(asigs).length).toBe(2);
  });
  it('filas legadas sin campo `activo` cuentan como activas (compatibilidad histórica)', () => {
    const asigs = [{ idAsignacion: 'ASG-1', analistaAsignado: 'juan.davila' }];
    expect(obtenerResponsablesActivos(asigs).length).toBe(1);
  });
  it('excluye filas marcadas activo:false', () => {
    const asigs = [
      { idAsignacion: 'ASG-1', analistaAsignado: 'juan.davila', activo: false },
      { idAsignacion: 'ASG-2', analistaAsignado: 'laura.buelvas' },
    ];
    expect(obtenerResponsablesActivos(asigs).length).toBe(1);
    expect(obtenerResponsablesActivos(asigs)[0].analistaAsignado).toBe('laura.buelvas');
  });
  it('excluye filas inválidas (sin idAsignacion/analistaAsignado) y vacías', () => {
    const asigs = [
      { idAsignacion: '', analistaAsignado: '' },
      { idAsignacion: 'ASG-1', analistaAsignado: 'juan.davila' },
    ];
    expect(obtenerResponsablesActivos(asigs).length).toBe(1);
  });
  it('deduplica idAsignacion repetido (duplicado exacto) — nunca cuenta dos veces', () => {
    const asigs = [
      { idAsignacion: 'ASG-02', analistaAsignado: 'laura.buelvas' },
      { idAsignacion: 'ASG-02', analistaAsignado: 'laura.buelvas' },
    ];
    expect(obtenerResponsablesActivos(asigs).length).toBe(1);
  });
  it('arreglo vacío → 0', () => {
    expect(obtenerResponsablesActivos([]).length).toBe(0);
  });

  // Ajuste "deduplicación correcta" — identidad por usuario normalizado,
  // NUNCA por idAsignacion (idAsignacion es solo dato auxiliar).
  it('mismo usuario con dos idAsignacion DIFERENTES → cuenta como UN responsable', () => {
    const asigs = [
      { idAsignacion: 'ASG-01', analistaAsignado: 'laura.buelvas' },
      { idAsignacion: 'ASG-07', analistaAsignado: 'laura.buelvas' },
    ];
    expect(obtenerResponsablesActivos(asigs).length).toBe(1);
  });
  it('dos usuarios DISTINTOS con el mismo idAsignacion (colisión) → NUNCA se fusionan, ambos cuentan', () => {
    const asigs = [
      { idAsignacion: 'ASG-mrau89g9fuel', analistaAsignado: 'juan.davila' },
      { idAsignacion: 'ASG-mrau89g9fuel', analistaAsignado: 'laura.buelvas' },
    ];
    const resultado = obtenerResponsablesActivos(asigs);
    expect(resultado.length).toBe(2);
    expect(resultado.map(a => a.analistaAsignado).sort()).toEqual(['juan.davila', 'laura.buelvas']);
  });
  it('diferencias solo de mayúsculas y espacios → mismo usuario, cuenta una sola vez', () => {
    const asigs = [
      { idAsignacion: 'ASG-1', analistaAsignado: '  Juan.Davila  ' },
      { idAsignacion: 'ASG-2', analistaAsignado: 'juan.davila' },
    ];
    expect(obtenerResponsablesActivos(asigs).length).toBe(1);
  });
  it('usuario retirado (activo:false) + otra fila activa del MISMO usuario → cuenta la activa, una sola vez', () => {
    const asigs = [
      { idAsignacion: 'ASG-1', analistaAsignado: 'laura.buelvas', activo: false },
      { idAsignacion: 'ASG-2', analistaAsignado: 'laura.buelvas' },
    ];
    const resultado = obtenerResponsablesActivos(asigs);
    expect(resultado.length).toBe(1);
    expect(resultado[0].idAsignacion).toBe('ASG-2');
  });
  it('dos filas activas IDÉNTICAS → cuenta una sola vez', () => {
    const asigs = [
      { idAsignacion: 'ASG-02', analistaAsignado: 'laura.buelvas', analistaCargo: 'Coordinador Comercial' },
      { idAsignacion: 'ASG-02', analistaAsignado: 'laura.buelvas', analistaCargo: 'Coordinador Comercial' },
    ];
    expect(obtenerResponsablesActivos(asigs).length).toBe(1);
  });

  // Ajuste "orden determinístico" — el mismo conjunto de responsables
  // produce EXACTAMENTE la misma lista y el mismo orden sin importar el
  // orden de entrada (nunca depende de la posición en asignaciones[]).
  it('[Laura, Juan] y [Juan, Laura] producen exactamente la misma lista y el mismo orden', () => {
    const laura = { idAsignacion: 'ASG-1', analistaAsignado: 'laura.buelvas', analistaCargo: 'Coordinador Comercial' };
    const juan = { idAsignacion: 'ASG-2', analistaAsignado: 'juan.davila', analistaCargo: 'Analista Comercial' };
    const ordenA = obtenerResponsablesActivos([laura, juan]);
    const ordenB = obtenerResponsablesActivos([juan, laura]);
    expect(ordenA.map(a => a.analistaAsignado)).toEqual(ordenB.map(a => a.analistaAsignado));
    expect(JSON.stringify(ordenA)).toBe(JSON.stringify(ordenB));
    // orden alfabético por usuario normalizado: juan.davila antes que laura.buelvas
    expect(ordenA.map(a => a.analistaAsignado)).toEqual(['juan.davila', 'laura.buelvas']);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Ajuste "CIERRE DE PRIVADOS PARA MERCADEO — FILA AJENA" — Mercadeo sin
// fila propia necesita poder seleccionar la fila PRESENTADA existente para
// materializar un cierre ya autorizado por `puedeCerrarSolicitud`
// (backend). A diferencia de Admin/Director/Coordinador (privilegiados
// generales, cualquier fila válida), el universo de Mercadeo se restringe
// SIEMPRE a filas con `estadoRevision==='PRESENTADO'` — nunca una fila
// histórica/inactiva. Mercadeo NO es `esRolPrivilegiadoParaAsignacion`
// (verificado abajo) — sigue sin ser "administrador funcional de Procesos".
// ═══════════════════════════════════════════════════════════════════════

const filaPresentadaJuan = { idAsignacion: 'ASG-10', analistaAsignado: 'juan.davila', estadoRevision: 'PRESENTADO' };
const filaPresentadaLaura = { idAsignacion: 'ASG-11', analistaAsignado: 'laura.buelvas', estadoRevision: 'PRESENTADO' };
const filaHistoricaJuan = { idAsignacion: 'ASG-12', analistaAsignado: 'juan.davila', estadoRevision: 'CERRADO_ADJUDICADO' };
const filaEnElaboracion = { idAsignacion: 'ASG-13', analistaAsignado: 'oscar.pallares', estadoRevision: 'EN_ELABORACION' };

describe('seleccionarAsignacionVisible — Mercadeo (cierre de Privados sobre fila ajena)', () => {
  it('Mercadeo no es un rol privilegiado general (esRolPrivilegiadoParaAsignacion sigue sin incluirlo)', () => {
    expect(esRolPrivilegiadoParaAsignacion('Analista Mercadeo')).toBe(false);
    expect(esRolPrivilegiadoParaAsignacion('Asistente Mercadeo')).toBe(false);
  });

  it('Mercadeo sin fila propia + UNA fila PRESENTADA: se autoselecciona, con idAsignacion real', () => {
    const r = seleccionarAsignacionVisible([filaPresentadaJuan], MERCADEO, null);
    expect(r.asigActual).toEqual(filaPresentadaJuan);
    expect(r.asigActual?.idAsignacion).toBe('ASG-10');
    expect(r.requiereSeleccionPrivilegiado).toBe(false);
    expect(r.consultandoComoPrivilegiado).toBe(true);
  });

  it('Mercadeo sin fila propia + VARIAS filas PRESENTADAS: no elige arbitrariamente, requiere selección explícita', () => {
    const sinEleccion = seleccionarAsignacionVisible([filaPresentadaJuan, filaPresentadaLaura], MERCADEO, null);
    expect(sinEleccion.asigActual).toBeNull();
    expect(sinEleccion.requiereSeleccionPrivilegiado).toBe(true);

    const conEleccion = seleccionarAsignacionVisible([filaPresentadaJuan, filaPresentadaLaura], MERCADEO, 'ASG-11');
    expect(conEleccion.asigActual).toEqual(filaPresentadaLaura);
    expect(conEleccion.requiereSeleccionPrivilegiado).toBe(false);
    expect(conEleccion.consultandoComoPrivilegiado).toBe(true);
  });

  it('Mercadeo sin fila propia + NINGUNA fila PRESENTADA (solo históricas/en curso): asigActual=null, sin selector — nunca produce idAsignacion vacío junto a datos', () => {
    const r = seleccionarAsignacionVisible([filaHistoricaJuan, filaEnElaboracion], MERCADEO, null);
    expect(r.asigActual).toBeNull();
    expect(r.requiereSeleccionPrivilegiado).toBe(false);
    expect(r.consultandoComoPrivilegiado).toBe(false);
  });

  it('Mercadeo: una fila histórica/inactiva del MISMO usuario que también tiene una PRESENTADA → solo la PRESENTADA es candidata', () => {
    const r = seleccionarAsignacionVisible([filaHistoricaJuan, filaPresentadaJuan], MERCADEO, null);
    expect(r.asigActual).toEqual(filaPresentadaJuan);
  });

  it('Mercadeo CON fila propia (caso raro/futuro): usa su propia fila, igual que cualquier responsable — no entra al camino de fila ajena', () => {
    const filaMercadeoPropia = { idAsignacion: 'ASG-14', analistaAsignado: 'ana.rios', estadoRevision: 'EN_REVISION' };
    const r = seleccionarAsignacionVisible([filaMercadeoPropia, filaPresentadaJuan], MERCADEO, null);
    expect(r.asigActual).toEqual(filaMercadeoPropia);
    expect(r.consultandoComoPrivilegiado).toBe(false);
  });

  it('sin ninguna asignación en absoluto: Mercadeo se comporta igual que Admin (asigActual=null, sin selector)', () => {
    const r = seleccionarAsignacionVisible([], MERCADEO, null);
    expect(r.asigActual).toBeNull();
    expect(r.requiereSeleccionPrivilegiado).toBe(false);
  });

  it('Comercial (no privilegiado, no Mercadeo) sigue sin poder ver la fila ajena PRESENTADA — comportamiento sin cambios', () => {
    const r = seleccionarAsignacionVisible([filaPresentadaJuan], AJENO, null);
    expect(r.asigActual).toBeNull();
    expect(r.requiereSeleccionPrivilegiado).toBe(false);
  });

  it('Admin/Director/Coordinador con UNA fila PRESENTADA: comportamiento sin cambios (autoselección general, no pasa por el filtro de Mercadeo)', () => {
    const rAdmin = seleccionarAsignacionVisible([filaPresentadaJuan], ADMIN, null);
    expect(rAdmin.asigActual).toEqual(filaPresentadaJuan);
    // A diferencia de Mercadeo, Admin SÍ puede autoseleccionar una fila NO
    // presentada (ej. en elaboración) — su universo nunca se restringe.
    const rAdminNoPresentada = seleccionarAsignacionVisible([filaEnElaboracion], ADMIN, null);
    expect(rAdminNoPresentada.asigActual).toEqual(filaEnElaboracion);
  });
});
