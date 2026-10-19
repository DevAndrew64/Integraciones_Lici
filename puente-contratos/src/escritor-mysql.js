/**
 * Escritor del puente en el MySQL de Contratos (adaptador de salida). Recibe el contrato v1 ya validado y escribe la oferta
 * como «Guardar oferta» de Contratos (tarifa y cargos) más la oferta adjudicada y su lista de precios, sin crear ni cambiar
 * nada de la estructura, en este orden:
 *
 *   1. un candado por solicitud (GET_LOCK): dos envíos simultáneos de la misma solicitud no crean dos ofertas;
 *   2. el cliente debe existir en Contratos (se busca por NIT; razón social y NIT se toman de allí), el contador de
 *      ofertas de (empresa, UEN) debe existir en `fc_control` y cada cargo debe existir en la nómina de la UEN
 *      (`<gl_undnegocios.dbnomina>.cargos`): su código de nómina es el que se escribe;
 *   3. ¿ya se envió? (la marca `LICICOLBA:<solicitud>:` en `pc_add`): se responde 409 con la oferta existente;
 *   4. reserva del número de oferta con UN solo UPDATE atómico sobre `fc_control` (MyISAM: no se puede revertir; un
 *      número reservado y no usado se pierde, igual que en Visual FoxPro) y comprobación de que nadie lo usó;
 *   5. En UNA transacción: la tarifa (`fc_contratos_tarifa_inicial`), sus cargos (`fc_contratos_cargos_iniciales`), la oferta
 *      adjudicada (`fc_ofertas_adjudicadas`), su lista de precios de insumos (`fc_preciosventas_oferta`), sus costos
 *      administrativos (`fc_contratos_costos_admtivos_iniciales`) y, al final, sus insumos (`fc_elemxcont`, MyISAM: si algo
 *      falla después, se borran las filas que alcanzó a escribir este envío). Las columnas de
 *      la tarifa y los cargos que esa base no tenga se omiten; si un `id` no es auto_increment, se asigna MAX(id) + 1.
 *
 * Todas las sentencias llevan parámetros; los nombres de tabla y columna son constantes del código, nunca datos. Nada de
 * lo que se lee de `fc_control` es la fila completa: solo se cuenta y se actualiza `num_oferta` (la fila trae credenciales).
 */
import { ErrorNegocio } from './errores.js';
import { digitoVerificacion } from './nit.js';
import {
  AHORA, codigosDeNomina, comparable, describirFila, marcaDeOrigen, marcaQueCabe, noEscritoEnLaOferta, noEscritoPorColumnasAusentes, patronDeSolicitud, planDeCargos,
  planDeCostosAdministrativos, planDeEquipos, dtiposDeEquipos, planDeInsumosOferta, planDeNoContinuos, planDeValoresAgregados, planDeOfertaAdjudicada, planDePreciosOferta, planDeTarifa, USUARIO_PUENTE,
} from './oferta.js';

const TABLA_TARIFA = 'fc_contratos_tarifa_inicial';
const TABLA_CARGOS = 'fc_contratos_cargos_iniciales';
const TABLA_OFERTAS = 'fc_ofertas_adjudicadas';
const TABLA_PRECIOS = 'fc_preciosventas_oferta';
const TABLA_COSTOS_ADMTIVOS = 'fc_contratos_costos_admtivos_iniciales';
/** MyISAM (no se revierte con ROLLBACK): se escribe al final y, si algo falla, se borran las filas propias. */
const TABLA_INSUMOS_OFERTA = 'fc_elemxcont';
const TABLA_EQUIPOS = 'fc_contratos_equipos_iniciales';
const TABLA_NO_CONTINUOS = 'fc_contratos_no_continuos_iniciales';
const TABLA_VALORES_AGREGADOS = 'fc_contratos_vlrs_agregs_iniciales';
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

