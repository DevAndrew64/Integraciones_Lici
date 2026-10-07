/**
 * FASE A.1 — POST /api/procesos/[id]/analisis-economico/[docId]/analizar
 *
 * Ejecuta "Analizar con Gemini" sobre UN documento ya cargado. El extractor
 * es REDUCIDO: SOLO criterios de evaluación económica gobernados por TRM
 * (§2). NO extrae requisitos habilitantes/experiencia/jurídicos/técnicos/
 * garantías/personal/cronograma general/presupuesto general/AIU/obligaciones.
 *
 *   1. extrae texto del PDF;
 *   2. Gemini extrae estructura económica (schema Zod reducido);
 *   3. persiste AnalisisEconomicoProceso (crudo + normalizado + tokens + versiones);
 *   4. si trmGobiernaEvaluacionEconomica.valor !== true → NO crea candidatas,
 *      deja el gate USA_PONDERACION_TRM pendiente de confirmación humana;
 *   5. si sí → crea ReglaTrmProceso CANDIDATA + CONJUNTO de métodos CANDIDATO
 *      (ninguno toca lo ACTIVO).
 *
 * Gemini NUNCA aprueba, NUNCA confirma usaPonderacionTrm. Todo queda
 * pendiente de revisión humana.
 */

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/session';
import { requireSession, requireNoMercadeo } from '@/lib/authz';
import { checkGeminiRateLimitPg, recordGeminiUsagePg } from '@/lib/rate-limit';
import { auditLog } from '@/lib/audit';
import { extraerPdfTexto } from '@/lib/lectura/extractors/extraer-pdf-texto';
import { extraerEconomicoConGemini } from '@/lib/ponderacion-economica/extraccion/gemini-economico';
import { reglaTrmExtraidaANegocio } from '@/lib/ponderacion-economica/extraccion/schema-economico';
import { crearCandidataRegla } from '@/lib/ponderacion-economica/regla-trm/orquestador';
import { crearConjuntoCandidato } from '@/lib/ponderacion-economica/conjunto-metodos/orquestador';
import { leerBinarioDocumento } from '@/lib/ponderacion-economica/documento/leer-binario';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 300;

