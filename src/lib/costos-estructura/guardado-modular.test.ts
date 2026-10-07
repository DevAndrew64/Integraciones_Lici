import { describe, expect, it } from 'vitest';
import {
  crearModuloVacio, esEstructuraModular, fusionarModulo, obtenerModulo,
  adaptarHistoricoAManoObra, resolverModuloManoObraParaRestaurar,
  resolverEstadoResultadoGeneral, resolverPendientesModulos, esEstadoModuloResultadoValido,
  CLAVES_MODULO, CLAVES_MODULO_NO_APLICA, moduloTieneDatosValidos,
  type EstadoModuloResultado, type ClaveModulo,
} from './guardado-modular';

describe('crearModuloVacio', () => {
  it('produce NO_INICIADO con los datos vacíos provistos', () => {
    const m = crearModuloVacio({ x: 1 });
    expect(m.estado).toBe('NO_INICIADO');
    expect(m.datos).toEqual({ x: 1 });
    expect(m.actualizadoPor).toBeNull();
  });
});

describe('esEstructuraModular', () => {
  it('true para version:2 con modulos', () => {
    expect(esEstructuraModular({ version: 2, modulos: {} })).toBe(true);
  });
  it('false para estructura plana histórica (sin version/modulos)', () => {
    expect(esEstructuraModular({ lineasExtra: [], cargo: 'x' })).toBe(false);
  });
  it('false para null/undefined/primitivos', () => {
    expect(esEstructuraModular(null)).toBe(false);
    expect(esEstructuraModular(undefined)).toBe(false);
    expect(esEstructuraModular('x')).toBe(false);
  });
});

describe('fusionarModulo — actualización parcial segura (§4, pruebas #9/#10/#11)', () => {
  it('9) guardar manoObra conserva otros módulos ya presentes', () => {
    const existente = {
      version: 2 as const,
      modulos: {
        dotacionEpp: { estado: 'COMPLETADO' as const, datos: { grupos: ['a'] }, ultimaActualizacion: 't1', actualizadoPor: 'ana' },
        examenesMedicos: { estado: 'EN_PROGRESO' as const, datos: { filas: [1, 2] }, ultimaActualizacion: 't2', actualizadoPor: 'ana' },
      },
    };
    const nuevoManoObra = { estado: 'EN_PROGRESO' as const, datos: { lineasExtra: [{ id: 1 }] }, ultimaActualizacion: 't3', actualizadoPor: 'ana' };
    const resultado = fusionarModulo(existente, 'manoObra', nuevoManoObra);
    expect(resultado.modulos.dotacionEpp).toEqual(existente.modulos.dotacionEpp);
    expect(resultado.modulos.examenesMedicos).toEqual(existente.modulos.examenesMedicos);
    expect(resultado.modulos.manoObra).toEqual(nuevoManoObra);
  });

  it('10) guardar Dotación previamente registrada no se pierde al guardar Mano de Obra dos veces seguidas', () => {
    let datos: unknown = { version: 2, modulos: { dotacionEpp: { estado: 'COMPLETADO', datos: { g: 1 }, ultimaActualizacion: 't0', actualizadoPor: 'x' } } };
    datos = fusionarModulo(datos, 'manoObra', { estado: 'EN_PROGRESO', datos: { a: 1 }, ultimaActualizacion: 't1', actualizadoPor: 'x' });
    datos = fusionarModulo(datos, 'manoObra', { estado: 'COMPLETADO', datos: { a: 2 }, ultimaActualizacion: 't2', actualizadoPor: 'x' });
    expect(obtenerModulo(datos, 'dotacionEpp')?.datos).toEqual({ g: 1 });
  });

  it('11) guardar Exámenes previamente registrados no se pierde al fusionar otro módulo', () => {
    const existente = { version: 2 as const, modulos: { examenesMedicos: { estado: 'COMPLETADO' as const, datos: { e: 9 }, ultimaActualizacion: 't', actualizadoPor: 'x' } } };
    const resultado = fusionarModulo(existente, 'turnantes', { estado: 'EN_PROGRESO', datos: {}, ultimaActualizacion: 't2', actualizadoPor: 'x' });
    expect(obtenerModulo(resultado, 'examenesMedicos')?.datos).toEqual({ e: 9 });
  });

  it('nunca ejecuta "datos = nuevaSeccion" — preserva propiedades de nivel raíz desconocidas', () => {
    const existente = { version: 2 as const, modulos: {}, campoExtra: 'no debe perderse' };
    const resultado = fusionarModulo(existente, 'manoObra', { estado: 'EN_PROGRESO', datos: {}, ultimaActualizacion: 't', actualizadoPor: null }) as unknown as Record<string, unknown>;
    expect(resultado.campoExtra).toBe('no debe perderse');
  });

  it('cuando datosExistentes no es una estructura modular, arranca desde version:2 con modulos vacío (sin lanzar)', () => {
    const resultado = fusionarModulo(undefined, 'manoObra', { estado: 'NO_INICIADO', datos: {}, ultimaActualizacion: '', actualizadoPor: null });
    expect(resultado.version).toBe(2);
    expect(Object.keys(resultado.modulos)).toEqual(['manoObra']);
  });
});

