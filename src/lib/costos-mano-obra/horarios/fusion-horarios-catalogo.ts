/**
 * Fusión pura de una lista de horarios por identidad empresa+codigo
 * (Bloque HORARIOS 2A) — reemplaza el `setHorariosCatalogo(p=>[...p,nuevo])`
 * incondicional que podía duplicar visualmente un horario cuando el
 * servidor hizo ACTUALIZAR, cuando el usuario guardó dos veces, o cuando
 * la respuesta llegó repetida. `codigo` nunca se convierte a Number —
 * la comparación es siempre de String a String.
 */
import type { HorarioConIdentidad } from './tipos';

/**
 * Si ya existe una entrada con la misma empresa+codigo, la reemplaza en su
 * misma posición (conserva el orden de la lista). Si no existe, la agrega
 * al final. "aseo"+"00042" y "vigi"+"00042" se tratan como identidades
 * distintas — nunca se fusionan entre sí.
 */
export function fusionarHorarioCatalogo<T extends HorarioConIdentidad>(lista: readonly T[], nuevo: T): T[] {
  if (nuevo.codigo === null) {
    // Sin identidad clara (no debería ocurrir tras HORARIOS 2A, ya que el
    // fallback local siempre asigna un código LOCAL-... ), se agrega sin
    // intentar deduplicar por posición.
    return [...lista, nuevo];
  }
  const idx = lista.findIndex(x => x.empresa === nuevo.empresa && x.codigo === nuevo.codigo);
  if (idx === -1) return [...lista, nuevo];
  const copia = lista.slice();
  copia[idx] = nuevo;
  return copia;
}
