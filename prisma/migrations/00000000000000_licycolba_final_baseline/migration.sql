-- FASE B.3B.1R — BASELINE LIMPIO de licycolba-final.
--
-- Reemplaza las 29 migraciones históricas heredadas del proyecto original
-- (cadena que NO podía reconstruir una base desde cero: ninguna creaba
-- "LecturaAnalisis"). Representa EXACTAMENTE el schema funcional
-- inmediatamente ANTES del delta B.3.
--
-- Generado con:
--   npx prisma migrate diff --from-empty --to-schema <schema pre-B.3> --script
-- + apéndice manual (abajo) con los objetos PostgreSQL que Prisma Schema no
--   puede expresar (funciones/triggers updatedAt + índices UNIQUE parciales),
--   copiados verbatim de las migraciones históricas 20260630000000 /
--   20260700000000 / 20260901120000_fase_a1 (decisión aprobada: A + C).
-- + la extensión pgvector (decisión aprobada: E), requerida por el tipo
--   `vector(3072)` de AsistenteConocimiento.embedding y que ninguna migración
--   histórica creaba (se instalaba fuera de banda, igual que "LecturaAnalisis").
--
-- NO contiene el delta B.3 — ese va aparte en
-- 20260902000000_fase_b3_data_api_sync_state. Cadena: EMPTY -> ESTE -> B.3.

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateExtension (decisión E) — pgvector. DEBE ir antes de cualquier CREATE
-- TABLE que use vector(...), en particular "AsistenteConocimiento".
CREATE EXTENSION IF NOT EXISTS vector;

-- CreateEnum
CREATE TYPE "EstadoRevisionPliego" AS ENUM ('SIN_ANALIZAR', 'PENDIENTE_REVISION', 'REQUIERE_REVISION_PLIEGO', 'PLIEGO_VERIFICADO', 'NO_APLICA_TRM');

-- CreateEnum
CREATE TYPE "EstadoAnalisisDocumento" AS ENUM ('PENDIENTE', 'ANALIZANDO', 'ANALIZADO', 'ERROR');

-- CreateEnum
CREATE TYPE "EstadoVersionRegla" AS ENUM ('CANDIDATA', 'ACTIVA', 'SUPERSEDED', 'RECHAZADA');

-- CreateEnum
CREATE TYPE "OrigenTransicion" AS ENUM ('HUMANO', 'SISTEMA');

-- CreateEnum
CREATE TYPE "TipoReglaTrm" AS ENUM ('RELATIVA_A_EVENTO', 'FECHA_FIJA', 'NO_APLICA', 'OTRA');

-- CreateEnum
CREATE TYPE "EventoBaseTrm" AS ENUM ('FECHA_CIERRE', 'FECHA_PRESENTACION_OFERTAS', 'FIN_TRASLADO_INFORME_EVALUACION', 'AUDIENCIA_ADJUDICACION', 'OTRO');

-- CreateEnum
CREATE TYPE "PoliticaActualizacionFechaTrm" AS ENUM ('SIGUE_CRONOGRAMA', 'CONGELADA_INICIAL', 'OTRA');

-- CreateEnum
CREATE TYPE "ReglaCentavos" AS ENUM ('NO_DEFINIDA', 'REDONDEO', 'TRUNCADO', 'OTRA');

-- CreateEnum
CREATE TYPE "UsoPonderacionTrm" AS ENUM ('SI', 'NO', 'NO_DETERMINADO');

-- CreateEnum
CREATE TYPE "BaseEconomicaEvaluada" AS ENUM ('TOTAL_OFERTA', 'COMPONENTE_ESPECIFICO', 'OTRA');

-- CreateEnum
CREATE TYPE "EquivalenciaFormulaMotor" AS ENUM ('NO_EVALUADA', 'EQUIVALENTE_CONFIRMADA', 'NO_EQUIVALENTE', 'DESCONOCIDA');

