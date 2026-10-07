import { describe, expect, it } from 'vitest';
import {
  BONO_PRESTACIONAL, BONOS_NO_PRESTACIONALES, calcularBonosNoPrestacionalesLinea,
  agregarBonosNoPrestacionales, construirFilasDetalleBonosNoPrestacionales,
  VALORES_BONOS_NO_PRESTACIONALES_VACIO,
} from './bonificaciones-mano-obra';

describe('§14.1/§14.2 — cinco conceptos exactos, con los IDs pedidos', () => {
  it('Bono Prestacional', () => {
    expect(BONO_PRESTACIONAL).toEqual({ id: 'BONO_PRESTACIONAL', nombre: 'Bono Prestacional' });
  });
  it('BONO_ALIMENTACION', () => { expect(BONOS_NO_PRESTACIONALES.alimentacion.id).toBe('BONO_ALIMENTACION'); });
  it('BONO_TRANSPORTE', () => { expect(BONOS_NO_PRESTACIONALES.transporte.id).toBe('BONO_TRANSPORTE'); });
  it('BONO_PRODUCTIVIDAD', () => { expect(BONOS_NO_PRESTACIONALES.productividad.id).toBe('BONO_PRODUCTIVIDAD'); });
  it('BONO_OCASIONAL', () => { expect(BONOS_NO_PRESTACIONALES.ocasional.id).toBe('BONO_OCASIONAL'); });
  it('§14.3 — solo cuatro pertenecen al grupo no prestacional', () => {
    expect(Object.keys(BONOS_NO_PRESTACIONALES)).toHaveLength(4);
  });
  it('§14.4 — Bono Prestacional queda separado (no está en BONOS_NO_PRESTACIONALES)', () => {
    expect(Object.values(BONOS_NO_PRESTACIONALES).some(b => b.id === 'BONO_PRESTACIONAL')).toBe(false);
  });
});

describe('§5 — Bono Transporte se distingue visualmente del auxilio legal, sin cambiar el ID', () => {
  it('nombreVisible es "Bono de transporte adicional"', () => {
    expect(BONOS_NO_PRESTACIONALES.transporte.nombreVisible).toBe('Bono de transporte adicional');
  });
  it('el ID interno sigue siendo BONO_TRANSPORTE', () => {
    expect(BONOS_NO_PRESTACIONALES.transporte.id).toBe('BONO_TRANSPORTE');
  });
  it('el nombre empresarial (FoxPro) no cambió', () => {
    expect(BONOS_NO_PRESTACIONALES.transporte.nombre).toBe('Bono Transporte');
  });
});

describe('§14.5 — todos inician en 0', () => {
  it('VALORES_BONOS_NO_PRESTACIONALES_VACIO', () => {
    expect(VALORES_BONOS_NO_PRESTACIONALES_VACIO).toEqual({ alimentacion: 0, transporte: 0, productividad: 0, ocasional: 0 });
  });
});

describe('§14.7/§14.8 — cálculo por línea: suma de 4 + multiplicación única', () => {
  it('7) total por trabajador suma los 4 bonos', () => {
    const r = calcularBonosNoPrestacionalesLinea({ alimentacion: 50000, transporte: 30000, productividad: 20000, ocasional: 10000 }, 1);
    expect(r.totalPorTrabajador).toBe(110000);
  });

  it('8) total de línea multiplica una sola vez por cantidad de trabajadores', () => {
    const r = calcularBonosNoPrestacionalesLinea({ alimentacion: 50000, transporte: 30000, productividad: 20000, ocasional: 10000 }, 3);
    expect(r.totalLinea).toBe(110000 * 3);
    expect(r.totalLinea).not.toBe(110000 * 3 * 3); // nunca doble multiplicación
  });

  it('con cantidad 0 el total de línea es 0 (nunca negativo ni NaN)', () => {
    const r = calcularBonosNoPrestacionalesLinea({ alimentacion: 100, transporte: 0, productividad: 0, ocasional: 0 }, 0);
    expect(r.totalLinea).toBe(0);
  });
});

describe('§21 — agregarBonosNoPrestacionales nunca duplica la suma entre líneas', () => {
  it('suma directa de totalLinea de cada línea, sin re-multiplicar', () => {
    const r1 = calcularBonosNoPrestacionalesLinea({ alimentacion: 10000, transporte: 0, productividad: 0, ocasional: 0 }, 2); // 20000
    const r2 = calcularBonosNoPrestacionalesLinea({ alimentacion: 0, transporte: 5000, productividad: 0, ocasional: 0 }, 3); // 15000
    expect(agregarBonosNoPrestacionales([r1, r2])).toBe(35000);
  });
  it('lista vacía agrega 0', () => {
    expect(agregarBonosNoPrestacionales([])).toBe(0);
  });
});

describe('§14.15/§14.16 — detalle por concepto', () => {
  it('15) el detalle expone los 4 bonos no prestacionales', () => {
    const r = calcularBonosNoPrestacionalesLinea({ alimentacion: 50000, transporte: 30000, productividad: 20000, ocasional: 10000 }, 2);
    const filas = construirFilasDetalleBonosNoPrestacionales(r);
    expect(filas).toHaveLength(4);
    expect(filas.map(f => f.clave).sort()).toEqual(['alimentacion', 'ocasional', 'productividad', 'transporte']);
  });

  it('cada fila multiplica su propio valor por la cantidad de trabajadores de la línea', () => {
    const r = calcularBonosNoPrestacionalesLinea({ alimentacion: 50000, transporte: 0, productividad: 0, ocasional: 0 }, 2);
    const filas = construirFilasDetalleBonosNoPrestacionales(r);
    const alimentacion = filas.find(f => f.clave === 'alimentacion')!;
    expect(alimentacion.totalLinea).toBe(100000);
  });

  it('16) Bono Prestacional no aparece en las filas del detalle no prestacional', () => {
    const r = calcularBonosNoPrestacionalesLinea(VALORES_BONOS_NO_PRESTACIONALES_VACIO, 1);
    const filas = construirFilasDetalleBonosNoPrestacionales(r);
    expect(filas.some(f => (f.nombreVisible as string).includes('Prestacional'))).toBe(false);
  });
});