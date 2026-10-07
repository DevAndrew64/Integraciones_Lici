// src/lib/equipos-activos-sync.ts
//
// Ajuste "RÉPLICA LOCAL PERSISTENTE DEL CATÁLOGO DE EQUIPOS" — capa de
// persistencia/sincronización sobre el motor de recorrido puro que ya
// existe en `equipos-activos-cache.ts` (grupo_activo → subtipo_activo →
// equipos/obtener, concurrencia/reintentos/manejo de 429/500 SIN CAMBIOS).
// Este archivo NUNCA reimplementa el recorrido — lo reutiliza tal cual.
//
// Mismo patrón ya aprobado en este proyecto para "lote de sincronización
// con publicación controlada" (ver ImportacionTarifasMantenimiento/
// TarifaMantenimientoEquipo, prisma/schema.prisma): cada sincronización
// crea un lote NUEVO (`EquipoActivoCatalogoSync`, activa:false mientras se
// construye); solo se marca `activa:true` (y se desactiva la anterior) si
// el resultado es aceptable — la réplica publicada anterior NUNCA se
// borra ni se sustituye por una peor.

import prisma from '@/lib/prisma';
import { obtenerCatalogoConsolidadoEmpresa, invalidarCacheEquiposActivos, type EquipoActivoConsolidado } from './equipos-activos-cache';

export interface ResultadoSincronizacion {
  sincronizacionId: number;
  publicada: boolean;
  totalEquipos: number;
  totalGrupos: number;
  totalPares: number;
  incompleto: boolean;
  grupoActivoFallido: boolean;
  gruposFallidos: number;
  paresFallidos: number;
  motivoNoPublicada?: string;
}

// Single-flight por empresa — evita que una sincronización disparada por
// cron/N8N y otra disparada manualmente al mismo tiempo ejecuten DOS
// recorridos completos en paralelo contra el mismo proveedor rate-limited
// (mismo problema, mismo remedio, que `obtenerCatalogoConsolidadoEmpresa`
// en `equipos-activos-cache.ts`).
const _sincronizacionesEnCurso = new Map<string, Promise<ResultadoSincronizacion>>();

/**
 * Ejecuta una sincronización completa (recorrido externo real, nunca lee
 * de la réplica) y decide si publicarla. Nunca lanza si el recorrido
 * falla — el estado FALLIDO/COMPLETADO-no-publicada queda registrado en
 * `EquipoActivoCatalogoSync`, y la réplica activa anterior (si existía)
 * permanece intacta y sirviendo al endpoint de lectura durante todo el
 * proceso (nunca hay una ventana con el catálogo vacío por una
 * sincronización en curso o fallida).
 */
export async function sincronizarCatalogoEquipos(empresa: string, disparadaPor: string): Promise<ResultadoSincronizacion> {
  const key = empresa.trim().toLowerCase();
  const enCurso = _sincronizacionesEnCurso.get(key);
  if (enCurso) return enCurso;

  const promesa = ejecutarSincronizacion(key, disparadaPor);
  _sincronizacionesEnCurso.set(key, promesa);
  try {
    return await promesa;
  } finally {
    _sincronizacionesEnCurso.delete(key);
  }
}

async function ejecutarSincronizacion(empresa: string, disparadaPor: string): Promise<ResultadoSincronizacion> {
  const sync = await prisma.equipoActivoCatalogoSync.create({
    data: { empresa, estado: 'EN_PROCESO', activa: false, disparadaPor },
  });

  try {
    // Fuerza un recorrido FRESCO real — una sincronización nunca debe
    // conformarse con la caché en memoria de 60 min del motor de
    // recorrido (esa caché es para el caso de uso original de
    // `obtenerCatalogoConsolidadoEmpresa`; aquí siempre queremos datos
    // recién consultados al proveedor).
    invalidarCacheEquiposActivos();
    const resultado = await obtenerCatalogoConsolidadoEmpresa(empresa);

    const grupos = new Set(resultado.data.map(e => e.codGrupo));
    const pares = new Set(resultado.data.map(e => `${e.codGrupo}|${e.codSubtipo}`));

    const syncActivaPrevia = await prisma.equipoActivoCatalogoSync.findFirst({
      where: { empresa, activa: true },
    });

    // Ajuste "NUNCA SUSTITUIR UNA VERSIÓN BUENA POR UNA PEOR" — se publica
    // (activa=true) solo si: (a) el recorrido trajo datos utilizables
    // (nunca por un fallo total de grupo_activo o un catálogo vacío), y
    // (b) si ya existía una réplica activa, la nueva no es una regresión
    // de volumen (nunca menos equipos que la que ya está publicada).
    let publicada = false;
    let motivoNoPublicada: string | undefined;
    if (resultado.grupoActivoFallido || resultado.data.length === 0) {
      motivoNoPublicada = 'Recorrido sin datos utilizables (fallo total de grupo_activo o catálogo vacío) — se conserva la réplica activa anterior.';
    } else if (syncActivaPrevia && resultado.data.length < syncActivaPrevia.totalEquipos) {
      motivoNoPublicada = `La nueva sincronización trajo menos equipos (${resultado.data.length}) que la réplica activa actual (${syncActivaPrevia.totalEquipos}) — se conserva la anterior para evitar una regresión.`;
    } else {
      publicada = true;
    }

    if (publicada && resultado.data.length > 0) {
      // Insertado en lotes — createMany con miles de filas en una sola
      // llamada arriesga el límite de parámetros del driver de Postgres.
      const TAMANO_LOTE = 500;
      for (let i = 0; i < resultado.data.length; i += TAMANO_LOTE) {
        const lote = resultado.data.slice(i, i + TAMANO_LOTE);
        await prisma.equipoActivoCatalogo.createMany({
          data: lote.map(eq => normalizarParaPersistencia(eq, empresa, sync.id)),
        });
      }
    }

    // Publicación atómica — nunca una ventana donde ninguna o ambas
    // sincronizaciones queden activas a la vez.
    await prisma.$transaction(async tx => {
      if (publicada) {
        await tx.equipoActivoCatalogoSync.updateMany({
          where: { empresa, activa: true, NOT: { id: sync.id } },
          data: { activa: false },
        });
      }
      await tx.equipoActivoCatalogoSync.update({
        where: { id: sync.id },
        data: {
          estado: 'COMPLETADO',
          activa: publicada,
          finalizadaEn: new Date(),
          totalEquipos: resultado.data.length,
          totalGrupos: grupos.size,
          totalPares: pares.size,
          incompleto: resultado.incompleto,
          grupoActivoFallido: resultado.grupoActivoFallido,
          gruposFallidos: resultado.gruposFallidos,
          paresFallidos: resultado.paresFallidos,
          detalleError: motivoNoPublicada ?? null,
        },
      });
    });

    return {
      sincronizacionId: sync.id,
      publicada,
      totalEquipos: resultado.data.length,
      totalGrupos: grupos.size,
      totalPares: pares.size,
      incompleto: resultado.incompleto,
      grupoActivoFallido: resultado.grupoActivoFallido,
      gruposFallidos: resultado.gruposFallidos,
      paresFallidos: resultado.paresFallidos,
      motivoNoPublicada,
    };
  } catch (error) {
    // Un error inesperado (ej. la BD se cae a mitad del insert) NUNCA dejó
    // la réplica activa anterior en riesgo (la transacción de publicación
    // ni siquiera se alcanzó) — solo se registra el lote como FALLIDO.
    await prisma.equipoActivoCatalogoSync.update({
      where: { id: sync.id },
      data: {
        estado: 'FALLIDO',
        finalizadaEn: new Date(),
        detalleError: error instanceof Error ? error.message.slice(0, 2000) : 'Error desconocido durante la sincronización.',
      },
    });
    throw error;
  }
}

