/**
 * Ajuste "EXPORTAR SIN LA PLANTILLA" — lectura de las plantillas de Excel que
 * usan los exports de costos.
 *
 * Las plantillas viven en `data/importaciones/…`, carpeta que está en
 * `.gitignore` y NUNCA se versionó: un clon nuevo, una restauración o un
 * equipo distinto no la trae. Esto separa "falta el archivo" de cualquier otro
 * error de disco para dejarlo claro EN EL LOG DEL SERVIDOR; al usuario solo se
 * le informa que ocurrió un error (ver `mensajes-exportacion.ts`).
 *
 * PENDIENTE (caso abierto, se retoma más adelante): la solución de fondo NO es
 * solo avisar que falta la plantilla — hay que definir cómo se distribuye /
 * obtiene ese archivo en cada entorno.
 */
import { readFile } from 'node:fs/promises';
import { MENSAJE_ERROR_GENERAR_EXCEL } from './mensajes-exportacion';

/** Ruta RELATIVA a la raíz del proyecto — para el log del servidor. */
export const RUTA_RELATIVA_PLANTILLA_MANO_OBRA = 'data/importaciones/Mano de obra/Mano de obra.xlsx';

export class PlantillaExcelNoEncontradaError extends Error {
  readonly codigo = 'PLANTILLA_NO_ENCONTRADA';
  constructor(readonly rutaRelativa: string) {
    super(`Falta la plantilla de Excel: ${rutaRelativa}`);
    this.name = 'PlantillaExcelNoEncontradaError';
  }
}

/** Lee la plantilla; si el archivo no existe lanza `PlantillaExcelNoEncontradaError`
 * (cualquier otro error de disco se propaga tal cual). */
export async function leerPlantillaExcel(rutaAbsoluta: string, rutaRelativa: string): Promise<Buffer> {
  try {
    return await readFile(rutaAbsoluta);
  } catch (e) {
    if ((e as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') throw new PlantillaExcelNoEncontradaError(rutaRelativa);
    throw e;
  }
}

/** Cuerpo de la respuesta HTTP cuando falta la plantilla: para el usuario es un
 * error de generación como cualquier otro (mensaje genérico). El `error` (código
 * corto) permite a soporte distinguirlo sin exponer rutas ni instrucciones. */
export function cuerpoPlantillaFaltante(e: PlantillaExcelNoEncontradaError) {
  return { ok: false as const, error: e.codigo, mensaje: MENSAJE_ERROR_GENERAR_EXCEL };
}
