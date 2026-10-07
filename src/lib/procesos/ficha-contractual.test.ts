/**
 * Bloque 1B / 1B.1 — contrato único de ficha contractual + fuente canónica.
 * Fixtures tomados de registros reales consultados en solo lectura (ver
 * entregable de cada bloque), con solo los campos no sensibles necesarios.
 */
import { describe, it, expect } from 'vitest';
import {
  construirFichaDesdeProceso,
  construirFichaDesdeSolicitud,
  type ProcesoParaFicha,
  type SolicitudParaFicha,
} from './ficha-contractual';

describe('construirFichaDesdeProceso', () => {
  it('A — SECOP II real (Proceso.id=7428, INDERHUILA)', () => {
    const proceso: ProcesoParaFicha = {
      id: 7428, _dbId: 7428, externalId: '11835152',
      codigoProceso: 'IPMCIH015 DE 2026', nombre: 'Contratación mínima cuantía IPMCIH015 DE 2026',
      entidad: 'INDERHUILA', objeto: 'CONTRATAR EL SERVICIO...', fuente: 'secop II', aliasFuente: 'S2',
      modalidad: 'Contratación mínima cuantía', valor: 27021609, departamento: 'Huila : Neiva',
      estado: 'En Evaluacion', fechaPublicacion: '2026-07-17T21:08:39.000Z',
      fechaVencimiento: '2026-07-24T14:00:00.000Z',
      linkDetalle: 'https://www.secop.gov.co/CO1BusinessLine/Tendering/ContractNoticeView/Index?notice=CO1.NTC.10536739',
    };
    const f = construirFichaDesdeProceso(proceso);
    expect(f.procesoId).toBe(7428);
    expect(f.origenContrato).toBe('PROCESO_VIGENTE');
    expect(f.fechaLimiteMostrada).toBe('2026-07-24T14:00:00.000Z');
    expect(f.origenFechaLimite).toBe('FECHA_VENCIMIENTO');
  });

  it('F — todos los campos opcionales ausentes → null, sin lanzar', () => {
    const f = construirFichaDesdeProceso({ id: 1 });
    expect(f.entidad).toBeNull();
    expect(f.presupuesto).toBeNull();
    expect(f.fechaLimiteMostrada).toBeNull();
    expect(f.origenFechaLimite).toBe('SIN_FECHA');
    expect(f.linkDetalle).toBeNull();
    expect(f.origenContrato).toBe('PROCESO_VIGENTE');
  });

  it('G — cadenas vacías se normalizan a null', () => {
    const f = construirFichaDesdeProceso({ id: 1, entidad: '   ', codigoProceso: '' });
    expect(f.entidad).toBeNull();
    expect(f.numeroProceso).toBeNull();
  });

  it('I/J — linkDetalle genérico se descarta, real se preserva', () => {
    expect(construirFichaDesdeProceso({ id: 1, linkDetalle: 'https://portal-nc.example' }).linkDetalle).toBeNull();
    expect(construirFichaDesdeProceso({ id: 1, linkDetalle: 'https://portal-nc.example/' }).linkDetalle).toBeNull();
    expect(construirFichaDesdeProceso({ id: 1, linkDetalle: 'https://www.secop.gov.co/x?notice=1' }).linkDetalle).toContain('secop.gov.co');
  });

  it('L — presupuesto máximo real observado en BD (≈78.827.808.744) no pierde precisión', () => {
    const grande = 78_827_808_744;
    const f = construirFichaDesdeProceso({ id: 1, valor: grande });
    expect(f.presupuesto).toBe(grande);
    expect(Number.isSafeInteger(f.presupuesto)).toBe(true);
  });

  it('J (cronograma/documentos) — presentes en el input → DISPONIBLE; ausentes → NO_CARGADO; adendas siempre NO_CARGADO desde Proceso puro', () => {
    const f1 = construirFichaDesdeProceso({ id: 1, cronogramas: [{ a: 1 }], documentos: [] });
    expect(f1.estadoCronograma).toBe('DISPONIBLE');
    expect(f1.estadoDocumentos).toBe('DISPONIBLE'); // arreglo vacío es un valor real, no "no cargado".
    expect(f1.estadoAdendas).toBe('NO_CARGADO');

    const f2 = construirFichaDesdeProceso({ id: 1 });
    expect(f2.estadoCronograma).toBe('NO_CARGADO');
    expect(f2.estadoDocumentos).toBe('NO_CARGADO');
  });

  it('P — nunca incluye rawJson/procData/docData/obsData/asignaciones/estadoSolicitud/permisos', () => {
    const f = construirFichaDesdeProceso({ id: 1 }) as unknown as Record<string, unknown>;
    expect(f.rawJson).toBeUndefined();
    expect(f.procData).toBeUndefined();
    expect(f.docData).toBeUndefined();
    expect(f.obsData).toBeUndefined();
    expect(f.asignaciones).toBeUndefined();
    expect(f.estadoSolicitud).toBeUndefined();
    expect(f.permisos).toBeUndefined();
  });
});

