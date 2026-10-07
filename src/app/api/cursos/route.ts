import { NextRequest, NextResponse } from 'next/server';
import { obtenerCursosFiltrados } from '@/lib/cursos-cache';
import { getSession } from '@/lib/session';
import { requireSession, hasPermiso } from '@/lib/authz';

function parseIntSafe(v: unknown, fb: number) {
  const n = Number.parseInt(String(v ?? ''), 10);
  return Number.isNaN(n) ? fb : n;
}

export async function POST(req: NextRequest) {
  const session = await getSession(req);
  const denied = requireSession(session);
  if (denied) return denied;

  // Ajuste "CUALQUIER PERSONA CON ACCESO AL MÓDULO COSTOS PUEDA CREAR Y
  // GUARDAR" — este catálogo de cursos lo consume el selector dentro de
  // Mano de Obra (Estructura de costos), así que además de 'ver_examenes'
  // (reutilizado histórico para catálogos de este tipo) se acepta
  // 'ver_estructura_costos'.
  if (!(await hasPermiso(session!, 'ver_examenes')) && !(await hasPermiso(session!, 'ver_estructura_costos'))) {
    return NextResponse.json({ ok: false, error: 'No autorizado' }, { status: 403 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const {
      empresa,
      codCurso,
      codigoGrupo,
      codigoMunicipio,
      nitProveedor,
      descripcion,
      descripcionGrupo,
      ciudad,
      valorMin,
      valorMax,
      q,
      page: pageRaw,
      limit: limitRaw,
    } = body;

    const empresaStr = String(empresa ?? '').trim();
    if (!empresaStr) {
      return NextResponse.json({ ok: false, error: 'Se requiere empresa' }, { status: 400 });
    }

    const page = Math.max(1, parseIntSafe(pageRaw, 1));
    const limit = Math.min(200, Math.max(1, parseIntSafe(limitRaw, 30)));

    // Ajuste "CURSOS — SOLO FILTROS REALMENTE SOPORTADOS POR LA FUENTE"
    // (hallazgo confirmado en vivo) — Cód. grupo/Ciudad/NIT proveedor son
    // los ÚNICOS 3 parámetros que la fuente externa filtra de verdad;
    // `{empresa}` sin ninguno de los 3 devuelve una MUESTRA PARCIAL
    // engañosa (probado: una consulta trajo solo 9 filas, mientras que
    // filtrando por ciudad/grupo aparecían cursos que ni siquiera estaban
    // en esa muestra). Por eso este endpoint EXIGE al menos uno de los 3
    // — sin ninguno, responde de inmediato `requiereFiltroSoportado:true`
    // SIN llamar a la fuente, en vez de construir un "catálogo completo"
    // falso sobre esa muestra parcial.
    const codigoGrupoStr = String(codigoGrupo ?? '').trim();
    const ciudadStr = String(ciudad ?? '').trim();
    const nitProveedorStr = String(nitProveedor ?? '').trim();
    const hayFiltroSoportado = !!(codigoGrupoStr || ciudadStr || nitProveedorStr);
    if (!hayFiltroSoportado) {
      return NextResponse.json({
        ok: true, page: 1, limit, total: 0, totalPages: 1, data: [],
        requiereFiltroSoportado: true,
      });
    }

    const todos = await obtenerCursosFiltrados(empresaStr, {
      codGrupo: codigoGrupoStr || undefined,
      ciudad: ciudadStr || undefined,
      nitProveedor: nitProveedorStr || undefined,
    });

    let filtrados = todos;
    if (codCurso) {
      const v = String(codCurso).trim().toLowerCase();
      filtrados = filtrados.filter(r => String(r.cod_curso ?? '').toLowerCase().includes(v));
    }
    if (codigoGrupo) {
      const v = String(codigoGrupo).trim().toLowerCase();
      filtrados = filtrados.filter(r => String(r.cod_grp ?? '').toLowerCase().includes(v));
    }
    if (codigoMunicipio) {
      const v = String(codigoMunicipio).trim().toLowerCase();
      filtrados = filtrados.filter(r => String(r.codmun ?? '').toLowerCase().includes(v));
    }
    if (nitProveedor) {
      const v = String(nitProveedor).trim().toLowerCase();
      filtrados = filtrados.filter(r => String(r.nit_proveedor ?? '').toLowerCase().includes(v));
    }
    if (descripcion) {
      const v = String(descripcion).trim().toLowerCase();
      filtrados = filtrados.filter(r => String(r.descrip_curso ?? '').toLowerCase().includes(v));
    }
    // Ajuste "SELECCIONAR CURSOS — SEPARAR CÓD. GRUPO DE DESCRIPCIÓN" —
    // `descrip_grp_curso` es un campo real y DISTINTO de `descrip_curso`
    // (confirmado con un objeto real de la fuente que trae ambos a la vez).
    // Filtro independiente, nunca mezclado con `descripcion` (que sigue
    // filtrando exclusivamente `descrip_curso`, el nombre del curso).
    if (descripcionGrupo) {
      const v = String(descripcionGrupo).trim().toLowerCase();
      filtrados = filtrados.filter(r => String(r.descrip_grp_curso ?? '').toLowerCase().includes(v));
    }
    // Ajuste "CIUDAD/VALOR — FILTRAR ANTES DE PAGINAR" (bug real reportado:
    // el contador de resultados y las filas ignoraban coincidencias fuera
    // de la página ya traída, porque Ciudad/Valor se filtraban en el
    // cliente sobre `selCursoCatalog`, no contra el catálogo completo).
    // Mismo bloque, mismo orden que el resto de filtros — SIEMPRE antes de
    // calcular `total`/paginar más abajo.
    if (ciudad) {
      const v = String(ciudad).trim().toLowerCase();
      filtrados = filtrados.filter(r => String(r.ciudad ?? '').toLowerCase().includes(v));
    }
    if (valorMin !== undefined && valorMin !== null && valorMin !== '') {
      const mn = Number(valorMin);
      if (!Number.isNaN(mn)) filtrados = filtrados.filter(r => Number(r.vlr_costo_primera ?? 0) >= mn);
    }
    if (valorMax !== undefined && valorMax !== null && valorMax !== '') {
      const mx = Number(valorMax);
      if (!Number.isNaN(mx)) filtrados = filtrados.filter(r => Number(r.vlr_costo_primera ?? 0) <= mx);
    }
    const textoBusqueda = String(q ?? '').trim().toLowerCase();
    if (textoBusqueda) {
      filtrados = filtrados.filter(r =>
        Object.values(r).some(v => String(v ?? '').toLowerCase().includes(textoBusqueda))
      );
    }

    // Ajuste "CORREGIR KEYS DUPLICADAS EN 'SELECCIONAR CURSOS'" — la fuente
    // externa NO trae ningún id/consecutivo real (confirmado en vivo: solo
    // 9 campos: cod_grp/cod_curso/descrip_curso/codmun/nit_proveedor/
    // vlr_costo_reentrena/vlr_costo_primera/ciudad/nombre_proveedor).
    // Verificado con datos reales que la fuente SÍ repite, a veces, la
    // fila COMPLETA (los 9 campos idénticos byte a byte) — un duplicado
    // real del origen, nunca un caso de "misma oferta, otro precio" (ese
    // caso, confirmado también en vivo, difiere en vlr_costo_reentrena y
    // por eso NUNCA colapsa aquí). Se deduplica por la fila CRUDA completa,
    // ANTES de paginar (mismo orden ya usado en dotacion-ext: filtro →
    // dedup → paginar), para que total/totalPages reflejen ofertas reales,
    // nunca repeticiones de la fuente.
    const vistos = new Set<string>();
    const filtradosSinDuplicadosExactos = filtrados.filter(r => {
      const clave = [
        r.cod_grp, r.cod_curso, r.descrip_curso, r.codmun, r.nit_proveedor,
        r.vlr_costo_reentrena, r.vlr_costo_primera, r.ciudad, r.nombre_proveedor,
      ].map(v => String(v ?? '')).join('|');
      if (vistos.has(clave)) return false;
      vistos.add(clave);
      return true;
    });

    const total = filtradosSinDuplicadosExactos.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const safePage = Math.min(page, totalPages);
    const pagina = filtradosSinDuplicadosExactos.slice((safePage - 1) * limit, safePage * limit);

    // Normalización conceptual (§5) — los nombres de entrada de la fuente
    // externa (cod_grp, cod_curso, descrip_curso, ...) NO coinciden con los
    // de salida; se traducen aquí, una sola vez, sin inventar campos que la
    // fuente no entrega (no hay fecha ni id real).
    const data = pagina.map(r => ({
      codigoGrupo: String(r.cod_grp ?? ''),
      // Ajuste "SELECCIONAR CURSOS — SEPARAR CÓD. GRUPO DE DESCRIPCIÓN" —
      // `descrip_grp_curso` capturado directo de esta misma fuente (nunca
      // vía el catálogo separado /api/cursos/grupos, que puede no alinear
      // 1 a 1 con cada oferta real).
      descripcionGrupo: String(r.descrip_grp_curso ?? ''),
      codigoCurso: String(r.cod_curso ?? ''),
      descripcionCurso: String(r.descrip_curso ?? ''),
      nitProveedor: String(r.nit_proveedor ?? ''),
      nombreProveedor: String(r.nombre_proveedor ?? ''),
      codigoMunicipio: String(r.codmun ?? ''),
      ciudad: String(r.ciudad ?? ''),
      valorPrimeraVez: r.vlr_costo_primera != null && r.vlr_costo_primera !== '' ? Number(r.vlr_costo_primera) : null,
      valorReentrenamiento: r.vlr_costo_reentrena != null && r.vlr_costo_reentrena !== '' ? Number(r.vlr_costo_reentrena) : null,
      fechaValor: null,
    }));

    return NextResponse.json({ ok: true, page: safePage, limit, total, totalPages, data });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Error consultando cursos' },
      { status: 500 }
    );
  }
}
