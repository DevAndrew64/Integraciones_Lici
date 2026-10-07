import { describe, expect, it } from 'vitest';
import {
  calcularTarifaServicio, calcularBaseIva, proponerRegimenIVA,
  resolverRegimenIVAEfectivo, resultadoTarifaEsFinal,
  proponerOrigenRegimenIVA, ETIQUETA_CRITERIO_IVA_CORTA, ETIQUETA_OPCION_REGIMEN_IVA,
  CRITERIO_APLICADO_REGIMEN, FUNDAMENTO_TRIBUTARIO_REGIMEN, clasificarTipoServicio,
  type EntradaTarifaServicio,
} from './calculo-tarifa-servicio';

const BASE: EntradaTarifaServicio = {
  manoObra: 215149562,
  insumos: 11955231,
  equipos: 14590557,
  costosAdministrativos: 28372509,
  regimenIVA: 'ASEO_CAFETERIA_ESPECIAL',
  porcentajeIU: 10,
  vigenciaMeses: 24,
};

describe('Caso exacto del Excel "COSTOS AJUSTADOS 06 ago.xlsx" (hoja RESUMEN) — prueba de regresión', () => {
  // NOTA DE AUDITORÍA: los 4 insumos exactos que dio el usuario
  // (215.149.562 + 11.955.231 + 14.590.557 + 28.372.509) suman
  // matemáticamente $270.067.859 — el Excel reporta $270.067.860 (Excel
  // tiene ~$1 de ruido de redondeo interno en sus celdas, algo común en
  // hojas con decimales ocultos). A partir de la suma EXACTA de los 4
  // insumos (nunca se fuerza a coincidir con una cifra reportada que no
  // es la suma real de los términos dados), la cadena reproduce el resto
  // del caso con una fidelidad de ±$1 frente al Excel, documentada aquí
  // en cada paso — nunca oculta.
  it('subtotal $270.067.859 (suma exacta de los 4 insumos dados), IU 10% → IVA $5.131.289, subtotal antes IVA $297.074.645 (coincide EXACTO con el Excel)', () => {
    const r = calcularTarifaServicio(BASE);
    expect(r.subtotalParaAiu).toBe(270067859);
    expect(r.iu).toBe(27006786); // round(270.067.859 × 10%) = 27.006.785,9 → 27.006.786
    expect(r.subtotalAntesIva).toBe(297074645); // coincide EXACTO con el Excel ($297.074.645)
    expect(r.regimenIVA).toBe('ASEO_CAFETERIA_ESPECIAL');
    expect(r.baseMinima10Aplicada).toBe(false); // IU ya es >= 10%, nunca se fuerza el mínimo
    expect(r.ivaBase).toBe(27006786); // baseIva === iu cuando porcentajeIU >= 10%
    expect(r.iva).toBe(5131289); // coincide EXACTO con el Excel ($5.131.289)
    // valorMesIncluidoIva = 297.074.645 + 5.131.289 = 302.205.934 — el
    // Excel reporta $302.205.935 (diferencia de $1, heredada del mismo
    // ruido de redondeo del subtotal de insumos, no un error de fórmula).
    expect(r.valorMesIncluidoIva).toBe(302205934);
    expect(r.vigenciaMeses).toBe(24);
    // Fórmula auditable (valorMesIncluidoIva × vigenciaMeses, sin
    // redondeos intermedios adicionales) — nunca se fuerza a coincidir
    // con la cifra del Excel ($7.252.942.435), que ya hereda el mismo $1
    // de diferencia arrastrado desde el subtotal de insumos.
    expect(r.valorTotalVigencia).toBe(302205934 * 24);
  });
});

