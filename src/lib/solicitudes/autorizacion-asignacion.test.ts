import { describe, it, expect, vi } from 'vitest';

// `autorizacion-asignacion.ts` importa `@/lib/authz`, que a su vez importa
// el singleton real de `@/lib/prisma` (falla al cargar sin DATABASE_URL).
// Nunca se usa el cliente real aquí — todas las funciones reciben su propio
// `PrismaDb` fake — así que se mockea para poder importar el módulo en test.
vi.mock('@/lib/prisma', () => ({ default: {} }));

import {
  resolverUsuarioSesionActivo, encontrarAsignacionPropia, esResponsableActivoDeSolicitud,
  puedeAgregarObservacion, puedeCerrarSolicitud, puedeRechazarSolicitud, puedeNoAceptarObservacion, puedeReasignarSolicitud,
  puedeRevisarProceso, puedeGestionarCualquierAsignacion, esAdministradorProcesos,
  type UsuarioActivo, type AsignacionSolicitud,
} from './autorizacion-asignacion';
import type { PrismaDb } from './crear-solicitud';
import type { SessionUser } from '@/lib/session';

interface UsuarioFakeRow { id: number; usuario: string; email: string; rol: string; estado: string; }

function crearFakeDb(usuarios: UsuarioFakeRow[]) {
  return {
    user: {
      async findUnique({ where }: { where: { id?: number; email?: string } }) {
        if (where.id != null) return usuarios.find((u) => u.id === where.id) ?? null;
        if (where.email != null) return usuarios.find((u) => u.email === where.email) ?? null;
        return null;
      },
    },
  } as unknown as PrismaDb;
}

const OSCAR: UsuarioFakeRow = { id: 101, usuario: 'oscar.pallares', email: 'oscar.pallares@grupocolba.com', rol: 'Analista Comercial', estado: 'Activo' };
const NICOLE: UsuarioFakeRow = { id: 102, usuario: 'nicole.ortiz', email: 'nicole.ortiz@grupocolba.com', rol: 'Analista Comercial', estado: 'Activo' };
const NICOLE_INACTIVA: UsuarioFakeRow = { id: 102, usuario: 'nicole.ortiz', email: 'nicole.ortiz@grupocolba.com', rol: 'Analista Comercial', estado: 'Inactivo' };
const DIRECTOR: UsuarioFakeRow = { id: 6, usuario: 'ricardo.mejia', email: 'ricardo.mejia@grupocolba.com', rol: 'Director Comercial', estado: 'Activo' };
const COORDINADOR: UsuarioFakeRow = { id: 5, usuario: 'laura.buelvas', email: 'laura.buelvas@grupocolba.com', rol: 'Coordinador Comercial', estado: 'Activo' };
const ADMIN: UsuarioFakeRow = { id: 1, usuario: 'admin1', email: 'admin1@grupocolba.com', rol: 'Administrador', estado: 'Activo' };

const filaOscar: AsignacionSolicitud = { idAsignacion: 'ASG-1', analistaAsignado: 'oscar.pallares' };
const filaNicole: AsignacionSolicitud = { idAsignacion: 'ASG-2', analistaAsignado: 'nicole.ortiz' };

function solicitud(asignaciones: AsignacionSolicitud[], estadoSolicitud = 'En evaluación', aliasFuente?: string | null) {
  return { estadoSolicitud, asignaciones, aliasFuente };
}

function usr(u: UsuarioFakeRow): UsuarioActivo {
  return { id: u.id, usuario: u.usuario, email: u.email, rol: u.rol, estado: u.estado };
}

describe('resolverUsuarioSesionActivo', () => {
  it('resuelve por id cuando session.id es válido', async () => {
    const db = crearFakeDb([OSCAR]);
    const session = { id: 101, email: 'irrelevante@x.com', rol: 'Analista Comercial', exp: 0, sv: 1, usuario: 'oscar.pallares' } as SessionUser;
    const r = await resolverUsuarioSesionActivo(db, session);
    expect(r?.usuario).toBe('oscar.pallares');
  });

  it('cae a email si el id no resuelve', async () => {
    const db = crearFakeDb([OSCAR]);
    const session = { id: 9999, email: 'oscar.pallares@grupocolba.com', rol: 'Analista Comercial', exp: 0, sv: 1 } as SessionUser;
    const r = await resolverUsuarioSesionActivo(db, session);
    expect(r?.usuario).toBe('oscar.pallares');
  });

  it('devuelve null si el usuario no existe', async () => {
    const db = crearFakeDb([]);
    const session = { id: 1, email: 'fantasma@x.com', rol: 'Analista Comercial', exp: 0, sv: 1 } as SessionUser;
    expect(await resolverUsuarioSesionActivo(db, session)).toBeNull();
  });

  it('devuelve null si el usuario existe pero está Inactivo', async () => {
    const db = crearFakeDb([NICOLE_INACTIVA]);
    const session = { id: 102, email: 'nicole.ortiz@grupocolba.com', rol: 'Analista Comercial', exp: 0, sv: 1 } as SessionUser;
    expect(await resolverUsuarioSesionActivo(db, session)).toBeNull();
  });
});

