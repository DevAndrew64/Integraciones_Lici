/**
 * Escritor del puente en el MySQL de Contratos (adaptador de salida). Recibe el contrato v1 ya validado y escribe la oferta
 * adjudicada en `fc_ofertas_adjudicadas`, la tabla que existe en la base viva (sin crear ni cambiar nada), en este orden:
 *
 *   1. un candado por solicitud (GET_LOCK): dos envíos simultáneos de la misma solicitud no crean dos ofertas;
 *   2. el cliente debe existir en Contratos (se busca por NIT; razón social y NIT se toman de allí) y el contador de
 *      ofertas de (empresa, UEN) debe existir en `fc_control`;
 *   3. ¿ya se envió? (la marca `LICICOLBA:<solicitud>:` en `pc_add`): se responde 409 con la oferta existente;
 *   4. reserva del número de oferta con UN solo UPDATE atómico sobre `fc_control` (MyISAM: no se puede revertir; un
 *      número reservado y no usado se pierde, igual que en Visual FoxPro) y comprobación de que nadie lo usó;
 *   5. INSERT de UNA fila. Si el `id` no es auto_increment en esa base, se asigna MAX(id) + 1 en la misma transacción.
 *
 * Todas las sentencias llevan parámetros; los nombres de tabla y columna son constantes del código, nunca datos. Nada de
 * lo que se lee de `fc_control` es la fila completa: solo se cuenta y se actualiza `num_oferta` (la fila trae credenciales).
 */
import { ErrorNegocio } from './errores.js';
import { digitoVerificacion } from './nit.js';
import { AHORA, comparable, describirFila, marcaQueCabe, noEscritoEnLaOferta, patronDeSolicitud, planDeOfertaAdjudicada } from './oferta.js';

const TABLA_OFERTAS = 'fc_ofertas_adjudicadas';
const INTENTOS_NUMERO = 3;
const ESPERA_BLOQUEO_S = 10;

/** Errores de MySQL que significan «este valor no cabe o no es válido» (el modo estricto los convierte en error). */
const ERRORES_DE_DATO = new Set([1048, 1264, 1265, 1292, 1364, 1366, 1406]);
const ERRORES_DE_CONEXION = new Set(['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNRESET', 'PROTOCOL_CONNECTION_LOST', 'ER_CON_COUNT_ERROR']);

const texto = (valor) => String(valor ?? '').trim();

function traducirError(error) {
  if (error instanceof ErrorNegocio) return error;
  const perdido = error?.numeroPerdido ? { numeroPerdido: error.numeroPerdido } : {};
  if (ERRORES_DE_DATO.has(error?.errno)) {
    return new ErrorNegocio(422, 'DATOS_INVALIDOS', 'Contratos no aceptó uno de los valores.', {
      errores: [{ campo: '(Contratos)', mensaje: `La base de Contratos rechazó un valor (código ${error.errno}). No se guardó nada.` }],
      ...perdido,
    });
  }
  if (ERRORES_DE_CONEXION.has(error?.code)) return new ErrorNegocio(503, 'BD_NO_DISPONIBLE', 'No se pudo conectar con la base de datos de Contratos.', perdido);
  return error;
}

/**
 * Una conexión que responde: el servidor puede haber cerrado las del pool tras un rato sin uso (wait_timeout). Se comprueba
 * con un ping antes de empezar; la que no responde se descarta y se toma otra, así la primera oferta del día no falla.
 */
async function obtenerConexion(pool) {
  for (let intento = 0; intento < 2; intento++) {
    const conexion = await pool.getConnection();
    try {
      await conexion.ping();
      return conexion;
    } catch {
      conexion.destroy();
    }
  }
  return pool.getConnection();
}

function insertar(conexion, tabla, fila) {
  const columnas = Object.keys(fila);
  const marcas = columnas.map((c) => (fila[c] === AHORA ? AHORA.sql : '?'));
  const valores = columnas.filter((c) => fila[c] !== AHORA).map((c) => fila[c]);
  return conexion.query(`INSERT INTO ${tabla} (${columnas.join(', ')}) VALUES (${marcas.join(', ')})`, valores);
}

