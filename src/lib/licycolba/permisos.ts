import type {
  RolSistema,
  ModuloLicy,
  AccionPermiso,
  MatrizPermisos,
} from '@/types/licycolba/roles';

const ROLES_VALIDOS: RolSistema[] = [
  'Administrador',
  'Gerencia',
  'Analista Mercadeo',
  'Asistente Mercadeo',
  'Director Comercial',
  'Coordinador Comercial',
  'Analista Comercial',
  'Usuario Final',
];

export const MATRIZ_PERMISOS: MatrizPermisos = {
  Administrador: {},

  Gerencia: {
    dashboard:                 { ver: true },
    busqueda:                  { ver: true },
    procesosNuevos:            { ver: true },
    solicitudesComercial:      { ver: true },
    solicitudesEspecializadas: { ver: true },
    asignaciones:              { ver: true },
    cronogramas:               { ver: true },
    documentos:                { ver: true },
    usuarios:                  { ver: true },
    parametrizacion:           { ver: true },
    informes:                  { ver: true },
  },

  'Analista Mercadeo': {
    dashboard:                 { ver: true },
    busqueda:                  { ver: true, crear: true, gestionar: true },
    procesosNuevos:            { ver: true, crear: true, gestionar: true },
    solicitudesComercial:      { ver: true },
    solicitudesEspecializadas: { ver: true },
    asignaciones:              { ver: true },
    cronogramas:               { ver: true },
    documentos:                { ver: true },
    usuarios:                  { ver: true },
    informes:                  { ver: true },
  },

  // Rol propio, distinto de 'Analista Mercadeo' — NO es un alias ni una
  // fusión. Refleja el PerfilRol "Asistente Mercadeo" real configurado en
  // BD (busqueda_gestionar, sol_crear_comercial, sol_editar, sol_ver_todas,
  // etc.) — esta es la matriz estática de RESPALDO (se usa solo si no hay
  // `permisosRol` cargado desde BD); mantenerla en sincronía manualmente si
  // el PerfilRol de BD cambia. `sol_ver_todas` no tiene equivalente en este
  // sistema modulo/acción — se lee directo por clave (`pb?.sol_ver_todas`),
  // no requiere entrada aquí.
  'Asistente Mercadeo': {
    dashboard:                 { ver: true },
    busqueda:                  { ver: true, gestionar: true },
    procesosNuevos:            { ver: true },
    solicitudesComercial:      { ver: true, crear: true, editar: true },
  },

  'Director Comercial': {
    dashboard:                 { ver: true },
    busqueda:                  { ver: true },
    procesosNuevos:            { ver: true },
    solicitudesComercial:      { ver: true, editar: true, crear: true },
    solicitudesEspecializadas: { ver: true, editar: true, crear: true },
    asignaciones:              { ver: true, asignar: true, reasignar: true, gestionar: true, editar: true },
    cronogramas:               { ver: true },
    documentos:                { ver: true },
    usuarios:                  { ver: true },
    informes:                  { ver: true },
  },

  'Coordinador Comercial': {
    dashboard:                 { ver: true },
    busqueda:                  { ver: true },
    procesosNuevos:            { ver: true },
    solicitudesComercial:      { ver: true, editar: true, crear: true },
    solicitudesEspecializadas: { ver: true, editar: true, crear: true },
    asignaciones:              { ver: true, asignar: true, reasignar: true, gestionar: true, editar: true },
    cronogramas:               { ver: true },
    documentos:                { ver: true },
    usuarios:                  { ver: true },
    informes:                  { ver: true },
  },

  'Analista Comercial': {
    dashboard:                 { ver: true },
    busqueda:                  { ver: true },
    procesosNuevos:            { ver: true },
    solicitudesComercial:      { ver: true, crear: true },
    solicitudesEspecializadas: { ver: true, crear: true },
    asignaciones:              { ver: true, gestionar: true, editar: true },
    cronogramas:               { ver: true },
    documentos:                { ver: true },
    usuarios:                  { ver: true },
    informes:                  { ver: true },
  },

  'Usuario Final': {
    dashboard:                 { ver: true },
    documentos:                { ver: true },
    cronogramas:               { ver: true },
    usuarios:                  { ver: true },
  },
};

