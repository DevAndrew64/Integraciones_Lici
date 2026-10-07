import { describe, expect, it } from 'vitest';
import {
  normalizarDescripcionEquipoMtto,
  construirCatalogoPrimarioMantenimiento,
  construirCatalogoHistoricoMantenimiento,
  resolverMantenimientoSugeridoDesdeCatalogos,
} from './catalogo-mantenimiento-equipos';

describe('normalizarDescripcionEquipoMtto — normalización controlada (§4)', () => {
  it('mayúsculas, quita tildes, conserva Ñ', () => {
    expect(normalizarDescripcionEquipoMtto('guadaña industrial')).toBe('GUADAÑA INDUSTRIAL');
  });

  it('corrige la codificación Ð→Ñ vista en el Excel real', () => {
    expect(normalizarDescripcionEquipoMtto('GUADAÐA INDUSTRIAL STHIL FS280')).toBe('GUADAÑA INDUSTRIAL STHIL FS280');
  });

  it('quita comillas/marcas de pulgadas', () => {
    expect(normalizarDescripcionEquipoMtto('BRILLADORA INDUSTRIAL  17 175 RPM"')).toBe('BRILLADORA INDUSTRIAL 17 175 RPM');
  });

  it('nunca quita números — motobomba se distingue solo por las pulgadas', () => {
    expect(normalizarDescripcionEquipoMtto('MOTOBOMBA ELECTRICA 2 PULGADAS')).toContain('2');
    expect(normalizarDescripcionEquipoMtto('MOTOBOMBA ELECTRICA 3 PULGADAS')).toContain('3');
  });

  it('colapsa espacios múltiples y signos', () => {
    expect(normalizarDescripcionEquipoMtto('ASPIRADORA  INDUSTRIAL/SECO-HUMEDO')).toBe('ASPIRADORA INDUSTRIAL SECO HUMEDO');
  });
});

const catalogoPrimarioBrillaAspiraHidro = construirCatalogoPrimarioMantenimiento([
  { descripcion: 'ASPIRADORA INDUSTRIAL', valorMesCelda: 25000, fila: 2 },
  { descripcion: 'BRILLADORA INDUSTRIAL  ', valorMesCelda: 40000, fila: 3 },
  { descripcion: 'HIDROLAVADORA ELECTRICA', valorMesCelda: 60000, fila: 5 },
  { descripcion: 'SOPLADORA ELECTRICA', valorMesCelda: 20000, fila: 8 },
  { descripcion: 'SOPLADORA DE HOJAS A GASOLINA ', valorMesCelda: 50000, fila: 9 },
]);

describe('10) coincidencia única precarga Mtto. unitario (catálogo 2025)', () => {
  it('coincidencia exacta', () => {
    const r = resolverMantenimientoSugeridoDesdeCatalogos('ASPIRADORA INDUSTRIAL', catalogoPrimarioBrillaAspiraHidro, new Map());
    expect(r).toEqual({ valor: 25000, origen: 'CATALOGO_MTTO_2025', referenciaId: 'catalogo-2025-fila-2' });
  });

  it('coincidencia por contención — variante real del histórico ("BRILLADORA INDUSTRIAL 175 RPM 17"")', () => {
    const r = resolverMantenimientoSugeridoDesdeCatalogos('BRILLADORA INDUSTRIAL  17 175 RPM"', catalogoPrimarioBrillaAspiraHidro, new Map());
    expect(r).toEqual({ valor: 40000, origen: 'CATALOGO_MTTO_2025', referenciaId: 'catalogo-2025-fila-3' });
  });

  it('no confunde SOPLADORA ELECTRICA con SOPLADORA DE HOJAS A GASOLINA (familias ambiguas por la palabra líder, resueltas por la frase completa)', () => {
    const rElectrica = resolverMantenimientoSugeridoDesdeCatalogos('SOPLADORA ELECTRICA 600 WATTS', catalogoPrimarioBrillaAspiraHidro, new Map());
    expect(rElectrica?.valor).toBe(20000);
    const rGasolina = resolverMantenimientoSugeridoDesdeCatalogos('SOPLADORA DE HOJAS A GASOLINA PROFESIONAL', catalogoPrimarioBrillaAspiraHidro, new Map());
    expect(rGasolina?.valor).toBe(50000);
  });

  it('una SOPLADORA genérica sin más contexto no coincide con ninguna de las dos (ambiguo, nunca se inventa)', () => {
    const r = resolverMantenimientoSugeridoDesdeCatalogos('SOPLADORA', catalogoPrimarioBrillaAspiraHidro, new Map());
    expect(r).toBeNull();
  });
});