describe('ASEO/CAFETERÍA — IU 8%/10%/12% (regla MAX(IU,10%) sobre subtotalParaAiu)', () => {
  it('IU 8% (< 10%) → se usa el mínimo del 10%, NUNCA el IU real (menor) — baseMinima10Aplicada=true', () => {
    const r = calcularTarifaServicio({ ...BASE, porcentajeIU: 8 });
    const iuReal8 = Math.round(270067859 * 0.08);
    expect(r.iu).toBe(iuReal8);
    expect(r.baseMinima10Aplicada).toBe(true);
    expect(r.ivaBase).toBe(Math.round(270067859 * 0.10)); // NUNCA iuReal8
    expect(r.ivaBase).not.toBe(iuReal8);
    expect(r.iva).toBe(Math.round(r.ivaBase * 0.19));
  });

  it('IU 10% (exacto) → baseIva === iu, sin forzar ningún mínimo adicional', () => {
    const r = calcularTarifaServicio({ ...BASE, porcentajeIU: 10 });
    expect(r.baseMinima10Aplicada).toBe(false);
    expect(r.ivaBase).toBe(r.iu);
  });

  it('IU 12% (> 10%) → baseIva === iu real (12%), NUNCA se recorta al 10%', () => {
    const r = calcularTarifaServicio({ ...BASE, porcentajeIU: 12 });
    const iuReal12 = Math.round(270067859 * 0.12);
    expect(r.iu).toBe(iuReal12);
    expect(r.baseMinima10Aplicada).toBe(false);
    expect(r.ivaBase).toBe(iuReal12);
    expect(r.iva).toBe(Math.round(iuReal12 * 0.19));
  });

  it('sin porcentajeIU configurado (null) → I.U. e IVA en 0, pendiente de configurar, nunca un valor inventado', () => {
    const r = calcularTarifaServicio({ ...BASE, porcentajeIU: null });
    expect(r.iu).toBe(0);
    expect(r.iuPendienteConfigurar).toBe(true);
    expect(r.ivaBase).toBe(0);
    expect(r.iva).toBe(0);
  });

  it('porcentajeIU = 0 explícito → se CONSERVA como 0 (configurado), NUNCA se convierte en "pendiente" como si fuera null', () => {
    const r = calcularTarifaServicio({ ...BASE, porcentajeIU: 0 });
    expect(r.iu).toBe(0);
    expect(r.porcentajeIU).toBe(0);
    expect(r.iuPendienteConfigurar).toBe(false); // 0 ES una configuración válida, distinta de "sin configurar"
    // con IU=0% (< 10%), el esquema de Aseo sigue forzando el mínimo del 10% sobre el subtotal
    expect(r.baseMinima10Aplicada).toBe(true);
    expect(r.ivaBase).toBe(Math.round(270067859 * 0.10));
  });
});

describe('resolverRegimenIVAEfectivo — prioridad explícita: confirmado > propuesta automática (nunca se recalcula por render)', () => {
  it('sin régimen confirmado (null/undefined) → usa la propuesta automática como provisional', () => {
    expect(resolverRegimenIVAEfectivo(null, 'ASEO_CAFETERIA_ESPECIAL')).toBe('ASEO_CAFETERIA_ESPECIAL');
    expect(resolverRegimenIVAEfectivo(undefined, 'IVA_PLENO')).toBe('IVA_PLENO');
  });

  it('régimen confirmado explícitamente prevalece SIEMPRE sobre la propuesta automática, aunque sean distintos', () => {
    expect(resolverRegimenIVAEfectivo('VIGILANCIA_ESPECIAL', 'ASEO_CAFETERIA_ESPECIAL')).toBe('VIGILANCIA_ESPECIAL');
    expect(resolverRegimenIVAEfectivo('IVA_PLENO', 'ASEO_CAFETERIA_ESPECIAL')).toBe('IVA_PLENO');
  });

  it('REQUIERE_REVISION guardado explícitamente es una decisión VÁLIDA que se respeta — nunca se confunde con "sin decisión" ni se sobrescribe por la propuesta', () => {
    expect(resolverRegimenIVAEfectivo('REQUIERE_REVISION', 'ASEO_CAFETERIA_ESPECIAL')).toBe('REQUIERE_REVISION');
  });
});

describe('resultadoTarifaEsFinal — Ajuste "CORRIGE EL FLUJO DE GESTIONAR TARIFA": FINAL con %I.U. + régimen EFECTIVO clasificable, SIN exigir confirmación manual', () => {
  it('sin porcentajeIU (null/undefined) → provisional, aunque el régimen efectivo ya esté clasificado', () => {
    expect(resultadoTarifaEsFinal(null, 'IVA_PLENO')).toBe(false);
    expect(resultadoTarifaEsFinal(undefined, 'IVA_PLENO')).toBe(false);
  });

  it('porcentajeIU = 0 explícito SÍ cuenta como configurado (no bloquea la finalización por sí solo)', () => {
    expect(resultadoTarifaEsFinal(0, 'IVA_PLENO')).toBe(true);
  });

  it('régimen efectivo = REQUIERE_REVISION → SIEMPRE provisional (el único caso que exige intervención humana), aunque exista %I.U.', () => {
    expect(resultadoTarifaEsFinal(10, 'REQUIERE_REVISION')).toBe(false);
  });

  it('con %I.U. configurado (incluido 0%) Y régimen efectivo distinto de REQUIERE_REVISION → FINAL, SIN exigir un override/confirmación manual previa', () => {
    expect(resultadoTarifaEsFinal(10, 'ASEO_CAFETERIA_ESPECIAL')).toBe(true);
    expect(resultadoTarifaEsFinal(0, 'VIGILANCIA_ESPECIAL')).toBe(true);
    expect(resultadoTarifaEsFinal(19, 'IVA_PLENO')).toBe(true);
  });
});

