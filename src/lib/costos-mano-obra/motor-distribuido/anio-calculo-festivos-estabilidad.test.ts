/**
 * Verificación de fuente — cierre "PRESENTACIÓN DE JORNADA INDIVIDUAL Y
 * ESTABILIDAD DEL AÑO", §3/§4/§6. No hay arnés de render de componentes
 * para page.tsx (~25.000 líneas) en este proyecto — verificación honesta
 * y acotada del TEXTO/estructura exacta en el código fuente, mismo patrón
 * ya usado en texto-ui-mano-obra*.test.ts. Complementa las pruebas puras
 * de `resolverAnioCalculo`/`calcularFestivosPromedioMesPorDiaSemana` ya
 * existentes en festivos-dia-semana.test.ts.
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolverAnioCalculo } from './festivos-dia-semana';

const PAGE_TSX = readFileSync(join(__dirname, '../../../app/page.tsx'), 'utf-8');

describe('§6.1 — una estructura con anioCalculoFestivos=2026 sigue usando 2026 aunque el servidor esté en 2027', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('resolverAnioCalculo(2026) ignora el año del servidor', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2027, 5, 1)));
    expect(resolverAnioCalculo(2026)).toBe(2026);
    expect(new Date().getUTCFullYear()).toBe(2027); // confirma que el "servidor" sí está en 2027
  });
});

describe('§6.3/§6.4 — JSON histórico sin año y persistencia en el siguiente guardado', () => {
  it('resolverAnioCalculo(null) resuelve en memoria al año del servidor (nunca bloquea, nunca pregunta)', () => {
    expect(resolverAnioCalculo(null)).toBe(new Date().getUTCFullYear());
  });
  it('resolverAnioCalculo(undefined) hace lo mismo que null', () => {
    expect(resolverAnioCalculo(undefined)).toBe(resolverAnioCalculo(null));
  });
});

describe('§3/§4 — page.tsx: estado, restauración y persistencia del año (verificación de fuente)', () => {
  it('existe el estado anioCalculoFestivosGuardado (null por defecto — nueva estructura o histórico sin campo)', () => {
    expect(PAGE_TSX).toContain('const [anioCalculoFestivosGuardado,setAnioCalculoFestivosGuardado]=useState<number|null>(null);');
  });

  it('§2 — aplicarDatosGuardados restaura el año guardado, sin escribir nada (solo lee)', () => {
    expect(PAGE_TSX).toContain("setAnioCalculoFestivosGuardado(typeof d.anioCalculoFestivos==='number'?d.anioCalculoFestivos:null);");
  });

  it('anioCalculoFestivosResuelto se deriva con resolverAnioCalculo — nunca con new Date() directo suelto para este propósito', () => {
    expect(PAGE_TSX).toContain('resolverAnioCalculo(anioCalculoFestivosGuardado)');
  });

  it('§4 — construirDatosEntradaManoObra persiste el año YA resuelto (guardado o recién resuelto), listo para el siguiente guardado', () => {
    expect(PAGE_TSX).toContain('anioCalculoFestivos:anioCalculoFestivosResuelto,');
  });

  it('§6.5 — derivarDistribucionHorasComercialDesdeHorario recibe anioCalculo:anioCalculoFestivosResuelto en ambos puntos de cálculo', () => {
    const ocurrencias = PAGE_TSX.split('anioCalculo:anioCalculoFestivosResuelto').length - 1;
    expect(ocurrencias).toBeGreaterThanOrEqual(2); // construirCalculadaLinea + obtenerInterpretacionLinea
  });
});

describe('§6.9 — una posición de jornada individual (no cobertura) nunca aparece en el detalle de cobertura del grupo', () => {
  it('DetalleCoberturaGrupo excluye explícitamente las posiciones que no son COBERTURA_12_7/24_7 (filasConCobertura y el guard dentro del panel)', () => {
    const inicio = PAGE_TSX.indexOf('function DetalleCoberturaGrupo(');
    expect(inicio).toBeGreaterThan(-1);
    const fin = PAGE_TSX.indexOf('\n  }', inicio);
    const bloque = PAGE_TSX.slice(inicio, fin);
    expect(bloque).toContain("t==='COBERTURA_12_7'||t==='COBERTURA_24_7'");
    expect(bloque).toContain("interpretacion.tipoOperacionInterpretada!=='COBERTURA_12_7'&&interpretacion.tipoOperacionInterpretada!=='COBERTURA_24_7'");
    expect(bloque).not.toContain('avisoCostoParcial');
    expect(bloque).not.toContain('JORNADA_PARCIAL');
  });
  it('el bloque retorna null por completo cuando el grupo no tiene ninguna posición de cobertura ni requiere relevo', () => {
    const inicio = PAGE_TSX.indexOf('function DetalleCoberturaGrupo(');
    const fin = PAGE_TSX.indexOf('\n  }', inicio);
    const bloque = PAGE_TSX.slice(inicio, fin);
    expect(bloque).toContain('if(filasConCobertura.length===0&&!requiereRelevo)return null;');
  });
});

describe('§5/§7 — presentación del año y texto del checkbox', () => {
  // Ajuste "oculta esto también" — el bloque de jornada individual se
  // retiró de la UI por completo; el texto del calendario aplicado y el
  // uso condicional de `incluyeFestivos` ya no viven ahí.
  // `textoCalendarioAplicado`/`DESCRIPCION_JORNADA_INDIVIDUAL`/
  // `tituloTipoJornadaVisible` se retiraron también del import de
  // page.tsx (código muerto).
  it('§5 — textoCalendarioAplicado ya no se importa/usa en page.tsx', () => {
    expect(PAGE_TSX).not.toContain('textoCalendarioAplicado');
  });

  it('§7 — el checkbox usa el texto ya aprobado ("Incluir días festivos en la programación", corrección "CAMBIAR ÚNICAMENTE EL TEXTO VISIBLE")', () => {
    expect(PAGE_TSX).toContain('Incluir días festivos en la programación');
  });
});