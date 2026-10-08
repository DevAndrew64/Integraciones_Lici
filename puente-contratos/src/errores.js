/**
 * Error con respuesta HTTP definida: algo que el usuario puede entender o corregir (un dato que Contratos no acepta, un
 * reenvío, un servicio ocupado). Todo lo demás es un fallo interno y se responde 500 sin detalles.
 */
export class ErrorNegocio extends Error {
  /**
   * @param {number} estado código HTTP
   * @param {string} codigo identificador estable para el cliente (p. ej. «YA_ENVIADA»)
   * @param {string} mensaje texto para el usuario (nunca incluye datos del cliente ni de la base)
   * @param {Record<string, unknown>} [extra] campos que se agregan a la respuesta (p. ej. `errores`, `oferta`)
   */
  constructor(estado, codigo, mensaje, extra = {}) {
    super(mensaje);
    this.name = 'ErrorNegocio';
    this.estado = estado;
    this.codigo = codigo;
    this.extra = extra;
  }
}
