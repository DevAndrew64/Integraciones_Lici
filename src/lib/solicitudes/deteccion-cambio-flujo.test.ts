import { describe, it, expect } from 'vitest';
import { detectarCambioDeFlujoNoAutorizado } from './deteccion-cambio-flujo';

describe('detectarCambioDeFlujoNoAutorizado', () => {
  it('detecta el valor canónico directo', () => {
    expect(detectarCambioDeFlujoNoAutorizado({ estadoSolicitud: 'EN_REVISION' }, []).detectado).toBe(true);
    expect(detectarCambioDeFlujoNoAutorizado({ estadoSolicitud: 'ASIGNADO_REVISION' }, []).detectado).toBe(true);
    expect(detectarCambioDeFlujoNoAutorizado({ estadoSolicitud: 'EN_ELABORACION' }, []).detectado).toBe(true);
  });

  it('detecta variantes de mayúsculas/minúsculas y espacios', () => {
    expect(detectarCambioDeFlujoNoAutorizado({ estadoSolicitud: 'en_revision' }, []).detectado).toBe(true);
    expect(detectarCambioDeFlujoNoAutorizado({ estadoSolicitud: '  En_Elaboracion  ' }, []).detectado).toBe(true);
    expect(detectarCambioDeFlujoNoAutorizado({ estadoSolicitud: '  en_elaboracion  ' }, []).detectado).toBe(true);
  });

  it('NO bloquea la etiqueta legada en español todavía usada por flujos activos', () => {
    expect(detectarCambioDeFlujoNoAutorizado({ estadoSolicitud: 'Asignado para revisión' }, []).detectado).toBe(false);
    expect(detectarCambioDeFlujoNoAutorizado({ estadoSolicitud: 'Asignado para elaboración' }, []).detectado).toBe(false);
    expect(detectarCambioDeFlujoNoAutorizado({ estadoSolicitud: 'En observación' }, []).detectado).toBe(false);
  });

  it('detecta el intento de colar el cambio dentro de asignaciones[].estadoRevision', () => {
    const asignacionesEnBd = [{ idAsignacion: 'ASG-1', estadoRevision: 'ASIGNADO_REVISION' }];
    const body = { asignaciones: [{ idAsignacion: 'ASG-1', estadoRevision: 'EN_REVISION' }] };
    const r = detectarCambioDeFlujoNoAutorizado(body, asignacionesEnBd);
    expect(r.detectado).toBe(true);
    expect(r.motivo).toContain('ASG-1');
  });

  it('detecta la evasión de mandar el arreglo COMPLETO con una sola fila modificada', () => {
    const asignacionesEnBd = [
      { idAsignacion: 'ASG-1', analistaAsignado: 'juan.davila', estadoRevision: 'ASIGNADO_REVISION' },
      { idAsignacion: 'ASG-2', analistaAsignado: 'laura.buelvas', estadoRevision: 'ASIGNADO_REVISION' },
    ];
    const body = {
      asignaciones: [
        { idAsignacion: 'ASG-1', analistaAsignado: 'juan.davila', estadoRevision: 'ASIGNADO_REVISION' }, // igual
        { idAsignacion: 'ASG-2', analistaAsignado: 'laura.buelvas', estadoRevision: 'en_elaboracion' }, // modificada, minúscula
      ],
    };
    expect(detectarCambioDeFlujoNoAutorizado(body, asignacionesEnBd).detectado).toBe(true);
  });

  it('NO bloquea un PATCH que reenvía asignaciones[] intacto (ej. para agregar una observación en otra fila)', () => {
    const asignacionesEnBd = [{ idAsignacion: 'ASG-1', estadoRevision: 'ASIGNADO_REVISION', observaciones: ['vieja'] }];
    const body = { asignaciones: [{ idAsignacion: 'ASG-1', estadoRevision: 'ASIGNADO_REVISION', observaciones: ['vieja', 'nueva'] }] };
    expect(detectarCambioDeFlujoNoAutorizado(body, asignacionesEnBd).detectado).toBe(false);
  });

  it('NO bloquea una fila nueva (sin contraparte en BD) con un estadoRevision legítimo no bloqueado', () => {
    // Fase 2B-2.2.8 — 'PRESENTADO' (usado aquí desde la Fase 2B-2.2.5,
    // cuando reemplazó a 'APROBADO_ELABORACION' por el mismo motivo) pasa a
    // estar bloqueado; se reemplaza por 'REVISION_FINALIZADA', preservando
    // nombre/estructura/aserción del test.
    const body = { asignaciones: [{ idAsignacion: 'ASG-NUEVA', estadoRevision: 'REVISION_FINALIZADA' }] };
    expect(detectarCambioDeFlujoNoAutorizado(body, []).detectado).toBe(false);
  });

  it('sin estadoSolicitud ni asignaciones en el body → no detectado', () => {
    expect(detectarCambioDeFlujoNoAutorizado({}, []).detectado).toBe(false);
  });

  // Fase 2B-2.2.5 — APROBADO_ELABORACION (FINALIZAR_REVISION) pasa a ser
  // exclusivo de POST /[id]/finalizar-revision; el PATCH genérico ya no
  // puede escribirlo.
  it('detecta APROBADO_ELABORACION como valor canónico directo', () => {
    expect(detectarCambioDeFlujoNoAutorizado({ estadoSolicitud: 'APROBADO_ELABORACION' }, []).detectado).toBe(true);
  });

  it('detecta APROBADO_ELABORACION con variantes de mayúsculas/minúsculas y espacios', () => {
    expect(detectarCambioDeFlujoNoAutorizado({ estadoSolicitud: 'aprobado_elaboracion' }, []).detectado).toBe(true);
    expect(detectarCambioDeFlujoNoAutorizado({ estadoSolicitud: '  Aprobado_Elaboracion  ' }, []).detectado).toBe(true);
  });

  it('detecta APROBADO_ELABORACION dentro de asignaciones[].estadoRevision (cambio real respecto a BD)', () => {
    const asignacionesEnBd = [{ idAsignacion: 'ASG-1', estadoRevision: 'CON_OBSERVACIONES' }];
    const body = { asignaciones: [{ idAsignacion: 'ASG-1', estadoRevision: 'APROBADO_ELABORACION' }] };
    const r = detectarCambioDeFlujoNoAutorizado(body, asignacionesEnBd);
    expect(r.detectado).toBe(true);
    expect(r.motivo).toContain('ASG-1');
  });

  it('un estado legítimo distinto (no bloqueado) sigue sin detectarse', () => {
    // Fase 2B-2.2.8 — 'PRESENTADO' pasa a estar bloqueado (ver bloque de
    // tests dedicado más abajo); se usa 'REVISION_FINALIZADA' como ejemplo
    // de valor legítimo no bloqueado, preservando el resto del test intacto.
    expect(detectarCambioDeFlujoNoAutorizado({ estadoSolicitud: 'REVISION_FINALIZADA' }, []).detectado).toBe(false);
    const asignacionesEnBd = [{ idAsignacion: 'ASG-1', estadoRevision: 'CON_OBSERVACIONES' }];
    const body = { asignaciones: [{ idAsignacion: 'ASG-1', estadoRevision: 'REVISION_FINALIZADA' }] };
    expect(detectarCambioDeFlujoNoAutorizado(body, asignacionesEnBd).detectado).toBe(false);
  });

  it('NO bloquea la etiqueta legada "Asignado para elaboración" — sigue siendo un valor legítimo de flujos activos, distinto del token canónico', () => {
    expect(detectarCambioDeFlujoNoAutorizado({ estadoSolicitud: 'Asignado para elaboración' }, []).detectado).toBe(false);
  });

  // Fase 2B-2.2.6 — ENVIAR_A_OBSERVACION (EN_REVISION→EN_OBSERVACION) pasa a
  // ser exclusivo de POST /[id]/observaciones. Se protegen dos valores
  // distintos: el token CANÓNICO global (`EN_OBSERVACION`, en
  // `estadoSolicitud`) y su ALIAS de FILA legado (`CON_OBSERVACIONES`, en
  // `asignaciones[].estadoRevision`) — no son el mismo string.
  it('detecta EN_OBSERVACION (canónico) como estadoSolicitud directo', () => {
    expect(detectarCambioDeFlujoNoAutorizado({ estadoSolicitud: 'EN_OBSERVACION' }, []).detectado).toBe(true);
  });

  it('detecta EN_OBSERVACION con variantes de mayúsculas/minúsculas y espacios', () => {
    expect(detectarCambioDeFlujoNoAutorizado({ estadoSolicitud: 'en_observacion' }, []).detectado).toBe(true);
    expect(detectarCambioDeFlujoNoAutorizado({ estadoSolicitud: '  En_Observacion  ' }, []).detectado).toBe(true);
  });

  it('detecta CON_OBSERVACIONES (alias de fila) dentro de asignaciones[].estadoRevision cuando representa un CAMBIO REAL respecto a BD', () => {
    const asignacionesEnBd = [{ idAsignacion: 'ASG-1', estadoRevision: 'ASIGNADO_REVISION' }];
    const body = { asignaciones: [{ idAsignacion: 'ASG-1', estadoRevision: 'CON_OBSERVACIONES' }] };
    const r = detectarCambioDeFlujoNoAutorizado(body, asignacionesEnBd);
    expect(r.detectado).toBe(true);
    expect(r.motivo).toContain('ASG-1');
  });

  it('CRÍTICO: una fila que YA está en CON_OBSERVACIONES puede seguir editándose (mismo valor, sin cambio real) — no se bloquea la edición legítima de una observación existente', () => {
    const asignacionesEnBd = [{ idAsignacion: 'ASG-1', estadoRevision: 'CON_OBSERVACIONES', observaciones: ['vieja'] }];
    const body = { asignaciones: [{ idAsignacion: 'ASG-1', estadoRevision: 'CON_OBSERVACIONES', observaciones: ['vieja', 'nueva'] }] };
    expect(detectarCambioDeFlujoNoAutorizado(body, asignacionesEnBd).detectado).toBe(false);
  });

  it('una fila nueva (sin contraparte en BD) con un estadoRevision NO bloqueado conserva la regla existente: no se bloquea solo por ser nueva (nota: un valor YA bloqueado, como CON_OBSERVACIONES, sí se detecta también en una fila nueva — la regla de "no bloquear solo por ser nueva" nunca fue una excepción para valores prohibidos, mismo comportamiento ya vigente para los otros tokens)', () => {
    const body = { asignaciones: [{ idAsignacion: 'ASG-NUEVA', estadoRevision: 'LISTO_PARA_VALIDAR' }] };
    expect(detectarCambioDeFlujoNoAutorizado(body, []).detectado).toBe(false);
  });

  it('estados legítimos no relacionados (canónico y alias de fila) siguen sin bloquearse', () => {
    // Fase 2B-2.2.8 — 'PRESENTADO' pasa a estar bloqueado; se usa
    // 'REVISION_FINALIZADA' como ejemplo de valor legítimo no relacionado,
    // preservando el resto del test intacto.
    expect(detectarCambioDeFlujoNoAutorizado({ estadoSolicitud: 'REVISION_FINALIZADA' }, []).detectado).toBe(false);
    const asignacionesEnBd = [{ idAsignacion: 'ASG-1', estadoRevision: 'ASIGNADO_REVISION' }];
    const body = { asignaciones: [{ idAsignacion: 'ASG-1', estadoRevision: 'LISTO_PARA_VALIDAR' }] };
    expect(detectarCambioDeFlujoNoAutorizado(body, asignacionesEnBd).detectado).toBe(false);
  });

  it('confirma que EN_OBSERVACION (canónico) y CON_OBSERVACIONES (alias de fila) son valores DISTINTOS, ambos bloqueados por separado', () => {
    expect(detectarCambioDeFlujoNoAutorizado({ estadoSolicitud: 'EN_OBSERVACION' }, []).detectado).toBe(true);
    expect(detectarCambioDeFlujoNoAutorizado({ estadoSolicitud: 'CON_OBSERVACIONES' }, []).detectado).toBe(true); // también bloqueado si alguien lo manda como estadoSolicitud
    const asignacionesEnBd = [{ idAsignacion: 'ASG-1', estadoRevision: 'ASIGNADO_REVISION' }];
    expect(detectarCambioDeFlujoNoAutorizado({ asignaciones: [{ idAsignacion: 'ASG-1', estadoRevision: 'EN_OBSERVACION' }] }, asignacionesEnBd).detectado).toBe(true); // el canónico también se bloquea si aparece por error en una fila
  });

  it('NO bloquea la etiqueta legada "En observación" — sigue siendo un valor legítimo de flujos activos, distinto del token canónico/alias', () => {
    expect(detectarCambioDeFlujoNoAutorizado({ estadoSolicitud: 'En observación' }, []).detectado).toBe(false);
  });

  // Fase 2B-2.2.8 — PRESENTAR (EN_ELABORACION→PRESENTADO) pasa a ser
  // exclusivo de POST /[id]/transicion (acción PRESENTAR, ya transaccional
  // con lock/CAS/auditoría propios); el PATCH genérico ya no puede
  // escribir el estado canónico PRESENTADO.
  it('detecta PRESENTADO como valor canónico directo', () => {
    expect(detectarCambioDeFlujoNoAutorizado({ estadoSolicitud: 'PRESENTADO' }, []).detectado).toBe(true);
  });

  it('detecta PRESENTADO con variantes de mayúsculas/minúsculas y espacios', () => {
    expect(detectarCambioDeFlujoNoAutorizado({ estadoSolicitud: 'presentado' }, []).detectado).toBe(true);
    expect(detectarCambioDeFlujoNoAutorizado({ estadoSolicitud: '  Presentado  ' }, []).detectado).toBe(true);
  });

  it('detecta PRESENTADO dentro de asignaciones[].estadoRevision (cambio real respecto a BD)', () => {
    const asignacionesEnBd = [{ idAsignacion: 'ASG-1', estadoRevision: 'EN_ELABORACION' }];
    const body = { asignaciones: [{ idAsignacion: 'ASG-1', estadoRevision: 'PRESENTADO' }] };
    const r = detectarCambioDeFlujoNoAutorizado(body, asignacionesEnBd);
    expect(r.detectado).toBe(true);
    expect(r.motivo).toContain('ASG-1');
  });

  it('CRÍTICO: una fila que YA está en PRESENTADO puede seguir editándose (mismo valor, sin cambio real) — no se bloquea la edición legítima de un registro ya presentado', () => {
    const asignacionesEnBd = [{ idAsignacion: 'ASG-1', estadoRevision: 'PRESENTADO', observaciones: ['vieja'] }];
    const body = { asignaciones: [{ idAsignacion: 'ASG-1', estadoRevision: 'PRESENTADO', observaciones: ['vieja', 'nueva'] }] };
    expect(detectarCambioDeFlujoNoAutorizado(body, asignacionesEnBd).detectado).toBe(false);
  });

  it('una fila nueva (sin contraparte en BD) con un estadoRevision NO bloqueado conserva la regla existente: no se bloquea solo por ser nueva', () => {
    const body = { asignaciones: [{ idAsignacion: 'ASG-NUEVA', estadoRevision: 'REVISION_FINALIZADA' }] };
    expect(detectarCambioDeFlujoNoAutorizado(body, []).detectado).toBe(false);
  });

  it('estados legítimos no relacionados con PRESENTADO siguen sin bloquearse (regresión)', () => {
    expect(detectarCambioDeFlujoNoAutorizado({ estadoSolicitud: 'REVISION_FINALIZADA' }, []).detectado).toBe(false);
    expect(detectarCambioDeFlujoNoAutorizado({ estadoSolicitud: 'CANCELADA' }, []).detectado).toBe(false);
    const asignacionesEnBd = [{ idAsignacion: 'ASG-1', estadoRevision: 'ASIGNADO_REVISION' }];
    const body = { asignaciones: [{ idAsignacion: 'ASG-1', estadoRevision: 'LISTO_PARA_VALIDAR' }] };
    expect(detectarCambioDeFlujoNoAutorizado(body, asignacionesEnBd).detectado).toBe(false);
  });

  // Fase 2B-2.2.9 — estados de CIERRE a nivel de fila (RECHAZADO,
  // CERRADO_ADJUDICADO, CERRADO_NO_ADJUDICADO, CERRADO_NO_CUMPLIMIENTO,
  // CANCELADO) pasan a ser exclusivos de POST /[id]/cerrar; el PATCH
  // genérico ya no puede escribirlos en asignaciones[].estadoRevision.
  const ESTADOS_CIERRE_FILA = ['RECHAZADO', 'CERRADO_ADJUDICADO', 'CERRADO_NO_ADJUDICADO', 'CERRADO_NO_CUMPLIMIENTO', 'CANCELADO'];

  it.each(ESTADOS_CIERRE_FILA)('detecta %s dentro de asignaciones[].estadoRevision cuando representa un cambio real respecto a BD', (estado) => {
    const asignacionesEnBd = [{ idAsignacion: 'ASG-1', estadoRevision: 'ASIGNADO_REVISION' }];
    const body = { asignaciones: [{ idAsignacion: 'ASG-1', estadoRevision: estado }] };
    const r = detectarCambioDeFlujoNoAutorizado(body, asignacionesEnBd);
    expect(r.detectado).toBe(true);
    expect(r.motivo).toContain('ASG-1');
  });

  it.each(ESTADOS_CIERRE_FILA)('NO bloquea una fila que YA está en %s y no cambia (mismo valor, sin cambio real)', (estado) => {
    const asignacionesEnBd = [{ idAsignacion: 'ASG-1', estadoRevision: estado, observaciones: ['vieja'] }];
    const body = { asignaciones: [{ idAsignacion: 'ASG-1', estadoRevision: estado, observaciones: ['vieja', 'nueva'] }] };
    expect(detectarCambioDeFlujoNoAutorizado(body, asignacionesEnBd).detectado).toBe(false);
  });

  it('detecta CERRADO_ADJUDICADO como estadoSolicitud directo (si alguien lo manda por error en ese campo)', () => {
    expect(detectarCambioDeFlujoNoAutorizado({ estadoSolicitud: 'CERRADO_ADJUDICADO' }, []).detectado).toBe(true);
  });

  it('una fila nueva (sin contraparte en BD) con un estadoRevision NO bloqueado conserva la regla existente: no se bloquea solo por ser nueva (regresión tras 2B-2.2.9)', () => {
    const body = { asignaciones: [{ idAsignacion: 'ASG-NUEVA', estadoRevision: 'REVISION_FINALIZADA' }] };
    expect(detectarCambioDeFlujoNoAutorizado(body, []).detectado).toBe(false);
  });

  it('estados legítimos no relacionados con los estados de cierre por fila siguen sin bloquearse (regresión)', () => {
    expect(detectarCambioDeFlujoNoAutorizado({ estadoSolicitud: 'REVISION_FINALIZADA' }, []).detectado).toBe(false);
    const asignacionesEnBd = [{ idAsignacion: 'ASG-1', estadoRevision: 'ASIGNADO_REVISION' }];
    const body = { asignaciones: [{ idAsignacion: 'ASG-1', estadoRevision: 'LISTO_PARA_VALIDAR' }] };
    expect(detectarCambioDeFlujoNoAutorizado(body, asignacionesEnBd).detectado).toBe(false);
  });
});