describe('11) la fuente 2025 tiene prioridad sobre la histórica', () => {
  it('si hay coincidencia en el catálogo 2025, nunca consulta el histórico aunque este también tenga una entrada distinta', () => {
    const historico = new Map<string, number | null>([['ASPIRADORA INDUSTRIAL', 999999]]);
    const r = resolverMantenimientoSugeridoDesdeCatalogos('ASPIRADORA INDUSTRIAL', catalogoPrimarioBrillaAspiraHidro, historico);
    expect(r).toEqual({ valor: 25000, origen: 'CATALOGO_MTTO_2025', referenciaId: 'catalogo-2025-fila-2' });
  });
});

describe('12) la histórica funciona como respaldo cuando no hay coincidencia en la principal', () => {
  it('usa el histórico cuando el catálogo 2025 no tiene ninguna coincidencia', () => {
    const historico = new Map<string, number | null>([['CAMIONETA DOBLE CABINA', 2926525]]);
    const r = resolverMantenimientoSugeridoDesdeCatalogos('CAMIONETA DOBLE CABINA', catalogoPrimarioBrillaAspiraHidro, historico);
    expect(r).toEqual({ valor: 2926525, origen: 'PLANTILLA_HISTORICA', referenciaId: 'historico-CAMIONETA DOBLE CABINA' });
  });
});

describe('13/14) sin coincidencia única deja el campo sin valor — nunca inventa (ej. AVISO PREVENTIVO)', () => {
  it('AVISO PREVENTIVO no coincide con ningún equipo de limpieza/mantenimiento', () => {
    const r = resolverMantenimientoSugeridoDesdeCatalogos('AVISO PREVENTIVO', catalogoPrimarioBrillaAspiraHidro, new Map());
    expect(r).toBeNull();
  });

  it('descripción vacía nunca produce una coincidencia', () => {
    const r = resolverMantenimientoSugeridoDesdeCatalogos('', catalogoPrimarioBrillaAspiraHidro, new Map());
    expect(r).toBeNull();
  });
});

describe('construirCatalogoHistoricoMantenimiento — solo conserva descripciones consistentes', () => {
  it('descripción con un único valor repetido se conserva', () => {
    const mapa = construirCatalogoHistoricoMantenimiento([
      { descripcion: 'GRECA 120 TINTOS', valorMantenimientoCelda: 11667 },
      { descripcion: 'GRECA 120 TINTOS', valorMantenimientoCelda: 11667 },
    ]);
    expect(mapa.get('GRECA 120 TINTOS')).toBe(11667);
  });

  it('descripción con valores en conflicto se descarta (null), nunca se elige uno arbitrariamente', () => {
    const mapa = construirCatalogoHistoricoMantenimiento([
      { descripcion: 'EQUIPO AMBIGUO', valorMantenimientoCelda: 10000 },
      { descripcion: 'EQUIPO AMBIGUO', valorMantenimientoCelda: 20000 },
    ]);
    expect(mapa.get('EQUIPO AMBIGUO')).toBeNull();
  });

  it('ignora celdas de fórmula sin resultado cacheado (nunca evalúa la fórmula)', () => {
    const mapa = construirCatalogoHistoricoMantenimiento([
      { descripcion: 'EQUIPO SIN RESULTADO', valorMantenimientoCelda: { formula: '=A1/2' } },
    ]);
    expect(mapa.has('EQUIPO SIN RESULTADO')).toBe(false);
  });

  it('resuelve celdas de fórmula CON resultado cacheado (nunca las descarta como si fueran texto)', () => {
    const mapa = construirCatalogoHistoricoMantenimiento([
      { descripcion: 'EQUIPO CON FORMULA', valorMantenimientoCelda: { formula: '+D2/E2', result: 25000 } },
    ]);
    expect(mapa.get('EQUIPO CON FORMULA')).toBe(25000);
  });
});

describe('construirCatalogoPrimarioMantenimiento — omite filas sin descripción o sin valor resuelto', () => {
  it('omite filas sin descripción', () => {
    const cat = construirCatalogoPrimarioMantenimiento([{ descripcion: null, valorMesCelda: 1000, fila: 2 }]);
    expect(cat).toEqual([]);
  });

  it('omite filas cuyo valor no se pudo resolver', () => {
    const cat = construirCatalogoPrimarioMantenimiento([{ descripcion: 'X', valorMesCelda: 'no-numerico', fila: 2 }]);
    expect(cat).toEqual([]);
  });
});
