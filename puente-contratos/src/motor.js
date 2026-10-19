/**
 * El puente SIN servicio aparte: LiciColba lo carga y escribe directo en el MySQL de Contratos de la intranet. Es lo mismo que
 * hace `server.js` al arrancar (verificar el esquema y adaptar la escritura), pero perezoso: la base se verifica en el primer
 * envío y, si falla, se vuelve a intentar en el siguiente (LiciColba no se cae porque Contratos no responda).
 */
import { leerDestino } from './destino.js';
import { crearEscritorMySQL } from './escritor-mysql.js';
import { esquemaHastaModulo, opcionesDeEscritura, verificarEsquema } from './esquema.js';
import { MODULO_IMPLEMENTADO } from './modulos.js';
import { crearPool } from './mysql.js';
import { vistaDeNomina } from './nomina.js';
import { procesarEnvio } from './procesar.js';

const ERRORES_DE_CONEXION = new Set(['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET', 'EHOSTUNREACH', 'PROTOCOL_CONNECTION_LOST', 'ER_CON_COUNT_ERROR', 'ER_ACCESS_DENIED_ERROR', 'ER_DBACCESS_DENIED_ERROR']);

/** Sin permiso de lectura sobre una tabla o base (o no existe). */
const ERRORES_DE_ACCESO = new Set([1044, 1049, 1142, 1143, 1146]);

/**
 * Una lectura que falla porque la conexión del pool ya estaba muerta (el servidor la cerró, la red se cortó) se repite UNA vez:
 * el pool descarta la conexión rota y abre otra. Lo demás sube tal cual.
 */
async function reintentarSiSeCayo(leer) {
  try {
    return await leer();
  } catch (error) {
    const caida = error?.fatal === true || ERRORES_DE_CONEXION.has(error?.code) || /closed state/i.test(String(error?.message ?? ''));
    if (!caida) throw error;
    return leer();
  }
}

const respuesta = (estado, error, mensaje) => ({ estado, cuerpo: { ok: false, error, mensaje } });

/**
 * @param {{modo: 'dry-run' | 'escritura', configMySQL: {host: string, port: number, user: string, password: string, database: string}, esquemaEsperado: object, crearPoolFn?: typeof crearPool}} opciones
 * @returns {{destino(nombreEmpresa: string): Promise<{estado: number, cuerpo: Record<string, unknown>}>, cargosNomina(pedido: object): Promise<{estado: number, cuerpo: Record<string, unknown>}>, enviar(cuerpo: unknown): Promise<{estado: number, cuerpo: Record<string, unknown>}>}}
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
    /**
     * Empresa, UEN y conceptos de Contratos para una empresa de LiciColba (por su nombre). Solo lee, también en dry-run:
     * así la pantalla ofrece las UEN reales aunque el envío sea de prueba.
     */
    async destino(nombreEmpresa) {
      try {
        pool ??= crearPoolFn(configMySQL);
        return { estado: 200, cuerpo: { ok: true, ...(await reintentarSiSeCayo(() => leerDestino(pool, nombreEmpresa))) } };
      } catch (error) {
        if (ERRORES_DE_ACCESO.has(error?.errno)) {
          console.error(JSON.stringify({ evento: 'destino-sin-permiso', codigo: error.errno }));
          return respuesta(503, 'SIN_PERMISO', 'El usuario de Contratos no puede leer las empresas, contadores o conceptos.');
        }
        if (!ERRORES_DE_CONEXION.has(error?.code)) throw error;
        console.error(JSON.stringify({ evento: 'bd-sin-conexion', codigo: error.code }));
        return respuesta(503, 'BD_NO_DISPONIBLE', 'No se pudo conectar con la base de datos de Contratos.');
      }
    },

    /**
     * Vista previa de los cargos contra la nómina de la UEN (qué código toma cada línea y el catálogo para elegir los que no
     * cruzan). Solo lee, también en dry-run: el modo prueba no revisa la nómina, así un cargo que no está se ve antes de enviar.
     *
     * @param {{empresa: string, undnegocio: string, cargos: {nombre: string, codigoNomina?: number | null}[], baseNomina?: string | null}} pedido
     */
    async cargosNomina(pedido) {
      const codigo = (v) => typeof v === 'string' && /^[A-Za-z0-9]{1,9}$/.test(v.trim());
      const cargos = Array.isArray(pedido?.cargos) ? pedido.cargos : null;
      if (!codigo(pedido?.empresa) || !codigo(pedido?.undnegocio) || !cargos || cargos.length > 300) {
        return respuesta(400, 'PEDIDO_INVALIDO', 'Faltan la empresa, la UEN o los cargos.');
      }
      const limpios = cargos.map((c) => ({
        nombre: String(c?.nombre ?? '').slice(0, 200),
        codigoNomina: Number.isInteger(c?.codigoNomina) && c.codigoNomina > 0 ? c.codigoNomina : null,
      }));
      const baseNomina = typeof pedido.baseNomina === 'string' && /^[A-Za-z0-9_]{1,64}$/.test(pedido.baseNomina.trim()) ? pedido.baseNomina.trim() : null;
      try {
        pool ??= crearPoolFn(configMySQL);
        const vista = await reintentarSiSeCayo(() => vistaDeNomina(pool, { empresa: pedido.empresa.trim(), undnegocio: pedido.undnegocio.trim(), cargos: limpios, baseNomina }));
        if (!vista.ok) return respuesta(422, 'SIN_NOMINA', vista.mensaje);
        return { estado: 200, cuerpo: vista };
      } catch (error) {
        if (!ERRORES_DE_CONEXION.has(error?.code)) throw error;
        console.error(JSON.stringify({ evento: 'bd-sin-conexion', codigo: error.code }));
        return respuesta(503, 'BD_NO_DISPONIBLE', 'No se pudo conectar con la base de datos de Contratos.');
      }
    },

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
