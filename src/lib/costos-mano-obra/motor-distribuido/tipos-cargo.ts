// src/lib/costos-mano-obra/motor-distribuido/tipos-cargo.ts
//
// Ajuste "MANO DE OBRA COMPLETA EN SERVICIOS NO CONTINUOS" — `LineaMOExtra`
// vivía únicamente como interfaz local dentro de `ModuloEstructuraCostos`
// (page.tsx), usada tanto por Mano de Obra principal como por Turnantes.
// Se extrae aquí, sin cambiar un solo campo, para que Servicios no
// continuos (`src/lib/costos-estructura/servicios-no-continuos.ts`) pueda
// tipar sus propios cargos con la MISMA forma — nunca un tipo paralelo
// que pueda divergir. `page.tsx` importa este tipo bajo el mismo nombre
// (`LineaMOExtra`), así que ningún otro uso existente en ese archivo
// cambia.

import type { DistribucionHorarioConfigurada, DiaSemanaHorario } from '../horarios/tipos';
import type { DistribucionHorasMetodoComercial } from './motor-comercial-30-dias';
import type {
  TipoServicioVigilanciaVigicolba, ModalidadVigilanciaVigicolba,
  TurnoVigilanciaVigicolba, PatronDiasVigilanciaVigicolba,
} from '../../costos-estructura/tarifario-vigilancia-vigicolba';
import type { FrecuenciaValorAgregado } from '../../costos-estructura/valor-agregado';

export interface LineaMOExtra {
  id: number; codigo: string; nombreCargo: string; codigoHorario: string; horario: string; jornada: string; horasSemanal: string; nHoras: string; turno: string;
  cantOpeFijos: string; cantOpeAdic: string; dias: string[]; fechaInicio: string; fechaFin: string;
  horaInicio: string; horaFin: string; receso: string; horaReceso: string;
  salarioBase: string; arlKey: string;
  distribucionesHorario: DistribucionHorarioConfigurada[];
  incluyeFestivos: boolean;
  diaDescansoObligatorio?: DiaSemanaHorario;
  /** Ajuste "HORAS EXTRAS POR JORNADA SEMANAL, NO POR DÍA" — el cargo tiene
   * jornada flexible PACTADA (art. 161 CST): hasta 9h diarias sin que ese
   * exceso sea extra, siempre que la semana no pase de 42h. Es una condición
   * laboral acordada previamente, nunca una forma de evitar extras — la
   * captura el usuario cargo por cargo. Histórico sin este campo ⇒ `false`
   * (jornada fija de 8h diarias). Propiedad del CARGO completo, igual que
   * `incluyeFestivos`. */
  jornadaFlexible?: boolean;
  descansoAlternativoPactado?: boolean;
  conBonoPrestacional: boolean;
  bonoPrestacionalValor: string;
  conBonoAlimentacion: boolean;
  bonoAlimentacionValor: string;
  conBonoTransporte: boolean;
  bonoTransporteValor: string;
  conBonoProductividad: boolean;
  bonoProductividadValor: string;
  conBonoOcasional: boolean;
  bonoOcasionalValor: string;
  distribucionHorasComercial?: DistribucionHorasMetodoComercial;
  requiereCoberturaDescansoManual?: boolean | null;
  esTurnanteAutomatico?: boolean;
  claveGrupoTurnante?: string;
  salarioEditadoManualmente?: boolean;
  arlEditadoManualmente?: boolean;
  remanenteTurnante21?: boolean;
  /** Ajuste "TARIFARIO GENERAL VIGICOLBA EN MANO DE OBRA" — los 4
   * parámetros de la sección "Tarifa de vigilancia", SOLO presentes en
   * cargos de Mano de Obra (nunca Turnantes ni Servicios No Continuos)
   * cuando la empresa del proceso es VIGICOLBA. Opcionales para no romper
   * cargos históricos (de Vigicolba o de cualquier otra empresa) que no
   * los tengan — su ausencia significa "sin tarifa automática configurada
   * todavía", nunca se completa con un valor por defecto. El valor
   * monetario NUNCA se guarda aquí — siempre se reconstruye en caliente
   * desde `tarifario-vigilancia-vigicolba.ts` a partir de estos 4 campos. */
  tipoServicioVigilancia?: TipoServicioVigilanciaVigicolba;
  modalidadVigilancia?: ModalidadVigilanciaVigicolba;
  turnoVigilancia?: TurnoVigilanciaVigicolba;
  patronDiasVigilancia?: PatronDiasVigilanciaVigicolba;
  /** Ajuste "VALOR AGREGADO — 5 TIPOS CONSOLIDADOS" — SOLO aplica a cargos
   * de Mano de Obra (`destino==='manoObra'`, nunca Turnantes ni Servicios
   * No Continuos, que comparten este mismo tipo). `true` traslada
   * `costoMensualTotalLinea` del subtotal de Mano de Obra al subtotal de
   * Valor Agregado (nunca ambos, ver `particionarPorValorAgregado` en
   * `valor-agregado.ts`) — el valor NUNCA se recalcula aquí. Histórico sin
   * este campo ⇒ `false` (nunca se migra destructivamente). */
  esValorAgregado?: boolean;
  frecuenciaValorAgregado?: FrecuenciaValorAgregado;
}
