import { NextRequest, NextResponse } from 'next/server';
import { buscarEquiposActivos } from '@/lib/equipos-activos-buscar';
import { cruzarCatalogoConDisponibilidad, derivarCatalogoDesdeActivos } from '@/lib/equipos-activos-cruce';
import { getSession } from '@/lib/session';
import { requireSession, hasPermiso } from '@/lib/authz';
import { paginar } from '@/lib/costos-mano-obra/motor-distribuido/catalogo-dotacion-dedup';

/**
 * Ajuste "CATÁLOGO ÚNICO DESDE equipos/obtener" — esta ruta consulta UNA
 * sola fuente externa por búsqueda: `POST equipos/obtener`
 * (`buscarEquiposActivos`, empresa+descripción), que trae tanto el
 * catálogo (tipo/subtipo/nombre/fecha de adquisición/valor) como la
 * disponibilidad real (`cant_disponible`/`valor_mantenimiento` por
 * UEN/lote de compra).
 *
 * Ronda anterior ("INTEGRACIÓN DE DOS ENDPOINTS — CATÁLOGO +
 * DISPONIBILIDAD") combinaba esta fuente con `equipos/obtener_recientes`
 * para el catálogo — RETIRADA: confirmado en vivo (búsqueda real
 * "ESCALERA" en ASEOCOLBA) que `obtener_recientes` devuelve 1-3 filas sin
 * importar cuántos tipos distintos existan de verdad (15 subtipos reales
 * de escalera en `equipos/obtener`, solo 1 en `obtener_recientes`) — esa
 * fuente ocultaba equipos reales, nunca se comportó como "una fila por
 * tipo distinto". El catálogo ahora se DERIVA de la misma respuesta de
 * `equipos/obtener` (`derivarCatalogoDesdeActivos`, agrupa por
 * `tipo_c`+`sub_tipo_c`+`nombre_c` normalizado, eligiendo la compra más
 * reciente del grupo como fila representativa) y se cruza contra sí misma
 * (`cruzarCatalogoConDisponibilidad`, `@/lib/equipos-activos-cruce`) para
 * obtener `disponibilidadPorUen`/`disponibleTotal`/`valorMantenimiento`.
 *
 * El cruce exige `tipo_c`+`sub_tipo_c`+`nombre_c` normalizado — confirmado
 * con datos reales que el código de grupo+subtipo NUNCA identifica un
 * equipo por sí solo (un mismo subtipo puede agrupar más de 10 nombres
 * distintos). Nunca recorre grupo_activo→subtipo_activo→equipos/obtener
 * (motor legado en `equipos-activos-cache.ts`, sin consumidor en este
 * flujo) ni usa el Excel de mantenimiento.
 *
 * `q` (descripción) es OBLIGATORIO para la fuente externa (422 si viene
 * vacía) — sin un término de búsqueda real (mínimo 2 caracteres), esta
 * ruta responde de inmediato con una lista vacía, sin disparar ninguna
 * consulta externa (nunca un recorrido/consulta automática al abrir el
 * modal).
 */
export async function POST(req: NextRequest) {
  const session = await getSession(req);
  const denied = requireSession(session);
  if (denied) return denied;

  if (!(await hasPermiso(session!, 'ver_estructura_costos'))) {
    return NextResponse.json({ ok: false, error: 'No autorizado' }, { status: 403 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const empresa = String(body.empresa ?? '').trim();
    if (!empresa) return NextResponse.json({ ok: false, error: 'Se requiere empresa' }, { status: 400 });

    const page = Number(body.page) > 0 ? Number(body.page) : 1;
    const limit = Number(body.limit) > 0 ? Number(body.limit) : 50;
    const q = String(body.q ?? '').trim();

    if (q.length < 2) {
      // Ajuste "NO LANZAR UN RECORRIDO MASIVO AL ABRIR" — sin descripción
      // real todavía no hay nada que preguntarle a la fuente (que además
      // la exige, 422 si falta); el modal debe esperar a que el usuario
      // escriba y pulse Consultar.
      return NextResponse.json({
        ok: true, page: 1, limit, total: 0, totalPages: 1, data: [],
      });
    }

    // Una sola llamada externa por búsqueda — el catálogo se deriva de la
    // misma respuesta de disponibilidad (ver docblock del encabezado).
    const disponibilidad = await buscarEquiposActivos(empresa, q);
    const catalogo = derivarCatalogoDesdeActivos(disponibilidad);
    const cruzado = cruzarCatalogoConDisponibilidad(catalogo, disponibilidad);

    const pagina = paginar(cruzado, page, limit);
    const data = pagina.items.map(r => ({
      empresa: r.empresa_c,
      nombre: r.nombre_c,
      codGrupo: r.codGrupo,
      grupo: r.grupo,
      codSubtipo: r.codSubtipo,
      subtipo: r.sub_tipo,
      fechaAdquisicion: r.fecha_adquisicion,
      valor: r.valor,
      // `disponibilidadPorUen` conserva el detalle por sede (nunca solo el
      // total); `valorMantenimientoConflictivo` avisa — nunca en silencio
      // — cuando distintas filas del mismo equipo traen tarifas de
      // mantenimiento distintas (caso real confirmado).
      disponibilidadPorUen: r.disponibilidadPorUen,
      disponibleTotal: r.disponibleTotal,
      valorMantenimiento: r.valorMantenimiento,
      valorMantenimientoConflictivo: r.valorMantenimientoConflictivo,
      valorMantenimientoValoresDistintos: r.valorMantenimientoConflictivo ? r.valorMantenimientoValoresDistintos : undefined,
    }));

    return NextResponse.json({
      ok: true, page: pagina.page, limit: pagina.limit, total: pagina.total, totalPages: pagina.totalPages, data,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Error consultando equipos' },
      { status: 500 }
    );
  }
}