/** Cliente de Contratos por NIT (la base, sin dígito de verificación ni puntos). Prefiere el de la misma UEN y la sucursal 00. */
async function buscarCliente(conexion, nitBase, undnegocio) {
  const [filas] = await conexion.query(
    `SELECT nit, rsocial FROM fc_clientes
      WHERE REPLACE(REPLACE(SUBSTRING_INDEX(TRIM(nit), '-', 1), '.', ''), ' ', '') = ?
      ORDER BY (undnegocio = ?) DESC, (sucursal = '00') DESC, sucursal LIMIT 1`,
    [nitBase, undnegocio],
  );
  return filas.length === 0 ? null : { nit: texto(filas[0].nit), rsocial: texto(filas[0].rsocial) };
}

/** Filas del contador de (empresa, UEN): solo esas dos columnas, tal como están escritas en Contratos (la fila trae credenciales). */
async function leerContadores(conexion, empresa, undnegocio) {
  const [filas] = await conexion.query('SELECT empresa, undnegocio FROM fc_control WHERE empresa = ? AND undnegocio = ?', [empresa, undnegocio]);
  return filas.map((f) => ({ empresa: texto(f.empresa), undnegocio: texto(f.undnegocio) }));
}

/** Reserva el siguiente número de oferta de (empresa, UEN). El UPDATE es atómico: dos reservas simultáneas nunca reciben el mismo número. */
async function reservarNumero(conexion, empresa, undnegocio) {
  const saltados = [];
  for (let intento = 1; intento <= INTENTOS_NUMERO; intento++) {
    const [resultado] = await conexion.query(
      'UPDATE fc_control SET num_oferta = LAST_INSERT_ID(COALESCE(num_oferta, 0) + 1) WHERE empresa = ? AND undnegocio = ?',
      [empresa, undnegocio],
    );
    if (resultado.affectedRows !== 1) {
      throw new ErrorNegocio(409, 'CONTADOR_AMBIGUO', 'El contador de ofertas de esta empresa y UEN no es único en Contratos. Avise a Contratos.');
    }
    const [[fila]] = await conexion.query('SELECT LAST_INSERT_ID() AS numero');
    const numero = Number(fila.numero);
    const [[usos]] = await conexion.query(`SELECT COUNT(*) AS n FROM ${TABLA_OFERTAS} WHERE empresa = ? AND undnegocio = ? AND num_oferta = ?`, [empresa, undnegocio, numero]);
    if (Number(usos.n) === 0) return { numero, saltados };
    saltados.push(numero); // el contador iba por detrás de lo ya usado: se descarta y se toma el siguiente
  }
  throw new ErrorNegocio(409, 'NUMERO_OFERTA_EN_USO', 'El contador de ofertas de Contratos está desfasado: los números siguientes ya están en uso. Avise a Contratos.', { numerosEnUso: saltados });
}

/**
 * Contraste de lo que envió LiciColba con el cliente de Contratos. Se escribe SIEMPRE lo de Contratos (así la tarifa une
 * con el cliente igual que las ofertas digitadas a mano); lo que difiere se avisa, nunca se calla.
 */
function avisosDeCliente(datos, cliente) {
  const avisos = [];
  if (comparable(cliente.rsocial) !== comparable(datos.cliente.razonSocial)) {
    avisos.push({ campo: 'cliente.razonSocial', mensaje: 'La razón social de LiciColba no coincide con la del cliente en Contratos: se usó la de Contratos.' });
  }
  const guardado = /^\d+-(\d)$/.exec(cliente.nit);
  if (guardado && Number(guardado[1]) !== digitoVerificacion(datos.cliente.nit)) {
    avisos.push({ campo: 'cliente.nit', mensaje: 'El dígito de verificación del NIT en Contratos no coincide con el calculado: se usó el de Contratos.' });
  }
  return avisos;
}

/**
 * @param {import('mysql2/promise').Pool} pool
 * @param {{idManual?: boolean, largoUserAdd?: number | null, largoPcAdd?: number | null}} [opciones] según la base real
 *   (`opcionesDeEscritura` de esquema.js): si el id lo pone el puente y cuánto cabe en user_add / pc_add
 * @returns {{escribir(datos: object, contexto: {huella: string}): Promise<object>}}
 */
