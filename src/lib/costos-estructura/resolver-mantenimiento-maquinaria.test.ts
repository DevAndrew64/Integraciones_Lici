import { describe, expect, it } from 'vitest';
import {
  resolverMantenimientoMaquinaria, normalizarDescripcionMantenimiento,
  type CatalogoMantenimientoEquipos, type EquipoApiParaMantenimiento,
} from './resolver-mantenimiento-maquinaria';
import catalogoReal from '../../data/costos-estructura/mantenimiento-equipos.json';

const catalogo = catalogoReal as unknown as CatalogoMantenimientoEquipos;

function equipo(overrides: Partial<EquipoApiParaMantenimiento> = {}): EquipoApiParaMantenimiento {
  return { tipoCodigo: '006', subTipoCodigo: '010', nombre: 'RADIO PORTATIL TXPRO', ...overrides };
}

describe('1) Radio TXPRO — caso de control (API real)', () => {
  it('resuelve $40.000 vía Nivel 1 (código 006|010 + descripción exacta del histórico)', () => {
    const r = resolverMantenimientoMaquinaria(
      equipo({ nombre: 'RADIO PORTATIL TXPRO DE 4 W DE POTENCIA, ALCANCE 4' }),
      catalogo,
    );
    expect(r.mantenimientoEncontrado).toBe(true);
    expect(r.valorMantenimientoUnitarioMensual).toBe(40000);
    expect(r.fuenteMantenimiento).toBe('PLANTILLA_COSTO_MES_MANTTO');
    expect(r.nivelMatch).toBe(1);
    expect(r.claveEquipoApi).toBe('006|010|RADIO PORTATIL TXPRO DE 4 W DE POTENCIA, ALCANCE 4');
  });

  it('sin descripción exacta cae a Nivel 2 (código 006|010 es determinístico: única tarifa 40.000)', () => {
    const r = resolverMantenimientoMaquinaria(equipo({ nombre: 'RADIO PORTATIL TXPRO' }), catalogo);
    expect(r.mantenimientoEncontrado).toBe(true);
    expect(r.valorMantenimientoUnitarioMensual).toBe(40000);
    expect(r.nivelMatch).toBe(2);
  });

  it('el maestro SÍ tiene una categoría de radios con el mismo valor (40.000), pero validadoContraMaestro exige texto IDÉNTICO — nunca se fuerza una homologación textual que no coincide exactamente ("RADIO PORTATIL TXPRO"≠"RADIO DE COMUNICACION")', () => {
    const enMaestro = catalogo.maestro.find(m => m.descripcionNormalizada === 'RADIO DE COMUNICACION');
    expect(enMaestro?.valorMensual).toBe(40000);
    const r = resolverMantenimientoMaquinaria(equipo({ nombre: 'RADIO PORTATIL TXPRO' }), catalogo);
    expect(r.valorMantenimientoUnitarioMensual).toBe(40000); // mismo número, por Nivel 2 (histórico)
    expect(r.validadoContraMaestro).toBe(false); // honesto: no se afirma una homologación de texto que no existe
  });
});

describe('2) Código con tarifa única resuelve (Nivel 2)', () => {
  it('Grupo 004 + SubTipo 015 (BRILLADORA) no está en codigosAmbiguos y resuelve', () => {
    const ambiguo = catalogo.codigosAmbiguos.some(c => c.grupoActivo === '004' && c.subTipoActivo === '015');
    expect(ambiguo).toBe(false);
    const r = resolverMantenimientoMaquinaria({ tipoCodigo: '004', subTipoCodigo: '015', nombre: 'BRILLADORA CUALQUIERA XYZ' }, catalogo);
    expect(r.mantenimientoEncontrado).toBe(true);
    expect(r.nivelMatch).toBe(2);
    expect(r.valorMantenimientoUnitarioMensual).toBeGreaterThan(0);
  });
});

describe('3) Código con colisión de tarifas → AMBIGUO (nunca elige)', () => {
  it('Grupo 004 + SubTipo 039 (HIDROLAVADORA, colisión real 60000 vs 40000) sin descripción exacta → ambiguo', () => {
    const ambiguo = catalogo.codigosAmbiguos.find(c => c.grupoActivo === '004' && c.subTipoActivo === '039');
    expect(ambiguo).toBeDefined();
    const r = resolverMantenimientoMaquinaria({ tipoCodigo: '004', subTipoCodigo: '039', nombre: 'UN NOMBRE QUE NO EXISTE EN EL CATALOGO' }, catalogo);
    expect(r.mantenimientoEncontrado).toBe(false);
    expect(r.requiereRevision).toBe(true);
    expect(r.motivo).toBe('MATCH_AMBIGUO');
    expect(r.valorMantenimientoUnitarioMensual).toBeNull();
  });

  it('con descripción EXACTA dentro del código ambiguo, Nivel 1 SÍ resuelve (nunca se descarta el código completo)', () => {
    const r = resolverMantenimientoMaquinaria({ tipoCodigo: '004', subTipoCodigo: '039', nombre: 'HIDROLAVADORA' }, catalogo);
    expect(r.mantenimientoEncontrado).toBe(true);
    expect(r.nivelMatch).toBe(1);
    expect(r.valorMantenimientoUnitarioMensual).toBe(60000);
  });
});

