/**
 * Resolución de identidad para la ficha de una Solicitud (módulo "Procesos
 * Privados" / "Por validar" y análogos) — misma orden obligatoria que
 * src/lib/proceso-identidad.ts, pero pensada para el LADO CLIENTE, donde no
 * hay acceso directo a Prisma: la búsqueda de candidatos se hace vía
 * `buscarCandidatos`/`buscarProcesoPorId` inyectados (en producción, fetch a
 * `/api/procesos?query=` y `/api/procesos?id=`).
 *
 * Motivo de este módulo (ver diagnóstico Fortul/Honor & Laurel, caso de
 * "Procesos Privados"): `VistFichaAsignacion` resolvía el Proceso asociado a
 * una Solicitud buscando por texto de `codigoProceso` y, si no había
 * coincidencia exacta, caía silenciosamente al PRIMER resultado de la
 * búsqueda (`|| procesos[0]`) — sin verificar entidad. Eso hacía que la
 * ficha manual de "El Grupo Honor & Laurel" (Solicitud sin procesoId)
 * mostrara los 14 cronogramas y 4 documentos de "Concejo Municipal de
 * Fortul" (Proceso.id=7050), por compartir el mismo codigoProceso.
 *
 * Ronda 2 (verificación posterior al despliegue, 32 procesos): un `procesoId`
 * ya guardado NO es prueba suficiente por sí solo — se confirmaron 3
 * Solicitudes (73, 129, 177) cuyo `procesoId` histórico apunta al Proceso de
 * OTRA entidad con el mismo `codigoProceso` (ej. Solicitud 73 es "MC-002-2026
 * / Concejo Distrital de Santiago de Cali" pero su `procesoId` guardado es el
 * de "MC-002-2026 / Nariño - Concejo Municipal de Contadero"). Por eso, antes
 * de confiar en un `procesoId` histórico, se valida contra el Proceso real:
 * si su `externalId` o su llave de negocio (código+entidad) CONTRADICEN a la
 * Solicitud, se rechaza y se re-resuelve por el resto del orden obligatorio.
 */

import { construirLlaveNegocio } from '@/lib/proceso-identidad';

export interface CandidatoProceso {
  _dbId: number | string | null | undefined;
  codigoProceso?: string | null;
  entidad?: string | null;
  externalId?: string | null;
  sourceKey?: string | null;
  /**
   * No interviene en la resolución de identidad — se expone porque el GET por
   * id de `/api/procesos` resuelve el link bajo demanda y lo devuelve ya
   * resuelto en esa misma respuesta, y la ficha lo necesita para pintarlo sin
   * esperar a una recarga.
   */
  linkDetalle?: string | null;
}

export interface InputResolverProcesoFicha {
  codigoProceso: string | null | undefined;
  entidad: string | null | undefined;
  procesoId: number | string | null | undefined;
  externalId: string | null | undefined;
  /** Inyectado — en el cliente, un fetch a `/api/procesos?query=<codigo>`. */
  buscarCandidatos: (codigo: string) => Promise<CandidatoProceso[]>;
  /**
   * Inyectado — en el cliente, un fetch puntual a `/api/procesos?id=<id>`.
   * Se usa SOLO para validar un `procesoId` histórico antes de confiarle la
   * ficha; si no se provee, se conserva el comportamiento previo (confiar en
   * `procesoId` sin poder validarlo — preferible a romper fichas ya
   * correctas cuando el caller no soporta la validación todavía).
   */
  buscarProcesoPorId?: (id: number) => Promise<CandidatoProceso | null>;
}

function aInt(v: unknown): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Devuelve el `Proceso.id` (o null si no hay coincidencia inequívoca) que
 * debe usarse para cargar cronograma/documentos/adendas de la ficha.
 * Orden obligatorio: procesoId VALIDADO → externalId → llave de negocio
 * exacta. Nunca "el primero que aparezca" en una búsqueda de texto por
 * código, y nunca un `procesoId` que contradiga a la propia Solicitud.
 */
export async function resolverProcesoIdParaFicha(input: InputResolverProcesoFicha): Promise<number | null> {
  const codigo = (input.codigoProceso ?? '').trim();
  const entidad = (input.entidad ?? '').trim();
  const externalId = (input.externalId ?? '').trim();
  const procesoId = aInt(input.procesoId);

  // 1. procesoId directo — se valida contra el Proceso real antes de
  // confiarle la ficha (nunca se corrige la Solicitud aquí, solo se decide
  // qué mostrar en esta lectura).
  if (procesoId) {
    if (!input.buscarProcesoPorId) return procesoId; // caller sin soporte de validación — comportamiento previo.

    const candidato = await input.buscarProcesoPorId(procesoId);
    if (!candidato) {
      // El procesoId no existe como Proceso real — no se puede confiar en él.
      // Cae al resto de la resolución (externalId / llave de negocio).
    } else {
      const externalIdCandidato = (candidato.externalId ?? '').trim();
      if (externalId && externalIdCandidato) {
        // A. externalId de ambos lados presentes: deben coincidir exactamente.
        if (externalId === externalIdCandidato) return procesoId;
        // D. externalId contradice — se rechaza, sigue la resolución normal.
      } else if (codigo && entidad) {
        // B. Sin externalId en algún lado: se compara la llave de negocio.
        const llaveObjetivo = construirLlaveNegocio(codigo, entidad);
        const llaveCandidato = construirLlaveNegocio(candidato.codigoProceso ?? '', candidato.entidad ?? '');
        if (llaveObjetivo === llaveCandidato) return procesoId; // C. coincide (o solo difiere en ruido ya normalizado).
        // D. la llave de negocio corresponde a otra entidad — se rechaza.
      } else {
        // Sin datos de la Solicitud para comparar (ni externalId ni
        // código+entidad) — no hay evidencia de contradicción, se conserva.
        return procesoId;
      }
    }
  }

  if (!codigo) return null;

  const candidatos = await input.buscarCandidatos(codigo);

  // 2. externalId exacto.
  if (externalId) {
    const porExternalId = candidatos.find((p) => (p.externalId ?? '').trim() === externalId);
    if (porExternalId) return aInt(porExternalId._dbId);
  }

  // 3. Llave de negocio exacta normalizada (código+entidad). Si hay 0 o más
  // de 1 candidato con la llave exacta, no se puede resolver de forma
  // inequívoca — nunca se asocia "el primero" ni "el último".
  if (codigo && entidad) {
    const llaveObjetivo = construirLlaveNegocio(codigo, entidad);
    const exactos = candidatos.filter(
      (p) => construirLlaveNegocio(p.codigoProceso ?? '', p.entidad ?? '') === llaveObjetivo
    );
    if (exactos.length === 1) return aInt(exactos[0]._dbId);
    return null;
  }

  // 4. Sin datos suficientes para una resolución segura.
  return null;
}
