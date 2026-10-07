/**
 * Avisos de "sin guardar" del costeo — evitan que queden datos en el aire:
 * borrar un cargo limpia su EPP/Exámenes solo en pantalla y cada pestaña se
 * guarda por separado, así que guardar solo Mano de Obra dejaba en la base los
 * costos de cargos ya eliminados (registros #8 y #1 de qa). Verificación de
 * cableado en page.tsx (texto fuente, mismo patrón que guardado-modular-*.test.ts).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PAGE_TSX = readFileSync(join(__dirname, '../../app/page.tsx'), 'utf-8').replace(/\r\n/g, '\n');

function bloque(inicioMarcador: string, finMarcador: string): string {
  const inicio = PAGE_TSX.indexOf(inicioMarcador);
  if (inicio === -1) throw new Error(`No se encontró el marcador de inicio: ${inicioMarcador}`);
  const fin = PAGE_TSX.indexOf(finMarcador, inicio);
  if (fin === -1) throw new Error(`No se encontró el marcador de fin: ${finMarcador}`);
  return PAGE_TSX.slice(inicio, fin);
}

describe('Guardar Mano de Obra avisa de los módulos que siguen sin guardar', () => {
  const b = bloque('async function guardarAvanceManoObra(){', 'async function guardarModuloTurnantes');

  it('excluye Mano de Obra y Turnantes (acaban de guardarse) y nombra los demás', () => {
    expect(b).toContain("modulosConCambiosSinGuardar.filter(m=>m!=='Mano de Obra'&&m!=='Turnantes')");
    expect(b).toContain('Quedan cambios sin guardar en: ${otrosSinGuardar.join(\', \')}.');
  });

  it('el aviso se agrega al mensaje de éxito sin reemplazarlo', () => {
    expect(b).toContain("'Mano de Obra completada.':'Avance de Mano de Obra guardado correctamente.')+avisoOtrosSinGuardar");
  });
});

describe('Eliminar un cargo con costos asociados recuerda guardar los otros módulos', () => {
  it('el modal de confirmación lo dice antes de eliminar', () => {
    const b = bloque('{pendienteEliminarConCostos&&(', 'confirmarEliminarLineaConCostos}');
    expect(b).toContain('guarda también EPP y Dotación y Exámenes, Cursos y Vacunas');
  });
});

describe('Alerta del navegador al recargar/cerrar', () => {
  it('considera también los módulos con cambios sin guardar, no solo el borrador del formulario', () => {
    const b = bloque("window.addEventListener('beforeunload',handler);", '[cargo,nTrab');
    const handler = bloque("const handler=(e:BeforeUnloadEvent)=>{", "window.addEventListener('beforeunload',handler);");
    expect(handler).toContain('||modulosSinGuardarRef.current.length>0');
    expect(b).toBeTruthy();
  });

  it('la referencia se actualiza en cada render con la misma lista del modal de salida', () => {
    expect(PAGE_TSX).toContain('const modulosSinGuardarRef=useRef<string[]>([]);');
    expect(PAGE_TSX).toContain('modulosSinGuardarRef.current=modulosConCambiosSinGuardar;');
  });
});
