import { describe, it, expect, beforeEach } from 'vitest';
import { crearSolicitudConIdentidad, SolicitudIdentidadError, type PrismaDb } from './crear-solicitud';
import type { ProcesoIdentidad } from '@/lib/proceso-identidad';

// Ajuste "BACKFILL PREVENTIVO SOLICITUD → PROCESO": los seeds de Proceso
// pueden traer linkDetalle (el tipo ProcesoIdentidad real no lo declara,
// pero la fila de BD sí lo tiene) — se agrega como campo opcional propio
// del fake, nunca como cambio al tipo importado.
type ProcesoSeed = ProcesoIdentidad & { linkDetalle?: string | null };

interface UsuarioFake {
  id: number;
  usuario: string;
  estado: string;
  cargo: string;
  rol: string;
  proceso: string | null;
  entidadGrupo: string;
}

const USUARIOS_SEED: UsuarioFake[] = [
  { id: 7, usuario: 'juan.davila', estado: 'Activo', cargo: 'Analista Comercial', rol: 'Analista Comercial', proceso: 'Comercial', entidadGrupo: 'Aseocolba' },
  { id: 8, usuario: 'nicole.ortiz', estado: 'Activo', cargo: 'Analista Comercial', rol: 'Analista Comercial', proceso: 'Comercial', entidadGrupo: 'Aseocolba' },
];

/**
 * Fake in-memory de Prisma — implementa exactamente las operaciones que usa
 * crearSolicitudConIdentidad (proceso.findUnique/findFirst/findMany/create,
 * solicitud.findFirst/create/delete, user.findFirst, auditLog.create,
 * $transaction). `$transaction` simula rollback real: si el callback lanza,
 * se descarta cualquier mutación hecha durante la llamada (incluido un
 * Proceso creado y luego abandonado por un fallo posterior en
 * Solicitud.create, o por no encontrar un responsable elegible) — ver
 * Caso C y Caso E.
 */
function crearFakeDb(procesosSeed: ProcesoSeed[] = [], usuariosSeed: UsuarioFake[] = USUARIOS_SEED) {
  let procesos: ProcesoSeed[] = [...procesosSeed];
  let solicitudes: Array<Record<string, unknown>> = [];
  const usuarios: UsuarioFake[] = [...usuariosSeed];
  const auditLogs: Array<Record<string, unknown>> = [];
  let nextProcesoId = (procesos.reduce((m, p) => Math.max(m, p.id), 0) || 0) + 1;
  let nextSolicitudId = 1;

  const impl = {
    proceso: {
      async findUnique({ where }: { where: { id: number } }) {
        return procesos.find((p) => p.id === where.id) ?? null;
      },
      async findFirst({ where }: { where: { OR: Array<{ externalId?: string; sourceKey?: string }> } }) {
        return procesos.find((p) =>
          where.OR.some((c) =>
            (c.externalId !== undefined && p.externalId === c.externalId) ||
            (c.sourceKey !== undefined && p.sourceKey === c.sourceKey)
          )
        ) ?? null;
      },
      async findMany({ where }: { where: { OR: Array<{ codigoProceso: { contains: string } }> } }) {
        const variantes = where.OR.map((c) => c.codigoProceso.contains.toLowerCase());
        return procesos.filter((p) => {
          const cod = (p.codigoProceso ?? '').toLowerCase();
          return variantes.some((v) => cod.includes(v));
        });
      },
      async create({ data }: { data: Omit<ProcesoSeed, 'id'> }) {
        const nuevo: ProcesoSeed = { id: nextProcesoId++, ...data };
        procesos.push(nuevo);
        return nuevo;
      },
      // Ajuste "BACKFILL PREVENTIVO SOLICITUD → PROCESO" / "BACKFILL
      // codigoProceso": simula la MISMA garantía real de
      // `prisma.proceso.updateMany` — genérico en el campo (linkDetalle,
      // codigoProceso, ...), solo escribe si la fila TODAVÍA cumple el
      // `WHERE` en el momento exacto de la escritura, nunca por una lectura
      // previa ya vieja (así se puede simular una carrera perdida).
      async updateMany({
        where, data,
      }: {
        where: { id: number; OR: Array<Record<string, unknown>> };
        data: Record<string, unknown>;
      }) {
        const idx = procesos.findIndex((p) => p.id === where.id);
        if (idx === -1) return { count: 0 };
        const fila = procesos[idx] as unknown as Record<string, unknown>;
        const cumpleWhere = where.OR.some((cond) =>
          Object.entries(cond).every(([campo, valor]) => (fila[campo] ?? null) === valor)
        );
        if (!cumpleWhere) return { count: 0 }; // ya no cumple el WHERE — no sobrescribe
        procesos[idx] = { ...procesos[idx], ...data } as ProcesoSeed;
        return { count: 1 };
      },
    },
    solicitud: {
      async findFirst({ where }: { where: { procesoId: number } }) {
        return solicitudes.find((s) => s.procesoId === where.procesoId) ?? null;
      },
      async create({ data }: { data: Record<string, unknown> }) {
        if (data.observacion === '__FORZAR_ERROR_TEST__') {
          throw new Error('Fallo simulado en Solicitud.create (Caso C — rollback)');
        }
        const nueva = { id: nextSolicitudId++, ...data };
        solicitudes.push(nueva);
        return nueva;
      },
      async delete({ where }: { where: { id: number } }) {
        solicitudes = solicitudes.filter((s) => s.id !== where.id);
      },
    },
    user: {
      async findFirst({ where }: { where: { usuario: string } }) {
        return usuarios.find((u) => u.usuario === where.usuario) ?? null;
      },
    },
    auditLog: {
      async create({ data }: { data: Record<string, unknown> }) {
        auditLogs.push(data);
        return { id: auditLogs.length, ...data };
      },
    },
    async $transaction<T>(cb: (tx: PrismaDb) => Promise<T>): Promise<T> {
      const snapshotProcesos = [...procesos];
      const snapshotSolicitudes = [...solicitudes];
      const snapshotAuditLen = auditLogs.length;
      try {
        return await cb(impl as unknown as PrismaDb);
      } catch (e) {
        procesos = snapshotProcesos; // rollback del Proceso creado dentro de la transacción
        solicitudes = snapshotSolicitudes; // rollback de Solicitud
        auditLogs.length = snapshotAuditLen; // rollback de AuditLog
        throw e;
      }
    },
  };

  return {
    db: impl as unknown as PrismaDb,
    getProcesos: () => procesos,
    getSolicitudes: () => solicitudes,
    getAuditLogs: () => auditLogs,
  };
}