describe('obtenerModulo', () => {
  it('retorna null si el módulo no existe todavía', () => {
    expect(obtenerModulo({ version: 2, modulos: {} }, 'manoObra')).toBeNull();
  });
  it('retorna null si datos no es estructura modular', () => {
    expect(obtenerModulo({ lineasExtra: [] }, 'manoObra')).toBeNull();
  });
});

describe('adaptarHistoricoAManoObra — compatibilidad histórica (§7, pruebas #17/#18)', () => {
  it('17) un JSON histórico plano se adapta en memoria como módulo manoObra EN_PROGRESO', () => {
    const historico = { cargo: 'ASEADOR', lineasExtra: [{ id: 1 }], nTrab: '3' };
    const adaptado = adaptarHistoricoAManoObra(historico);
    expect(adaptado).not.toBeNull();
    expect(adaptado!.estado).toBe('EN_PROGRESO');
    expect(adaptado!.datos).toEqual(historico);
  });

  it('18) adaptar en memoria no modifica el objeto original (no muta, no hay escritura hasta que el usuario guarde)', () => {
    const historico = { cargo: 'ASEADOR' };
    const copia = JSON.stringify(historico);
    adaptarHistoricoAManoObra(historico);
    expect(JSON.stringify(historico)).toBe(copia);
  });

  it('retorna null si ya es una estructura modular v2 (no la reprocesa como histórica)', () => {
    expect(adaptarHistoricoAManoObra({ version: 2, modulos: {} })).toBeNull();
  });

  it('retorna null para null/primitivos', () => {
    expect(adaptarHistoricoAManoObra(null)).toBeNull();
    expect(adaptarHistoricoAManoObra('texto')).toBeNull();
  });
});

describe('resolverModuloManoObraParaRestaurar — único punto de lectura (§7)', () => {
  it('prioriza modulos.manoObra cuando ya es v2', () => {
    const datos = { version: 2 as const, modulos: { manoObra: { estado: 'COMPLETADO' as const, datos: { x: 1 }, ultimaActualizacion: 't', actualizadoPor: 'ana' } } };
    const resuelto = resolverModuloManoObraParaRestaurar(datos);
    expect(resuelto?.estado).toBe('COMPLETADO');
    expect(resuelto?.actualizadoPor).toBe('ana');
  });

  it('cae a adaptación histórica cuando no hay modulos', () => {
    const resuelto = resolverModuloManoObraParaRestaurar({ cargo: 'X', lineasExtra: [] });
    expect(resuelto?.estado).toBe('EN_PROGRESO');
    expect(resuelto?.datos).toEqual({ cargo: 'X', lineasExtra: [] });
  });

  it('retorna null cuando no hay nada que restaurar', () => {
    expect(resolverModuloManoObraParaRestaurar(null)).toBeNull();
  });
});

