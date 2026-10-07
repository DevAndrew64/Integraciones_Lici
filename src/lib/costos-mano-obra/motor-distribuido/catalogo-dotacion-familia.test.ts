import { describe, expect, it } from 'vitest';
import { normalizarFamiliaProducto, construirFirmaFamilia, resolverFamiliaProducto, consolidarFamiliasProducto } from './catalogo-dotacion-familia';

describe('normalizarFamiliaProducto — lectura (orden original conservado)', () => {
  it('7/8) retira marcadores de talla con distintos separadores, en cualquier posición (T., T:, T-, T, TALLA, sin separador)', () => {
    expect(normalizarFamiliaProducto('BOTA CUERO SEGURIDAD T. 36')).toBe('BOTA CUERO SEGURIDAD');
    expect(normalizarFamiliaProducto('BOTA CUERO SEGURIDAD T. 43')).toBe('BOTA CUERO SEGURIDAD');
    expect(normalizarFamiliaProducto('BOTA CANA ALTA DIELECTRICA T 38')).toBe('BOTA CANA ALTA DIELECTRICA');
    expect(normalizarFamiliaProducto('BOTA CANA ALTA DIELECTRICA T41')).toBe('BOTA CANA ALTA DIELECTRICA');
    expect(normalizarFamiliaProducto('BOTA CANA ALTA DIELECTRICA T:40')).toBe('BOTA CANA ALTA DIELECTRICA');
    expect(normalizarFamiliaProducto('BOTA CUERO SEGURIDAD T-35')).toBe('BOTA CUERO SEGURIDAD');
    // Corrección "NORMALIZAR ORDEN..." §3 — la talla ya NO necesita estar al
    // final: "TALLA 35 REF. 080" retira la talla aunque siga otro token.
    expect(normalizarFamiliaProducto('ZAPATO PLAYERO TALLA 35 REF. 080')).toBe('ZAPATO PLAYERO REF 080');
  });

  it('8) agrupa tallas alfabéticas (S, M, L, XL, XXL, 5XL) con distintos formatos T:/T./TALLA', () => {
    expect(normalizarFamiliaProducto('CAMISA TIPO POLO TURQUI GCOLBA HOMBRE T:M')).toBe('CAMISA TIPO POLO TURQUI GRUPOCOLBA HOMBRE');
    expect(normalizarFamiliaProducto('CAMISA TIPO POLO TURQUI GCOLBA HOMBRE T:XL')).toBe('CAMISA TIPO POLO TURQUI GRUPOCOLBA HOMBRE');
    expect(normalizarFamiliaProducto('CHAQUETA IMPERMEABLE TALLA XXL')).toBe('CHAQUETA IMPERMEABLE');
    expect(normalizarFamiliaProducto('CHAQUETA IMPERMEABLE T:5XL')).toBe('CHAQUETA IMPERMEABLE');
    expect(normalizarFamiliaProducto('CHAQUETA IMPERMEABLE T:S')).toBe('CHAQUETA IMPERMEABLE');
    expect(normalizarFamiliaProducto('CHAQUETA IMPERMEABLE T:L')).toBe('CHAQUETA IMPERMEABLE');
  });

  it('9) nunca retira números que forman parte real del modelo/producto (sin marcador T/TALLA precedente); retira tildes', () => {
    expect(normalizarFamiliaProducto('GUANTE NITRILO CALIBRE 8')).toBe('GUANTE NITRILO CALIBRE 8');
    expect(normalizarFamiliaProducto('GUANTE NITRILO CALIBRE 13')).toBe('GUANTE NITRILO CALIBRE 13');
    expect(normalizarFamiliaProducto('FILTRO 3M 2091')).toBe('FILTRO 3M 2091');
    expect(normalizarFamiliaProducto('RESPIRADOR 3M 6200')).toBe('RESPIRADOR 3M 6200');
    expect(normalizarFamiliaProducto('BOTÍN MODELO 2025')).toBe('BOTIN MODELO 2025');
  });

  it('2/3) normaliza SEG./SEG/SEGUR. → SEGURIDAD y R.H./R.H/R H/RH → RH, sin importar el orden relativo entre ellos', () => {
    expect(normalizarFamiliaProducto('BOTA CUERO SEG. R.H NEGRA T.39')).toBe('BOTA CUERO SEGURIDAD RH NEGRA');
    expect(normalizarFamiliaProducto('BOTA CUERO SEG. NEGRA R.H T.37')).toBe('BOTA CUERO SEGURIDAD NEGRA RH');
    expect(normalizarFamiliaProducto('BOTA CUERO SEG. R.H. NEGRA T-35')).toBe('BOTA CUERO SEGURIDAD RH NEGRA');
  });

  it('normaliza mayúsculas/espacios repetidos', () => {
    expect(normalizarFamiliaProducto('  bota   cuero  seguridad   t.36  ')).toBe('BOTA CUERO SEGURIDAD');
  });
});

