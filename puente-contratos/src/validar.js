/**
 * Validación del JSON que envía LiciColba (contrato v1, módulo 1: cliente y datos generales).
 *
 * - Solo se aceptan los campos documentados: un campo desconocido es un error, así no se cuela nada que Contratos no
 *   pidió (p. ej. lo que digitan Legal o el cliente).
 * - Se devuelven TODOS los errores a la vez. Lo opcional que falta no bloquea: se informa como advertencia.
 * - Nunca se trunca ni se redondea en silencio: lo que no cabe se rechaza.
 * - Los límites de longitud son PROVISIONALES: el módulo MySQL los reemplaza por la longitud real de cada columna.
 */
import { createHash } from 'node:crypto';

const ESQUEMA = {
  origen: {
    solicitudId: { tipo: 'entero', min: 1, requerido: true },
    procesoCodigo: { tipo: 'texto', max: 100, requerido: true },
  },
  cliente: {
    razonSocial: { tipo: 'texto', max: 200, requerido: true },
    nit: { tipo: 'nit', requerido: true },
    direccion: { tipo: 'texto', max: 200 },
  },
  contrato: {
    // «Descripción» (Datos Generales) y «Objeto» (Mic Hoja 1/4) llevan el mismo texto.
    objeto: { tipo: 'texto', max: 4000, multilinea: true },
    // A.I.U. con la «A»: lo calcula LiciColba (administración + imprevistos + utilidad sobre costos directos).
    porcentajeAIU: { tipo: 'numero', min: 0, max: 100 },
    // El valor del contrato es MENSUAL (con IVA).
    valorMensual: { tipo: 'numero', min: 0 },
    plazoMeses: { tipo: 'entero', min: 1, max: 600 },
  },
};

const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/; // todo control salvo tab, salto de línea y retorno
const esObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const vacio = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

const VALIDADORES = {
  texto(valor, { max, multilinea = false }) {
    if (typeof valor !== 'string') return { error: 'Debe ser texto.' };
    let t = valor.normalize('NFC');
    if (CONTROL.test(t)) return { error: 'Contiene caracteres de control.' };
    t = multilinea ? t.replace(/\r\n?/g, '\n').split('\n').map((l) => l.trimEnd()).join('\n').trim() : t.replace(/\s+/g, ' ').trim();
    const largo = Array.from(t).length; // caracteres, no unidades UTF-16
    return largo > max ? { error: `Máximo ${max} caracteres (tiene ${largo}).` } : { valor: t };
  },
  nit(valor) {
    return typeof valor === 'string' && /^\d{5,15}$/.test(valor.trim()) ? { valor: valor.trim() } : { error: 'Debe tener entre 5 y 15 dígitos, sin puntos, guion ni dígito de verificación.' };
  },
  entero(valor, { min, max = Number.MAX_SAFE_INTEGER }) {
    if (!Number.isInteger(valor)) return { error: 'Debe ser un número entero.' };
    return valor < min || valor > max ? { error: `Debe estar entre ${min} y ${max}.` } : { valor };
  },
  numero(valor, { min, max = Number.MAX_SAFE_INTEGER }) {
    if (typeof valor !== 'number' || !Number.isFinite(valor)) return { error: 'Debe ser un número.' };
    if (!/^-?\d+(\.\d{1,2})?$/.test(String(valor))) return { error: 'Máximo 2 decimales.' };
    return valor < min || valor > max ? { error: `Debe estar entre ${min} y ${max}.` } : { valor };
  },
};

/** @returns {{ok: true, datos: object, advertencias: object[]} | {ok: false, errores: {campo: string, mensaje: string}[]}} */
export function validarContrato(entrada) {
  if (!esObjeto(entrada)) return { ok: false, errores: [{ campo: '(cuerpo)', mensaje: 'Se esperaba un objeto JSON.' }] };
  const errores = [];
  const advertencias = [];
  const datos = { version: 1 };

  if (entrada.version !== 1) errores.push({ campo: 'version', mensaje: 'La versión del contrato debe ser 1.' });
  for (const k of Object.keys(entrada)) if (k !== 'version' && !(k in ESQUEMA)) errores.push({ campo: k, mensaje: 'Campo no permitido.' });

  for (const [seccion, campos] of Object.entries(ESQUEMA)) {
    const origen = entrada[seccion];
    if (!esObjeto(origen)) {
      errores.push({ campo: seccion, mensaje: 'Falta la sección.' });
      continue;
    }
    for (const k of Object.keys(origen)) if (!(k in campos)) errores.push({ campo: `${seccion}.${k}`, mensaje: 'Campo no permitido.' });
    datos[seccion] = {};
    for (const [nombre, regla] of Object.entries(campos)) {
      const ruta = `${seccion}.${nombre}`;
      if (vacio(origen[nombre])) {
        if (regla.requerido) errores.push({ campo: ruta, mensaje: 'Es obligatorio.' });
        else advertencias.push({ campo: ruta, mensaje: 'Sin dato: se completa en Contratos.' });
        datos[seccion][nombre] = null;
        continue;
      }
      const r = VALIDADORES[regla.tipo](origen[nombre], regla);
      if (r.error) errores.push({ campo: ruta, mensaje: r.error });
      else datos[seccion][nombre] = r.valor;
    }
  }
  return errores.length > 0 ? { ok: false, errores } : { ok: true, datos, advertencias };
}

const canonico = (v) => {
  if (Array.isArray(v)) return v.map(canonico);
  if (esObjeto(v)) return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonico(v[k])]));
  return v;
};

/** Huella SHA-256 del contenido validado (claves ordenadas): mismo contenido ⇒ misma huella. Base de la idempotencia. */
export function huella(datos) {
  return createHash('sha256').update(JSON.stringify(canonico(datos))).digest('hex');
}