describe('Estructuras históricas sin porcentajeIU/regimenIVAConfirmado — nunca fallan, nunca inventan un valor', () => {
  it('calcularTarifaServicio con porcentajeIU:null y regimenIVA propuesto (proceso histórico sin configuración guardada) produce un resultado válido, provisional', () => {
    const propuesto = proponerRegimenIVA(['Aseador']);
    const r = calcularTarifaServicio({ ...BASE, porcentajeIU: null, regimenIVA: resolverRegimenIVAEfectivo(null, propuesto) });
    expect(r.iuPendienteConfigurar).toBe(true);
    expect(r.iva).toBe(0);
    expect(resultadoTarifaEsFinal(r.porcentajeIU, propuesto)).toBe(false);
  });
});

describe('IVA_PLENO — servicios generales SOLOS (ej. todero/conserje/jardinero sin Aseo/Vigilancia)', () => {
  it('baseIva = subtotalAntesIva (nunca solo I.U.); iva = baseIva × 19%', () => {
    const r = calcularTarifaServicio({ ...BASE, regimenIVA: 'IVA_PLENO', porcentajeIU: 10 });
    expect(r.ivaBase).toBe(r.subtotalAntesIva);
    expect(r.ivaBase).not.toBe(r.iu); // nunca la misma base que el esquema de Aseo
    expect(r.iva).toBe(Math.round(r.subtotalAntesIva * 0.19));
  });

  it('caso numérico simple: subtotal $100.000.000 sin I.U. (0%) → baseIva=$100.000.000, iva=$19.000.000', () => {
    const r = calcularTarifaServicio({
      manoObra: 100000000, insumos: 0, equipos: 0, costosAdministrativos: 0,
      regimenIVA: 'IVA_PLENO', porcentajeIU: 0, vigenciaMeses: 12,
    });
    expect(r.subtotalParaAiu).toBe(100000000);
    expect(r.iu).toBe(0);
    expect(r.subtotalAntesIva).toBe(100000000);
    expect(r.ivaBase).toBe(100000000);
    expect(r.iva).toBe(19000000);
    expect(r.valorMesIncluidoIva).toBe(119000000);
  });
});

describe('VIGILANCIA_ESPECIAL — regla SEPARADA, NUNCA la misma fórmula matemática que Aseo', () => {
  it('baseIva = subtotalAntesIva × 10% (nunca MAX(IU,10%) sobre subtotalParaAiu); iva = baseIva × 19%', () => {
    const r = calcularTarifaServicio({ ...BASE, regimenIVA: 'VIGILANCIA_ESPECIAL', porcentajeIU: 10 });
    expect(r.ivaBase).toBe(Math.round(r.subtotalAntesIva * 0.10));
    expect(r.ivaBase).not.toBe(r.iu); // la fórmula de Aseo daría baseIva=iu aquí — Vigilancia nunca coincide
    expect(r.iva).toBe(Math.round(r.ivaBase * 0.19));
  });

  it('caso numérico simple: subtotalAntesIva $200.000.000 → baseIva=$20.000.000, iva=$3.800.000 (200.000.000 × 1,9%)', () => {
    const r = calcularTarifaServicio({
      manoObra: 200000000, insumos: 0, equipos: 0, costosAdministrativos: 0,
      regimenIVA: 'VIGILANCIA_ESPECIAL', porcentajeIU: 0, vigenciaMeses: 12,
    });
    expect(r.subtotalAntesIva).toBe(200000000);
    expect(r.ivaBase).toBe(20000000);
    expect(r.iva).toBe(3800000);
  });

  it('demuestra explícitamente la diferencia matemática Aseo vs. Vigilancia con el MISMO subtotal e IU — nunca deben coincidir salvo casualidad numérica', () => {
    const aseo = calcularTarifaServicio({ ...BASE, regimenIVA: 'ASEO_CAFETERIA_ESPECIAL', porcentajeIU: 15 });
    const vigilancia = calcularTarifaServicio({ ...BASE, regimenIVA: 'VIGILANCIA_ESPECIAL', porcentajeIU: 15 });
    expect(aseo.subtotalAntesIva).toBe(vigilancia.subtotalAntesIva); // mismo insumo, mismo IU
    expect(aseo.ivaBase).not.toBe(vigilancia.ivaBase); // pero bases de IVA distintas
    expect(aseo.iva).not.toBe(vigilancia.iva);
  });
});

