import { describe, it, expect, vi } from 'vitest';

// authz.ts importa @/lib/prisma (exige DATABASE_URL al cargar) por hasPermiso/
// canAccessSolicitud, aunque requireEditarMaestroDocs no toca la BD — se
// mockea vacío solo para poder importar el módulo en pruebas.
vi.mock('@/lib/prisma', () => ({ default: {} }));

import {
  requireEditarMaestroDocs, isAdmin, requireAdmin, esAdministradorProcesos,
  requireAdministradorProcesos, canAccessSolicitud, requireNoMercadeo,
} from './authz';
import type { SessionUser } from '@/lib/session';

function sesion(overrides: Partial<SessionUser> = {}): SessionUser {
  return { id: 1, email: 'x@x.com', rol: 'Analista Comercial', exp: 0, sv: 1, usuario: 'alguien', ...overrides };
}

// Ajuste "Director Comercial y Coordinador Comercial como administradores
// funcionales de TODO el módulo Procesos" — `isAdmin`/`requireAdmin` NUNCA
// se amplían con roles de negocio; `esAdministradorProcesos`/
// `requireAdministradorProcesos` son un concepto NUEVO y SEPARADO, exclusivo
// del módulo Procesos/Solicitudes.
describe('isAdmin/requireAdmin — NO se amplían con Director/Coordinador Comercial (administración global)', () => {
  it('isAdmin("Administrador") es true', () => expect(isAdmin('Administrador')).toBe(true));
  it('isAdmin("Director Comercial") sigue siendo false', () => expect(isAdmin('Director Comercial')).toBe(false));
  it('isAdmin("Coordinador Comercial") sigue siendo false', () => expect(isAdmin('Coordinador Comercial')).toBe(false));
  it('isAdmin("Analista Comercial") es false', () => expect(isAdmin('Analista Comercial')).toBe(false));

  it('requireAdmin: Director Comercial NO administra usuarios/roles/config global (403)', () => {
    const r = requireAdmin(sesion({ rol: 'Director Comercial' }));
    expect(r).not.toBeNull();
    expect(r?.status).toBe(403);
  });
  it('requireAdmin: Coordinador Comercial NO administra usuarios/roles/config global (403)', () => {
    const r = requireAdmin(sesion({ rol: 'Coordinador Comercial' }));
    expect(r).not.toBeNull();
    expect(r?.status).toBe(403);
  });
  it('requireAdmin: Administrador global sí (null)', () => {
    expect(requireAdmin(sesion({ rol: 'Administrador' }))).toBeNull();
  });
});

describe('esAdministradorProcesos — Administrador global, Director Comercial o Coordinador Comercial', () => {
  it('Administrador → true', () => expect(esAdministradorProcesos('Administrador')).toBe(true));
  it('Director Comercial → true', () => expect(esAdministradorProcesos('Director Comercial')).toBe(true));
  it('Coordinador Comercial → true', () => expect(esAdministradorProcesos('Coordinador Comercial')).toBe(true));
  it('Analista Comercial → false', () => expect(esAdministradorProcesos('Analista Comercial')).toBe(false));
  it('Gerencia → false', () => expect(esAdministradorProcesos('Gerencia')).toBe(false));

  it('normaliza mayúsculas/espacios (variante " coordinador comercial ")', () => {
    expect(esAdministradorProcesos(' coordinador comercial ')).toBe(true);
    expect(esAdministradorProcesos('DIRECTOR COMERCIAL')).toBe(true);
  });

  it('nunca autoriza por coincidencia parcial: "Director Comercial Junior" no es Director Comercial', () => {
    expect(esAdministradorProcesos('Director Comercial Junior')).toBe(false);
  });
  it('nunca autoriza por coincidencia parcial: "Analista Comercial" no es supervisor aunque contenga "Comercial"', () => {
    expect(esAdministradorProcesos('Analista Comercial')).toBe(false);
  });

  it('requireAdministradorProcesos: Director Comercial autorizado (null)', () => {
    expect(requireAdministradorProcesos(sesion({ rol: 'Director Comercial' }))).toBeNull();
  });
  it('requireAdministradorProcesos: Coordinador Comercial autorizado (null)', () => {
    expect(requireAdministradorProcesos(sesion({ rol: 'Coordinador Comercial' }))).toBeNull();
  });
  it('requireAdministradorProcesos: Analista Comercial denegado (403)', () => {
    const r = requireAdministradorProcesos(sesion({ rol: 'Analista Comercial' }));
    expect(r).not.toBeNull();
    expect(r?.status).toBe(403);
  });
  it('requireAdministradorProcesos: sin sesión (401)', () => {
    const r = requireAdministradorProcesos(null);
    expect(r).not.toBeNull();
    expect(r?.status).toBe(401);
  });
});

