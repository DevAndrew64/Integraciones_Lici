import { porcentajeAIU, valorConAIU, type ResultadoGuardado } from '@/lib/costos-estructura/exportacion/contratos';
import type {
  AdministrativosPantallaDto, FilaInsumoPantallaDto, FilaMaquinariaPantallaDto, FilaValorAgregadoPantallaDto, ServicioNoContinuoPantallaDto, TotalesPantallaDto,
} from '@/lib/costos-estructura/exportacion/costos-pantalla';
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
 * La clave de la oferta en Contratos. El servidor la arma (ver `destino.ts`): empresa por el perfil, tipo de tarifa por
 * el costeo, origen por la fuente; de la pantalla solo llegan la UEN y el concepto, que se comprueban contra Contratos.
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
 * Insumo de la oferta: código de elemento del almacén y costo unitario sin IVA ni A.I.U. (lista de precios), más la cantidad,
 * la frecuencia en meses y el valor unitario con IVA con que la pantalla calcula su valor mensual (pestaña Insumos).
 */
export interface InsumoPayload {
  codigo: string;
  valorUnitario: number;
  cantidad: number;
  frecuenciaMeses: number;
  valorUnitarioConIva: number;
}

/** Costo administrativo mensual de la oferta, sin A.I.U. (pestaña Costos Admtivos de Contratos). */
export interface CostoAdministrativoPayload {
  concepto: string;
  valorMensual: number;
}

/**
 * Los insumos de la pantalla que van a la lista de precios de Contratos (`fc_preciosventas_oferta`): solo los que traen
 * código de elemento del almacén (los digitados a mano sin código no tienen dónde ir) y no los marcados como valor
 * agregado (se listan, pero no se venden). El nombre no viaja: Contratos lo toma de su catálogo por el código.
 */
export function insumosParaPuente(filas: FilaInsumoPantallaDto[] | null | undefined): InsumoPayload[] {
  return (filas ?? [])
    .filter((f) => !f.valorAgregado && /^[A-Za-z0-9]{1,10}$/.test(String(f.codigo ?? '').trim()))
    .filter((f) => Number.isFinite(f.valorUnitarioSinIva) && f.valorUnitarioSinIva >= 0)
    .map((f) => ({
      codigo: f.codigo.trim(),
      valorUnitario: f.valorUnitarioSinIva,
      cantidad: Number.isFinite(f.cantidad) && f.cantidad > 0 ? f.cantidad : 0,
      // La pantalla trata una frecuencia vacía o en 0 como mensual.
      frecuenciaMeses: Number.isFinite(f.frecuenciaMeses) && f.frecuenciaMeses > 0 ? f.frecuenciaMeses : 1,
      valorUnitarioConIva: Number.isFinite(f.valorUnitarioConIva) && f.valorUnitarioConIva >= 0 ? f.valorUnitarioConIva : 0,
    }));
}

/**
 * Los costos administrativos de la pantalla, uno por concepto con su valor mensual sin A.I.U.: pólizas, impuestos y cada
 * variable administrativa. Los que valen 0 no viajan. El puente los lleva al concepto de Contratos de igual nombre (o a OTROS).
 */
export function costosAdministrativosParaPuente(adm: AdministrativosPantallaDto | null | undefined): CostoAdministrativoPayload[] {
  if (!adm) return [];
  const lista: CostoAdministrativoPayload[] = [
    { concepto: 'Pólizas', valorMensual: adm.valorMensualPolizas },
    { concepto: 'Impuestos', valorMensual: adm.valorMensualImpuestos },
    ...(adm.variables ?? []).map((v) => ({ concepto: String(v.concepto ?? '').trim(), valorMensual: v.valorMensual })),
  ];
  return lista.filter((c) => c.concepto !== '' && Number.isFinite(c.valorMensual) && c.valorMensual > 0);
}

/** Máquina de la pestaña Equipos de Contratos: grupo y subtipo del activo, valor con IVA, cantidades, depreciación y mantenimiento. */
export interface EquipoPayload {
  codigoGrupo: string | null;
  codigoSubtipo: string | null;
  descripcion: string;
  valorUnitario: number;
  cantidadRequerida: number;
  cantidadComprar: number;
  mesesDepreciacion: number;
  valorMesMantenimiento: number;
}

/** Servicio no continuo (pestaña Servs. No Continuos de Contratos): código y UEN del catálogo, frecuencia y costos sin A.I.U. */
export interface ServicioNoContinuoPayload {
  actividad: number | null;
  uen: string | null;
  descripcion: string;
  frecuencia: number;
  manoObra: number;
  insumos: number;
  equipos: number;
  otrosCostos: number;
  valorServicio: number;
  valorMensual: number;
}

/** Fila de la pestaña Valores Agregados de Contratos: valor mensual sin A.I.U., frecuencia y, en reinversiones, su tipo y porcentaje. */
export interface ValorAgregadoPayload {
  tipo: FilaValorAgregadoPantallaDto['tipo'];
  descripcion: string;
  valorMensual: number;
  frecuencia: number | null;
  tipoReinversion: 'VALOR' | 'PORCENTAJE' | null;
  porcentaje: number | null;
}