describe('REQUIERE_REVISION — sin clasificar todavía, nunca se inventa un régimen', () => {
  it('IVA/base en 0 mientras no se clasifique explícitamente', () => {
    const r = calcularTarifaServicio({ ...BASE, regimenIVA: 'REQUIERE_REVISION' });
    expect(r.ivaBase).toBe(0);
    expect(r.iva).toBe(0);
  });
});

describe('proponerRegimenIVA — regla interna de la empresa (Aseo/Cafetería > Vigilancia > IVA pleno), NUNCA doctrina/interpretación automática de nombres', () => {
  it('ASEO solo → ASEO_CAFETERIA_ESPECIAL', () => {
    expect(proponerRegimenIVA(['Aseador'])).toBe('ASEO_CAFETERIA_ESPECIAL');
  });

  it('ASEO + CAFETERÍA → ASEO_CAFETERIA_ESPECIAL', () => {
    expect(proponerRegimenIVA(['Aseador', 'Auxiliar de cafetería'])).toBe('ASEO_CAFETERIA_ESPECIAL');
  });

  it('VIGILANCIA sola → VIGILANCIA_ESPECIAL', () => {
    expect(proponerRegimenIVA(['Vigilante'])).toBe('VIGILANCIA_ESPECIAL');
  });

  it('Ajuste "IMPLEMENTAR SERVICIOS TEMPORALES / PERSONAL EN MISIÓN" §2/§9 — un cargo genérico SOLO (todero/conserje/jardinero), SIN evidencia explícita de modalidad, ya NO cae automáticamente en IVA_PLENO: queda REQUIERE_REVISION', () => {
    expect(proponerRegimenIVA(['Todero'])).toBe('REQUIERE_REVISION');
    expect(proponerRegimenIVA(['Conserje'])).toBe('REQUIERE_REVISION');
    expect(proponerRegimenIVA(['Jardinero'])).toBe('REQUIERE_REVISION');
  });

  it('cargo genérico + evidencia EXPLÍCITA de modalidad "servicio general" → IVA_PLENO', () => {
    expect(proponerRegimenIVA(['Jardinero', 'Servicio general'])).toBe('IVA_PLENO');
    expect(proponerRegimenIVA(['Todero', 'Servicios generales'])).toBe('IVA_PLENO');
  });

  it('cargo genérico + evidencia EXPLÍCITA de "personal en misión"/"servicios temporales" → SERVICIOS_TEMPORALES_ESPECIAL', () => {
    expect(proponerRegimenIVA(['Jardinero', 'Personal en misión'])).toBe('SERVICIOS_TEMPORALES_ESPECIAL');
    expect(proponerRegimenIVA(['Todero', 'Servicio temporal'])).toBe('SERVICIOS_TEMPORALES_ESPECIAL');
    expect(proponerRegimenIVA(['Auxiliar', 'TEMPOCOLBA'])).toBe('SERVICIOS_TEMPORALES_ESPECIAL');
  });

  it('cargo desconocido, sin ninguna señal de modalidad → REQUIERE_REVISION, nunca un "cajón de sastre" en IVA_PLENO', () => {
    expect(proponerRegimenIVA(['Operario'])).toBe('REQUIERE_REVISION');
  });

  it('proceso con Aseo + otro cargo (jardinero/todero) → SIGUE siendo ASEO_CAFETERIA_ESPECIAL, NUNCA cambia automáticamente a IVA_PLENO', () => {
    expect(proponerRegimenIVA(['Aseador', 'Jardinero'])).toBe('ASEO_CAFETERIA_ESPECIAL');
    expect(proponerRegimenIVA(['Jardinero', 'Aseador'])).toBe('ASEO_CAFETERIA_ESPECIAL');
    expect(proponerRegimenIVA(['Todero', 'Auxiliar de aseo'])).toBe('ASEO_CAFETERIA_ESPECIAL');
  });

  it('proceso con Vigilancia + otro cargo → sigue siendo VIGILANCIA_ESPECIAL (misma prioridad, nunca cae a IVA pleno)', () => {
    expect(proponerRegimenIVA(['Vigilante', 'Todero'])).toBe('VIGILANCIA_ESPECIAL');
  });

  it('sin conceptos (proceso vacío) → REQUIERE_REVISION, nunca un default arbitrario', () => {
    expect(proponerRegimenIVA([])).toBe('REQUIERE_REVISION');
    expect(proponerRegimenIVA(['', '  '])).toBe('REQUIERE_REVISION');
  });
});