describe('canAccessSolicitud — administrador funcional de Procesos accede a cualquier solicitud', () => {
  const solicitudAjena = { emailRegistro: 'otro@x.com', usuarioRegistro: 'otro', asignaciones: [{ analistaAsignado: 'otro' }], aprobador: null, revisor: null };

  it('Director Comercial accede aunque no figure en ningún campo de identidad', () => {
    expect(canAccessSolicitud(sesion({ rol: 'Director Comercial' }), solicitudAjena)).toBe(true);
  });
  it('Coordinador Comercial accede aunque no figure en ningún campo de identidad', () => {
    expect(canAccessSolicitud(sesion({ rol: 'Coordinador Comercial' }), solicitudAjena)).toBe(true);
  });
  it('Analista Comercial ajeno NO accede', () => {
    expect(canAccessSolicitud(sesion({ rol: 'Analista Comercial', usuario: 'ajeno', email: 'ajeno@x.com' }), solicitudAjena)).toBe(false);
  });
  it('Analista Comercial asignado sí accede (identidad, no rol)', () => {
    expect(canAccessSolicitud(sesion({ rol: 'Analista Comercial', usuario: 'otro', email: 'otro@x.com' }), solicitudAjena)).toBe(true);
  });
});

// Regla "INFORMES GERENCIALES / TRM — TODOS EXCEPTO MERCADEO": guard genérico
// reutilizado por `GET /api/trm`, `GET /api/trm/proyeccion-decimal` y
// `GET /api/informes/procesos-adjudicados`. Autenticado y NO Mercadeo.
describe('requireNoMercadeo — todos los autenticados excepto Mercadeo', () => {
  it('sin sesión → 401', () => {
    const r = requireNoMercadeo(null);
    expect(r).not.toBeNull();
    expect(r?.status).toBe(401);
  });

  it.each(['Administrador', 'Gerencia', 'Director Comercial', 'Coordinador Comercial', 'Analista Comercial', 'Asistente Comercial', 'Usuario Final'])(
    '%s (autenticado, no Mercadeo) → autorizado (null)',
    (rol) => {
      expect(requireNoMercadeo(sesion({ rol }))).toBeNull();
    },
  );

  it.each(['Analista Mercadeo', 'Asistente Mercadeo', ' analista mercadeo ', 'ASISTENTE MERCADEO'])(
    '%s → 403',
    (rol) => {
      const r = requireNoMercadeo(sesion({ rol }));
      expect(r).not.toBeNull();
      expect(r?.status).toBe(403);
    },
  );

  it('no autoriza/deniega por coincidencia parcial: "Analista Comercial" contiene "Comercial" pero NO es Mercadeo → null', () => {
    expect(requireNoMercadeo(sesion({ rol: 'Analista Comercial' }))).toBeNull();
  });
  it('un rol inventado que contiene "mercadeo" como substring ("Jefe de Mercadeo Digital") NO es Mercadeo (sin match parcial) → null', () => {
    expect(requireNoMercadeo(sesion({ rol: 'Jefe de Mercadeo Digital' }))).toBeNull();
  });
});

describe('requireEditarMaestroDocs', () => {
  it('sin sesión: 401', () => {
    const r = requireEditarMaestroDocs(null);
    expect(r).not.toBeNull();
    expect(r?.status).toBe(401);
  });

  it('Administrador: autorizado (null)', () => {
    expect(requireEditarMaestroDocs(sesion({ rol: 'Administrador' }))).toBeNull();
  });

  it('nicole.ortiz (excepción puntual, no es admin): autorizado (null)', () => {
    expect(requireEditarMaestroDocs(sesion({ rol: 'Analista Comercial', usuario: 'nicole.ortiz' }))).toBeNull();
  });

  it('otro Analista Comercial (mismo rol, distinto usuario): 403 — la excepción es por usuario, no por rol', () => {
    const r = requireEditarMaestroDocs(sesion({ rol: 'Analista Comercial', usuario: 'otro.analista' }));
    expect(r).not.toBeNull();
    expect(r?.status).toBe(403);
  });

  it('mensaje de error es claro (no el genérico "No autorizado")', async () => {
    const r = requireEditarMaestroDocs(sesion({ usuario: 'otro.analista' }));
    const data = await r!.json();
    expect(data.error).toContain('Contacta a un Administrador');
  });
});
