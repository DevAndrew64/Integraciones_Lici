/**
 * Etapa 3 — Extracción e interpretación de una hora suelta (token), ya
 * pre-normalizada tipográficamente. Resuelve formato 24h, AM/PM, "M"
 * (mediodía), segundos, separador "." en vez de ":", cero inicial ausente,
 * y los casos especiales 24:00/24:30/horas imposibles. Función pura, sin
 * conocimiento de bloques ni distribuciones — esas etapas la componen.
 */

export interface ResultadoInterpretacionHora {
  ok: boolean;
  horaCanonica: string | null; // "HH:mm"
  diaOffsetSugerido: number;   // 0 normalmente; 1 si el token era "24:00" (fin de día siguiente)
  advertencias: string[];
  requiereConfirmacion: boolean;
  sugerenciaConfirmacion: string | null;
  motivoFallo: string | null;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function falla(motivo: string): ResultadoInterpretacionHora {
  return { ok: false, horaCanonica: null, diaOffsetSugerido: 0, advertencias: [], requiereConfirmacion: false, sugerenciaConfirmacion: null, motivoFallo: motivo };
}

export function interpretarHora(tokenOriginal: string): ResultadoInterpretacionHora {
  let token = (tokenOriginal ?? '').trim().toUpperCase();
  if (!token) return falla('Token de hora vacío.');

  const advertencias: string[] = [];

  // Sufijo "M" (mediodía) — solo tiene sentido pegado a "12:00 M" en el
  // catálogo histórico. Se retira ANTES de buscar AM/PM para no confundirlo
  // con ellos.
  let esMeridiano = false;
  const mM = /^(.*?)\s*M$/.exec(token);
  if (mM && !/\b(A|P)M$/.test(token)) {
    token = mM[1].trim();
    esMeridiano = true;
  }

  // AM/PM (ya normalizados por pre-normalizador-texto a "AM"/"PM", pero esta
  // función debe funcionar también de forma standalone en pruebas).
  let sufijo: 'AM' | 'PM' | null = null;
  const mSufijo = /^(.*?)\s*(AM|PM)$/.exec(token);
  if (mSufijo) {
    token = mSufijo[1].trim();
    sufijo = mSufijo[2] as 'AM' | 'PM';
  }

  // HH:mm[:ss] o HH.mm — separador "." solo aceptado como sustituto de ":"
  // cuando el patrón completo calza con una hora (grupo de 1-2 dígitos +
  // grupo de exactamente 2 dígitos), nunca como separador decimal genérico.
  const m = /^(\d{1,2})[:.](\d{2})(?::(\d{2}))?$/.exec(token);
  if (!m) return falla(`No se reconoce "${tokenOriginal}" como una hora ("HH:mm" esperado).`);

  let hora = Number(m[1]);
  const minuto = Number(m[2]);
  // Segundos (m[3]) se descartan silenciosamente — no aportan a la
  // clasificación de minutos enteros que usa el resto de la plataforma.

  if (m[0].includes('.') && m[1].length <= 2) {
    advertencias.push(`Se interpretó "${tokenOriginal}" usando "." en vez de ":".`);
  }
  if (tokenOriginal.trim().length === (m[1].length + 1 + m[2].length) && m[1].length === 1) {
    advertencias.push(`Se completó con cero inicial: "${tokenOriginal}" → "${pad2(hora)}:${pad2(minuto)}".`);
  }

  if (minuto > 59) return falla(`Minutos fuera de rango en "${tokenOriginal}" (${minuto}).`);

  // 24:00 — válido únicamente como límite final (fin de un bloque a
  // medianoche), normalizado a 00:00 del día siguiente.
  if (hora === 24 && minuto === 0) {
    return { ok: true, horaCanonica: '00:00', diaOffsetSugerido: 1, advertencias: [...advertencias, 'Se interpretó "24:00" como el inicio del día siguiente (00:00).'], requiereConfirmacion: false, sugerenciaConfirmacion: null, motivoFallo: null };
  }
  // 24:30 y similares — NO se normalizan automáticamente.
  if (hora === 24 && minuto > 0) {
    const sugerida = `00:${pad2(minuto)}`;
    return {
      ok: false, horaCanonica: null, diaOffsetSugerido: 0, advertencias,
      requiereConfirmacion: true,
      sugerenciaConfirmacion: `${sugerida} del día siguiente`,
      motivoFallo: `"${tokenOriginal}" no es una hora válida por sí sola — ¿quiso decir "${sugerida}" del día siguiente?`,
    };
  }
  if (hora > 24) return falla(`Hora fuera de rango en "${tokenOriginal}" (${hora}).`);
  if (hora < 0) return falla(`Hora fuera de rango en "${tokenOriginal}".`);

  if (esMeridiano) {
    if (hora !== 12 || minuto !== 0) {
      advertencias.push(`"${tokenOriginal}" usa el sufijo "M" (mediodía) con una hora distinta de 12:00 — se conservó tal cual, verificar.`);
    } else {
      advertencias.push('Se interpretó "M" como mediodía (12:00) — verificar si corresponde.');
    }
    return { ok: true, horaCanonica: `${pad2(hora)}:${pad2(minuto)}`, diaOffsetSugerido: 0, advertencias, requiereConfirmacion: false, sugerenciaConfirmacion: null, motivoFallo: null };
  }

  if (sufijo) {
    if (hora >= 1 && hora <= 12) {
      if (sufijo === 'AM') {
        hora = hora === 12 ? 0 : hora;
      } else {
        hora = hora === 12 ? 12 : hora + 12;
      }
    } else {
      // Hora ya en formato 24h con un sufijo AM/PM pegado — marcador
      // redundante o contradictorio; se conserva la hora tal cual, nunca
      // se adivina cuál de los dos datos es el correcto.
      advertencias.push(`"${tokenOriginal}" combina una hora en formato 24 horas con el sufijo "${sufijo}" — se conservó "${pad2(hora)}:${pad2(minuto)}", el sufijo parece redundante.`);
    }
  }

  return { ok: true, horaCanonica: `${pad2(hora)}:${pad2(minuto)}`, diaOffsetSugerido: 0, advertencias, requiereConfirmacion: false, sugerenciaConfirmacion: null, motivoFallo: null };
}

// ── Frases de descanso con duración conocida ("DOS HORAS DE DESCANSO", "30
// MIN DE DESCANSO", "2,5 HORAS DE DESCANSO") ──────────────────────────────

const NUMERO_PALABRA: Record<string, number> = {
  UNA: 1, UN: 1, DOS: 2, TRES: 3, CUATRO: 4, CINCO: 5, SEIS: 6,
};

export interface ResultadoDescansoDuracion {
  minutos: number;
  textoOriginal: string;
}

/** Busca dentro de un texto (ya pre-normalizado/mayúsculas) una frase de
 * descanso con duración explícita y devuelve sus minutos, o null si no hay. */
export function extraerDescansoConDuracion(texto: string): ResultadoDescansoDuracion | null {
  // "2,5 HORAS DE DESCANSO" / "2.5 HORAS DE DESCANSO" / "30 MIN DE DESCANSO" / "40 MINUTOS DE DESCANSO"
  const mNumHoras = /(\d+(?:[.,]\d+)?)\s*HORAS?\s+DE\s+DESCANSO/.exec(texto);
  if (mNumHoras) {
    const horas = Number(mNumHoras[1].replace(',', '.'));
    return { minutos: Math.round(horas * 60), textoOriginal: mNumHoras[0] };
  }
  const mNumMin = /(\d+)\s*MIN(?:UTOS)?\s+DE\s+DESCANSO/.exec(texto);
  if (mNumMin) {
    return { minutos: Number(mNumMin[1]), textoOriginal: mNumMin[0] };
  }
  const mPalabraHoras = /\b(UNA|UN|DOS|TRES|CUATRO|CINCO|SEIS)\s+HORAS?\s+DE\s+DESCANSO/.exec(texto);
  if (mPalabraHoras) {
    return { minutos: NUMERO_PALABRA[mPalabraHoras[1]] * 60, textoOriginal: mPalabraHoras[0] };
  }
  return null;
}

/** "INCLUIDO EL DESCANSO" / "CON DESCANSO" (sin duración) — la ventana total
 * ya incluye un descanso de duración/ubicación desconocidas. */
export function tieneDescansoSinDuracion(texto: string): boolean {
  return /INCLUIDO\s+EL\s+DESCANSO|CON\s+DESCANSO(?!\s*:)/.test(texto) && !extraerDescansoConDuracion(texto);
}