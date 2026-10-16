/**
 * Contrato de esquema: las tablas y columnas de Contratos que el puente usa, con su tipo real (`esquema-esperado.json`).
 * Antes de escribir se compara con lo que tiene el MySQL de verdad; si Contratos cambió una columna (tipo, largo, motor),
 * el puente NO escribe hasta que alguien lo revise. Así un cambio del otro lado nunca produce datos cortados o corridos.
 */
import { readFileSync } from 'node:fs';
import { TABLAS_ADAPTABLES } from './oferta.js';

export function cargarEsquemaEsperado(ruta = new URL('./esquema-esperado.json', import.meta.url)) {
  return JSON.parse(readFileSync(ruta, 'utf8'));
}

/** JSON del esquema con UNA columna por línea: el archivo se revisa y se compara (git diff) sin ruido. */
export function serializarEsquema(esquema) {
  const tablas = Object.entries(esquema.tablas).map(([nombre, t], i, todas) => {
    const columnas = Object.entries(t.columnas).map(
      ([c, v], j, cols) => `   ${JSON.stringify(c)}: {"tipo": ${JSON.stringify(v.tipo)}, "nulable": ${v.nulable}}${j < cols.length - 1 ? ',' : ''}`,
    );
    // `modulo` (módulo del plan que usa la tabla) y `permisos` (cláusulas de GRANT que se apartan de lo habitual) son opcionales.
    // `opcional` (la tabla puede no existir en la base: si falta, el puente no la escribe y lo avisa).
    const opcionales = [
      t.modulo === undefined ? '' : `"modulo": ${t.modulo}, `,
      t.opcional === undefined ? '' : `"opcional": ${t.opcional}, `,
      t.permisos === undefined ? '' : `"permisos": ${JSON.stringify(t.permisos)}, `,
    ].join('');
    const cabecera = `  ${JSON.stringify(nombre)}: {"motor": ${JSON.stringify(t.motor)}, "uso": ${JSON.stringify(t.uso)}, ${opcionales}"columnas": {`;
    return [cabecera, ...columnas, `  }}${i < todas.length - 1 ? ',' : ''}`].join('\n');
  });
  return `{\n "version": ${esquema.version},\n "origen": ${JSON.stringify(esquema.origen)},\n "tablas": {\n${tablas.join('\n')}\n }\n}\n`;
}

/**
 * Solo las tablas que usan los módulos ya implementados (`modulo` ≤ `hastaModulo`). Las que no declaran módulo no se
 * usan todavía. Es lo que el servicio exige y verifica: con un usuario de MySQL de permisos mínimos, las tablas de
 * módulos futuros ni siquiera son visibles.
 */
export function esquemaHastaModulo(esquema, hastaModulo) {
  const tablas = Object.fromEntries(Object.entries(esquema.tablas).filter(([, t]) => t.modulo !== undefined && t.modulo <= hastaModulo));
  return { ...esquema, tablas };
}

const norm = (texto) => String(texto).toLowerCase().replace(/\s+/g, ' ').trim();
const minusculas = (objeto) => Object.fromEntries(Object.entries(objeto).map(([k, v]) => [k.toLowerCase(), v]));

/**
 * Compara el esquema real con el esperado (función pura, sin base de datos). Los nombres no distinguen mayúsculas.
 * Columnas de más en la base NO son un problema, salvo en una tabla de escritura una columna OBLIGATORIA (NOT NULL, sin
 * valor por defecto ni auto_increment) que el puente no llena: el INSERT fallaría. El `id` lo pone la base
 * (auto_increment) o el puente (MAX(id) + 1 en la misma transacción).
 * Un `tipo` null en el contrato = tipo no verificado (columna conocida solo por nombre); un `nulable` null, igual.
 * En las TABLAS_ADAPTABLES (tarifa y cargos) solo es problema que falte una columna esencial: las demás que falten se
 * omiten al escribir, y un tipo o nulabilidad distintos no detienen nada (el modo estricto rechaza lo que no quepa).
 * @returns {{tabla: string, columna?: string, problema: string}[]}
 */
