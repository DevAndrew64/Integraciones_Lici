/**
 * Compara `esquema-esperado.json` con el MySQL real y, con `--escribir`, lo actualiza con los tipos reales de las MISMAS
 * tablas y columnas. Úsese al conectar por primera vez y cada vez que Contratos cambie una tabla (después de revisarlo).
 *
 *   npm run esquema:actualizar              # solo muestra las diferencias
 *   npm run esquema:actualizar -- --escribir
 */
import { writeFileSync } from 'node:fs';
import { cargarEsquemaEsperado, compararEsquema, leerEsquemaReal, serializarEsquema } from '../esquema.js';
import { crearPool, leerConfigMySQL } from '../mysql.js';

const RUTA = new URL('../esquema-esperado.json', import.meta.url);
const config = leerConfigMySQL(process.env);
if (!config) {
  console.error('Define PUENTE_MYSQL_HOST, _USER, _PASSWORD y _DATABASE (ver .env.example).');
  process.exit(1);
}

const esperado = cargarEsquemaEsperado(RUTA);
const pool = crearPool(config);
try {
  const real = await leerEsquemaReal(pool, Object.keys(esperado.tablas));
  const problemas = compararEsquema(esperado, real);
  if (problemas.length === 0) console.log('El esquema real coincide con el esperado.');
  for (const p of problemas) console.log(`${p.tabla}${p.columna ? `.${p.columna}` : ''}: ${p.problema}`);

  if (process.argv.includes('--escribir')) {
    const sinTabla = problemas.filter((p) => p.problema.endsWith('no existe.'));
    if (sinTabla.length > 0) {
      console.error('No se escribe nada: faltan tablas o columnas en la base (revisar con Contratos).');
      process.exitCode = 1;
    } else {
      const porNombre = (objeto) => Object.fromEntries(Object.entries(objeto).map(([k, v]) => [k.toLowerCase(), v]));
      const reales = porNombre(real);
      for (const [tabla, t] of Object.entries(esperado.tablas)) {
        const r = reales[tabla.toLowerCase()];
        t.motor = r.motor ?? t.motor;
        const columnas = porNombre(r.columnas);
        for (const columna of Object.keys(t.columnas)) t.columnas[columna] = { tipo: columnas[columna.toLowerCase()].tipo, nulable: columnas[columna.toLowerCase()].nulable };
      }
      esperado.origen = `Leído del MySQL real el ${new Date().toISOString().slice(0, 10)}. Se regenera con: npm run esquema:actualizar -- --escribir`;
      writeFileSync(RUTA, serializarEsquema(esperado));
      console.log('esquema-esperado.json actualizado.');
    }
  }
} finally {
  await pool.end();
}
