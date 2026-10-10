import 'server-only';
import esquemaEsperado from '../../../puente-contratos/src/esquema-esperado.json';
import { crearMotor } from '../../../puente-contratos/src/motor.js';
import { enviarAlPuente, interpretarRespuesta, type PayloadContratosV1, type ResultadoPuente } from './cliente';

/**
 * Envío a Contratos desde LiciColba, sin servicio aparte: el servidor de LiciColba escribe directo en el MySQL de Contratos
 * de la intranet con el mismo código del puente (`puente-contratos/src`). Por eso funciona en cualquier equipo de la
 * intranet que corra LiciColba, sin Docker.
 *
 * Valores por defecto: la base de Contratos de la intranet (Bq-srvdatosgc, base `almacen`, usuario `puente`) en modo
 * escritura. Cada uno se puede cambiar en `.env.local`:
 *   CONTRATOS_MYSQL_HOST, CONTRATOS_MYSQL_PORT, CONTRATOS_MYSQL_USER, CONTRATOS_MYSQL_PASSWORD (vacía si el servidor solo
 *   restringe por IP), CONTRATOS_MYSQL_DATABASE y CONTRATOS_MODO (`escritura` o `dry-run`: valida sin escribir).
 * Si se define `PUENTE_CONTRATOS_URL`, se usa en cambio el servicio puente por HTTP (como antes).
 */
export const CONTRATOS_POR_DEFECTO = {
  host: 'Bq-srvdatosgc',
  port: 3306,
  user: 'puente',
  database: 'almacen',
  modo: 'escritura',
} as const;

type Entorno = Readonly<Record<string, string | undefined>>;
type Modo = 'dry-run' | 'escritura';

export interface ConfigContratos {
  modo: Modo;
  configMySQL: { host: string; port: number; user: string; password: string; database: string };
}

const valor = (entorno: Entorno, nombre: string, porDefecto: string) => entorno[nombre]?.trim() || porDefecto;

/** @throws {Error} si un valor no es válido (el mensaje no incluye la clave) */
export function leerConfigContratos(entorno: Entorno = process.env): ConfigContratos {
  const modo = valor(entorno, 'CONTRATOS_MODO', CONTRATOS_POR_DEFECTO.modo);
  if (modo !== 'dry-run' && modo !== 'escritura') throw new Error(`CONTRATOS_MODO debe ser «dry-run» o «escritura» (recibido: ${modo}).`);
  const port = Number(valor(entorno, 'CONTRATOS_MYSQL_PORT', String(CONTRATOS_POR_DEFECTO.port)));
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('CONTRATOS_MYSQL_PORT debe ser un puerto válido (1-65535).');
  return {
    modo,
    configMySQL: {
      host: valor(entorno, 'CONTRATOS_MYSQL_HOST', CONTRATOS_POR_DEFECTO.host),
      port,
      user: valor(entorno, 'CONTRATOS_MYSQL_USER', CONTRATOS_POR_DEFECTO.user),
      password: entorno.CONTRATOS_MYSQL_PASSWORD ?? '',
      database: valor(entorno, 'CONTRATOS_MYSQL_DATABASE', CONTRATOS_POR_DEFECTO.database),
    },
  };
}

type Motor = ReturnType<typeof crearMotor>;
// Un solo motor (y un solo pool de conexiones) por proceso; también sobrevive a las recargas de `next dev`.
const memoria = globalThis as typeof globalThis & { __motorContratos?: { clave: string; motor: Motor } };

function motorPara(config: ConfigContratos): Motor {
  const clave = JSON.stringify(config);
  if (memoria.__motorContratos?.clave !== clave) {
    memoria.__motorContratos = { clave, motor: crearMotor({ ...config, esquemaEsperado }) };
  }
  return memoria.__motorContratos.motor;
}

/** Envía la oferta a Contratos: directo a MySQL, o por el servicio puente si `PUENTE_CONTRATOS_URL` está definida. */
export async function enviarAContratos(payload: PayloadContratosV1, entorno: Entorno = process.env, motor?: Pick<Motor, 'enviar'>): Promise<ResultadoPuente> {
  if (entorno.PUENTE_CONTRATOS_URL?.trim()) return enviarAlPuente(payload, entorno);
  let config: ConfigContratos;
  try {
    config = leerConfigContratos(entorno);
  } catch (e) {
    return { ok: false, tipo: 'ERROR_PUENTE', mensaje: `La configuración de Contratos no es válida: ${(e as Error).message}` };
  }
  const { estado, cuerpo } = await (motor ?? motorPara(config)).enviar(payload);
  return interpretarRespuesta(estado, cuerpo);
}