const FORTUL: ProcesoIdentidad = {
  id: 7050, externalId: '11786506', sourceKey: 'ext:11786506',
  codigoProceso: 'No. 001-2026', entidad: 'CONCEJO MUNICIPAL DE FORTUL',
};

describe('Caso A — contradicción por procesoId', () => {
  it('rechaza con SolicitudIdentidadError, no crea Solicitud, no modifica el Proceso', async () => {
    const { db, getSolicitudes, getProcesos } = crearFakeDb([FORTUL]);
    const procesosAntes = JSON.stringify(getProcesos());

    await expect(crearSolicitudConIdentidad(db, {
      procesoId: 7050,
      entidad: 'El Grupo Honor & Laurel',
      codigoProceso: 'No. 001-2026',
    })).rejects.toThrow(SolicitudIdentidadError);

    expect(getSolicitudes()).toHaveLength(0);
    expect(JSON.stringify(getProcesos())).toBe(procesosAntes); // Proceso 7050 intacto
  });
});

describe('Caso B — contradicción por externalId', () => {
  it('rechaza con SolicitudIdentidadError, no crea Solicitud', async () => {
    const { db, getSolicitudes } = crearFakeDb([FORTUL]);

    await expect(crearSolicitudConIdentidad(db, {
      externalId: '11786506',
      entidad: 'El Grupo Honor & Laurel',
      codigoProceso: 'No. 001-2026',
    })).rejects.toThrow(SolicitudIdentidadError);

    expect(getSolicitudes()).toHaveLength(0);
  });
});

describe('Caso C — rollback de la transacción por fallo en Solicitud.create', () => {
  it('si Solicitud.create falla después de crear el Proceso, el Proceso manual no queda huérfano', async () => {
    const { db, getProcesos, getSolicitudes } = crearFakeDb([]); // sin procesos previos → forzará creación manual

    await expect(crearSolicitudConIdentidad(db, {
      codigoProceso: 'No. 002-2026',
      entidad: 'Empresa De Prueba Rollback',
      aliasFuente: 'NC',
      perfil: 'Aseocolba',
      observacion: '__FORZAR_ERROR_TEST__', // dispara el fallo simulado en solicitud.create
    })).rejects.toThrow(/Fallo simulado/);

    expect(getProcesos()).toHaveLength(0); // el Proceso creado dentro de la transacción se revirtió
    expect(getSolicitudes()).toHaveLength(0);
  });
});

describe('Caso D — creación manual con responsable resuelto por el backend', () => {
  let db: PrismaDb;
  let getProcesos: () => ProcesoIdentidad[];
  let getSolicitudes: () => Array<Record<string, unknown>>;

  beforeEach(() => {
    ({ db, getProcesos, getSolicitudes } = crearFakeDb([FORTUL]));
  });

  it('crea el Proceso correcto (nuevo), vincula Solicitud.procesoId y asigna el responsable de la regla', async () => {
    const solicitud = await crearSolicitudConIdentidad(db, {
      codigoProceso: 'No. 001-2026',
      entidad: 'El Grupo Honor & Laurel',
      aliasFuente: 'NC',
      perfil: 'Aseocolba',
    }) as unknown as { id: number; procesoId: number; estadoSolicitud: string; asignaciones: Array<{ analistaAsignado: string }> };

    const procesos = getProcesos();
    expect(procesos).toHaveLength(2); // Fortul (seed) + Honor & Laurel (nuevo)
    const nuevoProceso = procesos.find((p) => p.id !== FORTUL.id)!;
    expect(nuevoProceso.entidad).toBe('El Grupo Honor & Laurel');
    expect(nuevoProceso.sourceKey.startsWith('manual:')).toBe(true); // solo se creó uno nuevo
    expect(nuevoProceso.externalId).toBeNull();

    expect(solicitud.procesoId).toBe(nuevoProceso.id);
    expect(solicitud.procesoId).not.toBe(FORTUL.id); // no se relaciona con Fortul
    expect(solicitud.estadoSolicitud).toBe('Asignado para revisión');
    expect(solicitud.asignaciones).toHaveLength(1);
    expect(solicitud.asignaciones[0].analistaAsignado).toBe('juan.davila');
  });

  it('idempotencia: repetir la creación para el MISMO proceso ya resuelto reutiliza la Solicitud existente, no duplica', async () => {
    const primera = await crearSolicitudConIdentidad(db, {
      codigoProceso: 'No. 001-2026', entidad: 'El Grupo Honor & Laurel', aliasFuente: 'NC', perfil: 'Aseocolba',
    }) as unknown as { id: number; procesoId: number };
    const segunda = await crearSolicitudConIdentidad(db, {
      codigoProceso: '001-2026', entidad: 'el grupo honor & laurel', aliasFuente: 'NC', perfil: 'Aseocolba',
    }) as unknown as { id: number; procesoId: number };

    const procesos = getProcesos();
    expect(procesos).toHaveLength(2); // Fortul + UN solo Honor & Laurel (no se duplicó el Proceso)
    expect(getSolicitudes()).toHaveLength(1); // UNA sola Solicitud — la segunda llamada reutilizó la primera
    expect(segunda.id).toBe(primera.id);
    expect(segunda.procesoId).toBe(primera.procesoId);
  });
});

