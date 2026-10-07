-- ════════════════════════════════════════════════════════════════════════════
-- B.4.5 · Migración #3 — Realinear Postgres-B4-Candidate al schema COMPLETO
--         de licycolba-final (prisma/schema.prisma).
--
-- PROPUESTA. NO aplicada a la candidata real. Vive fuera de prisma/migrations/.
--
-- Naturaleza: ADITIVA + IDEMPOTENTE. Cero DROP de datos. El único ALTER no
-- puramente aditivo es un RENAME COLUMN NO destructivo, GUARDADO para que la
-- migración sea también un NO-OP cuando la BASE YA está en el schema completo
-- (p.ej. al replay de la cadena baseline→fase_b3→#3 en la shadow DB de Prisma,
-- donde `Proceso.estadoFuente` ya existe). Así:
--   · contra la candidata (columna física `estado`)  → realinea de verdad.
--   · contra una BD ya-completa (columna `estadoFuente`) → no hace nada.
--
-- Origen del delta: `prisma migrate diff` (candidata real read-only vs
-- prisma/schema.prisma), con dos correcciones manuales documentadas:
--   (a) `DROP COLUMN "estado" + ADD COLUMN "estadoFuente"` → `RENAME COLUMN`
--       guardado (la columna canónica `estado` ES el `estadoFuente` de la app).
--   (b) `DROP INDEX` de los 4 índices UNIQUE parciales (regla_trm_una_*,
--       conjunto_metodos_uno_*) → OMITIDO: ya existen en ambas bases; Prisma
--       solo los marca porque su DSL no los expresa.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- 1 ─ Proceso: renombrar la columna canónica al nombre físico que emite
--     @prisma/client (`estadoFuente`). GUARDADO: solo si existe `estado` y aún
--     no existe `estadoFuente`.
DO $rename$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'Proceso' AND column_name = 'estado')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'Proceso' AND column_name = 'estadoFuente')
  THEN
    EXECUTE 'ALTER TABLE "Proceso" RENAME COLUMN "estado" TO "estadoFuente"';
  END IF;
END
$rename$;

-- 2 ─ Proceso: columnas de la app aún no presentes. NULLABLE, sin default →
--     para las filas de Data API quedan NULL (idéntico al estado actual de
--     producción para las filas `local:%` manuales).
ALTER TABLE "Proceso"
  ADD COLUMN IF NOT EXISTS "externalId"           TEXT,
  ADD COLUMN IF NOT EXISTS "fuente"               TEXT,
  ADD COLUMN IF NOT EXISTS "aliasFuente"          TEXT,
  ADD COLUMN IF NOT EXISTS "linkSecop"            TEXT,
  ADD COLUMN IF NOT EXISTS "linkSecopReg"         TEXT,
  ADD COLUMN IF NOT EXISTS "rawJson"              TEXT,
  ADD COLUMN IF NOT EXISTS "scraperIntentos"      INTEGER,
  ADD COLUMN IF NOT EXISTS "scraperUltimoIntento" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "scraperError"         TEXT,
  ADD COLUMN IF NOT EXISTS "scraperEstado"        TEXT,
  ADD COLUMN IF NOT EXISTS "scraperTipoFuente"    TEXT,
  ADD COLUMN IF NOT EXISTS "scraperScore"         DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "scraperTodosLinks"    TEXT;

-- 3 ─ Solicitud / DeletedSolicitud: columnas espejo del proceso (FUNCIONALES —
--     `propagarEstadoFuenteSolicitudes` y la UI de Solicitudes las usan).
ALTER TABLE "Solicitud"
  ADD COLUMN IF NOT EXISTS "externalId"   TEXT,
  ADD COLUMN IF NOT EXISTS "fuente"       TEXT,
  ADD COLUMN IF NOT EXISTS "aliasFuente"  TEXT,
  ADD COLUMN IF NOT EXISTS "estadoFuente" TEXT,
  ADD COLUMN IF NOT EXISTS "linkSecop"    TEXT,
  ADD COLUMN IF NOT EXISTS "linkSecopReg" TEXT;