describe('encontrarAsignacionPropia / esResponsableActivoDeSolicitud', () => {
  it('el primer y el último responsable del arreglo son encontrados igual (el orden no importa)', () => {
    const sol = solicitud([filaOscar, filaNicole]);
    expect(encontrarAsignacionPropia(sol.asignaciones, usr(OSCAR))?.idAsignacion).toBe('ASG-1');
    expect(encontrarAsignacionPropia(sol.asignaciones, usr(NICOLE))?.idAsignacion).toBe('ASG-2');
  });

  it('cambiar el orden del arreglo no cambia el resultado', () => {
    const solInvertida = solicitud([filaNicole, filaOscar]);
    expect(encontrarAsignacionPropia(solInvertida.asignaciones, usr(OSCAR))?.idAsignacion).toBe('ASG-1');
    expect(esResponsableActivoDeSolicitud(usr(OSCAR), solInvertida)).toBe(true);
  });

  it('un responsable removido (ya no está en el arreglo) no se encuentra', () => {
    const sol = solicitud([filaNicole]); // oscar fue removido
    expect(encontrarAsignacionPropia(sol.asignaciones, usr(OSCAR))).toBeNull();
    expect(esResponsableActivoDeSolicitud(usr(OSCAR), sol)).toBe(false);
  });
});

describe('puedeAgregarObservacion — caso real Solicitud 217 (datos ficticios equivalentes)', () => {
  it('el primer responsable (oscar) puede observar su propia fila', () => {
    const sol = solicitud([filaOscar, filaNicole]);
    const r = puedeAgregarObservacion(usr(OSCAR), sol, 'ASG-1');
    expect(r.autorizado).toBe(true);
  });

  it('el segundo/último responsable (nicole) puede observar su propia fila igual que el primero', () => {
    const sol = solicitud([filaOscar, filaNicole]);
    const r = puedeAgregarObservacion(usr(NICOLE), sol, 'ASG-2');
    expect(r.autorizado).toBe(true);
  });

  it('oscar NO puede agregar una observación a la fila de nicole', () => {
    const sol = solicitud([filaOscar, filaNicole]);
    const r = puedeAgregarObservacion(usr(OSCAR), sol, 'ASG-2');
    expect(r.autorizado).toBe(false);
  });

  it('un usuario no asignado no puede observar ninguna fila', () => {
    const sol = solicitud([filaOscar, filaNicole]);
    const ajeno = usr({ id: 999, usuario: 'ajeno', email: 'ajeno@x.com', rol: 'Analista Comercial', estado: 'Activo' });
    expect(puedeAgregarObservacion(ajeno, sol, 'ASG-1').autorizado).toBe(false);
    expect(puedeAgregarObservacion(ajeno, sol, 'ASG-2').autorizado).toBe(false);
  });

  it('admin puede agregar observación a CUALQUIER fila (queda registrado como sí mismo — eso lo valida el endpoint, no esta función)', () => {
    const sol = solicitud([filaOscar, filaNicole]);
    const admin = usr({ id: 1, usuario: 'admin1', email: 'admin1@x.com', rol: 'admin', estado: 'Activo' });
    expect(puedeAgregarObservacion(admin, sol, 'ASG-1').autorizado).toBe(true);
    expect(puedeAgregarObservacion(admin, sol, 'ASG-2').autorizado).toBe(true);
  });

  it('idAsignacion inexistente se rechaza', () => {
    const sol = solicitud([filaOscar]);
    expect(puedeAgregarObservacion(usr(OSCAR), sol, 'ASG-NO-EXISTE').autorizado).toBe(false);
  });

  it('rechaza si la solicitud ya está en un estado terminal', () => {
    const sol = solicitud([filaOscar], 'Cerrada');
    expect(puedeAgregarObservacion(usr(OSCAR), sol, 'ASG-1').autorizado).toBe(false);
  });
});

