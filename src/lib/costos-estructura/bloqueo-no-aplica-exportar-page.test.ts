/**
 * Ajuste "NO_APLICA ES UNA DECISIÓN OBLIGATORIA" — el botón "Exportar
 * costos" (page.tsx, la acción que da por terminada/definitiva la
 * estructura) debe bloquearse cuando alguno de los 4 módulos controlados
 * (dotacionEpp/examenesMedicos/insumos/maquinariaEquipos) sigue pendiente
 * (ni COMPLETADO ni NO_APLICA), reutilizando `resolverPendientesModulos`
 * ya centralizado en guardado-modular.ts — nunca una segunda
 * implementación de la regla dentro de page.tsx.
 *
 * No existe arnés de render de componentes para page.tsx (~36.000 líneas);
 * mismo patrón ya usado en el repo (`guardado-modular-page.test.ts`,
 * `garantias-amparos-acordeon-modal-page.test.ts`): se verifica el TEXTO
 * exacto del código fuente.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PAGE_TSX = readFileSync(join(__dirname, '../../app/page.tsx'), 'utf-8');

describe('Botón "Exportar costos" — bloqueo por módulos NO_APLICA pendientes (escenario 11)', () => {
  it('Ajuste "EXPORTAR COSTOS — MENSAJES AL HACER CLIC" — el botón queda HABILITADO (solo se deshabilita mientras genera) para que cada bloqueo muestre su mensaje al hacer clic; !pendientesModulosNoAplica.completo se evalúa dentro de exportarCostos, con los bloqueos ya existentes (costos sin asignar / conflicto de herencia)', () => {
    // Antes: disabled={saving||grandTotal===0||…||!pendientesModulosNoAplica.completo} —
    // un botón deshabilitado no puede explicar por qué, y el usuario no veía el mensaje.
    expect(PAGE_TSX).toContain('<button onClick={exportarCostos} disabled={saving} title=');
    expect(PAGE_TSX).not.toContain(
      "disabled={saving||grandTotal===0||costosOtrosPendientesDeAsignacion>0||conflictosHerenciaTurnantesTotal>0||!pendientesModulosNoAplica.completo}",
    );
    const fuente = PAGE_TSX.replace(/\r\n/g, '\n'); // page.tsx usa CRLF
    const inicio = fuente.indexOf('async function exportarCostos(){');
    const fin = fuente.indexOf('\n  }\n', inicio);
    expect(fin).toBeGreaterThan(inicio);
    const cuerpo = fuente.slice(inicio, fin);
    expect(cuerpo).toContain('if(!pendientesModulosNoAplica.completo){');
  });

  it('el título del botón explica exactamente qué módulos faltan por definir cuando está bloqueado por esta regla', () => {
    expect(PAGE_TSX).toContain(
      '!pendientesModulosNoAplica.completo?`No puedes exportar los costos porque existen módulos pendientes por definir. Debes diligenciar la información o marcar "No aplica" en: ${pendientesModulosNoAplica.pendientes.map(c=>NOMBRE_MODULO_NO_APLICA[c]).join(\', \')}.`',
    );
  });

  it('Ajuste "YA NO SERÍA NECESARIO VERLO" — la tarjeta "Faltan definir N módulos" se retiró (el stepper de módulos de Costos ya comunica visualmente qué falta y permite navegar con un clic); el botón "Exportar costos" conserva su title nativo con el mismo mensaje/regla', () => {
    expect(PAGE_TSX).not.toContain("{n===1?'Falta definir 1 módulo':`Faltan definir ${n} módulos`}");
    expect(PAGE_TSX).not.toContain('Completa la información o marca &quot;No aplica&quot; para poder exportar.');
    // El title (tooltip nativo) del botón Exportar costos sigue explicando qué falta.
    expect(PAGE_TSX).toContain(
      '!pendientesModulosNoAplica.completo?`No puedes exportar los costos porque existen módulos pendientes por definir. Debes diligenciar la información o marcar "No aplica" en: ${pendientesModulosNoAplica.pendientes.map(c=>NOMBRE_MODULO_NO_APLICA[c]).join(\', \')}.`',
    );
  });

  it('pendientesModulosNoAplica se calcula con resolverPendientesModulos sobre CLAVES_MODULO_NO_APLICA — nunca una regla reimplementada aparte', () => {
    const inicio = PAGE_TSX.indexOf('const pendientesModulosNoAplica=React.useMemo(');
    expect(inicio).toBeGreaterThan(-1);
    const fin = PAGE_TSX.indexOf(');', inicio) + 2;
    const cuerpo = PAGE_TSX.slice(inicio, fin);
    expect(cuerpo).toContain('resolverPendientesModulos({');
    expect(cuerpo).toContain('CLAVES_MODULO_NO_APLICA');
    expect(cuerpo).not.toContain('CLAVES_MODULO_NO_APLICA.every'); // nunca un every() propio duplicado
  });

  it('el bloqueo NUNCA se aplica en los botones de guardado por-módulo (Guardar EPP y Dotación, Guardar Exámenes, Guardar Insumos, Guardar Maquinaria) — solo en la acción final de exportar', () => {
    // Ninguno de los 4 botones de guardado individual referencia
    // `pendientesModulosNoAplica` en su propio `disabled` — el bloqueo es
    // exclusivo de "Exportar costos" (edición progresiva de cada módulo
    // nunca queda bloqueada por esta regla).
    for (const boton of [
      "disabled={guardandoModuloDotacionEpp}",
      "disabled={guardandoModuloExamenesMedicos}",
      "disabled={guardandoModuloInsumos}",
      "disabled={guardandoModuloMaquinaria}",
    ]) {
      expect(PAGE_TSX).toContain(boton);
    }
  });
});