function normalizarParaPersistencia(eq: EquipoActivoConsolidado, empresa: string, sincronizacionId: number) {
  const valorRaw = eq.valor;
  return {
    empresa,
    codGrupo: eq.codGrupo,
    codSubtipo: eq.codSubtipo,
    grupo: eq.grupo != null ? String(eq.grupo) : null,
    subTipo: eq.sub_tipo != null ? String(eq.sub_tipo) : null,
    nombre: String(eq.nombre_c ?? '—'),
    uen: eq.uen != null ? String(eq.uen) : null,
    empresaC: eq.empresa_c != null ? String(eq.empresa_c) : null,
    fechaAdquisicion: eq.fecha_adquisicion != null ? String(eq.fecha_adquisicion) : null,
    valor: valorRaw != null && valorRaw !== '' && !Number.isNaN(Number(valorRaw)) ? Number(valorRaw) : null,
    estado: eq.estado != null ? String(eq.estado) : null,
    estadoProducto: eq.estado_producto != null ? String(eq.estado_producto) : null,
    sincronizacionId,
  };
}

export interface CatalogoDesdeReplica {
  /** false = todavía no existe ninguna sincronización COMPLETADA y publicada para esta empresa (ambiente nuevo). */
  inicializado: boolean;
  data: Record<string, unknown>[];
  incompleto: boolean;
  grupoActivoFallido: boolean;
  gruposFallidos: number;
  paresFallidos: number;
  paresConsultados: number;
  sincronizadoEn: Date | null;
  sincronizacionId: number | null;
}

/**
 * Lectura RÁPIDA desde la réplica en BD — nunca toca el proveedor externo.
 * Es lo único que el endpoint HTTP debe usar en el camino caliente del
 * modal (nunca `obtenerCatalogoConsolidadoEmpresa` directamente).
 */
export async function leerCatalogoActivoDesdeReplica(empresa: string): Promise<CatalogoDesdeReplica> {
  const key = empresa.trim().toLowerCase();
  const sync = await prisma.equipoActivoCatalogoSync.findFirst({
    where: { empresa: key, activa: true },
  });
  if (!sync) {
    return {
      inicializado: false, data: [], incompleto: false, grupoActivoFallido: false,
      gruposFallidos: 0, paresFallidos: 0, paresConsultados: 0, sincronizadoEn: null, sincronizacionId: null,
    };
  }
  const equipos = await prisma.equipoActivoCatalogo.findMany({ where: { sincronizacionId: sync.id } });
  return {
    inicializado: true,
    // Se re-expone con los nombres CRUDOS que route.ts ya sabe leer
    // (nombre_c/sub_tipo/fecha_adquisicion/valor/empresa_c) — nunca se
    // reescribe esa capa de normalización, solo cambia de dónde vienen
    // los datos.
    data: equipos.map(eq => ({
      codGrupo: eq.codGrupo,
      codSubtipo: eq.codSubtipo,
      grupo: eq.grupo,
      sub_tipo: eq.subTipo,
      nombre_c: eq.nombre,
      uen: eq.uen,
      empresa_c: eq.empresaC,
      fecha_adquisicion: eq.fechaAdquisicion,
      valor: eq.valor != null ? Number(eq.valor) : null,
      estado: eq.estado,
      estado_producto: eq.estadoProducto,
    })),
    incompleto: sync.incompleto,
    grupoActivoFallido: sync.grupoActivoFallido,
    gruposFallidos: sync.gruposFallidos,
    paresFallidos: sync.paresFallidos,
    paresConsultados: sync.totalPares,
    sincronizadoEn: sync.finalizadaEn,
    sincronizacionId: sync.id,
  };
}
