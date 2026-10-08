import { porcentajeAIU, valorConAIU, type ResultadoGuardado } from '@/lib/costos-estructura/exportacion/contratos';
import type { TotalesPantallaDto } from '@/lib/costos-estructura/exportacion/costos-pantalla';
import type { CargoPayload } from './cargos';
import type { ErrorCampo, PayloadContratosV1 } from './cliente';

export interface SolicitudParaPuente {
  id: number;
  codigoProceso: string | null;
  entidad: string | null;
  objeto: string | null;
  nitContacto: string | null;
  direccionContacto: string | null;
}

/**
 * Lo que LiciColba NO tiene y la oferta de Contratos exige: quien envía lo elige. Nada se infiere (las equivalencias
 * perfil → empresa y ciudad → UEN están por confirmar con Contratos).
 */
export interface DestinoContratos {
  empresa: string | null;
  undnegocio: string | null;
  /** A = Administración · C = Administración y costos asumidos. */
  tipoAdm: string | null;
  /** LIC = licitación pública · INV = invitación privada. */
  origenProceso: string | null;
  /** Concepto de facturación (código de Contratos). */
  codServicio: string | null;
  descripcionServicio: string | null;
}

const CODIGOS: (keyof DestinoContratos)[] = ['empresa', 'undnegocio', 'tipoAdm', 'origenProceso', 'codServicio'];

const texto = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);
const numero = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Lee el destino del cuerpo de la petición: solo las claves conocidas, solo texto; los códigos en mayúsculas. */
export function leerDestino(valor: unknown): DestinoContratos {
  const origen = typeof valor === 'object' && valor !== null && !Array.isArray(valor) ? (valor as Record<string, unknown>) : {};
  const leer = (clave: keyof DestinoContratos) => {
    const v = origen[clave];
    const t = typeof v === 'string' ? texto(v) : null;
    return t !== null && CODIGOS.includes(clave) ? t.toUpperCase() : t;
  };
  return {
    empresa: leer('empresa'),
    undnegocio: leer('undnegocio'),
    tipoAdm: leer('tipoAdm'),
    origenProceso: leer('origenProceso'),
    codServicio: leer('codServicio'),
    descripcionServicio: leer('descripcionServicio'),
  };
}

/**
 * El puente pide solo dígitos (5 a 15), sin puntos, guion ni dígito de verificación: Contratos guarda «base-DV» y el
 * puente calcula el DV. «900.123.456-8» → «900123456».
 * Sin guion no se puede saber si el último dígito es el de verificación: se envía tal cual y se revisará contra los NIT
 * de Contratos en el módulo MySQL. Lo que no son dígitos se deja como llegó: el puente lo rechaza (nunca se «arregla»).
 */
export function normalizarNit(valor: string | null | undefined): string | null {
  const t = (valor ?? '').replace(/[\s.]/g, '');
  if (!t) return null;
  const conDigitoVerificacion = /^(\d{5,15})-\d$/.exec(t);
  return conDigitoVerificacion ? conDigitoVerificacion[1] : t;
}

/**
 * JSON v1 del puente a partir de lo que LiciColba ya tiene: la solicitud, el Resultado guardado y los totales de la pantalla.
 * Los seis valores de la tarifa son los de la hoja «Contratos» del Excel de costos: costo × (1 + A.I.U.), al peso, antes de IVA;
 * sin el A.I.U. (Resultado sin guardar) no hay valores — un valor sin A.I.U. no es el que lleva Contratos.
 */
export function armarPayloadContratos(d: {
  solicitud: SolicitudParaPuente;
  procesoCodigo: string | null;
  resultado: ResultadoGuardado | null;
  totales?: TotalesPantallaDto | null;
  destino?: Partial<DestinoContratos> | null;
  /** Líneas de cargo ya convertidas (`cargosParaPuente`); sin ellas la oferta viaja sin mano de obra. */
  cargos?: CargoPayload[] | null;
}): PayloadContratosV1 {
  const { solicitud: s, resultado: r, totales: t, destino: dest, cargos } = d;
  const aiu = porcentajeAIU(r?.porcentajeIU);
  const conAIU = (costo: number | undefined) => (typeof costo === 'number' && Number.isFinite(costo) ? valorConAIU(costo, aiu) : null);
  return {
    version: 1,
    origen: { solicitudId: s.id, procesoCodigo: texto(s.codigoProceso) ?? texto(d.procesoCodigo) },
    cliente: { razonSocial: texto(s.entidad), nit: normalizarNit(s.nitContacto), direccion: texto(s.direccionContacto) },
    contrato: {
      objeto: texto(s.objeto),
      porcentajeAIU: aiu,
      valorMensual: numero(r?.valorMesIncluidoIva),
      plazoMeses: numero(r?.vigenciaMeses),
    },
    oferta: {
      empresa: texto(dest?.empresa),
      undnegocio: texto(dest?.undnegocio),
      tipoAdm: texto(dest?.tipoAdm),
      origenProceso: texto(dest?.origenProceso),
      codServicio: texto(dest?.codServicio),
      descripcionServicio: texto(dest?.descripcionServicio),
    },
    tarifa: {
      manoObra: conAIU(t?.manoObra),
      insumos: conAIU(t?.insumos),
      maquinaria: conAIU(t?.maquinaria),
      administrativos: conAIU(t?.administrativos),
      valorAgregado: conAIU(t?.valorAgregado),
      serviciosNoContinuos: conAIU(t?.serviciosNoContinuos),
    },
    ...(cargos && cargos.length > 0 ? { cargos } : {}),
  };
}

