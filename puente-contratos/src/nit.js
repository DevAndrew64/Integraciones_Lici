/**
 * NIT colombiano. Contratos guarda el NIT como «base-DV» (p. ej. 900123456-8): así está el 97 % de los contratos y de las
 * tarifas de la copia de producción. LiciColba envía solo la base; el dígito de verificación (DV) lo calcula el puente con
 * el módulo 11 de la DIAN, así que no hay forma de que se pierda ni de que viaje mal digitado.
 */
const PESOS = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71];

/** @param {string} base solo dígitos, de 1 a 15 */
export function digitoVerificacion(base) {
  if (!/^\d{1,15}$/.test(base)) throw new RangeError('El NIT base debe tener entre 1 y 15 dígitos.');
  const suma = [...base].reverse().reduce((acumulado, digito, i) => acumulado + Number(digito) * PESOS[i], 0);
  const resto = suma % 11;
  return resto > 1 ? 11 - resto : resto;
}

export const nitConDV = (base) => `${base}-${digitoVerificacion(base)}`;
