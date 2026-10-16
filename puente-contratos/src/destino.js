/**
 * A dónde va la oferta en Contratos, leído de la base y no digitado: la empresa (por su nombre, el perfil de la solicitud
 * en LiciColba), las UEN donde esa empresa tiene contador de ofertas y los conceptos de facturación de cada UEN. Quien
 * envía solo elige la UEN (y el concepto, si la UEN tiene varios).
 */

const texto = (valor) => String(valor ?? '').trim();

/** «Aseo Colba S.A.S.» y «ASEOCOLBA» comparan igual: sin tildes, sin espacios ni signos, en mayúsculas. */
export function nombreComparable(nombre) {
  return texto(nombre)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

/** Formas societarias que no distinguen a una empresa del grupo de otra. */
const SUFIJOS = /(SAS|SA|LTDA|SCA|EU)$/;

/**
 * La empresa de Contratos cuyo nombre (`fc_empresas.rsocial`) corresponde al de LiciColba. Busca primero el nombre igual
 * (sin forma societaria) y si no, el que lo contiene. Si varios códigos distintos coinciden, no adivina.
 *
 * @param {{codigo: string, undnegocio: string, rsocial: string}[]} filas de `fc_empresas`
 * @param {string} nombre empresa en LiciColba (p. ej. ASEOCOLBA)
 * @returns {{codigo: string, rsocial: string} | {error: 'SIN_EMPRESA' | 'EMPRESA_AMBIGUA', candidatas: string[]}}
 */
export function empresaPorNombre(filas, nombre) {
  const buscado = nombreComparable(nombre).replace(SUFIJOS, '');
  if (!buscado) return { error: 'SIN_EMPRESA', candidatas: [] };
  const con = (prueba) => {
    const porCodigo = new Map();
    for (const f of filas) {
      const comparable = nombreComparable(f.rsocial).replace(SUFIJOS, '');
      if (texto(f.codigo) && prueba(comparable)) porCodigo.set(texto(f.codigo), texto(f.rsocial));
    }
    return porCodigo;
  };
  for (const porCodigo of [con((c) => c === buscado), con((c) => c.includes(buscado))]) {
    if (porCodigo.size === 1) {
      const [[codigo, rsocial]] = [...porCodigo];
      return { codigo, rsocial };
    }
    if (porCodigo.size > 1) return { error: 'EMPRESA_AMBIGUA', candidatas: [...porCodigo].map(([c, r]) => `${c} ${r}`) };
  }
  return { error: 'SIN_EMPRESA', candidatas: [] };
}

/**
 * Las UEN donde se puede crear la oferta (las que tienen contador en `fc_control`), cada una con sus conceptos de
 * facturación (`fc_conceptos`), en orden de código.
 */
export function uensDeEmpresa(empresa, { contadores, conceptos }) {
  const emp = texto(empresa).toUpperCase();
  const uens = [...new Set(contadores.filter((c) => texto(c.empresa).toUpperCase() === emp).map((c) => texto(c.undnegocio).toUpperCase()).filter(Boolean))].sort();
  return uens.map((uen) => ({
    codigo: uen,
    conceptos: conceptos
      .filter((c) => texto(c.empresa).toUpperCase() === emp && texto(c.undnegocio).toUpperCase() === uen && texto(c.codcpto))
      .map((c) => ({ codigo: texto(c.codcpto).toUpperCase(), descripcion: texto(c.descrip) || texto(c.nombre) }))
      .sort((a, b) => a.codigo.localeCompare(b.codigo)),
  }));
}

/**
 * Lee de Contratos el destino de una oferta de la empresa `nombreEmpresa`. Solo SELECT.
 * @returns {Promise<{empresa: {codigo: string, rsocial: string} | null, uens: {codigo: string, conceptos: {codigo: string, descripcion: string}[]}[], error?: string, candidatas?: string[]}>}
 */
export async function leerDestino(conexion, nombreEmpresa) {
  const [empresas] = await conexion.query('SELECT codigo, undnegocio, rsocial FROM fc_empresas');
  const empresa = empresaPorNombre(empresas, nombreEmpresa);
  if ('error' in empresa) return { empresa: null, uens: [], error: empresa.error, candidatas: empresa.candidatas };
  const [contadores] = await conexion.query('SELECT empresa, undnegocio FROM fc_control WHERE empresa = ?', [empresa.codigo]);
  const [conceptos] = await conexion.query('SELECT empresa, undnegocio, codcpto, descrip, nombre FROM fc_conceptos WHERE empresa = ?', [empresa.codigo]);
  return { empresa, uens: uensDeEmpresa(empresa.codigo, { contadores, conceptos }) };
}