describe('proponerOrigenRegimenIVA — Ajuste "CASO ESPECIAL: SOLO ASEO" §4/§5: distingue FUENTE_NORMATIVA de POLITICA_INTERNA, nunca las mezcla', () => {
  it('ASEO solo (sin Cafetería) → POLITICA_INTERNA, aunque el régimen propuesto sea ASEO_CAFETERIA_ESPECIAL', () => {
    expect(proponerRegimenIVA(['Aseador'])).toBe('ASEO_CAFETERIA_ESPECIAL');
    expect(proponerOrigenRegimenIVA(['Aseador'])).toBe('POLITICA_INTERNA');
  });

  it('ASEO + CAFETERÍA integrada → FUENTE_NORMATIVA (Art. 462-1 E.T. cubre expresamente el servicio integral)', () => {
    expect(proponerOrigenRegimenIVA(['Aseador', 'Auxiliar de cafetería'])).toBe('FUENTE_NORMATIVA');
  });

  it('VIGILANCIA → siempre FUENTE_NORMATIVA (sin variante por decisión comercial)', () => {
    expect(proponerOrigenRegimenIVA(['Vigilante'])).toBe('FUENTE_NORMATIVA');
  });

  it('SERVICIOS GENERALES SOLOS (IVA pleno) → FUENTE_NORMATIVA', () => {
    expect(proponerOrigenRegimenIVA(['Todero'])).toBe('FUENTE_NORMATIVA');
  });

  it('ASEO + otro cargo general (jardinero/todero), sin Cafetería → sigue siendo POLITICA_INTERNA (el cargo adicional no es Cafetería)', () => {
    expect(proponerOrigenRegimenIVA(['Aseador', 'Jardinero'])).toBe('POLITICA_INTERNA');
  });

  it('sin conceptos (proceso vacío) → FUENTE_NORMATIVA (default neutro; no hay Aseo detectado que dispare la política interna)', () => {
    expect(proponerOrigenRegimenIVA([])).toBe('FUENTE_NORMATIVA');
  });
});

describe('ETIQUETA_CRITERIO_IVA_CORTA — texto corto para la cabecera de Resultado (Ajuste "AJUSTA LA CABECERA DE DETALLE DE LA TARIFA"), NUNCA menciona el origen (norma/política interna/override)', () => {
  it('Aseo/Cafetería → "Base especial AIU" (igual para Aseo+Cafetería integrada y para Aseo solo por política interna — el origen nunca se muestra)', () => {
    expect(ETIQUETA_CRITERIO_IVA_CORTA.ASEO_CAFETERIA_ESPECIAL).toBe('Base especial AIU');
  });

  it('Vigilancia → "Base especial"; IVA pleno → "IVA pleno"; Requiere revisión → "Pendiente de definición"', () => {
    expect(ETIQUETA_CRITERIO_IVA_CORTA.VIGILANCIA_ESPECIAL).toBe('Base especial');
    expect(ETIQUETA_CRITERIO_IVA_CORTA.IVA_PLENO).toBe('IVA pleno');
    expect(ETIQUETA_CRITERIO_IVA_CORTA.REQUIERE_REVISION).toBe('Pendiente de definición');
  });

  it('ninguna etiqueta menciona "política interna", "norma" ni "override" (esa distinción es trazabilidad interna, nunca texto visible)', () => {
    Object.values(ETIQUETA_CRITERIO_IVA_CORTA).forEach(etiqueta => {
      expect(etiqueta.toLowerCase()).not.toContain('política');
      expect(etiqueta.toLowerCase()).not.toContain('override');
      expect(etiqueta.toLowerCase()).not.toContain('confirmad');
    });
  });
});

