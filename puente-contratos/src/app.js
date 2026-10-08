import express from 'express';
import { timingSafeEqual } from 'node:crypto';
import { ErrorNegocio } from './errores.js';
import { nitConDV } from './nit.js';
import { describirFila, noEscritoEnLaOferta, planDeCargos, planDeTarifa } from './oferta.js';
import { huella as calcularHuella, validarContrato } from './validar.js';

/**
 * Escritor del modo «prueba»: no toca ninguna base de datos; devuelve lo que escribiría. El escritor MySQL tiene la misma
 * forma (`escribir(datos, {huella}) → resumen`) y no cambia nada más de este archivo.
 * El NIT se escribiría como Contratos lo guarda: «base-DV» (el dígito de verificación lo calcula el puente).
 * Lo que impediría escribir (p. ej. un A.I.U. en 0) sale como advertencia: en este modo nada se rechaza por eso.
 */
export const escritorPrueba = {
  async escribir(datos, { huella = '' } = {}) {
    const nitCompleto = nitConDV(datos.cliente.nit);
    const escribiria = { ...datos, cliente: { ...datos.cliente, nitCompleto } };
    const advertencias = [];
    if (datos.oferta && datos.tarifa) {
      const { errores, fila } = planDeTarifa(datos, { cliente: { nit: nitCompleto, rsocial: datos.cliente.razonSocial }, huella });
      if (fila) escribiria.tarifaInicial = describirFila(fila);
      advertencias.push(...errores);
      const cargos = planDeCargos(datos, { huella });
      if (cargos.filas.length > 0) escribiria.cargosIniciales = cargos.filas.map(describirFila);
      advertencias.push(...cargos.errores, ...cargos.advertencias);
    }
    return { escribiria, noEscrito: noEscritoEnLaOferta(datos), advertencias };
  },
};

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
      if (!escritorActivo) {
        return res.status(501).json({ ok: false, error: 'MODO_NO_DISPONIBLE', mensaje: 'La escritura en MySQL no está habilitada en este servicio.' });
      }
      // Para escribir, lo marcado `escribe` en el contrato (oferta, tarifa, A.I.U.) es obligatorio.
      const validacion = validarContrato(req.body, { paraEscribir: modo === 'escritura' });
      if (!validacion.ok) return res.status(422).json({ ok: false, error: 'DATOS_INVALIDOS', errores: validacion.errores });
      const huella = calcularHuella(validacion.datos);
      const { advertencias = [], ...resultado } = await escritorActivo.escribir(validacion.datos, { huella });
      return res.json({ ok: true, modo, huella, advertencias: [...validacion.advertencias, ...advertencias], ...resultado });
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
