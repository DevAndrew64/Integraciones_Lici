/**
 * Lógica de clasificación y validación por razón social del Grupo Colba.
 * Sin tocar base de datos — solo reglas de negocio en el prompt.
 */

export type EmpresaColba = 'ASEOCOLBA' | 'VIGICOLBA' | 'TEMPOCOLBA' | 'TRANSCOLBA' | 'INVERCOLBA';

export const EMPRESAS_COLBA: EmpresaColba[] = [
  'ASEOCOLBA', 'VIGICOLBA', 'TEMPOCOLBA', 'TRANSCOLBA', 'INVERCOLBA',
];

// Palabras clave que identifican cada empresa por tipo de servicio
const SERVICIOS: Record<EmpresaColba, string[]> = {
  ASEOCOLBA: [
    'aseo', 'cafetería', 'cafeteria', 'servicios generales', 'mantenimiento locativo',
    'todero', 'jardinería', 'jardineria', 'piscinero', 'piscina mantenimiento',
    'conserjería', 'conserjeria', 'portería no armada', 'porteria', 'apoyo operativo',
    'limpieza', 'fumigación', 'fumigacion', 'mensajería', 'mensajeria',
  ],
  VIGICOLBA: [
    'vigilancia', 'seguridad privada', 'vigilante armado', 'vigilante no armado',
    'guarda de seguridad', 'cctv', 'monitoreo', 'control de acceso seguridad',
    'escolta', 'seguridad electronica', 'seguridad electrónica', 'alarmas',
    'video vigilancia', 'circuito cerrado',
  ],
  TEMPOCOLBA: [
    'servicios temporales', 'trabajadores en misión', 'trabajadores en mision',
    'suministro de personal', 'personal temporal', 'selección de personal',
    'seleccion de personal', 'reemplazos temporales', 'personal en misión',
    'personal en mision', 'administración de personal temporal',
  ],
  TRANSCOLBA: [
    'transporte', 'logística', 'logistica', 'movilidad', 'rutas', 'vehículos',
    'vehiculos', 'conductor', 'flota', 'traslados',
  ],
  INVERCOLBA: [
    'inversión', 'inversion', 'activos', 'patrimonio', 'inmuebles',
    'arrendamiento', 'administración de activos',
  ],
};

function q(s: string) {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Detecta empresa mencionada explícitamente en el texto */
export function detectarEmpresaExplicita(texto: string): EmpresaColba | null {
  const t = q(texto);
  for (const emp of EMPRESAS_COLBA) {
    if (t.includes(q(emp))) return emp;
    // alias cortos
    const alias: Record<string, EmpresaColba> = {
      'aseo colba': 'ASEOCOLBA', 'vigi colba': 'VIGICOLBA',
      'tempo colba': 'TEMPOCOLBA', 'trans colba': 'TRANSCOLBA',
    };
    for (const [a, e] of Object.entries(alias)) {
      if (t.includes(q(a))) return e;
    }
  }
  return null;
}

/** Infiere empresa probable por el servicio descrito */
export function inferirEmpresaPorServicio(texto: string): EmpresaColba | null {
  const t = q(texto);
  for (const [emp, keywords] of Object.entries(SERVICIOS) as [EmpresaColba, string[]][]) {
    if (keywords.some(k => t.includes(q(k)))) return emp;
  }
  return null;
}

export interface InconsistenciaEmpresa {
  empresaExplicita: EmpresaColba;
  empresaInferida: EmpresaColba;
  advertencia: string;
}

/** Detecta si el usuario menciona una empresa pero el servicio sugiere otra */
export function detectarInconsistenciaEmpresa(texto: string): InconsistenciaEmpresa | null {
  const explicita = detectarEmpresaExplicita(texto);
  const inferida  = inferirEmpresaPorServicio(texto);
  if (!explicita || !inferida || explicita === inferida) return null;
  return {
    empresaExplicita: explicita,
    empresaInferida: inferida,
    advertencia: `El servicio mencionado corresponde normalmente a ${inferida}, no a ${explicita}. Verificá antes de cotizar.`,
  };
}

/** Bloque de reglas de empresa para inyectar en el system prompt */
export const REGLAS_EMPRESAS = `
REGLAS CRÍTICAS — SEPARACIÓN POR RAZÓN SOCIAL:
Nunca mezcles información entre las empresas del Grupo Colba: ASEOCOLBA, VIGICOLBA, TEMPOCOLBA, TRANSCOLBA, INVERCOLBA.

Clasificación por tipo de servicio:
- ASEOCOLBA: aseo, cafetería, servicios generales, mantenimiento, todero, jardinería, piscinero, conserjería no armada, apoyo operativo
- VIGICOLBA: vigilancia, seguridad privada, vigilante armado/no armado, guarda de seguridad, CCTV, monitoreo, control de acceso (cuando es seguridad), escolta
- TEMPOCOLBA: servicios temporales, trabajadores en misión, suministro/selección de personal temporal
- TRANSCOLBA: transporte, logística, rutas, conductores, movilidad
- INVERCOLBA: inversiones, activos, patrimonio, arrendamientos

Detección de errores del usuario:
- Si el usuario cotiza "vigilancia" con ASEOCOLBA → advertir y sugerir VIGICOLBA
- Si el usuario cotiza "aseo" con VIGICOLBA → advertir y sugerir ASEOCOLBA
- Si pregunta por datos consolidados sin indicar empresa → mostrar por empresa separado o preguntar
- Si el usuario dice algo que contradice la BD/herramienta → mostrar la diferencia antes de confirmar

Cuando detectes una inconsistencia, responde de forma respetuosa:
"Veo una posible inconsistencia..." / "Antes de tomarlo como definitivo, validaría..." / "Puede que haya una confusión entre X y Y..."

Razonamiento crítico:
El usuario puede equivocarse. Antes de responder datos operativos, valida con el contexto disponible:
- razón social correcta para el servicio
- empresa correcta para el proceso/documento
- TRM, fecha, valor coherente
- jornada/cargo coherente con lo calculado
- documento vencido vs vigente
No corras a confirmar si algo no cuadra.`;