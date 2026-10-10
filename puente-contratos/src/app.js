import express from 'express';
import { timingSafeEqual } from 'node:crypto';
import { ErrorNegocio } from './errores.js';
import { escritorPrueba, procesarEnvio } from './procesar.js';

export { escritorPrueba };

const SIN_BD = async () => ({ estado: 'sin_configurar' });

function autenticar(token) {
  const esperado = Buffer.from(token);
  return (req, res, next) => {
    const recibido = Buffer.from((req.get('authorization') ?? '').replace(/^Bearer /i, ''));
    if (recibido.length === esperado.length && timingSafeEqual(recibido, esperado)) return next();
    res.status(401).json({ ok: false, error: 'NO_AUTORIZADO' });
  };
}

/**
 * Servicio puente LiciColba → Contratos. LiciColba (Next.js) envía un JSON estructurado; el puente lo valida y lo
 * entrega al escritor. Corre SOLO dentro de la red interna y exige un token compartido.
 *
 * En modo `escritura` hace falta un escritor (el de MySQL); sin él se responde 501: el modo nunca simula una escritura.
 *
 * @param {{token: string, modo?: 'dry-run' | 'escritura', escritor?: {escribir(datos: object, contexto: {huella: string}): Promise<object>}, estadoBD?: () => Promise<{estado: string}>}} opciones
 */
export function crearApp({ token, modo = 'dry-run', escritor, estadoBD = SIN_BD }) {
  const escritorActivo = escritor ?? (modo === 'dry-run' ? escritorPrueba : null);
  const app = express();
  app.disable('x-powered-by');

  // Registro mínimo por petición: sin cuerpo ni datos del cliente.
  app.use((req, res, next) => {
    const inicio = Date.now();
    res.on('finish', () => console.log(JSON.stringify({ evento: 'peticion', metodo: req.method, ruta: req.path, estado: res.statusCode, ms: Date.now() - inicio })));
    next();
  });

  // Público: solo el estado de la base en una palabra (sin_configurar | ok | esquema_distinto | sin_conexion).
  app.get('/health', async (_req, res, next) => {
    try {
      res.json({ ok: true, servicio: 'puente-contratos', modo, bd: (await estadoBD()).estado });
    } catch (e) {
      next(e);
    }
  });

  app.use(autenticar(token));
  app.use(express.json({ limit: '256kb' }));

  app.post('/contratos', async (req, res, next) => {
    try {
      const { estado, cuerpo } = await procesarEnvio(req.body, { modo, escritor: escritorActivo });
      return res.status(estado).json(cuerpo);
    } catch (e) {
      return next(e);
    }
  });

  // Express identifica un manejador de errores por sus 4 parámetros: `_next` debe existir aunque no se use.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof ErrorNegocio) return res.status(err.estado).json({ ok: false, error: err.codigo, mensaje: err.message, ...err.extra });
    const cuerpoInvalido = err.type === 'entity.parse.failed' || err.type === 'entity.too.large';
    // Sin el mensaje de MySQL (`sqlMessage`): puede traer un trozo del dato rechazado y los registros no llevan datos del cliente.
    if (!cuerpoInvalido) console.error(JSON.stringify({ evento: 'error', codigo: err?.code, errno: err?.errno, mensaje: err?.sqlMessage ? undefined : String(err?.message ?? err).slice(0, 200) }));
    res.status(cuerpoInvalido ? 400 : 500).json({ ok: false, error: cuerpoInvalido ? 'JSON_INVALIDO' : 'ERROR_INTERNO' });
  });

  return app;
}
