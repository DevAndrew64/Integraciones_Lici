/**
 * Seed de la base de conocimiento del Asistente Colba.
 * Idempotente: detecta cambios por titulo y actualiza si el contenido difiere.
 * Genera embeddings para todos los fragmentos creados/actualizados.
 *
 * Ejecutar con: npx tsx prisma/seed-conocimiento.ts
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { GoogleGenerativeAI } from '@google/generative-ai';

const pool    = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma  = new PrismaClient({ adapter } as ConstructorParameters<typeof PrismaClient>[0]);

const EMBEDDING_MODEL = 'gemini-embedding-001';
const EMBEDDING_DIMS  = 3072;

async function generarEmbedding(texto: string): Promise<number[]> {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) throw new Error('GOOGLE_AI_API_KEY no configurada');
  const genAI  = new GoogleGenerativeAI(apiKey);
  const model  = genAI.getGenerativeModel({ model: EMBEDDING_MODEL });
  const result = await model.embedContent(texto.slice(0, 8_000));
  const values = result.embedding?.values;
  if (!values || values.length !== EMBEDDING_DIMS) throw new Error(`Embedding inválido: ${values?.length} dims`);
  return values;
}

async function guardarEmbedding(id: number, embedding: number[]): Promise<void> {
  const vs = `[${embedding.join(',')}]`;
  await prisma.$executeRaw`
    UPDATE "AsistenteConocimiento"
    SET    embedding        = ${vs}::vector,
           "embeddingModel" = ${EMBEDDING_MODEL},
           "embeddingAt"    = NOW()
    WHERE  id = ${id}
  `;
}

const entradas = [
  // ── GRUPO COLBA ────────────────────────────────────────────────────────────
  {
    empresa: 'GRUPO_COLBA', tipo: 'empresa', modulo: null,
    titulo: 'Qué es Grupo Colba',
    contenido: 'Grupo Colba es un conglomerado empresarial colombiano conformado por tres empresas especializadas en contratación pública y servicios: ASEOCOLBA (asesoría en licitaciones), TEMPOCOLBA (servicios de personal temporal) y VIGICOLBA (vigilancia y seguridad privada). El grupo opera principalmente en el sector público colombiano, participando en procesos de contratación de entidades del Estado a través de SECOP I y SECOP II.',
  },
  {
    empresa: 'GRUPO_COLBA', tipo: 'plataforma', modulo: null,
    titulo: 'Qué es LICYCOLBA',
    contenido: 'LICYCOLBA es la plataforma web interna del Grupo Colba para la gestión integral de licitaciones. Permite buscar procesos en SECOP I y II, gestionar el pipeline de ofertas (procesos por validar, en observación, en ejecución, en evaluación y cerrados), administrar solicitudes de procesos públicos y privados, consultar la TRM y simular ponderación económica. Incluye el asistente de IA Colba para consultas de contratación pública.',
  },
  {
    empresa: 'GRUPO_COLBA', tipo: 'normativa', modulo: null,
    titulo: 'Marco normativo de contratación pública Colombia',
    contenido: 'La contratación pública en Colombia se rige principalmente por: Ley 80 de 1993 (Estatuto General de Contratación), Ley 1150 de 2007 (eficiencia y transparencia), Decreto 1082 de 2015 (único reglamentario del sector administrativo de planeación nacional). Las modalidades de selección son: licitación pública, selección abreviada, concurso de méritos, contratación directa y mínima cuantía. Los procesos se publican en SECOP I (antiguo) y SECOP II (plataforma transaccional actual de Colombia Compra Eficiente).',
  },
  {
    empresa: 'GRUPO_COLBA', tipo: 'normativa', modulo: null,
    titulo: 'Fórmulas económicas SECOP II - ponderación',
    contenido: 'En SECOP II, la fórmula económica activa se determina por los centavos de la TRM del día del cierre. Las fórmulas posibles son: media aritmética, media geométrica, mediana, media aritmética alta (promedio de ofertas sobre la media aritmética), y menor valor. El módulo TRM de LICYCOLBA calcula automáticamente cuál fórmula aplica según los centavos de la TRM vigente y simula el puntaje económico de cada oferente.',
  },
  // ── ASEOCOLBA ──────────────────────────────────────────────────────────────
  {
    empresa: 'ASEOCOLBA', tipo: 'empresa', modulo: null,
    titulo: 'Qué es ASEOCOLBA',
    contenido: 'ASEOCOLBA es la empresa del Grupo Colba especializada en asesoría y gestión de procesos de contratación pública. Apoya a entidades y empresas en la estructuración de pliegos de condiciones, elaboración de propuestas técnicas y económicas, análisis de requisitos habilitantes, revisión de cronogramas, y seguimiento de procesos en SECOP I y SECOP II. Su perfil de color corporativo es azul oscuro (#0d2d5e).',
  },
  {
    empresa: 'ASEOCOLBA', tipo: 'servicios', modulo: null,
    titulo: 'Servicios de ASEOCOLBA',
    contenido: 'ASEOCOLBA ofrece: (1) Asesoría en elaboración de propuestas para licitaciones públicas y privadas. (2) Revisión y análisis de pliegos de condiciones. (3) Verificación de requisitos habilitantes jurídicos, financieros y técnicos. (4) Gestión de observaciones al pliego. (5) Apoyo en recursos de impugnación. (6) Seguimiento de procesos en SECOP II. (7) Capacitación en contratación pública colombiana.',
  },
  {
    empresa: 'ASEOCOLBA', tipo: 'licitaciones', modulo: null,
    titulo: 'Requisitos habilitantes típicos en licitaciones',
    contenido: 'Los requisitos habilitantes en contratación pública colombiana incluyen: (1) Jurídicos: existencia y representación legal, capacidad de contratar, documentos de constitución. (2) Financieros: índices de liquidez, endeudamiento, razón de cobertura, capital de trabajo, patrimonio. (3) Técnicos: experiencia en contratos ejecutados similares (generalmente mínimo 1-3 contratos o equivalente en valor). Estos requisitos son de habilitación (pass/fail) y no otorgan puntaje.',
  },
  {
    empresa: 'ASEOCOLBA', tipo: 'licitaciones', modulo: null,
    titulo: 'Criterios de evaluación y puntaje',
    contenido: 'En los procesos de contratación pública, los criterios de evaluación otorgan puntaje (sobre 100 o sobre 1000). Típicamente incluyen: factor económico (precio), factor técnico (calidad, experiencia adicional, personal calificado), factor social (vinculación de personas en situación de discapacidad, mujeres cabeza de hogar). El peso de cada factor varía por proceso. El puntaje económico se calcula con la fórmula matemática activa según la TRM.',
  },
  // ── TEMPOCOLBA ─────────────────────────────────────────────────────────────
  {
    empresa: 'TEMPOCOLBA', tipo: 'empresa', modulo: null,
    titulo: 'Qué es TEMPOCOLBA',
    contenido: 'TEMPOCOLBA es la empresa del Grupo Colba especializada en la provisión de personal temporal y administración de nómina. Presta servicios de suministro de personal para entidades públicas y empresas privadas, cubriendo necesidades de mano de obra en diferentes perfiles y sectores. Su perfil de color corporativo es cian (#06b6d4).',
  },
  {
    empresa: 'TEMPOCOLBA', tipo: 'servicios', modulo: null,
    titulo: 'Servicios de TEMPOCOLBA',
    contenido: 'TEMPOCOLBA ofrece: (1) Suministro de personal temporal para empresas y entidades. (2) Administración de nómina y prestaciones sociales. (3) Vinculación de personal en misión. (4) Gestión de seguridad social (EPS, ARL, pensión, caja de compensación). (5) Liquidación de contratos laborales. (6) Apoyo en procesos de contratación que requieren personal con perfiles específicos.',
  },
  {
    empresa: 'TEMPOCOLBA', tipo: 'sgsst', modulo: null,
    titulo: 'SG-SST en TEMPOCOLBA',
    contenido: 'TEMPOCOLBA implementa el Sistema de Gestión de Seguridad y Salud en el Trabajo (SG-SST) conforme al Decreto 1072 de 2015 y la Resolución 0312 de 2019. El sistema incluye: política de SST, identificación de peligros y valoración de riesgos (IPVR), exámenes médicos ocupacionales (ingreso, periódico, egreso), elementos de protección personal (EPP), plan de emergencias, capacitaciones en seguridad, reporte e investigación de accidentes e incidentes.',
  },
  {
    empresa: 'TEMPOCOLBA', tipo: 'licitaciones', modulo: null,
    titulo: 'Costos de personal en propuestas de TEMPOCOLBA',
    contenido: 'En propuestas que incluyen suministro de personal, los costos se estructuran en: salario básico, auxilio de transporte (si aplica), dotación (ropa y calzado de trabajo), exámenes médicos, EPP (elementos de protección personal), seguridad social (EPS 12,5%, pensión 12%, ARL según riesgo, SENA 2%, ICBF 3%, caja de compensación 4%), cesantías, prima de servicios, vacaciones y administración. El módulo de Costos de Estructura en LICYCOLBA facilita este cálculo.',
  },
  // ── VIGICOLBA ──────────────────────────────────────────────────────────────
  {
    empresa: 'VIGICOLBA', tipo: 'empresa', modulo: null,
    titulo: 'Qué es VIGICOLBA',
    contenido: 'VIGICOLBA es la empresa del Grupo Colba especializada en vigilancia y seguridad privada. Presta servicios de vigilancia fija, escolta, monitoreo y seguridad electrónica a entidades públicas y privadas en Colombia. Opera bajo la supervisión de la Superintendencia de Vigilancia y Seguridad Privada (Supervigilancia). Su perfil de color corporativo es rojo (#dc2626).',
  },
  {
    empresa: 'VIGICOLBA', tipo: 'servicios', modulo: null,
    titulo: 'Servicios de VIGICOLBA - seguridad privada',
    contenido: 'VIGICOLBA ofrece: (1) Vigilancia fija en instalaciones (puestos de vigilancia 8, 12 o 24 horas). (2) Vigilancia móvil y rondas de seguridad. (3) Escolta de personas y valores. (4) Instalación y monitoreo de sistemas de seguridad electrónica (CCTV, alarmas). (5) Control de acceso. (6) Servicios de seguridad para eventos. Todos los servicios se prestan bajo cumplimiento de la normativa de la Supervigilancia.',
  },
  {
    empresa: 'VIGICOLBA', tipo: 'sgsst', modulo: null,
    titulo: 'SG-SST en VIGICOLBA',
    contenido: 'VIGICOLBA implementa el SG-SST con enfoque en los riesgos propios del sector de vigilancia y seguridad: riesgo público, riesgo mecánico (armas), fatiga por turnos extendidos, estrés laboral. Los vigilantes cuentan con exámenes médicos ocupacionales periódicos, EPP específico (chaleco, linterna, radio, porta-bastón), capacitación en manejo defensivo, primeros auxilios y protocolo de atención de emergencias.',
  },
  {
    empresa: 'VIGICOLBA', tipo: 'licitaciones', modulo: null,
    titulo: 'Requisitos para contratos de vigilancia en entidades públicas',
    contenido: 'Para contratos de vigilancia y seguridad privada con entidades públicas, se requiere: (1) Licencia de funcionamiento vigente expedida por la Superintendencia de Vigilancia y Seguridad Privada. (2) Credenciales vigentes del personal de vigilancia. (3) Acreditar experiencia en contratos similares (servicios de vigilancia). (4) Cumplimiento de requisitos financieros según cuantía. (5) Pólizas de seguros (responsabilidad civil, cumplimiento). (6) Carné del Ministerio de Defensa para personal armado.',
  },
  // ── PLATAFORMA ─────────────────────────────────────────────────────────────
  {
    empresa: null, tipo: 'plataforma', modulo: 'TRM',
    titulo: 'Módulo TRM - cómo funciona',
    contenido: 'El módulo TRM de LICYCOLBA consulta la Tasa Representativa del Mercado (COP/USD) publicada diariamente por el Banco de la República. Muestra la TRM del día, historial de hasta 365 días, gráfica de tendencia, y predicción con modelos estadísticos Holt-Winters y promedio móvil. También incluye la calculadora de ponderación económica SECOP II: el usuario ingresa las ofertas y el sistema determina automáticamente la fórmula activa según los centavos de la TRM y calcula el puntaje de cada oferta.',
  },
  {
    empresa: null, tipo: 'plataforma', modulo: 'Búsqueda de procesos',
    titulo: 'Módulo Búsqueda de procesos - cómo funciona',
    contenido: 'El módulo de Búsqueda de procesos permite buscar licitaciones en SECOP I y SECOP II. Tiene cuatro vistas: (1) Sin gestionar: procesos encontrados que aún no han sido analizados. (2) Gestionados: procesos ya analizados con decisión. (3) No viables: procesos descartados. (4) Histórico: todos los procesos con filtros avanzados. Muestra un badge con los procesos nuevos detectados en el día.',
  },
  {
    empresa: null, tipo: 'plataforma', modulo: 'Procesos',
    titulo: 'Módulo Procesos - pipeline de licitaciones',
    contenido: 'El módulo Procesos gestiona el pipeline activo de licitaciones. Las vistas son: (1) Por validar (Públicos/Privados): procesos asignados que requieren revisión técnica. (2) En observación: procesos donde se presentaron observaciones al pliego pendientes de respuesta. (3) En ejecución: contratos activos ejecutándose. (4) En evaluación: propuestas en etapa de evaluación por la entidad. (5) Cerrados: adjudicados, no adjudicados, no presentados o cancelados.',
  },
  {
    empresa: null, tipo: 'plataforma', modulo: 'Solicitudes',
    titulo: 'Módulo Solicitudes - cómo funciona',
    contenido: 'El módulo Solicitudes registra y hace seguimiento de solicitudes de participación en procesos públicos y privados. Permite registrar la solicitud, asignar responsables, registrar estados (en proceso, en observación, en evaluación, cerrada, adjudicada, no adjudicada, no presentada). Incluye exportación a Excel y filtros avanzados.',
  },
  {
    empresa: null, tipo: 'plataforma', modulo: 'Lectura de procesos',
    titulo: 'Módulo Lectura de procesos - análisis de pliegos',
    contenido: 'El módulo Lectura de procesos permite analizar documentos de licitación con IA. El usuario selecciona un proceso de SECOP II, el sistema descarga el pliego y lo indexa. Luego puede hacer preguntas específicas sobre ese pliego (fechas, presupuesto, requisitos, criterios) y Colba responde usando RAG (búsqueda semántica en el contenido del pliego).',
  },
  {
    empresa: null, tipo: 'plataforma', modulo: 'Colba IA',
    titulo: 'Asistente Colba - perfiles de empresa',
    contenido: 'El asistente Colba tiene tres perfiles de empresa: ASEOCOLBA (azul, asesoría en licitaciones), TEMPOCOLBA (cian, personal temporal) y VIGICOLBA (rojo, vigilancia). El perfil activo se cambia con el ícono de bombilla en el chat. Cada perfil configura el contexto del asistente. Puede responder preguntas de contratación pública, del pliego activo, y de la plataforma LICYCOLBA.',
  },
  {
    empresa: null, tipo: 'plataforma', modulo: 'Documentos',
    titulo: 'Maestro de documentos - cómo funciona',
    contenido: 'El módulo Maestro de documentos (solo administradores) gestiona los documentos corporativos de las empresas del Grupo Colba. Permite subir, versionar y archivar documentos como certificaciones, licencias, pólizas, estados financieros, RUT, cámara de comercio, experiencia, etc. Los documentos tienen versiones y se puede consultar el historial de cambios.',
  },
];

async function main() {
  console.log('Iniciando seed de conocimiento (idempotente)…\n');

  let creados = 0, actualizados = 0, sinCambios = 0;
  const idsParaEmbedding: number[] = [];

  for (const e of entradas) {
    const existing = await prisma.asistenteConocimiento.findFirst({
      where: { titulo: e.titulo },
      select: { id: true, contenido: true, empresa: true, tipo: true, modulo: true, embeddingAt: true },
    });

    if (!existing) {
      const created = await prisma.asistenteConocimiento.create({
        data: { ...e, activo: true },
        select: { id: true },
      });
      console.log(`  ✚ Creado: "${e.titulo}"`);
      idsParaEmbedding.push(created.id);
      creados++;
    } else {
      const cambioContenido = existing.contenido !== e.contenido
        || existing.empresa !== e.empresa
        || existing.tipo !== e.tipo
        || existing.modulo !== e.modulo;

      if (cambioContenido) {
        await prisma.asistenteConocimiento.update({
          where: { id: existing.id },
          data: { contenido: e.contenido, empresa: e.empresa, tipo: e.tipo, modulo: e.modulo },
        });
        console.log(`  ↻ Actualizado: "${e.titulo}"`);
        idsParaEmbedding.push(existing.id);
        actualizados++;
      } else if (!existing.embeddingAt) {
        // Contenido sin cambios pero sin embedding
        console.log(`  ⚡ Sin embedding: "${e.titulo}"`);
        idsParaEmbedding.push(existing.id);
        sinCambios++;
      } else {
        sinCambios++;
      }
    }
  }

  console.log(`\nResumen: ${creados} creados · ${actualizados} actualizados · ${sinCambios} sin cambios`);
  console.log(`\nGenerando embeddings para ${idsParaEmbedding.length} fragmentos…`);

  let embOk = 0, embErr = 0;
  for (const id of idsParaEmbedding) {
    try {
      const item = await prisma.asistenteConocimiento.findUnique({
        where: { id },
        select: { titulo: true, contenido: true, empresa: true, tipo: true, modulo: true },
      });
      if (!item) continue;
      const texto = [item.empresa, item.tipo, item.modulo, item.titulo, item.contenido].filter(Boolean).join('. ');
      const emb   = await generarEmbedding(texto);
      await guardarEmbedding(id, emb);
      console.log(`  ✓ Embedding #${id}: "${item.titulo.slice(0, 40)}"`);
      embOk++;
    } catch (err) {
      console.error(`  ✗ Error embedding #${id}:`, err instanceof Error ? err.message : err);
      embErr++;
    }
    // Rate limit: ~100 rpm para gemini-embedding-001
    await new Promise(r => setTimeout(r, 200));
  }

  console.log(`\n✓ Seed completado: ${embOk} embeddings generados · ${embErr} errores`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(async () => { await pool.end(); });