export function compararEsquema(esperado, real) {
  const problemas = [];
  const reales = minusculas(real);
  for (const [tabla, t] of Object.entries(esperado.tablas)) {
    const r = reales[tabla.toLowerCase()];
    if (!r) {
      if (!t.opcional) problemas.push({ tabla, problema: 'La tabla no existe.' });
      continue;
    }
    if (t.motor && r.motor && norm(t.motor) !== norm(r.motor)) {
      problemas.push({ tabla, problema: `Motor distinto: se esperaba ${t.motor} y es ${r.motor}.` });
    }
    const columnas = minusculas(r.columnas);
    const adaptable = TABLAS_ADAPTABLES[tabla];
    for (const [columna, c] of Object.entries(t.columnas)) {
      const rc = columnas[columna.toLowerCase()];
      if (adaptable) {
        if (!rc && adaptable.esenciales.includes(columna)) problemas.push({ tabla, columna, problema: 'La columna no existe (es esencial para escribir).' });
        continue;
      }
      if (!rc) problemas.push({ tabla, columna, problema: 'La columna no existe.' });
      else if (c.tipo !== null && norm(rc.tipo) !== norm(c.tipo)) problemas.push({ tabla, columna, problema: `Tipo distinto: se esperaba ${c.tipo} y es ${rc.tipo}.` });
      else if (c.nulable !== null && rc.nulable !== c.nulable) problemas.push({ tabla, columna, problema: `Nulabilidad distinta: se esperaba ${c.nulable ? 'acepta NULL' : 'NOT NULL'}.` });
    }
    if (t.uso === 'escritura') {
      const llenadas = new Set([...(adaptable ? adaptable.escritas : Object.keys(t.columnas)), 'id'].map((c) => c.toLowerCase()));
      for (const [columna, rc] of Object.entries(r.columnas)) {
        if (rc.obligatoria && !llenadas.has(columna.toLowerCase())) {
          problemas.push({ tabla, columna, problema: 'Columna obligatoria (NOT NULL, sin valor por defecto) que el puente no llena.' });
        }
      }
    }
  }
  return problemas;
}

/** Lee de `information_schema` cómo están hoy las tablas pedidas en la base a la que apunta la conexión. */
export async function leerEsquemaReal(pool, tablas) {
  const [columnas] = await pool.query(
    'SELECT TABLE_NAME AS tabla, COLUMN_NAME AS columna, COLUMN_TYPE AS tipo, IS_NULLABLE AS nulable, COLUMN_DEFAULT AS pordefecto, EXTRA AS extra FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?)',
    [tablas],
  );
  const [motores] = await pool.query('SELECT TABLE_NAME AS tabla, ENGINE AS motor FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?)', [tablas]);
  const real = {};
  for (const m of motores) real[m.tabla] = { motor: m.motor, columnas: {} };
  for (const c of columnas) {
    real[c.tabla] ??= { motor: null, columnas: {} };
    const nulable = String(c.nulable).toUpperCase() === 'YES';
    const autoIncremento = /auto_increment/i.test(String(c.extra ?? ''));
    const obligatoria = !nulable && c.pordefecto === null && !autoIncremento;
    real[c.tabla].columnas[c.columna] = { tipo: c.tipo, nulable, ...(obligatoria ? { obligatoria } : {}), ...(autoIncremento ? { autoIncremento } : {}) };
  }
  return real;
}

/** `real` = la estructura leída (el arranque la usa para adaptar la escritura: auto_increment del id, largos). */
export async function verificarEsquema(pool, esperado = cargarEsquemaEsperado()) {
  const real = await leerEsquemaReal(pool, Object.keys(esperado.tablas));
  const problemas = compararEsquema(esperado, real);
  return { ok: problemas.length === 0, problemas, real };
}