const ETIQUETA_CAMPO: Record<string, string> = {
  'origen.solicitudId': 'Solicitud',
  'origen.procesoCodigo': 'Código del proceso',
  'cliente.razonSocial': 'Razón social del cliente',
  'cliente.nit': 'NIT del cliente',
  'cliente.direccion': 'Dirección del cliente',
  'contrato.objeto': 'Objeto',
  'contrato.porcentajeAIU': '% A.I.U.',
  'contrato.valorMensual': 'Valor mensual del contrato',
  'contrato.plazoMeses': 'Plazo (meses)',
  oferta: 'Datos de la oferta',
  'oferta.empresa': 'Empresa',
  'oferta.undnegocio': 'UEN',
  'oferta.tipoAdm': 'Tipo de tarifa (A o C)',
  'oferta.origenProceso': 'Origen del proceso',
  'oferta.codServicio': 'Concepto de facturación',
  'oferta.descripcionServicio': 'Descripción del servicio',
  tarifa: 'Tarifa',
  cargos: 'Cargos',
  'tarifa.manoObra': 'Vr. Mano de obra',
  'tarifa.insumos': 'Vr. Insumos',
  'tarifa.maquinaria': 'Vr. Maquinaria',
  'tarifa.administrativos': 'Costos administrativos',
  'tarifa.valorAgregado': 'Valores agregados',
  'tarifa.serviciosNoContinuos': 'Servicios no continuos',
  '(Contratos)': 'Contratos',
};
const COMPLETAR_EN_FICHA = new Set(['cliente.razonSocial', 'cliente.nit']);

export const etiquetaCampo = (campo: string) => ETIQUETA_CAMPO[campo] ?? campo;

/** A dónde ir para corregir cada error. */
function ayuda(campo: string, mensaje: string): string {
  // «El cliente con NIT … no existe en Contratos. Créelo en Contratos…»: el NIT está completo; el mensaje ya dice qué hacer.
  if (COMPLETAR_EN_FICHA.has(campo) && /no existe en Contratos/.test(mensaje)) return '';
  if (COMPLETAR_EN_FICHA.has(campo)) return ' Complételo en la ficha de la solicitud.';
  if (campo === 'oferta' || campo.startsWith('oferta.')) return ' Complételo en los datos del envío a Contratos.';
  if (campo === 'tarifa' || campo.startsWith('tarifa.') || campo === 'contrato.porcentajeAIU') return ' Guarde la pestaña Resultado del costeo.';
  if (campo.startsWith('cargos[') && campo.endsWith('.codigoHorario')) return ' Revise el horario del cargo en Mano de Obra.';
  return '';
}

const ETIQUETA_CAMPO_CARGO: Record<string, string> = {
  nombre: 'Nombre',
  cantidad: 'Personas',
  horasSemana: 'Horas por semana',
  jornada: 'Jornada',
  salario: 'Salario',
  riesgo: 'Riesgo ARL',
  valorUnitario: 'Valor por trabajador',
  valorTotal: 'Valor de la línea',
  codigoHorario: 'Horario',
};

/** «cargos[2].codigoHorario» → «Cargo 3 «Aseador» · Horario» (con el nombre que se envió, para ubicarlo en la pantalla). */
function etiquetaCampoCargo(campo: string, cargos?: CargoPayload[] | null): string | null {
  const m = /^cargos\[(\d+)\](?:\.(\w+))?$/.exec(campo);
  if (!m) return null;
  const indice = Number(m[1]);
  const nombre = cargos?.[indice]?.nombre;
  const cargo = `Cargo ${indice + 1}${nombre ? ` «${nombre}»` : ''}`;
  return m[2] ? `${cargo} · ${ETIQUETA_CAMPO_CARGO[m[2]] ?? m[2]}` : cargo;
}

/** Etiqueta legible de un campo del contrato, incluidos los de la lista de cargos. */
export function describirCampo(campo: string, cargos?: CargoPayload[] | null): string {
  return etiquetaCampoCargo(campo, cargos) ?? etiquetaCampo(campo);
}

/** Texto para el usuario: «NIT del cliente: Es obligatorio. Complételo en la ficha de la solicitud.» */
export function describirError(e: ErrorCampo, cargos?: CargoPayload[] | null): string {
  return `${describirCampo(e.campo, cargos)}: ${e.mensaje}${ayuda(e.campo, e.mensaje)}`;
}
