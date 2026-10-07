/**
 * Las tablas de Contratos están en latin1 (que en MySQL es cp1252). Un carácter fuera de ese juego (emoji, «≥», «→», «ł»…)
 * no cabe: MySQL lo cambiaría por «?» o lo cortaría sin avisar. El puente lo rechaza ANTES de escribir.
 */
const EXTRA_CP1252 = new Set([...'€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ']);

/** @returns {string[]} los caracteres distintos que no caben en latin1, en orden de aparición */
export function caracteresNoGuardables(texto) {
  const fuera = new Set();
  for (const caracter of texto) {
    const punto = caracter.codePointAt(0);
    if (punto <= 0x7f || (punto >= 0xa0 && punto <= 0xff) || EXTRA_CP1252.has(caracter)) continue;
    fuera.add(caracter);
  }
  return [...fuera];
}
