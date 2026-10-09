import { crearApp } from './app.js';
import { crearEscritorMySQL } from './escritor-mysql.js';
import { cargarEsquemaEsperado, crearEstadoBD, esquemaHastaModulo, opcionesDeEscritura, verificarEsquema } from './esquema.js';
import { MODULO_IMPLEMENTADO } from './modulos.js';
import { crearPool, leerConfigMySQL } from './mysql.js';

const token = process.env.PUENTE_TOKEN ?? '';
if (token.length < 16) {
  console.error('PUENTE_TOKEN es obligatorio (mínimo 16 caracteres): el servicio no arranca sin autenticación.');
  process.exit(1);
}
const modo = process.env.PUENTE_MODO ?? 'dry-run';
if (modo !== 'dry-run' && modo !== 'escritura') {
  console.error(`PUENTE_MODO debe ser «dry-run» o «escritura» (recibido: ${modo}).`);
  process.exit(1);
}
const puerto = Number(process.env.PUENTE_PORT ?? 4010);
// Por defecto solo escucha en local; en Docker se usa 0.0.0.0 SIN publicar el puerto fuera de la red interna.
const host = process.env.PUENTE_HOST ?? '127.0.0.1';

let configMySQL;
try {
  configMySQL = leerConfigMySQL(process.env);
} catch (error) {
  console.error(`Configuración de MySQL inválida: ${error.message}`);
  process.exit(1);
}
if (modo === 'escritura' && !configMySQL) {
  console.error('El modo «escritura» necesita MySQL: define PUENTE_MYSQL_HOST, _USER y _DATABASE (_PASSWORD es opcional).');
  process.exit(1);
}

const pool = configMySQL ? crearPool(configMySQL) : null;
// Solo las tablas de los módulos ya implementados: el usuario de MySQL del puente tiene permisos solo sobre esas.
const esquema = esquemaHastaModulo(cargarEsquemaEsperado(), MODULO_IMPLEMENTADO);
let opcionesEscritura = {};
if (pool && modo === 'escritura') {
  // Fail-closed: si la base no responde o su estructura ya no es la esperada, el servicio no arranca.
  try {
    const { ok, problemas, real } = await verificarEsquema(pool, esquema);
    if (!ok) {
      console.error(JSON.stringify({ evento: 'esquema-distinto', cantidad: problemas.length, primeros: problemas.slice(0, 5) }));
      process.exit(1);
    }
    opcionesEscritura = opcionesDeEscritura(real);
    // La marca corta «LICICOLBA:<solicitud>:» necesita hasta 21 caracteres: sin ella no se reconocería un reenvío.
    if (opcionesEscritura.largoPcAdd !== null && opcionesEscritura.largoPcAdd < 21) {
      console.error(JSON.stringify({ evento: 'pc_add-muy-corto', largo: opcionesEscritura.largoPcAdd }));
      process.exit(1);
    }
    console.log(JSON.stringify({ evento: 'escritura-adaptada', tabla: 'fc_ofertas_adjudicadas', ...opcionesEscritura }));
  } catch (error) {
    console.error(JSON.stringify({ evento: 'bd-sin-conexion', codigo: error?.code ?? 'DESCONOCIDO' }));
    process.exit(1);
  }
}

const escritor = pool && modo === 'escritura' ? crearEscritorMySQL(pool, opcionesEscritura) : undefined;
crearApp({ token, modo, escritor, estadoBD: pool ? crearEstadoBD(pool, esquema) : undefined }).listen(puerto, host, () => {
  console.log(JSON.stringify({ evento: 'puente-contratos-iniciado', host, puerto, modo, mysql: pool ? 'configurado' : 'sin_configurar' }));
});