const pid = (v: string) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string; docId: string }> }) {
  const session = await getSession(req);
  const denied = requireSession(session) ?? requireNoMercadeo(session);
  if (denied) return denied;

  const p = await ctx.params;
  const procesoId = pid(p.id), docId = pid(p.docId);
  if (!procesoId || !docId) return NextResponse.json({ ok: false, error: 'ID inválido' }, { status: 400 });

  const doc = await prisma.documentoAnalisisEconomicoProceso.findFirst({
    where: { id: docId, procesoId },
    select: { id: true, storageBackend: true, storageUrl: true, archivoBase64: true, nombreArchivo: true, estadoAnalisis: true, textoExtraido: true },
  });
  if (!doc) return NextResponse.json({ ok: false, error: 'Documento no encontrado para este proceso' }, { status: 404 });
  if (doc.estadoAnalisis === 'ANALIZANDO') return NextResponse.json({ ok: false, error: 'Ya hay un análisis en curso para este documento' }, { status: 409 });

  const rate = await checkGeminiRateLimitPg(session!.id, 'analizar');
  if (rate.bloqueado) return NextResponse.json({ ok: false, error: `Límite diario de IA alcanzado (${rate.usos}/${rate.limite}). Reintenta mañana.` }, { status: 429 });

  await prisma.documentoAnalisisEconomicoProceso.update({ where: { id: docId }, data: { estadoAnalisis: 'ANALIZANDO', errorAnalisis: null } });

  try {
    // 1. texto del PDF
    let texto = doc.textoExtraido ?? '';
    let nPaginas: number | null = null;
    if (!texto || texto.length < 200) {
      const binario = await leerBinarioDocumento(doc);
      const ext = await extraerPdfTexto(binario, doc.nombreArchivo);
      nPaginas = ext.totalPaginas;
      texto = ext.paginas.map((pg: { texto: string }, i: number) => `\n[PÁGINA ${i + 1}]\n${pg.texto}`).join('\n');
      if (texto.trim().length < 200) {
        await prisma.documentoAnalisisEconomicoProceso.update({ where: { id: docId }, data: { estadoAnalisis: 'ERROR', errorAnalisis: 'El PDF no tiene texto extraíble (¿escaneado?). OCR no está habilitado en esta fase.', nPaginas } });
        return NextResponse.json({ ok: false, error: 'El PDF no tiene texto extraíble. Carga un PDF con texto (no escaneado).' }, { status: 422 });
      }
      await prisma.documentoAnalisisEconomicoProceso.update({ where: { id: docId }, data: { textoExtraido: texto, nPaginas } });
    }

    // 2. Gemini — extractor reducido (§2): SOLO criterios económicos gobernados por TRM
    const g = await extraerEconomicoConGemini({
      texto, usuarioId: session!.id, usuarioEmail: session!.email, usuarioRol: session!.rol,
      endpoint: 'procesos/analisis-economico/analizar',
    });
    void recordGeminiUsagePg(session!.id, 'analizar');

    const ex = g.extraccion;
    const rtn = reglaTrmExtraidaANegocio(ex.reglaTrm);
    const advertenciasJson = ex.advertencias.length ? (ex.advertencias as never) : undefined;

    // 3. AnalisisEconomicoProceso — SIEMPRE se guarda, incluso si TRM no gobierna aquí
    const analisis = await prisma.analisisEconomicoProceso.create({
      data: {
        procesoId, documentoId: docId,
        modeloGemini: g.modelo, versionExtractor: g.versionExtractor, versionPrompt: g.versionPrompt,
        tokensIn: g.tokensIn, tokensOut: g.tokensOut,
        salidaCruda: g.salidaCruda as never,
        extraccion: ex as never,
        advertencias: advertenciasJson,
        trmGobiernaEvaluacionDetectado: ex.trmGobiernaEvaluacionEconomica.valor,
        trmGobiernaEvaluacionTextoFuente: ex.trmGobiernaEvaluacionEconomica.textoFuente,
        trmGobiernaEvaluacionPagina: ex.trmGobiernaEvaluacionEconomica.paginaReferencia,
        ejecutadoPorId: session!.id,
      },
      select: { id: true },
    });

    // §1 — GATE: si Gemini detecta que la TRM NO gobierna la evaluación económica
    // aquí (o no lo determina), NO se crean candidatas de regla/conjunto. El
    // proceso NO se marca usaPonderacionTrm=SI automáticamente — Gemini nunca
    // confirma el gate, solo un humano vía PATCH /analisis-economico (acción
    // separada, no incluida en este endpoint).
    if (ex.trmGobiernaEvaluacionEconomica.valor !== true) {
      await prisma.documentoAnalisisEconomicoProceso.update({ where: { id: docId }, data: { estadoAnalisis: 'ANALIZADO' } });
      void auditLog({ accion: 'analisis_economico_gemini_sin_trm', recurso: `proceso/${procesoId}/analisis-economico`, usuarioId: session!.id, detalle: { docId, analisisId: analisis.id, trmGobierna: ex.trmGobiernaEvaluacionEconomica.valor } });
      return NextResponse.json({
        ok: true,
        analisisId: analisis.id,
        trmGobiernaEvaluacionEconomica: ex.trmGobiernaEvaluacionEconomica,
        reglaCandidataId: null, conjuntoMetodosCandidatoId: null,
        advertencias: ex.advertencias,
        mensaje: ex.trmGobiernaEvaluacionEconomica.valor === false
          ? 'Gemini no encontró que la TRM gobierne la evaluación económica de este documento. No se creó ninguna regla/conjunto candidato. Confirma manualmente si corresponde.'
          : 'Gemini no pudo determinar si la TRM gobierna la evaluación económica. Revisa el documento manualmente antes de continuar.',
      });
    }

    // 4. ReglaTrmProceso CANDIDATA (lifecycle; NO toca la ACTIVA)
    const regla = await crearCandidataRegla({
      procesoId, documentoId: docId, analisisEconomicoId: analisis.id,
      tipoReglaTrm: rtn.tipoReglaTrm,
      eventoBaseTrm: rtn.eventoBaseTrm,
      fuenteEventoBase: rtn.fuenteEventoBase,
      offsetDiasHabiles: rtn.offsetDiasHabiles,
      politicaActualizacionFecha: rtn.politicaActualizacionFecha,
      fechaBaseCongelada: rtn.fechaBaseCongelada,
      fechaFijaTrm: rtn.fechaFijaTrm,
      reglaCentavos: ex.reglaCentavos.regla,        // NO_DEFINIDA por defecto — nunca REDONDEO asumido
      textoReglaTrm: ex.reglaTrm.textoReglaTrm,
      textoFuente: ex.reglaTrm.textoFuente,
      paginaReferencia: ex.reglaTrm.paginaReferencia,
      confianzaExtraccion: ex.reglaTrm.confianzaExtraccion,
      advertencias: advertenciasJson,
      creadoPorId: session!.id,
      origenCambio: 'EXTRACCION',
    });

    // 5. CONJUNTO de métodos CANDIDATO (+ sus MetodoPonderacionProceso
    //    pendiente_revision, cada uno con su condición TRM, fórmula de
    //    referencia y regla de puntuación EN TEXTO — mismo nombre no implica
    //    misma fórmula; la equivalencia con el motor se confirma aparte).
    //    El CONJUNTO ACTIVO anterior NO se toca.
    const conjunto = await crearConjuntoCandidato({
      procesoId, documentoId: docId, analisisEconomicoId: analisis.id, creadoPorId: session!.id,
      origenCambio: 'EXTRACCION', advertencias: advertenciasJson,
      criterios: ex.criteriosEconomicos.map(c => ({
        nombreMetodo: c.nombre,
        tipoFormula: c.metodoNombre ?? 'desconocida',
        rangoTrmDesde: c.rangoTrmDesde, rangoTrmHasta: c.rangoTrmHasta,
        condicionTrmTexto: c.condicionTrmTexto,
        puntajeMaximo: c.puntajeMaximo,
        formulaReferenciaTexto: c.formulaReferenciaTexto,
        reglaPuntuacionTexto: c.reglaPuntuacionTexto,
        baseEconomicaEvaluada: c.baseEconomicaEvaluada === 'NO_ENCONTRADO' ? null : c.baseEconomicaEvaluada,
        descripcionBaseEconomica: c.descripcionBaseEconomica,
        baseEconomicaTextoFuente: c.baseEconomicaTextoFuente,
        baseEconomicaPaginaReferencia: c.baseEconomicaPaginaReferencia,
        textoFuente: c.textoFuente, paginaReferencia: c.paginaReferencia, confianzaExtraccion: c.confianzaExtraccion,
      })),
    });

    await prisma.documentoAnalisisEconomicoProceso.update({ where: { id: docId }, data: { estadoAnalisis: 'ANALIZADO' } });
    void auditLog({ accion: 'analisis_economico_gemini', recurso: `proceso/${procesoId}/analisis-economico`, usuarioId: session!.id, detalle: { docId, analisisId: analisis.id, reglaId: regla.reglaId, conjuntoId: conjunto.conjuntoId, criterios: conjunto.metodos, modelo: g.modelo } });

    return NextResponse.json({
      ok: true,
      analisisId: analisis.id,
      trmGobiernaEvaluacionEconomica: ex.trmGobiernaEvaluacionEconomica,
      reglaCandidataId: regla.reglaId,
      reglaVersion: regla.version,
      conjuntoMetodosCandidatoId: conjunto.conjuntoId,
      conjuntoVersion: conjunto.version,
      criteriosCreados: conjunto.metodos,
      resumen: {
        reglaTrm: { evento: rtn.eventoBaseTrm, politica: rtn.politicaActualizacionFecha, texto: ex.reglaTrm.textoReglaTrm, pagina: ex.reglaTrm.paginaReferencia, confianza: ex.reglaTrm.confianzaExtraccion },
        reglaCentavos: ex.reglaCentavos.regla,
        advertencias: ex.advertencias,
        preguntasPendientes: ex.preguntasPendientes,
      },
      mensaje: 'Análisis completado. Requiere revisión y aprobación (regla, cada criterio y equivalencia con el motor) antes de usarse en simulación/recomendación.',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error en el análisis';
    await prisma.documentoAnalisisEconomicoProceso.update({ where: { id: docId }, data: { estadoAnalisis: 'ERROR', errorAnalisis: msg.slice(0, 500) } }).catch(() => {});
    console.error('[analisis-economico:analizar]', msg.slice(0, 300));
    return NextResponse.json({ ok: false, error: 'Falló el análisis con IA. Intenta de nuevo.' }, { status: 502 });
  }
}