describe('construirFichaDesdeSolicitud — sin Proceso (F/N — Solicitud manual)', () => {
  it('F — Solicitud manual sin procesoId → origenContrato SOLICITUD_MANUAL', () => {
    const solicitud: SolicitudParaFicha = {
      id: 124, procesoId: null, procesoSourceKey: 'INVITACIÓN PÚBLICA GTI 01 DE 2026 FONDO 0101854||S2',
      codigoProceso: 'INVITACIÓN PÚBLICA GTI 01 DE 2026 FONDO 0101854',
      entidad: 'UNIVERSIDAD TECNOLÓGICA DE PEREIRA', fuente: 'secop II', aliasFuente: 'S2',
      fechaCierre: null, fechaVencimiento: null,
    };
    const f = construirFichaDesdeSolicitud(solicitud);
    expect(f.origenContrato).toBe('SOLICITUD_MANUAL');
    expect(f.procesoId).toBeNull();
    expect(f.origenFechaLimite).toBe('SIN_FECHA');
  });

  it('G — procesoId presente pero Proceso no disponible (no se pasó procesoOpcional) → SOLICITUD_SIN_PROCESO', () => {
    const solicitud: SolicitudParaFicha = { id: 5, procesoId: 999, entidad: 'X' };
    const f = construirFichaDesdeSolicitud(solicitud);
    expect(f.origenContrato).toBe('SOLICITUD_SIN_PROCESO');
    expect(f.procesoId).toBe(999);
    expect(f.entidad).toBe('X'); // se sigue usando la Solicitud.
  });

  it('K — adendas NO_APLICA cuando no hay Proceso en absoluto', () => {
    const f = construirFichaDesdeSolicitud({ id: 1 });
    expect(f.estadoAdendas).toBe('NO_APLICA');
  });
});

