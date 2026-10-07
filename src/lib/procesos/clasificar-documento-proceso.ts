/**
 * Clasificación real de documentos — punto 11 del pedido.
 *
 * Antes de escribir esta función se rastreó la regla que usa hoy el sistema
 * (`detectarTipoDocumentoPorNombre` en `src/lib/procesos-sync.ts:463-475`,
 * más la regla adicional "nombre empieza por adend[ao] => adenda"
 * en `procesos-sync.ts:707-709`). Esa función solo distingue dos valores
 * (`'base' | 'adenda'`) y SIEMPRE recibe `'adenda'` como valor por defecto en
 * cada sitio real donde se llama tras la creación del proceso (`procesos-
 * sync.ts:1435,1450` y `actualizar-ficha-puntual.ts:648`) — es decir, en la
 * práctica, HOY todo documento detectado en una sincronización posterior a la
 * creación queda etiquetado "adenda" salvo que además contenga alguna palabra
 * clave, sin distinguir un documento nuevo genuino (acta de adjudicación,
 * informe de evaluación, etc.) de una adenda real. Esto es exactamente lo que
 * el punto 11 pidió no asumir ("no utilizar únicamente tipoDocumento contiene
 * 'ADEND' como regla definitiva", "no asumir que todo documento posterior es
 * automáticamente una adenda").
 *
 * Esta función reutiliza las palabras clave ya validadas en producción para
 * ADENDA/MODIFICACION, pero separa DOCUMENTO_NUEVO de ADENDA para
 * documentos posteriores sin ninguna palabra clave — divergencia deliberada,
 * documentada aquí, NO aplicada a los registros existentes (no hay
 * reclasificación en esta fase, según lo pedido).
 */

export type ClasificacionDocumentoProceso =
  | 'DOCUMENTO_INICIAL'
  | 'DOCUMENTO_NUEVO'
  | 'ADENDA'
  | 'MODIFICACION'
  | 'OTRO';

export interface InputClasificarDocumentoProceso {
  nombre: string;
  /** true si el Proceso no tenía NINGÚN documento persistido antes de esta consulta. */
  esPrimeraSincronizacion: boolean;
}

const RANGO_DIACRITICOS = new RegExp('[' + String.fromCharCode(0x0300) + '-' + String.fromCharCode(0x036f) + ']', 'g');

function normalizarTexto(valor: string): string {
  return valor
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(RANGO_DIACRITICOS, '');
}

// Mismas palabras que `detectarTipoDocumentoPorNombre` en procesos-sync.ts,
// separadas en dos categorías más precisas.
const PALABRAS_ADENDA = ['adenda', 'adendo'];
const PALABRAS_MODIFICACION = ['modificacion', 'modificatorio', 'alcance', 'aclaracion', 'aclaratorio'];
const PALABRAS_OBSERVACION = ['respuesta observaciones', 'observaciones', 'observacion'];

export function clasificarDocumentoProceso(
  input: InputClasificarDocumentoProceso,
): ClasificacionDocumentoProceso {
  const texto = normalizarTexto(input.nombre);

  // Regla explícita ya validada en producción (procesos-sync.ts:708): el
  // nombre empieza literalmente por "adenda"/"adendo".
  if (/^adend[ao]\b/.test(texto)) return 'ADENDA';
  if (PALABRAS_ADENDA.some((p) => texto.includes(p))) return 'ADENDA';
  if (PALABRAS_MODIFICACION.some((p) => texto.includes(p))) return 'MODIFICACION';

  if (input.esPrimeraSincronizacion) return 'DOCUMENTO_INICIAL';

  // Un documento de "observaciones" posterior a la creación NO se asume
  // adenda por sí solo (a diferencia del comportamiento legado) — queda como
  // OTRO hasta que exista una regla de negocio explícita que lo confirme.
  if (PALABRAS_OBSERVACION.some((p) => texto.includes(p))) return 'OTRO';

  return 'DOCUMENTO_NUEVO';
}