describe('CRITERIO_APLICADO_REGIMEN / FUNDAMENTO_TRIBUTARIO_REGIMEN — Ajuste "DETALLE DESPLEGABLE DE IVA"/"MODAL GESTIONAR TARIFA": una entrada por régimen, con fuente citada', () => {
  it('las 5 claves de RegimenIVA tienen criterio aplicado y fundamento tributario (título, texto y fuente)', () => {
    (['ASEO_CAFETERIA_ESPECIAL', 'VIGILANCIA_ESPECIAL', 'SERVICIOS_TEMPORALES_ESPECIAL', 'IVA_PLENO', 'REQUIERE_REVISION'] as const).forEach(regimen => {
      expect(CRITERIO_APLICADO_REGIMEN[regimen]).toBeTruthy();
      expect(FUNDAMENTO_TRIBUTARIO_REGIMEN[regimen].titulo).toBeTruthy();
      expect(FUNDAMENTO_TRIBUTARIO_REGIMEN[regimen].texto).toBeTruthy();
      expect(FUNDAMENTO_TRIBUTARIO_REGIMEN[regimen].fuente).toBeTruthy();
    });
  });

  it('Aseo/Cafetería y Vigilancia citan Art. 462-1 E.T.; IVA pleno cita Art. 447 E.T.', () => {
    expect(FUNDAMENTO_TRIBUTARIO_REGIMEN.ASEO_CAFETERIA_ESPECIAL.fuente).toBe('Art. 462-1 Estatuto Tributario');
    expect(FUNDAMENTO_TRIBUTARIO_REGIMEN.VIGILANCIA_ESPECIAL.fuente).toBe('Art. 462-1 Estatuto Tributario');
    expect(FUNDAMENTO_TRIBUTARIO_REGIMEN.IVA_PLENO.fuente).toBe('Art. 447 Estatuto Tributario');
  });
});

describe('calcularBaseIva — función pura independiente, mismo resultado que calcularTarifaServicio (nunca una fórmula paralela)', () => {
  it('ASEO_CAFETERIA_ESPECIAL con porcentajeIU null → 0, nunca un régimen "adivinado"', () => {
    const r = calcularBaseIva({ regimenIVA: 'ASEO_CAFETERIA_ESPECIAL', subtotalParaAiu: 270067859, porcentajeIU: null, iu: 0, subtotalAntesIva: 270067859 });
    expect(r.baseIva).toBe(0);
    expect(r.iva).toBe(0);
  });
});

describe('SERVICIOS_TEMPORALES_ESPECIAL — Ajuste "IMPLEMENTAR SERVICIOS TEMPORALES / PERSONAL EN MISIÓN" §6/§10: rama EXPLÍCITA propia, NUNCA la fórmula de Vigilancia', () => {
  it('con porcentajeIU >= 10%: baseIva = subtotalParaAiu × IU% (igual patrón que Aseo, mínimo 10% sobre subtotalParaAiu — nunca 10% de subtotalAntesIva como Vigilancia)', () => {
    const r = calcularBaseIva({ regimenIVA: 'SERVICIOS_TEMPORALES_ESPECIAL', subtotalParaAiu: 270067859, porcentajeIU: 10, iu: 27006786, subtotalAntesIva: 297074645 });
    expect(r.baseMinima10Aplicada).toBe(false);
    expect(r.baseIva).toBe(27006786); // 270.067.859 × 10% = mismo valor que el IU
    expect(r.iva).toBe(5131289); // 27.006.786 × 19%
  });

  it('con porcentajeIU < 10%: se usa el mínimo del 10% sobre subtotalParaAiu, nunca el IU real (menor) — mismo tratamiento que Aseo, en una rama propia', () => {
    const r = calcularBaseIva({ regimenIVA: 'SERVICIOS_TEMPORALES_ESPECIAL', subtotalParaAiu: 100000000, porcentajeIU: 5, iu: 5000000, subtotalAntesIva: 105000000 });
    expect(r.baseMinima10Aplicada).toBe(true);
    expect(r.baseIva).toBe(10000000); // 100.000.000 × 10% (mínimo), NUNCA el IU real (5.000.000)
    expect(r.iva).toBe(1900000);
  });

  it('demuestra matemáticamente que NO es la misma fórmula que VIGILANCIA_ESPECIAL con los mismos insumos', () => {
    const params = { subtotalParaAiu: 200000000, porcentajeIU: 8, iu: 16000000, subtotalAntesIva: 216000000 };
    const temporales = calcularBaseIva({ regimenIVA: 'SERVICIOS_TEMPORALES_ESPECIAL', ...params });
    const vigilancia = calcularBaseIva({ regimenIVA: 'VIGILANCIA_ESPECIAL', ...params });
    expect(temporales.baseIva).not.toBe(vigilancia.baseIva);
    expect(temporales.iva).not.toBe(vigilancia.iva);
  });

  it('sin porcentajeIU configurado → 0, nunca un régimen "adivinado"', () => {
    const r = calcularBaseIva({ regimenIVA: 'SERVICIOS_TEMPORALES_ESPECIAL', subtotalParaAiu: 200000000, porcentajeIU: null, iu: 0, subtotalAntesIva: 200000000 });
    expect(r.baseIva).toBe(0);
    expect(r.iva).toBe(0);
  });

  it('calcularTarifaServicio con regimenIVA=SERVICIOS_TEMPORALES_ESPECIAL produce un resultado consistente (identidades transversales)', () => {
    const r = calcularTarifaServicio({ ...BASE, regimenIVA: 'SERVICIOS_TEMPORALES_ESPECIAL' });
    expect(r.subtotalAntesIva).toBe(r.subtotalParaAiu + r.iu);
    expect(r.valorMesIncluidoIva).toBe(r.subtotalAntesIva + r.iva);
    expect(r.iva).toBeGreaterThan(0);
  });
});

