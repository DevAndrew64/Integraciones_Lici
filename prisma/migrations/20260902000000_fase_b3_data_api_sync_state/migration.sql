-- FASE B.3 — espejo local de la Licycolba Data API + estado de sincronización.
--
-- Base generada con:
--   npx prisma migrate diff --from-schema <schema pre-B.3> --to-schema prisma/schema.prisma --script
-- (sin reescrituras cosméticas manuales sobre esa base).
--
-- Delta EXACTO aprobado para B.3 — nada más:
--   · Proceso.disponibleDataApi / retiradoDataApiEn / ultimoSnapshotId / origenFuncional
--   · enum OrigenFuncionalCanonico (MANUAL | PUBLICO_ABIERTO | PUBLICO_REGISTRADO | PRIVADO | DESCONOCIDO)
--   · ProcesoDocumentoSecop.dataApiDocId + UNIQUE(procesoId, dataApiDocId)
--   · Notificacion.claveIdempotencia + UNIQUE
--   · DataApiSyncState (singleton, clave = 'procesos')
--
-- `disponibleDataApi` entra con DEFAULT false: sobre una base con procesos
-- legacy, ninguno queda marcado como "disponible en la Data API" solo por
-- existir. Todas las columnas nuevas son nullable salvo `disponibleDataApi`,
-- así que la migración es segura sobre tablas con datos preexistentes.

-- CreateEnum
CREATE TYPE "OrigenFuncionalCanonico" AS ENUM ('MANUAL', 'PUBLICO_ABIERTO', 'PUBLICO_REGISTRADO', 'PRIVADO', 'DESCONOCIDO');

-- AlterTable
ALTER TABLE "Notificacion" ADD COLUMN     "claveIdempotencia" TEXT;

-- AlterTable
ALTER TABLE "Proceso" ADD COLUMN     "disponibleDataApi" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "origenFuncional" "OrigenFuncionalCanonico",
ADD COLUMN     "retiradoDataApiEn" TIMESTAMP(3),
ADD COLUMN     "ultimoSnapshotId" TEXT;

-- AlterTable
ALTER TABLE "ProcesoDocumentoSecop" ADD COLUMN     "dataApiDocId" TEXT;

-- CreateTable
CREATE TABLE "DataApiSyncState" (
    "clave" TEXT NOT NULL,
    "checkpointCursor" TEXT,
    "checkpointActualizadoEn" TIMESTAMP(3),
    "fullResyncSnapshotId" TEXT,
    "fullResyncNextPageCursor" TEXT,
    "fullResyncIniciadoEn" TIMESTAMP(3),

    CONSTRAINT "DataApiSyncState_pkey" PRIMARY KEY ("clave")
);

-- CreateIndex
CREATE UNIQUE INDEX "Notificacion_claveIdempotencia_key" ON "Notificacion"("claveIdempotencia");

-- CreateIndex
CREATE UNIQUE INDEX "ProcesoDocumentoSecop_procesoId_dataApiDocId_key" ON "ProcesoDocumentoSecop"("procesoId", "dataApiDocId");