describe('Caso E — sin responsable configurado o elegible: rechazo atómico', () => {
  it('perfil sin regla configurada: no crea Solicitud ni deja el Proceso manual huérfano', async () => {
    const { db, getProcesos, getSolicitudes } = crearFakeDb([]);

    await expect(crearSolicitudConIdentidad(db, {
      codigoProceso: 'No. 003-2026',
      entidad: 'Empresa Sin Perfil Conocido',
      aliasFuente: 'NC',
      perfil: 'OtraEmpresaDesconocida',
    })).rejects.toThrow(/No hay responsable configurado/);

    expect(getProcesos()).toHaveLength(0);
    expect(getSolicitudes()).toHaveLength(0);
  });

  it('usuario configurado pero INACTIVO: no crea Solicitud', async () => {
    const usuariosInactivos: UsuarioFake[] = [
      { id: 7, usuario: 'juan.davila', estado: 'Inactivo', cargo: 'Analista Comercial', rol: 'Analista Comercial', proceso: 'Comercial', entidadGrupo: 'Aseocolba' },
    ];
    const { db, getProcesos, getSolicitudes } = crearFakeDb([], usuariosInactivos);

    await expect(crearSolicitudConIdentidad(db, {
      codigoProceso: 'No. 004-2026',
      entidad: 'Empresa Aseo Test',
      aliasFuente: 'NC',
      perfil: 'Aseocolba',
    })).rejects.toThrow(/no está activo/);

    expect(getProcesos()).toHaveLength(0);
    expect(getSolicitudes()).toHaveLength(0);
  });

  it('usuario configurado pero INEXISTENTE en la BD: no crea Solicitud', async () => {
    const { db, getProcesos, getSolicitudes } = crearFakeDb([], []); // sin usuarios

    await expect(crearSolicitudConIdentidad(db, {
      codigoProceso: 'No. 005-2026',
      entidad: 'Empresa Vigi Test',
      aliasFuente: 'NC',
      perfil: 'Vigicolba',
    })).rejects.toThrow(/no existe/);

    expect(getProcesos()).toHaveLength(0);
    expect(getSolicitudes()).toHaveLength(0);
  });
});

describe('Caso F — Transcolba asigna correctamente (bug de la copia D del frontend, ya corregido en la regla única)', () => {
  it('crea la Solicitud con juan.davila para perfil Transcolba', async () => {
    const { db, getSolicitudes } = crearFakeDb([]);
    const solicitud = await crearSolicitudConIdentidad(db, {
      codigoProceso: 'No. 006-2026', entidad: 'Empresa Transcolba Test', aliasFuente: 'NC', perfil: 'Transcolba',
    }) as unknown as { asignaciones: Array<{ analistaAsignado: string }> };
    expect(solicitud.asignaciones[0].analistaAsignado).toBe('juan.davila');
    expect(getSolicitudes()).toHaveLength(1);
  });
});

describe('Caso G — auditoría de creación', () => {
  it('registra un AuditLog con procesoId, estado anterior/nuevo y responsable nuevo', async () => {
    const { db, getAuditLogs } = crearFakeDb([]);
    const solicitud = await crearSolicitudConIdentidad(db, {
      codigoProceso: 'No. 007-2026', entidad: 'Empresa Auditoria Test', aliasFuente: 'NC', perfil: 'Aseocolba',
      emailRegistro: 'andrea.calderin@grupocolba.com',
    }) as unknown as { id: number; procesoId: number };

    const logs = getAuditLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0].accion).toBe('solicitud_create');
    expect(logs[0].recursoId).toBe(String(solicitud.id));
    const detalle = logs[0].detalle as Record<string, unknown>;
    expect(detalle.procesoId).toBe(solicitud.procesoId);
    expect(detalle.estadoAnterior).toBeNull();
    expect(detalle.estadoNuevo).toBe('Asignado para revisión');
    expect(detalle.responsablesNuevos).toEqual(['juan.davila']);
    // Nunca se guardan credenciales/tokens en el detalle.
    expect(JSON.stringify(logs[0])).not.toMatch(/password|token|secret/i);
  });
});

