/**
 * Motor GENÉRICO de normalización de catálogo — pruebas basadas en
 * PROPIEDADES (§17 del ajuste "NORMALIZAR TODO EL CATÁLOGO"), no en listas
 * de productos particulares. Los ejemplos de texto usados son muestras
 * reales del catálogo (ver diagnóstico), no reglas codificadas para ellos.
 */
import { describe, expect, it } from 'vitest';
import {
  normalizarTextoProducto,
  extraerTallaProducto,
  extraerAtributosProtegidos,
  normalizarTokensProducto,
  construirFamiliaKey,
  seleccionarVarianteRepresentativa,
  consolidarCatalogoPorFamilia,
  reportarCandidatosDudosos,
} from './normalizador-catalogo';

function firma(nombre: string): string {
  return construirFamiliaKey({ descripcion: nombre });
}

describe('normalizarTextoProducto — pasos 1-4 (unicode, mayúsculas, tildes, puntuación)', () => {
  it('convierte a mayúsculas, retira tildes y colapsa espacios', () => {
    expect(normalizarTextoProducto('  bota   cuero  ')).toBe('BOTA CUERO');
    expect(normalizarTextoProducto('Botín Índigo Ártico')).toBe('BOTIN INDIGO ARTICO');
  });
  it('convierte puntuación/separadores (. - : / , ; ( )) a espacio', () => {
    expect(normalizarTextoProducto('BOTA-CUERO:SEG./R.H.,NEGRA(T.38)')).toBe('BOTA CUERO SEG R H NEGRA T 38');
  });
});

describe('extraerTallaProducto — genérico, cualquier separador y posición', () => {
  it.each([
    ['BOTA CUERO SEGURIDAD T 36', '36'],
    ['BOTA CANA ALTA DIELECTRICA T 38', '38'],
    ['ZAPATO PLAYERO TALLA 35 REF 080', '35'],
    ['CHAQUETA IMPERMEABLE TALLA XXL', 'XXL'],
    ['CHAQUETA IMPERMEABLE T XL', 'XL'],
    ['CHAQUETA IMPERMEABLE T UNICA', 'UNICA'],
  ])('extrae la talla de "%s" → %s', (texto, talla) => {
    expect(extraerTallaProducto(texto).tallaExtraida).toBe(talla);
  });

  it('la talla puede estar en cualquier posición, no solo al final', () => {
    const r = extraerTallaProducto('ZAPATO PLAYERO TALLA 35 REF 080');
    expect(r.textoSinTalla).toBe('ZAPATO PLAYERO REF 080');
  });

  it('nunca retira números de referencia/modelo/calibre/3M/composición/norma (sin marcador T/TALLA)', () => {
    expect(extraerTallaProducto('GUANTE NITRILO CALIBRE 8').tallaExtraida).toBeNull();
    expect(extraerTallaProducto('FILTRO 3M 2091').tallaExtraida).toBeNull();
    expect(extraerTallaProducto('BOTIN MODELO 2025').tallaExtraida).toBeNull();
    expect(extraerTallaProducto('OVEROL 100% ALGODON').tallaExtraida).toBeNull();
    expect(extraerTallaProducto('RESPIRADOR N95').tallaExtraida).toBeNull();
    expect(extraerTallaProducto('GAFAS ANSI Z87 1').tallaExtraida).toBeNull();
  });
});

describe('extraerAtributosProtegidos', () => {
  it('captura referencia, modelo, calibre, marca técnica, norma y composición', () => {
    expect(extraerAtributosProtegidos('ZAPATO PLAYERO REF 080').referencia).toBe('080');
    expect(extraerAtributosProtegidos('BOTIN MODELO 2025').modelo).toBe('2025');
    expect(extraerAtributosProtegidos('GUANTE NITRILO CALIBRE 8').calibre).toBe('8');
    expect(extraerAtributosProtegidos('FILTRO 3M 2091').marcaTecnica).toBe('3M 2091');
    expect(extraerAtributosProtegidos('RESPIRADOR N95').norma).toBe('N95');
    expect(extraerAtributosProtegidos('OVEROL 100% ALGODON').composicion).toEqual(['100%']);
  });
});