describe('Ajuste "NO_APLICA EN 4 MÓDULOS" — cada uno de dotacionEpp/examenesMedicos/insumos/maquinariaEquipos debe quedar EXPLÍCITAMENTE definido (COMPLETADO o NO_APLICA), nunca simplemente "sin diligenciar"', () => {
  it('esEstadoModuloResultadoValido acepta los 4 estados reales y rechaza cualquier valor arbitrario (backend nunca confía solo en un cast)', () => {
    expect(esEstadoModuloResultadoValido('NO_INICIADO')).toBe(true);
    expect(esEstadoModuloResultadoValido('EN_PROGRESO')).toBe(true);
    expect(esEstadoModuloResultadoValido('COMPLETADO')).toBe(true);
    expect(esEstadoModuloResultadoValido('NO_APLICA')).toBe(true);
    expect(esEstadoModuloResultadoValido('CUALQUIER_COSA')).toBe(false);
    expect(esEstadoModuloResultadoValido('')).toBe(false);
    expect(esEstadoModuloResultadoValido(null)).toBe(false);
    expect(esEstadoModuloResultadoValido(undefined)).toBe(false);
    expect(esEstadoModuloResultadoValido(123)).toBe(false);
  });

  // Escenario 1 — sin registros, sin NO_APLICA → PENDIENTE.
  it('escenario 1: módulo NO_INICIADO (sin registros, sin decisión) queda PENDIENTE, nunca resuelto', () => {
    const r = resolverPendientesModulos({ dotacionEpp: 'NO_INICIADO' }, CLAVES_MODULO_NO_APLICA);
    expect(r.completo).toBe(false);
    expect(r.pendientes).toContain('dotacionEpp');
  });

  // Escenario 2 — sin registros, NO_APLICA explícito → RESUELTO.
  it('escenario 2: módulo vacío marcado NO_APLICA explícitamente cuenta como RESUELTO', () => {
    const r = resolverPendientesModulos({ dotacionEpp: 'NO_APLICA' }, CLAVES_MODULO_NO_APLICA);
    expect(r.pendientes).not.toContain('dotacionEpp');
  });

  // Escenario 3 — con registros válidos, COMPLETADO → RESUELTO.
  it('escenario 3: módulo COMPLETADO (con registros válidos) cuenta como RESUELTO', () => {
    const r = resolverPendientesModulos({ examenesMedicos: 'COMPLETADO' }, CLAVES_MODULO_NO_APLICA);
    expect(r.pendientes).not.toContain('examenesMedicos');
  });

  // Escenario 4 — registros parciales, EN_PROGRESO → PENDIENTE.
  it('escenario 4: módulo EN_PROGRESO (registros parciales, sin decisión final) queda PENDIENTE', () => {
    const r = resolverPendientesModulos({ insumos: 'EN_PROGRESO' }, CLAVES_MODULO_NO_APLICA);
    expect(r.completo).toBe(false);
    expect(r.pendientes).toContain('insumos');
  });

  it('estado AUSENTE del mapa (nunca guardado) queda PENDIENTE — nunca se asume NO_APLICA ni COMPLETADO por omisión', () => {
    const r = resolverPendientesModulos({}, CLAVES_MODULO_NO_APLICA);
    expect(r.completo).toBe(false);
    expect(r.pendientes).toEqual(['dotacionEpp', 'examenesMedicos', 'insumos', 'maquinariaEquipos']);
  });

  // Escenario 5 — los 4 resueltos (mezcla COMPLETADO/NO_APLICA) → completo=true, pendientes=[].
  it('escenario 5: los 4 módulos en COMPLETADO/NO_APLICA (cualquier combinación) → completo=true, pendientes=[]', () => {
    const r = resolverPendientesModulos({
      dotacionEpp: 'COMPLETADO', examenesMedicos: 'NO_APLICA', insumos: 'COMPLETADO', maquinariaEquipos: 'NO_APLICA',
    }, CLAVES_MODULO_NO_APLICA);
    expect(r.completo).toBe(true);
    expect(r.pendientes).toEqual([]);
  });

  // Escenario 6 — uno pendiente (NO_INICIADO) → completo=false, pendientes=[insumos].
  it('escenario 6: exactamente el caso pedido — dotacionEpp=COMPLETADO, examenesMedicos=NO_APLICA, insumos=NO_INICIADO, maquinariaEquipos=COMPLETADO → completo=false, pendientes=["insumos"]', () => {
    const r = resolverPendientesModulos({
      dotacionEpp: 'COMPLETADO', examenesMedicos: 'NO_APLICA', insumos: 'NO_INICIADO', maquinariaEquipos: 'COMPLETADO',
    }, CLAVES_MODULO_NO_APLICA);
    expect(r.completo).toBe(false);
    expect(r.pendientes).toEqual(['insumos']);
  });

  // Escenario 7 — un módulo vacío NUNCA se convierte automáticamente en
  // NO_APLICA: la función es puramente declarativa (lee el estado que se
  // le pasa, nunca infiere nada a partir de "cantidad de registros"); la
  // prueba de que NO existe esa inferencia automática es que un mapa sin
  // decisión explícita (ausente/NO_INICIADO/EN_PROGRESO) SIEMPRE queda
  // pendiente, nunca resuelto por default.
  it('escenario 7: un módulo sin decisión explícita (ausente, NO_INICIADO o EN_PROGRESO) NUNCA se interpreta automáticamente como NO_APLICA', () => {
    for (const estado of [undefined, 'NO_INICIADO', 'EN_PROGRESO'] as (EstadoModuloResultado | undefined)[]) {
      const r = resolverPendientesModulos({ maquinariaEquipos: estado }, CLAVES_MODULO_NO_APLICA);
      expect(r.pendientes).toContain('maquinariaEquipos');
    }
  });

  it('Mano de Obra/Turnantes/Costos Administrativos NUNCA participan de esta regla — CLAVES_MODULO_NO_APLICA es exactamente el subconjunto de 4, nunca las 7', () => {
    expect(CLAVES_MODULO_NO_APLICA).toEqual(['dotacionEpp', 'examenesMedicos', 'insumos', 'maquinariaEquipos']);
    expect(CLAVES_MODULO_NO_APLICA).not.toContain('manoObra');
    expect(CLAVES_MODULO_NO_APLICA).not.toContain('turnantes');
    expect(CLAVES_MODULO_NO_APLICA).not.toContain('costosAdministrativos');
  });

  it('Mano de Obra/Turnantes/Costos Administrativos COMPLETADO por sí solos NUNCA hacen completo=true sobre CLAVES_MODULO_NO_APLICA (no interfieren con la regla de los 4)', () => {
    const r = resolverPendientesModulos({
      manoObra: 'COMPLETADO', turnantes: 'COMPLETADO', costosAdministrativos: 'COMPLETADO',
      // los 4 controlados siguen sin definir:
    }, CLAVES_MODULO_NO_APLICA);
    expect(r.completo).toBe(false);
    expect(r.pendientes).toEqual(['dotacionEpp', 'examenesMedicos', 'insumos', 'maquinariaEquipos']);
  });

  it('resolverEstadoResultadoGeneral sin clavesAEvaluar sigue evaluando las 7 claves de CLAVES_MODULO (comportamiento histórico intacto, nunca roto por este ajuste)', () => {
    const soloManoObraCompletado: Partial<Record<ClaveModulo, EstadoModuloResultado>> = { manoObra: 'COMPLETADO' };
    expect(resolverEstadoResultadoGeneral(soloManoObraCompletado)).toBe('PROVISIONAL');
    const todasLas7: Partial<Record<ClaveModulo, EstadoModuloResultado>> = Object.fromEntries(CLAVES_MODULO.map(c => [c, 'COMPLETADO' as const]));
    expect(resolverEstadoResultadoGeneral(todasLas7)).toBe('FINAL');
  });

  it('resolverEstadoResultadoGeneral con clavesAEvaluar=CLAVES_MODULO_NO_APLICA da el mismo resultado ("FINAL"/"PROVISIONAL") que resolverPendientesModulos.completo — misma regla, nunca dos implementaciones distintas', () => {
    const estados: Partial<Record<ClaveModulo, EstadoModuloResultado>> = {
      dotacionEpp: 'COMPLETADO', examenesMedicos: 'NO_APLICA', insumos: 'NO_INICIADO', maquinariaEquipos: 'COMPLETADO',
    };
    expect(resolverEstadoResultadoGeneral(estados, CLAVES_MODULO_NO_APLICA)).toBe('PROVISIONAL');
    expect(resolverPendientesModulos(estados, CLAVES_MODULO_NO_APLICA).completo).toBe(false);
  });

  // Escenario 8 y 9 — conservación de datos: `resolverPendientesModulos`/
  // `resolverEstadoResultadoGeneral` son PURAMENTE de lectura de `estado`
  // (nunca tocan `datos`) — la garantía real de "marcar NO_APLICA
  // conserva los datos" y "volver a EN_PROGRESO conserva los datos" recae
  // en `fusionarModulo` (§4, ya probado en las pruebas #9/#10/#11 de este
  // mismo archivo): fusiona SOLO el módulo indicado, nunca toca `datos` de
  // otro módulo ni de otra clave — se confirma aquí explícitamente que
  // cambiar el `estado` de un módulo (NO_APLICA→EN_PROGRESO o viceversa)
  // vía fusionarModulo nunca descarta el campo `datos` existente.
  it('escenario 8/9: fusionarModulo cambia SOLO `estado` (NO_APLICA↔EN_PROGRESO) sin tocar `datos` — ni al marcar NO_APLICA ni al volver a aplicar', () => {
    const original = { version: 2 as const, modulos: {
      dotacionEpp: { estado: 'COMPLETADO' as const, datos: { dotGroups: [{ id: 1, rows: [{ id: 1, codigo: 'X' }] }] }, ultimaActualizacion: 't0', actualizadoPor: 'ana' },
    } };
    const marcadoNoAplica = fusionarModulo(original, 'dotacionEpp', {
      estado: 'NO_APLICA', datos: original.modulos.dotacionEpp.datos, ultimaActualizacion: 't1', actualizadoPor: 'ana',
    });
    const moduloNoAplica = obtenerModulo(marcadoNoAplica, 'dotacionEpp');
    expect(moduloNoAplica?.estado).toBe('NO_APLICA');
    expect(moduloNoAplica?.datos).toEqual(original.modulos.dotacionEpp.datos);

    const vueltoAAplicar = fusionarModulo(marcadoNoAplica, 'dotacionEpp', {
      estado: 'EN_PROGRESO', datos: (moduloNoAplica!.datos as typeof original.modulos.dotacionEpp.datos), ultimaActualizacion: 't2', actualizadoPor: 'ana',
    });
    const moduloVuelto = obtenerModulo(vueltoAAplicar, 'dotacionEpp');
    expect(moduloVuelto?.estado).toBe('EN_PROGRESO');
    expect(moduloVuelto?.datos).toEqual(original.modulos.dotacionEpp.datos);
  });

  it('escenario 10: modificar el estado/datos de un módulo (dotacionEpp) nunca altera otro módulo (examenesMedicos) ya guardado', () => {
    const original = { version: 2 as const, modulos: {
      dotacionEpp: { estado: 'EN_PROGRESO' as const, datos: { x: 1 }, ultimaActualizacion: 't0', actualizadoPor: 'ana' },
      examenesMedicos: { estado: 'COMPLETADO' as const, datos: { examRows: [{ id: 1 }] }, ultimaActualizacion: 't0', actualizadoPor: 'ana' },
    } };
    const actualizado = fusionarModulo(original, 'dotacionEpp', {
      estado: 'NO_APLICA', datos: { x: 1 }, ultimaActualizacion: 't1', actualizadoPor: 'ana',
    });
    const examenesTrasActualizar = obtenerModulo(actualizado, 'examenesMedicos');
    expect(examenesTrasActualizar).toEqual(original.modulos.examenesMedicos);
  });
});