export function crearEscritorMySQL(pool, { idManual = false, largoUserAdd = null, largoPcAdd = null } = {}) {
  return {
    async escribir(datos, { huella }) {
      const solicitudId = datos.origen.solicitudId;
      const nombreBloqueo = `puente-contratos:solicitud:${solicitudId}`;
      let conexion;
      let conBloqueo = false;
      try {
        conexion = await obtenerConexion(pool);

        const [[bloqueo]] = await conexion.query('SELECT GET_LOCK(?, ?) AS ok', [nombreBloqueo, ESPERA_BLOQUEO_S]);
        if (Number(bloqueo.ok) !== 1) throw new ErrorNegocio(409, 'OCUPADO', 'Hay otro envío de esta solicitud en curso. Intente de nuevo en unos segundos.');
        conBloqueo = true;

        // ¿Ya se envió? Se responde con la oferta que existe; no se crea otra ni se gasta otro número.
        const [previas] = await conexion.query(`SELECT empresa, undnegocio, num_oferta, pc_add FROM ${TABLA_OFERTAS} WHERE pc_add LIKE ? ORDER BY id LIMIT 1`, [patronDeSolicitud(solicitudId)]);
        if (previas.length > 0) {
          const p = previas[0];
          throw new ErrorNegocio(409, 'YA_ENVIADA', 'Esta solicitud ya se envió a Contratos. Los cambios posteriores se hacen en Contratos.', {
            oferta: { empresa: texto(p.empresa), undnegocio: texto(p.undnegocio), numOferta: Number(p.num_oferta) },
            sinCambios: texto(p.pc_add) === marcaQueCabe(solicitudId, huella, largoPcAdd),
          });
        }

        // 2. Lo que debe existir en Contratos. Se juntan TODOS los problemas antes de reservar nada. La clave de la oferta
        //    (empresa, UEN) se escribe tal como está en Contratos, aunque llegue en minúsculas.
        const errores = [];
        const cliente = await buscarCliente(conexion, datos.cliente.nit, datos.oferta.undnegocio);
        if (!cliente) errores.push({ campo: 'cliente.nit', mensaje: `El cliente con NIT ${datos.cliente.nit} no existe en Contratos. Créelo en Contratos y vuelva a enviar.` });
        const contadores = await leerContadores(conexion, datos.oferta.empresa, datos.oferta.undnegocio);
        if (contadores.length > 1) throw new ErrorNegocio(409, 'CONTADOR_AMBIGUO', 'El contador de ofertas de esta empresa y UEN no es único en Contratos. Avise a Contratos.');
        if (contadores.length === 0) errores.push({ campo: 'oferta.undnegocio', mensaje: `Contratos no tiene contador de ofertas para la empresa ${datos.oferta.empresa} y la UEN ${datos.oferta.undnegocio}.` });
        const { empresa, undnegocio } = contadores[0] ?? datos.oferta;
        const datosDeContratos = { ...datos, oferta: { ...datos.oferta, empresa, undnegocio } };
        const contexto = { huella, largoUserAdd, largoPcAdd };
        const plan = planDeOfertaAdjudicada(datosDeContratos, { cliente: cliente ?? { nit: '', rsocial: '' }, ...contexto });
        errores.push(...plan.errores);
        if (errores.length > 0) throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'Contratos no puede recibir esta oferta.', { errores });
        const advertencias = avisosDeCliente(datos, cliente);

        // 4. Número de oferta y 5. escritura.
        const { numero: numOferta, saltados } = await reservarNumero(conexion, empresa, undnegocio);
        const { fila } = planDeOfertaAdjudicada(datosDeContratos, { cliente, numOferta, ...contexto });
        await conexion.beginTransaction();
        try {
          if (idManual) {
            const [[siguiente]] = await conexion.query(`SELECT COALESCE(MAX(id), 0) + 1 AS id FROM ${TABLA_OFERTAS} FOR UPDATE`);
            fila.id = Number(siguiente.id);
          }
          await insertar(conexion, TABLA_OFERTAS, fila);
          await conexion.commit();
        } catch (error) {
          await conexion.rollback().catch(() => {});
          error.numeroPerdido = numOferta;
          throw error;
        }

        return {
          advertencias,
          noEscrito: noEscritoEnLaOferta(datos),
          escrito: { empresa, undnegocio, numOferta, numerosSaltados: saltados, cliente, ofertaAdjudicada: describirFila(fila) },
        };
      } catch (error) {
        throw traducirError(error);
      } finally {
        if (conexion) {
          if (conBloqueo) await conexion.query('SELECT RELEASE_LOCK(?)', [nombreBloqueo]).catch(() => {});
          conexion.release();
        }
      }
    },
  };
}
