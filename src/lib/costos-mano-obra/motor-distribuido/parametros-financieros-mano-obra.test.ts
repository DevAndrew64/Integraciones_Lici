/**
 * Pruebas del contrato financiero explícito — CIERRE FINANCIERO
 * CORRECTIVO §1/§2/§3/§4/§14. Cubre las pruebas funcionales obligatorias
 * #1 a #15 de ese bloque (los porcentajes configurables llegan al
 * ensamblador, ceros explícitos sobrevivan, fallback solo ante ausencia
 * real, nunca `||`, ceros sobreviven JSON.stringify/parse).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { resolverParametrosFinancierosManoObra, resolverClaseArl } from './parametros-financieros-mano-obra';
import { PARAMETROS_FINANCIEROS_2026_DEFAULT } from '../parametros-financieros-default';

/**
 * Ajuste "CORREGIR EL RIESGO DE ARL" — antes, `page.tsx` usaba
 * `(l.arlKey as ClaseArl)||'II'`, que solo protegía valores vacíos/nulos
 * (`||`) pero dejaba pasar SIN VALIDAR cualquier string no vacío (ej.
 * 'VI', 'XYZ', un registro legado corrupto) directo a
 * `porcentajeArlPorClase[valorInvalido]`, produciendo `undefined` → NaN
 * en el cálculo financiero. `resolverClaseArl` es el único punto de
 * validación: acepta EXACTAMENTE las 5 clases legales, y usa el MISMO
 * fallback ya vigente ('II') para cualquier otro caso — vacío, nulo,
 * undefined, o un valor inválido no vacío. El porcentaje real sigue
 * viniendo de `porcentajeArlPorClase` (configuración canónica); esta
 * función solo decide qué CLAVE de esa tabla se usa, nunca inventa una
 * tarifa.
 */
describe('resolverClaseArl — nunca produce NaN, ni con valores inválidos no vacíos', () => {
  it.each(['I', 'II', 'III', 'IV', 'V'] as const)('%s es aceptado tal cual', (clase) => {
    expect(resolverClaseArl(clase)).toBe(clase);
  });

  it('undefined usa el fallback vigente (II)', () => {
    expect(resolverClaseArl(undefined)).toBe('II');
  });

  it('null usa el fallback vigente (II)', () => {
    expect(resolverClaseArl(null)).toBe('II');
  });

  it('cadena vacía usa el fallback vigente (II)', () => {
    expect(resolverClaseArl('')).toBe('II');
  });

  it('"VI" (clase inexistente) usa el fallback vigente (II), nunca NaN', () => {
    expect(resolverClaseArl('VI')).toBe('II');
  });

  it('"XYZ" (valor arbitrario/corrupto) usa el fallback vigente (II), nunca NaN', () => {
    expect(resolverClaseArl('XYZ')).toBe('II');
  });

  it('el resultado siempre es una clave válida de porcentajeArlPorClase — nunca produce NaN al indexar la tabla real', () => {
    const p = resolverParametrosFinancierosManoObra(null);
    for (const entrada of ['I', 'II', 'III', 'IV', 'V', undefined, null, '', 'VI', 'XYZ'] as const) {
      const clase = resolverClaseArl(entrada);
      const porcentaje = p.porcentajeArlPorClase[clase];
      expect(Number.isFinite(porcentaje)).toBe(true);
      expect(Number.isNaN(porcentaje)).toBe(false);
    }
  });
});