/* =========================================================
   Mapa de claves BD → módulo/acción del sistema hardcodeado
   Formato: 'clave_bd' → { modulo, accion }
   Coincide con PERMISOS_LISTA en page.tsx
========================================================= */
const CLAVE_BD_A_MODULO: Record<string, { modulo: ModuloLicy; accion: AccionPermiso }> = {
  ver_dashboard:              { modulo: 'dashboard',               accion: 'ver' },
  ver_trm:                    { modulo: 'dashboard',               accion: 'ver' },
  ver_busqueda:               { modulo: 'busqueda',                accion: 'ver' },
  busqueda_gestionar:         { modulo: 'busqueda',                accion: 'gestionar' },
  busqueda_marcar_no_viable:  { modulo: 'busqueda',                accion: 'gestionar' },
  busqueda_ver_todos:         { modulo: 'busqueda',                accion: 'ver' },
  busqueda_ver_gestionados:   { modulo: 'busqueda',                accion: 'ver' },
  busqueda_ver_sin_gestionar: { modulo: 'busqueda',                accion: 'ver' },
  busqueda_ver_no_viables:    { modulo: 'busqueda',                accion: 'ver' },
  busqueda_ver_historico:     { modulo: 'procesosNuevos',          accion: 'ver' },
  ver_solicitudes:            { modulo: 'solicitudesComercial',    accion: 'ver' },
  sol_ver_comercial:          { modulo: 'solicitudesComercial',    accion: 'ver' },
  sol_ver_especializada:      { modulo: 'solicitudesEspecializadas', accion: 'ver' },
  sol_ver_rechazadas:         { modulo: 'solicitudesComercial',    accion: 'ver' },
  sol_ver_eliminadas:         { modulo: 'solicitudesComercial',    accion: 'ver' },
  sol_crear_comercial:        { modulo: 'solicitudesComercial',    accion: 'crear' },
  sol_editar:                 { modulo: 'solicitudesComercial',    accion: 'editar' },
  sol_eliminar:               { modulo: 'solicitudesComercial',    accion: 'eliminar' },
  sol_crear_especializada:    { modulo: 'solicitudesEspecializadas', accion: 'crear' },
  ver_asignaciones:           { modulo: 'asignaciones',            accion: 'ver' },
  asig_asignar_responsable:   { modulo: 'asignaciones',            accion: 'asignar' },
  asig_gestionar:             { modulo: 'asignaciones',            accion: 'gestionar' },
  asig_validar_elaboracion:   { modulo: 'asignaciones',            accion: 'editar' },
  ver_cronogramas:            { modulo: 'cronogramas',             accion: 'ver' },
  ver_maestro_docs:           { modulo: 'documentos',              accion: 'ver' },
  ver_estructura_costos:      { modulo: 'estructuraCostos',        accion: 'ver' },
  ver_examenes:               { modulo: 'examenesMedicos',         accion: 'ver' },
  ver_equipos:                { modulo: 'equipos',                 accion: 'ver' },
  ver_indicadores:            { modulo: 'indicadores',             accion: 'ver' },
  ver_usuarios:               { modulo: 'usuarios',                accion: 'ver' },
  usr_ver_lista:              { modulo: 'usuarios',                accion: 'ver' },
  usr_crear:                  { modulo: 'usuarios',                accion: 'crear' },
  usr_editar:                 { modulo: 'usuarios',                accion: 'editar' },
  usr_eliminar:               { modulo: 'usuarios',                accion: 'eliminar' },
  usr_gestionar_perfiles:     { modulo: 'usuarios',                accion: 'administrar' },
};

export function normalizarRol(rol: string | null | undefined): RolSistema {
  if (!rol) return 'Usuario Final';
  const limpio = rol.trim();
  if ((ROLES_VALIDOS as string[]).includes(limpio)) return limpio as RolSistema;
  return 'Usuario Final';
}

/**
 * Versión original — usa solo la matriz hardcodeada.
 * Se mantiene por compatibilidad con código existente.
 */
export function puede(
  rol: string | null | undefined,
  modulo: ModuloLicy,
  accion: AccionPermiso
): boolean {
  const rolNorm = normalizarRol(rol);
  if (rolNorm === 'Administrador') return true;
  const permisosRol = MATRIZ_PERMISOS[rolNorm];
  const permisosModulo = permisosRol?.[modulo];
  return permisosModulo?.[accion] === true;
}

/**
 * Versión con BD — si hay permisos de BD los usa; si no, cae al hardcodeado.
 * Úsala en page.tsx cuando tengas permisosRol en sesión.
 */
export function puedeConBD(
  rol: string | null | undefined,
  modulo: ModuloLicy,
  accion: AccionPermiso,
  permisosRol?: Record<string, boolean>
): boolean {
  const rolNorm = normalizarRol(rol);

  // Administrador siempre puede todo, sin importar BD
  if (rolNorm === 'Administrador') return true;

  // Si hay permisos de BD, buscar las claves que corresponden al módulo+acción
  if (permisosRol && Object.keys(permisosRol).length > 0) {
    const clavesRelevantes = Object.entries(CLAVE_BD_A_MODULO)
      .filter(([, v]) => v.modulo === modulo && v.accion === accion)
      .map(([k]) => k);

    if (clavesRelevantes.length > 0) {
      // Si al menos una clave del grupo está en true, tiene permiso
      return clavesRelevantes.some(clave => permisosRol[clave] === true);
    }
  }

  // Fallback: usar matriz hardcodeada
  const permisosMatriz = MATRIZ_PERMISOS[rolNorm];
  return permisosMatriz?.[modulo]?.[accion] === true;
}

/**
 * Versión con BD para verificar si puede ver un módulo.
 */
export function puedeVerModuloConBD(
  rol: string | null | undefined,
  modulo: ModuloLicy,
  permisosRol?: Record<string, boolean>
): boolean {
  return puedeConBD(rol, modulo, 'ver', permisosRol);
}

// Exportar las originales sin cambios para no romper nada
export function puedeVerModulo(
  rol: string | null | undefined,
  modulo: ModuloLicy
): boolean {
  return puede(rol, modulo, 'ver');
}

export function obtenerPermisosModulo(
  rol: string | null | undefined,
  modulo: ModuloLicy
): Partial<Record<AccionPermiso, boolean>> {
  const rolNorm = normalizarRol(rol);
  if (rolNorm === 'Administrador') {
    return {
      ver: true, crear: true, editar: true, eliminar: true,
      asignar: true, reasignar: true, gestionar: true, administrar: true,
    };
  }
  return MATRIZ_PERMISOS[rolNorm]?.[modulo] ?? {};
}

export function obtenerPermisosRol(
  rol: string | null | undefined
): MatrizPermisos[RolSistema] {
  const rolNorm = normalizarRol(rol);
  return MATRIZ_PERMISOS[rolNorm] ?? {};
}

export function esSoloLectura(rol: string | null | undefined): boolean {
  const rolNorm = normalizarRol(rol);
  return rolNorm === 'Gerencia' || rolNorm === 'Usuario Final';
}