/** INSERT con las columnas de la fila que existen en esta base (`omitir`); si el id no es auto_increment, MAX(id) + 1. */
async function insertar(conexion, tabla, fila, { omitir = [], idManual = false } = {}) {
  if (idManual) {
    const [[siguiente]] = await conexion.query(`SELECT COALESCE(MAX(id), 0) + 1 AS id FROM ${tabla} FOR UPDATE`);
    fila.id = Number(siguiente.id);
  }
  const fuera = new Set(omitir.map((c) => c.toLowerCase()));
  const columnas = Object.keys(fila).filter((c) => !fuera.has(c.toLowerCase()));
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

async function buscarConcepto(conexion, codServicio) {
  const [filas] = await conexion.query('SELECT empresa, undnegocio, codcpto FROM fc_conceptos WHERE codcpto = ?', [codServicio]);
  return filas.map((f) => ({ empresa: texto(f.empresa), undnegocio: texto(f.undnegocio), codcpto: texto(f.codcpto) }));
}

/** Los códigos de horario que existen en Contratos (el horario de cada cargo se crea allá antes de la oferta). */
async function buscarHorarios(conexion, codigos) {
  if (codigos.length === 0) return new Set();
  const [filas] = await conexion.query('SELECT codigo FROM fc_horarios WHERE codigo IN (?)', [codigos]);
  return new Set(filas.map((f) => texto(f.codigo).toUpperCase()));
}

/** Catálogo de conceptos de costos administrativos de Contratos (`id_cpto_costo`). */
async function leerConceptosCostosAdmtivos(conexion) {
  const [filas] = await conexion.query('SELECT id, descripcion FROM fc_conceptos_costos_admtivos');
  return filas.map((f) => ({ id: Number(f.id), descripcion: texto(f.descripcion) }));
}

/** Catálogo de activos de Contratos: el «Tipo» (`coddtipo`) de cada subtipo de la empresa, para la pestaña Equipos. */
const TABLA_SUBTIPOS_ACTIVO = 'act_subtipos';

/**
 * Filas de `act_subtipos` de la empresa para los grupos de los equipos de la oferta. Sin permiso o sin la tabla, la
 * pestaña Equipos va sin «Tipo» (se completa en Contratos) y se avisa: no detiene el envío.
 */
async function leerSubtiposDeActivo(conexion, empresa, grupos) {
  try {
    const [filas] = await conexion.query(
      `SELECT id, unidad_negocio_c AS uen, codtipo_c AS grupo, codstipo_c AS subtipo, coddtipo AS dtipo FROM ${TABLA_SUBTIPOS_ACTIVO} WHERE empresa_c = ? AND TRIM(codtipo_c) IN (?)`,
      [empresa, grupos],
    );
    return { filas };
  } catch (error) {
    if (!ERRORES_DE_ACCESO.has(error?.errno)) throw error;
    return { filas: [], aviso: `No se pudo leer ${TABLA_SUBTIPOS_ACTIVO} (código ${error.errno}): la pestaña Equipos va sin «Tipo».` };
  }
}

/** Borra los insumos que este envío alcanzó a escribir en `fc_elemxcont` (MyISAM): solo los suyos, por número y marca. */
async function borrarInsumosPropios(conexion, { empresa, undnegocio, numOferta, marca }) {
  await conexion.query(
    `DELETE FROM ${TABLA_INSUMOS_OFERTA} WHERE empresa = ? AND undnegocio = ? AND num_oferta = ? AND user_add = ? AND pc_add = ?`,
    [empresa, undnegocio, numOferta, USUARIO_PUENTE, marca],
  );
}

/** Un nombre de base de datos que se puede poner en el SQL tal cual (viene de `gl_undnegocios`, no del usuario, pero igual se valida). */
const NOMBRE_DE_BASE = /^[A-Za-z0-9_]{1,64}$/;
/** Sin permiso sobre la base o la tabla, o que no existen: se informa como dato a corregir, no como fallo interno. */
const ERRORES_DE_ACCESO = new Set([1044, 1049, 1142, 1146]);

/**
 * Bases de nómina por empresa confirmadas por Contratos (2026-10-19), en orden de preferencia: Tempocolba (02) usa
 * `nominatmb` (quincenal) y `nominatmb2` (mensual); Transcolba (03) usa `nominatr`. Aseocolba (01) sigue con
 * `gl_undnegocios`, que para ella está bien. Vigicolba está en otra base de datos y no se envía.
 */
const NOMINAS_DE_EMPRESA = Object.freeze({ '02': ['nominatmb', 'nominatmb2'], '03': ['nominatr'] });

/**
 * Las tablas `cargos` de la nómina de (empresa, UEN): la base sale de `gl_undnegocios.dbnomina` (p. ej. `nominabq`,
 * `nominamn`), en el mismo servidor de Contratos. Devuelve las bases leídas, en el orden de `gl_undnegocios`, o el error.
 *
 * - Tempocolba y Transcolba usan las nóminas que confirmó Contratos (`NOMINAS_DE_EMPRESA`), no las de `gl_undnegocios`
 *   (allí Tempocolba tiene `NOMINATMB`/`nominatmbe` y Transcolba la base vacía).
 * - Las demás: manda la fila de la empresa. Si la empresa no tiene fila para la UEN, se usa la de la UEN en otra empresa.
 * - Una fila de la empresa con `dbnomina` vacío (Transcolba en BAQ) es que esa UEN no tiene nómina: no se adivina otra.
 * - Con varias bases (Tempocolba en BAQ: `NOMINATMB` y `nominatmbe`, las dos existen) se leen todas las que existen con
 *   tabla `cargos`; quien llama usa la primera donde están todos los cargos de la oferta (`elegirNomina`).
 */
async function leerCargosDeNomina(conexion, empresa, undnegocio) {
  const [unidades] = await conexion.query('SELECT empresa, dbnomina FROM gl_undnegocios WHERE codigo = ?', [undnegocio]);
  const propias = unidades.filter((u) => texto(u.empresa) === texto(empresa));
  const elegidas = propias.length > 0 ? propias : unidades;
  let bases = NOMINAS_DE_EMPRESA[texto(empresa)] ?? [...new Set(elegidas.map((u) => texto(u.dbnomina)).filter((b) => NOMBRE_DE_BASE.test(b)))];
  const sinBase = `Contratos no tiene una base de nómina para la empresa ${empresa} y la UEN ${undnegocio} (gl_undnegocios.dbnomina)`;
  if (bases.length === 0) return { error: `${sinBase}. Avise a Contratos.` };
  if (bases.length > 1) {
    const [existentes] = await conexion.query(
      "SELECT TABLE_SCHEMA AS base FROM information_schema.TABLES WHERE TABLE_NAME = 'cargos' AND TABLE_SCHEMA IN (?)",
      [bases],
    );
    // Se compara sin mayúsculas (en Windows MySQL guarda los nombres en minúsculas) y se usa el nombre real de la base.
    const reales = existentes.map((e) => texto(e.base)).filter((b) => NOMBRE_DE_BASE.test(b));
    const enOrden = bases.flatMap((b) => reales.filter((r) => r.toLowerCase() === b.toLowerCase()).slice(0, 1));
    if (enOrden.length === 0) return { error: `${sinBase}: ninguna de ${bases.join(', ')} tiene tabla cargos visible para el usuario de la conexión. Avise a Contratos.` };
    bases = [...new Set(enOrden)];
  }
  const leidas = [];
  for (const base of bases) {
    try {
      const [filas] = await conexion.query(`SELECT * FROM \`${base}\`.cargos`);
      leidas.push({ base, filas });
    } catch (error) {
      if (!ERRORES_DE_ACCESO.has(error?.errno)) throw error;
      return { error: `No se pudo leer ${base}.cargos para tomar el código de nómina de los cargos (código ${error.errno}). El usuario de la conexión necesita permiso de lectura (SELECT) sobre ${base}.cargos.` };
    }
  }
  return { bases: leidas };
}

/**
 * De las bases de nómina leídas, la primera donde están TODOS los cargos de la oferta. Si ninguna los tiene todos, los errores
 * de la primera. Si hay varias bases, avisa cuál se usó.
 */
function elegirNomina(cargos, bases, contexto) {
  const cruces = bases.map((b) => ({ base: b.base, ...codigosDeNomina(cargos, b.filas, { ...contexto, base: b.base }) }));
  const elegido = cruces.find((c) => c.errores.length === 0) ?? cruces[0];
  if (bases.length > 1 && elegido.errores.length === 0) {
    elegido.advertencias.push({
      campo: 'cargos',
      mensaje: `La UEN ${contexto.undnegocio} de la empresa ${contexto.empresa} tiene varias bases de nómina (${bases.map((b) => b.base).join(', ')}): los códigos de cargo se tomaron de ${elegido.base}.`,
    });
  }
  return elegido;
}

/** Reserva el siguiente número de oferta de (empresa, UEN). El UPDATE es atómico: dos reservas simultáneas nunca reciben el mismo número. */
async function reservarNumero(conexion, empresa, undnegocio) {
  const saltados = [];
  // Las ofertas digitadas en Contratos no siempre mueven fc_control: si ya hay ofertas por encima del contador, se sigue
  // después de la mayor (si no, cada envío chocaría con números ya usados).
  const deLaUen = 'WHERE empresa = ? AND undnegocio = ?';
  const [[usado]] = await conexion.query(
    `SELECT GREATEST(COALESCE((SELECT MAX(num_oferta) FROM ${TABLA_TARIFA} ${deLaUen}), 0), COALESCE((SELECT MAX(num_oferta) FROM ${TABLA_OFERTAS} ${deLaUen}), 0), COALESCE((SELECT MAX(num_oferta) FROM ${TABLA_COSTOS_ADMTIVOS} ${deLaUen}), 0)) AS mayor`,
    [empresa, undnegocio, empresa, undnegocio, empresa, undnegocio],
  );
  const mayorUsado = Number(usado?.mayor ?? 0);
  for (let intento = 1; intento <= INTENTOS_NUMERO; intento++) {
    const [resultado] = await conexion.query(
      'UPDATE fc_control SET num_oferta = LAST_INSERT_ID(GREATEST(COALESCE(num_oferta, 0), ?) + 1) WHERE empresa = ? AND undnegocio = ?',
      [mayorUsado, empresa, undnegocio],
    );
    if (resultado.affectedRows !== 1) {
      throw new ErrorNegocio(409, 'CONTADOR_AMBIGUO', 'El contador de ofertas de esta empresa y UEN no es único en Contratos. Avise a Contratos.');
    }
    const [[fila]] = await conexion.query('SELECT LAST_INSERT_ID() AS numero');
    const numero = Number(fila.numero);
    const [[usos]] = await conexion.query(
      `SELECT (SELECT COUNT(*) FROM ${TABLA_TARIFA} WHERE empresa = ? AND undnegocio = ? AND num_oferta = ?) + (SELECT COUNT(*) FROM ${TABLA_OFERTAS} WHERE empresa = ? AND undnegocio = ? AND num_oferta = ?) AS n`,
      [empresa, undnegocio, numero, empresa, undnegocio, numero],
    );
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
 * @param {{idManual?: boolean, largoUserAdd?: number | null, largoPcAdd?: number | null, idManualPorTabla?: Record<string, boolean>, omitir?: Record<string, string[]>}} [opciones]
 *   según la base real (`opcionesDeEscritura` de esquema.js): quién pone cada id, cuánto cabe en user_add / pc_add de la oferta
 *   adjudicada y qué columnas de la tarifa y los cargos no existen en esta base
 * @returns {{escribir(datos: object, contexto: {huella: string}): Promise<object>}}
 */
export function crearEscritorMySQL(pool, { idManual = false, largoUserAdd = null, largoPcAdd = null, idManualPorTabla = {}, omitir = {}, tablasAusentes = [] } = {}) {
  const comoTarifa = { omitir: omitir[TABLA_TARIFA] ?? [], idManual: Boolean(idManualPorTabla[TABLA_TARIFA]) };
  const comoCargo = { omitir: omitir[TABLA_CARGOS] ?? [], idManual: Boolean(idManualPorTabla[TABLA_CARGOS]) };
  const comoCosto = { idManual: Boolean(idManualPorTabla[TABLA_COSTOS_ADMTIVOS]) };
  const comoInsumo = { idManual: Boolean(idManualPorTabla[TABLA_INSUMOS_OFERTA]) };
  const comoEquipo = { idManual: Boolean(idManualPorTabla[TABLA_EQUIPOS]) };
  const comoNoContinuo = { idManual: Boolean(idManualPorTabla[TABLA_NO_CONTINUOS]) };
  const comoValorAgregado = { idManual: Boolean(idManualPorTabla[TABLA_VALORES_AGREGADOS]) };
  const sinValoresAgregados = tablasAusentes.includes(TABLA_VALORES_AGREGADOS);
  const sinSubtiposDeActivo = tablasAusentes.includes(TABLA_SUBTIPOS_ACTIVO);
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

        // ¿Ya se envió? (la marca está en la tarifa y en la oferta adjudicada). Se responde con la oferta que existe; no se
        // crea otra ni se gasta otro número.
        const patron = patronDeSolicitud(solicitudId);
        const [previas] = await conexion.query(
          `SELECT empresa, undnegocio, num_oferta, pc_add FROM ${TABLA_TARIFA} WHERE pc_add LIKE ?
           UNION ALL SELECT empresa, undnegocio, num_oferta, pc_add FROM ${TABLA_OFERTAS} WHERE pc_add LIKE ? LIMIT 1`,
          [patron, patron],
        );
        if (previas.length > 0) {
          const p = previas[0];
          throw new ErrorNegocio(409, 'YA_ENVIADA', 'Esta solicitud ya se envió a Contratos. Los cambios posteriores se hacen en Contratos.', {
            oferta: { empresa: texto(p.empresa), undnegocio: texto(p.undnegocio), numOferta: Number(p.num_oferta) },
            sinCambios: [marcaDeOrigen(solicitudId, huella), marcaQueCabe(solicitudId, huella, largoPcAdd)].includes(texto(p.pc_add)),
          });
        }

        // 2. Lo que debe existir en Contratos. Se juntan TODOS los problemas antes de reservar nada. La clave de la oferta
        //    (empresa, UEN, concepto) se escribe tal como está en Contratos, aunque llegue en minúsculas.
        const errores = [];
        const advertencias = [];
        const cliente = await buscarCliente(conexion, datos.cliente.nit, datos.oferta.undnegocio);
        if (!cliente) errores.push({ campo: 'cliente.nit', mensaje: `El cliente con NIT ${datos.cliente.nit} no existe en Contratos. Créelo en Contratos y vuelva a enviar.` });
        const contadores = await leerContadores(conexion, datos.oferta.empresa, datos.oferta.undnegocio);
        if (contadores.length > 1) throw new ErrorNegocio(409, 'CONTADOR_AMBIGUO', 'El contador de ofertas de esta empresa y UEN no es único en Contratos. Avise a Contratos.');
        if (contadores.length === 0) errores.push({ campo: 'oferta.undnegocio', mensaje: `Contratos no tiene contador de ofertas para la empresa ${datos.oferta.empresa} y la UEN ${datos.oferta.undnegocio}.` });
        const { empresa, undnegocio } = contadores[0] ?? datos.oferta;
        const conceptos = await buscarConcepto(conexion, datos.oferta.codServicio);
        let codServicio = datos.oferta.codServicio;
        if (conceptos.length === 0) errores.push({ campo: 'oferta.codServicio', mensaje: `El concepto «${datos.oferta.codServicio}» no existe en Contratos.` });
        else {
          const delPar = conceptos.find((c) => c.empresa.toUpperCase() === empresa.toUpperCase() && c.undnegocio.toUpperCase() === undnegocio.toUpperCase());
          codServicio = (delPar ?? conceptos[0]).codcpto;
          if (!delPar) advertencias.push({ campo: 'oferta.codServicio', mensaje: `El concepto «${codServicio}» existe en Contratos, pero no para la empresa ${empresa} y la UEN ${undnegocio}.` });
        }
        const datosDeContratos = { ...datos, oferta: { ...datos.oferta, empresa, undnegocio, codServicio } };
        const clienteParaPlan = cliente ?? { nit: '', rsocial: '' };
        const contexto = { huella, largoUserAdd, largoPcAdd };

        errores.push(...planDeTarifa(datosDeContratos, { cliente: clienteParaPlan, huella }).errores);
        const cargos = datos.cargos ?? [];
        const horarios = await buscarHorarios(conexion, [...new Set(cargos.map((c) => c.codigoHorario).filter(Boolean))]);
        cargos.forEach((c, i) => {
          if (c.codigoHorario && !horarios.has(c.codigoHorario.toUpperCase())) {
            errores.push({ campo: `cargos[${i}].codigoHorario`, mensaje: `El horario «${c.codigoHorario}» no existe en Contratos. Créelo en Contratos y vuelva a enviar.` });
          }
        });
        let codigosNomina = null;
        if (cargos.length > 0) {
          const nomina = await leerCargosDeNomina(conexion, empresa, undnegocio);
          if (nomina.error) errores.push({ campo: 'cargos', mensaje: nomina.error });
          else {
            const cruce = elegirNomina(cargos, nomina.bases, { empresa, undnegocio });
            errores.push(...cruce.errores);
            advertencias.push(...cruce.advertencias);
            codigosNomina = cruce.codigos;
          }
        }
        const planCargos = planDeCargos(datosDeContratos, { huella, codigosNomina });
        errores.push(...planCargos.errores);
        errores.push(...planDeOfertaAdjudicada(datosDeContratos, { cliente: clienteParaPlan, ...contexto }).errores);
        const precios = planDePreciosOferta(datosDeContratos);
        errores.push(...precios.errores);
        const conceptosCostos = (datos.costosAdministrativos ?? []).length > 0 ? await leerConceptosCostosAdmtivos(conexion) : [];
        const planCostos = planDeCostosAdministrativos(datosDeContratos, { huella, catalogo: conceptosCostos });
        errores.push(...planCostos.errores);
        const planInsumos = planDeInsumosOferta(datosDeContratos, { huella, cliente: clienteParaPlan });
        errores.push(...planInsumos.errores);
        let dtipos = null;
        const gruposDeEquipos = [...new Set((datos.equipos ?? []).filter((e) => e.codigoGrupo && e.codigoSubtipo).flatMap((e) => { const g = String(e.codigoGrupo).trim(); return /^\d+$/.test(g) ? [g, g.padStart(3, '0')] : [g]; }))];
        if (gruposDeEquipos.length > 0 && !sinSubtiposDeActivo) {
          const subtipos = await leerSubtiposDeActivo(conexion, empresa, gruposDeEquipos);
          if (subtipos.aviso) advertencias.push({ campo: 'equipos', mensaje: subtipos.aviso });
          else dtipos = dtiposDeEquipos(subtipos.filas, undnegocio);
        }
        const planEquipos = planDeEquipos(datosDeContratos, { huella, cliente: clienteParaPlan, dtipos });
        const planNoContinuos = planDeNoContinuos(datosDeContratos, { huella, cliente: clienteParaPlan });
        const planValores = planDeValoresAgregados(datosDeContratos, { huella });
        errores.push(...planEquipos.errores, ...planNoContinuos.errores, ...planValores.errores);
        if (errores.length > 0) throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'Contratos no puede recibir esta oferta.', { errores });
        advertencias.push(
          ...planCargos.advertencias, ...precios.advertencias, ...planCostos.advertencias, ...planInsumos.advertencias,
          ...planEquipos.advertencias, ...planNoContinuos.advertencias, ...planValores.advertencias, ...avisosDeCliente(datos, cliente),
        );
        if (sinValoresAgregados && planValores.filas.length > 0) {
          advertencias.push({ campo: 'valoresAgregados', mensaje: `Esta base de Contratos no tiene la tabla ${TABLA_VALORES_AGREGADOS}: los valores agregados no se escribieron (sí van en el total de la tarifa).` });
        }

        // 4. Número de oferta y 5. escritura (todo o nada).
        const { numero: numOferta, saltados } = await reservarNumero(conexion, empresa, undnegocio);
        const { fila: filaTarifa } = planDeTarifa(datosDeContratos, { cliente, numOferta, huella });
        const { filas: filasDeCargos } = planDeCargos(datosDeContratos, { numOferta, huella, codigosNomina });
        const { fila } = planDeOfertaAdjudicada(datosDeContratos, { cliente, numOferta, ...contexto });
        const { filas: filasDePrecios } = planDePreciosOferta(datosDeContratos, { numOferta });
        const { filas: filasDeCostos } = planDeCostosAdministrativos(datosDeContratos, { numOferta, huella, cliente, catalogo: conceptosCostos });
        const { filas: filasDeInsumos } = planDeInsumosOferta(datosDeContratos, { numOferta, huella, cliente });
        const { filas: filasDeEquipos } = planDeEquipos(datosDeContratos, { numOferta, huella, cliente, dtipos });
        const { filas: filasDeNoContinuos } = planDeNoContinuos(datosDeContratos, { numOferta, huella, cliente });
        const filasDeValores = sinValoresAgregados ? [] : planDeValoresAgregados(datosDeContratos, { numOferta, huella }).filas;
        let insumosEscritos = false;
        await conexion.beginTransaction();
        try {
          await insertar(conexion, TABLA_TARIFA, filaTarifa, comoTarifa);
          for (const filaDeCargo of filasDeCargos) await insertar(conexion, TABLA_CARGOS, filaDeCargo, comoCargo);
          await insertar(conexion, TABLA_OFERTAS, fila, { idManual });
          for (const filaDePrecio of filasDePrecios) await insertar(conexion, TABLA_PRECIOS, filaDePrecio);
          for (const filaDeCosto of filasDeCostos) await insertar(conexion, TABLA_COSTOS_ADMTIVOS, filaDeCosto, comoCosto);
          for (const filaDeEquipo of filasDeEquipos) await insertar(conexion, TABLA_EQUIPOS, filaDeEquipo, comoEquipo);
          for (const filaDeServicio of filasDeNoContinuos) await insertar(conexion, TABLA_NO_CONTINUOS, filaDeServicio, comoNoContinuo);
          for (const filaDeValor of filasDeValores) await insertar(conexion, TABLA_VALORES_AGREGADOS, filaDeValor, comoValorAgregado);
          // Lo último antes del COMMIT: fc_elemxcont es MyISAM y cada fila queda escrita al insertarla.
          insumosEscritos = filasDeInsumos.length > 0;
          for (const filaDeInsumo of filasDeInsumos) await insertar(conexion, TABLA_INSUMOS_OFERTA, filaDeInsumo, comoInsumo);
          await conexion.commit();
        } catch (error) {
          await conexion.rollback().catch(() => {});
          if (insumosEscritos) {
            await borrarInsumosPropios(conexion, { empresa, undnegocio, numOferta, marca: filasDeInsumos[0].pc_add }).catch((e) => {
              console.error(JSON.stringify({ evento: 'insumos-sin-compensar', numOferta, codigo: e?.code ?? null }));
            });
          }
          error.numeroPerdido = numOferta;
          throw error;
        }

        return {
          advertencias,
          noEscrito: [...noEscritoEnLaOferta(datos), ...noEscritoPorColumnasAusentes(datos, omitir)],
          escrito: {
            empresa,
            undnegocio,
            numOferta,
            numerosSaltados: saltados,
            cliente,
            tarifa: describirFila(filaTarifa),
            cargos: filasDeCargos.map((f) => ({ item: f.item, cargo: f.cargo, nombre: f.nom_cargo, cantidad: f.cantidad })),
            ofertaAdjudicada: describirFila(fila),
            preciosOferta: filasDePrecios.map((f) => ({ codigo: f.codigo, vr_costo: f.vr_costo, valor: f.valor })),
            costosAdministrativos: filasDeCostos.map((f) => ({ id_cpto_costo: f.id_cpto_costo, valor: f.valor })),
            insumosOferta: filasDeInsumos.map((f) => ({ codele: f.codele, cantidad: f.cantidad, frecuencia: f.frecuencia, vlr_unitario: f.vlr_unitario })),
            equipos: filasDeEquipos.map((f) => ({ descrip_equipo: f.descrip_equipo, tipo_equipo: f.tipo_equipo, dtipo_equipo: f.dtipo_equipo, subtipo_equipo: f.subtipo_equipo, cantidad: f.cantidad, valor: f.valor, frecuencia: f.frecuencia })),
            serviciosNoContinuos: filasDeNoContinuos.map((f) => ({ actividad: f.actividad, frecuencia: f.frecuencia, valor: f.valor, vlr_mes: f.vlr_mes })),
            valoresAgregados: filasDeValores.map((f) => ({ tipo: f.tipo, valor: f.valor, frec_reinv: f.frec_reinv })),
            ...(Object.keys(omitir).length > 0 ? { columnasOmitidas: omitir } : {}),
          },
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