describe('resolverParametrosFinancierosManoObra — regla ?? (nunca ||), ceros explícitos preservados', () => {
  it('1) sin configuración (undefined) resuelve TODOS los campos con los predeterminados, fuente=VALORES_PREDETERMINADOS', () => {
    const p = resolverParametrosFinancierosManoObra(undefined);
    expect(p.porcentajeSalud).toBe(PARAMETROS_FINANCIEROS_2026_DEFAULT.pctSalud);
    expect(p.porcentajePension).toBe(PARAMETROS_FINANCIEROS_2026_DEFAULT.pctPension);
    expect(p.porcentajeCajaCompensacion).toBe(PARAMETROS_FINANCIEROS_2026_DEFAULT.pctCaja);
    expect(p.porcentajeSena).toBe(PARAMETROS_FINANCIEROS_2026_DEFAULT.pctSena);
    expect(p.porcentajeIcbf).toBe(PARAMETROS_FINANCIEROS_2026_DEFAULT.pctIcbf);
    expect(p.porcentajeCesantias).toBe(PARAMETROS_FINANCIEROS_2026_DEFAULT.pctCesantias);
    expect(p.porcentajePrima).toBe(PARAMETROS_FINANCIEROS_2026_DEFAULT.pctPrima);
    expect(p.porcentajeVacaciones).toBe(PARAMETROS_FINANCIEROS_2026_DEFAULT.pctVacaciones);
    expect(p.porcentajeInteresesCesantias).toBe(PARAMETROS_FINANCIEROS_2026_DEFAULT.pctIntCesantias);
    expect(p.porcentajeArlPorClase).toEqual(PARAMETROS_FINANCIEROS_2026_DEFAULT.pctArlPorClase);
    expect(p.fuente).toBe('VALORES_PREDETERMINADOS');
  });

  it('2) salud explícita en cero (0) permanece en cero — nunca sustituida por 8.5', () => {
    const p = resolverParametrosFinancierosManoObra({ porcentajeSalud: 0 });
    expect(p.porcentajeSalud).toBe(0);
  });

  it('3) SENA explícito en cero permanece en cero — nunca sustituido por 2', () => {
    const p = resolverParametrosFinancierosManoObra({ porcentajeSena: 0 });
    expect(p.porcentajeSena).toBe(0);
  });

  it('4) ICBF explícito en cero permanece en cero — nunca sustituido por 3', () => {
    const p = resolverParametrosFinancierosManoObra({ porcentajeIcbf: 0 });
    expect(p.porcentajeIcbf).toBe(0);
  });

  it('5) pensión personalizada se conserva (ej. 16% en vez del 12% predeterminado)', () => {
    const p = resolverParametrosFinancierosManoObra({ porcentajePension: 16 });
    expect(p.porcentajePension).toBe(16);
  });

  it('6) caja de compensación personalizada se conserva (ej. 2% en vez de 4%)', () => {
    const p = resolverParametrosFinancierosManoObra({ porcentajeCajaCompensacion: 2 });
    expect(p.porcentajeCajaCompensacion).toBe(2);
  });

  it('7) cesantías personalizadas se conservan (ej. 9% en vez de 8.33%)', () => {
    const p = resolverParametrosFinancierosManoObra({ porcentajeCesantias: 9 });
    expect(p.porcentajeCesantias).toBe(9);
  });

  it('8) prima personalizada se conserva (ej. 9% en vez de 8.33%)', () => {
    const p = resolverParametrosFinancierosManoObra({ porcentajePrima: 9 });
    expect(p.porcentajePrima).toBe(9);
  });

  it('9) vacaciones personalizadas se conservan (ej. 4% en vez de 5%)', () => {
    const p = resolverParametrosFinancierosManoObra({ porcentajeVacaciones: 4 });
    expect(p.porcentajeVacaciones).toBe(4);
  });

  it('10) intereses de cesantías personalizados se conservan (ej. 2% en vez de 1%)', () => {
    const p = resolverParametrosFinancierosManoObra({ porcentajeInteresesCesantias: 2 });
    expect(p.porcentajeInteresesCesantias).toBe(2);
  });

  it('11) ARL depende de la clase de riesgo — cada clase resuelve su propio porcentaje configurado', () => {
    const p = resolverParametrosFinancierosManoObra({ porcentajeArlPorClase: { II: 1.5, IV: 5.5 } });
    expect(p.porcentajeArlPorClase.II).toBe(1.5);
    expect(p.porcentajeArlPorClase.IV).toBe(5.5);
    // Clases no configuradas caen a su predeterminado individualmente —
    // nunca se pierde la tabla completa por configurar solo algunas.
    expect(p.porcentajeArlPorClase.I).toBe(PARAMETROS_FINANCIEROS_2026_DEFAULT.pctArlPorClase.I);
    expect(p.porcentajeArlPorClase.V).toBe(PARAMETROS_FINANCIEROS_2026_DEFAULT.pctArlPorClase.V);
  });

  it('13) los predeterminados solo se usan cuando el valor está ausente (undefined/null) — un objeto con solo ALGUNOS campos conserva los demás', () => {
    const p = resolverParametrosFinancierosManoObra({ porcentajeSalud: 0, porcentajeSena: 0, porcentajeIcbf: 0 });
    expect(p.porcentajeSalud).toBe(0);
    expect(p.porcentajeSena).toBe(0);
    expect(p.porcentajeIcbf).toBe(0);
    // pensión/caja NO se configuraron en este objeto → caen a predeterminado
    expect(p.porcentajePension).toBe(PARAMETROS_FINANCIEROS_2026_DEFAULT.pctPension);
    expect(p.porcentajeCajaCompensacion).toBe(PARAMETROS_FINANCIEROS_2026_DEFAULT.pctCaja);
    expect(p.fuente).toBe('CONFIGURACION_USUARIO');
  });

  it('13b) null se trata igual que undefined — activa el respaldo por campo', () => {
    const p = resolverParametrosFinancierosManoObra({ porcentajeSalud: null, porcentajePension: 12 });
    expect(p.porcentajeSalud).toBe(PARAMETROS_FINANCIEROS_2026_DEFAULT.pctSalud);
    expect(p.porcentajePension).toBe(12);
  });

  it('14) nunca se usa || para resolver valores numéricos configurables — el propio código fuente del resolver no contiene "||" en la resolución de porcentajes', () => {
    const codigo = readFileSync(join(__dirname, 'parametros-financieros-mano-obra.ts'), 'utf-8');
    const cuerpoResolver = codigo.slice(codigo.indexOf('export function resolverParametrosFinancierosManoObra'));
    expect(cuerpoResolver).not.toContain('||');
    expect(cuerpoResolver).toContain('??');
  });

  it('15) los ceros sobreviven a JSON.stringify/parse — el contrato resuelto nunca pierde un 0 al serializarse', () => {
    const p = resolverParametrosFinancierosManoObra({ porcentajeSalud: 0, porcentajeSena: 0, porcentajeIcbf: 0 });
    const json = JSON.stringify(p);
    expect(json).toContain('"porcentajeSalud":0');
    expect(json).toContain('"porcentajeSena":0');
    expect(json).toContain('"porcentajeIcbf":0');
    const restaurado = JSON.parse(json);
    expect(restaurado.porcentajeSalud).toBe(0);
    expect(restaurado.porcentajeSena).toBe(0);
    expect(restaurado.porcentajeIcbf).toBe(0);
  });

  it('exoneradoSalud/exoneradoSena/exoneradoIcbf explícitos en false se conservan (nunca se infieren de un porcentaje en cero)', () => {
    const p = resolverParametrosFinancierosManoObra({ porcentajeSalud: 0, exoneradoSalud: false });
    expect(p.exoneradoSalud).toBe(false);
    expect(p.porcentajeSalud).toBe(0);
  });

  it('exoneradoSalud explícito en true se conserva de forma independiente al porcentaje configurado', () => {
    const p = resolverParametrosFinancierosManoObra({ porcentajeSalud: 8.5, exoneradoSalud: true });
    expect(p.exoneradoSalud).toBe(true);
    expect(p.porcentajeSalud).toBe(8.5); // el porcentaje se conserva tal cual; la exoneración se aplica aparte, en el ensamblador
  });
});