describe('Caso H — Solicitud eliminada no bloquea una futura gestión legítima del mismo proceso (cierre IP 026 2026)', () => {
  it('tras eliminar (delete) la Solicitud de un Proceso, una nueva creación para ese mismo Proceso NO la restaura ni la reutiliza — crea una nueva, con su propia asignación', async () => {
    const { db, getSolicitudes } = crearFakeDb([]);

    const primera = await crearSolicitudConIdentidad(db, {
      codigoProceso: 'IP 026 2026', entidad: 'Rama Judicial – Dirección Seccional de Administración Judicial de Cúcuta',
      externalId: '11833728', aliasFuente: 'S2', fuente: 'secop II', perfil: 'Aseocolba',
    }) as unknown as { id: number; procesoId: number };
    expect(getSolicitudes()).toHaveLength(1);

    // Simula el mecanismo oficial de eliminación lógica: la Solicitud
    // desaparece de la tabla `Solicitud` (se movería a DeletedSolicitud,
    // fuera del alcance de este fake).
    await (db as unknown as { solicitud: { delete: (args: { where: { id: number } }) => Promise<void> } }).solicitud.delete({ where: { id: primera.id } });
    expect(getSolicitudes()).toHaveLength(0);

    const segunda = await crearSolicitudConIdentidad(db, {
      codigoProceso: 'IP 026 2026', entidad: 'Rama Judicial – Dirección Seccional de Administración Judicial de Cúcuta',
      externalId: '11833728', aliasFuente: 'S2', fuente: 'secop II', perfil: 'Aseocolba',
    }) as unknown as { id: number; procesoId: number; estadoSolicitud: string; asignaciones: Array<{ analistaAsignado: string }> };

    expect(getSolicitudes()).toHaveLength(1); // una nueva, no la restauración de la anterior
    expect(segunda.id).not.toBe(primera.id);
    expect(segunda.procesoId).toBe(primera.procesoId); // mismo Proceso — nunca se duplica el Proceso
    expect(segunda.estadoSolicitud).toBe('Asignado para revisión');
    expect(segunda.asignaciones[0].analistaAsignado).toBe('juan.davila');
  });
});