describe('ETIQUETA_OPCION_REGIMEN_IVA — Ajuste "ELIMINA REQUIERE REVISIÓN DEL SELECTOR VISIBLE" §8: solo los 4 regímenes REALES, nunca REQUIERE_REVISION', () => {
  it('cubre exactamente los 4 regímenes seleccionables, con el sufijo "Base especial AIU"/"Base general"', () => {
    expect(ETIQUETA_OPCION_REGIMEN_IVA.ASEO_CAFETERIA_ESPECIAL).toBe('Aseo y Cafetería — Base especial AIU');
    expect(ETIQUETA_OPCION_REGIMEN_IVA.VIGILANCIA_ESPECIAL).toBe('Vigilancia — Base especial AIU');
    expect(ETIQUETA_OPCION_REGIMEN_IVA.SERVICIOS_TEMPORALES_ESPECIAL).toBe('Personal en misión / Servicios temporales — Base especial AIU');
    expect(ETIQUETA_OPCION_REGIMEN_IVA.IVA_PLENO).toBe('IVA pleno — Base general');
  });

  it('no incluye una entrada para REQUIERE_REVISION (TypeScript ya lo impide en el tipo, esto lo confirma en tiempo de ejecución)', () => {
    expect(Object.keys(ETIQUETA_OPCION_REGIMEN_IVA)).not.toContain('REQUIERE_REVISION');
    expect(Object.keys(ETIQUETA_OPCION_REGIMEN_IVA)).toHaveLength(4);
  });
});

describe('Validaciones matemáticas obligatorias (identidades transversales, cualquier régimen)', () => {
  it('1) manoObra + insumos + equipos + costosAdministrativos = subtotalParaAiu', () => {
    const r = calcularTarifaServicio(BASE);
    expect(r.subtotalParaAiu).toBe(r.manoObra + r.insumos + r.equipos + r.costosAdministrativos);
  });

  it('2) subtotalParaAiu + iu = subtotalAntesIva', () => {
    const r = calcularTarifaServicio(BASE);
    expect(r.subtotalAntesIva).toBe(r.subtotalParaAiu + r.iu);
  });

  it('3) baseIva × tarifaIva/100 = iva (para cualquier régimen con base > 0)', () => {
    for (const regimenIVA of ['ASEO_CAFETERIA_ESPECIAL', 'VIGILANCIA_ESPECIAL', 'SERVICIOS_TEMPORALES_ESPECIAL', 'IVA_PLENO'] as const) {
      const r = calcularTarifaServicio({ ...BASE, regimenIVA });
      expect(r.iva).toBe(Math.round((r.ivaBase * r.tarifaIva) / 100));
      expect(r.tarifaIva).toBe(19);
    }
  });

  it('4) subtotalAntesIva + iva = valorMesIncluidoIva', () => {
    const r = calcularTarifaServicio(BASE);
    expect(r.valorMesIncluidoIva).toBe(r.subtotalAntesIva + r.iva);
  });

  it('5) valorMesIncluidoIva × vigenciaMeses = valorTotalVigencia', () => {
    const r = calcularTarifaServicio({ ...BASE, vigenciaMeses: 36 });
    expect(r.valorTotalVigencia).toBe(r.valorMesIncluidoIva * 36);
  });

  it('5b) vigencia inválida (0/negativa/NaN) → valorTotalVigencia null, nunca un número inventado', () => {
    expect(calcularTarifaServicio({ ...BASE, vigenciaMeses: 0 }).valorTotalVigencia).toBeNull();
    expect(calcularTarifaServicio({ ...BASE, vigenciaMeses: -1 }).valorTotalVigencia).toBeNull();
    expect(calcularTarifaServicio({ ...BASE, vigenciaMeses: NaN }).valorTotalVigencia).toBeNull();
  });

  it('6) no existe doble conteo: los 4 términos fuente + I.U. entran EXACTAMENTE una vez cada uno hacia subtotalAntesIva; IVA nunca se suma dos veces', () => {
    const r = calcularTarifaServicio({ ...BASE, regimenIVA: 'IVA_PLENO' });
    expect(r.subtotalAntesIva).toBe(r.manoObra + r.insumos + r.equipos + r.costosAdministrativos + r.iu);
    expect(r.valorMesIncluidoIva).toBe(r.subtotalAntesIva + r.iva);
    expect(r.iva).toBeGreaterThan(0);
  });

  it('redondeo único: los 4 totales fuente se redondean UNA vez al recibirse', () => {
    const r = calcularTarifaServicio({ ...BASE, manoObra: 100.4, insumos: 50.6, equipos: 0, costosAdministrativos: 0, porcentajeIU: null });
    expect(r.manoObra).toBe(100);
    expect(r.insumos).toBe(51);
    expect(r.subtotalParaAiu).toBe(151);
  });
});

