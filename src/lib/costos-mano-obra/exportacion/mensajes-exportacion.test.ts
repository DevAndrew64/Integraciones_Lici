/**
 * Ajuste "EXPORTAR COSTOS — MENSAJES AL HACER CLIC" (pedido explícito del
 * usuario):
 *  1. El botón "Exportar costos" debe estar HABILITADO para que cada bloqueo
 *     muestre su mensaje — antes se deshabilitaba y el usuario no veía por qué
 *     (solo un tooltip al pasar el mouse).
 *  2. El mensaje de bloqueo es que no se puede descargar si hay puntos sin
 *     diligenciar.
 *  3. Si el Excel no se puede generar (incluida la plantilla ausente — caso
 *     abierto), se muestra que ocurrió un error, no instrucciones de archivos.
 *  4. Hallazgo: la pantalla pintaba en VERDE casi todos esos mensajes (solo
 *     ponía rojo a los que empezaban por "Error"/"Existen costos"/"Conflicto"),
 *     así que "No puedes exportar…" y "No fue posible generar…" parecían éxitos.
 *
 * No existe arnés de render para page.tsx (~36.000 líneas): la parte de
 * pantalla se verifica sobre el texto fuente, mismo patrón que el resto de
 * `*-page.test.ts` del repo; la lógica de mensajes es pura y se prueba de verdad.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  MENSAJE_ERROR_GENERAR_EXCEL, MENSAJE_EXPORTACION_EXITOSA, MENSAJE_EXPORTACION_SESION_VENCIDA, MENSAJE_EXPORTACION_SIN_PERMISO,
  mensajeErrorExportacion,
} from './mensajes-exportacion';

const PAGE_TSX = readFileSync(join(__dirname, '../../../app/page.tsx'), 'utf-8').replace(/\r\n/g, '\n'); // page.tsx usa CRLF: se normaliza para poder cortar por bloques
const ROUTE_EXPORTAR = readFileSync(join(__dirname, '../../../app/api/costos-estructura/[id]/exportar/route.ts'), 'utf-8');
const ROUTE_EXPORTAR_MO = readFileSync(join(__dirname, '../../../app/api/costos-estructura/[id]/exportar-mano-obra/route.ts'), 'utf-8');

describe('mensajeErrorExportacion — qué texto ve el usuario según la respuesta del servidor', () => {
  it('401 → sesión vencida; 403 → sin permiso (accionables, no el genérico)', () => {
    expect(mensajeErrorExportacion(401, { mensaje: undefined })).toBe(MENSAJE_EXPORTACION_SESION_VENCIDA);
    expect(mensajeErrorExportacion(403, {})).toBe(MENSAJE_EXPORTACION_SIN_PERMISO);
  });

  it('usa el `mensaje` del servidor cuando existe (ya está redactado para el usuario: GUARDAR_REQUERIDO, CONFLICTO_CONCURRENCIA…)', () => {
    expect(mensajeErrorExportacion(409, { mensaje: 'Guarde los cambios de Mano de Obra antes de generar el archivo Excel.' }))
      .toBe('Guarde los cambios de Mano de Obra antes de generar el archivo Excel.');
  });

  it('NUNCA muestra `error` crudo: un código técnico ("DTO_INVALIDO") se reemplaza por "ocurrió un error"', () => {
    const cuerpo = { error: 'DTO_INVALIDO', errores: ['x'] } as { mensaje?: unknown };
    expect(mensajeErrorExportacion(400, cuerpo)).toBe(MENSAJE_ERROR_GENERAR_EXCEL);
    expect(mensajeErrorExportacion(400, cuerpo)).not.toContain('DTO_INVALIDO');
  });

  it('cuerpo ausente, mensaje vacío/solo espacios o no-texto → genérico', () => {
    for (const cuerpo of [null, undefined, {}, { mensaje: '' }, { mensaje: '   ' }, { mensaje: 42 }, { mensaje: { a: 1 } }]) {
      expect(mensajeErrorExportacion(500, cuerpo as { mensaje?: unknown } | null | undefined)).toBe(MENSAJE_ERROR_GENERAR_EXCEL);
    }
  });

  it('el genérico dice que ocurrió un error y no menciona archivos, rutas ni plantillas', () => {
    expect(MENSAJE_ERROR_GENERAR_EXCEL).toMatch(/^Ocurrió un error/);
    expect(MENSAJE_ERROR_GENERAR_EXCEL).not.toMatch(/plantilla|\.xlsx|data\/|ENOENT/i);
  });
});

describe('routes de export — todo fallo de generación responde con el mismo mensaje genérico', () => {
  for (const [nombre, src] of [['exportar', ROUTE_EXPORTAR], ['exportar-mano-obra', ROUTE_EXPORTAR_MO]] as const) {
    it(`${nombre}: el 500 genérico usa MENSAJE_ERROR_GENERAR_EXCEL en \`mensaje\` (antes: un texto suelto en \`error\` que la pantalla pintaba en verde)`, () => {
      expect(src).toContain("error: 'ERROR_GENERAR_EXCEL', mensaje: MENSAJE_ERROR_GENERAR_EXCEL");
      expect(src).not.toContain('No fue posible generar');
      expect(src).toContain("import { MENSAJE_ERROR_GENERAR_EXCEL } from '@/lib/costos-mano-obra/exportacion/mensajes-exportacion';");
    });
  }
});

describe('page.tsx — botón "Exportar costos" habilitado y mensajes al hacer clic', () => {
  const bloqueExportar = () => {
    const inicio = PAGE_TSX.indexOf('async function exportarCostos(){');
    expect(inicio).toBeGreaterThan(-1);
    return PAGE_TSX.slice(inicio, PAGE_TSX.indexOf('\n  }\n', inicio));
  };

  it('el botón solo se deshabilita mientras genera (`saving`) — ni fondo gris ni cursor "default" por bloqueos', () => {
    const inicio = PAGE_TSX.indexOf('<button onClick={exportarCostos}');
    expect(inicio).toBeGreaterThan(-1);
    const boton = PAGE_TSX.slice(inicio, PAGE_TSX.indexOf('</button>', inicio));
    expect(boton).toContain('disabled={saving}');
    expect(boton).toContain("background:saving?'#94a3b8':NAVY");
    expect(boton).toContain("cursor:saving?'default':'pointer'");
    expect(boton).not.toMatch(/disabled=\{[^}]*(grandTotal|costosOtrosPendientesDeAsignacion|conflictosHerencia|pendientesModulosNoAplica)/);
  });

  it('exportarCostos valida en orden y cada bloqueo escribe su mensaje: costos sin asignar → conflicto → módulos pendientes → costeo vacío ("no se puede descargar… puntos sin diligenciar") → guardar', () => {
    const b = bloqueExportar();
    const orden = [
      'if(costosOtrosPendientesDeAsignacion>0){',
      'if(conflictosHerenciaTurnantesTotal>0){',
      'if(!pendientesModulosNoAplica.completo){',
      'if(grandTotal===0){',
      'if(!costoEstructuraIdActual){',
    ].map(t => b.indexOf(t));
    orden.forEach(i => expect(i).toBeGreaterThan(-1));
    expect([...orden].sort((a, c) => a - c)).toEqual(orden);
    expect(b).toContain("No se puede descargar: hay puntos sin diligenciar. Complete los datos del costeo.");
    // el bloqueo por módulos pendientes conserva su mensaje, con la lista de módulos
    expect(b).toContain('No puedes exportar los costos porque existen módulos pendientes por definir.');
  });

  it('los errores del servidor se muestran con mensajeErrorExportacion — nunca `d.error` crudo', () => {
    const b = bloqueExportar();
    expect(b).toContain('setSaveMsg(mensajeErrorExportacion(res.status,d));');
    // (solo en llamadas a setSaveMsg: el comentario que explica esto sí menciona `d.error`)
    expect(b).not.toMatch(/setSaveMsg\([^;]*\bd\.(error|mensaje\|\|d\.error)/);
    expect(b).not.toContain('||d.error');
    expect(b).toContain('setSaveMsg(MENSAJE_EXPORTACION_EXITOSA);');
  });

  it('VERDE solo el éxito; bloqueos y errores en ROJO (antes solo eran rojos los que empezaban por Error/Existen costos/Conflicto)', () => {
    expect(PAGE_TSX).toContain("color:saveMsg===MENSAJE_EXPORTACION_EXITOSA?'#16a34a':RED");
    expect(PAGE_TSX).not.toContain("saveMsg.startsWith('Error')");
  });

  it('los dos bloqueos que ya tienen su línea roja fija bajo el botón no se muestran duplicados', () => {
    expect(PAGE_TSX).toContain("!(saveMsg.startsWith('Existen costos')&&costosOtrosPendientesDeAsignacion>0)");
    expect(PAGE_TSX).toContain("!(saveMsg.startsWith('Conflicto')&&conflictosHerenciaTurnantesTotal>0)");
  });

  it('el mensaje de bloqueo se limpia al corregir la causa; el efecto va DESPUÉS de las variables que usa en sus dependencias (se evalúan en el render: antes fallaría por usarlas antes de declararlas)', () => {
    const efecto = PAGE_TSX.indexOf("setSaveMsg(m=>m===MENSAJE_EXPORTACION_EXITOSA?m:'');");
    expect(efecto).toBeGreaterThan(-1);
    for (const decl of [
      'const costosOtrosPendientesDeAsignacion=React.useMemo(',
      'const pendientesModulosNoAplica=React.useMemo(',
      'const conflictosHerenciaTurnantesTotal=React.useMemo(',
      'const grandTotal=tarifaMensualTotalManoObra;',
    ]) {
      const i = PAGE_TSX.indexOf(decl);
      expect(i, decl).toBeGreaterThan(-1);
      expect(efecto, `el efecto debe ir después de: ${decl}`).toBeGreaterThan(i);
    }
    expect(PAGE_TSX).toContain('},[pendientesModulosNoAplica.completo,costosOtrosPendientesDeAsignacion>0,conflictosHerenciaTurnantesTotal>0,grandTotal===0,hayCambiosSinGuardarManoObra,costoEstructuraIdActual]);');
  });

  it('el mensaje de éxito es la misma constante en todas partes (servidor no, solo pantalla)', () => {
    expect(MENSAJE_EXPORTACION_EXITOSA).toBe('Excel de la estructura de costos generado exitosamente.');
    expect(PAGE_TSX).not.toContain("setSaveMsg('Excel de la estructura de costos generado exitosamente.')");
  });
});
