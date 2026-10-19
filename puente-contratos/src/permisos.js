/**
 * Permisos MÍNIMOS del usuario de MySQL del puente, derivados del contrato de esquema (`esquema-esperado.json`): las
 * mismas tablas y columnas que el puente usa. Sirve para pedirle al DBA de Contratos un usuario propio, sin DDL y sin
 * acceso a lo que el puente no toca (p. ej. la fila de `fc_control` trae usuario y clave de conexión).
 *
 * - Tabla de escritura: SELECT e INSERT (más lo que declare su `permisos`, p. ej. DELETE para compensar una tabla MyISAM).
 * - Tabla de consulta: SELECT solo de las columnas que el contrato lista.
 * - Cualquier otra necesidad se declara en `permisos` con la sintaxis de GRANT (p. ej. `UPDATE (num_oferta)`).
 * - Solo las tablas de los módulos ya implementados (`modulo` ≤ `hastaModulo`).
 */
import { esquemaHastaModulo } from './esquema.js';
import { BASES_DE_NOMINA } from './nomina.js';

const IDENTIFICADOR = /^[A-Za-z0-9_.%-]+$/;

export function clausulasDeTabla(tabla) {
  if (tabla.uso === 'escritura') return ['SELECT', 'INSERT', ...(tabla.permisos ?? [])];
  if (tabla.permisos) return tabla.permisos;
  return [`SELECT (${Object.keys(tabla.columnas).join(', ')})`];
}

/**
 * @param {{tablas: object}} esquema contrato de esquema
 * @param {{usuario: string, base: string, host?: string, hastaModulo: number}} opciones
 * @returns {string[]} una sentencia GRANT por tabla
 */
export function sentenciasDePermisos(esquema, { usuario, base, host = '%', hastaModulo }) {
  for (const [nombre, valor] of Object.entries({ usuario, base, host })) {
    if (typeof valor !== 'string' || !IDENTIFICADOR.test(valor)) throw new RangeError(`«${nombre}» no es un identificador válido.`);
  }
  const deTablas = Object.entries(esquemaHastaModulo(esquema, hastaModulo).tablas).map(
    ([nombre, tabla]) => `GRANT ${clausulasDeTabla(tabla).join(', ')} ON \`${base}\`.\`${nombre}\` TO '${usuario}'@'${host}';`,
  );
  if (hastaModulo < 5) return deTablas;
  // Módulo 5 (cargos): el código de cada cargo sale de la nómina de la UEN. `gl_undnegocios` dice cuál es la base de
  // nómina y `<base>.cargos` trae los códigos (se lee completa: sus columnas cambian de una nómina a otra).
  return [
    ...deTablas,
    `GRANT SELECT (codigo, empresa, dbnomina) ON \`${base}\`.\`gl_undnegocios\` TO '${usuario}'@'${host}';`,
    ...BASES_DE_NOMINA.map((nomina) => `GRANT SELECT ON \`${nomina}\`.\`cargos\` TO '${usuario}'@'${host}';`),
  ];
}
