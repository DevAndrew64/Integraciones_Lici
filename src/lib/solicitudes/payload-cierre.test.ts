import { describe, it, expect } from 'vitest';
import {
  payloadCierreAdjudicado, payloadCierreNoAdjudicado, payloadCierreDirecto,
  payloadRechazoSimple, payloadRechazoCausal, payloadCierreGerencial,
} from './payload-cierre';

describe('payload-cierre — construcción pura del body de /cerrar', () => {
  it('payloadCierreAdjudicado produce la forma esperada por la allowlist del backend', () => {
    expect(payloadCierreAdjudicado('ASG-1')).toEqual({
      idAsignacion: 'ASG-1', resultadoEstado: 'Cerrada',
      filaExtra: { estadoRevision: 'CERRADO_ADJUDICADO', resultadoFinal: 'Adjudicado' },
    });
  });

  it('payloadCierreNoAdjudicado produce la forma esperada', () => {
    expect(payloadCierreNoAdjudicado('ASG-2')).toEqual({
      idAsignacion: 'ASG-2', resultadoEstado: 'Cerrada',
      filaExtra: { estadoRevision: 'CERRADO_NO_ADJUDICADO', resultadoFinal: 'No adjudicado' },
    });
  });

  it('payloadCierreDirecto con causa "Cancelación por la entidad" produce resultadoEstado=Cancelada y estadoRevision=CANCELADO', () => {
    const p = payloadCierreDirecto('ASG-1', 'Cancelación por la entidad', 'detalle', null);
    expect(p.resultadoEstado).toBe('Cancelada');
    expect(p.filaExtra.estadoRevision).toBe('CANCELADO');
  });

  it('payloadCierreDirecto con otra causa produce resultadoEstado=Cerrada y estadoRevision=CERRADO_NO_CUMPLIMIENTO', () => {
    const p = payloadCierreDirecto('ASG-1', 'Presupuesto insuficiente', null, null);
    expect(p.resultadoEstado).toBe('Cerrada');
    expect(p.filaExtra.estadoRevision).toBe('CERRADO_NO_CUMPLIMIENTO');
  });

  it('payloadCierreDirecto recorta el detalle y convierte vacío en null', () => {
    const p = payloadCierreDirecto('ASG-1', 'Otros', '   ', null);
    expect(p.filaExtra.detalleCierreDirecto).toBeNull();
  });

  it('payloadCierreDirecto conserva la evidencia tal cual cuando se provee', () => {
    const ev = { nombre: 'a.pdf', tipo: 'application/pdf', base64: 'AAAA' };
    const p = payloadCierreDirecto('ASG-1', 'Otros', null, ev);
    expect(p.filaExtra.evidenciaCierre).toEqual(ev);
  });

  it('payloadRechazoSimple produce la forma esperada', () => {
    expect(payloadRechazoSimple('ASG-1', 'No cumple requisitos.')).toEqual({
      idAsignacion: 'ASG-1', resultadoEstado: 'Cerrada',
      filaExtra: { estadoRevision: 'RECHAZADO', motivoRechazo: 'No cumple requisitos.' },
    });
  });

  it('payloadRechazoCausal produce la forma esperada, incluyendo urlEvidenciaRechazo=null cuando no hay adjunto', () => {
    expect(payloadRechazoCausal('ASG-1', 'PROCESO_DUPLICADO', 'ya existe otro', null)).toEqual({
      idAsignacion: 'ASG-1', resultadoEstado: 'Cerrada',
      filaExtra: { estadoRevision: 'RECHAZADO', causalRechazo: 'PROCESO_DUPLICADO', observacionRechazo: 'ya existe otro', urlEvidenciaRechazo: null },
    });
  });

  it('payloadRechazoCausal conserva la URL de evidencia cuando se provee', () => {
    const p = payloadRechazoCausal('ASG-1', 'DECISION_GERENCIAL', '', '/uploads/x.pdf');
    expect(p.filaExtra.urlEvidenciaRechazo).toBe('/uploads/x.pdf');
  });

  it('payloadCierreGerencial produce la forma esperada, sin resultadoFinal', () => {
    const p = payloadCierreGerencial('ASG-1', 'Nota de la decisión gerencial.');
    expect(p).toEqual({
      idAsignacion: 'ASG-1', resultadoEstado: 'Cerrada',
      filaExtra: { estadoRevision: 'CERRADO_NO_ADJUDICADO', tipoCausa: 'Determinación gerencial', causaEspecifica: 'Nota de la decisión gerencial.' },
    });
    expect(p.filaExtra.resultadoFinal).toBeUndefined();
  });

  it('ningún payload incluye idAsignacion, analistaAsignado, asignadoPor, fechaAsignacion u observaciones dentro de filaExtra', () => {
    const payloads = [
      payloadCierreAdjudicado('ASG-1'), payloadCierreNoAdjudicado('ASG-1'),
      payloadCierreDirecto('ASG-1', 'Otros', 'x', null),
      payloadRechazoSimple('ASG-1', 'x'), payloadRechazoCausal('ASG-1', 'PROCESO_DUPLICADO', '', null),
      payloadCierreGerencial('ASG-1', 'x'),
    ];
    const clavesProhibidas = ['idAsignacion', 'analistaAsignado', 'asignadoPor', 'fechaAsignacion', 'observaciones'];
    for (const p of payloads) {
      for (const clave of clavesProhibidas) {
        expect(Object.keys(p.filaExtra)).not.toContain(clave);
      }
    }
  });

  it('ningún payload manda el arreglo completo de asignaciones ni identificadores de Solicitud/SQR', () => {
    const p = payloadCierreAdjudicado('ASG-1');
    expect(Object.keys(p)).toEqual(['idAsignacion', 'resultadoEstado', 'filaExtra']);
  });
});