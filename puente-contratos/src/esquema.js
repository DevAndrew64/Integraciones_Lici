/**
 * Contrato de esquema: las tablas y columnas de Contratos que el puente usa, con su tipo real (`esquema-esperado.json`).
 * Antes de escribir se compara con lo que tiene el MySQL de verdad; si Contratos cambió una columna (tipo, largo, motor),
 * el puente NO escribe hasta que alguien lo revise. Así un cambio del otro lado nunca produce datos cortados o corridos.
 */
import { readFileSync } from 'node:fs';

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
    const opcionales = [t.modulo === undefined ? '' : `"modulo": ${t.modulo}, `, t.permisos === undefined ? '' : `"permisos": ${JSON.stringify(t.permisos)}, `].join('');
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
 * Columnas de más en la base NO son un problema: solo importa lo que el puente usa.
 * @returns {{tabla: string, columna?: string, problema: string}[]}
 */
export function compararEsquema(esperado, real) {
  const problemas = [];
  const reales = minusculas(real);
  for (const [tabla, t] of Object.entries(esperado.tablas)) {
    const r = reales[tabla.toLowerCase()];
    if (!r) {
      problemas.push({ tabla, problema: 'La tabla no existe.' });
      continue;
    }
    if (t.motor && r.motor && norm(t.motor) !== norm(r.motor)) {
      problemas.push({ tabla, problema: `Motor distinto: se esperaba ${t.motor} y es ${r.motor}.` });
    }
    const columnas = minusculas(r.columnas);
    for (const [columna, c] of Object.entries(t.columnas)) {
      const rc = columnas[columna.toLowerCase()];
      if (!rc) problemas.push({ tabla, columna, problema: 'La columna no existe.' });
      else if (norm(rc.tipo) !== norm(c.tipo)) problemas.push({ tabla, columna, problema: `Tipo distinto: se esperaba ${c.tipo} y es ${rc.tipo}.` });
      else if (rc.nulable !== c.nulable) problemas.push({ tabla, columna, problema: `Nulabilidad distinta: se esperaba ${c.nulable ? 'acepta NULL' : 'NOT NULL'}.` });
    }
  }
  return problemas;
}

/** Lee de `information_schema` cómo están hoy las tablas pedidas en la base a la que apunta la conexión. */
export async function leerEsquemaReal(pool, tablas) {
  const [columnas] = await pool.query(
    'SELECT TABLE_NAME AS tabla, COLUMN_NAME AS columna, COLUMN_TYPE AS tipo, IS_NULLABLE AS nulable FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?)',
    [tablas],
  );
  const [motores] = await pool.query('SELECT TABLE_NAME AS tabla, ENGINE AS motor FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?)', [tablas]);
  const real = {};
  for (const m of motores) real[m.tabla] = { motor: m.motor, columnas: {} };
  for (const c of columnas) {
    real[c.tabla] ??= { motor: null, columnas: {} };
    real[c.tabla].columnas[c.columna] = { tipo: c.tipo, nulable: String(c.nulable).toUpperCase() === 'YES' };
  }
  return real;
}

export async function verificarEsquema(pool, esperado = cargarEsquemaEsperado()) {
  const real = await leerEsquemaReal(pool, Object.keys(esperado.tablas));
  const problemas = compararEsquema(esperado, real);
  return { ok: problemas.length === 0, problemas };
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
