import { digitoVerificacion } from '../../../puente-contratos/src/nit.js';

/**
 * NIT de la ENTIDAD CONTRATANTE (`Solicitud.nitContacto`). Se registra a mano al marcar el proceso como Adjudicado, con su
 * dígito de verificación (DV), y se guarda como «base-DV» (p. ej. 900123456-8), igual que en Contratos.
 *
 * Antes se intentaba completar solo desde los datos abiertos de SECOP buscando por el nombre de la entidad, pero hay
 * entidades homónimas en distintos municipios (p. ej. varias «INSTITUCION EDUCATIVA EL CAIRO») y el NIT podía salir de
 * otra. Por eso ya no se busca automáticamente: un NIT sin DV (de antes) no cuenta como verificado.
 *
 * El DV se comprueba con el módulo 11 de la DIAN: así se detecta un dígito mal digitado o un NIT inventado.
 */

export type ResultadoNit = { ok: true; base: string; dv: number; nit: string } | { ok: false; error: string };

/** Valida un NIT digitado con su DV («900.123.456-8», «900123456-8», «900123456 8»). Devuelve la forma «base-DV». */
export function validarNitConDv(valor: unknown): ResultadoNit {
  const t = String(valor ?? '').trim().replace(/\./g, '');
  if (!t) return { ok: false, error: 'Digite el NIT de la entidad contratante con su dígito de verificación.' };
  const m = /^(\d{5,15})\s*[-\s]\s*(\d)$/.exec(t);
  if (!m) {
    return /^\d{5,15}$/.test(t)
      ? { ok: false, error: 'Falta el dígito de verificación: escríbalo después de un guion (p. ej. 900123456-8).' }
      : { ok: false, error: 'El NIT debe tener entre 5 y 15 dígitos y su dígito de verificación (p. ej. 900123456-8).' };
  }
  const base = m[1];
  const dv = Number(m[2]);
  if (digitoVerificacion(base) !== dv) {
    return { ok: false, error: `El dígito de verificación no corresponde al NIT ${base}. Revise el NIT en el RUT o en el pliego de la entidad.` };
  }
  return { ok: true, base, dv, nit: `${base}-${dv}` };
}

/** true si el NIT guardado ya fue registrado con un DV correcto (los NIT de antes, sin DV, no cuentan). */
export function nitVerificado(valor: string | null | undefined): boolean {
  if (typeof valor !== 'string') return false;
  return /^\d{5,15}-\d$/.test(valor.trim()) && validarNitConDv(valor).ok;
}