describe('Alias comerciales explícitos (GCOLBA/GRUPO COLBA → GRUPOCOLBA)', () => {
  it('normaliza las 3 formas conocidas al mismo alias, sin afectar palabras no relacionadas', () => {
    expect(normalizarFamiliaProducto('PANTALON HOMBRE INDIGO 100% ALGODON T:30 GCOLBA')).toBe('PANTALON HOMBRE INDIGO 100% ALGODON GRUPOCOLBA');
    expect(normalizarFamiliaProducto('PANTALON HOMBRE INDIGO GRUPO COLBA T. 32')).toBe('PANTALON HOMBRE INDIGO GRUPOCOLBA');
    expect(normalizarFamiliaProducto('PANTALON GRUPOCOLBA T:34')).toBe('PANTALON GRUPOCOLBA');
  });

  it('retira tildes en ÍNDIGO/ALGODÓN/PANTALÓN además del alias', () => {
    expect(normalizarFamiliaProducto('PANTALÓN HOMBRE ÍNDIGO 100% ALGODÓN T. 32 GCOLBA')).toBe('PANTALON HOMBRE INDIGO 100% ALGODON GRUPOCOLBA');
  });
});

describe('construirFirmaFamilia — firma canónica ORDENADA (independiente del orden de palabras)', () => {
  it('4) el orden de NEGRA y RH (o cualquier otro token) no altera la firma', () => {
    const f1 = construirFirmaFamilia('BOTA CUERO SEG. R.H NEGRA T.39');
    const f2 = construirFirmaFamilia('BOTA CUERO SEG. NEGRA R.H T.37');
    const f3 = construirFirmaFamilia('BOTA CUERO SEG. R.H. NEGRA T-35');
    expect(f1).toBe(f2);
    expect(f2).toBe(f3);
  });

  it('las 7 variantes reales del pantalón producen exactamente la misma firma', () => {
    const nombres = [
      'PANTALON HOMBRE INDIGO 100% ALGODON T:30 GCOLBA',
      'PANTALON HOMBRE INDIGO 100% ALGODÓN T. 32 GCOLBA',
      'PANTALON HOMBRE INDIGO 100% ALGODÓN T:34 GRUPOCOLBA',
      'PANTALON HOMBRE INDIGO 100% ALGODÓN T:36 GCOLBA',
      'PANTALON HOMBRE INDIGO 100% ALGODÓN T:38 GCOLBA',
      'PANTALON HOMBRE INDIGO 100% ALGODÓN T:40 GCOLBA',
      'PANTALON HOMBRE INDIGO 100% ALGODON T:28 GCOLBA',
    ];
    const firmas = nombres.map(construirFirmaFamilia);
    expect(new Set(firmas).size).toBe(1);
  });

  it('3) "BOTAS CUERO SENCILLAS T. 38" no pertenece a la familia del pantalón (firma distinta)', () => {
    const firmaPantalon = construirFirmaFamilia('PANTALON HOMBRE INDIGO 100% ALGODON T:30 GCOLBA');
    const firmaBotas = construirFirmaFamilia('BOTAS CUERO SENCILLAS T. 38');
    expect(firmaBotas).not.toBe(firmaPantalon);
  });

  it('productos con material/color distinto no producen la misma firma (protección §3 del ajuste anterior)', () => {
    const firmas = new Set([
      construirFirmaFamilia('BOTA CUERO SEGURIDAD NEGRA'),
      construirFirmaFamilia('BOTA PVC SEGURIDAD NEGRA'),
      construirFirmaFamilia('BOTA CUERO DIELÉCTRICA NEGRA'),
      construirFirmaFamilia('ZAPATO PLAYERO TALLA 35 REF. 080'),
    ]);
    expect(firmas.size).toBe(4);
  });
});

