import { describe, expect, it } from 'vitest';
import { duracionServicioNoContinuo, type ServicioNoContinuo } from '@/lib/costos-estructura/servicios-no-continuos';
import { serviciosNoContinuosParaPuente } from './payload';

const servicio = (o: Partial<ServicioNoContinuo>) => o as ServicioNoContinuo;
const tarifa = (o: Record<string, unknown>) => ({ cantidadPersonas: 1, ...o });

describe('duración de un servicio no continuo para Contratos', () => {
  it('operarios = personas de las tarifas + cargos manuales; días = el mayor; horas de las tarifas por hora o de la jornada', () => {
    const srv = servicio({
      tarifas: [tarifa({ modalidad: 'HORA', cantidadPersonas: 2, cantidadHoras: 5 }), tarifa({ modalidad: 'JORNADA_6H', cantidadPersonas: 1, cantidadDias: 3 })] as never,
      cargosManuales: [{ id: 1, nombreCargo: 'Operario', cantidad: 1, dias: 2, valorUnitario: 1000 }],
    });
    expect(duracionServicioNoContinuo(srv)).toEqual({ diasServicio: 3, horasServicio: 6, operarios: 4 });
  });

  it('lo que el servicio no dice va en null (no se inventa)', () => {
    expect(duracionServicioNoContinuo(servicio({ tarifas: [], cargosManuales: [] }))).toEqual({ diasServicio: null, horasServicio: null, operarios: null });
    expect(duracionServicioNoContinuo(servicio({ tarifas: [tarifa({ modalidad: 'MENSUAL', cantidadPersonas: 1 })] as never }))).toEqual({ diasServicio: null, horasServicio: null, operarios: 1 });
  });

  it('viaja al puente solo si es válida', () => {
    const base = { codigo: '14', uen: 'BAQ', descripcion: 'Brigada', frecuencia: 3, manoObra: 1, insumos: 0, equipos: 0, otrosCostos: 0, valorServicio: 1, valorMensual: 1, valorAgregado: false };
    const [bien] = serviciosNoContinuosParaPuente([{ ...base, diasServicio: 2, horasServicio: 7.333, operarios: 3 }]);
    expect([bien.diasServicio, bien.horasServicio, bien.operarios]).toEqual([2, 7.33, 3]);
    const [mal] = serviciosNoContinuosParaPuente([{ ...base, diasServicio: 1.5, horasServicio: 30, operarios: null }]);
    expect([mal.diasServicio, mal.horasServicio, mal.operarios]).toEqual([null, null, null]);
    const [sin] = serviciosNoContinuosParaPuente([base]);
    expect([sin.diasServicio, sin.horasServicio, sin.operarios]).toEqual([null, null, null]);
  });
});
