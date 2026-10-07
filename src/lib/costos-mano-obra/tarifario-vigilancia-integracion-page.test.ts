/**
 * Ajuste "TARIFARIO GENERAL VIGICOLBA EN MANO DE OBRA" — verificación de
 * fuente sobre `page.tsx` (mismo patrón ya usado en el resto del repo:
 * no existe arnés de render de componentes para este archivo, así que se
 * verifica el TEXTO exacto del código fuente). La cobertura numérica del
 * tarifario en sí (fórmula, proporcionalidad, aislamiento de Aseocolba)
 * vive en `src/lib/costos-estructura/tarifario-vigilancia-vigicolba.test.ts`
 * — este archivo cubre exclusivamente el WIRING dentro de `ModalCargo`.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PAGE_TSX = readFileSync(join(__dirname, '../../app/page.tsx'), 'utf-8');

function extraerModalCargo(): string {
  const inicio = PAGE_TSX.indexOf('function ModalCargo(){');
  const fin = PAGE_TSX.indexOf('Buscador/creador de horarios', inicio);
  expect(inicio).toBeGreaterThan(-1);
  expect(fin).toBeGreaterThan(inicio);
  return PAGE_TSX.slice(inicio, fin);
}

describe('esVigicolbaProceso — derivación segura, nunca vía empresaProceso/EMPRESA_EXTERNA', () => {
  it('se deriva de capacidadCatalogoSNC.codigoEmpresaCatalogo, igual que esAseocolbaProceso', () => {
    expect(PAGE_TSX).toContain("const esVigicolbaProceso=capacidadCatalogoSNC.codigoEmpresaCatalogo==='vigi';");
  });

  it('esVigicolbaProceso y esAseocolbaProceso son mutuamente excluyentes por construcción (mismo codigoEmpresaCatalogo, valores distintos)', () => {
    expect(PAGE_TSX).toContain("const esAseocolbaProceso=capacidadCatalogoSNC.codigoEmpresaCatalogo==='aseo';");
  });
});

describe('ModalCargo — sección "Tarifa de vigilancia" (1: aparece solo para Vigicolba)', () => {
  it('la sección está gateada por esCargoManoObraVigicolba, derivado de esVigicolbaProceso Y (línea 1 O destino manoObra) — nunca Turnantes ni SNC', () => {
    const modal = extraerModalCargo();
    expect(modal).toContain("const esCargoManoObraVigicolba=esVigicolbaProceso&&(esLinea1||borradorCargoDestino==='manoObra');");
    expect(modal).toContain('{esCargoManoObraVigicolba&&(');
    expect(modal).toContain('Tarifa de vigilancia');
  });

  it('Aseocolba/Tempocolba/Transcolba nunca ven ni consumen esta sección — esCargoManoObraVigicolba depende de esVigicolbaProceso, no de esAseocolbaProceso ni de ninguna otra empresa', () => {
    const modal = extraerModalCargo();
    const inicioSeccion = modal.indexOf('{esCargoManoObraVigicolba&&(');
    const finSeccion = modal.indexOf('{/* Sección "Bonificaciones mensuales"', inicioSeccion);
    const seccion = modal.slice(inicioSeccion, finSeccion);
    expect(seccion).not.toMatch(/esAseocolba/);
    expect(seccion).not.toContain('tarifario-especiales-aseocolba');
    expect(seccion).not.toContain('catalogoTarifasAseocolba');
  });
});

describe('ModalCargo — resolución de tarifa (2-6: recalcula por cada selector, sin fallback)', () => {
  it('los 4 selectores existen con sus opciones (Tipo de servicio/Modalidad/Turno/Días de servicio)', () => {
    const modal = extraerModalCargo();
    expect(modal).toContain('<option value="COMERCIAL">Comercial</option>');
    expect(modal).toContain('<option value="RESIDENCIAL">Residencial estratos 4, 5 y 6</option>');
    expect(modal).toContain('<option value="SIN_ARMA">Sin Arma</option>');
    expect(modal).toContain('<option value="CON_ARMA">Con Arma</option>');
    expect(modal).toContain('<option value="CON_CANINO">Con Canino</option>');
    expect(modal).toContain('<option value="TURNO_1">Turno 1</option>');
    expect(modal).toContain('<option value="TURNO_2">Turno 2</option>');
    expect(modal).toContain('<option value="SERVICIO_24H">Servicio 24 Hrs</option>');
    expect(modal).toContain('LUNES_A_VIERNES_SIN_FESTIVOS');
    expect(modal).toContain('SABADOS_DOMINGOS_Y_FESTIVOS');
  });

  it('la tarifa se resuelve EXCLUSIVAMENTE con buscarTarifaCatalogoVigilanciaVigicolba/calcularValorProporcionalVigilanciaVigicolba (tarifario-vigilancia-vigicolba.ts)', () => {
    const modal = extraerModalCargo();
    expect(modal).toContain('buscarTarifaCatalogoVigilanciaVigicolba(`${vTipoServicioVigilancia}:${vTurnoVigilancia}:${vModalidadVigilancia}`)');
    expect(modal).toContain('calcularValorProporcionalVigilanciaVigicolba(tarifaVigilanciaResuelta,vPatronDiasVigilancia');
  });

  it('7) faltando cualquiera de los 4 parámetros no se calcula nada (faltanParametrosVigilancia)', () => {
    const modal = extraerModalCargo();
    expect(modal).toContain('const faltanParametrosVigilancia=!vTipoServicioVigilancia||!vModalidadVigilancia||!vTurnoVigilancia||!vPatronDiasVigilancia;');
    expect(modal).toContain('const tarifaVigilanciaResuelta=faltanParametrosVigilancia?undefined:buscarTarifaCatalogoVigilanciaVigicolba');
  });

  it('8) combinación seleccionada pero inexistente en el catálogo muestra mensaje controlado, nunca un valor inventado', () => {
    const modal = extraerModalCargo();
    expect(modal).toContain('No existe tarifa configurada para esta combinación.');
  });

  it('9) el total del cargo (vigilancia) = tarifa resuelta × cantidad de posiciones (vCant), nunca duplicado', () => {
    const modal = extraerModalCargo();
    expect(modal).toContain('const totalCargoVigilancia=(valorMensualVigilancia!=null&&Number(vCant)>0)?valorMensualVigilancia*Number(vCant):null;');
  });
});

describe('ModalCargo — edición/persistencia (10-11: guardar/reabrir, históricos)', () => {
  it('los 4 valores de un cargo (lineasExtra) se leen del propio borrador con ?? "" — nunca un default que simule selección real', () => {
    const modal = extraerModalCargo();
    expect(modal).toContain("const vTipoServicioVigilancia=esLinea1?tipoServicioVigilancia:(lineaActual!.tipoServicioVigilancia??'');");
    expect(modal).toContain("const vModalidadVigilancia=esLinea1?modalidadVigilancia:(lineaActual!.modalidadVigilancia??'');");
    expect(modal).toContain("const vTurnoVigilancia=esLinea1?turnoVigilancia:(lineaActual!.turnoVigilancia??'');");
    expect(modal).toContain("const vPatronDiasVigilancia=esLinea1?patronDiasVigilancia:(lineaActual!.patronDiasVigilancia??'');");
  });

  it('los 4 campos son opcionales en LineaMOExtra — un cargo histórico sin ellos sigue abriendo (undefined, nunca error de tipo obligatorio)', () => {
    const tiposCargo = readFileSync(join(__dirname, 'motor-distribuido/tipos-cargo.ts'), 'utf-8');
    expect(tiposCargo).toContain('tipoServicioVigilancia?: TipoServicioVigilanciaVigicolba;');
    expect(tiposCargo).toContain('modalidadVigilancia?: ModalidadVigilanciaVigicolba;');
    expect(tiposCargo).toContain('turnoVigilancia?: TurnoVigilanciaVigicolba;');
    expect(tiposCargo).toContain('patronDiasVigilancia?: PatronDiasVigilanciaVigicolba;');
  });

  it('normalizarBonificacionesLinea preserva los 4 campos por spread (...l) sin necesitar tocarlo — un histórico sin ellos queda undefined, nunca con un valor por defecto que simule selección', () => {
    const inicio = PAGE_TSX.indexOf('const normalizarBonificacionesLinea=');
    const fin = PAGE_TSX.indexOf('\n    });', inicio);
    const bloque = PAGE_TSX.slice(inicio, fin);
    expect(bloque).toContain('...l,');
    expect(bloque).not.toContain('tipoServicioVigilancia:');
    expect(bloque).not.toContain('modalidadVigilancia:');
  });

  it('línea 1: construirDatosEntradaManoObra persiste los 4 parámetros', () => {
    const inicio = PAGE_TSX.indexOf('function construirDatosEntradaManoObra(){');
    const fin = PAGE_TSX.indexOf('\n  }', inicio);
    const bloque = PAGE_TSX.slice(inicio, fin);
    expect(bloque).toContain('tipoServicioVigilancia,modalidadVigilancia,turnoVigilancia,patronDiasVigilancia,');
  });

  it('línea 1: la restauración reconstruye los 4 parámetros con ?? "" — nunca un default que simule selección', () => {
    expect(PAGE_TSX).toContain("setTipoServicioVigilancia((d.tipoServicioVigilancia as TipoServicioVigilanciaVigicolba)??'');");
    expect(PAGE_TSX).toContain("setModalidadVigilancia((d.modalidadVigilancia as ModalidadVigilanciaVigicolba)??'');");
    expect(PAGE_TSX).toContain("setTurnoVigilancia((d.turnoVigilancia as TurnoVigilanciaVigicolba)??'');");
    expect(PAGE_TSX).toContain("setPatronDiasVigilancia((d.patronDiasVigilancia as PatronDiasVigilanciaVigicolba)??'');");
  });
});

describe('SNC Vigicolba — sigue sin tarifa automática (12: los 3 servicios especiales no se conectan)', () => {
  it('ModalServicioNoContinuo nunca LLAMA al tarifario general de vigilancia (los comentarios sí lo mencionan como contexto de por qué NO se usa aquí — se verifica la ausencia de uso real, no del identificador)', () => {
    const inicio = PAGE_TSX.indexOf('function ModalServicioNoContinuo(){');
    const fin = PAGE_TSX.indexOf('\n  // ═══ Ajuste "lo mismo que tiene servicios no continuos', inicio);
    const modalSnc = PAGE_TSX.slice(inicio, fin);
    expect(modalSnc).not.toContain('buscarTarifaCatalogoVigilanciaVigicolba(');
    expect(modalSnc).not.toContain('CATALOGO_VIGILANCIA_VIGICOLBA_2026.');
    expect(modalSnc).not.toContain('resolverTarifaAutomaticaSNCVigilanciaVigicolba(');
  });
});