describe('construirFichaDesdeSolicitud — con Proceso coherente (regla canónica)', () => {
  it('D — Solicitud vinculada, Proceso con valores iguales → PROCESO_VIGENTE, sin divergencia', () => {
    const solicitud: SolicitudParaFicha = {
      id: 292, procesoId: 7731, codigoProceso: 'CONTRATACIÓN EMPRESA DE VIGILANCIA',
      entidad: 'CRUZ ROJA COLOMBIANA', externalId: '999',
      fechaCierre: '2026-08-14T12:00:00.000Z', fechaVencimiento: '2026-08-14T00:00:00.000Z',
    };
    const proceso: ProcesoParaFicha = {
      id: 7731, _dbId: 7731, codigoProceso: 'CONTRATACIÓN EMPRESA DE VIGILANCIA',
      entidad: 'CRUZ ROJA COLOMBIANA', externalId: '999', modalidad: 'Invitación', valor: 100,
    };
    const f = construirFichaDesdeSolicitud(solicitud, proceso);
    expect(f.origenContrato).toBe('PROCESO_VIGENTE');
    // Regresión Caso C — no revertida.
    expect(f.fechaCierreOriginal).toBe('2026-08-14T12:00:00.000Z');
    expect(f.fechaVencimientoVigente).toBe('2026-08-14T00:00:00.000Z');
    expect(f.fechaLimiteMostrada).toBe('2026-08-14T12:00:00.000Z');
    expect(f.origenFechaLimite).toBe('FECHA_CIERRE');
  });

  it('B — Proceso con objeto DIFERENTE (coherente en identidad, pero el texto de objeto cambió tras la creación) → Proceso vigente gana en objeto', () => {
    const solicitud: SolicitudParaFicha = { id: 1, codigoProceso: 'C-1', entidad: 'E-1', externalId: '111', objeto: 'Objeto original al crear' };
    const proceso: ProcesoParaFicha = { id: 1, _dbId: 1, codigoProceso: 'C-1', entidad: 'E-1', externalId: '111', objeto: 'Objeto corregido por la entidad después' };
    const f = construirFichaDesdeSolicitud(solicitud, proceso);
    expect(f.origenContrato).toBe('PROCESO_VIGENTE');
    expect(f.objeto).toBe('Objeto corregido por la entidad después');
  });

  it('C — fecha vigente del Proceso diferente de la fotografía de Solicitud: ambas se conservan, se prioriza fechaCierreOriginal', () => {
    const solicitud: SolicitudParaFicha = { id: 137, externalId: '1', fechaCierre: '2026-07-23T12:00:00.000Z', fechaVencimiento: '2026-07-02T05:00:00.000Z' };
    const proceso: ProcesoParaFicha = { id: 1, _dbId: 1, externalId: '1', fechaVencimiento: '2026-07-30T00:00:00.000Z' };
    const f = construirFichaDesdeSolicitud(solicitud, proceso);
    // fechaVencimientoVigente sigue viniendo de la Solicitud si ella ya la trae (no se sobreescribe con el Proceso) — solo se completa desde Proceso si la Solicitud no la tiene.
    expect(f.fechaVencimientoVigente).toBe('2026-07-02T05:00:00.000Z');
    expect(f.fechaCierreOriginal).toBe('2026-07-23T12:00:00.000Z');
    expect(f.fechaLimiteMostrada).toBe('2026-07-23T12:00:00.000Z');
    expect(f.fechaCierreOriginal).not.toBe(f.fechaVencimientoVigente);
  });

  it('D (linkDetalle) — actualizado en Proceso: el Proceso vigente gana', () => {
    const solicitud: SolicitudParaFicha = { id: 1, externalId: '1', linkDetalle: 'https://www.secop.gov.co/viejo' };
    const proceso: ProcesoParaFicha = { id: 1, _dbId: 1, externalId: '1', linkDetalle: 'https://www.secop.gov.co/actualizado' };
    const f = construirFichaDesdeSolicitud(solicitud, proceso);
    expect(f.linkDetalle).toBe('https://www.secop.gov.co/actualizado');
  });

  it('E — estado externo actualizado en Proceso: el Proceso vigente gana', () => {
    const solicitud: SolicitudParaFicha = { id: 1, externalId: '1', estadoFuente: 'Convocatoria' };
    const proceso: ProcesoParaFicha = { id: 1, _dbId: 1, externalId: '1', estado: 'Adjudicado' };
    const f = construirFichaDesdeSolicitud(solicitud, proceso);
    expect(f.estadoExterno).toBe('Adjudicado');
  });

  it('H — Proceso con valor null y Solicitud con valor histórico → se conserva el de Solicitud (reserva)', () => {
    const solicitud: SolicitudParaFicha = { id: 1, externalId: '1', modalidad: 'Mínima cuantía histórica', departamento: 'Huila' };
    const proceso: ProcesoParaFicha = { id: 1, _dbId: 1, externalId: '1', modalidad: null, departamento: null };
    const f = construirFichaDesdeSolicitud(solicitud, proceso);
    expect(f.modalidad).toBe('Mínima cuantía histórica');
    expect(f.departamento).toBe('Huila');
  });

  it('I — Solicitud con null y Proceso con valor vigente → se usa el del Proceso', () => {
    const solicitud: SolicitudParaFicha = { id: 1, externalId: '1', modalidad: null };
    const proceso: ProcesoParaFicha = { id: 1, _dbId: 1, externalId: '1', modalidad: 'Licitación pública' };
    const f = construirFichaDesdeSolicitud(solicitud, proceso);
    expect(f.modalidad).toBe('Licitación pública');
  });

  it('Caso real medido (19 Solicitudes NC): Proceso bare (perfil/departamento/modalidad null) no vacía la ficha — se usa la Solicitud', () => {
    const solicitud: SolicitudParaFicha = {
      id: 296, procesoId: 7755, codigoProceso: 'No 26001191', entidad: 'FONDO DE GARANTIAS DEL CARIBE S.A',
      fuente: 'Manual', aliasFuente: 'NC', perfil: 'Aseocolba', modalidad: 'Cotización', departamento: 'Atlántico',
      fechaCierre: '2026-07-28T00:00:00.000Z', fechaVencimiento: '2026-07-28T00:00:00.000Z',
    };
    const procesoBare: ProcesoParaFicha = {
      id: 7755, _dbId: 7755, codigoProceso: 'No 26001191', entidad: 'FONDO DE GARANTIAS DEL CARIBE S.A',
      perfil: null, modalidad: null, departamento: null, fechaVencimiento: null,
    };
    const f = construirFichaDesdeSolicitud(solicitud, procesoBare);
    expect(f.origenContrato).toBe('PROCESO_VIGENTE'); // coherente por llave de negocio (código+entidad).
    expect(f.empresaPerfil).toBe('Aseocolba'); // interno, siempre de Solicitud.
    expect(f.modalidad).toBe('Cotización'); // Proceso null → reserva a Solicitud.
    expect(f.departamento).toBe('Atlántico');
  });
});

