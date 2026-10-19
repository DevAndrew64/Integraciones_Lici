/**
 * Cargos de nómina de la oferta (lo usan la pantalla y el servidor). Contratos muestra cada cargo de la oferta buscando su
 * código en la tabla `cargos` de la nómina de la UEN, así que cada línea de cargo debe llevar un código que exista allí.
 * El puente lo toma por el nombre; cuando el nombre de LiciColba no está en la nómina, quien envía elige en «Enviar a
 * Contratos» el cargo de nómina que le corresponde, y esa elección viaja como `codigoNomina` de la línea.
 */

/** Mismo criterio del puente (`comparable`): mayúsculas, sin tildes, sin puntuación ni espacios repetidos. */
export function claveCargo(nombre: string | null | undefined): string {
  return String(nombre ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
}

/** Lo que eligió quien envía: la base de nómina (si la UEN tiene varias) y el código de nómina por cargo (clave del nombre). */
export interface EleccionNomina {
  baseNomina: string | null;
  codigos: Record<string, number>;
}

export const ELECCION_VACIA: EleccionNomina = { baseNomina: null, codigos: {} };

const BASE = /^[A-Za-z0-9_]{1,64}$/;
const esCodigo = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0 && v <= 99_999_999;

/** Nombre de base de nómina válido (letras, números y _), o null. */
export function baseNominaValida(v: unknown): string | null {
  return typeof v === 'string' && BASE.test(v.trim()) ? v.trim() : null;
}

/** Lee una elección guardada (del navegador): solo lo que tiene la forma esperada. */
export function leerEleccionNomina(valor: unknown): EleccionNomina {
  if (typeof valor !== 'object' || valor === null || Array.isArray(valor)) return ELECCION_VACIA;
  const v = valor as Record<string, unknown>;
  const codigos: Record<string, number> = {};
  if (typeof v.codigos === 'object' && v.codigos !== null && !Array.isArray(v.codigos)) {
    for (const [clave, codigo] of Object.entries(v.codigos as Record<string, unknown>)) if (clave && esCodigo(codigo)) codigos[clave] = codigo;
  }
  return { baseNomina: baseNominaValida(v.baseNomina), codigos };
}

/** Pone en cada línea el código de nómina elegido para su cargo (si hay uno); las demás quedan sin código y las cruza el puente. */
export function aplicarEleccionNomina<T extends { nombre: string }>(cargos: T[], eleccion: EleccionNomina): (T & { codigoNomina?: number })[] {
  return cargos.map((c) => {
    const codigo = eleccion.codigos[claveCargo(c.nombre)];
    return esCodigo(codigo) ? { ...c, codigoNomina: codigo } : c;
  });
}

/** Cómo cruzó un cargo con la nómina (respuesta del puente). */
export type EstadoCargoNomina = 'exacto' | 'palabras' | 'elegido' | 'falta' | 'codigo-inexistente' | 'sin-nombre';

export interface CargoNominaVista {
  nombre: string;
  estado: EstadoCargoNomina;
  codigo: number | null;
  nombreNomina: string | null;
  parecidos: { codigo: number; nombre: string }[];
}

export interface VistaNomina {
  base: string;
  bases: string[];
  cargos: CargoNominaVista[];
  catalogo: { codigo: number; nombre: string }[];
}

/** Los cargos distintos de la oferta (por clave del nombre), con el código elegido si lo hay: lo que se manda a revisar. */
export function cargosParaVista(cargos: { nombre: string; cantidad: number }[], eleccion: EleccionNomina): { nombre: string; codigoNomina: number | null }[] {
  const vistos = new Set<string>();
  const lista: { nombre: string; codigoNomina: number | null }[] = [];
  for (const c of cargos) {
    const clave = claveCargo(c.nombre);
    if (c.cantidad <= 0 || !clave || vistos.has(clave)) continue;
    vistos.add(clave);
    lista.push({ nombre: c.nombre.trim(), codigoNomina: eleccion.codigos[clave] ?? null });
  }
  return lista;
}

/** Lee la respuesta de la vista previa: solo lo que tiene la forma esperada. */
export function leerVistaNomina(valor: unknown): VistaNomina | null {
  if (typeof valor !== 'object' || valor === null) return null;
  const v = valor as Record<string, unknown>;
  if (typeof v.base !== 'string' || !Array.isArray(v.bases) || !Array.isArray(v.cargos) || !Array.isArray(v.catalogo)) return null;
  const opcion = (o: unknown) => {
    const x = o as Record<string, unknown> | null;
    return x && esCodigo(x.codigo) && typeof x.nombre === 'string' ? { codigo: x.codigo, nombre: x.nombre } : null;
  };
  const opciones = (lista: unknown) => (Array.isArray(lista) ? lista.map(opcion).filter((o): o is { codigo: number; nombre: string } => o !== null) : []);
  return {
    base: v.base,
    bases: v.bases.map(String),
    cargos: v.cargos.map((c) => {
      const x = (c ?? {}) as Record<string, unknown>;
      return {
        nombre: String(x.nombre ?? ''),
        estado: String(x.estado ?? 'falta') as EstadoCargoNomina,
        codigo: esCodigo(x.codigo) ? x.codigo : null,
        nombreNomina: typeof x.nombreNomina === 'string' ? x.nombreNomina : null,
        parecidos: opciones(x.parecidos),
      };
    }),
    catalogo: opciones(v.catalogo),
  };
}

/** Los cargos que aún no tienen código de nómina: mientras haya alguno, no se envía. */
export function cargosSinNomina(vista: VistaNomina | null): string[] {
  return (vista?.cargos ?? []).filter((c) => c.codigo === null).map((c) => c.nombre);
}
