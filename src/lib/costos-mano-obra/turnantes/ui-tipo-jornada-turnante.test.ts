/**
 * Ajuste "EL MOTOR DEBE DETECTAR AUTOMÁTICAMENTE SI EL TURNANTE ES DE 21 O
 * 42 HORAS" + "CORREGIR LA LÓGICA DEL TURNANTE SEGÚN JORNADA MÍNIMA DE
 * CONTRATACIÓN" + "SIMPLIFICAR LA VISTA DEL TURNANTE" (histórico) +
 * "IMPLEMENTAR FICHAS DE TURNANTES..." + "Y EN LAS FICHAS CREADAS EL
 * TURNANTE YA VA POR FUERA NO ACA" (vigente) — verificación de cableado
 * en page.tsx.
 *
 * El detalle del turnante ("Turnante de X", jornada, cobertura, "Ver
 * cálculo") YA NO vive anidado dentro de la ficha del cargo: ese bloque
 * fue retirado por completo y reemplazado por FichaTurnante, la ficha
 * PROPIA del turnante (misma info: jornada, cobertura, costo), renderizada
 * como su propio BloqueColapsable debajo del cargo que la requiere —
 * cobertura equivalente vive en ficha-turnante-page.test.ts. Esta suite
 * solo confirma que el bloque histórico anidado NO reapareció y que la
 * fórmula de asignación por cargo (costoTurnantePorCargo, nunca la vista
 * retirada) sigue siendo la única fuente de costo por cargo.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PAGE_TSX = readFileSync(join(__dirname, '../../../app/page.tsx'), 'utf-8');

describe('el detalle anidado "Turnante de X" dentro de la ficha del cargo fue retirado (reemplazado por FichaTurnante, fuera de la ficha)', () => {
  it('ya no existe el encabezado "Turnante de X" anidado ni el bloque {hayTurnanteGrupo&&(...)}', () => {
    expect(PAGE_TSX).not.toContain('{`Turnante de ${grupo.tituloFicha}`}');
    expect(PAGE_TSX).not.toContain('{hayTurnanteGrupo&&(');
  });

  it('ya no existe la barra "Costo mensual del turnante:" ni el botón "Ver cálculo"/"Ocultar cálculo" ligado a panelesDetalleTurnanteAbiertos dentro de la ficha del cargo', () => {
    expect(PAGE_TSX).not.toContain('Costo mensual del turnante:');
    expect(PAGE_TSX).not.toContain("{(panelesDetalleTurnanteAbiertos[grupo.claveFicha]??false)?'Ocultar cálculo':'Ver cálculo'}");
  });

  it('ya no existe "Detalle del cálculo" (fórmula 21/42 explícita) anidado en la ficha del cargo', () => {
    expect(PAGE_TSX).not.toContain('Detalle del cálculo</div>');
  });

  it('IconoDetalleCostoTurnanteAsignado ya no se usa en el render (ese desglose por cargo fue retirado, la ficha del turnante ahora usa escalarTotalesLaborales/conciliarConTotalCanonico)', () => {
    expect(PAGE_TSX).not.toContain('<IconoDetalleCostoTurnanteAsignado');
  });
});

describe('el cierre de la ficha del cargo (Ajuste "ELIMINAR EL BLOQUE GRIS Y SIMPLIFICAR EL CIERRE DE LA FICHA DE MANO DE OBRA" §4) — SIEMPRE "Costo mensual total del cargo", nunca "Subtotal..." (el turnante tiene su propia ficha aparte, con su propio total)', () => {
  it('subtotalPosicionesGrupo se muestra como cierre único de la ficha, con el rótulo fijo "Costo mensual total del cargo:"', () => {
    expect(PAGE_TSX).toContain('Costo mensual total del cargo:');
    expect(PAGE_TSX).toContain('{cop(subtotalPosicionesGrupo)}');
  });
});

describe('CAPACIDAD_REFERENCIA_TIEMPO_COMPLETO se importa del módulo puro, nunca un 42 hardcodeado nuevo', () => {
  it('import correcto', () => {
    expect(PAGE_TSX).toContain('CAPACIDAD_REFERENCIA_TIEMPO_COMPLETO,');
    expect(PAGE_TSX).toContain("from '@/lib/costos-mano-obra/turnantes/calculo-turnantes'");
  });
});

describe('§7/§9/§10) Jornada mínima de contratación — costoTurnantePorCargo sigue usando capacidadUtilizada y el factor 21/42, sin doble proporcionalidad', () => {
  it('costoTurnantePorCargo usa capacidadUtilizada (demanda real, capada a la física) como denominador, nunca capacidadOrdinariaMinutos (referencia fija de 42h)', () => {
    const inicio = PAGE_TSX.indexOf('const costoTurnantePorCargo=React.useMemo(');
    expect(inicio).toBeGreaterThan(-1);
    const bloque = PAGE_TSX.slice(inicio, inicio + 2200);
    expect(bloque).toContain('const capacidadUtilizada=grupo.necesidad.capacidadUtilizadaMinutos;');
    expect(bloque).toContain('const costoAsignado=Math.round(costoContratoGrupo*c.minutosCubiertos/capacidadUtilizada);');
  });

  it('el numerador (costoContratoGrupo) viene de costoTotalGrupoTurnante — fuente ÚNICA compartida con la ficha, nunca un factor de escala ni una fórmula distinta', () => {
    const inicio = PAGE_TSX.indexOf('const costoTurnantePorCargo=React.useMemo(');
    const bloque = PAGE_TSX.slice(inicio, inicio + 2200);
    expect(bloque).toContain('const costoContratoGrupo=costoTotalGrupoTurnante(grupo,resultado42,resultado21);');
    expect(bloque).not.toContain('factorEscalaContrato');
  });

  it('costoTurnantePorCargo sigue siendo la ÚNICA fuente de costo por cargo en el resumen (nunca un segundo cálculo introducido por la ficha del turnante)', () => {
    const ocurrencias = (PAGE_TSX.match(/const costoTurnantePorCargo=React\.useMemo\(/g) ?? []).length;
    expect(ocurrencias).toBe(1);
  });
});