describe('Bloque 1B.1 — protección contra Proceso incoherente (regresión real: ids 140, 11, 173)', () => {
  it('procesoId apunta a un Proceso de OTRA entidad con el mismo codigoProceso → se ignora el Proceso para identidad, origenContrato=SOLICITUD_SIN_PROCESO', () => {
    // Reproduce exactamente el caso real medido: Solicitud 140 (Angelópolis) vs Proceso 6151 (Colón, Putumayo) — mismo código "CMC-025-2026".
    const solicitud: SolicitudParaFicha = {
      id: 140, procesoId: 6151, codigoProceso: 'CMC-025-2026', entidad: 'ALCALDIA MUNICIPIO DE ANGELOPOLIS',
      externalId: '11712842', objeto: 'PRESTACIÓN DE SERVICIOS DE APOYO...',
    };
    const procesoEquivocado: ProcesoParaFicha = {
      id: 6151, _dbId: 6151, codigoProceso: 'CMC-025-2026', entidad: 'PUTUMAYO - ALCALDÍA MUNICIPIO DE COLÓN',
      externalId: '11629698', objeto: 'MANTENIMIENTO MEDIANTE ROSERIA...',
    };
    const f = construirFichaDesdeSolicitud(solicitud, procesoEquivocado);
    expect(f.origenContrato).toBe('SOLICITUD_SIN_PROCESO');
    // La ficha NUNCA muestra la entidad/objeto del Proceso equivocado.
    expect(f.entidad).toBe('ALCALDIA MUNICIPIO DE ANGELOPOLIS');
    expect(f.objeto).toBe('PRESTACIÓN DE SERVICIOS DE APOYO...');
    expect(f.externalId).toBe('11712842');
  });

  it('externalId coincidente rescata la identidad aunque la entidad transcrita difiera por formato', () => {
    const solicitud: SolicitudParaFicha = { id: 1, externalId: 'EXT-1', entidad: 'Entidad Con Formato Distinto', codigoProceso: 'C1' };
    const proceso: ProcesoParaFicha = { id: 1, _dbId: 1, externalId: 'EXT-1', entidad: 'ENTIDAD CON FORMATO DISTINTO', codigoProceso: 'C1', modalidad: 'X' };
    const f = construirFichaDesdeSolicitud(solicitud, proceso);
    expect(f.origenContrato).toBe('PROCESO_VIGENTE');
    expect(f.modalidad).toBe('X'); // se confía en el resto de campos sincronizables.
  });
});