-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "cedula" TEXT NOT NULL,
    "celular" TEXT NOT NULL,
    "entidadGrupo" TEXT NOT NULL,
    "cargo" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "usuario" TEXT NOT NULL,
    "rol" TEXT NOT NULL,
    "estado" TEXT NOT NULL,
    "firmaDigital" TEXT,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "proceso" TEXT,
    "subproceso" TEXT,
    "uen" TEXT,
    "sessionVersion" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeletedUser" (
    "id" SERIAL NOT NULL,
    "originalUserId" INTEGER,
    "cedula" TEXT NOT NULL,
    "celular" TEXT NOT NULL,
    "entidadGrupo" TEXT NOT NULL,
    "cargo" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "usuario" TEXT NOT NULL,
    "rol" TEXT NOT NULL,
    "estado" TEXT NOT NULL,
    "firmaDigital" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedByUsuario" TEXT,
    "deletedByEmail" TEXT,
    "deletedByCargo" TEXT,
    "proceso" TEXT,
    "subproceso" TEXT,
    "uen" TEXT,

    CONSTRAINT "DeletedUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notificacion" (
    "id" SERIAL NOT NULL,
    "tipo" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "descripcion" TEXT,
    "codigoProceso" TEXT,
    "procesoId" INTEGER,
    "entidad" TEXT,
    "perfil" TEXT,
    "leida" BOOLEAN NOT NULL DEFAULT false,
    "datos" JSONB,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leidaEn" TIMESTAMP(3),

    CONSTRAINT "Notificacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Proceso" (
    "id" SERIAL NOT NULL,
    "externalId" TEXT,
    "codigoProceso" TEXT,
    "nombre" TEXT,
    "entidad" TEXT,
    "objeto" TEXT,
    "fuente" TEXT,
    "aliasFuente" TEXT,
    "modalidad" TEXT,
    "perfil" TEXT,
    "departamento" TEXT,
    "estadoFuente" TEXT,
    "fechaPublicacion" TIMESTAMP(3),
    "fechaVencimiento" TIMESTAMP(3),
    "valor" DOUBLE PRECISION,
    "linkDetalle" TEXT,
    "linkSecop" TEXT,
    "linkSecopReg" TEXT,
    "totalCronogramas" INTEGER NOT NULL DEFAULT 0,
    "totalDocumentos" INTEGER NOT NULL DEFAULT 0,
    "rawJson" TEXT,
    "hashContenido" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "duracion" TEXT,
    "fechaVencimientoAnterior" TIMESTAMP(3),
    "fechaCambioFechaCierre" TIMESTAMP(3),
    "tieneCambioFechaCierre" BOOLEAN NOT NULL DEFAULT false,
    "noViable" BOOLEAN NOT NULL DEFAULT false,
    "observacionNoViable" TEXT,
    "noViableRegistradoPor" TEXT,
    "noViableFecha" TIMESTAMP(3),
    "actividadLicy" TEXT,
    "clasificacionAt" TIMESTAMP(3),
    "unspsc" TEXT,
    "scraperIntentos" INTEGER,
    "scraperUltimoIntento" TIMESTAMP(3),
    "scraperError" TEXT,
    "scraperEstado" TEXT,
    "scraperTipoFuente" TEXT,
    "scraperScore" DOUBLE PRECISION,
    "scraperTodosLinks" TEXT,
    "oculto" BOOLEAN DEFAULT false,
    "estadoRevisionPliego" "EstadoRevisionPliego" NOT NULL DEFAULT 'SIN_ANALIZAR',
    "usaPonderacionTrm" "UsoPonderacionTrm" NOT NULL DEFAULT 'NO_DETERMINADO',

    CONSTRAINT "Proceso_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcesoDetalleSecop" (
    "id" SERIAL NOT NULL,
    "procesoId" INTEGER NOT NULL,
    "urlConsulta" TEXT,
    "urlFinal" TEXT,
    "titulo" TEXT,
    "estado" TEXT,
    "fase" TEXT,
    "tipoProceso" TEXT,
    "tipoContrato" TEXT,
    "justificacionModalidad" TEXT,
    "duracionContrato" TEXT,
    "fechaTerminacion" TIMESTAMP(3),
    "direccionEjecucion" TEXT,
    "codigoUnspsc" TEXT,
    "unspscAdicionales" JSONB,
    "esMipymes" BOOLEAN,
    "esPaa" BOOLEAN,
    "vigenciaPaa" TEXT,
    "misionVision" TEXT,
    "valorAdquisiciones" DOUBLE PRECISION,
    "valorTotalProceso" DOUBLE PRECISION,
    "cuestionarioJson" JSONB,
    "informacionPresupuestal" JSONB,
    "textoPlano" TEXT,
    "hashDetalle" TEXT,
    "capturadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProcesoDetalleSecop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcesoCronogramaSecop" (
    "id" SERIAL NOT NULL,
    "procesoId" INTEGER NOT NULL,
    "evento" TEXT NOT NULL,
    "valorTexto" TEXT,
    "fechaInicio" TIMESTAMP(3),
    "fechaFin" TIMESTAMP(3),
    "zonaHoraria" TEXT,
    "orden" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "valorTextoAnterior" TEXT,
    "fechaActualizacion" TIMESTAMP(3),
    "tieneCambioFecha" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ProcesoCronogramaSecop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcesoDocumentoSecop" (
    "id" SERIAL NOT NULL,
    "procesoId" INTEGER NOT NULL,
    "nombre" TEXT NOT NULL,
    "urlDocumento" TEXT,
    "tipoDocumento" TEXT,
    "extension" TEXT,
    "hashArchivo" TEXT,
    "rutaLocal" TEXT,
    "mimeType" TEXT,
    "tamanoBytes" INTEGER,
    "textoExtraido" TEXT,
    "descargado" BOOLEAN NOT NULL DEFAULT false,
    "procesado" BOOLEAN NOT NULL DEFAULT false,
    "fechaDetectado" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProcesoDocumentoSecop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcesoSnapshotSecop" (
    "id" SERIAL NOT NULL,
    "procesoId" INTEGER NOT NULL,
    "urlConsulta" TEXT,
    "hashContenido" TEXT,
    "payloadJson" JSONB NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcesoSnapshotSecop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcesoNuevo" (
    "id" SERIAL NOT NULL,
    "procesoId" INTEGER,
    "sourceKey" TEXT NOT NULL,
    "codigoProceso" TEXT,
    "nombre" TEXT,
    "entidad" TEXT,
    "objeto" TEXT,
    "fuente" TEXT,
    "aliasFuente" TEXT,
    "modalidad" TEXT,
    "perfil" TEXT,
    "departamento" TEXT,
    "estadoFuente" TEXT,
    "fechaPublicacion" TIMESTAMP(3),
    "fechaVencimiento" TIMESTAMP(3),
    "valor" DOUBLE PRECISION,
    "linkDetalle" TEXT,
    "linkSecop" TEXT,
    "linkSecopReg" TEXT,
    "fechaDeteccion" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "duracion" TEXT,

    CONSTRAINT "ProcesoNuevo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Solicitud" (
    "id" SERIAL NOT NULL,
    "procesoId" INTEGER,
    "procesoSourceKey" TEXT,
    "externalId" TEXT,
    "codigoProceso" TEXT,
    "nombreProceso" TEXT,
    "entidad" TEXT,
    "objeto" TEXT,
    "fuente" TEXT,
    "aliasFuente" TEXT,
    "modalidad" TEXT,
    "perfil" TEXT,
    "departamento" TEXT,
    "estadoFuente" TEXT,
    "fechaPublicacion" TIMESTAMP(3),
    "fechaVencimiento" TIMESTAMP(3),
    "valor" DOUBLE PRECISION,
    "linkDetalle" TEXT,
    "linkSecop" TEXT,
    "linkSecopReg" TEXT,
    "estadoSolicitud" TEXT NOT NULL DEFAULT 'En revisión',
    "observacion" TEXT,
    "usuarioRegistro" TEXT,
    "emailRegistro" TEXT,
    "cargoRegistro" TEXT,
    "entidadRegistro" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "aprobador" TEXT,
    "asignaciones" JSONB NOT NULL DEFAULT '[]',
    "ciudad" TEXT,
    "docData" JSONB NOT NULL DEFAULT '[]',
    "fechaCierre" TIMESTAMP(3),
    "obsData" JSONB NOT NULL DEFAULT '[]',
    "plataforma" TEXT,
    "procData" JSONB NOT NULL DEFAULT '{}',
    "procStep" INTEGER NOT NULL DEFAULT 0,
    "revisor" TEXT,
    "sede" TEXT,
    "causalCierre" TEXT,
    "fechaAperturaSqr" TIMESTAMP(3),
    "fechaCierreSqr" TIMESTAMP(3),
    "resultadoFinal" TEXT,
    "sqrCerrada" BOOLEAN NOT NULL DEFAULT false,
    "sqrCreada" BOOLEAN NOT NULL DEFAULT false,
    "sqrError" TEXT,
    "sqrNumero" TEXT,
    "sqrCierreEstado" TEXT,
    "estadoFinalSqr" BOOLEAN,
    "origenSolicitud" TEXT NOT NULL DEFAULT 'Comercial',
    "correoContacto" TEXT,
    "direccionContacto" TEXT,
    "nitContacto" TEXT,
    "personaContacto" TEXT,
    "telefonoContacto" TEXT,
    "duracion" TEXT,
    "fechaEntregaInfo" TIMESTAMP(3),
    "observacionesSeguimiento" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "Solicitud_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeletedSolicitud" (
    "id" SERIAL NOT NULL,
    "originalId" INTEGER,
    "procesoId" INTEGER,
    "procesoSourceKey" TEXT,
    "externalId" TEXT,
    "codigoProceso" TEXT,
    "nombreProceso" TEXT,
    "entidad" TEXT,
    "objeto" TEXT,
    "fuente" TEXT,
    "aliasFuente" TEXT,
    "modalidad" TEXT,
    "perfil" TEXT,
    "departamento" TEXT,
    "estadoFuente" TEXT,
    "fechaPublicacion" TIMESTAMP(3),
    "fechaVencimiento" TIMESTAMP(3),
    "valor" DOUBLE PRECISION,
    "linkDetalle" TEXT,
    "linkSecop" TEXT,
    "linkSecopReg" TEXT,
    "estadoSolicitud" TEXT,
    "observacion" TEXT,
    "ciudad" TEXT,
    "sede" TEXT,
    "plataforma" TEXT,
    "fechaCierre" TIMESTAMP(3),
    "procStep" INTEGER NOT NULL DEFAULT 0,
    "procData" JSONB NOT NULL DEFAULT '{}',
    "obsData" JSONB NOT NULL DEFAULT '[]',
    "docData" JSONB NOT NULL DEFAULT '[]',
    "asignaciones" JSONB NOT NULL DEFAULT '[]',
    "revisor" TEXT,
    "aprobador" TEXT,
    "usuarioRegistro" TEXT,
    "emailRegistro" TEXT,
    "cargoRegistro" TEXT,
    "entidadRegistro" TEXT,
    "createdAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedByUsuario" TEXT,
    "deletedByEmail" TEXT,
    "causalCierre" TEXT,
    "fechaAperturaSqr" TIMESTAMP(3),
    "fechaCierreSqr" TIMESTAMP(3),
    "resultadoFinal" TEXT,
    "sqrCerrada" BOOLEAN,
    "sqrCreada" BOOLEAN,
    "sqrError" TEXT,
    "sqrNumero" TEXT,
    "origenSolicitud" TEXT NOT NULL DEFAULT 'Comercial',
    "correoContacto" TEXT,
    "direccionContacto" TEXT,
    "nitContacto" TEXT,
    "personaContacto" TEXT,
    "telefonoContacto" TEXT,
    "duracion" TEXT,
    "fechaEntregaInfo" TIMESTAMP(3),

    CONSTRAINT "DeletedSolicitud_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PerfilRol" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT,
    "permisos" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PerfilRol_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Documento" (
    "id" SERIAL NOT NULL,
    "codigo" TEXT,
    "nombre" TEXT NOT NULL,
    "empresa" TEXT,
    "proceso" TEXT,
    "subcarpetaId" TEXT,
    "fechaEmision" TIMESTAMP(3),
    "frecuenciaDias" INTEGER,
    "diasTramite" INTEGER,
    "notas" TEXT,
    "correoContacto" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Documento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentoVersion" (
    "id" SERIAL NOT NULL,
    "documentoId" INTEGER NOT NULL,
    "version" INTEGER NOT NULL,
    "nombreArchivo" TEXT NOT NULL,
    "rutaLaravel" TEXT,
    "archivoBase64" TEXT,
    "archivoTipo" TEXT,
    "fechaEmision" TIMESTAMP(3),
    "fechaVencimiento" TIMESTAMP(3),
    "subidoPor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentoVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LecturaAnalisis" (
    "id" SERIAL NOT NULL,
    "nombreDocumento" TEXT NOT NULL,
    "urlDocumento" TEXT,
    "pdfHash" TEXT,
    "modo" TEXT,
    "pdfBlob" TEXT,
    "codigoProceso" TEXT,
    "entidad" TEXT,
    "resultado" JSONB NOT NULL,
    "tokensEntrada" INTEGER,
    "tokensSalida" INTEGER,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usuarioId" INTEGER,
    "fechaGestionInterna" TIMESTAMP(3),
    "usuarioGestionaId" INTEGER,
    "notasTrazabilidad" TEXT,
    "checklistEstados" JSONB,

    CONSTRAINT "LecturaAnalisis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RagDocumento" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,
    "codigoProceso" TEXT,
    "totalPaginas" INTEGER,
    "totalChunks" INTEGER NOT NULL DEFAULT 0,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RagDocumento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RagChunk" (
    "id" SERIAL NOT NULL,
    "documentoId" INTEGER NOT NULL,
    "indice" INTEGER NOT NULL,
    "texto" TEXT NOT NULL,

    CONSTRAINT "RagChunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeminiUsage" (
    "id" SERIAL NOT NULL,
    "modelo" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "tokensIn" INTEGER NOT NULL DEFAULT 0,
    "tokensOut" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "perfil" TEXT,
    "usuario" TEXT,
    "usuarioId" INTEGER,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GeminiUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CostoEstructura" (
    "id" SERIAL NOT NULL,
    "procesoCodigo" TEXT,
    "procesoNombre" TEXT,
    "cargo" TEXT,
    "nTrabajadores" INTEGER NOT NULL DEFAULT 1,
    "costoMO" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "costoEpp" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "costoExamenes" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "costoMaquinaria" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "costoAdmin" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "costoTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "datos" JSONB NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CostoEstructura_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HorarioCatalogo" (
    "id" SERIAL NOT NULL,
    "codigo" TEXT,
    "horario" TEXT NOT NULL,
    "turno" TEXT,
    "jornada" TEXT,
    "horasSemana" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "horasJornada" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "horaInicio" TEXT,
    "horaFin" TEXT,
    "porvar" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "codigoMidasoft" TEXT,
    "horasExtras" JSONB,
    "jornLun" BOOLEAN NOT NULL DEFAULT false,
    "jornMar" BOOLEAN NOT NULL DEFAULT false,
    "jornMie" BOOLEAN NOT NULL DEFAULT false,
    "jornJue" BOOLEAN NOT NULL DEFAULT false,
    "jornVie" BOOLEAN NOT NULL DEFAULT false,
    "jornSab" BOOLEAN NOT NULL DEFAULT false,
    "jornDom" BOOLEAN NOT NULL DEFAULT false,
    "jornFes" BOOLEAN NOT NULL DEFAULT false,
    "bonoLun" BOOLEAN NOT NULL DEFAULT false,
    "bonoMar" BOOLEAN NOT NULL DEFAULT false,
    "bonoMie" BOOLEAN NOT NULL DEFAULT false,
    "bonoJue" BOOLEAN NOT NULL DEFAULT false,
    "bonoVie" BOOLEAN NOT NULL DEFAULT false,
    "bonoSab" BOOLEAN NOT NULL DEFAULT false,
    "bonoDom" BOOLEAN NOT NULL DEFAULT false,
    "bonoFes" BOOLEAN NOT NULL DEFAULT false,
    "diaDescansoFijo" BOOLEAN NOT NULL DEFAULT false,
    "empresa" TEXT,
    "creadoPor" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sincronizadoExterno" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "HorarioCatalogo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParametrosLaborales" (
    "id" SERIAL NOT NULL,
    "anio" INTEGER NOT NULL,
    "smmlv" DOUBLE PRECISION NOT NULL,
    "auxilioTransporte" DOUBLE PRECISION NOT NULL,
    "topeAuxilioSmmlv" DOUBLE PRECISION NOT NULL,
    "horasMaxSemanaActual" DOUBLE PRECISION NOT NULL,
    "fechaCambioHoras" TIMESTAMP(3),
    "horasMaxSemanaPosterior" DOUBLE PRECISION,
    "divisorHora" DOUBLE PRECISION NOT NULL DEFAULT 240,
    "factorMensual" DOUBLE PRECISION NOT NULL DEFAULT 4.333,
    "metodoPeriodo" TEXT NOT NULL DEFAULT 'factor',
    "horaInicioNocturna" INTEGER NOT NULL,
    "horaFinNocturna" INTEGER NOT NULL,
    "recargoNocturno" DOUBLE PRECISION NOT NULL,
    "recargoExtraDiurno" DOUBLE PRECISION NOT NULL,
    "recargoExtraNocturno" DOUBLE PRECISION NOT NULL,
    "recargoDominical" DOUBLE PRECISION NOT NULL,
    "recargoDominicalNoc" DOUBLE PRECISION NOT NULL DEFAULT 0.75,
    "recargoFestivoDiu" DOUBLE PRECISION NOT NULL DEFAULT 0.75,
    "recargoFestivoNoc" DOUBLE PRECISION NOT NULL DEFAULT 0.75,
    "politicaDescansoDefault" BOOLEAN NOT NULL DEFAULT true,
    "minHorasTurnoParaDescanso" DOUBLE PRECISION NOT NULL DEFAULT 6.0,
    "descansoDefaultMinutos" INTEGER NOT NULL DEFAULT 60,
    "descansoComputableDefault" BOOLEAN NOT NULL DEFAULT false,
    "riesgoI" DOUBLE PRECISION NOT NULL,
    "riesgoII" DOUBLE PRECISION NOT NULL,
    "riesgoIII" DOUBLE PRECISION NOT NULL,
    "riesgoIV" DOUBLE PRECISION NOT NULL,
    "riesgoV" DOUBLE PRECISION NOT NULL,
    "fuenteNormativa" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ParametrosLaborales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AsistenteConocimiento" (
    "id" SERIAL NOT NULL,
    "empresa" TEXT,
    "modulo" TEXT,
    "titulo" TEXT NOT NULL,
    "contenido" TEXT NOT NULL,
    "tipo" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,
    "embedding" vector(3072),
    "embeddingModel" TEXT,
    "embeddingAt" TIMESTAMP(3),

    CONSTRAINT "AsistenteConocimiento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssistantMemory" (
    "id" SERIAL NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'GLOBAL',
    "empresa" TEXT,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 50,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssistantMemory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarioFestivos" (
    "id" SERIAL NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL,
    "nombre" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "anio" INTEGER NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "CalendarioFestivos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogoCargo" (
    "id" SERIAL NOT NULL,
    "empresaGrupo" TEXT NOT NULL,
    "cargoNormalizado" TEXT NOT NULL,
    "cargoAlias" TEXT[],
    "riesgoArlDefault" TEXT NOT NULL,
    "requiereExamenAltura" BOOLEAN NOT NULL DEFAULT false,
    "dotacionBasica" TEXT[],
    "eppBasico" TEXT[],
    "salarioBaseDefault" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "anio" INTEGER NOT NULL,

    CONSTRAINT "CatalogoCargo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogoRiesgoARL" (
    "id" SERIAL NOT NULL,
    "clase" TEXT NOT NULL,
    "porcentaje" DOUBLE PRECISION NOT NULL,
    "descripcion" TEXT NOT NULL,
    "actividades" TEXT[],
    "requiereAltura" BOOLEAN NOT NULL DEFAULT false,
    "anio" INTEGER NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "CatalogoRiesgoARL_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SolicitudManoObra" (
    "id" SERIAL NOT NULL,
    "procesoId" INTEGER,
    "cliente" TEXT NOT NULL,
    "ciudad" TEXT,
    "direccion" TEXT,
    "textoOriginal" TEXT NOT NULL,
    "servicioDetectado" TEXT,
    "empresaGrupo" TEXT,
    "duracionMeses" INTEGER,
    "requiereInsumos" BOOLEAN,
    "requiereDotacionEspecial" BOOLEAN,
    "requiereEppEspecial" BOOLEAN,
    "requiereAlturas" BOOLEAN,
    "multisede" BOOLEAN NOT NULL DEFAULT false,
    "estado" TEXT NOT NULL DEFAULT 'borrador',
    "geminiVersion" TEXT,
    "geminiExtraccionRaw" JSONB,
    "creadoPor" INTEGER,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,
    "aprobadoPor" INTEGER,
    "aprobadoEn" TIMESTAMP(3),

    CONSTRAINT "SolicitudManoObra_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EscenarioManoObra" (
    "id" SERIAL NOT NULL,
    "solicitudId" INTEGER NOT NULL,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT,
    "empresaGrupo" TEXT NOT NULL,
    "tipoServicio" TEXT NOT NULL,
    "sede" TEXT,
    "ciudad" TEXT,
    "esPrincipal" BOOLEAN NOT NULL DEFAULT false,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "aprobado" BOOLEAN NOT NULL DEFAULT false,
    "costoTotalMensual" DOUBLE PRECISION,

    CONSTRAINT "EscenarioManoObra_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CargoManoObra" (
    "id" SERIAL NOT NULL,
    "escenarioId" INTEGER NOT NULL,
    "catalogoCargoId" INTEGER,
    "cargoOriginal" TEXT NOT NULL,
    "cargoNormalizado" TEXT NOT NULL,
    "cantidadSolicitada" INTEGER NOT NULL,
    "cantidadPuestosPorTurno" INTEGER,
    "cantidadPersonasCalculadas" INTEGER,
    "fteTeorico" DOUBLE PRECISION,
    "requiereTurnante" BOOLEAN NOT NULL DEFAULT false,
    "tipoCobertura" TEXT NOT NULL,
    "diaDescansoObligatorio" TEXT,
    "jornadaSemanalDeclarada" DOUBLE PRECISION,
    "jornadaSemanalCalculada" DOUBLE PRECISION,
    "coincideJornada" BOOLEAN,
    "diferenciaHoras" DOUBLE PRECISION,
    "salarioBase" DOUBLE PRECISION,
    "fuenteSalario" TEXT,
    "claseRiesgoArl" TEXT,
    "porcentajeArl" DOUBLE PRECISION,
    "requiereValidacionArl" BOOLEAN NOT NULL DEFAULT true,
    "aplicaAuxilioTransporte" BOOLEAN,
    "requiereDotacion" BOOLEAN NOT NULL DEFAULT true,
    "requiereEpp" BOOLEAN NOT NULL DEFAULT true,
    "requiereExamenMedico" BOOLEAN NOT NULL DEFAULT true,
    "costoLaboral" JSONB,
    "inputsMensuales" JSONB,
    "editadoManualmente" BOOLEAN NOT NULL DEFAULT false,
    "observaciones" TEXT,

    CONSTRAINT "CargoManoObra_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TurnoManoObra" (
    "id" SERIAL NOT NULL,
    "cargoId" INTEGER NOT NULL,
    "dias" TEXT[],
    "horaInicio" TEXT NOT NULL,
    "horaFin" TEXT NOT NULL,
    "tipoDiaGemini" TEXT,
    "tipoDiaCalculado" TEXT,
    "cruzaMedianoche" BOOLEAN NOT NULL DEFAULT false,
    "descansoMinutos" INTEGER NOT NULL DEFAULT 0,
    "descansoComputable" BOOLEAN NOT NULL DEFAULT false,
    "horasBrutasDia" DOUBLE PRECISION,
    "horasNetasDia" DOUBLE PRECISION,
    "horasDiurnas" DOUBLE PRECISION,
    "horasNocturnas" DOUBLE PRECISION,
    "horasOrdDiurnas" DOUBLE PRECISION,
    "horasOrdNocturnas" DOUBLE PRECISION,
    "horasExtDiurnas" DOUBLE PRECISION,
    "horasExtNocturnas" DOUBLE PRECISION,
    "horasDomDiurnas" DOUBLE PRECISION,
    "horasDomNocturnas" DOUBLE PRECISION,
    "horasExtDomDiurnas" DOUBLE PRECISION,
    "horasExtDomNoc" DOUBLE PRECISION,
    "horasFestDiurnas" DOUBLE PRECISION,
    "horasFestNocturnas" DOUBLE PRECISION,
    "observaciones" TEXT,

    CONSTRAINT "TurnoManoObra_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlertaManoObra" (
    "id" SERIAL NOT NULL,
    "solicitudId" INTEGER,
    "escenarioId" INTEGER,
    "cargoId" INTEGER,
    "severidad" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "mensaje" TEXT NOT NULL,
    "fuenteNormativa" TEXT,
    "campoAfectado" TEXT,
    "revisada" BOOLEAN NOT NULL DEFAULT false,
    "revisadaPor" INTEGER,
    "revisadaEn" TIMESTAMP(3),
    "comentarioValidacion" TEXT,

    CONSTRAINT "AlertaManoObra_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PreguntaPendiente" (
    "id" SERIAL NOT NULL,
    "solicitudId" INTEGER,
    "escenarioId" INTEGER,
    "cargoId" INTEGER,
    "pregunta" TEXT NOT NULL,
    "prioridad" TEXT NOT NULL,
    "contexto" TEXT,
    "respondida" BOOLEAN NOT NULL DEFAULT false,
    "respuesta" TEXT,
    "respondidaEn" TIMESTAMP(3),

    CONSTRAINT "PreguntaPendiente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoginAttempt" (
    "id" SERIAL NOT NULL,
    "clave" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "resetAt" TIMESTAMP(3) NOT NULL,
    "actualizadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoginAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimitGemini" (
    "id" SERIAL NOT NULL,
    "usuarioId" INTEGER NOT NULL,
    "endpoint" TEXT NOT NULL,
    "fecha" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "actualizadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RateLimitGemini_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" SERIAL NOT NULL,
    "usuarioId" INTEGER,
    "email" TEXT,
    "rol" TEXT,
    "accion" TEXT NOT NULL,
    "recurso" TEXT,
    "recursoId" TEXT,
    "metodo" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "detalle" JSONB,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrmCache" (
    "id" SERIAL NOT NULL,
    "fecha" DATE NOT NULL,
    "valor" DECIMAL(12,4) NOT NULL,
    "centavos" INTEGER NOT NULL,
    "vigenciaDesde" DATE,
    "vigenciaHasta" DATE,
    "fuente" TEXT NOT NULL DEFAULT 'datos_gov_co',
    "fuenteUrl" TEXT,
    "esOficial" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrmCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrmConsultaLog" (
    "id" SERIAL NOT NULL,
    "fechaConsultada" DATE NOT NULL,
    "fuente" TEXT NOT NULL,
    "fuenteUrl" TEXT,
    "httpStatus" INTEGER,
    "exito" BOOLEAN NOT NULL,
    "valor" DECIMAL(12,4),
    "centavos" INTEGER,
    "vigenciaDesde" DATE,
    "vigenciaHasta" DATE,
    "error" TEXT,
    "respuestaRaw" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrmConsultaLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_clients" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,
    "apiKeyPrefix" TEXT NOT NULL,
    "apiKeyHash" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "empresasPermitidas" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "rateLimitPorMinuto" INTEGER NOT NULL DEFAULT 60,
    "expiraEn" TIMESTAMP(3),
    "ultimoUsoEn" TIMESTAMP(3),
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "api_clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trm_historico" (
    "id" SERIAL NOT NULL,
    "fecha" DATE NOT NULL,
    "trm" DECIMAL(12,4) NOT NULL,
    "fuente" TEXT NOT NULL DEFAULT 'datos_gov_co',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trm_historico_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trm_eventos_efectivos" (
    "id" SERIAL NOT NULL,
    "fecha" DATE NOT NULL,
    "trm" DECIMAL(12,4) NOT NULL,
    "eventoId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trm_eventos_efectivos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trm_predicciones" (
    "id" SERIAL NOT NULL,
    "fechaCalculo" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fechaObjetivo" DATE NOT NULL,
    "fechaTRMAplicable" DATE NOT NULL,
    "trmMedianaSimulada" DECIMAL(12,4),
    "decimalRecomendado" TEXT,
    "rangoPliego" TEXT,
    "metodoProbable" TEXT,
    "probabilidadDecimal" DECIMAL(6,4),
    "probabilidadRango" DECIMAL(6,4),
    "nivelConfianza" TEXT,
    "horizonteDiasHabiles" INTEGER NOT NULL,
    "modeloUsado" TEXT NOT NULL,
    "advertencia" TEXT,
    "ultimoEventoId" INTEGER,

    CONSTRAINT "trm_predicciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SimulacionPonderacion" (
    "id" SERIAL NOT NULL,
    "procesoId" INTEGER,
    "solicitudId" INTEGER,
    "numeroProceso" TEXT,
    "razonSocial" TEXT,
    "empresaGrupo" TEXT,
    "nombre" TEXT,
    "presupuestoOficial" DECIMAL(20,2) NOT NULL,
    "trmValor" DECIMAL(12,4) NOT NULL,
    "trmFecha" DATE NOT NULL,
    "trmCentavos" INTEGER NOT NULL,
    "trmFuente" TEXT NOT NULL,
    "trmCacheId" INTEGER,
    "metodoActivo" TEXT NOT NULL,
    "puntajeMaximo" DECIMAL(10,4) NOT NULL,
    "miOfertaPorcentaje" DECIMAL(8,4),
    "miOfertaValor" DECIMAL(20,2),
    "creadoPorId" INTEGER,
    "estado" TEXT NOT NULL DEFAULT 'borrador',
    "notas" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SimulacionPonderacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SimulacionCompetidor" (
    "id" SERIAL NOT NULL,
    "simulacionId" INTEGER NOT NULL,
    "nombre" TEXT,
    "porcentajeOferta" DECIMAL(8,4) NOT NULL,
    "valorOferta" DECIMAL(20,2),
    "fuente" TEXT NOT NULL DEFAULT 'manual',
    "probabilidadParticipacion" DECIMAL(5,4),
    "observaciones" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SimulacionCompetidor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SimulacionResultadoMetodo" (
    "id" SERIAL NOT NULL,
    "simulacionId" INTEGER NOT NULL,
    "metodo" TEXT NOT NULL,
    "porcentajeOptimo" DECIMAL(8,4) NOT NULL,
    "valorOptimo" DECIMAL(20,2) NOT NULL,
    "puntajeOptimo" DECIMAL(10,4) NOT NULL,
    "miOfertaPorcentaje" DECIMAL(8,4),
    "miOfertaPuntaje" DECIMAL(10,4),
    "diferenciaPuntos" DECIMAL(10,4),
    "esMetodoActivo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SimulacionResultadoMetodo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MetodoPonderacionProceso" (
    "id" SERIAL NOT NULL,
    "procesoId" INTEGER,
    "codigoProceso" TEXT,
    "lecturaAnalisisId" INTEGER,
    "analisisEconomicoProcesoId" INTEGER,
    "conjuntoMetodosId" INTEGER,
    "razonSocial" TEXT,
    "empresaGrupo" TEXT,
    "presupuestoOficial" DECIMAL(20,2),
    "puntajeMaximo" DECIMAL(10,4),
    "nombreMetodo" TEXT NOT NULL,
    "tipoFormula" TEXT NOT NULL,
    "rangoTrmDesde" INTEGER,
    "rangoTrmHasta" INTEGER,
    "condicionTrmTexto" TEXT,
    "baseEconomicaEvaluada" "BaseEconomicaEvaluada",
    "descripcionBaseEconomica" TEXT,
    "baseEconomicaTextoFuente" TEXT,
    "baseEconomicaPaginaReferencia" INTEGER,
    "formulaReferenciaTexto" TEXT,
    "reglaPuntuacionTexto" TEXT,
    "formulaKeyMotor" TEXT,
    "equivalenciaMotorEstado" "EquivalenciaFormulaMotor" NOT NULL DEFAULT 'NO_EVALUADA',
    "equivalenciaMotorNota" TEXT,
    "formulaTexto" TEXT,
    "notasFormula" TEXT,
    "paginaReferencia" INTEGER,
    "seccionReferencia" TEXT,
    "textoFuente" TEXT,
    "confianzaExtraccion" DECIMAL(5,4),
    "fuenteExtraccion" TEXT NOT NULL DEFAULT 'lectura_analisis',
    "estadoRevision" TEXT NOT NULL DEFAULT 'pendiente_revision',
    "revisadoPorId" INTEGER,
    "revisadoEn" TIMESTAMP(3),
    "aprobado" BOOLEAN NOT NULL DEFAULT false,
    "advertencias" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MetodoPonderacionProceso_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TarifaMantenimientoEquipo" (
    "id" SERIAL NOT NULL,
    "empresaPrestadora" TEXT NOT NULL DEFAULT 'ASEOCOLBA',
    "uen" TEXT NOT NULL,
    "clienteRazonSocial" TEXT NOT NULL,
    "contrato" TEXT NOT NULL,
    "consecutivoTarifa" INTEGER NOT NULL,
    "codigoTarifa" TEXT,
    "puntoEntrega" TEXT NOT NULL,
    "codigoMunicipio" TEXT,
    "nombreCiudad" TEXT,
    "grupoActivo" TEXT NOT NULL,
    "descripcionGrupoActivo" TEXT,
    "tipoActivo" TEXT NOT NULL,
    "descripcionTipoActivo" TEXT,
    "subtipoActivo" TEXT NOT NULL,
    "descripcionEquipo" TEXT NOT NULL,
    "cantidadAsignada" DECIMAL(12,2),
    "frecuencia" DECIMAL(8,2),
    "valorUnitarioAsignado" DECIMAL(20,2),
    "valorMesAsignado" DECIMAL(20,2),
    "cantidadFacturar" DECIMAL(12,2),
    "valorMesMantenimiento" DECIMAL(20,2) NOT NULL,
    "formulaValorMantenimiento" TEXT,
    "valorMesOtrosRubros" DECIMAL(20,2),
    "fuenteArchivo" TEXT NOT NULL,
    "fuenteHoja" TEXT NOT NULL,
    "fuenteFila" INTEGER NOT NULL,
    "hashFila" TEXT NOT NULL,
    "loteImportacionId" INTEGER,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TarifaMantenimientoEquipo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportacionTarifasMantenimiento" (
    "id" SERIAL NOT NULL,
    "nombreArchivo" TEXT NOT NULL,
    "hashArchivo" TEXT NOT NULL,
    "fechaImportacion" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usuarioImportacion" TEXT,
    "totalLeidos" INTEGER NOT NULL DEFAULT 0,
    "totalInsertados" INTEGER NOT NULL DEFAULT 0,
    "totalActualizados" INTEGER NOT NULL DEFAULT 0,
    "totalSinCambios" INTEGER NOT NULL DEFAULT 0,
    "totalRechazados" INTEGER NOT NULL DEFAULT 0,
    "estado" TEXT NOT NULL DEFAULT 'EN_PROCESO',
    "detalleError" TEXT,

    CONSTRAINT "ImportacionTarifasMantenimiento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegistroRechazadoImportacionMantenimiento" (
    "id" SERIAL NOT NULL,
    "loteImportacionId" INTEGER NOT NULL,
    "fuenteHoja" TEXT NOT NULL,
    "fuenteFila" INTEGER NOT NULL,
    "llaveNormalizada" TEXT,
    "descripcionEquipo" TEXT,
    "motivo" TEXT NOT NULL,
    "datosOriginales" JSONB NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RegistroRechazadoImportacionMantenimiento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EquipoActivoCatalogoSync" (
    "id" SERIAL NOT NULL,
    "empresa" TEXT NOT NULL,
    "iniciadaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finalizadaEn" TIMESTAMP(3),
    "estado" TEXT NOT NULL DEFAULT 'EN_PROCESO',
    "activa" BOOLEAN NOT NULL DEFAULT false,
    "totalEquipos" INTEGER NOT NULL DEFAULT 0,
    "totalGrupos" INTEGER NOT NULL DEFAULT 0,
    "totalPares" INTEGER NOT NULL DEFAULT 0,
    "incompleto" BOOLEAN NOT NULL DEFAULT false,
    "grupoActivoFallido" BOOLEAN NOT NULL DEFAULT false,
    "gruposFallidos" INTEGER NOT NULL DEFAULT 0,
    "paresFallidos" INTEGER NOT NULL DEFAULT 0,
    "detalleError" TEXT,
    "disparadaPor" TEXT,

    CONSTRAINT "EquipoActivoCatalogoSync_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EquipoActivoCatalogo" (
    "id" SERIAL NOT NULL,
    "empresa" TEXT NOT NULL,
    "codGrupo" TEXT NOT NULL,
    "codSubtipo" TEXT NOT NULL,
    "grupo" TEXT,
    "subTipo" TEXT,
    "nombre" TEXT NOT NULL,
    "uen" TEXT,
    "empresaC" TEXT,
    "fechaAdquisicion" TEXT,
    "valor" DECIMAL(20,2),
    "estado" TEXT,
    "estadoProducto" TEXT,
    "sincronizacionId" INTEGER NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EquipoActivoCatalogo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentoAnalisisEconomicoProceso" (
    "id" SERIAL NOT NULL,
    "procesoId" INTEGER NOT NULL,
    "nombreArchivo" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "tamanoBytes" INTEGER NOT NULL,
    "hashArchivo" TEXT NOT NULL,
    "storageBackend" TEXT NOT NULL DEFAULT 'uploadthing',
    "storageKey" TEXT,
    "storageUrl" TEXT,
    "archivoBase64" TEXT,
    "nPaginas" INTEGER,
    "textoExtraido" TEXT,
    "rol" TEXT NOT NULL DEFAULT 'PLIEGO',
    "estadoAnalisis" "EstadoAnalisisDocumento" NOT NULL DEFAULT 'PENDIENTE',
    "errorAnalisis" TEXT,
    "cargadoPorId" INTEGER,
    "cargadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentoAnalisisEconomicoProceso_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalisisEconomicoProceso" (
    "id" SERIAL NOT NULL,
    "procesoId" INTEGER NOT NULL,
    "documentoId" INTEGER NOT NULL,
    "modeloGemini" TEXT NOT NULL,
    "versionExtractor" TEXT NOT NULL,
    "versionPrompt" TEXT NOT NULL,
    "tokensIn" INTEGER NOT NULL DEFAULT 0,
    "tokensOut" INTEGER NOT NULL DEFAULT 0,
    "salidaCruda" JSONB NOT NULL,
    "extraccion" JSONB NOT NULL,
    "advertencias" JSONB,
    "trmGobiernaEvaluacionDetectado" BOOLEAN,
    "trmGobiernaEvaluacionTextoFuente" TEXT,
    "trmGobiernaEvaluacionPagina" INTEGER,
    "ejecutadoPorId" INTEGER,
    "ejecutadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalisisEconomicoProceso_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReglaTrmProceso" (
    "id" SERIAL NOT NULL,
    "procesoId" INTEGER NOT NULL,
    "version" INTEGER NOT NULL,
    "estadoVersion" "EstadoVersionRegla" NOT NULL,
    "supersedeAId" INTEGER,
    "origenCambio" TEXT,
    "motivoCambio" TEXT,
    "tipoReglaTrm" "TipoReglaTrm" NOT NULL,
    "eventoBaseTrm" "EventoBaseTrm",
    "fuenteEventoBase" TEXT,
    "offsetDiasHabiles" INTEGER,
    "politicaActualizacionFecha" "PoliticaActualizacionFechaTrm",
    "fechaBaseCongelada" DATE,
    "fechaFijaTrm" DATE,
    "calendarioHabil" TEXT,
    "zonaHoraria" TEXT,
    "reglaCentavos" "ReglaCentavos" NOT NULL,
    "documentoId" INTEGER,
    "analisisEconomicoId" INTEGER,
    "textoReglaTrm" TEXT,
    "textoFuente" TEXT,
    "paginaReferencia" INTEGER,
    "seccionReferencia" TEXT,
    "confianzaExtraccion" DECIMAL(5,4),
    "advertencias" JSONB,
    "fuenteExtraccion" TEXT NOT NULL,
    "origenTransicion" "OrigenTransicion" NOT NULL DEFAULT 'HUMANO',
    "creadoPorId" INTEGER,
    "aprobadoPorId" INTEGER,
    "aprobadoEn" TIMESTAMP(3),
    "rechazadoPorId" INTEGER,
    "rechazadoEn" TIMESTAMP(3),
    "motivoRechazo" TEXT,
    "supersedidaEn" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReglaTrmProceso_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConjuntoMetodosPonderacionProceso" (
    "id" SERIAL NOT NULL,
    "procesoId" INTEGER NOT NULL,
    "version" INTEGER NOT NULL,
    "estadoVersion" "EstadoVersionRegla" NOT NULL,
    "supersedeAId" INTEGER,
    "origenCambio" TEXT,
    "motivoCambio" TEXT,
    "documentoId" INTEGER,
    "analisisEconomicoId" INTEGER,
    "presupuestoRequeridoPorFormula" BOOLEAN NOT NULL DEFAULT false,
    "presupuestoOficialAprobado" DECIMAL(20,2),
    "presupuestoTextoFuente" TEXT,
    "presupuestoPaginaReferencia" INTEGER,
    "presupuestoOrigen" TEXT,
    "puntajeMaximoEconomicoAprobado" DECIMAL(10,4),
    "puntajeMaximoTextoFuente" TEXT,
    "puntajeMaximoPaginaReferencia" INTEGER,
    "advertencias" JSONB,
    "origenTransicion" "OrigenTransicion" NOT NULL DEFAULT 'HUMANO',
    "creadoPorId" INTEGER,
    "aprobadoPorId" INTEGER,
    "aprobadoEn" TIMESTAMP(3),
    "rechazadoPorId" INTEGER,
    "rechazadoEn" TIMESTAMP(3),
    "motivoRechazo" TEXT,
    "supersedidoEn" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConjuntoMetodosPonderacionProceso_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DecisionExcepcionCandidata" (
    "id" SERIAL NOT NULL,
    "procesoId" INTEGER NOT NULL,
    "reglaTrmCandidataId" INTEGER NOT NULL,
    "decision" TEXT NOT NULL,
    "motivo" TEXT NOT NULL,
    "actorId" INTEGER NOT NULL,
    "origen" TEXT NOT NULL DEFAULT 'HUMANO',
    "decididoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vigente" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DecisionExcepcionCandidata_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Notificacion_leida_idx" ON "Notificacion"("leida");

-- CreateIndex
CREATE INDEX "Notificacion_tipo_idx" ON "Notificacion"("tipo");

-- CreateIndex
CREATE INDEX "Notificacion_perfil_idx" ON "Notificacion"("perfil");

-- CreateIndex
CREATE INDEX "Notificacion_creadoEn_idx" ON "Notificacion"("creadoEn");

-- CreateIndex
CREATE INDEX "Notificacion_codigoProceso_idx" ON "Notificacion"("codigoProceso");

-- CreateIndex
CREATE INDEX "Notificacion_procesoId_idx" ON "Notificacion"("procesoId");

-- CreateIndex
CREATE INDEX "Notificacion_tipo_procesoId_creadoEn_idx" ON "Notificacion"("tipo", "procesoId", "creadoEn");

-- CreateIndex
CREATE UNIQUE INDEX "Proceso_externalId_key" ON "Proceso"("externalId");

-- CreateIndex
CREATE UNIQUE INDEX "Proceso_sourceKey_key" ON "Proceso"("sourceKey");

-- CreateIndex
CREATE INDEX "Proceso_codigoProceso_idx" ON "Proceso"("codigoProceso");

-- CreateIndex
CREATE INDEX "Proceso_perfil_idx" ON "Proceso"("perfil");

-- CreateIndex
CREATE INDEX "Proceso_aliasFuente_idx" ON "Proceso"("aliasFuente");

-- CreateIndex
CREATE INDEX "Proceso_departamento_idx" ON "Proceso"("departamento");

-- CreateIndex
CREATE INDEX "Proceso_estadoFuente_idx" ON "Proceso"("estadoFuente");

-- CreateIndex
CREATE INDEX "Proceso_fechaPublicacion_idx" ON "Proceso"("fechaPublicacion");

-- CreateIndex
CREATE INDEX "Proceso_fechaVencimiento_idx" ON "Proceso"("fechaVencimiento");

-- CreateIndex
CREATE INDEX "Proceso_tieneCambioFechaCierre_idx" ON "Proceso"("tieneCambioFechaCierre");

-- CreateIndex
CREATE INDEX "Proceso_linkDetalle_idx" ON "Proceso"("linkDetalle");

-- CreateIndex
CREATE INDEX "Proceso_scraperEstado_scraperIntentos_idx" ON "Proceso"("scraperEstado", "scraperIntentos");

-- CreateIndex
CREATE INDEX "Proceso_scraperIntentos_scraperUltimoIntento_idx" ON "Proceso"("scraperIntentos", "scraperUltimoIntento");

-- CreateIndex
CREATE INDEX "Proceso_scraperUltimoIntento_idx" ON "Proceso"("scraperUltimoIntento");

-- CreateIndex
CREATE INDEX "idx_proceso_alias_fuente" ON "Proceso"("aliasFuente");

-- CreateIndex
CREATE INDEX "idx_proceso_link_detalle_null" ON "Proceso"("id") WHERE (("linkDetalle" IS NULL) OR ("linkDetalle" = ''::text));

-- CreateIndex
CREATE INDEX "idx_proceso_linkdetalle_null_fecha" ON "Proceso"("fechaPublicacion" DESC) WHERE (("linkDetalle" IS NULL) OR (TRIM(BOTH FROM "linkDetalle") = ''::text));

-- CreateIndex
CREATE INDEX "idx_proceso_perfil" ON "Proceso"("perfil");

-- CreateIndex
CREATE UNIQUE INDEX "ProcesoDetalleSecop_procesoId_key" ON "ProcesoDetalleSecop"("procesoId");

-- CreateIndex
CREATE INDEX "ProcesoDetalleSecop_estado_idx" ON "ProcesoDetalleSecop"("estado");

-- CreateIndex
CREATE INDEX "ProcesoDetalleSecop_capturadoEn_idx" ON "ProcesoDetalleSecop"("capturadoEn");

-- CreateIndex
CREATE INDEX "ProcesoDetalleSecop_updatedAt_idx" ON "ProcesoDetalleSecop"("updatedAt");

-- CreateIndex
CREATE INDEX "ProcesoCronogramaSecop_procesoId_idx" ON "ProcesoCronogramaSecop"("procesoId");

-- CreateIndex
CREATE INDEX "ProcesoCronogramaSecop_evento_idx" ON "ProcesoCronogramaSecop"("evento");

-- CreateIndex
CREATE INDEX "ProcesoCronogramaSecop_updatedAt_idx" ON "ProcesoCronogramaSecop"("updatedAt");

-- CreateIndex
CREATE INDEX "ProcesoDocumentoSecop_procesoId_idx" ON "ProcesoDocumentoSecop"("procesoId");

-- CreateIndex
CREATE INDEX "ProcesoDocumentoSecop_nombre_idx" ON "ProcesoDocumentoSecop"("nombre");

-- CreateIndex
CREATE INDEX "ProcesoDocumentoSecop_tipoDocumento_idx" ON "ProcesoDocumentoSecop"("tipoDocumento");

-- CreateIndex
CREATE INDEX "ProcesoDocumentoSecop_descargado_idx" ON "ProcesoDocumentoSecop"("descargado");

-- CreateIndex
CREATE INDEX "ProcesoDocumentoSecop_procesado_idx" ON "ProcesoDocumentoSecop"("procesado");

-- CreateIndex
CREATE INDEX "ProcesoDocumentoSecop_fechaDetectado_idx" ON "ProcesoDocumentoSecop"("fechaDetectado");

-- CreateIndex
CREATE INDEX "ProcesoDocumentoSecop_updatedAt_idx" ON "ProcesoDocumentoSecop"("updatedAt");

-- CreateIndex
CREATE INDEX "ProcesoSnapshotSecop_procesoId_idx" ON "ProcesoSnapshotSecop"("procesoId");

-- CreateIndex
CREATE INDEX "ProcesoSnapshotSecop_creadoEn_idx" ON "ProcesoSnapshotSecop"("creadoEn");

-- CreateIndex
CREATE UNIQUE INDEX "ProcesoNuevo_sourceKey_key" ON "ProcesoNuevo"("sourceKey");

-- CreateIndex
CREATE INDEX "ProcesoNuevo_fechaDeteccion_idx" ON "ProcesoNuevo"("fechaDeteccion");

-- CreateIndex
CREATE INDEX "ProcesoNuevo_perfil_idx" ON "ProcesoNuevo"("perfil");

-- CreateIndex
CREATE INDEX "ProcesoNuevo_aliasFuente_idx" ON "ProcesoNuevo"("aliasFuente");

-- CreateIndex
CREATE INDEX "ProcesoNuevo_codigoProceso_idx" ON "ProcesoNuevo"("codigoProceso");

-- CreateIndex
CREATE INDEX "Solicitud_estadoSolicitud_idx" ON "Solicitud"("estadoSolicitud");

-- CreateIndex
CREATE INDEX "Solicitud_codigoProceso_idx" ON "Solicitud"("codigoProceso");

-- CreateIndex
CREATE INDEX "Solicitud_procesoId_idx" ON "Solicitud"("procesoId");

-- CreateIndex
CREATE INDEX "Solicitud_procesoSourceKey_idx" ON "Solicitud"("procesoSourceKey");

-- CreateIndex
CREATE INDEX "Solicitud_origenSolicitud_idx" ON "Solicitud"("origenSolicitud");

-- CreateIndex
CREATE INDEX "Solicitud_sqrNumero_idx" ON "Solicitud"("sqrNumero");

-- CreateIndex
CREATE INDEX "Solicitud_sqrCreada_idx" ON "Solicitud"("sqrCreada");

-- CreateIndex
CREATE INDEX "Solicitud_sqrCerrada_idx" ON "Solicitud"("sqrCerrada");

-- CreateIndex
CREATE INDEX "Solicitud_createdAt_idx" ON "Solicitud"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "Solicitud_aliasFuente_idx" ON "Solicitud"("aliasFuente");

-- CreateIndex
CREATE INDEX "Solicitud_revisor_idx" ON "Solicitud"("revisor");

-- CreateIndex
CREATE INDEX "Solicitud_aprobador_idx" ON "Solicitud"("aprobador");

-- CreateIndex
CREATE INDEX "Solicitud_estadoSolicitud_createdAt_idx" ON "Solicitud"("estadoSolicitud", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Solicitud_origenSolicitud_estadoSolicitud_createdAt_idx" ON "Solicitud"("origenSolicitud", "estadoSolicitud", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "DeletedSolicitud_origenSolicitud_idx" ON "DeletedSolicitud"("origenSolicitud");

-- CreateIndex
CREATE INDEX "DeletedSolicitud_deletedAt_idx" ON "DeletedSolicitud"("deletedAt");

-- CreateIndex
CREATE INDEX "DeletedSolicitud_estadoSolicitud_idx" ON "DeletedSolicitud"("estadoSolicitud");

-- CreateIndex
CREATE UNIQUE INDEX "PerfilRol_nombre_key" ON "PerfilRol"("nombre");

-- CreateIndex
CREATE INDEX "LecturaAnalisis_creadoEn_idx" ON "LecturaAnalisis"("creadoEn");

-- CreateIndex
CREATE INDEX "LecturaAnalisis_pdfHash_modo_idx" ON "LecturaAnalisis"("pdfHash", "modo");

-- CreateIndex
CREATE INDEX "LecturaAnalisis_usuarioId_idx" ON "LecturaAnalisis"("usuarioId");

-- CreateIndex
CREATE INDEX "LecturaAnalisis_codigoProceso_idx" ON "LecturaAnalisis"("codigoProceso");

-- CreateIndex
CREATE INDEX "LecturaAnalisis_modo_idx" ON "LecturaAnalisis"("modo");

-- CreateIndex
CREATE INDEX "LecturaAnalisis_usuarioGestionaId_idx" ON "LecturaAnalisis"("usuarioGestionaId");

-- CreateIndex
CREATE INDEX "RagDocumento_creadoEn_idx" ON "RagDocumento"("creadoEn");

-- CreateIndex
CREATE INDEX "RagDocumento_codigoProceso_idx" ON "RagDocumento"("codigoProceso");

-- CreateIndex
CREATE INDEX "RagChunk_documentoId_idx" ON "RagChunk"("documentoId");

-- CreateIndex
CREATE INDEX "GeminiUsage_creadoEn_idx" ON "GeminiUsage"("creadoEn" DESC);

-- CreateIndex
CREATE INDEX "GeminiUsage_modelo_idx" ON "GeminiUsage"("modelo");

-- CreateIndex
CREATE INDEX "GeminiUsage_endpoint_idx" ON "GeminiUsage"("endpoint");

-- CreateIndex
CREATE INDEX "GeminiUsage_usuarioId_idx" ON "GeminiUsage"("usuarioId");

-- CreateIndex
CREATE INDEX "CostoEstructura_procesoCodigo_idx" ON "CostoEstructura"("procesoCodigo");

-- CreateIndex
CREATE INDEX "CostoEstructura_creadoEn_idx" ON "CostoEstructura"("creadoEn");

-- CreateIndex
CREATE INDEX "HorarioCatalogo_empresa_idx" ON "HorarioCatalogo"("empresa");

-- CreateIndex
CREATE INDEX "HorarioCatalogo_codigo_idx" ON "HorarioCatalogo"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "ParametrosLaborales_anio_key" ON "ParametrosLaborales"("anio");

-- CreateIndex
CREATE INDEX "ParametrosLaborales_anio_idx" ON "ParametrosLaborales"("anio");

-- CreateIndex
CREATE INDEX "ParametrosLaborales_activo_idx" ON "ParametrosLaborales"("activo");

-- CreateIndex
CREATE INDEX "AsistenteConocimiento_empresa_idx" ON "AsistenteConocimiento"("empresa");

-- CreateIndex
CREATE INDEX "AsistenteConocimiento_activo_idx" ON "AsistenteConocimiento"("activo");

-- CreateIndex
CREATE INDEX "AsistenteConocimiento_tipo_idx" ON "AsistenteConocimiento"("tipo");

-- CreateIndex
CREATE UNIQUE INDEX "AssistantMemory_key_key" ON "AssistantMemory"("key");

-- CreateIndex
CREATE INDEX "AssistantMemory_scope_isActive_idx" ON "AssistantMemory"("scope", "isActive");

-- CreateIndex
CREATE INDEX "AssistantMemory_empresa_isActive_idx" ON "AssistantMemory"("empresa", "isActive");

-- CreateIndex
CREATE INDEX "AssistantMemory_priority_idx" ON "AssistantMemory"("priority" DESC);

-- CreateIndex
CREATE INDEX "CalendarioFestivos_anio_idx" ON "CalendarioFestivos"("anio");

-- CreateIndex
CREATE INDEX "CalendarioFestivos_fecha_idx" ON "CalendarioFestivos"("fecha");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarioFestivos_fecha_key" ON "CalendarioFestivos"("fecha");

-- CreateIndex
CREATE INDEX "CatalogoCargo_empresaGrupo_idx" ON "CatalogoCargo"("empresaGrupo");

-- CreateIndex
CREATE INDEX "CatalogoCargo_cargoNormalizado_idx" ON "CatalogoCargo"("cargoNormalizado");

-- CreateIndex
CREATE INDEX "CatalogoCargo_anio_idx" ON "CatalogoCargo"("anio");

-- CreateIndex
CREATE INDEX "CatalogoRiesgoARL_clase_idx" ON "CatalogoRiesgoARL"("clase");

-- CreateIndex
CREATE INDEX "CatalogoRiesgoARL_anio_idx" ON "CatalogoRiesgoARL"("anio");

-- CreateIndex
CREATE INDEX "SolicitudManoObra_estado_idx" ON "SolicitudManoObra"("estado");

-- CreateIndex
CREATE INDEX "SolicitudManoObra_procesoId_idx" ON "SolicitudManoObra"("procesoId");

-- CreateIndex
CREATE INDEX "SolicitudManoObra_creadoEn_idx" ON "SolicitudManoObra"("creadoEn");

-- CreateIndex
CREATE INDEX "EscenarioManoObra_solicitudId_idx" ON "EscenarioManoObra"("solicitudId");

-- CreateIndex
CREATE INDEX "EscenarioManoObra_empresaGrupo_idx" ON "EscenarioManoObra"("empresaGrupo");

-- CreateIndex
CREATE INDEX "CargoManoObra_escenarioId_idx" ON "CargoManoObra"("escenarioId");

-- CreateIndex
CREATE INDEX "CargoManoObra_catalogoCargoId_idx" ON "CargoManoObra"("catalogoCargoId");

-- CreateIndex
CREATE INDEX "TurnoManoObra_cargoId_idx" ON "TurnoManoObra"("cargoId");

-- CreateIndex
CREATE INDEX "AlertaManoObra_solicitudId_idx" ON "AlertaManoObra"("solicitudId");

-- CreateIndex
CREATE INDEX "AlertaManoObra_escenarioId_idx" ON "AlertaManoObra"("escenarioId");

-- CreateIndex
CREATE INDEX "AlertaManoObra_severidad_idx" ON "AlertaManoObra"("severidad");

-- CreateIndex
CREATE INDEX "AlertaManoObra_revisada_idx" ON "AlertaManoObra"("revisada");

-- CreateIndex
CREATE INDEX "PreguntaPendiente_solicitudId_idx" ON "PreguntaPendiente"("solicitudId");

-- CreateIndex
CREATE INDEX "PreguntaPendiente_respondida_idx" ON "PreguntaPendiente"("respondida");

-- CreateIndex
CREATE UNIQUE INDEX "LoginAttempt_clave_key" ON "LoginAttempt"("clave");

-- CreateIndex
CREATE INDEX "LoginAttempt_resetAt_idx" ON "LoginAttempt"("resetAt");

-- CreateIndex
CREATE INDEX "RateLimitGemini_fecha_idx" ON "RateLimitGemini"("fecha");

-- CreateIndex
CREATE UNIQUE INDEX "RateLimitGemini_usuarioId_endpoint_fecha_key" ON "RateLimitGemini"("usuarioId", "endpoint", "fecha");

-- CreateIndex
CREATE INDEX "AuditLog_usuarioId_idx" ON "AuditLog"("usuarioId");

-- CreateIndex
CREATE INDEX "AuditLog_accion_idx" ON "AuditLog"("accion");

-- CreateIndex
CREATE INDEX "AuditLog_creadoEn_idx" ON "AuditLog"("creadoEn");

-- CreateIndex
CREATE INDEX "AuditLog_recurso_idx" ON "AuditLog"("recurso");

-- CreateIndex
CREATE INDEX "TrmCache_fecha_idx" ON "TrmCache"("fecha");

-- CreateIndex
CREATE INDEX "TrmCache_fuente_idx" ON "TrmCache"("fuente");

-- CreateIndex
CREATE INDEX "TrmCache_createdAt_idx" ON "TrmCache"("createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "TrmCache_fecha_fuente_key" ON "TrmCache"("fecha", "fuente");

-- CreateIndex
CREATE INDEX "TrmConsultaLog_createdAt_idx" ON "TrmConsultaLog"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "TrmConsultaLog_fuente_idx" ON "TrmConsultaLog"("fuente");

-- CreateIndex
CREATE INDEX "TrmConsultaLog_exito_idx" ON "TrmConsultaLog"("exito");

-- CreateIndex
CREATE INDEX "TrmConsultaLog_fechaConsultada_idx" ON "TrmConsultaLog"("fechaConsultada");

-- CreateIndex
CREATE UNIQUE INDEX "api_clients_apiKeyPrefix_key" ON "api_clients"("apiKeyPrefix");

-- CreateIndex
CREATE INDEX "api_clients_activo_idx" ON "api_clients"("activo");

-- CreateIndex
CREATE UNIQUE INDEX "trm_historico_fecha_key" ON "trm_historico"("fecha");

-- CreateIndex
CREATE INDEX "trm_historico_fecha_idx" ON "trm_historico"("fecha" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "trm_eventos_efectivos_fecha_key" ON "trm_eventos_efectivos"("fecha");

-- CreateIndex
CREATE UNIQUE INDEX "trm_eventos_efectivos_eventoId_key" ON "trm_eventos_efectivos"("eventoId");

-- CreateIndex
CREATE INDEX "trm_eventos_efectivos_eventoId_idx" ON "trm_eventos_efectivos"("eventoId" DESC);

-- CreateIndex
CREATE INDEX "trm_predicciones_fechaObjetivo_idx" ON "trm_predicciones"("fechaObjetivo");

-- CreateIndex
CREATE INDEX "trm_predicciones_fechaCalculo_idx" ON "trm_predicciones"("fechaCalculo" DESC);

-- CreateIndex
CREATE INDEX "SimulacionPonderacion_creadoPorId_idx" ON "SimulacionPonderacion"("creadoPorId");

-- CreateIndex
CREATE INDEX "SimulacionPonderacion_procesoId_idx" ON "SimulacionPonderacion"("procesoId");

-- CreateIndex
CREATE INDEX "SimulacionPonderacion_empresaGrupo_idx" ON "SimulacionPonderacion"("empresaGrupo");

-- CreateIndex
CREATE INDEX "SimulacionPonderacion_razonSocial_idx" ON "SimulacionPonderacion"("razonSocial");

-- CreateIndex
CREATE INDEX "SimulacionPonderacion_estado_idx" ON "SimulacionPonderacion"("estado");

-- CreateIndex
CREATE INDEX "SimulacionPonderacion_numeroProceso_idx" ON "SimulacionPonderacion"("numeroProceso");

-- CreateIndex
CREATE INDEX "SimulacionPonderacion_trmCacheId_idx" ON "SimulacionPonderacion"("trmCacheId");

-- CreateIndex
CREATE INDEX "SimulacionPonderacion_createdAt_idx" ON "SimulacionPonderacion"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "SimulacionCompetidor_simulacionId_idx" ON "SimulacionCompetidor"("simulacionId");

-- CreateIndex
CREATE INDEX "SimulacionCompetidor_fuente_idx" ON "SimulacionCompetidor"("fuente");

-- CreateIndex
CREATE INDEX "SimulacionResultadoMetodo_simulacionId_idx" ON "SimulacionResultadoMetodo"("simulacionId");

-- CreateIndex
CREATE INDEX "SimulacionResultadoMetodo_metodo_idx" ON "SimulacionResultadoMetodo"("metodo");

-- CreateIndex
CREATE INDEX "SimulacionResultadoMetodo_simulacionId_metodo_idx" ON "SimulacionResultadoMetodo"("simulacionId", "metodo");

-- CreateIndex
CREATE INDEX "MetodoPonderacionProceso_procesoId_idx" ON "MetodoPonderacionProceso"("procesoId");

-- CreateIndex
CREATE INDEX "MetodoPonderacionProceso_codigoProceso_idx" ON "MetodoPonderacionProceso"("codigoProceso");

-- CreateIndex
CREATE INDEX "MetodoPonderacionProceso_lecturaAnalisisId_idx" ON "MetodoPonderacionProceso"("lecturaAnalisisId");

-- CreateIndex
CREATE INDEX "MetodoPonderacionProceso_analisisEconomicoProcesoId_idx" ON "MetodoPonderacionProceso"("analisisEconomicoProcesoId");

-- CreateIndex
CREATE INDEX "MetodoPonderacionProceso_conjuntoMetodosId_idx" ON "MetodoPonderacionProceso"("conjuntoMetodosId");

-- CreateIndex
CREATE INDEX "MetodoPonderacionProceso_estadoRevision_idx" ON "MetodoPonderacionProceso"("estadoRevision");

-- CreateIndex
CREATE INDEX "MetodoPonderacionProceso_empresaGrupo_idx" ON "MetodoPonderacionProceso"("empresaGrupo");

-- CreateIndex
CREATE INDEX "MetodoPonderacionProceso_razonSocial_idx" ON "MetodoPonderacionProceso"("razonSocial");

-- CreateIndex
CREATE INDEX "MetodoPonderacionProceso_createdAt_idx" ON "MetodoPonderacionProceso"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "TarifaMantenimientoEquipo_empresaPrestadora_uen_grupoActivo_idx" ON "TarifaMantenimientoEquipo"("empresaPrestadora", "uen", "grupoActivo", "tipoActivo", "subtipoActivo", "activo");

-- CreateIndex
CREATE INDEX "TarifaMantenimientoEquipo_contrato_puntoEntrega_idx" ON "TarifaMantenimientoEquipo"("contrato", "puntoEntrega");

-- CreateIndex
CREATE INDEX "TarifaMantenimientoEquipo_clienteRazonSocial_idx" ON "TarifaMantenimientoEquipo"("clienteRazonSocial");

-- CreateIndex
CREATE UNIQUE INDEX "TarifaMantenimientoEquipo_empresaPrestadora_uen_contrato_pu_key" ON "TarifaMantenimientoEquipo"("empresaPrestadora", "uen", "contrato", "puntoEntrega", "consecutivoTarifa", "subtipoActivo");

-- CreateIndex
CREATE INDEX "ImportacionTarifasMantenimiento_hashArchivo_idx" ON "ImportacionTarifasMantenimiento"("hashArchivo");

-- CreateIndex
CREATE INDEX "ImportacionTarifasMantenimiento_fechaImportacion_idx" ON "ImportacionTarifasMantenimiento"("fechaImportacion" DESC);

-- CreateIndex
CREATE INDEX "RegistroRechazadoImportacionMantenimiento_loteImportacionId_idx" ON "RegistroRechazadoImportacionMantenimiento"("loteImportacionId");

-- CreateIndex
CREATE INDEX "RegistroRechazadoImportacionMantenimiento_fuenteHoja_fuente_idx" ON "RegistroRechazadoImportacionMantenimiento"("fuenteHoja", "fuenteFila");

-- CreateIndex
CREATE INDEX "EquipoActivoCatalogoSync_empresa_activa_idx" ON "EquipoActivoCatalogoSync"("empresa", "activa");

-- CreateIndex
CREATE INDEX "EquipoActivoCatalogoSync_empresa_finalizadaEn_idx" ON "EquipoActivoCatalogoSync"("empresa", "finalizadaEn" DESC);

-- CreateIndex
CREATE INDEX "EquipoActivoCatalogo_empresa_sincronizacionId_idx" ON "EquipoActivoCatalogo"("empresa", "sincronizacionId");

-- CreateIndex
CREATE INDEX "EquipoActivoCatalogo_sincronizacionId_codGrupo_codSubtipo_idx" ON "EquipoActivoCatalogo"("sincronizacionId", "codGrupo", "codSubtipo");

-- CreateIndex
CREATE INDEX "DocumentoAnalisisEconomicoProceso_procesoId_idx" ON "DocumentoAnalisisEconomicoProceso"("procesoId");

-- CreateIndex
CREATE INDEX "DocumentoAnalisisEconomicoProceso_hashArchivo_idx" ON "DocumentoAnalisisEconomicoProceso"("hashArchivo");

-- CreateIndex
CREATE INDEX "DocumentoAnalisisEconomicoProceso_estadoAnalisis_idx" ON "DocumentoAnalisisEconomicoProceso"("estadoAnalisis");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentoAnalisisEconomicoProceso_procesoId_hashArchivo_key" ON "DocumentoAnalisisEconomicoProceso"("procesoId", "hashArchivo");

-- CreateIndex
CREATE INDEX "AnalisisEconomicoProceso_procesoId_idx" ON "AnalisisEconomicoProceso"("procesoId");

-- CreateIndex
CREATE INDEX "AnalisisEconomicoProceso_documentoId_idx" ON "AnalisisEconomicoProceso"("documentoId");

-- CreateIndex
CREATE INDEX "AnalisisEconomicoProceso_ejecutadoEn_idx" ON "AnalisisEconomicoProceso"("ejecutadoEn" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "ReglaTrmProceso_supersedeAId_key" ON "ReglaTrmProceso"("supersedeAId");

-- CreateIndex
CREATE UNIQUE INDEX "ReglaTrmProceso_analisisEconomicoId_key" ON "ReglaTrmProceso"("analisisEconomicoId");

-- CreateIndex
CREATE INDEX "ReglaTrmProceso_procesoId_estadoVersion_idx" ON "ReglaTrmProceso"("procesoId", "estadoVersion");

-- CreateIndex
CREATE INDEX "ReglaTrmProceso_documentoId_idx" ON "ReglaTrmProceso"("documentoId");

-- CreateIndex
CREATE UNIQUE INDEX "ReglaTrmProceso_procesoId_version_key" ON "ReglaTrmProceso"("procesoId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "ConjuntoMetodosPonderacionProceso_supersedeAId_key" ON "ConjuntoMetodosPonderacionProceso"("supersedeAId");

-- CreateIndex
CREATE UNIQUE INDEX "ConjuntoMetodosPonderacionProceso_analisisEconomicoId_key" ON "ConjuntoMetodosPonderacionProceso"("analisisEconomicoId");

-- CreateIndex
CREATE INDEX "ConjuntoMetodosPonderacionProceso_procesoId_estadoVersion_idx" ON "ConjuntoMetodosPonderacionProceso"("procesoId", "estadoVersion");

-- CreateIndex
CREATE INDEX "ConjuntoMetodosPonderacionProceso_documentoId_idx" ON "ConjuntoMetodosPonderacionProceso"("documentoId");

-- CreateIndex
CREATE UNIQUE INDEX "ConjuntoMetodosPonderacionProceso_procesoId_version_key" ON "ConjuntoMetodosPonderacionProceso"("procesoId", "version");

-- CreateIndex
CREATE INDEX "DecisionExcepcionCandidata_procesoId_reglaTrmCandidataId_idx" ON "DecisionExcepcionCandidata"("procesoId", "reglaTrmCandidataId");

-- CreateIndex
CREATE INDEX "DecisionExcepcionCandidata_vigente_idx" ON "DecisionExcepcionCandidata"("vigente");

-- AddForeignKey
ALTER TABLE "ProcesoDetalleSecop" ADD CONSTRAINT "ProcesoDetalleSecop_procesoId_fkey" FOREIGN KEY ("procesoId") REFERENCES "Proceso"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcesoCronogramaSecop" ADD CONSTRAINT "ProcesoCronogramaSecop_procesoId_fkey" FOREIGN KEY ("procesoId") REFERENCES "Proceso"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcesoDocumentoSecop" ADD CONSTRAINT "ProcesoDocumentoSecop_procesoId_fkey" FOREIGN KEY ("procesoId") REFERENCES "Proceso"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcesoSnapshotSecop" ADD CONSTRAINT "ProcesoSnapshotSecop_procesoId_fkey" FOREIGN KEY ("procesoId") REFERENCES "Proceso"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentoVersion" ADD CONSTRAINT "DocumentoVersion_documentoId_fkey" FOREIGN KEY ("documentoId") REFERENCES "Documento"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LecturaAnalisis" ADD CONSTRAINT "LecturaAnalisis_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LecturaAnalisis" ADD CONSTRAINT "LecturaAnalisis_usuarioGestionaId_fkey" FOREIGN KEY ("usuarioGestionaId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RagChunk" ADD CONSTRAINT "RagChunk_documentoId_fkey" FOREIGN KEY ("documentoId") REFERENCES "RagDocumento"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeminiUsage" ADD CONSTRAINT "GeminiUsage_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EscenarioManoObra" ADD CONSTRAINT "EscenarioManoObra_solicitudId_fkey" FOREIGN KEY ("solicitudId") REFERENCES "SolicitudManoObra"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CargoManoObra" ADD CONSTRAINT "CargoManoObra_escenarioId_fkey" FOREIGN KEY ("escenarioId") REFERENCES "EscenarioManoObra"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CargoManoObra" ADD CONSTRAINT "CargoManoObra_catalogoCargoId_fkey" FOREIGN KEY ("catalogoCargoId") REFERENCES "CatalogoCargo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TurnoManoObra" ADD CONSTRAINT "TurnoManoObra_cargoId_fkey" FOREIGN KEY ("cargoId") REFERENCES "CargoManoObra"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertaManoObra" ADD CONSTRAINT "AlertaManoObra_solicitudId_fkey" FOREIGN KEY ("solicitudId") REFERENCES "SolicitudManoObra"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertaManoObra" ADD CONSTRAINT "AlertaManoObra_escenarioId_fkey" FOREIGN KEY ("escenarioId") REFERENCES "EscenarioManoObra"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertaManoObra" ADD CONSTRAINT "AlertaManoObra_cargoId_fkey" FOREIGN KEY ("cargoId") REFERENCES "CargoManoObra"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreguntaPendiente" ADD CONSTRAINT "PreguntaPendiente_solicitudId_fkey" FOREIGN KEY ("solicitudId") REFERENCES "SolicitudManoObra"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreguntaPendiente" ADD CONSTRAINT "PreguntaPendiente_escenarioId_fkey" FOREIGN KEY ("escenarioId") REFERENCES "EscenarioManoObra"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RateLimitGemini" ADD CONSTRAINT "RateLimitGemini_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SimulacionPonderacion" ADD CONSTRAINT "SimulacionPonderacion_procesoId_fkey" FOREIGN KEY ("procesoId") REFERENCES "Proceso"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SimulacionPonderacion" ADD CONSTRAINT "SimulacionPonderacion_trmCacheId_fkey" FOREIGN KEY ("trmCacheId") REFERENCES "TrmCache"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SimulacionPonderacion" ADD CONSTRAINT "SimulacionPonderacion_creadoPorId_fkey" FOREIGN KEY ("creadoPorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SimulacionCompetidor" ADD CONSTRAINT "SimulacionCompetidor_simulacionId_fkey" FOREIGN KEY ("simulacionId") REFERENCES "SimulacionPonderacion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SimulacionResultadoMetodo" ADD CONSTRAINT "SimulacionResultadoMetodo_simulacionId_fkey" FOREIGN KEY ("simulacionId") REFERENCES "SimulacionPonderacion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetodoPonderacionProceso" ADD CONSTRAINT "MetodoPonderacionProceso_procesoId_fkey" FOREIGN KEY ("procesoId") REFERENCES "Proceso"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetodoPonderacionProceso" ADD CONSTRAINT "MetodoPonderacionProceso_lecturaAnalisisId_fkey" FOREIGN KEY ("lecturaAnalisisId") REFERENCES "LecturaAnalisis"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetodoPonderacionProceso" ADD CONSTRAINT "MetodoPonderacionProceso_analisisEconomicoProcesoId_fkey" FOREIGN KEY ("analisisEconomicoProcesoId") REFERENCES "AnalisisEconomicoProceso"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetodoPonderacionProceso" ADD CONSTRAINT "MetodoPonderacionProceso_conjuntoMetodosId_fkey" FOREIGN KEY ("conjuntoMetodosId") REFERENCES "ConjuntoMetodosPonderacionProceso"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetodoPonderacionProceso" ADD CONSTRAINT "MetodoPonderacionProceso_revisadoPorId_fkey" FOREIGN KEY ("revisadoPorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TarifaMantenimientoEquipo" ADD CONSTRAINT "TarifaMantenimientoEquipo_loteImportacionId_fkey" FOREIGN KEY ("loteImportacionId") REFERENCES "ImportacionTarifasMantenimiento"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegistroRechazadoImportacionMantenimiento" ADD CONSTRAINT "RegistroRechazadoImportacionMantenimiento_loteImportacionI_fkey" FOREIGN KEY ("loteImportacionId") REFERENCES "ImportacionTarifasMantenimiento"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipoActivoCatalogo" ADD CONSTRAINT "EquipoActivoCatalogo_sincronizacionId_fkey" FOREIGN KEY ("sincronizacionId") REFERENCES "EquipoActivoCatalogoSync"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentoAnalisisEconomicoProceso" ADD CONSTRAINT "DocumentoAnalisisEconomicoProceso_procesoId_fkey" FOREIGN KEY ("procesoId") REFERENCES "Proceso"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentoAnalisisEconomicoProceso" ADD CONSTRAINT "DocumentoAnalisisEconomicoProceso_cargadoPorId_fkey" FOREIGN KEY ("cargadoPorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalisisEconomicoProceso" ADD CONSTRAINT "AnalisisEconomicoProceso_procesoId_fkey" FOREIGN KEY ("procesoId") REFERENCES "Proceso"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalisisEconomicoProceso" ADD CONSTRAINT "AnalisisEconomicoProceso_documentoId_fkey" FOREIGN KEY ("documentoId") REFERENCES "DocumentoAnalisisEconomicoProceso"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalisisEconomicoProceso" ADD CONSTRAINT "AnalisisEconomicoProceso_ejecutadoPorId_fkey" FOREIGN KEY ("ejecutadoPorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReglaTrmProceso" ADD CONSTRAINT "ReglaTrmProceso_procesoId_fkey" FOREIGN KEY ("procesoId") REFERENCES "Proceso"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReglaTrmProceso" ADD CONSTRAINT "ReglaTrmProceso_supersedeAId_fkey" FOREIGN KEY ("supersedeAId") REFERENCES "ReglaTrmProceso"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReglaTrmProceso" ADD CONSTRAINT "ReglaTrmProceso_documentoId_fkey" FOREIGN KEY ("documentoId") REFERENCES "DocumentoAnalisisEconomicoProceso"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReglaTrmProceso" ADD CONSTRAINT "ReglaTrmProceso_analisisEconomicoId_fkey" FOREIGN KEY ("analisisEconomicoId") REFERENCES "AnalisisEconomicoProceso"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReglaTrmProceso" ADD CONSTRAINT "ReglaTrmProceso_creadoPorId_fkey" FOREIGN KEY ("creadoPorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReglaTrmProceso" ADD CONSTRAINT "ReglaTrmProceso_aprobadoPorId_fkey" FOREIGN KEY ("aprobadoPorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReglaTrmProceso" ADD CONSTRAINT "ReglaTrmProceso_rechazadoPorId_fkey" FOREIGN KEY ("rechazadoPorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConjuntoMetodosPonderacionProceso" ADD CONSTRAINT "ConjuntoMetodosPonderacionProceso_procesoId_fkey" FOREIGN KEY ("procesoId") REFERENCES "Proceso"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConjuntoMetodosPonderacionProceso" ADD CONSTRAINT "ConjuntoMetodosPonderacionProceso_supersedeAId_fkey" FOREIGN KEY ("supersedeAId") REFERENCES "ConjuntoMetodosPonderacionProceso"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConjuntoMetodosPonderacionProceso" ADD CONSTRAINT "ConjuntoMetodosPonderacionProceso_documentoId_fkey" FOREIGN KEY ("documentoId") REFERENCES "DocumentoAnalisisEconomicoProceso"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConjuntoMetodosPonderacionProceso" ADD CONSTRAINT "ConjuntoMetodosPonderacionProceso_analisisEconomicoId_fkey" FOREIGN KEY ("analisisEconomicoId") REFERENCES "AnalisisEconomicoProceso"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConjuntoMetodosPonderacionProceso" ADD CONSTRAINT "ConjuntoMetodosPonderacionProceso_creadoPorId_fkey" FOREIGN KEY ("creadoPorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConjuntoMetodosPonderacionProceso" ADD CONSTRAINT "ConjuntoMetodosPonderacionProceso_aprobadoPorId_fkey" FOREIGN KEY ("aprobadoPorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConjuntoMetodosPonderacionProceso" ADD CONSTRAINT "ConjuntoMetodosPonderacionProceso_rechazadoPorId_fkey" FOREIGN KEY ("rechazadoPorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DecisionExcepcionCandidata" ADD CONSTRAINT "DecisionExcepcionCandidata_reglaTrmCandidataId_fkey" FOREIGN KEY ("reglaTrmCandidataId") REFERENCES "ReglaTrmProceso"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DecisionExcepcionCandidata" ADD CONSTRAINT "DecisionExcepcionCandidata_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ═══════════════════════════════════════════════════════════════════════════════
--  OBJETOS POSTGRESQL NO REPRESENTABLES EN PRISMA SCHEMA
-- ═══════════════════════════════════════════════════════════════════════════════
-- Prisma Schema no modela funciones, triggers ni índices UNIQUE parciales. Los
-- 10 objetos siguientes se copian VERBATIM de las migraciones históricas del
-- proyecto original para que este baseline reproduzca el comportamiento
-- funcional pre-B.3 al 100%, no una versión simplificada.
--
--   · update_trm_cache_updated_at()  + trigger trm_cache_updated_at
--       ← 20260630000000_add_trm_cache_and_logs
--   · update_updated_at_column()     + triggers sim_ponderacion/competidor/resultado_updated_at
--       ← 20260700000000_add_simulacion_ponderacion
--   · regla_trm_una_activa / regla_trm_una_candidata
--     conjunto_metodos_uno_activo / conjunto_metodos_uno_candidato
--       ← 20260901120000_fase_a1_pliego_forward_versionado
--
-- Orden respetado: funciones → triggers → índices parciales. Todas las tablas
-- referenciadas ("TrmCache", "SimulacionPonderacion", "SimulacionCompetidor",
-- "SimulacionResultadoMetodo", "ReglaTrmProceso",
-- "ConjuntoMetodosPonderacionProceso") ya existen arriba en este mismo baseline.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── Funciones updatedAt ───────────────────────────────────────────────────────

-- de 20260630000000_add_trm_cache_and_logs
CREATE OR REPLACE FUNCTION update_trm_cache_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW."updatedAt" = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- de 20260700000000_add_simulacion_ponderacion (función genérica para updatedAt)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW."updatedAt" = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── Triggers updatedAt (BEFORE UPDATE ... FOR EACH ROW) ───────────────────────

-- de 20260630000000_add_trm_cache_and_logs
CREATE TRIGGER trm_cache_updated_at
    BEFORE UPDATE ON "TrmCache"
    FOR EACH ROW
    EXECUTE FUNCTION update_trm_cache_updated_at();

-- de 20260700000000_add_simulacion_ponderacion
CREATE TRIGGER sim_ponderacion_updated_at
    BEFORE UPDATE ON "SimulacionPonderacion"
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER sim_competidor_updated_at
    BEFORE UPDATE ON "SimulacionCompetidor"
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER sim_resultado_updated_at
    BEFORE UPDATE ON "SimulacionResultadoMetodo"
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── Índices UNIQUE parciales — invariante A.1 ─────────────────────────────────
-- de 20260901120000_fase_a1_pliego_forward_versionado
-- Invariante: máximo 1 ACTIVA + 1 CANDIDATA por procesoId, en regla TRM y en
-- conjunto de métodos. Prisma no puede expresar índices únicos parciales (WHERE).

CREATE UNIQUE INDEX "regla_trm_una_activa"
ON "ReglaTrmProceso"("procesoId")
WHERE "estadoVersion" = 'ACTIVA';

CREATE UNIQUE INDEX "regla_trm_una_candidata"
ON "ReglaTrmProceso"("procesoId")
WHERE "estadoVersion" = 'CANDIDATA';

CREATE UNIQUE INDEX "conjunto_metodos_uno_activo"
ON "ConjuntoMetodosPonderacionProceso"("procesoId")
WHERE "estadoVersion" = 'ACTIVA';

CREATE UNIQUE INDEX "conjunto_metodos_uno_candidato"
ON "ConjuntoMetodosPonderacionProceso"("procesoId")
WHERE "estadoVersion" = 'CANDIDATA';
