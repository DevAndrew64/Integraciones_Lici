/* =========================================================
   Tipos centrales del sistema RBAC de LICYCOLBA
   Define roles, módulos y acciones autorizables del sistema.
========================================================= */

export type RolSistema =
  | 'Administrador'
  | 'Gerencia'
  | 'Analista Mercadeo'
  | 'Asistente Mercadeo'
  | 'Director Comercial'
  | 'Coordinador Comercial'
  | 'Analista Comercial'
  | 'Usuario Final';

export type ModuloLicy =
  | 'dashboard'
  | 'busqueda'
  | 'procesosNuevos'
  | 'solicitudesComercial'
  | 'solicitudesEspecializadas'
  | 'asignaciones'
  | 'cronogramas'
  | 'documentos'
  | 'usuarios'
  | 'parametrizacion'
  | 'informes'
  | 'estructuraCostos'
  | 'examenesMedicos'
  | 'equipos'
  | 'indicadores';

export type AccionPermiso =
  | 'ver'
  | 'crear'
  | 'editar'
  | 'eliminar'
  | 'asignar'
  | 'reasignar'
  | 'gestionar'
  | 'administrar';

export type PermisoModulo = Partial<Record<AccionPermiso, boolean>>;

export type MatrizPermisos = Record<
  RolSistema,
  Partial<Record<ModuloLicy, PermisoModulo>>
>;