describe('normalizarTokensProducto — morfología (singular/plural) y conectores', () => {
  it.each([
    ['BOTAS', 'BOTA'],
    ['CAMISAS', 'CAMISA'],
    ['GORRAS', 'GORRA'],
    ['GUANTES', 'GUANTE'],
    ['PANTALONES', 'PANTALON'],
    ['UNIFORMES', 'UNIFORME'],
    ['SENCILLAS', 'SENCILLA'],
    ['NEGRAS', 'NEGRA'],
    ['REFLECTIVOS', 'REFLECTIVO'],
    ['SALVAVIDAS', 'SALVAVIDA'],
  ])('singulariza %s → %s de forma lingüística general (no lista por producto)', (plural, singular) => {
    expect(normalizarTokensProducto(plural)).toEqual([singular]);
  });

  it('protege siglas/marcas cortas de la singularización (RH, 3M, EPP, GPS, PVC, ANSI)', () => {
    for (const sigla of ['RH', '3M', 'EPP', 'GPS', 'PVC', 'ANSI']) {
      expect(normalizarTokensProducto(sigla)).toEqual([sigla]);
    }
  });

  it('conserva GAFAS como excepción comercial explícita (no "GAFA")', () => {
    expect(normalizarTokensProducto('GAFAS')).toEqual(['GAFAS']);
  });

  it('retira conectores sin valor distintivo (DE, DEL, EL, LA) pero conserva CON/SIN/PARA', () => {
    expect(normalizarTokensProducto('BOTA DE SEGURIDAD DEL ALMACEN')).toEqual(['BOTA', 'SEGURIDAD', 'ALMACEN']);
    expect(normalizarTokensProducto('GORRA CON PROTECCION')).toEqual(['GORRA', 'CON', 'PROTECCION']);
    expect(normalizarTokensProducto('GORRA SIN PROTECCION')).toEqual(['GORRA', 'SIN', 'PROTECCION']);
  });
});

describe('construirFamiliaKey — propiedades (§17)', () => {
  it('1) cambiar únicamente la talla no cambia la familiaKey', () => {
    expect(firma('BOTA CUERO SEGURIDAD T.36')).toBe(firma('BOTA CUERO SEGURIDAD T.43'));
  });

  it('2) cambiar puntos o guiones no cambia la familiaKey', () => {
    expect(firma('BOTA CUERO SEG. R.H NEGRA T.39')).toBe(firma('BOTA-CUERO-SEG-R-H-NEGRA-T-39'));
  });

  it('3) agregar tildes no cambia la familiaKey', () => {
    expect(firma('PANTALON HOMBRE INDIGO ALGODON')).toBe(firma('PANTALÓN HOMBRE ÍNDIGO ALGODÓN'));
  });

  it('4) cambiar singular/plural seguro no cambia la familiaKey', () => {
    expect(firma('BOTA CUERO SENCILLA')).toBe(firma('BOTAS CUERO SENCILLAS'));
  });

  it('5) cambiar el orden de los tokens no cambia la familiaKey', () => {
    expect(firma('BOTA CUERO SEG. R.H NEGRA T.39')).toBe(firma('BOTA CUERO SEG. NEGRA R.H T.37'));
  });

  it('6) cambiar el material SÍ cambia la familiaKey', () => {
    expect(firma('BOTA CUERO SEGURIDAD')).not.toBe(firma('BOTA PVC SEGURIDAD'));
  });

  it('7) cambiar el color SÍ cambia la familiaKey', () => {
    expect(firma('BOTA CUERO SEGURIDAD NEGRA')).not.toBe(firma('BOTA CUERO SEGURIDAD AZUL'));
  });

  it('8) cambiar la referencia SÍ cambia la familiaKey', () => {
    expect(firma('ZAPATO PLAYERO REF 080')).not.toBe(firma('ZAPATO PLAYERO REF 090'));
  });

  it('9) cambiar el modelo SÍ cambia la familiaKey', () => {
    expect(firma('FILTRO 3M 2091')).not.toBe(firma('FILTRO 3M 2097'));
  });

  it('10) cambiar la categoría textual (palabra presente en el nombre) impide la fusión', () => {
    expect(firma('CAMISA DOTACION HOMBRE')).not.toBe(firma('CAMISA EPP HOMBRE'));
  });

  it('11) masculino y femenino no se fusionan', () => {
    expect(firma('PANTALON HOMBRE INDIGO')).not.toBe(firma('PANTALON DAMA INDIGO'));
    expect(firma('PANTALON INDIGO FEMENINO')).not.toBe(firma('PANTALON INDIGO MASCULINO'));
  });

  it('12) el resultado no depende del orden de entrada (propiedad general sobre consolidarCatalogoPorFamilia)', () => {
    const registros = [
      { codigo: 'A', descripcion: 'BOTA CUERO SEGURIDAD T.36', valor: 100, fecha_ultima_compra: '2026-01-01' },
      { codigo: 'B', descripcion: 'BOTA CUERO SEGURIDAD T.40', valor: 100, fecha_ultima_compra: '2026-01-01' },
    ];
    const normal = consolidarCatalogoPorFamilia(registros);
    const invertido = consolidarCatalogoPorFamilia([...registros].reverse());
    expect(invertido.familias[0].codigo).toBe(normal.familias[0].codigo);
  });
});

