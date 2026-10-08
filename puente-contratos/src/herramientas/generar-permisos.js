/**
 * Imprime los GRANT mínimos del usuario de MySQL del puente (para el DBA de Contratos). No se conecta a ninguna base.
 *
 *   npm run permisos:generar -- --usuario puente --base almacen [--host '%'] [--hasta-modulo 4]
 */
import { cargarEsquemaEsperado } from '../esquema.js';
import { MODULO_IMPLEMENTADO } from '../modulos.js';
import { sentenciasDePermisos } from '../permisos.js';

const argumentos = process.argv.slice(2);
const valorDe = (bandera, defecto) => {
  const i = argumentos.indexOf(bandera);
  return i >= 0 && argumentos[i + 1] !== undefined ? argumentos[i + 1] : defecto;
};

const usuario = valorDe('--usuario');
const base = valorDe('--base');
if (!usuario || !base) {
  console.error("Uso: npm run permisos:generar -- --usuario <usuario> --base <base> [--host '%'] [--hasta-modulo N]");
  process.exit(1);
}
const host = valorDe('--host', '%');
const hastaModulo = Number(valorDe('--hasta-modulo', MODULO_IMPLEMENTADO));
if (!Number.isInteger(hastaModulo) || hastaModulo < 1) {
  console.error('--hasta-modulo debe ser un entero positivo.');
  process.exit(1);
}

try {
  const sentencias = sentenciasDePermisos(cargarEsquemaEsperado(), { usuario, base, host, hastaModulo });
  console.log(`-- Permisos mínimos del usuario del puente LiciColba → Contratos (módulos 1 a ${hastaModulo}).`);
  console.log('-- Generado de src/esquema-esperado.json. Sin DDL, sin DELETE/UPDATE salvo donde se indica y sin acceso a fc_empresas.');
  console.log(`-- Cree el usuario con su clave (la clave no va en este archivo):  CREATE USER '${usuario}'@'${host}' IDENTIFIED BY '<clave>';`);
  for (const sentencia of sentencias) console.log(sentencia);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