describe('resolverFamiliaProducto — campo estructurado si existe (§4)', () => {
  it('usa un campo estructurado (referencia/productoBase/etc.) cuando está presente, sin tocar el nombre', () => {
    expect(resolverFamiliaProducto({ referencia: 'BOTA-SEG', descripcion: 'BOTA CUERO SEGURIDAD T. 36' })).toBe('BOTA-SEG');
  });
  it('sin campo estructurado (caso real de este catálogo), agrupa por la firma canónica (ordenada), no por el nombre plano', () => {
    const key1 = resolverFamiliaProducto({ descripcion: 'BOTA CUERO SEG. R.H NEGRA T.39' });
    const key2 = resolverFamiliaProducto({ descripcion: 'BOTA CUERO SEG. NEGRA R.H T.37' });
    expect(key1).toBe(key2);
  });
});

describe('consolidarFamiliasProducto — caso real "BOTA CUERO SEG./R.H./NEGRA"', () => {
  const VARIANTES = [
    { codigo: '06151', descripcion: 'BOTA CUERO SEG. R.H NEGRA T.39', valor: 72471, fecha_ultima_compra: '2026-07-15' },
    { codigo: '06163', descripcion: 'BOTA CUERO SEG. NEGRA R.H T.37', valor: 72471, fecha_ultima_compra: '2026-06-04' },
    { codigo: '06227', descripcion: 'BOTA CUERO SEG. R.H. NEGRA T-35', valor: 70091, fecha_ultima_compra: '2026-07-15' },
  ];

  it('1/9) las tres variantes producen una única familia', () => {
    const r = consolidarFamiliasProducto(VARIANTES);
    expect(r.totalFamilias).toBe(1);
  });

  it('6/7/8/10) gana la variante de mayor valor ($72.471); entre empatadas en valor, la de fecha más reciente (15/07/2026) — código 06151', () => {
    const r = consolidarFamiliasProducto(VARIANTES);
    expect(r.familias[0].codigo).toBe('06151');
    expect(r.familias[0].valor).toBe(72471);
    expect(r.familias[0].fecha_ultima_compra).toBe('2026-07-15');
  });
});