describe('consolidarCatalogoPorFamilia — propiedades §17 (13-15) y confianza', () => {
  it('13) cada familia aparece una sola vez', () => {
    const registros = Array.from({ length: 8 }, (_, i) => ({ codigo: `T${i}`, descripcion: `BOTA CUERO SEGURIDAD T.${36 + i}`, valor: 500000 + i, fecha_ultima_compra: '2026-01-01' }));
    const r = consolidarCatalogoPorFamilia(registros);
    expect(r.totalFamilias).toBe(1);
    expect(r.familias).toHaveLength(1);
  });

  it('14) la consolidación produce el arreglo completo, listo para paginar después (no pagina)', () => {
    const registros = Array.from({ length: 15 }, (_, i) => ({ codigo: `F${i}`, descripcion: `PRODUCTO INDEPENDIENTE ${i}`, valor: 1000, fecha_ultima_compra: '2026-01-01' }));
    const r = consolidarCatalogoPorFamilia(registros);
    expect(r.familias).toHaveLength(15);
  });

  it('15) valor, fecha y código provienen de la misma fila ganadora (nunca combinados de filas distintas)', () => {
    const registros = [
      { codigo: 'A', descripcion: 'BOTA CUERO SEGURIDAD T.36', valor: 900000, fecha_ultima_compra: '2020-01-01' },
      { codigo: 'B', descripcion: 'BOTA CUERO SEGURIDAD T.40', valor: 500000, fecha_ultima_compra: '2026-07-30' },
    ];
    const r = consolidarCatalogoPorFamilia(registros);
    expect(r.familias[0].codigo).toBe('A');
    expect(r.familias[0].valor).toBe(900000);
    expect(r.familias[0].fecha_ultima_compra).toBe('2020-01-01');
  });

  it('confianza ALTA cuando el texto (sin talla) es literalmente idéntico entre variantes', () => {
    const registros = [
      { codigo: 'A', descripcion: 'BOTA CUERO SEGURIDAD T.36', valor: 500000, fecha_ultima_compra: '2026-01-01' },
      { codigo: 'B', descripcion: 'BOTA CUERO SEGURIDAD T.40', valor: 600000, fecha_ultima_compra: '2026-01-01' },
    ];
    const r = consolidarCatalogoPorFamilia(registros);
    expect(r.confianzaPorCodigo['B']).toBe('ALTA');
  });

  it('confianza MEDIA cuando se requirió reordenar tokens o expandir abreviaturas', () => {
    const registros = [
      { codigo: 'A', descripcion: 'BOTA CUERO SEG. R.H NEGRA T.39', valor: 100, fecha_ultima_compra: '2026-07-15' },
      { codigo: 'B', descripcion: 'BOTA CUERO SEG. NEGRA R.H T.37', valor: 100, fecha_ultima_compra: '2026-01-01' },
    ];
    const r = consolidarCatalogoPorFamilia(registros);
    expect(r.confianzaPorCodigo['A']).toBe('MEDIA');
  });
});

describe('seleccionarVarianteRepresentativa — NIVEL 2 puro', () => {
  it('mayor valor gana; empate → fecha más reciente; empate total → código natural menor', () => {
    const empatados = [
      { codigo: 'P10', valor: 100, fecha_ultima_compra: '2026-01-01' },
      { codigo: 'P9', valor: 100, fecha_ultima_compra: '2026-01-01' },
      { codigo: 'P2', valor: 100, fecha_ultima_compra: '2026-01-01' },
    ];
    // comparación NATURAL: P2 < P9 < P10 (no lexicográfica, donde "P10" < "P2")
    expect(seleccionarVarianteRepresentativa(empatados).codigo).toBe('P2');
  });
});

describe('reportarCandidatosDudosos — solo reporta, nunca fusiona automáticamente', () => {
  it('detecta pares con alto solapamiento de tokens pero distinta familiaKey', () => {
    const familias = [
      { codigo: 'A', descripcion: 'GORRA AZUL PROTECCION SOLAR' },
      { codigo: 'B', descripcion: 'GORRA AZUL PROTECCION LLUVIA' },
    ];
    const r = reportarCandidatosDudosos(familias, 0.5);
    expect(r.length).toBeGreaterThan(0);
  });

  it('no reporta candidatos si difieren en referencia/modelo (bloqueador)', () => {
    const familias = [
      { codigo: 'A', descripcion: 'ZAPATO PLAYERO REF 080' },
      { codigo: 'B', descripcion: 'ZAPATO PLAYERO REF 090' },
    ];
    const r = reportarCandidatosDudosos(familias, 0.5);
    expect(r).toHaveLength(0);
  });
});
