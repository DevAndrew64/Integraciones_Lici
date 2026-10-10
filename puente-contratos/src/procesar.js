import { ErrorNegocio } from './errores.js';
import { nitConDV } from './nit.js';
import { describirFila, noEscritoEnLaOferta, planDeOfertaAdjudicada, planDePreciosOferta } from './oferta.js';
import { huella as calcularHuella, validarContrato } from './validar.js';

/**
 * Escritor del modo «prueba»: no toca ninguna base de datos; devuelve lo que escribiría. El escritor MySQL tiene la misma
 * forma (`escribir(datos, {huella}) → resumen`).
 * El NIT se escribiría como Contratos lo guarda: «base-DV» (el dígito de verificación lo calcula el puente).
 * Lo que impediría escribir (p. ej. un A.I.U. en 0) sale como advertencia: en este modo nada se rechaza por eso.
 */
export const escritorPrueba = {
  async escribir(datos, { huella = '' } = {}) {
    const nitCompleto = nitConDV(datos.cliente.nit);
    const escribiria = { ...datos, cliente: { ...datos.cliente, nitCompleto } };
    const advertencias = [];
    if (datos.oferta && datos.tarifa) {
      const { errores, fila } = planDeOfertaAdjudicada(datos, { cliente: { nit: nitCompleto, rsocial: datos.cliente.razonSocial }, huella });
      if (fila) escribiria.ofertaAdjudicada = describirFila(fila);
      advertencias.push(...errores);
      const precios = planDePreciosOferta(datos);
      if (precios.filas.length > 0) escribiria.preciosOferta = precios.filas.map(describirFila);
      advertencias.push(...precios.errores, ...precios.advertencias);
    }
    return { escribiria, noEscrito: noEscritoEnLaOferta(datos), advertencias };
  },
};

/**
 * Procesa un envío del contrato v1 sin HTTP: lo usan el servicio Express (`app.js`) y LiciColba directamente (`motor.js`).
 * Devuelve el estado HTTP y el cuerpo de la respuesta. Un ErrorNegocio se convierte en su respuesta; cualquier otro error
 * se lanza (quien llama lo registra y responde 500 sin detalles).
 *
 * @param {unknown} cuerpo el JSON recibido
 * @param {{modo: 'dry-run' | 'escritura', escritor?: {escribir(datos: object, contexto: {huella: string}): Promise<object>} | null}} opciones
 * @returns {Promise<{estado: number, cuerpo: Record<string, unknown>}>}
 */
export async function procesarEnvio(cuerpo, { modo, escritor }) {
  const escritorActivo = escritor ?? (modo === 'dry-run' ? escritorPrueba : null);
  if (!escritorActivo) {
    return { estado: 501, cuerpo: { ok: false, error: 'MODO_NO_DISPONIBLE', mensaje: 'La escritura en MySQL no está habilitada en este servicio.' } };
  }
  // Para escribir, lo marcado `escribe` en el contrato (oferta, tarifa, A.I.U.) es obligatorio.
  const validacion = validarContrato(cuerpo, { paraEscribir: modo === 'escritura' });
  if (!validacion.ok) return { estado: 422, cuerpo: { ok: false, error: 'DATOS_INVALIDOS', errores: validacion.errores } };
  const huella = calcularHuella(validacion.datos);
  try {
    const { advertencias = [], ...resultado } = await escritorActivo.escribir(validacion.datos, { huella });
    return { estado: 200, cuerpo: { ok: true, modo, huella, advertencias: [...validacion.advertencias, ...advertencias], ...resultado } };
  } catch (e) {
    if (e instanceof ErrorNegocio) return { estado: e.estado, cuerpo: { ok: false, error: e.codigo, mensaje: e.message, ...e.extra } };
    throw e;
  }
}
