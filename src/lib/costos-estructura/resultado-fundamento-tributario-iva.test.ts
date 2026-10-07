/**
 * Ajuste "FUNDAMENTO TRIBUTARIO DEL RÉGIMEN IVA" + "CORRIGE EL FLUJO DE
 * GESTIONAR TARIFA" + "AJUSTA LA CABECERA DE DETALLE DE LA TARIFA"
 * (confirmados explícitamente, en ese orden) — verificación de cableado
 * en page.tsx del diseño FINAL: (1) la cabecera comercial de Resultado
 * muestra "Régimen IVA: {criterio corto}" (o una alerta si es
 * REQUIERE_REVISION) y NUNCA menciona norma/política interna/override —
 * eso es trazabilidad interna; (2) el régimen se determina AUTOMÁTICAMENTE
 * (política interna incluida) SIN checkbox ni confirmación manual; (3) el
 * selector manual de régimen solo aparece si es REQUIERE_REVISION o si
 * `esAdminCostos` pulsa la acción explícita "Cambiar régimen"; (4)
 * Resultado es FINAL con %I.U. configurado y régimen efectivo clasificado,
 * sin exigir un paso adicional; (5) la trazabilidad del override
 * (fecha/usuario) la persiste el mismo bloque JSON de Costos
 * Administrativos, siempre con datos del SERVIDOR. Mismo patrón `bloque()`
 * que el resto de guardado-modular-*.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PAGE_TSX = readFileSync(join(__dirname, '../../app/page.tsx'), 'utf-8');

function bloque(inicioMarcador: string, finMarcador: string, desde = 0): string {
  const inicio = PAGE_TSX.indexOf(inicioMarcador, desde);
  if (inicio === -1) throw new Error(`No se encontró el marcador de inicio: ${inicioMarcador}`);
  const fin = PAGE_TSX.indexOf(finMarcador, inicio);
  if (fin === -1) throw new Error(`No se encontró el marcador de fin: ${finMarcador}`);
  return PAGE_TSX.slice(inicio, fin);
}

describe('Cabecera "Detalle de la tarifa" — Ajuste "CORRIGE LA CABECERA DE DETALLE DE LA TARIFA": Tipo de servicio y Régimen IVA son datos SEPARADOS', () => {
  it('"Tipo de servicio" usa tipoServicioClasificado (clasificarTipoServicio), NUNCA ETIQUETA_REGIMEN_IVA[regimenIVAEfectivo] — el régimen tributario nunca se muestra como si fuera el tipo de servicio', () => {
    const b = bloque('Detalle de la tarifa</div>', '<div style={{border:\'1px solid #e5e9f0\',borderRadius:10,padding:\'2px 14px\'}}>');
    expect(b).toContain('Tipo de servicio: <b style={{color:\'#374151\'}}>{tipoServicioClasificado}</b>');
    expect(b).not.toContain("Tipo de servicio: <b style={{color:'#374151'}}>{ETIQUETA_REGIMEN_IVA[regimenIVAEfectivo]}</b>");
  });

  it('tipoServicioClasificado se calcula con clasificarTipoServicio, una función completamente separada de proponerRegimenIVA', () => {
    const b = bloque('const tipoServicioClasificado=React.useMemo(', ');');
    expect(b).toContain('clasificarTipoServicio(conceptosServicioProceso)');
  });

  it('muestra "Régimen IVA: {criterio corto}" (ETIQUETA_CRITERIO_IVA_CORTA) cuando el régimen es clasificable', () => {
    const b = bloque('Detalle de la tarifa</div>', '<div style={{border:\'1px solid #e5e9f0\',borderRadius:10,padding:\'2px 14px\'}}>');
    expect(b).toContain('Régimen IVA: <b');
    expect(b).toContain('ETIQUETA_CRITERIO_IVA_CORTA[regimenIVAEfectivo]');
  });

  it('muestra la alerta "Régimen IVA pendiente de definición" cuando el régimen efectivo es REQUIERE_REVISION, en vez del criterio', () => {
    const b = bloque('Detalle de la tarifa</div>', '<div style={{border:\'1px solid #e5e9f0\',borderRadius:10,padding:\'2px 14px\'}}>');
    expect(b).toContain("regimenIVAEfectivo==='REQUIERE_REVISION'");
    expect(b).toContain('Régimen IVA pendiente de definición');
  });

  it('NUNCA renderiza "Política interna confirmada", "Régimen sugerido:" ni "Régimen confirmado:" como texto visible en esta cabecera (solo puede aparecer en comentarios de código, no en JSX)', () => {
    const b = bloque('const esFinal=resultadoTarifaEsFinalCalculado;', '<div style={{border:\'1px solid #e5e9f0\',borderRadius:10,padding:\'2px 14px\'}}>')
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
    expect(b).not.toContain('Política interna confirmada');
    expect(b).not.toContain('Régimen sugerido:');
    expect(b).not.toContain('Régimen confirmado:');
  });

  it('"Ver fundamento" queda como acción secundaria/discreta que despliega FUNDAMENTO_TRIBUTARIO_REGIMEN, nunca un párrafo legal siempre visible', () => {
    const b = bloque('Detalle de la tarifa</div>', 'Empresa: <b');
    expect(b).not.toContain('Estatuto Tributario');
    const b2 = bloque('Ver fundamento', '<div style={{border:\'1px solid #e5e9f0\',borderRadius:10,padding:\'2px 14px\'}}>');
    expect(b2).toContain('FUNDAMENTO_TRIBUTARIO_REGIMEN[rts.regimenIVA]');
  });
});

describe('Determinación automática del régimen — Ajuste "CORRIGE EL FLUJO DE GESTIONAR TARIFA" §1/§2/§6: SIN checkbox ni confirmación manual', () => {
  it('no existe ningún checkbox ni texto "Confirmo el tratamiento especial…" en todo page.tsx', () => {
    expect(PAGE_TSX).not.toContain('Confirmo el tratamiento especial');
    expect(PAGE_TSX).not.toContain('confirmacionPoliticaInternaAseoInput');
  });

  it('resultadoTarifaEsFinalCalculado usa el régimen EFECTIVO (automático u override), no un "confirmado" nulo por defecto', () => {
    const b = bloque('const resultadoTarifaEsFinalCalculado=', ';');
    expect(b).toContain('resultadoTarifaEsFinal(porcentajeIU,regimenIVAEfectivo)');
  });

  it('el banner de "provisional" ya no exige "confirmar el régimen" — solo REQUIERE_REVISION lo deja pendiente', () => {
    const b = bloque("faltaIU?'Configura", "'}");
    expect(b).toContain('Configura el porcentaje I.U. para obtener la tarifa final.');
    expect(b).toContain('Régimen IVA pendiente de definición (requiere revisión).');
    expect(b).not.toContain('confirma el régimen IVA');
  });

  it('la fila principal de IVA solo muestra el badge "Requiere revisión" cuando el régimen es REQUIERE_REVISION, nunca por falta de %I.U.', () => {
    const b = bloque('<FilaTarifaServicio numero={6} titulo="IVA"', 'valor={rts.iva}');
    expect(b).toContain("badge={rts.regimenIVA==='REQUIERE_REVISION'&&<BadgeChico texto=\"Requiere revisión\" tono=\"ambar\"/>}");
  });
});

describe('Modal "Gestionar tarifa" — selector manual OCULTO por defecto (Ajuste "CORRIGE EL FLUJO DE GESTIONAR TARIFA" §3/§5/§8)', () => {
  it('mostrarSelectorRegimenIVA solo es true si el régimen propuesto es REQUIERE_REVISION o si esAdminCostos activó el override', () => {
    const b = bloque('const mostrarSelectorRegimenIVA=', ';');
    expect(b).toContain("regimenIvaPropuesto==='REQUIERE_REVISION'");
    expect(b).toContain('esAdminCostos&&mostrarOverrideAdminRegimen');
  });

  it('por defecto se muestra solo informativo/read-only, SIN badge "Automático"/"Ajustado por administrador" permanente (Ajuste "SIMPLIFICA VISUALMENTE GESTIONAR TARIFA" §1), nunca un <select> editable', () => {
    const b = bloque('<div style={{fontSize:11,fontWeight:700,color:\'#475569\',marginBottom:6}}>Régimen IVA</div>', '</select>')
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
    expect(b).toContain('!mostrarSelectorRegimenIVA');
    expect(b).not.toContain('Ajustado por administrador');
    expect(b).not.toContain('BadgeChico');
  });

  it('la acción "Cambiar régimen" (para revelar el <select>) solo se ofrece a esAdminCostos', () => {
    const b = bloque('<div style={{fontSize:11,fontWeight:700,color:\'#475569\',marginBottom:6}}>Régimen IVA</div>', '</select>');
    expect(b).toContain('{esAdminCostos&&(');
    expect(b).toContain('Cambiar régimen');
  });

  it('el <select>, cuando aparece, ya no ofrece "Sin confirmar" NI "Requiere revisión" como opción — solo los 4 regímenes reales (Ajuste "ELIMINA REQUIERE REVISIÓN DEL SELECTOR VISIBLE")', () => {
    const b = bloque('<div style={{fontSize:11,fontWeight:700,color:\'#475569\',marginBottom:6}}>Régimen IVA</div>', '</select>');
    expect(b).not.toContain('Sin confirmar');
    expect(b).not.toContain('<option value="REQUIERE_REVISION"');
    expect(b).toContain('<option value="ASEO_CAFETERIA_ESPECIAL"');
    expect(b).toContain('<option value="VIGILANCIA_ESPECIAL"');
    expect(b).toContain('<option value="SERVICIOS_TEMPORALES_ESPECIAL"');
    expect(b).toContain('<option value="IVA_PLENO"');
  });

  it('"Criterio tributario" es siempre informativo (sin checkbox, sin advertencia grande) y sigue el régimen seleccionado/efectivo', () => {
    const b = bloque('Criterio tributario', 'configTarifaMsg&&');
    expect(b).toContain('regimenParaCriterio');
    expect(b).toContain('FUNDAMENTO_TRIBUTARIO_REGIMEN[regimenParaCriterio]');
    expect(b).not.toContain('type="checkbox"');
    expect(b).not.toContain('Tratamiento especial por política interna');
  });
});

describe('guardarConfigTarifaResultado — override SOLO cuando el selector estuvo visible (Ajuste "CORRIGE EL FLUJO DE GESTIONAR TARIFA" §1)', () => {
  it('sin checkbox ni bloqueo por confirmación manual', () => {
    const b = bloque('async function guardarConfigTarifaResultado(){', 'setGuardandoConfigTarifa(false);\n  }');
    expect(b).not.toContain('confirmacionPoliticaInternaAseoInput');
    expect(b).not.toContain('Debe confirmar el tratamiento especial');
  });

  it('regimenIVAConfirmado solo se envía si mostrarSelectorRegimenIVA es true; si no, el régimen sigue siendo la propuesta automática', () => {
    const b = bloque('async function guardarConfigTarifaResultado(){', 'setGuardandoConfigTarifa(false);\n  }');
    expect(b).toContain('if(mostrarSelectorRegimenIVA)overrides.regimenIVAConfirmado=regimenIVAInputResultado||regimenIvaPropuesto;');
  });
});

describe('Trazabilidad del override — fecha/usuario SIEMPRE del servidor (Ajuste "CORRIGE EL FLUJO DE GESTIONAR TARIFA" §7)', () => {
  it('guardarModuloAdmin hace un segundo guardado con `ultimaActualizacion`/`actualizadoPor` de la respuesta del PRIMER guardado (nunca `new Date()` del navegador)', () => {
    const b = bloque('async function guardarModuloAdmin(', 'Ajuste "UN GESTIONAR RESUMEN');
    expect(b).toContain('regimenIVAConfirmadoEn:r.ultimaActualizacion');
    expect(b).toContain('regimenIVAConfirmadoPor:r.actualizadoPor??null');
    expect(b).not.toContain('new Date().toISOString()');
  });

  it('si el segundo guardado (del sello) falla, la confirmación del override del primer guardado NUNCA se revierte', () => {
    const b = bloque('async function guardarModuloAdmin(', 'Ajuste "UN GESTIONAR RESUMEN');
    const idxSetConfirmado = b.indexOf('setRegimenIVAConfirmado(overridesResultadoTarifa.regimenIVAConfirmado);');
    const idxReturnTrue = b.lastIndexOf('return true;');
    expect(idxSetConfirmado).toBeGreaterThan(-1);
    expect(idxSetConfirmado).toBeLessThan(idxReturnTrue);
  });

  it('el payload persistido (resultadoTarifaConfig) incluye regimenIVAConfirmado/regimenIVAConfirmadoEn/regimenIVAConfirmadoPor — sin `regimenIVAMotivo` (ya no existe, el origen es siempre derivable)', () => {
    const b = bloque('function construirDatosEntradaCostosAdministrativos(', 'version:2,');
    expect(b).toContain('regimenIVAConfirmado:');
    expect(b).toContain('regimenIVAConfirmadoEn:');
    expect(b).toContain('regimenIVAConfirmadoPor:');
    expect(b).not.toContain('regimenIVAMotivo');
  });

  it('estructuras históricas (sin estos campos) cargan con typeof===... , nunca truthiness ni valores inventados', () => {
    const b = bloque('typeof datosAdminV2?.resultadoTarifaConfig?.regimenIVAConfirmado', 'resultadoTarifaConfig?.regimenIVAConfirmadoPor');
    expect(b).toContain("typeof datosAdminV2?.resultadoTarifaConfig?.regimenIVAConfirmadoEn==='string'");
  });
});