describe('Ajuste "IMPEDIR COMPLETADO FALSO" — moduloTieneDatosValidos (regla ÚNICA, reutilizada por frontend y backend)', () => {
  it('dotacionEpp: false para datos ausentes/vacíos/sin filas; true en cuanto un grupo tiene al menos una fila', () => {
    expect(moduloTieneDatosValidos('dotacionEpp', undefined)).toBe(false);
    expect(moduloTieneDatosValidos('dotacionEpp', {})).toBe(false);
    expect(moduloTieneDatosValidos('dotacionEpp', { dotGroups: [] })).toBe(false);
    expect(moduloTieneDatosValidos('dotacionEpp', { dotGroups: [{ id: 1, rows: [] }] })).toBe(false);
    expect(moduloTieneDatosValidos('dotacionEpp', { dotGroups: [{ id: 1, rows: [{ id: 1, codigo: 'X' }] }] })).toBe(true);
  });

  it('examenesMedicos: false si examRows/cursosRows/vacunasRows están vacíos o sin cant/valor; true si alguno tiene al menos una fila con cant>0 y valor>0', () => {
    expect(moduloTieneDatosValidos('examenesMedicos', {})).toBe(false);
    expect(moduloTieneDatosValidos('examenesMedicos', { examRows: [{ cant: 0, valor: 1000 }] })).toBe(false);
    expect(moduloTieneDatosValidos('examenesMedicos', { examRows: [{ cant: 1, valor: 0 }] })).toBe(false);
    expect(moduloTieneDatosValidos('examenesMedicos', { examRows: [{ cant: 1, valor: 1000 }] })).toBe(true);
    expect(moduloTieneDatosValidos('examenesMedicos', { cursosRows: [{ cant: 2, valor: 500 }] })).toBe(true);
    expect(moduloTieneDatosValidos('examenesMedicos', { vacunasRows: [{ cant: 1, valor: 200 }] })).toBe(true);
  });

  it('insumos: false si insumosRows está vacío/ausente; true con al menos una fila', () => {
    expect(moduloTieneDatosValidos('insumos', {})).toBe(false);
    expect(moduloTieneDatosValidos('insumos', { insumosRows: [] })).toBe(false);
    expect(moduloTieneDatosValidos('insumos', { insumosRows: [{ id: 1 }] })).toBe(true);
  });

  it('maquinariaEquipos: false si maqRows está vacío/ausente; true con al menos una fila', () => {
    expect(moduloTieneDatosValidos('maquinariaEquipos', {})).toBe(false);
    expect(moduloTieneDatosValidos('maquinariaEquipos', { maqRows: [] })).toBe(false);
    expect(moduloTieneDatosValidos('maquinariaEquipos', { maqRows: [{ id: 1 }] })).toBe(true);
  });
});