ALTER TABLE "DeletedSolicitud"
  ADD COLUMN IF NOT EXISTS "externalId"   TEXT,
  ADD COLUMN IF NOT EXISTS "fuente"       TEXT,
  ADD COLUMN IF NOT EXISTS "aliasFuente"  TEXT,
  ADD COLUMN IF NOT EXISTS "estadoFuente" TEXT,
  ADD COLUMN IF NOT EXISTS "linkSecop"    TEXT,
  ADD COLUMN IF NOT EXISTS "linkSecopReg" TEXT;

-- 4 ─ ProcesoNuevo: tabla del feed "Nuevos" (histórica). Se crea VACÍA; se
--     puebla en C2.2 desde producción. Los 3 lectores migrarán a `Proceso`
--     (ver auditoría D1) — esta tabla queda como respaldo histórico.
CREATE TABLE IF NOT EXISTS "ProcesoNuevo" (
    "id"               SERIAL NOT NULL,
    "procesoId"        INTEGER,
    "sourceKey"        TEXT NOT NULL,
    "codigoProceso"    TEXT,
    "nombre"           TEXT,
    "entidad"          TEXT,
    "objeto"           TEXT,
    "fuente"           TEXT,
    "aliasFuente"      TEXT,
    "modalidad"        TEXT,
    "perfil"           TEXT,
    "departamento"     TEXT,
    "estadoFuente"     TEXT,
    "fechaPublicacion" TIMESTAMP(3),
    "fechaVencimiento" TIMESTAMP(3),
    "valor"            DOUBLE PRECISION,
    "linkDetalle"      TEXT,
    "linkSecop"        TEXT,
    "linkSecopReg"     TEXT,
    "fechaDeteccion"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "duracion"         TEXT,
    CONSTRAINT "ProcesoNuevo_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ProcesoNuevo_sourceKey_key"      ON "ProcesoNuevo"("sourceKey");
CREATE INDEX        IF NOT EXISTS "ProcesoNuevo_fechaDeteccion_idx" ON "ProcesoNuevo"("fechaDeteccion");
CREATE INDEX        IF NOT EXISTS "ProcesoNuevo_perfil_idx"         ON "ProcesoNuevo"("perfil");
CREATE INDEX        IF NOT EXISTS "ProcesoNuevo_aliasFuente_idx"    ON "ProcesoNuevo"("aliasFuente");
CREATE INDEX        IF NOT EXISTS "ProcesoNuevo_codigoProceso_idx"  ON "ProcesoNuevo"("codigoProceso");

-- 5 ─ Índices de la app sobre las columnas nuevas
CREATE UNIQUE INDEX IF NOT EXISTS "Proceso_externalId_key" ON "Proceso"("externalId");
CREATE INDEX IF NOT EXISTS "Proceso_aliasFuente_idx"  ON "Proceso"("aliasFuente");
CREATE INDEX IF NOT EXISTS "Proceso_estadoFuente_idx" ON "Proceso"("estadoFuente");
CREATE INDEX IF NOT EXISTS "Proceso_scraperEstado_scraperIntentos_idx"        ON "Proceso"("scraperEstado","scraperIntentos");
CREATE INDEX IF NOT EXISTS "Proceso_scraperIntentos_scraperUltimoIntento_idx" ON "Proceso"("scraperIntentos","scraperUltimoIntento");
CREATE INDEX IF NOT EXISTS "Proceso_scraperUltimoIntento_idx" ON "Proceso"("scraperUltimoIntento");
CREATE INDEX IF NOT EXISTS "idx_proceso_alias_fuente"  ON "Proceso"("aliasFuente");
CREATE INDEX IF NOT EXISTS "Solicitud_aliasFuente_idx" ON "Solicitud"("aliasFuente");

COMMIT;
