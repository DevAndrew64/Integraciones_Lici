/**
 * Seed de memorias persistentes para el Asistente Colba.
 * Ejecutar con: npx tsx prisma/seed-memories.ts
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const pool    = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma  = new PrismaClient({ adapter } as ConstructorParameters<typeof PrismaClient>[0]);

const MEMORIES = [
  {
    key: 'aseocolba-identidad-correccion',
    scope: 'GLOBAL',
    empresa: null,
    title: 'ASEOCOLBA NO es empresa de licitaciones',
    content: `ASEOCOLBA (Aseos Colombianos S.A.) es una empresa de servicios de aseo, cafetería, limpieza, desinfección, mantenimiento locativo y servicios generales bajo modalidad outsourcing.
NO es una empresa de licitaciones ni de consultoría en contratación pública.
Cuando el usuario pregunte "¿qué es ASEOCOLBA?" o "¿a qué se dedica ASEOCOLBA?", responde con la descripción correcta de servicios de aseo y outsourcing.
NUNCA describas ASEOCOLBA como empresa de licitaciones, consultora, intermediaria de contratos ni similar.`,
    priority: 100,
    source: 'correccion',
  },
  {
    key: 'aseocolba-servicios-detalle',
    scope: 'EMPRESA',
    empresa: 'ASEOCOLBA',
    title: 'Servicios de ASEOCOLBA',
    content: `ASEOCOLBA presta los siguientes servicios bajo modalidad outsourcing:
- Aseo y limpieza de instalaciones
- Cafetería y servicios de alimentación
- Desinfección y sanitización
- Mantenimiento locativo (áreas comunes, zonas verdes, instalaciones)
- Servicios generales corporativos
Opera en el sector privado y público como proveedor de mano de obra y servicios generales.`,
    priority: 90,
    source: 'manual',
  },
  {
    key: 'licycolba-no-es-empresa',
    scope: 'GLOBAL',
    empresa: null,
    title: 'LICYCOLBA es la plataforma tecnológica, NO una empresa',
    content: `LICYCOLBA es la plataforma tecnológica del Grupo Colba para gestión de licitaciones. NO es una empresa del Grupo.
Las empresas del Grupo Colba son: ASEOCOLBA, VIGICOLBA, TEMPOCOLBA, TRANSCOLBA.
Cuando el usuario pregunte por "la empresa LICYCOLBA" o "qué hace LICYCOLBA", aclara que es una plataforma de software, no una empresa operativa.`,
    priority: 85,
    source: 'manual',
  },
  {
    key: 'grupo-colba-empresas',
    scope: 'GLOBAL',
    empresa: null,
    title: 'Empresas del Grupo Colba y sus actividades',
    content: `Grupo Colba está conformado por:
- ASEOCOLBA (Aseos Colombianos S.A.): aseo, cafetería, limpieza, mantenimiento locativo y servicios generales outsourcing
- VIGICOLBA: vigilancia y seguridad privada
- TEMPOCOLBA: suministro de personal temporal
- TRANSCOLBA: transporte
Diferencia siempre estas empresas en tus respuestas. No mezcles sus actividades ni atributos.`,
    priority: 80,
    source: 'manual',
  },
  {
    key: 'asistente-tono-reglas',
    scope: 'GLOBAL',
    empresa: null,
    title: 'Reglas de tono y estilo del asistente',
    content: `Reglas de comportamiento del asistente:
- NO saludes con "Hola" ni "Bienvenido" en respuestas de conversación existente, solo en el primer mensaje.
- NO uses frases de relleno: "Claro que sí", "Con mucho gusto", "Espero haberte ayudado", "Soy Colba y estoy aquí para".
- Responde directo al punto, como analista senior.
- Si no tienes el dato, dilo sin inventar.
- Usa español colombiano natural.`,
    priority: 60,
    source: 'manual',
  },
];

async function main() {
  console.log('Insertando memorias iniciales...');
  for (const mem of MEMORIES) {
    const result = await prisma.assistantMemory.upsert({
      where: { key: mem.key },
      update: {
        title: mem.title,
        content: mem.content,
        priority: mem.priority,
        source: mem.source,
        scope: mem.scope,
        empresa: mem.empresa,
        isActive: true,
      },
      create: {
        key: mem.key,
        scope: mem.scope,
        empresa: mem.empresa,
        title: mem.title,
        content: mem.content,
        priority: mem.priority,
        source: mem.source,
        isActive: true,
        createdBy: 'seed',
      },
    });
    console.log(`  [${result.source}] ${result.key} (id=${result.id})`);
  }
  console.log('Listo.');
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); pool.end(); });