describe('Ajuste "BACKFILL PREVENTIVO SOLICITUD → PROCESO"', () => {
  const SECOP_II_NOTICE_A = 'https://www.secop.gov.co/CO1BusinessLine/Tendering/ContractNoticeView/Index?notice=CO1.NTC.10655536';
  const SECOP_II_NOTICE_A_CON_NAVEGACION = 'https://www.secop.gov.co/CO1BusinessLine/Tendering/ContractNoticeView/Index?prevCtxLbl=Buscar+procesos&prevCtxUrl=https%3a%2f%2fwww.secop.gov.co%3a443%2fCO1BusinessLine%2fTendering%2fContractNoticeManagement%2fIndex&notice=CO1.NTC.10655536';
  const SECOP_II_NOTICE_B = 'https://www.secop.gov.co/CO1BusinessLine/Tendering/ContractNoticeView/Index?notice=CO1.NTC.99999999';
  const PORTAL_PRIVADO = 'https://convocatorias.cruzrojacolombiana.org:9443/form_dbo_Convocatorias_proveedores/';

  it('1) Proceso nuevo (manual) + Solicitud con link → copia el link al Proceso', async () => {
    const { db, getProcesos, getAuditLogs } = crearFakeDb([]);
    const sol = await crearSolicitudConIdentidad(db, {
      codigoProceso: 'No. 010-2026', entidad: 'Empresa Backfill Uno', aliasFuente: 'S2', perfil: 'Aseocolba',
      linkDetalle: SECOP_II_NOTICE_A,
    }) as unknown as { procesoId: number };

    const proceso = getProcesos().find((p) => p.id === sol.procesoId)!;
    expect(proceso.linkDetalle).toBe(SECOP_II_NOTICE_A);
    expect(getAuditLogs().some((l) => l.accion === 'backfill_link_manual_desde_solicitud')).toBe(true);
  });

  it('2) Proceso nuevo + Solicitud SIN link → Proceso permanece sin link, sin AuditLog de backfill', async () => {
    const { db, getProcesos, getAuditLogs } = crearFakeDb([]);
    const sol = await crearSolicitudConIdentidad(db, {
      codigoProceso: 'No. 011-2026', entidad: 'Empresa Backfill Dos', aliasFuente: 'NC', perfil: 'Aseocolba',
    }) as unknown as { procesoId: number };

    const proceso = getProcesos().find((p) => p.id === sol.procesoId)!;
    expect(proceso.linkDetalle ?? null).toBeFalsy();
    expect(getAuditLogs().some((l) => l.accion === 'backfill_link_manual_desde_solicitud')).toBe(false);
  });

  it('3) Proceso EXISTENTE sin link + Solicitud nueva con link → copia (ext:, sin filtrar por prefijo)', async () => {
    const seed: ProcesoSeed = {
      id: 9001, externalId: '99999001', sourceKey: 'ext:99999001',
      codigoProceso: 'LP 099-2026', entidad: 'Entidad Backfill Ext', linkDetalle: null,
    };
    const { db, getProcesos } = crearFakeDb([seed]);
    await crearSolicitudConIdentidad(db, {
      externalId: '99999001', codigoProceso: 'LP 099-2026', entidad: 'Entidad Backfill Ext',
      aliasFuente: 'S2', perfil: 'Aseocolba', linkDetalle: SECOP_II_NOTICE_A,
    });
    const proceso = getProcesos().find((p) => p.id === 9001)!;
    expect(proceso.linkDetalle).toBe(SECOP_II_NOTICE_A);
  });

  it('4) Proceso EXISTENTE con el MISMO link → no-op, sin escritura adicional ni AuditLog', async () => {
    const seed: ProcesoSeed = {
      id: 9002, externalId: '99999002', sourceKey: 'ext:99999002',
      codigoProceso: 'LP 098-2026', entidad: 'Entidad Backfill Mismo Link', linkDetalle: SECOP_II_NOTICE_A,
    };
    const { db, getProcesos, getAuditLogs } = crearFakeDb([seed]);
    await crearSolicitudConIdentidad(db, {
      externalId: '99999002', codigoProceso: 'LP 098-2026', entidad: 'Entidad Backfill Mismo Link',
      aliasFuente: 'S2', perfil: 'Aseocolba', linkDetalle: SECOP_II_NOTICE_A,
    });
    const proceso = getProcesos().find((p) => p.id === 9002)!;
    expect(proceso.linkDetalle).toBe(SECOP_II_NOTICE_A); // sin cambios
    expect(getAuditLogs().some((l) => l.accion === 'backfill_link_manual_desde_solicitud')).toBe(false);
  });

  it('5) Proceso EXISTENTE con link DIFERENTE (no compatible) → CONFLICTO, nunca sobrescribe, sí audita', async () => {
    const seed: ProcesoSeed = {
      id: 9003, externalId: '99999003', sourceKey: 'ext:99999003',
      codigoProceso: 'LP 097-2026', entidad: 'Entidad Backfill Conflicto', linkDetalle: SECOP_II_NOTICE_A,
    };
    const { db, getProcesos, getAuditLogs } = crearFakeDb([seed]);
    await crearSolicitudConIdentidad(db, {
      externalId: '99999003', codigoProceso: 'LP 097-2026', entidad: 'Entidad Backfill Conflicto',
      aliasFuente: 'S2', perfil: 'Aseocolba', linkDetalle: PORTAL_PRIVADO,
    });
    const proceso = getProcesos().find((p) => p.id === 9003)!;
    expect(proceso.linkDetalle).toBe(SECOP_II_NOTICE_A); // NUNCA se sobrescribió
    const logBackfill = getAuditLogs().find((l) => l.accion === 'backfill_link_manual_desde_solicitud');
    expect(logBackfill).toBeDefined();
    expect((logBackfill!.detalle as Record<string, unknown>).resultado).toBe('CONFLICTO_NO_MODIFICADO');
  });

  it('6) Solicitud con URL inválida/basura → no copia, Proceso permanece sin link', async () => {
    const { db, getProcesos } = crearFakeDb([]);
    const sol = await crearSolicitudConIdentidad(db, {
      codigoProceso: 'No. 012-2026', entidad: 'Empresa Backfill URL Basura', aliasFuente: 'NC', perfil: 'Aseocolba',
      linkDetalle: 'no-es-una-url',
    }) as unknown as { procesoId: number };
    const proceso = getProcesos().find((p) => p.id === sol.procesoId)!;
    expect(proceso.linkDetalle ?? null).toBeFalsy();
  });

  it('7) sourceKey manual:* — sí es candidato de backfill (caso base: creación 100% manual)', async () => {
    const { db, getProcesos } = crearFakeDb([]);
    const sol = await crearSolicitudConIdentidad(db, {
      codigoProceso: 'No. 013-2026', entidad: 'Empresa Backfill Manual', aliasFuente: 'NC', perfil: 'Aseocolba',
      linkDetalle: PORTAL_PRIVADO,
    }) as unknown as { procesoId: number };
    const proceso = getProcesos().find((p) => p.id === sol.procesoId)!;
    expect(proceso.sourceKey.startsWith('manual:')).toBe(true);
    expect(proceso.linkDetalle).toBe(PORTAL_PRIVADO);
  });

  it('8) sourceKey ext:* — también es candidato de backfill (NO se filtra por prefijo)', async () => {
    const seed: ProcesoSeed = {
      id: 9004, externalId: '99999004', sourceKey: 'ext:99999004',
      codigoProceso: 'LP 096-2026', entidad: 'Entidad Backfill Ext Explicito', linkDetalle: null,
    };
    const { db, getProcesos } = crearFakeDb([seed]);
    await crearSolicitudConIdentidad(db, {
      externalId: '99999004', codigoProceso: 'LP 096-2026', entidad: 'Entidad Backfill Ext Explicito',
      aliasFuente: 'S2', perfil: 'Aseocolba', linkDetalle: SECOP_II_NOTICE_A,
    });
    const proceso = getProcesos().find((p) => p.id === 9004)!;
    expect(proceso.sourceKey.startsWith('ext:')).toBe(true);
    expect(proceso.linkDetalle).toBe(SECOP_II_NOTICE_A);
  });

  it('9) SECOP II con el MISMO notice pero URL con navegación distinta → NO es conflicto, no sobrescribe (ya "coincide")', async () => {
    const seed: ProcesoSeed = {
      id: 9005, externalId: '99999005', sourceKey: 'ext:99999005',
      codigoProceso: 'LP 095-2026', entidad: 'Entidad Backfill Mismo Notice', linkDetalle: SECOP_II_NOTICE_A,
    };
    const { db, getProcesos, getAuditLogs } = crearFakeDb([seed]);
    await crearSolicitudConIdentidad(db, {
      externalId: '99999005', codigoProceso: 'LP 095-2026', entidad: 'Entidad Backfill Mismo Notice',
      aliasFuente: 'S2', perfil: 'Aseocolba', linkDetalle: SECOP_II_NOTICE_A_CON_NAVEGACION,
    });
    const proceso = getProcesos().find((p) => p.id === 9005)!;
    expect(proceso.linkDetalle).toBe(SECOP_II_NOTICE_A); // se conserva el original, no se reemplaza por el de navegación
    const logBackfill = getAuditLogs().find((l) => l.accion === 'backfill_link_manual_desde_solicitud');
    expect(logBackfill).toBeUndefined(); // NO_HACER nunca audita
  });

  it('10) SECOP II con notices DIFERENTES → CONFLICTO', async () => {
    const seed: ProcesoSeed = {
      id: 9006, externalId: '99999006', sourceKey: 'ext:99999006',
      codigoProceso: 'LP 094-2026', entidad: 'Entidad Backfill Notice Distinto', linkDetalle: SECOP_II_NOTICE_A,
    };
    const { db, getProcesos, getAuditLogs } = crearFakeDb([seed]);
    await crearSolicitudConIdentidad(db, {
      externalId: '99999006', codigoProceso: 'LP 094-2026', entidad: 'Entidad Backfill Notice Distinto',
      aliasFuente: 'S2', perfil: 'Aseocolba', linkDetalle: SECOP_II_NOTICE_B,
    });
    const proceso = getProcesos().find((p) => p.id === 9006)!;
    expect(proceso.linkDetalle).toBe(SECOP_II_NOTICE_A);
    const logBackfill = getAuditLogs().find((l) => l.accion === 'backfill_link_manual_desde_solicitud');
    expect((logBackfill!.detalle as Record<string, unknown>).resultado).toBe('CONFLICTO_NO_MODIFICADO');
  });

  it('11) Ejecución repetida sobre la misma identidad → idempotente, no vuelve a escribir ni a duplicar AuditLog de backfill', async () => {
    const { db, getProcesos, getAuditLogs, getSolicitudes } = crearFakeDb([]);
    await crearSolicitudConIdentidad(db, {
      codigoProceso: 'No. 014-2026', entidad: 'Empresa Backfill Repetida', aliasFuente: 'S2', perfil: 'Aseocolba',
      linkDetalle: SECOP_II_NOTICE_A,
    });
    // Segunda llamada para la MISMA identidad — cae en la rama "solicitudExistente" (idempotencia ya existente).
    await crearSolicitudConIdentidad(db, {
      codigoProceso: 'No. 014-2026', entidad: 'Empresa Backfill Repetida', aliasFuente: 'S2', perfil: 'Aseocolba',
      linkDetalle: SECOP_II_NOTICE_A,
    });

    expect(getSolicitudes()).toHaveLength(1); // idempotencia de Solicitud intacta
    const proceso = getProcesos().find((p) => p.entidad === 'Empresa Backfill Repetida')!;
    expect(proceso.linkDetalle).toBe(SECOP_II_NOTICE_A);
    const logsBackfill = getAuditLogs().filter((l) => l.accion === 'backfill_link_manual_desde_solicitud');
    expect(logsBackfill).toHaveLength(1); // solo la primera vez escribió — la segunda es NO_HACER (ya coincide), sin auditar de nuevo
  });

  it('12) updateMany con count=0 (otra transacción ya escribió primero) → no sobrescribe el link ganador', async () => {
    // Simula la carrera: el Proceso YA tiene un link distinto en el momento
    // exacto del updateMany, aunque la lectura previa lo haya visto vacío
    // (se fuerza editando el seed directamente antes de invocar la función).
    const seed: ProcesoSeed = {
      id: 9007, externalId: '99999007', sourceKey: 'ext:99999007',
      codigoProceso: 'LP 093-2026', entidad: 'Entidad Backfill Carrera', linkDetalle: null,
    };
    const { db, getProcesos } = crearFakeDb([seed]);
    // Al no poder inyectar una carrera real dentro de una única llamada del
    // fake in-memory, se verifica el mismo invariante con la ruta pública:
    // updateMany del fake SOLO escribe si el WHERE (linkDetalle vacío) se
    // cumple en el momento de la escritura, nunca por una lectura previa.
    const proceso = getProcesos().find((p) => p.id === 9007)!;
    proceso.linkDetalle = 'https://ganador-de-la-carrera.example.com/x'; // otra "transacción" ya escribió
    await crearSolicitudConIdentidad(db, {
      externalId: '99999007', codigoProceso: 'LP 093-2026', entidad: 'Entidad Backfill Carrera',
      aliasFuente: 'NC', perfil: 'Aseocolba', linkDetalle: PORTAL_PRIVADO,
    });
    expect(getProcesos().find((p) => p.id === 9007)!.linkDetalle).toBe('https://ganador-de-la-carrera.example.com/x');
  });

  it('13) AuditLog de backfill nunca se duplica en un no-op idempotente (Solicitud sin link)', async () => {
    const { db, getAuditLogs } = crearFakeDb([]);
    await crearSolicitudConIdentidad(db, {
      codigoProceso: 'No. 015-2026', entidad: 'Empresa Backfill Sin Log', aliasFuente: 'NC', perfil: 'Aseocolba',
    });
    expect(getAuditLogs().filter((l) => l.accion === 'backfill_link_manual_desde_solicitud')).toHaveLength(0);
  });

  it('14) Proceso y Solicitud siguen creándose dentro de la MISMA transacción (rollback revierte también el backfill)', async () => {
    const { db, getProcesos, getSolicitudes } = crearFakeDb([]);
    await expect(crearSolicitudConIdentidad(db, {
      codigoProceso: 'No. 016-2026', entidad: 'Empresa Backfill Rollback', aliasFuente: 'NC', perfil: 'Aseocolba',
      linkDetalle: SECOP_II_NOTICE_A,
      observacion: '__FORZAR_ERROR_TEST__',
    })).rejects.toThrow(/Fallo simulado/);

    expect(getProcesos()).toHaveLength(0); // el Proceso (con o sin backfill) no queda huérfano
    expect(getSolicitudes()).toHaveLength(0);
  });
});