/** Texto que Contratos (latin1) puede guardar: lo demás se cambia por un espacio; sin dobles espacios y hasta `max` caracteres. */
const textoContratos = (v: string | null | undefined, max: number) =>
  Array.from(String(v ?? '').normalize('NFC').replace(/[^\x20-\x7E\xA0-\xFF]/g, ' ').replace(/\s+/g, ' ').trim()).slice(0, max).join('');
const codigoCorto = (v: string | null | undefined, max: number) => {
  const t = String(v ?? '').trim();
  return new RegExp(`^[A-Za-z0-9]{1,${max}}$`).test(t) ? t : null;
};
const positivo = (v: number | undefined | null) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);
const frecuenciaValida = (v: number | null | undefined) => (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 15 ? v : null);

/** Las máquinas de la pantalla que van a la pestaña Equipos (sin las de Valor agregado, que van a su pestaña). */
export function equiposParaPuente(filas: FilaMaquinariaPantallaDto[] | null | undefined): EquipoPayload[] {
  return (filas ?? [])
    .filter((f) => !f.valorAgregado && textoContratos(f.descripcion, 254) !== '')
    .map((f) => ({
      codigoGrupo: codigoCorto(f.codigoGrupo, 3),
      codigoSubtipo: codigoCorto(f.codigoSubtipo, 3),
      descripcion: textoContratos(f.descripcion, 254),
      valorUnitario: positivo(f.valorConIva ?? f.valorUnitario),
      cantidadRequerida: positivo(f.cantidadRequerida),
      cantidadComprar: positivo(f.cantidadComprar),
      mesesDepreciacion: Math.min(999, Math.max(1, Math.round(positivo(f.mesesDepreciacion) || 1))),
      valorMesMantenimiento: positivo(f.valorMesMantenimiento),
    }));
}

/** Los servicios no continuos de la pantalla (sin los de Valor agregado), con su costo por rubro y su valor mensual. */
export function serviciosNoContinuosParaPuente(servicios: ServicioNoContinuoPantallaDto[] | null | undefined): ServicioNoContinuoPayload[] {
  return (servicios ?? [])
    .filter((s) => !s.valorAgregado && positivo(s.valorMensual) > 0)
    .map((s) => {
      const actividad = /^\d{1,3}$/.test(String(s.codigo ?? '').trim()) ? Number(String(s.codigo).trim()) : null;
      return {
        actividad,
        uen: codigoCorto(s.uen, 3),
        descripcion: textoContratos(s.descripcion, 250) || 'Servicio no continuo',
        frecuencia: frecuenciaValida(s.frecuencia) ?? 1,
        manoObra: positivo(s.manoObra),
        insumos: positivo(s.insumos),
        equipos: positivo(s.equipos),
        otrosCostos: positivo(s.otrosCostos),
        valorServicio: positivo(s.valorServicio),
        valorMensual: positivo(s.valorMensual),
      };
    });
}

/** Las filas de la pestaña Valor Agregado con valor (reinversiones y recursos marcados como valor agregado). */
export function valoresAgregadosParaPuente(filas: FilaValorAgregadoPantallaDto[] | null | undefined): ValorAgregadoPayload[] {
  return (filas ?? [])
    .filter((f) => positivo(f.valorMensual) > 0)
    .map((f) => ({
      tipo: f.tipo,
      descripcion: textoContratos(f.descripcion, 254),
      valorMensual: f.valorMensual,
      frecuencia: frecuenciaValida(f.frecuencia),
      tipoReinversion: f.tipoReinversion,
      porcentaje: typeof f.porcentaje === 'number' && Number.isFinite(f.porcentaje) && f.porcentaje >= 0 && f.porcentaje <= 100 ? f.porcentaje : null,
    }));
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
  /** Insumos de la oferta (`insumosParaPuente`): lista de precios y pestaña Insumos. */
  insumos?: InsumoPayload[] | null;
  /** Costos administrativos (`costosAdministrativosParaPuente`): pestaña Costos Admtivos. */
  costosAdministrativos?: CostoAdministrativoPayload[] | null;
  /** Pestañas Equipos, Servs. No Continuos y Valores Agregados. */
  equipos?: EquipoPayload[] | null;
  serviciosNoContinuos?: ServicioNoContinuoPayload[] | null;
  valoresAgregados?: ValorAgregadoPayload[] | null;
}): PayloadContratosV1 {
  const { solicitud: s, resultado: r, totales: t, destino: dest, cargos, insumos, costosAdministrativos, equipos, serviciosNoContinuos, valoresAgregados } = d;
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
    ...(insumos && insumos.length > 0 ? { insumos } : {}),
    ...(costosAdministrativos && costosAdministrativos.length > 0 ? { costosAdministrativos } : {}),
    ...(equipos && equipos.length > 0 ? { equipos } : {}),
    ...(serviciosNoContinuos && serviciosNoContinuos.length > 0 ? { serviciosNoContinuos } : {}),
    ...(valoresAgregados && valoresAgregados.length > 0 ? { valoresAgregados } : {}),
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
  insumos: 'Insumos',
  costosAdministrativos: 'Costos administrativos (conceptos que van en OTROS)',
  equipos: 'Equipos',
  serviciosNoContinuos: 'Servicios no continuos',
  valoresAgregados: 'Valores agregados',
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