describe('Limpieza segura — dependencia de liquidador-mo.ts eliminada (§1/§2, pruebas #2/#3)', () => {
  it('2) parametros-financieros-mano-obra.ts importa PARAMETROS_FINANCIEROS_2026_DEFAULT del módulo neutral, no de liquidador-mo.ts', () => {
    const codigo = readFileSync(join(__dirname, 'parametros-financieros-mano-obra.ts'), 'utf-8');
    expect(codigo).toContain("from '../parametros-financieros-default'");
    expect(codigo).not.toContain("from '../liquidador-mo'");
  });

  it('3) el motor comercial vigente no importa liquidador-mo.ts en ningún punto de su cadena de tipos/valores', () => {
    const motorComercial = readFileSync(join(__dirname, 'motor-comercial-30-dias.ts'), 'utf-8');
    const ensamblador = readFileSync(join(__dirname, 'resultado-financiero-mensual-linea.ts'), 'utf-8');
    expect(motorComercial).not.toContain("from './liquidador-mo'");
    expect(motorComercial).not.toContain("from '../liquidador-mo'");
    // El ensamblador solo lo menciona en comentarios explicativos — nunca
    // en una línea de import ejecutable.
    expect(ensamblador).not.toMatch(/^import.*liquidador-mo/m);
  });

  it('liquidador-mo.ts y su test ya no existen en el árbol de archivos', () => {
    expect(existsSync(join(__dirname, '../liquidador-mo.ts'))).toBe(false);
    expect(existsSync(join(__dirname, '../liquidador-mo.test.ts'))).toBe(false);
  });
});