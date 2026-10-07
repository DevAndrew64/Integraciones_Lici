import express from 'express';
import { timingSafeEqual } from 'node:crypto';
import { huella, validarContrato } from './validar.js';

/**
 * Escritor del módulo 1 («prueba»): no toca ninguna base de datos; devuelve lo que escribiría. El módulo MySQL aporta un
 * escritor con la misma forma (`escribir(datos) → resumen`) y no cambia nada más de este archivo.
 */
export const escritorPrueba = {
  async escribir(datos) {
    return { escribiria: datos };
  },
};

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
 * @param {{token: string, modo?: 'dry-run' | 'escritura', escritor?: {escribir(datos: object): Promise<object>}}} opciones
 */
export function crearApp({ token, modo = 'dry-run', escritor = escritorPrueba }) {
  const app = express();
  app.disable('x-powered-by');

  // Registro mínimo por petición: sin cuerpo ni datos del cliente.
  app.use((req, res, next) => {
    const inicio = Date.now();
    res.on('finish', () => console.log(JSON.stringify({ evento: 'peticion', metodo: req.method, ruta: req.path, estado: res.statusCode, ms: Date.now() - inicio })));
    next();
  });

  app.get('/health', (_req, res) => res.json({ ok: true, servicio: 'puente-contratos', modo }));

  app.use(autenticar(token));
  app.use(express.json({ limit: '256kb' }));

  app.post('/contratos', async (req, res, next) => {
    try {
      const validacion = validarContrato(req.body);
      if (!validacion.ok) return res.status(422).json({ ok: false, error: 'DATOS_INVALIDOS', errores: validacion.errores });
      if (modo !== 'dry-run') {
        return res.status(501).json({ ok: false, error: 'MODO_NO_DISPONIBLE', mensaje: 'La escritura en MySQL aún no está habilitada en este servicio.' });
      }
      const resultado = await escritor.escribir(validacion.datos);
      return res.json({ ok: true, modo, huella: huella(validacion.datos), advertencias: validacion.advertencias, ...resultado });
    } catch (e) {
      return next(e);
    }
  });

  // Express identifica un manejador de errores por sus 4 parámetros: `_next` debe existir aunque no se use.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err, _req, res, _next) => {
    const cuerpoInvalido = err.type === 'entity.parse.failed' || err.type === 'entity.too.large';
    if (!cuerpoInvalido) console.error(JSON.stringify({ evento: 'error', mensaje: String(err?.message ?? err).slice(0, 200) }));
    res.status(cuerpoInvalido ? 400 : 500).json({ ok: false, error: cuerpoInvalido ? 'JSON_INVALIDO' : 'ERROR_INTERNO' });
  });

  return app;
}
