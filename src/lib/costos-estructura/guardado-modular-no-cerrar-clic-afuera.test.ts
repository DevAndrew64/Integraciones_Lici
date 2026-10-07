/**
 * Ajuste "QUE NO SE CIERRE AL DARLE CLICK AFUERA" — el fondo del modal
 * "Registrar Dotación y EPP" ya no cierra el modal al hacer clic fuera;
 * solo el botón ✕, "Cancelar" o "Almacenar dotación y EPP" lo hacen.
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

describe('ModalDotacionEpp — el fondo ya no cierra el modal al hacer clic afuera', () => {
  it('el overlay ya no tiene onClick que llame a cancelarModalDotacionEpp', () => {
    const b = bloque('function ModalDotacionEpp()', '\n  function Sec(');
    expect(b).not.toContain('if(e.target===e.currentTarget)cancelarModalDotacionEpp()');
  });

  it('cerrar el modal sigue siendo posible vía el botón ✕ y "Cancelar"', () => {
    const b = bloque('function ModalDotacionEpp()', '\n  function Sec(');
    expect(b).toContain('onClick={cancelarModalDotacionEpp} style={{border:\'none\',background:\'none\',cursor:\'pointer\',color:\'#94a3b8\',fontSize:20');
    expect(b).toContain('className="modal-btn-cancel" onClick={cancelarModalDotacionEpp}');
  });
});
