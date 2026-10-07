import { crearApp } from './app.js';

const token = process.env.PUENTE_TOKEN ?? '';
if (token.length < 16) {
  console.error('PUENTE_TOKEN es obligatorio (mínimo 16 caracteres): el servicio no arranca sin autenticación.');
  process.exit(1);
}
const modo = process.env.PUENTE_MODO ?? 'dry-run';
if (modo !== 'dry-run' && modo !== 'escritura') {
  console.error(`PUENTE_MODO debe ser «dry-run» o «escritura» (recibido: ${modo}).`);
  process.exit(1);
}
const puerto = Number(process.env.PUENTE_PORT ?? 4010);
// Por defecto solo escucha en local; en Docker se usa 0.0.0.0 SIN publicar el puerto fuera de la red interna.
const host = process.env.PUENTE_HOST ?? '127.0.0.1';

crearApp({ token, modo }).listen(puerto, host, () => {
  console.log(JSON.stringify({ evento: 'puente-contratos-iniciado', host, puerto, modo }));
});