describe('puedeCerrarSolicitud', () => {
  it('cualquiera de los dos responsables (primero o último) puede cerrar mientras esté abierta', () => {
    const sol = solicitud([filaOscar, filaNicole]);
    expect(puedeCerrarSolicitud(usr(OSCAR), sol).autorizado).toBe(true);
    expect(puedeCerrarSolicitud(usr(NICOLE), sol).autorizado).toBe(true);
  });

  it('un usuario no asignado no puede cerrar', () => {
    const sol = solicitud([filaOscar, filaNicole]);
    const ajeno = usr({ id: 999, usuario: 'ajeno', email: 'ajeno@x.com', rol: 'Analista Comercial', estado: 'Activo' });
    expect(puedeCerrarSolicitud(ajeno, sol).autorizado).toBe(false);
  });

  it('admin puede cerrar aunque no esté en asignaciones', () => {
    const sol = solicitud([filaOscar]);
    const admin = usr({ id: 1, usuario: 'admin1', email: 'admin1@x.com', rol: 'admin', estado: 'Activo' });
    expect(puedeCerrarSolicitud(admin, sol).autorizado).toBe(true);
  });

  // Ajuste "Director Comercial y Coordinador Comercial como administradores
  // funcionales de TODO el módulo Procesos" — reemplaza la regla anterior
  // ("coordinador NO cierra fila ajena, esa es facultad de reasignar
  // únicamente"): ambos roles ahora cierran CUALQUIER solicitud, estén o no
  // asignados como responsables, igual que un Administrador.
  it('coordinador SÍ cierra cualquier solicitud aunque no esté asignado (administrador funcional de Procesos)', () => {
    const sol = solicitud([filaOscar]);
    const coordinador = usr({ id: 5, usuario: 'laura.buelvas', email: 'laura.buelvas@grupocolba.com', rol: 'Coordinador Comercial', estado: 'Activo' });
    expect(puedeCerrarSolicitud(coordinador, sol).autorizado).toBe(true);
  });

  it('rechaza (motivo "ya fue cerrada") si la solicitud ya está en estado terminal', () => {
    const sol = solicitud([filaOscar], 'Cerrada');
    const r = puedeCerrarSolicitud(usr(OSCAR), sol);
    expect(r.autorizado).toBe(false);
    expect(r.motivo).toMatch(/ya fue cerrada/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Ajuste "Director Comercial y Coordinador Comercial como administradores
// funcionales de TODO el módulo Procesos"
// ═══════════════════════════════════════════════════════════════════════

describe('puedeAgregarObservacion — Director/Coordinador Comercial sobre fila ajena', () => {
  it('Director Comercial agrega observación en una asignación ajena: permitido', () => {
    const sol = solicitud([filaOscar, filaNicole]);
    expect(puedeAgregarObservacion(usr(DIRECTOR), sol, 'ASG-1').autorizado).toBe(true);
    expect(puedeAgregarObservacion(usr(DIRECTOR), sol, 'ASG-2').autorizado).toBe(true);
  });
  it('Coordinador Comercial agrega observación en una asignación ajena: permitido', () => {
    const sol = solicitud([filaOscar, filaNicole]);
    expect(puedeAgregarObservacion(usr(COORDINADOR), sol, 'ASG-1').autorizado).toBe(true);
    expect(puedeAgregarObservacion(usr(COORDINADOR), sol, 'ASG-2').autorizado).toBe(true);
  });
});

describe('puedeCerrarSolicitud — Director/Coordinador Comercial', () => {
  it('Director Comercial cierra cualquier solicitud aunque no esté asignado', () => {
    const sol = solicitud([filaOscar]);
    expect(puedeCerrarSolicitud(usr(DIRECTOR), sol).autorizado).toBe(true);
  });
  it('Coordinador Comercial cierra cualquier solicitud aunque no esté asignado', () => {
    const sol = solicitud([filaOscar]);
    expect(puedeCerrarSolicitud(usr(COORDINADOR), sol).autorizado).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Ajuste "PERMISOS DE CIERRE — PRIVADOS PARA MERCADEO" — desde esta ronda,
// el cierre de un proceso Privado deja de ser potestad de Comercial y pasa
// a Mercadeo (Analista Mercadeo / Asistente Mercadeo); Público conserva
// exactamente la regla previa, salvo que Mercadeo no obtiene permiso de
// cierre de un Público solo por figurar como responsable.
// ═══════════════════════════════════════════════════════════════════════
describe('puedeCerrarSolicitud — regla por aliasFuente (Público S1/S2 vs Privado)', () => {
  const MERCADEO_ANALISTA = usr({ id: 201, usuario: 'ana.rios', email: 'ana.rios@grupocolba.com', rol: 'Analista Mercadeo', estado: 'Activo' });
  const MERCADEO_ASISTENTE = usr({ id: 202, usuario: 'beto.paz', email: 'beto.paz@grupocolba.com', rol: 'Asistente Mercadeo', estado: 'Activo' });
  const ADMIN_GLOBAL = usr({ id: 1, usuario: 'admin1', email: 'admin1@grupocolba.com', rol: 'Administrador', estado: 'Activo' });
  // `Solicitud` no tiene columna `tipoProceso` — el dato real persistido es
  // `aliasFuente`, con el MISMO criterio que ya usa `GET /api/solicitudes`
  // (`aliasFuentePublico`/`aliasFuentePrivado`): 'S1'/'S2' = Público;
  // cualquier otro valor (aquí 'aseo', un alias de catálogo real de un
  // proceso Privado manual) = Privado.
  const PUBLICO = 'S1';
  const PRIVADO = 'aseo';

  it('Comercial (Analista) + Público → true (sin cambios)', () => {
    const sol = solicitud([filaOscar], 'En evaluación', PUBLICO);
    expect(puedeCerrarSolicitud(usr(OSCAR), sol).autorizado).toBe(true);
  });

  it('Comercial (Analista) + Privado, SIN ser responsable → false', () => {
    const sol = solicitud([], 'En evaluación', PRIVADO);
    expect(puedeCerrarSolicitud(usr(OSCAR), sol).autorizado).toBe(false);
  });

  it('Comercial (Analista) + Privado, SIENDO responsable asignado → false (bloqueo total, sin excepción por asignación)', () => {
    const sol = solicitud([filaOscar], 'En evaluación', PRIVADO);
    expect(puedeCerrarSolicitud(usr(OSCAR), sol).autorizado).toBe(false);
  });

  it('Director/Coordinador Comercial (administrador funcional) + Privado → false — pierden el privilegio de cierre solo para Privados', () => {
    const sol = solicitud([], 'En evaluación', PRIVADO);
    expect(puedeCerrarSolicitud(usr(DIRECTOR), sol).autorizado).toBe(false);
    expect(puedeCerrarSolicitud(usr(COORDINADOR), sol).autorizado).toBe(false);
  });

  it('Mercadeo (Analista o Asistente) + Privado → true, aunque no esté asignado como responsable', () => {
    const sol = solicitud([], 'En evaluación', PRIVADO);
    expect(puedeCerrarSolicitud(MERCADEO_ANALISTA, sol).autorizado).toBe(true);
    expect(puedeCerrarSolicitud(MERCADEO_ASISTENTE, sol).autorizado).toBe(true);
  });

  it('Mercadeo + Público, SIN ser administrador funcional ni responsable → false', () => {
    const sol = solicitud([], 'En evaluación', PUBLICO);
    expect(puedeCerrarSolicitud(MERCADEO_ANALISTA, sol).autorizado).toBe(false);
  });

  it('Mercadeo + Público, SIENDO responsable asignado → false (no obtiene permiso de cierre de un Público solo por ser responsable)', () => {
    const filaMercadeo: AsignacionSolicitud = { idAsignacion: 'ASG-M1', analistaAsignado: 'ana.rios' };
    const sol = solicitud([filaMercadeo], 'En evaluación', PUBLICO);
    expect(puedeCerrarSolicitud(MERCADEO_ANALISTA, sol).autorizado).toBe(false);
  });

  it('Administrador global + Público → true', () => {
    const sol = solicitud([], 'En evaluación', PUBLICO);
    expect(puedeCerrarSolicitud(ADMIN_GLOBAL, sol).autorizado).toBe(true);
  });

  it('Administrador global + Privado → true (conserva el permiso que ya tenía)', () => {
    const sol = solicitud([], 'En evaluación', PRIVADO);
    expect(puedeCerrarSolicitud(ADMIN_GLOBAL, sol).autorizado).toBe(true);
  });

  it('aliasFuente ausente (undefined) o null → se comporta EXACTAMENTE como Público/legado (decisión explícita: nunca se asume Privado por ausencia de dato — a diferencia del criterio de conteo de dashboard/route.ts, que es solo de visualización, no de autorización)', () => {
    const solUndefined = solicitud([filaOscar]); // aliasFuente undefined
    const solNull = solicitud([filaOscar], 'En evaluación', null);
    expect(puedeCerrarSolicitud(usr(OSCAR), solUndefined).autorizado).toBe(true);
    expect(puedeCerrarSolicitud(usr(OSCAR), solNull).autorizado).toBe(true);
    // Y Mercadeo, en ese mismo legado, tampoco cierra solo por ser responsable (misma regla que Público).
    const filaMercadeo: AsignacionSolicitud = { idAsignacion: 'ASG-M2', analistaAsignado: 'ana.rios' };
    const solLegadoConMercadeoResponsable = solicitud([filaMercadeo]);
    expect(puedeCerrarSolicitud(MERCADEO_ANALISTA, solLegadoConMercadeoResponsable).autorizado).toBe(false);
  });

  it('rechaza por estado terminal ANTES de evaluar aliasFuente, para cualquier rol', () => {
    const sol = solicitud([], 'Cerrada', PRIVADO);
    expect(puedeCerrarSolicitud(MERCADEO_ANALISTA, sol).autorizado).toBe(false);
    expect(puedeCerrarSolicitud(ADMIN_GLOBAL, sol).autorizado).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Ajuste "RECHAZO PRIVADO — DIRECTOR/COORDINADOR COMERCIAL" — permiso
// específico de la acción RECHAZAR, distinto de `puedeCerrarSolicitud`.
// En Privado amplía a Director/Coordinador Comercial (además de
// Administrador/Mercadeo, que ya podían); en Público delega íntegramente
// en `puedeCerrarSolicitud` sin ningún cambio de comportamiento.
// ═══════════════════════════════════════════════════════════════════════
describe('puedeRechazarSolicitud', () => {
  const MERCADEO_ANALISTA = usr({ id: 201, usuario: 'ana.rios', email: 'ana.rios@grupocolba.com', rol: 'Analista Mercadeo', estado: 'Activo' });
  const ASISTENTE_COMERCIAL = usr({ id: 301, usuario: 'juan.perez', email: 'juan.perez@grupocolba.com', rol: 'Asistente Comercial', estado: 'Activo' });
  const ADMIN_GLOBAL = usr({ id: 1, usuario: 'admin1', email: 'admin1@grupocolba.com', rol: 'Administrador', estado: 'Activo' });
  const PUBLICO = 'S1';
  const PRIVADO = 'aseo';

  it('1) Administrador + Privado + rechazo → true', () => {
    const sol = solicitud([], 'En evaluación', PRIVADO);
    expect(puedeRechazarSolicitud(ADMIN_GLOBAL, sol).autorizado).toBe(true);
  });

  it('2) Mercadeo + Privado + rechazo → true', () => {
    const sol = solicitud([], 'En evaluación', PRIVADO);
    expect(puedeRechazarSolicitud(MERCADEO_ANALISTA, sol).autorizado).toBe(true);
  });

  it('3) Director Comercial + Privado + rechazo → true (permiso NUEVO)', () => {
    const sol = solicitud([], 'En evaluación', PRIVADO);
    expect(puedeRechazarSolicitud(usr(DIRECTOR), sol).autorizado).toBe(true);
  });

  it('4) Coordinador Comercial + Privado + rechazo → true (permiso NUEVO)', () => {
    const sol = solicitud([], 'En evaluación', PRIVADO);
    expect(puedeRechazarSolicitud(usr(COORDINADOR), sol).autorizado).toBe(true);
  });

  it('5) Analista Comercial + Privado + rechazo → false, aunque sea responsable asignado', () => {
    const sol = solicitud([filaOscar], 'En evaluación', PRIVADO);
    expect(puedeRechazarSolicitud(usr(OSCAR), sol).autorizado).toBe(false);
  });

  it('6) Asistente Comercial + Privado + rechazo → false', () => {
    const sol = solicitud([], 'En evaluación', PRIVADO);
    expect(puedeRechazarSolicitud(ASISTENTE_COMERCIAL, sol).autorizado).toBe(false);
  });

  it('7) Público → conserva EXACTAMENTE el comportamiento de puedeCerrarSolicitud (delegación, no una regla nueva)', () => {
    const solConOscarResponsable = solicitud([filaOscar], 'En evaluación', PUBLICO);
    const solSinResponsable = solicitud([], 'En evaluación', PUBLICO);
    // Analista responsable de su propia fila en Público: autorizado (igual que puedeCerrarSolicitud).
    expect(puedeRechazarSolicitud(usr(OSCAR), solConOscarResponsable).autorizado)
      .toBe(puedeCerrarSolicitud(usr(OSCAR), solConOscarResponsable).autorizado);
    expect(puedeRechazarSolicitud(usr(OSCAR), solConOscarResponsable).autorizado).toBe(true);
    // Director/Coordinador en Público: igual que puedeCerrarSolicitud (ya autorizados ahí, sin cambio).
    expect(puedeRechazarSolicitud(usr(DIRECTOR), solSinResponsable).autorizado)
      .toBe(puedeCerrarSolicitud(usr(DIRECTOR), solSinResponsable).autorizado);
    // Mercadeo en Público sin ser responsable ni admin funcional: false en ambos.
    expect(puedeRechazarSolicitud(MERCADEO_ANALISTA, solSinResponsable).autorizado)
      .toBe(puedeCerrarSolicitud(MERCADEO_ANALISTA, solSinResponsable).autorizado);
    expect(puedeRechazarSolicitud(MERCADEO_ANALISTA, solSinResponsable).autorizado).toBe(false);
  });

  it('estado terminal → false, sin importar el rol', () => {
    const sol = solicitud([], 'Cerrada', PRIVADO);
    expect(puedeRechazarSolicitud(ADMIN_GLOBAL, sol).autorizado).toBe(false);
    expect(puedeRechazarSolicitud(usr(DIRECTOR), sol).autorizado).toBe(false);
  });

  it('el permiso nuevo NO se filtra a puedeCerrarSolicitud (alcance): Director/Coordinador siguen sin poder cerrar un Privado con otro resultado', () => {
    const sol = solicitud([], 'En evaluación', PRIVADO);
    expect(puedeRechazarSolicitud(usr(DIRECTOR), sol).autorizado).toBe(true);
    expect(puedeCerrarSolicitud(usr(DIRECTOR), sol).autorizado).toBe(false);
    expect(puedeRechazarSolicitud(usr(COORDINADOR), sol).autorizado).toBe(true);
    expect(puedeCerrarSolicitud(usr(COORDINADOR), sol).autorizado).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Ajuste "DECISIÓN DE OBSERVACIONES — COMERCIAL RESPONSABLE EN PRIVADOS"
// ═══════════════════════════════════════════════════════════════════════
describe('puedeNoAceptarObservacion', () => {
  const PRIVADO = 'aseo';
  const PUBLICO = 'S1';
  const MERCADEO_ANALISTA = usr({ id: 201, usuario: 'ana.rios', email: 'ana.rios@grupocolba.com', rol: 'Analista Mercadeo', estado: 'Activo' });

  it('Analista Comercial responsable + Privado + En observación → true', () => {
    const sol = solicitud([filaOscar], 'En observación', PRIVADO);
    expect(puedeNoAceptarObservacion(usr(OSCAR), sol).autorizado).toBe(true);
  });

  it('Analista Comercial responsable + Privado + EN_REVISION → true', () => {
    const sol = solicitud([filaOscar], 'EN_REVISION', PRIVADO);
    expect(puedeNoAceptarObservacion(usr(OSCAR), sol).autorizado).toBe(true);
  });

  it('Analista Comercial NO responsable + Privado + En observación → false', () => {
    const sol = solicitud([filaNicole], 'En observación', PRIVADO);
    expect(puedeNoAceptarObservacion(usr(OSCAR), sol).autorizado).toBe(false);
  });

  it('Analista Comercial responsable + Privado fuera de revisión/observación → false (no abre el rechazo general)', () => {
    const sol = solicitud([filaOscar], 'En evaluación', PRIVADO);
    expect(puedeNoAceptarObservacion(usr(OSCAR), sol).autorizado).toBe(false);
    expect(puedeRechazarSolicitud(usr(OSCAR), sol).autorizado).toBe(false);
  });

  it('Público → igual que puedeRechazarSolicitud (responsable sí, ajeno no)', () => {
    expect(puedeNoAceptarObservacion(usr(OSCAR), solicitud([filaOscar], 'En observación', PUBLICO)).autorizado).toBe(true);
    expect(puedeNoAceptarObservacion(usr(OSCAR), solicitud([filaNicole], 'En observación', PUBLICO)).autorizado).toBe(false);
  });

  it('Director/Coordinador/Mercadeo en Privado conservan su permiso de rechazo', () => {
    const sol = solicitud([], 'En observación', PRIVADO);
    expect(puedeNoAceptarObservacion(usr(DIRECTOR), sol).autorizado).toBe(true);
    expect(puedeNoAceptarObservacion(usr(COORDINADOR), sol).autorizado).toBe(true);
    expect(puedeNoAceptarObservacion(MERCADEO_ANALISTA, sol).autorizado).toBe(true);
  });

  it('estado terminal → false aunque sea responsable', () => {
    const sol = solicitud([filaOscar], 'Cerrada', PRIVADO);
    expect(puedeNoAceptarObservacion(usr(OSCAR), sol).autorizado).toBe(false);
  });
});

describe('esAdministradorProcesos', () => {
  it('Administrador, Director Comercial y Coordinador Comercial => true', () => {
    expect(esAdministradorProcesos('Administrador')).toBe(true);
    expect(esAdministradorProcesos('Director Comercial')).toBe(true);
    expect(esAdministradorProcesos('Coordinador Comercial')).toBe(true);
  });
  it('Analista Comercial => false (no coincidencia parcial por "Comercial")', () => {
    expect(esAdministradorProcesos('Analista Comercial')).toBe(false);
  });
  it('"Director Comercial Junior" no se reconoce como Director Comercial', () => {
    expect(esAdministradorProcesos('Director Comercial Junior')).toBe(false);
  });
});

describe('puedeGestionarCualquierAsignacion', () => {
  it('Administrador/Director/Coordinador Comercial => true', () => {
    expect(puedeGestionarCualquierAsignacion(usr(ADMIN))).toBe(true);
    expect(puedeGestionarCualquierAsignacion(usr(DIRECTOR))).toBe(true);
    expect(puedeGestionarCualquierAsignacion(usr(COORDINADOR))).toBe(true);
  });
  it('Analista Comercial (aunque este asignado) => false: esta funcion es SOLO para "cualquier fila", no la propia', () => {
    expect(puedeGestionarCualquierAsignacion(usr(OSCAR))).toBe(false);
  });
});

describe('puedeRevisarProceso — matriz completa', () => {
  it('1) Administrador activo no asignado: permitido', () => {
    const sol = solicitud([filaOscar]);
    const r = puedeRevisarProceso(usr(ADMIN), sol);
    expect(r.autorizado).toBe(true);
    expect(r.esAdministrador).toBe(true);
    expect(r.esResponsable).toBe(false);
  });

  it('2) Director Comercial activo no asignado: permitido', () => {
    const sol = solicitud([filaOscar]);
    const r = puedeRevisarProceso(usr(DIRECTOR), sol);
    expect(r.autorizado).toBe(true);
    expect(r.esSupervisorComercial).toBe(true);
    expect(r.esAdministrador).toBe(false);
  });

  it('3) Coordinador Comercial activo no asignado: permitido', () => {
    const sol = solicitud([filaOscar]);
    const r = puedeRevisarProceso(usr(COORDINADOR), sol);
    expect(r.autorizado).toBe(true);
    expect(r.esSupervisorComercial).toBe(true);
  });

  it('4) Analista Comercial responsable activo: permitido', () => {
    const sol = solicitud([filaOscar, filaNicole]);
    const r = puedeRevisarProceso(usr(OSCAR), sol);
    expect(r.autorizado).toBe(true);
    expect(r.esResponsable).toBe(true);
    expect(r.esAdministrador).toBe(false);
    expect(r.esSupervisorComercial).toBe(false);
  });

  it('5) segundo responsable activo dentro del arreglo: permitido', () => {
    const sol = solicitud([filaOscar, filaNicole]);
    const r = puedeRevisarProceso(usr(NICOLE), sol);
    expect(r.autorizado).toBe(true);
    expect(r.esResponsable).toBe(true);
  });

  it('6) Analista Comercial no asignado: denegado', () => {
    const sol = solicitud([filaOscar]);
    const ajeno = usr({ id: 999, usuario: 'ajeno', email: 'ajeno@x.com', rol: 'Analista Comercial', estado: 'Activo' });
    const r = puedeRevisarProceso(ajeno, sol);
    expect(r.autorizado).toBe(false);
    expect(r.motivo).toBeTruthy();
  });

  it('7) usuario que registro el proceso pero no esta asignado: denegado (registro no implica responsabilidad)', () => {
    const sol = solicitud([filaOscar]);
    const registrador = usr({ id: 888, usuario: 'quien.registro', email: 'quien.registro@x.com', rol: 'Analista Comercial', estado: 'Activo' });
    expect(puedeRevisarProceso(registrador, sol).autorizado).toBe(false);
  });

  it('8) usuario que hizo la asignacion pero no es responsable ni supervisor: denegado', () => {
    const sol = solicitud([filaOscar]);
    const asignador = usr({ id: 777, usuario: 'quien.asigno', email: 'quien.asigno@x.com', rol: 'Analista Comercial', estado: 'Activo' });
    expect(puedeRevisarProceso(asignador, sol).autorizado).toBe(false);
  });

  it('9) responsable removido de asignaciones[]: denegado', () => {
    const sol = solicitud([filaNicole]);
    expect(puedeRevisarProceso(usr(OSCAR), sol).autorizado).toBe(false);
  });

  it('11) proceso sin asignaciones: Administrador/Director/Coordinador permitido, Analista Comercial denegado', () => {
    const solVacia = solicitud([]);
    expect(puedeRevisarProceso(usr(ADMIN), solVacia).autorizado).toBe(true);
    expect(puedeRevisarProceso(usr(DIRECTOR), solVacia).autorizado).toBe(true);
    expect(puedeRevisarProceso(usr(COORDINADOR), solVacia).autorizado).toBe(true);
    expect(puedeRevisarProceso(usr(OSCAR), solVacia).autorizado).toBe(false);
  });

  it('12) variantes de mayusculas/espacios de rol se normalizan igual', () => {
    const sol = solicitud([filaOscar]);
    const directorVariante = usr({ ...DIRECTOR, rol: ' director comercial ' });
    expect(puedeRevisarProceso(directorVariante, sol).autorizado).toBe(true);
  });

  it('13) "Analista Comercial" no se reconoce como supervisor', () => {
    const sol = solicitud([filaOscar]);
    const analista = usr({ id: 555, usuario: 'otro.analista', email: 'otro.analista@x.com', rol: 'Analista Comercial', estado: 'Activo' });
    expect(puedeRevisarProceso(analista, sol).esSupervisorComercial).toBe(false);
  });

  it('14) "Director Comercial Junior" no se autoriza por coincidencia parcial', () => {
    const sol = solicitud([filaOscar]);
    const falsoDirector = usr({ id: 444, usuario: 'falso.director', email: 'falso.director@x.com', rol: 'Director Comercial Junior', estado: 'Activo' });
    const r = puedeRevisarProceso(falsoDirector, sol);
    expect(r.autorizado).toBe(false);
    expect(r.esSupervisorComercial).toBe(false);
  });

  it('15) proceso con multiples asignaciones activas: TODOS los responsables activos pueden acceder', () => {
    const sol = solicitud([filaOscar, filaNicole]);
    expect(puedeRevisarProceso(usr(OSCAR), sol).autorizado).toBe(true);
    expect(puedeRevisarProceso(usr(NICOLE), sol).autorizado).toBe(true);
  });
});

describe('puedeReasignarSolicitud', () => {
  it('Administrador, Director Comercial y Coordinador Comercial pueden reasignar', () => {
    expect(puedeReasignarSolicitud('Administrador')).toBe(true);
    expect(puedeReasignarSolicitud('Director Comercial')).toBe(true);
    expect(puedeReasignarSolicitud('Coordinador Comercial')).toBe(true);
  });

  it('un Analista Comercial sin permiso de BD no puede reasignar', () => {
    expect(puedeReasignarSolicitud('Analista Comercial')).toBe(false);
  });
});

// Ajuste "CORRECCIÓN ARQUITECTÓNICA IMPORTANTE" — `esAdministradorProcesos`
// vive en `src/lib/authz.ts` (junto a `normalizeRole`), NUNCA en este
// archivo, y `authz.ts` NO importa nada de `solicitudes/*` — dirección
// única: autorizacion-asignacion.ts → authz.ts. Si alguna vez se
// introdujera un ciclo (authz.ts → autorizacion-asignacion.ts → authz.ts),
// este `import` en la parte superior del archivo fallaría al cargar el
// módulo, y CUALQUIER prueba de este archivo (ya éxitosamente ejecutándose
// arriba) lo habría detectado. Esta prueba lo deja explícito.
describe('sin dependencia circular authz.ts <-> autorizacion-asignacion.ts', () => {
  it('esAdministradorProcesos importado desde authz.ts funciona correctamente cuando se usa vía autorizacion-asignacion.ts (reexportado)', () => {
    expect(esAdministradorProcesos('Director Comercial')).toBe(true);
    expect(typeof puedeRevisarProceso).toBe('function');
    expect(typeof puedeGestionarCualquierAsignacion).toBe('function');
  });
});