describe('N — el contexto no modifica los datos contractuales', () => {
  it('llamar el mismo constructor "para 3 contextos" produce exactamente el mismo resultado', () => {
    const proceso: ProcesoParaFicha = { id: 1, _dbId: 1, entidad: 'E', valor: 100 };
    const paraBusqueda = construirFichaDesdeProceso(proceso);
    const paraProcesos = construirFichaDesdeProceso(proceso);
    expect(paraBusqueda).toEqual(paraProcesos);
  });
});

describe('O — nunca aparecen campos internos de Solicitudes en el DTO (con Proceso)', () => {
  it('construirFichaDesdeSolicitud con procesoOpcional tampoco filtra procData/docData crudo/obsData/asignaciones', () => {
    const f = construirFichaDesdeSolicitud({ id: 1 }, { id: 1, _dbId: 1 }) as unknown as Record<string, unknown>;
    expect(f.procData).toBeUndefined();
    expect(f.obsData).toBeUndefined();
    expect(f.asignaciones).toBeUndefined();
    expect(f.estadoSolicitud).toBeUndefined();
    expect(f.estadoRevision).toBeUndefined();
    expect(f.observaciones).toBeUndefined();
    expect(f.evidencias).toBeUndefined();
  });
});

describe('Paridad entre contextos (§17 Bloque 1B + §10 Bloque 1B.1)', () => {
  const procesoFixture: ProcesoParaFicha = {
    id: 7428, _dbId: 7428, externalId: '11835152', codigoProceso: 'IPMCIH015 DE 2026',
    nombre: 'Contratación mínima cuantía IPMCIH015 DE 2026', entidad: 'INDERHUILA',
    objeto: 'CONTRATAR EL SERVICIO...', fuente: 'secop II', aliasFuente: 'S2',
    modalidad: 'Contratación mínima cuantía', valor: 27021609, departamento: 'Huila : Neiva',
    estado: 'En Evaluacion', fechaPublicacion: '2026-07-17T21:08:39.000Z',
    fechaVencimiento: '2026-07-24T14:00:00.000Z',
    linkDetalle: 'https://www.secop.gov.co/CO1BusinessLine/Tendering/ContractNoticeView/Index?notice=CO1.NTC.10536739',
  };

  it('M — mismo proceso en contexto Búsqueda y Procesos produce el mismo DTO', () => {
    const fichaBusqueda = construirFichaDesdeProceso(procesoFixture);
    const fichaProcesos = construirFichaDesdeProceso(procesoFixture);
    expect(fichaBusqueda).toEqual(fichaProcesos);
  });

  it('mismo Proceso vinculado → mismo contrato en Búsqueda → Procesos → Solicitudes, incluso con la copia de Solicitud desactualizada', () => {
    // La Solicitud trae una copia vieja de "modalidad" y "objeto" — el
    // Proceso vigente (coherente) debe ganar en ambos, igualando el
    // resultado al que ya producen Búsqueda/Procesos con el mismo Proceso.
    const solicitudDesactualizada: SolicitudParaFicha = {
      id: 243, procesoId: 7428, codigoProceso: 'IPMCIH015 DE 2026', entidad: 'INDERHUILA', externalId: '11835152',
      objeto: 'texto viejo desactualizado', modalidad: 'modalidad vieja desactualizada',
      valor: 1, // presupuesto viejo — debe ganar el del Proceso.
    };
    const fichaBusqueda = construirFichaDesdeProceso(procesoFixture);
    const fichaSolicitudes = construirFichaDesdeSolicitud(solicitudDesactualizada, procesoFixture);

    expect(fichaSolicitudes.origenContrato).toBe('PROCESO_VIGENTE');
    const CAMPOS_QUE_DEBEN_IGUALAR: (keyof typeof fichaBusqueda)[] = ['objeto', 'modalidad', 'presupuesto', 'departamento', 'fechaVencimientoVigente', 'linkDetalle', 'estadoExterno'];
    for (const campo of CAMPOS_QUE_DEBEN_IGUALAR) {
      expect(fichaSolicitudes[campo]).toEqual(fichaBusqueda[campo]);
    }
  });

  it('N — el contexto (transportado como string aparte) no altera ningún valor contractual', () => {
    const contextos: Array<'BUSQUEDA' | 'PROCESOS' | 'SOLICITUDES'> = ['BUSQUEDA', 'PROCESOS', 'SOLICITUDES'];
    const fichas = contextos.map(() => construirFichaDesdeProceso(procesoFixture));
    expect(fichas[0]).toEqual(fichas[1]);
    expect(fichas[1]).toEqual(fichas[2]);
  });
});

