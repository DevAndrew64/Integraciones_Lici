/**
 * Excepciones del calendario TRM investigadas en la Fase 2.1, con su
 * estadoEvidencia real. Este archivo es la ÚNICA fuente de la política de
 * excepciones del harness — no se referencian estas fechas hardcodeadas en
 * ningún otro punto del código.
 *
 * El festivo de Chiquinquirá (2026-07-13) NO está aquí: es un festivo
 * colombiano genuino (Ley 2578/2026 + traslado Ley Emiliani), modelado
 * directamente en el calendario (`festivoChiquinquira.ts`), no como una
 * excepción operativa — la distinción importa: un festivo es una regla
 * de calendario recurrente; una excepción CUD es una anomalía puntual sin
 * base de festivo público.
 */

import type { ExcepcionCalendarioTrm } from './excepcionesCalendario';

export const EXCEPCIONES_CALENDARIO_TRM: ExcepcionCalendarioTrm[] = [
  {
    fecha: '2022-12-30',
    tipo: 'CIERRE',
    ambito: 'CUD',
    fuente: 'Banco de la República — Carta Circular Externa GE-1360, Horarios de fin de año',
    numeroCircular: 'GE-1360-2022',
    observacion:
      'Dirigida a participantes de CUD, DCV, SEN, CEDEC y CENIT. Establece que esos ' +
      'servicios no se prestarán el viernes 30 de diciembre de 2022.',
    estadoEvidencia: 'CONFIRMADA_PRIMARIA',
  },
  {
    fecha: '2023-12-29',
    tipo: 'CIERRE',
    ambito: 'CUD',
    fuente: 'Banco de la República — Carta Circular GE-1304, Horarios de fin de año',
    numeroCircular: 'GE-1304-2023',
    observacion:
      'Página oficial de la circular localizada; una reproducción jurídica secundaria ' +
      'transcribe que el 29-dic-2023 no se prestaron CUD, DCV, CEDEC, CENIT ni SEN. ' +
      'Pendiente confirmar el texto contra el documento PDF primario de Banrep — sin ' +
      'ese texto primario NO se activa (ver estadoEvidencia).',
    estadoEvidencia: 'PENDIENTE_DOCUMENTO_PRIMARIO',
  },
  {
    fecha: '2024-12-31',
    tipo: 'CIERRE',
    ambito: 'CUD',
    fuente: 'Banco de la República — Carta Circular Externa GE-0242, Horarios de Fin de Año',
    numeroCircular: 'GE-0242-2024',
    observacion:
      'Establece que el martes 31 de diciembre de 2024 no se prestarán los servicios ' +
      'CUD, DCV, CEDEC, CENIT y SEN.',
    estadoEvidencia: 'CONFIRMADA_PRIMARIA',
  },
  {
    fecha: '2025-12-31',
    tipo: 'CIERRE',
    ambito: 'CUD',
    fuente: 'Banco de la República — Carta Circular Externa GE-0189-2025, Horarios de Fin de Año',
    numeroCircular: 'GE-0189-2025',
    observacion:
      'Establece que el miércoles 31 de diciembre de 2025 no se prestarán los ' +
      'servicios CUD, DCV, CEDEC, CENIT y SEN.',
    estadoEvidencia: 'CONFIRMADA_PRIMARIA',
  },
];
