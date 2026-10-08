/**
 * Prueba de CONTRATO entre LiciColba y el puente: el JSON que arma `armarPayloadContratos` (+ `cargosParaPuente`) debe ser
 * idéntico al archivo `puente-contratos/test/fixtures/payload-licicolba.json`, y las pruebas del puente validan ese MISMO
 * archivo con su validador estricto. Si un lado cambia sin el otro, una de las dos suites falla.
 *
 * Para regenerar el archivo tras un cambio acordado en ambos lados:  ACTUALIZAR_CONTRATO=1 npx vitest run src/lib/contratos-puente/contrato-v1
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cargosParaPuente, type CargoPantallaDto } from './cargos';
import { armarPayloadContratos, leerDestino } from './payload';

const RUTA = resolve(process.cwd(), 'puente-contratos/test/fixtures/payload-licicolba.json');

const CARGOS: CargoPantallaDto[] = [
  { id: 1, nombre: 'ASEADOR', cantidad: 4, horasSemana: 48, jornada: 8, salario: 1423500, arlKey: 'I', codigoHorario: '941', valorTotal: 9140000, esTurnante: false },
  { id: 2, nombre: 'Turnante — bloque integrado de 42h', cantidad: 1, horasSemana: 42, jornada: null, salario: 1423500, arlKey: 'II', codigoHorario: '', valorTotal: 3000000, esTurnante: true },
];

function payload() {
  return armarPayloadContratos({
    solicitud: { id: 7, codigoProceso: 'SED-LP-2026-0091', entidad: 'Cliente de Prueba S.A.S.', objeto: 'Servicio de aseo integral', nitContacto: '900.123.456-8', direccionContacto: 'Calle 1 # 2-3' },
    procesoCodigo: 'SED-LP-2026-0091',
    resultado: { valorMesIncluidoIva: 16000000, vigenciaMeses: 12, porcentajeIU: 8 },
    // Mano de obra 12.140.000 = la suma de los cargos de arriba.
    totales: { manoObra: 12140000, otrosCostosEnManoObra: 320000, insumos: 0, maquinaria: 0, serviciosNoContinuos: 0, valorAgregado: 0, administrativos: 5000, total: 12145000 },
    destino: leerDestino({ empresa: '01', undnegocio: 'BAQ', tipoAdm: 'A', origenProceso: 'LIC', codServicio: 'ASE', descripcionServicio: 'Aseo y cafetería' }),
    cargos: cargosParaPuente(CARGOS),
  });
}

describe('contrato v1 LiciColba ↔ puente', () => {
  it('el payload que arma LiciColba es exactamente el archivo que valida el puente', () => {
    if (process.env.ACTUALIZAR_CONTRATO) writeFileSync(RUTA, `${JSON.stringify(payload(), null, 2)}\n`, 'utf8');
    const esperado = JSON.parse(readFileSync(RUTA, 'utf8'));
    expect(JSON.parse(JSON.stringify(payload()))).toEqual(esperado);
  });
});