describe('clasificarTipoServicio — Ajuste "CORRIGE LA CABECERA DE DETALLE DE LA TARIFA": clasificación FUNCIONAL, completamente separada de proponerRegimenIVA', () => {
  it('Aseo solo → "Aseo"; Aseo + Cafetería → "Aseo y Cafetería"; Cafetería sola → "Cafetería"', () => {
    expect(clasificarTipoServicio(['Aseador'])).toBe('Aseo');
    expect(clasificarTipoServicio(['Aseador', 'Auxiliar de cafetería'])).toBe('Aseo y Cafetería');
    expect(clasificarTipoServicio(['Auxiliar de cafetería'])).toBe('Cafetería');
  });

  it('Vigilancia → "Vigilancia"; Personal en misión/TEMPOCOLBA → "Personal en misión"', () => {
    expect(clasificarTipoServicio(['Vigilante'])).toBe('Vigilancia');
    expect(clasificarTipoServicio(['Auxiliar', 'TEMPOCOLBA'])).toBe('Personal en misión');
  });

  it('cargo de un oficio + señal de personal en misión → "Mixto" (son dos categorías reales distintas, nunca se descarta una)', () => {
    expect(clasificarTipoServicio(['Jardinero', 'Personal en misión'])).toBe('Mixto');
  });

  it('Jardinero/Todero/Conserje solos, sin ninguna otra señal → su propia categoría, NUNCA "IVA pleno"/"Base especial AIU" ni un código de RegimenIVA', () => {
    expect(clasificarTipoServicio(['Jardinero'])).toBe('Jardinería');
    expect(clasificarTipoServicio(['Todero'])).toBe('Todero');
    expect(clasificarTipoServicio(['Conserje'])).toBe('Conserjería');
  });

  it('evidencia explícita de "servicio general" (sin otro oficio detectado) → "Servicios generales"', () => {
    expect(clasificarTipoServicio(['Servicio general'])).toBe('Servicios generales');
  });

  it('más de una categoría detectada (ej. Aseo + Vigilancia) → "Mixto"', () => {
    expect(clasificarTipoServicio(['Aseador', 'Vigilante'])).toBe('Mixto');
  });

  it('sin conceptos o cargo desconocido sin señales → "No determinado" (nunca inventa una categoría)', () => {
    expect(clasificarTipoServicio([])).toBe('No determinado');
    expect(clasificarTipoServicio(['', '  '])).toBe('No determinado');
    expect(clasificarTipoServicio(['Operario'])).toBe('No determinado');
  });

  it('nunca devuelve un valor de RegimenIVA (IVA_PLENO, ASEO_CAFETERIA_ESPECIAL, VIGILANCIA_ESPECIAL, SERVICIOS_TEMPORALES_ESPECIAL, REQUIERE_REVISION) ni el texto "Base especial AIU"', () => {
    const prohibidos = ['IVA_PLENO', 'ASEO_CAFETERIA_ESPECIAL', 'VIGILANCIA_ESPECIAL', 'SERVICIOS_TEMPORALES_ESPECIAL', 'REQUIERE_REVISION', 'Base especial AIU', 'IVA pleno'];
    const casos = [['Aseador'], ['Vigilante'], ['Jardinero', 'Servicio general'], ['Jardinero', 'Personal en misión'], ['Todero'], []];
    casos.forEach(caso => {
      const resultado = clasificarTipoServicio(caso);
      prohibidos.forEach(p => expect(resultado).not.toBe(p));
    });
  });
});