describe('4) Descripción exacta maestra (Nivel 3, sin código conocido)', () => {
  it('código inexistente en el histórico, pero nombre coincide con el maestro', () => {
    const r = resolverMantenimientoMaquinaria({ tipoCodigo: '999', subTipoCodigo: '999', nombre: 'GRECA' }, catalogo);
    expect(r.mantenimientoEncontrado).toBe(true);
    expect(r.nivelMatch).toBe(3);
    expect(r.fuenteMantenimiento).toBe('COSTOS_MTTO_MAESTRO');
    expect(r.valorMantenimientoUnitarioMensual).toBe(11667);
  });
});

describe('5) Sin coincidencia → null, nunca 0', () => {
  it('código y descripción inexistentes en ambas fuentes', () => {
    const r = resolverMantenimientoMaquinaria({ tipoCodigo: '999', subTipoCodigo: '999', nombre: 'EQUIPO INEXISTENTE XYZ 123' }, catalogo);
    expect(r.mantenimientoEncontrado).toBe(false);
    expect(r.requiereRevision).toBe(true);
    expect(r.motivo).toBe('SIN_COINCIDENCIA');
    expect(r.valorMantenimientoUnitarioMensual).toBeNull();
    expect(r.valorMantenimientoUnitarioMensual).not.toBe(0);
  });
});

describe('6/7) Coincidencia histórica y maestra — mismo valor válida, valores distintos no ocultan conflicto', () => {
  it('el catálogo generado no reporta ningún conflicto maestro↔histórico (0 confirmado con datos reales)', () => {
    expect((catalogoReal as { conflictosMaestroHistorico: unknown[] }).conflictosMaestroHistorico).toHaveLength(0);
  });
  it('cuando el histórico resuelve un valor que SÍ existe en el maestro con el mismo número, validadoContraMaestro=true', () => {
    const r = resolverMantenimientoMaquinaria({ tipoCodigo: '004', subTipoCodigo: '049', nombre: 'ASPIRADORA INDUSTRIAL' }, catalogo);
    expect(r.validadoContraMaestro).toBe(true);
  });
});

describe('8/9/10) UEN se conserva en el catálogo (trazabilidad), nunca se usa para filtrar mantenimiento', () => {
  it('el histórico conserva BAQ/BOG/MIN por fila', () => {
    const uens = new Set(catalogo.historico.map(h => h.uen));
    expect(uens.has('BAQ')).toBe(true);
    expect(uens.has('BOG')).toBe(true);
    expect(uens.has('MIN')).toBe(true);
  });
  it('resolverMantenimientoMaquinaria nunca recibe ni filtra por uen — la firma de EquipoApiParaMantenimiento no tiene ese campo', () => {
    const r = resolverMantenimientoMaquinaria(equipo(), catalogo);
    expect(Object.keys(equipo())).not.toContain('uen');
    expect(r).toBeDefined();
  });
});

describe('11/12/13) BQI/BGI/MNI nunca se transforman automáticamente', () => {
  it('el resolvedor no contiene ningún mapeo BQI→BAQ, BGI→BOG, MNI→MIN', () => {
    const src = resolverMantenimientoMaquinaria.toString();
    expect(src).not.toContain('BQI');
    expect(src).not.toContain('BGI');
    expect(src).not.toContain('MNI');
  });
});

describe('14) Códigos "006"/"010" conservan ceros a la izquierda', () => {
  it('el catálogo generado conserva los códigos como string con ceros', () => {
    const conCero = catalogo.historico.filter(h => h.grupoActivo.startsWith('0'));
    expect(conCero.length).toBeGreaterThan(0);
    expect(catalogo.historico.some(h => h.grupoActivo === '006')).toBe(true);
  });
  it('normalizarDescripcionMantenimiento nunca toca los códigos (solo opera sobre texto de descripción)', () => {
    expect(normalizarDescripcionMantenimiento('Equipo 006-010')).toContain('006');
    expect(normalizarDescripcionMantenimiento('Equipo 006-010')).toContain('010');
  });
});

describe('17) Nunca fuzzy matching / contains indiscriminado', () => {
  it('una descripción que "contiene" parcialmente otra NO produce match en Nivel 1/3', () => {
    // "ASPIRADORA" (parcial) no debe encontrar "ASPIRADORA INDUSTRIAL" por contención.
    const r = resolverMantenimientoMaquinaria({ tipoCodigo: '999', subTipoCodigo: '999', nombre: 'ASPIRADORA' }, catalogo);
    expect(r.mantenimientoEncontrado).toBe(false);
  });
});

describe('18) Una tarifa no encontrada nunca se trata como cero', () => {
  it('SIN_COINCIDENCIA y MATCH_AMBIGUO siempre devuelven null, tipado number|null', () => {
    const sinMatch = resolverMantenimientoMaquinaria({ tipoCodigo: '999', subTipoCodigo: '999', nombre: 'NO EXISTE' }, catalogo);
    const ambiguo = resolverMantenimientoMaquinaria({ tipoCodigo: '004', subTipoCodigo: '039', nombre: 'NO EXISTE TAMPOCO' }, catalogo);
    expect(sinMatch.valorMantenimientoUnitarioMensual).toBeNull();
    expect(ambiguo.valorMantenimientoUnitarioMensual).toBeNull();
  });
});

describe('Estadísticas de cobertura del catálogo (auditoría del diagnóstico)', () => {
  it('37 categorías en el maestro, 7 códigos ambiguos, 0 conflictos maestro-histórico', () => {
    expect(catalogo.maestro.length).toBe(37);
    expect(catalogo.codigosAmbiguos.length).toBe(7);
    expect((catalogoReal as { conflictosMaestroHistorico: unknown[] }).conflictosMaestroHistorico).toHaveLength(0);
  });
});