/** Largo de una columna (var)char según su tipo real, o null si no se conoce. */
export function largoDeColumna(real, tabla, columna) {
  const c = Object.entries(real?.[tabla]?.columnas ?? {}).find(([n]) => n.toLowerCase() === columna)?.[1];
  const m = /^(?:var)?char\((\d+)\)$/i.exec(String(c?.tipo ?? ''));
  return m ? Number(m[1]) : null;
}

/** Otras tablas donde el puente inserta filas y cuyo id puede no ser auto_increment. */
const TABLAS_CON_ID = ['fc_contratos_costos_admtivos_iniciales', 'fc_elemxcont', 'fc_contratos_equipos_iniciales', 'fc_contratos_no_continuos_iniciales', 'fc_contratos_vlrs_agregs_iniciales'];
/** Tablas que pueden no existir en la base (`opcional` en el contrato): si faltan, el puente no las escribe. */
const TABLAS_OPCIONALES = ['fc_contratos_vlrs_agregs_iniciales', 'act_subtipos'];

const columnaReal = (real, tabla, columna) => Object.entries(real?.[tabla]?.columnas ?? {}).find(([n]) => n.toLowerCase() === columna)?.[1];
const idManualDe = (real, tabla) => {
  const id = columnaReal(real, tabla, 'id');
  return Boolean(id) && !id.autoIncremento;
};

/**
 * Cómo escribir según la base real: quién pone el id de cada tabla, cuánto cabe en user_add/pc_add de la oferta adjudicada y
 * qué columnas de la tarifa y los cargos no existen en esta base (se omiten).
 */
export function opcionesDeEscritura(real) {
  const tabla = 'fc_ofertas_adjudicadas';
  const omitir = {};
  for (const [nombre, t] of Object.entries(TABLAS_ADAPTABLES)) {
    if (!real?.[nombre]) continue;
    const faltan = t.escritas.filter((c) => !columnaReal(real, nombre, c.toLowerCase()));
    if (faltan.length > 0) omitir[nombre] = faltan;
  }
  return {
    idManual: idManualDe(real, tabla),
    largoUserAdd: largoDeColumna(real, tabla, 'user_add'),
    largoPcAdd: largoDeColumna(real, tabla, 'pc_add'),
    idManualPorTabla: Object.fromEntries([...Object.keys(TABLAS_ADAPTABLES), ...TABLAS_CON_ID].map((n) => [n, idManualDe(real, n)])),
    omitir,
    tablasAusentes: TABLAS_OPCIONALES.filter((n) => !Object.keys(real ?? {}).some((r) => r.toLowerCase() === n)),
  };
}

/**
 * Estado de la base para `/health` (público): solo una palabra, sin tablas ni mensajes. Se recuerda `ttlMs` para que
 * un monitor que consulta cada pocos segundos no recargue a MySQL.
 * @returns {() => Promise<{estado: 'ok' | 'esquema_distinto' | 'sin_conexion'}>}
 */
export function crearEstadoBD(pool, esperado = cargarEsquemaEsperado(), ttlMs = 30_000) {
  let memoria = { hasta: 0, valor: { estado: 'sin_conexion' } };
  let enCurso = null; // varias consultas simultáneas a /health comparten UNA sola verificación

  async function verificar() {
    let valor;
    try {
      const { ok, problemas } = await verificarEsquema(pool, esperado);
      valor = { estado: ok ? 'ok' : 'esquema_distinto' };
      if (!ok) console.error(JSON.stringify({ evento: 'esquema-distinto', cantidad: problemas.length, primeros: problemas.slice(0, 5) }));
    } catch (error) {
      valor = { estado: 'sin_conexion' };
      console.error(JSON.stringify({ evento: 'bd-sin-conexion', codigo: error?.code ?? 'DESCONOCIDO' }));
    }
    memoria = { hasta: Date.now() + ttlMs, valor };
    return valor;
  }

  return async function estadoBD() {
    if (Date.now() < memoria.hasta) return memoria.valor;
    enCurso ??= verificar().finally(() => {
      enCurso = null;
    });
    return enCurso;
  };
}
