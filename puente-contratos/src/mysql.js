/**
 * Conexión a la base de Contratos (MySQL 5.5, tablas latin1). Prisma no habla con 5.5; por eso el puente usa mysql2.
 *
 * - Modo estricto en CADA conexión: el MySQL 5.5 de Contratos trae el modo laxo por defecto, que trunca textos y números
 *   en silencio. Con STRICT_ALL_TABLES un dato que no cabe es un error y no se guarda nada a medias.
 * - Los DECIMAL llegan como texto y las fechas como texto (sin conversión de zona horaria ni «0000-00-00» inválidas).
 * - Toda sentencia lleva parámetros (`?`); nunca se arma SQL concatenando datos.
 */
import mysql from 'mysql2/promise';

export const SQL_MODE_ESTRICTO = 'STRICT_ALL_TABLES,NO_ENGINE_SUBSTITUTION';

/**
 * Lee la configuración de MySQL del entorno. Sin PUENTE_MYSQL_HOST no hay MySQL (el puente sigue en modo prueba).
 * @returns {null | {host: string, port: number, user: string, password: string, database: string}}
 * @throws {Error} si hay host pero falta o es inválido otro dato (el mensaje no incluye la clave)
 */
export function leerConfigMySQL(env = process.env) {
  const host = env.PUENTE_MYSQL_HOST?.trim();
  if (!host) return null;
  const errores = [];
  const port = Number(env.PUENTE_MYSQL_PORT || 3306); // vacío ⇒ puerto por defecto
  if (!Number.isInteger(port) || port < 1 || port > 65535) errores.push('PUENTE_MYSQL_PORT debe ser un puerto válido (1-65535)');
  const user = env.PUENTE_MYSQL_USER?.trim();
  if (!user) errores.push('PUENTE_MYSQL_USER es obligatorio');
  const password = env.PUENTE_MYSQL_PASSWORD ?? '';
  if (!password) errores.push('PUENTE_MYSQL_PASSWORD es obligatorio');
  const database = env.PUENTE_MYSQL_DATABASE?.trim();
  if (!database) errores.push('PUENTE_MYSQL_DATABASE es obligatorio');
  if (errores.length > 0) throw new Error(errores.join('; '));
  return { host, port, user, password, database };
}

/** @param {ReturnType<typeof leerConfigMySQL> & object} config */
export function crearPool(config, lib = mysql) {
  const pool = lib.createPool({
    ...config,
    // Se conecta como utf8 y el servidor convierte a latin1: lo que no cabe falla (modo estricto) en vez de cambiarse por «?».
    charset: 'UTF8_GENERAL_CI',
    dateStrings: true,
    supportBigNumbers: true,
    bigNumberStrings: true,
    connectionLimit: 4,
    waitForConnections: true,
    connectTimeout: 5000,
    enableKeepAlive: true,
  });
  // Cada conexión nueva queda en modo estricto antes de ejecutar nada. Si no se logra, se descarta: nunca se usa en modo laxo.
  pool.pool.on('connection', (conexion) => {
    conexion.query(`SET SESSION sql_mode = '${SQL_MODE_ESTRICTO}'`, (error) => {
      if (error) conexion.destroy();
    });
  });
  return pool;
}
