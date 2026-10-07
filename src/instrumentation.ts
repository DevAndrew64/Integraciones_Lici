/**
 * Scheduler interno de tareas programadas.
 * Corre dentro del proceso de Next.js (Node.js runtime).
 *
 * REPO SHARE-READY (B5): la adquisición/sincronización de procesos es
 * exclusivamente vía la Data API. Los cron de sincronización SOLO se
 * registran cuando el modo efectivo es 'data-api' (ver `./lib/data-api/sync/modo`).
 * Con modo 'disabled' (default seguro de un deployment nuevo) NO se registra
 * ningún job de adquisición: al clonar y arrancar el repo no comienza ningún
 * scraper/sync automáticamente.
 *
 * Los jobs ajenos a la adquisición de procesos (limpieza de notificaciones,
 * TRM) se registran siempre.
 *
 * Horarios Colombia (America/Bogota):
 *   Sync principal (solo modo data-api)  → cada 5 minutos (*​/5 * * * *)
 *   Sync profundo  (solo modo data-api)  → 04:00 diario
 *   Limpieza notificaciones              → 03:00 diario
 *   TRM                                   → 07:30, 18:30
 *
 * Overrides vía variables de entorno:
 *   SYNC_CRON, SYNC_PROFUNDO_CRON, SYNC_LIMPIAR_CRON, TRM_CRON
 *
 * El sync principal corre cada 5 minutos en modo data-api. La protección
 * contra solapamiento es de doble capa: bandera in-process
 * (`jobSyncProcesos`) + `pg_advisory_lock` en `ejecutarSyncRuntime` (exclusión
 * mutua real incluso con varias instancias). Si una corrida tarda más de 5
 * min, la siguiente se omite (log `[data-api-sync] omitido: ...`).
 */

/**
 * Guardia de registro único: `register()` puede invocarse más de una vez
 * (recarga de módulos en dev, doble import del entrypoint). Sin esto se
 * apilarían cron duplicados en el mismo proceso.
 */
let schedulerRegistrado = false;

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (schedulerRegistrado) {
    console.log('[cron] scheduler ya registrado en este proceso — se omite el registro duplicado');
    return;
  }
  schedulerRegistrado = true;

  const { default: cron } = await import('node-cron');
  const { modoSyncRuntime } = await import('@/lib/data-api/sync/modo');

  const SYNC_CRON          = process.env.SYNC_CRON          ?? '*/5 * * * *';
  const SYNC_PROFUNDO_CRON = process.env.SYNC_PROFUNDO_CRON ?? '0 4 * * *';
  const SYNC_LIMPIAR_CRON  = process.env.SYNC_LIMPIAR_CRON  ?? '0 3 * * *';
  const TRM_CRON           = process.env.TRM_CRON           ?? '30 7,18 * * *';

  const TZ = { timezone: 'America/Bogota' };

  const modo = modoSyncRuntime();
  const syncHabilitado = modo === 'data-api';

  // ── Sync principal + sync profundo — SOLO en modo data-api ───────────────
  if (syncHabilitado) {
    cron.schedule(SYNC_CRON, async () => {
      const { ejecutarJobSyncProcesos } = await import('@/lib/data-api/sync/jobSyncProcesos');
      await ejecutarJobSyncProcesos({ profundo: false });
    }, TZ);

    cron.schedule(SYNC_PROFUNDO_CRON, async () => {
      const { ejecutarJobSyncProcesos } = await import('@/lib/data-api/sync/jobSyncProcesos');
      await ejecutarJobSyncProcesos({ profundo: true });
    }, TZ);

    console.log('[cron] sync (data-api) registrado', { sync: SYNC_CRON, profundo: SYNC_PROFUNDO_CRON, tz: 'America/Bogota' });
  } else {
    console.log(`[cron] sync de procesos NO registrado (modo='${modo}') — la app opera en modo lectura para procesos`);
  }

  // ── Limpieza de notificaciones — siempre ────────────────────────────────
  cron.schedule(SYNC_LIMPIAR_CRON, async () => {
    try {
      const prisma = (await import('@/lib/prisma')).default;
      const hace30Dias = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const { count } = await prisma.notificacion.deleteMany({
        where: { leida: true, creadoEn: { lt: hace30Dias } },
      });
      console.log(`[cron] limpiar-notificaciones: ${count} eliminadas`);
    } catch (err) {
      console.error('[cron] limpiar-notificaciones falló', err instanceof Error ? err.message : err);
    }
  }, TZ);

  // ── TRM: actualizar histórico + recalibrar modelo si hay evento nuevo ───
  cron.schedule(TRM_CRON, async () => {
    try {
      const { jobTrmDiario } = await import('@/lib/trm/trmJobs');
      const result = await jobTrmDiario();
      console.log('[cron] trm-diario completado', {
        historico: result.actualizacion.nuevosHistorico,
        eventos: result.actualizacion.nuevosEventos,
        recalibrado: result.recalibracion?.ok ?? false,
        decimal: result.recalibracion?.decimalRecomendado,
      });
    } catch (err) {
      console.error('[cron] trm-diario falló', err instanceof Error ? err.message : err);
    }
  }, TZ);

  console.log('[cron] scheduler iniciado', {
    limpiar: SYNC_LIMPIAR_CRON,
    trm:     TRM_CRON,
    syncProcesos: syncHabilitado ? 'data-api' : 'desactivado',
    tz: 'America/Bogota',
  });
}
