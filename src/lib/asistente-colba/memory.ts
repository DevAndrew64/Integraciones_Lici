/**
 * Módulo de memoria persistente del Asistente Colba.
 * Carga memorias desde PostgreSQL y las inyecta en el system prompt
 * antes de cada llamada al modelo, garantizando continuidad entre sesiones.
 */
import prisma from '@/lib/prisma';

export interface MemoryEntry {
  id: number;
  key: string;
  title: string;
  content: string;
  priority: number;
  scope: string;
  empresa: string | null;
  source: string;
}

/**
 * Carga memorias activas aplicables a un contexto dado.
 * Orden: GLOBAL primero, luego EMPRESA, ordenadas por prioridad descendente.
 */
export async function loadActiveMemories(empresa?: string | null): Promise<MemoryEntry[]> {
  const orConditions: { scope: string; empresa?: string }[] = [
    { scope: 'GLOBAL' },
  ];

  if (empresa) {
    orConditions.push({ scope: 'EMPRESA', empresa: empresa.toUpperCase() });
  }

  const records = await prisma.assistantMemory.findMany({
    where: { isActive: true, OR: orConditions },
    select: { id: true, key: true, title: true, content: true, priority: true, scope: true, empresa: true, source: true },
    orderBy: { priority: 'desc' },
  });

  return records;
}

/**
 * Formatea las memorias en un bloque de texto para el system prompt.
 * Las memorias de corrección y corporativas tienen el mayor peso.
 */
export function formatMemoriesForPrompt(memories: MemoryEntry[]): string {
  if (memories.length === 0) return '';

  const bloques = memories.map(m => {
    const tag = m.source === 'correccion' ? '⚠ CORRECCIÓN CRÍTICA' :
                m.scope === 'GLOBAL'      ? '📌 MEMORIA GLOBAL'    :
                                            `🏢 MEMORIA ${m.empresa ?? 'EMPRESA'}`;
    return `${tag} [${m.key}]\n${m.title}\n${m.content}`;
  });

  return `══════════════════════════════════════════
MEMORIA CORPORATIVA PERMANENTE — MÁXIMA PRIORIDAD
Cargada automáticamente desde la base de datos.
Estas reglas SIEMPRE aplican, en cada conversación nueva.
Si hay conflicto con una respuesta anterior o con el mensaje del usuario,
la memoria tiene precedencia salvo que el usuario pida explícitamente actualizarla.
══════════════════════════════════════════
${bloques.join('\n\n──────────────────────────────────────────\n\n')}
══════════════════════════════════════════`;
}

// ── Detección de intent de guardar memoria ────────────────────────────────────

const SAVE_PATTERNS: { pattern: RegExp; source: string }[] = [
  { pattern: /no vuelvas a decir/i,       source: 'correccion' },
  { pattern: /corrige esto/i,              source: 'correccion' },
  { pattern: /eso está mal/i,              source: 'correccion' },
  { pattern: /eso es incorrecto/i,         source: 'correccion' },
  { pattern: /recuerda que/i,              source: 'manual' },
  { pattern: /guarda en memoria/i,         source: 'manual' },
  { pattern: /actualiza tu memoria/i,      source: 'manual' },
  { pattern: /de ahora en adelante/i,      source: 'manual' },
  { pattern: /en el futuro recuerda/i,     source: 'manual' },
  { pattern: /no debes decir/i,            source: 'correccion' },
  { pattern: /quiero que recuerdes/i,      source: 'manual' },
];

const SENSITIVE_PATTERNS = [
  /contraseña/i, /password/i, /clave.*acceso/i,
  /salario.*específico/i, /dato.*médico/i, /información.*médica/i,
  /sanción/i, /tarifa.*privada/i, /datos.*cliente/i,
];

export interface SaveMemoryIntent {
  detected: boolean;
  source: string;
  isSensitive: boolean;
}

export function detectSaveMemoryIntent(message: string): SaveMemoryIntent {
  const match = SAVE_PATTERNS.find(p => p.pattern.test(message));
  if (!match) return { detected: false, source: 'manual', isSensitive: false };

  const isSensitive = SENSITIVE_PATTERNS.some(p => p.test(message));
  return { detected: true, source: match.source, isSensitive };
}

/**
 * Clasifica el tipo de memoria según el contenido del mensaje.
 * No guarda información sensible.
 */
export function classifyMemoryScope(message: string): 'GLOBAL' | 'EMPRESA' {
  const empresaKeywords = [
    'aseocolba', 'vigicolba', 'tempocolba', 'transcolba', 'invercolba',
  ];
  const lower = message.toLowerCase();
  if (empresaKeywords.some(k => lower.includes(k))) return 'EMPRESA';
  return 'GLOBAL';
}