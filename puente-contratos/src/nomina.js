/**
 * La nómina de la UEN, de donde sale el código de cada cargo que se escribe en Contratos. Contratos muestra el cargo de la
 * oferta buscando ese código en `<base de nómina>.cargos` (columna `codigo`), así que el código debe ser el de esa tabla.
 *
 * Lo usan el envío (`escritor-mysql.js`) y la vista previa de «Enviar a Contratos» (`motor.cargosNomina`), que solo lee y
 * funciona también en modo prueba: así quien envía ve antes qué cargo de nómina toma cada línea y elige el que falte.
 */
import { codigosDeNomina, cruceDeCargos, catalogoDeNomina } from './oferta.js';

const texto = (valor) => String(valor ?? '').trim();

/** Un nombre de base de datos que se puede poner en el SQL tal cual (viene de `gl_undnegocios` o de la lista fija, igual se valida). */
const NOMBRE_DE_BASE = /^[A-Za-z0-9_]{1,64}$/;
/** Sin permiso sobre la base o la tabla, o que no existen: se informa como dato a corregir, no como fallo interno. */
const ERRORES_DE_ACCESO = new Set([1044, 1049, 1142, 1143, 1146]);

/**
 * Bases de nómina por empresa confirmadas por Contratos (2026-10-19), en orden de preferencia: Tempocolba (02) usa
 * `nominatmb` (quincenal) y `nominatmb2` (mensual); Transcolba (03) usa `nominatr`. Aseocolba (01) sigue con
 * `gl_undnegocios`, que para ella está bien. Vigicolba está en otra base de datos y no se envía.
 */
export const NOMINAS_DE_EMPRESA = Object.freeze({ '02': ['nominatmb', 'nominatmb2'], '03': ['nominatr'] });

/** Todas las bases de nómina que el puente puede leer (para los permisos del usuario de MySQL). */
export const BASES_DE_NOMINA = Object.freeze(['nominabq', 'nominamn', 'nominatmb', 'nominatmb2', 'nominatr']);

/**
 * Las tablas `cargos` de la nómina de (empresa, UEN). Devuelve las bases leídas, en orden de preferencia, o el error.
 *
 * - Tempocolba y Transcolba usan las nóminas que confirmó Contratos (`NOMINAS_DE_EMPRESA`), no las de `gl_undnegocios`
 *   (allí Tempocolba tiene `NOMINATMB`/`nominatmbe` y Transcolba la base vacía).
 * - Las demás: la base sale de `gl_undnegocios.dbnomina` (`nominabq`, `nominamn`). Manda la fila de la empresa; si la empresa
 *   no tiene fila para la UEN, se usa la de la UEN en otra empresa.
 * - Con varias bases se leen todas las que existen con tabla `cargos`.
 */
export async function leerCargosDeNomina(conexion, empresa, undnegocio) {
  let bases = NOMINAS_DE_EMPRESA[texto(empresa)];
  if (!bases) {
    const [unidades] = await conexion.query('SELECT empresa, dbnomina FROM gl_undnegocios WHERE codigo = ?', [undnegocio]);
    const propias = unidades.filter((u) => texto(u.empresa) === texto(empresa));
    const elegidas = propias.length > 0 ? propias : unidades;
    bases = [...new Set(elegidas.map((u) => texto(u.dbnomina)).filter((b) => NOMBRE_DE_BASE.test(b)))];
  }
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

/** Cuántas líneas de cargo quedan sin código en una base. */
const pendientes = (cruce) => cruce.filter((d) => d.codigo === null).length;

/**
 * La base de nómina que se usa: la que eligió quien envía (`baseNomina`, si es una de las leídas); si no, la primera donde
 * están TODOS los cargos de la oferta; si ninguna los tiene todos, la que tiene más.
 */
function baseElegida(cargos, bases, contexto, baseNomina) {
  const pedida = baseNomina ? bases.find((b) => b.base.toLowerCase() === texto(baseNomina).toLowerCase()) : null;
  if (pedida) return pedida;
  const conCruce = bases.map((b) => ({ b, faltan: pendientes(cruceDeCargos(cargos, b.filas, { ...contexto, base: b.base })) }));
  return (conCruce.find((c) => c.faltan === 0) ?? conCruce.reduce((mejor, c) => (c.faltan < mejor.faltan ? c : mejor))).b;
}

/**
 * Para el envío: los códigos de nómina de los cargos en la base elegida, con sus errores y advertencias. Si hay varias bases,
 * avisa cuál se usó. Una `baseNomina` pedida que no existe es un error (no se cambia de base en silencio).
 */
export function elegirNomina(cargos, bases, contexto, baseNomina = null) {
  if (baseNomina && !bases.some((b) => b.base.toLowerCase() === texto(baseNomina).toLowerCase())) {
    return { codigos: cargos.map(() => null), advertencias: [], errores: [{ campo: 'oferta.baseNomina', mensaje: `La base de nómina «${baseNomina}» no es de la empresa ${contexto.empresa} y la UEN ${contexto.undnegocio} (son: ${bases.map((b) => b.base).join(', ')}). Vuelva a abrir «Enviar a Contratos».` }] };
  }
  const elegida = baseElegida(cargos, bases, contexto, baseNomina);
  const cruce = { base: elegida.base, ...codigosDeNomina(cargos, elegida.filas, { ...contexto, base: elegida.base }) };
  if (bases.length > 1 && cruce.errores.length === 0) {
    cruce.advertencias.push({
      campo: 'cargos',
      mensaje: `La UEN ${contexto.undnegocio} de la empresa ${contexto.empresa} tiene varias bases de nómina (${bases.map((b) => b.base).join(', ')}): los códigos de cargo se tomaron de ${cruce.base}.`,
    });
  }
  return cruce;
}

/**
 * Vista previa para la pantalla: cómo cruza cada línea de cargo con la nómina y el catálogo de cargos de la base, para que
 * quien envía elija el cargo de nómina de las líneas que no cruzan.
 *
 * @param {{empresa: string, undnegocio: string, cargos: {nombre: string, codigoNomina?: number | null}[], baseNomina?: string | null}} pedido
 */
export async function vistaDeNomina(conexion, { empresa, undnegocio, cargos, baseNomina = null }) {
  const nomina = await leerCargosDeNomina(conexion, empresa, undnegocio);
  if (nomina.error) return { ok: false, mensaje: nomina.error };
  const contexto = { empresa, undnegocio };
  const elegida = baseElegida(cargos, nomina.bases, contexto, baseNomina);
  const cruce = cruceDeCargos(cargos, elegida.filas, { ...contexto, base: elegida.base });
  const vistos = new Set();
  const catalogo = catalogoDeNomina(elegida.filas, contexto)
    .filter((f) => !vistos.has(f.codigo) && vistos.add(f.codigo))
    .map((f) => ({ codigo: f.codigo, nombre: f.nombre }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  return {
    ok: true,
    base: elegida.base,
    bases: nomina.bases.map((b) => b.base),
    cargos: cargos.map((c, i) => ({
      nombre: texto(c.nombre),
      estado: cruce[i].como,
      codigo: cruce[i].codigo,
      nombreNomina: cruce[i].nombreNomina,
      parecidos: cruce[i].parecidos,
    })),
    catalogo,
  };
}