describe('crearSolicitudConIdentidad — rechazo por datos insuficientes', () => {
  it('sin codigoProceso lanza SolicitudIdentidadError', async () => {
    const { db } = crearFakeDb([]);
    await expect(crearSolicitudConIdentidad(db, { codigoProceso: '' }))
      .rejects.toThrow(SolicitudIdentidadError);
  });

  it('con codigoProceso pero sin entidad y sin procesoId/externalId, rechaza', async () => {
    const { db } = crearFakeDb([]);
    await expect(crearSolicitudConIdentidad(db, { codigoProceso: '001-2026' }))
      .rejects.toThrow(SolicitudIdentidadError);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Ajuste "PARIDAD DATA API — FUENTE EN CREACIÓN" — caso real:
// CP-019-JNCI-2026 (externalId 12055133), Proceso creado vía Data API
// (aliasFuente=null, origenFuncional=PUBLICO_ABIERTO), creado como "NC"
// (privado) por `handleGestionar` en page.tsx, que envía `proceso.aliasFuente`
// crudo sin pasar por `construirFichaDesdeProceso`. Estos tests fijan el
// comportamiento defensivo de `crearSolicitudConIdentidad`: NUNCA depende
// únicamente de que el caller venga bien normalizado.
// ─────────────────────────────────────────────────────────────────────────
describe('crearSolicitudConIdentidad — paridad Data API (aliasFuente ausente se deriva de origenFuncional)', () => {
  it('aliasFuente=null + origenFuncional=PUBLICO_REGISTRADO → Solicitud y Proceso quedan S2 (nunca NC)', async () => {
    const { db, getProcesos } = crearFakeDb([]);
    const solicitud = await crearSolicitudConIdentidad(db, {
      codigoProceso: 'CP-019-JNCI-2026',
      entidad: 'JUNTA NACIONAL DE CALIFICACION DE INVALIDEZ',
      externalId: '12055133',
      aliasFuente: null,
      origenFuncional: 'PUBLICO_REGISTRADO',
      perfil: 'Aseocolba',
    }) as unknown as { aliasFuente: string };

    expect(solicitud.aliasFuente).toBe('S2');
    const nuevoProceso = getProcesos()[0] as unknown as { aliasFuente: string; sourceKey: string };
    expect(nuevoProceso.aliasFuente).toBe('S2');
    expect(nuevoProceso.sourceKey).toBe('ext:12055133'); // identidad externa, nunca "mix:...NC..."
  });

  it('aliasFuente=null + origenFuncional=PUBLICO_ABIERTO → S1', async () => {
    const { db } = crearFakeDb([]);
    const solicitud = await crearSolicitudConIdentidad(db, {
      codigoProceso: 'CP-020-2026', entidad: 'Entidad Abierta Test', externalId: '12000001',
      aliasFuente: null, origenFuncional: 'PUBLICO_ABIERTO', perfil: 'Aseocolba',
    }) as unknown as { aliasFuente: string };
    expect(solicitud.aliasFuente).toBe('S1');
  });

  it('aliasFuente=null + origenFuncional=PRIVADO → sigue NC (comportamiento correcto, sin cambios)', async () => {
    const { db } = crearFakeDb([]);
    const solicitud = await crearSolicitudConIdentidad(db, {
      codigoProceso: 'No. 020-2026', entidad: 'Empresa Privada Data API Test', externalId: '12000002',
      aliasFuente: null, origenFuncional: 'PRIVADO', perfil: 'Aseocolba',
    }) as unknown as { aliasFuente: string };
    expect(solicitud.aliasFuente).toBe('NC');
  });

  it('aliasFuente=null SIN origenFuncional (caller legacy, sin la señal nueva) → conserva el comportamiento previo (NC)', async () => {
    const { db } = crearFakeDb([]);
    const solicitud = await crearSolicitudConIdentidad(db, {
      codigoProceso: 'No. 021-2026', entidad: 'Empresa Sin Origen Funcional', perfil: 'Aseocolba',
    }) as unknown as { aliasFuente: string };
    expect(solicitud.aliasFuente).toBe('NC');
  });

  it('aliasFuente YA presente (fila legacy) SIEMPRE gana sobre origenFuncional, aunque contradiga', async () => {
    const { db } = crearFakeDb([]);
    const solicitud = await crearSolicitudConIdentidad(db, {
      codigoProceso: 'No. 022-2026', entidad: 'Empresa Alias Explicito', externalId: '12000003',
      aliasFuente: 'NC', origenFuncional: 'PUBLICO_ABIERTO', perfil: 'Aseocolba',
    }) as unknown as { aliasFuente: string };
    expect(solicitud.aliasFuente).toBe('NC');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Ajuste "BACKFILL codigoProceso" — caso real: Proceso.id=11473 (Cámara de
// Comercio de Cartagena), privado sincronizado vía Data API con
// `estadoFuente='No aplica'` y `codigoProceso` NULL porque la fuente no trae
// código formal. Al gestionarlo, la fuente ya reporta "Proceso No. 10116" y
// el chequeo de identidad lo rechazaba como si fuera un código contradictorio.
// ─────────────────────────────────────────────────────────────────────────
describe('Ajuste "BACKFILL codigoProceso" — Proceso sin código formal en la fuente', () => {
  const CAMARA_CARTAGENA: ProcesoSeed = {
    id: 11473, externalId: null, sourceKey: '33c723ac-8e0b-4716-9fb7-d3e16a66e902',
    codigoProceso: null, entidad: 'CÁMARA DE COMERCIO DE CARTAGENA',
  };

  it('resuelto por procesoId con código NULL → completa el código, crea la Solicitud y audita', async () => {
    const { db, getProcesos, getSolicitudes, getAuditLogs } = crearFakeDb([{ ...CAMARA_CARTAGENA }]);

    await crearSolicitudConIdentidad(db, {
      procesoId: 11473, entidad: 'CÁMARA DE COMERCIO DE CARTAGENA',
      codigoProceso: 'Proceso No. 10116', aliasFuente: 'NC', perfil: 'Aseocolba',
    });

    expect(getSolicitudes()).toHaveLength(1);
    expect(getSolicitudes()[0].procesoId).toBe(11473);
    expect(getProcesos().find((p) => p.id === 11473)!.codigoProceso).toBe('Proceso No. 10116');
    const logs = getAuditLogs().filter((l) => l.accion === 'backfill_codigo_proceso_desde_solicitud');
    expect(logs).toHaveLength(1);
    expect(logs[0].recursoId).toBe('11473');
  });

  it('resuelto por externalId con código vacío ("") → mismo backfill', async () => {
    const seed: ProcesoSeed = { ...CAMARA_CARTAGENA, codigoProceso: '', externalId: 'uuid-ext-1', sourceKey: 'ext:uuid-ext-1' };
    const { db, getProcesos, getSolicitudes } = crearFakeDb([seed]);

    await crearSolicitudConIdentidad(db, {
      externalId: 'uuid-ext-1', entidad: 'CÁMARA DE COMERCIO DE CARTAGENA',
      codigoProceso: 'Proceso No. 10116', aliasFuente: 'NC', perfil: 'Aseocolba',
    });

    expect(getSolicitudes()).toHaveLength(1);
    expect(getProcesos()[0].codigoProceso).toBe('Proceso No. 10116');
  });

  it('código YA real y distinto → sigue siendo conflicto: rechaza, no crea Solicitud, no pisa el código', async () => {
    const seed: ProcesoSeed = { ...CAMARA_CARTAGENA, codigoProceso: 'Proceso No. 99999' };
    const { db, getProcesos, getSolicitudes, getAuditLogs } = crearFakeDb([seed]);

    await expect(crearSolicitudConIdentidad(db, {
      procesoId: 11473, entidad: 'CÁMARA DE COMERCIO DE CARTAGENA',
      codigoProceso: 'Proceso No. 10116', aliasFuente: 'NC', perfil: 'Aseocolba',
    })).rejects.toThrow(SolicitudIdentidadError);

    expect(getSolicitudes()).toHaveLength(0);
    expect(getProcesos()[0].codigoProceso).toBe('Proceso No. 99999');
    expect(getAuditLogs().filter((l) => l.accion === 'backfill_codigo_proceso_desde_solicitud')).toHaveLength(0);
  });

  it('carrera: otra transacción escribe el código entre la lectura y el updateMany → no lo sobrescribe', async () => {
    const { db, getProcesos, getAuditLogs } = crearFakeDb([{ ...CAMARA_CARTAGENA }]);
    // A diferencia del link (que se relee dentro del backfill), aquí la
    // decisión usa el Proceso ya resuelto — la carrera se inyecta justo
    // antes de la escritura, no editando el seed antes de la llamada.
    const fake = db as unknown as { proceso: { updateMany: (args: unknown) => Promise<{ count: number }> } };
    const original = fake.proceso.updateMany;
    fake.proceso.updateMany = async (args) => {
      getProcesos().find((p) => p.id === 11473)!.codigoProceso = 'Proceso No. GANADOR';
      return original(args);
    };

    await crearSolicitudConIdentidad(db, {
      procesoId: 11473, entidad: 'CÁMARA DE COMERCIO DE CARTAGENA',
      codigoProceso: 'Proceso No. 10116', aliasFuente: 'NC', perfil: 'Aseocolba',
    });

    expect(getProcesos().find((p) => p.id === 11473)!.codigoProceso).toBe('Proceso No. GANADOR');
    expect(getAuditLogs().filter((l) => l.accion === 'backfill_codigo_proceso_desde_solicitud')).toHaveLength(0);
  });

  it('placeholder sintético "PROCESO-<id>" (código Y nombre NULL en la fuente) → NUNCA se persiste, ni backfill ni conflicto', async () => {
    // `/api/procesos` inventa este valor en lectura cuando ni codigoProceso
    // ni nombre existen (`codigoProceso || nombre || 'PROCESO-<id>'`) — el
    // frontend lo reenvía tal cual al gestionar. No es un dato real de
    // ninguna fuente: escribirlo en la BD contaminaría el Proceso con un
    // valor inventado que después se confundiría con un código genuino.
    const seed: ProcesoSeed = { ...CAMARA_CARTAGENA };
    const { db, getProcesos, getSolicitudes, getAuditLogs } = crearFakeDb([seed]);

    await crearSolicitudConIdentidad(db, {
      procesoId: 11473, entidad: 'CÁMARA DE COMERCIO DE CARTAGENA',
      codigoProceso: 'PROCESO-11473', aliasFuente: 'NC', perfil: 'Aseocolba',
    });

    expect(getSolicitudes()).toHaveLength(1); // sí crea la Solicitud, sin bloquear
    expect(getProcesos().find((p) => p.id === 11473)!.codigoProceso).toBeNull(); // nunca se escribe el placeholder
    expect(getAuditLogs().filter((l) => l.accion === 'backfill_codigo_proceso_desde_solicitud')).toHaveLength(0);
  });

  it('rollback: si la creación de la Solicitud falla, el backfill del código también se revierte', async () => {
    const { db, getProcesos, getSolicitudes } = crearFakeDb([{ ...CAMARA_CARTAGENA }]);

    await expect(crearSolicitudConIdentidad(db, {
      procesoId: 11473, entidad: 'CÁMARA DE COMERCIO DE CARTAGENA',
      codigoProceso: 'Proceso No. 10116', aliasFuente: 'NC', perfil: 'Aseocolba',
      observacion: '__FORZAR_ERROR_TEST__',
    })).rejects.toThrow(/Fallo simulado/);

    expect(getSolicitudes()).toHaveLength(0);
    expect(getProcesos().find((p) => p.id === 11473)!.codigoProceso).toBeNull();
  });
});