describe('paridad Data API — aliasFuente ausente se deriva de origenFuncional', () => {
  // Caso real: CP-019-JNCI-2026 (externalId 12055133, Junta Nacional de
  // Calificación de Invalidez) — Secop II en el origen (licycolba), pero el
  // Proceso creado vía Data API en licycolba-final nunca trae `aliasFuente`
  // (mapeoCanonico.ts lo excluye deliberadamente del contrato canónico) — sin
  // este fallback, la ficha de Búsqueda mostraba "Contrato privado".
  //
  // `origenFuncional` es el valor REAL leído de la base (PUBLICO_REGISTRADO).
  // Antes este fixture decía PUBLICO_ABIERTO sin haberse verificado nunca, y
  // como el mapeo también estaba invertido el test pasaba por partida doble.
  const cp019: ProcesoParaFicha = {
    id: 'a492542e-fd48-431f-b13f-8399ade7e1b5', _dbId: 9064, externalId: '12055133',
    codigoProceso: 'CP-019-JNCI-2026', nombre: 'CP-019-JNCI-2026',
    entidad: 'JUNTA NACIONAL DE CALIFICACION DE INVALIDEZ', objeto: 'objeto',
    fuente: null, aliasFuente: null, origenFuncional: 'PUBLICO_REGISTRADO',
    modalidad: 'Régimen Especial', estado: 'Convocatoria',
    fechaPublicacion: '2026-09-09T18:47:53.000Z', fechaVencimiento: '2026-09-15T03:00:00.000Z',
  };

  it('Proceso Data API con origenFuncional=PUBLICO_REGISTRADO y aliasFuente=null → se resuelve como S2 (Secop II), nunca privado', () => {
    const f = construirFichaDesdeProceso(cp019);
    expect(f.aliasFuente).toBe('S2');
  });

  it('origenFuncional=PUBLICO_ABIERTO → S1 (Secop I)', () => {
    const f = construirFichaDesdeProceso({ ...cp019, origenFuncional: 'PUBLICO_ABIERTO' });
    expect(f.aliasFuente).toBe('S1');
  });

  it('aliasFuente ya presente (fila legacy) SIEMPRE gana sobre origenFuncional', () => {
    const f = construirFichaDesdeProceso({ ...cp019, aliasFuente: 'NC', origenFuncional: 'PUBLICO_REGISTRADO' });
    expect(f.aliasFuente).toBe('NC');
  });

  it('origenFuncional=PRIVADO/MANUAL/DESCONOCIDO no inventa un alias SECOP', () => {
    for (const of_ of ['PRIVADO', 'MANUAL', 'DESCONOCIDO'] as const) {
      const f = construirFichaDesdeProceso({ ...cp019, origenFuncional: of_ });
      expect(f.aliasFuente).toBeNull();
    }
  });

  it('mismo fallback aplica vía construirFichaDesdeSolicitud cuando el Proceso vinculado es coherente', () => {
    const solicitud: SolicitudParaFicha = {
      id: 453, procesoId: 9064, codigoProceso: 'CP-019-JNCI-2026', entidad: 'JUNTA NACIONAL DE CALIFICACION DE INVALIDEZ',
      externalId: '12055133', aliasFuente: null,
    };
    const f = construirFichaDesdeSolicitud(solicitud, cp019);
    expect(f.origenContrato).toBe('PROCESO_VIGENTE');
    expect(f.aliasFuente).toBe('S2');
  });
});