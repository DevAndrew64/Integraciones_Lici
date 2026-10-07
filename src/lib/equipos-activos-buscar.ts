// src/lib/equipos-activos-buscar.ts
//
// Ajuste "NUEVA API DE MAQUINARIA Y EQUIPOS — BÚSQUEDA DIRECTA" — la fuente
// externa expone `POST equipos/obtener` con `{empresa, descripcion}`,
// devolviendo directamente los equipos que coinciden (incluyendo
// `cant_disponible`/`valor_mantenimiento`). Ya NO hace falta recorrer
// `grupo_activo`→`subtipo_activo`→`equipos/obtener` (ese recorrido, en
// `equipos-activos-cache.ts`/`equipos-activos-sync.ts`, se conserva sin
// tocar por ahora — deja de usarse desde este flujo, pero no se elimina
// agresivamente hasta confirmar que nada más lo necesita).
//
// Ajuste "CATÁLOGO ÚNICO DESDE equipos/obtener — RETIRO DE
// equipos/obtener_recientes" — confirmado en vivo (búsqueda real
// "ESCALERA" en ASEOCOLBA) que `equipos/obtener_recientes` devuelve solo
// 1-3 filas sin importar cuántos tipos distintos existan realmente (15
// subtipos de escalera reales en `equipos/obtener`, solo 1 en
// `obtener_recientes`) — esa fuente NUNCA se comportó como "una fila
// representativa por tipo distinto" (supuesto de diseño de una ronda
// anterior, incorrecto). El catálogo que ve el usuario ahora se DERIVA
// directamente de `equipos/obtener` (ver `derivarCatalogoDesdeActivos` en
// `equipos-activos-cruce.ts`) — una sola llamada externa por búsqueda,
// nunca dos. `buscarEquiposRecientes`/`equipos/obtener_recientes` se
// retiraron de este flujo por completo.
//
// Confirmado en vivo (ver reporte): la respuesta de `equipos/obtener` es
// un ARRAY PLANO (nunca envuelto en `{data:[...]}`), cada fila con
// `nombre_c`, `empresa_c`, `uen` (código corto de ubicación), `ubicacion`
// (texto legible), `tipo_c`/`sub_tipo_c` (códigos de grupo/subtipo),
// `grupo`/`sub_tipo` (descripciones), `fecha_adquisicion`, `valor`,
// `cant_disponible` (number) y `valor_mantenimiento` (number). La fuente
// exige `descripcion` no vacía (422 si falta) — nunca se llama sin un
// término de búsqueda real.

const FUENTE_EQUIPOS_OBTENER_URL = 'https://grupocolba.com/service/public/api/equipos/obtener';
const TIMEOUT_MS = 15 * 1000;

export interface EquipoActivoBuscado extends Record<string, unknown> {
  nombre_c: string;
  empresa_c: string;
  uen: string;
  ubicacion: string;
  codGrupo: string;
  grupo: string;
  codSubtipo: string;
  sub_tipo: string;
  fecha_adquisicion: string | null;
  valor: number | null;
  cantidadDisponible: number;
  valorMantenimiento: number | null;
}

function normalizarLista(raw: unknown): Record<string, unknown>[] {
  return Array.isArray(raw) ? raw as Record<string, unknown>[] : [];
}

/**
 * Búsqueda directa contra la nueva API — sin concurrencia, sin
 * recorrido de grupo/subtipo, sin caché de réplica: una sola llamada por
 * consulta del usuario (misma filosofía que el resto de "Consultar" del
 * módulo). `descripcion` nunca se envía vacía (ver docblock del archivo).
 */
export async function buscarEquiposActivos(empresa: string, descripcion: string): Promise<EquipoActivoBuscado[]> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let raw: unknown;
  try {
    const res = await fetch(FUENTE_EQUIPOS_OBTENER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ empresa, descripcion }),
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Error externo: ${res.status}`);
    raw = await res.json();
  } finally {
    clearTimeout(timeoutId);
  }
  const lista = normalizarLista(raw);
  return lista.map(item => ({
    ...item,
    nombre_c: String(item.nombre_c ?? '—'),
    empresa_c: String(item.empresa_c ?? empresa),
    uen: String(item.uen ?? ''),
    // Ajuste "NUEVA API — UBICACIÓN LEGIBLE" — `ubicacion` (texto, ej.
    // "Barranquilla Bodega Informática") es NUEVO en esta API; nunca
    // existía en la anterior (que solo traía el código `uen`). Se
    // conserva informativa, nunca como filtro (misma regla ya vigente).
    ubicacion: String(item.ubicacion ?? ''),
    // Renombrado interno (tipo_c/sub_tipo_c → codGrupo/codSubtipo) para
    // no romper el contrato ya conocido por route.ts/page.tsx (mismos
    // nombres que usaba el recorrido anterior) — nunca se inventa un
    // código nuevo, son los mismos valores que entrega la fuente.
    codGrupo: String(item.tipo_c ?? ''),
    grupo: String(item.grupo ?? ''),
    codSubtipo: String(item.sub_tipo_c ?? ''),
    sub_tipo: String(item.sub_tipo ?? ''),
    fecha_adquisicion: item.fecha_adquisicion != null ? String(item.fecha_adquisicion) : null,
    valor: typeof item.valor === 'number' ? item.valor : (item.valor != null && !Number.isNaN(Number(item.valor)) ? Number(item.valor) : null),
    // Ajuste "NUEVA API — DISPONIBILIDAD Y MANTENIMIENTO COMO FUENTE DE
    // VERDAD" — `cant_disponible`/`valor_mantenimiento` vienen directo de
    // la fuente, nunca inferidos de ubicación/grupo/subtipo ni calculados
    // localmente. `cantidadDisponible` sigue el mismo contrato ya
    // existente en `MaquinariaEquipoRow` (siempre `number`, nunca null —
    // 0 si la fuente no lo informa). `valorMantenimiento` SÍ puede quedar
    // `null` (sin tarifa informada) — nunca se convierte en 0 en
    // silencio; el motor de cálculo ya trata `null` explícitamente.
    cantidadDisponible: typeof item.cant_disponible === 'number' ? item.cant_disponible : (item.cant_disponible != null && !Number.isNaN(Number(item.cant_disponible)) ? Number(item.cant_disponible) : 0),
    valorMantenimiento: typeof item.valor_mantenimiento === 'number' ? item.valor_mantenimiento : (item.valor_mantenimiento != null && !Number.isNaN(Number(item.valor_mantenimiento)) ? Number(item.valor_mantenimiento) : null),
  }));
}