describe('consolidarFamiliasProducto — caso real "PANTALON HOMBRE INDIGO 100% ALGODON GCOLBA"', () => {
  const VARIANTES_PANTALON = [
    { codigo: '06043', descripcion: 'PANTALON HOMBRE INDIGO 100% ALGODON T:30 GCOLBA', valor: 40973, fecha_ultima_compra: '2026-07-26' },
    { codigo: '06044', descripcion: 'PANTALON HOMBRE INDIGO 100% ALGODÓN T. 32 GCOLBA', valor: 40973, fecha_ultima_compra: '2026-07-26' },
    { codigo: '06045', descripcion: 'PANTALON HOMBRE INDIGO 100% ALGODÓN T:34 GRUPOCOLBA', valor: 40972, fecha_ultima_compra: '2026-07-26' },
    { codigo: '06046', descripcion: 'PANTALON HOMBRE INDIGO 100% ALGODÓN T:36 GCOLBA', valor: 40973, fecha_ultima_compra: '2026-07-26' },
    { codigo: '06047', descripcion: 'PANTALON HOMBRE INDIGO 100% ALGODÓN T:38 GCOLBA', valor: 40973, fecha_ultima_compra: '2026-06-10' },
    { codigo: '06048', descripcion: 'PANTALON HOMBRE INDIGO 100% ALGODÓN T:40 GCOLBA', valor: 40866, fecha_ultima_compra: '2026-05-31' },
    { codigo: '06119', descripcion: 'PANTALON HOMBRE INDIGO 100% ALGODON T:28 GCOLBA', valor: 40973, fecha_ultima_compra: '2026-06-10' },
  ];
  const BOTAS_APARTE = { codigo: '07000', descripcion: 'BOTAS CUERO SENCILLAS T. 38', valor: 99999, fecha_ultima_compra: '2026-07-26' };

  it('produce una sola familia para las 7 variantes del pantalón; conserva $40.973 y fecha 26/07/2026', () => {
    const r = consolidarFamiliasProducto(VARIANTES_PANTALON);
    expect(r.totalFamilias).toBe(1);
    expect(r.familias[0].valor).toBe(40973);
    expect(r.familias[0].fecha_ultima_compra).toBe('2026-07-26');
  });

  it('el empate final (06043/06044/06046, mismo valor y fecha) se resuelve de forma estable — siempre el mismo ganador para la misma entrada', () => {
    const r1 = consolidarFamiliasProducto(VARIANTES_PANTALON);
    const r2 = consolidarFamiliasProducto(VARIANTES_PANTALON);
    expect(r1.familias[0].codigo).toBe(r2.familias[0].codigo);
    expect(['06043', '06044', '06046']).toContain(r1.familias[0].codigo);
  });

  it('no depende del orden recibido desde la API — mismo ganador con el arreglo invertido', () => {
    const normal = consolidarFamiliasProducto(VARIANTES_PANTALON);
    const invertido = consolidarFamiliasProducto([...VARIANTES_PANTALON].reverse());
    expect(invertido.familias[0].codigo).toBe(normal.familias[0].codigo);
  });

  it('"BOTAS CUERO SENCILLAS" nunca se agrupa con la familia del pantalón', () => {
    const r = consolidarFamiliasProducto([...VARIANTES_PANTALON, BOTAS_APARTE]);
    expect(r.totalFamilias).toBe(2);
  });
});

describe('consolidarFamiliasProducto — casos generales ya cubiertos', () => {
  it('2/3) gana la variante con el MAYOR valor — nunca la talla más grande por sí sola', () => {
    const registros = [
      { codigo: 'A', descripcion: 'BOTA CUERO SEGURIDAD T. 43', valor: 600000, fecha_ultima_compra: '2026-01-01' },
      { codigo: 'B', descripcion: 'BOTA CUERO SEGURIDAD T. 36', valor: 500000, fecha_ultima_compra: '2026-01-01' },
      { codigo: 'C', descripcion: 'BOTA CUERO SEGURIDAD T. 38', valor: 750000, fecha_ultima_compra: '2026-01-01' },
    ];
    const r = consolidarFamiliasProducto(registros);
    expect(r.totalFamilias).toBe(1);
    expect(r.familias[0].codigo).toBe('C');
  });

  it('14) una variante sin valor válido nunca gana frente a una con valor', () => {
    const registros = [
      { codigo: 'A', descripcion: 'BOTA T. 43', valor: 0, fecha_ultima_compra: '2026-06-01' },
      { codigo: 'B', descripcion: 'BOTA T. 36', valor: 300000, fecha_ultima_compra: '2020-01-01' },
    ];
    const r = consolidarFamiliasProducto(registros);
    expect(r.familias[0].codigo).toBe('B');
  });

  it('12) mismo nombre base pero distinto modelo (número no precedido por T/TALLA) no se fusiona incorrectamente', () => {
    const registros = [
      { codigo: 'A', descripcion: 'FILTRO 3M 2091', valor: 15000, fecha_ultima_compra: '2026-01-01' },
      { codigo: 'B', descripcion: 'FILTRO 3M 2097', valor: 18000, fecha_ultima_compra: '2026-01-01' },
    ];
    const r = consolidarFamiliasProducto(registros);
    expect(r.totalFamilias).toBe(2);
  });

  it('15/16) la consolidación no pagina — produce el arreglo completo de familias, listo para paginar después', () => {
    const registros = Array.from({ length: 20 }, (_, i) => ({ codigo: `F${i}`, descripcion: `PRODUCTO ${i}`, valor: 1000, fecha_ultima_compra: '2026-01-01' }));
    const r = consolidarFamiliasProducto(registros);
    expect(r.familias).toHaveLength(20);
  });
});
