/**
 * Cálculo CANÓNICO de los dos últimos centavos (00–99) de una TRM oficial.
 *
 * FASE 0.1 — investigación. NO reemplaza todavía a producción.
 *
 * Motivación: hoy conviven TRES implementaciones que pueden discrepar en
 * casos límite de floating point y de acarreo:
 *
 *   1. ponderacion-economica/trmSelector.ts  →  Math.round((v % 1) * 100)
 *      · puede devolver 100 (fuera de 0–99) cuando la parte decimal ≈ .995+
 *   2. trm/proyeccionDecimal.ts (decimalesDe) →  Math.round(v * 100) % 100
 *      · con .996 hace acarreo y "envuelve" a 00 (comportamiento correcto
 *        para el valor redondeado, distinto de la #1)
 *   3. page.tsx (modal ponderación)          →  Math.round((actual.valor % 1) * 100)
 *      · idéntica a #1, re-implementada inline
 *
 * La TRM se almacena en Prisma como `Decimal(12,4)` (4 decimales). Esta
 * función opera sobre la REPRESENTACIÓN de string (exacta), nunca sobre el
 * producto flotante `v * 100`, y maneja el acarreo explícitamente.
 *
 * `modo`:
 *   - 'redondeo'  (default): redondeo half-up al centavo — replica la
 *                  intención de las 3 funciones actuales.
 *   - 'truncado' : toma los dos primeros decimales sin redondear — algunos
 *                  pliegos dicen "los dos primeros decimales". Se expone para
 *                  que la regla la fije el pliego, NO esta función.
 */

export type ModoCentavos = 'redondeo' | 'truncado';

export interface ResultadoCentavos {
  centavos: number; // 0–99
  /** true si el redondeo produjo acarreo a la unidad (centavos → 00). */
  acarreo: boolean;
  /** representación normalizada usada para el cálculo. */
  fuente: string;
}

/**
 * @param valor  TRM oficial. Acepta:
 *   - string  (preferido — representación exacta de Prisma.Decimal, p.ej. "3443.5951")
 *   - number  (se serializa con toFixed(6); válido para magnitudes de TRM)
 * @param modo   'redondeo' (default) | 'truncado'
 */
export function centavosDeTrm(valor: string | number, modo: ModoCentavos = 'redondeo'): ResultadoCentavos {
  let s: string;
  if (typeof valor === 'number') {
    if (!Number.isFinite(valor)) throw new Error(`TRM no finita: ${valor}`);
    s = valor.toFixed(6);
  } else {
    s = valor.trim();
  }
  if (!/^-?\d+(\.\d+)?$/.test(s)) throw new Error(`TRM con formato inválido: ${JSON.stringify(valor)}`);

  const negativo = s.startsWith('-');
  const sinSigno = negativo ? s.slice(1) : s;
  const [, fracRaw = ''] = sinSigno.split('.');
  // 3 dígitos: los 2 del centavo + 1 para decidir el redondeo half-up
  const f = (fracRaw + '000').slice(0, 3);
  let cc = Number(f.slice(0, 2));
  let acarreo = false;

  if (modo === 'redondeo' && Number(f[2]) >= 5) {
    cc += 1;
    if (cc >= 100) { cc -= 100; acarreo = true; } // 99 + 1 → 00, acarrea a la unidad
  }

  return { centavos: cc, acarreo, fuente: s };
}

/** Atajo cuando solo interesa el entero 0–99. */
export function centavos(valor: string | number, modo: ModoCentavos = 'redondeo'): number {
  return centavosDeTrm(valor, modo).centavos;
}

/**
 * Diagnóstico: compara la función canónica contra las 2 implementaciones
 * heredadas para un valor dado. Útil para el inventario / auditoría.
 */
export function compararConHeredadas(valor: string | number): {
  canonico: number;
  legacy_trmSelector: number; // Math.round((v % 1) * 100)  — puede dar 100
  legacy_decimalesDe: number; // ((Math.round(v * 100) % 100) + 100) % 100
  coincideTodo: boolean;
} {
  const v = typeof valor === 'number' ? valor : Number(valor);
  const canonico = centavos(valor);
  const legacy_trmSelector = Math.round((v % 1) * 100);
  const legacy_decimalesDe = ((Math.round(v * 100) % 100) + 100) % 100;
  return {
    canonico,
    legacy_trmSelector,
    legacy_decimalesDe,
    coincideTodo: canonico === legacy_trmSelector && canonico === legacy_decimalesDe,
  };
}
