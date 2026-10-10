/**
 * El puente SIN servicio aparte: LiciColba lo carga y escribe directo en el MySQL de Contratos de la intranet. Es lo mismo que
 * hace `server.js` al arrancar (verificar el esquema y adaptar la escritura), pero perezoso: la base se verifica en el primer
 * envío y, si falla, se vuelve a intentar en el siguiente (LiciColba no se cae porque Contratos no responda).
 */
import { crearEscritorMySQL } from './escritor-mysql.js';
import { esquemaHastaModulo, opcionesDeEscritura, verificarEsquema } from './esquema.js';
import { MODULO_IMPLEMENTADO } from './modulos.js';
import { crearPool } from './mysql.js';
import { procesarEnvio } from './procesar.js';

const ERRORES_DE_CONEXION = new Set(['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET', 'EHOSTUNREACH', 'PROTOCOL_CONNECTION_LOST', 'ER_CON_COUNT_ERROR', 'ER_ACCESS_DENIED_ERROR', 'ER_DBACCESS_DENIED_ERROR']);

const respuesta = (estado, error, mensaje) => ({ estado, cuerpo: { ok: false, error, mensaje } });

/**
 * @param {{modo: 'dry-run' | 'escritura', configMySQL: {host: string, port: number, user: string, password: string, database: string}, esquemaEsperado: object, crearPoolFn?: typeof crearPool}} opciones
 * @returns {{enviar(cuerpo: unknown): Promise<{estado: number, cuerpo: Record<string, unknown>}>}}
 */
export function crearMotor({ modo, configMySQL, esquemaEsperado, crearPoolFn = crearPool }) {
  // Solo las tablas de los módulos ya implementados: el usuario de MySQL tiene permisos solo sobre esas.
  const esquema = esquemaHastaModulo(esquemaEsperado, MODULO_IMPLEMENTADO);
  let pool = null;
  let escritor = null;
  let preparando = null; // varios envíos simultáneos comparten UNA sola verificación

  async function preparar() {
    pool ??= crearPoolFn(configMySQL);
    const { ok, problemas, real } = await verificarEsquema(pool, esquema);
    if (!ok) {
      console.error(JSON.stringify({ evento: 'esquema-distinto', cantidad: problemas.length, primeros: problemas.slice(0, 5) }));
      return respuesta(503, 'ESQUEMA_DISTINTO', 'La estructura de la base de Contratos no es la esperada: no se escribe nada hasta revisarla.');
    }
    const opciones = opcionesDeEscritura(real);
    // La marca corta «LICICOLBA:<solicitud>:» necesita hasta 21 caracteres: sin ella no se reconocería un reenvío.
    if (opciones.largoPcAdd !== null && opciones.largoPcAdd < 21) {
      console.error(JSON.stringify({ evento: 'pc_add-muy-corto', largo: opciones.largoPcAdd }));
      return respuesta(503, 'ESQUEMA_DISTINTO', 'La columna pc_add de Contratos es muy corta para marcar los envíos de LiciColba.');
    }
    escritor = crearEscritorMySQL(pool, opciones);
    return null;
  }

  return {
    async enviar(cuerpo) {
      if (modo === 'escritura' && !escritor) {
        try {
          preparando ??= preparar().finally(() => {
            preparando = null;
          });
          const rechazo = await preparando;
          if (rechazo) return rechazo;
        } catch (error) {
          if (!ERRORES_DE_CONEXION.has(error?.code)) throw error;
          console.error(JSON.stringify({ evento: 'bd-sin-conexion', codigo: error.code }));
          return respuesta(503, 'BD_NO_DISPONIBLE', 'No se pudo conectar con la base de datos de Contratos.');
        }
      }
      return procesarEnvio(cuerpo, { modo, escritor: modo === 'escritura' ? escritor : null });
    },
  };
}
