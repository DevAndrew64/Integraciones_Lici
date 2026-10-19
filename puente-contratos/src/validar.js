/**
 * Validación del JSON que envía LiciColba (contrato v1: cliente, datos generales, oferta, tarifa y cargos).
 *
 * - Solo se aceptan los campos documentados: un campo desconocido es un error, así no se cuela nada que Contratos no
 *   pidió (p. ej. lo que digitan Legal o el cliente).
 * - Se devuelven TODOS los errores a la vez. Lo opcional que falta no bloquea: se informa como advertencia.
 * - `escribe: true` marca lo que hace falta para ESCRIBIR en Contratos: en modo prueba su ausencia es una advertencia;
 *   con `paraEscribir` es un error (el escritor nunca recibe una oferta a medias).
 * - Nunca se trunca ni se redondea en silencio: lo que no cabe se rechaza.
 * - Los límites de longitud de la oferta, la tarifa y los cargos son los de la columna real donde se escriben.
 * - Las tablas de Contratos son latin1: un carácter que no cabe se rechaza (nunca se cambia por «?» ni se corta).
 */
import { createHash } from 'node:crypto';
import { caracteresNoGuardables } from './latin1.js';

const ESQUEMA = {
  origen: {
    solicitudId: { tipo: 'entero', min: 1, requerido: true },
    procesoCodigo: { tipo: 'texto', max: 100, requerido: true },
  },
  cliente: {
    razonSocial: { tipo: 'texto', max: 200, requerido: true },
    nit: { tipo: 'nit', requerido: true },
    direccion: { tipo: 'texto', max: 200 },
  },
  contrato: {
    // «Descripción» (Datos Generales) y «Objeto» (Mic Hoja 1/4) llevan el mismo texto.
    objeto: { tipo: 'texto', max: 4000, multilinea: true },
    // A.I.U. de Contratos = el «% de I.U.» del costeo, aplicado a todo el costo (administrativos incluidos).
    porcentajeAIU: { tipo: 'numero', min: 0, max: 100, escribe: true },
    // El valor del contrato es MENSUAL (con IVA).
    valorMensual: { tipo: 'numero', min: 0 },
    plazoMeses: { tipo: 'entero', min: 1, max: 600 },
  },
  // Módulo 4 — la clave de la oferta en Contratos y los datos de su tarifa que LiciColba no tiene: los elige quien envía.
  oferta: {
    empresa: { tipo: 'codigo', max: 6, escribe: true },
    undnegocio: { tipo: 'codigo', max: 9, escribe: true },
    tipoAdm: { tipo: 'opcion', opciones: ['A', 'C'], escribe: true }, // A = Administración, C = Admon. y costos asumidos
    origenProceso: { tipo: 'opcion', opciones: ['LIC', 'INV'], escribe: true }, // LIC = licitación pública, INV = invitación privada
    codServicio: { tipo: 'codigo', max: 3, escribe: true }, // concepto de facturación (fc_conceptos.codcpto)
    descripcionServicio: { tipo: 'texto', max: 254 },
    // Base de nómina de donde salen los códigos de cargo, si la UEN tiene varias (Tempocolba: nominatmb o nominatmb2). La
    // elige la pantalla con la vista previa de cargos; sin ella, el puente usa la primera que tiene todos los cargos.
    baseNomina: { tipo: 'texto', max: 64, silencioso: true },
    // «Sector Econom.» de la tarifa (char(20)). Si no llega, el puente toma el que más usan las tarifas del cliente.
    sectorEconomico: { tipo: 'texto', max: 20, silencioso: true },
  },
  // Módulo 4 — los seis valores de «Operación del Contrato»: con el A.I.U. incluido, antes de IVA, en pesos enteros
  // (los calcula LiciColba: son los de la hoja «Contratos» del Excel de costos).
  tarifa: {
    manoObra: { tipo: 'pesos', escribe: true },
    insumos: { tipo: 'pesos', escribe: true },
    maquinaria: { tipo: 'pesos', escribe: true },
    administrativos: { tipo: 'pesos', escribe: true },
    valorAgregado: { tipo: 'pesos', escribe: true },
    serviciosNoContinuos: { tipo: 'pesos', escribe: true },
  },
};

/**
 * Secciones que son una LISTA de objetos. Siempre opcionales: sin ellas la oferta se crea sin esa parte y se avisa.
 * Los límites son los de la columna donde se escribe cada dato.
 */
const LISTAS = {
  // Módulo 5 — la mano de obra de la oferta: una fila por línea de cargo (cargo + horario). Los valores van SIN A.I.U. ni IVA
  // (así los guarda Contratos: el A.I.U. se aplica en la tarifa). El código del cargo lo toma el puente de la nómina de la UEN
  // por el nombre, salvo que quien envía haya elegido el cargo de nómina en la vista previa (`codigoNomina`).
  cargos: {
    max: 300,
    aviso: 'Sin cargos: la oferta se crea sin mano de obra y se completa en Contratos.',
    campos: {
      nombre: { tipo: 'texto', max: 100, requerido: true },
      codigoNomina: { tipo: 'entero', min: 1, max: 99_999_999, silencioso: true }, // <base de nómina>.cargos.codigo
      cantidad: { tipo: 'entero', min: 1, max: 99999, requerido: true }, // personas
      horasSemana: { tipo: 'entero', min: 1, max: 168, escribe: true },
      jornada: { tipo: 'numero', min: 0, max: 24, escribe: true }, // horas por día
      salario: { tipo: 'pesos', max: 9_999_999_999, escribe: true },
      riesgo: { tipo: 'entero', min: 1, max: 5, escribe: true }, // clase de riesgo ARL I a V
      valorUnitario: { tipo: 'monto', max: 9_999_999_999, requerido: true }, // costo mensual por trabajador
      valorTotal: { tipo: 'monto', max: 9_999_999_999_999, requerido: true }, // costo mensual de la línea
      codigoHorario: { tipo: 'codigo', max: 5, silencioso: true }, // debe existir en fc_horarios
      // Grupos del catálogo del almacén (los mismos de Contratos), solo si la línea usa uno de cada tipo.
      grupoDotacionMasculina: { tipo: 'grupo', prefijo: 'M', max: 4, silencioso: true }, // dotm char(4)
      grupoDotacionFemenina: { tipo: 'grupo', prefijo: 'F', max: 4, silencioso: true }, // dotf char(4)
      grupoEpp: { tipo: 'grupo', prefijo: 'EP', max: 5, silencioso: true }, // epp char(5)
      grupoExamen: { tipo: 'grupo', prefijo: 'EM', max: 5, silencioso: true }, // examen char(5)
      grupoCurso: { tipo: 'grupo', prefijo: ['GC', 'CU'], max: 5, silencioso: true }, // cod_grupo_curso char(5)
    },
  },
  // Módulo 6 — la lista de precios de los insumos de la oferta (`fc_preciosventas_oferta`): una fila por código de elemento
  // del almacén. El valor va SIN A.I.U. ni IVA (costo unitario): el puente calcula el precio de venta con el A.I.U.
  insumos: {
    max: 2000,
    aviso: null, // sin insumos no hay nada que avisar: la oferta no los exige
    campos: {
      codigo: { tipo: 'codigo', max: 10, requerido: true }, // fc_preciosventas_oferta.codigo char(10)
      nombre: { tipo: 'texto', max: 254, silencioso: true }, // solo para los mensajes: Contratos no lo guarda aquí
      valorUnitario: { tipo: 'monto', max: 99_999_999_999, requerido: true }, // decimal(15,4)
      // Pestaña Insumos de la oferta (`fc_elemxcont`): cantidad y frecuencia (meses) de facturación y valor unitario con IVA.
      cantidad: { tipo: 'monto', max: 99_999_999, silencioso: true },
      frecuenciaMeses: { tipo: 'monto', max: 999, silencioso: true },
      valorUnitarioConIva: { tipo: 'monto', max: 99_999_999_999, silencioso: true },
    },
  },
  // Pestaña Costos Admtivos de la oferta (`fc_contratos_costos_admtivos_iniciales`): pólizas, impuestos y cada variable
  // administrativa con su valor MENSUAL, sin A.I.U. El puente lo lleva al concepto de Contratos de igual nombre (o a OTROS).
  costosAdministrativos: {
    max: 100,
    aviso: null,
    campos: {
      concepto: { tipo: 'texto', max: 150, requerido: true },
      valorMensual: { tipo: 'monto', max: 999_999_999_999, requerido: true }, // valor decimal(18,0): se redondea al peso
    },
  },
  // Pestaña Equipos de la oferta (`fc_contratos_equipos_iniciales`): cada máquina de la pestaña Maquinaria (sin las de Valor
  // agregado), con el grupo y el subtipo del catálogo de activos fijos, el valor unitario CON IVA y el mantenimiento mensual.
  equipos: {
    max: 500,
    aviso: null,
    campos: {
      codigoGrupo: { tipo: 'codigo', max: 3, silencioso: true }, // tipo_equipo char(3)
      codigoSubtipo: { tipo: 'codigo', max: 3, silencioso: true }, // subtipo_equipo char(3)
      descripcion: { tipo: 'texto', max: 254, requerido: true }, // descrip_equipo varchar(50): se recorta
      valorUnitario: { tipo: 'monto', max: 9_999_999_999_999, silencioso: true }, // precio_costo decimal(18,2)
      cantidadRequerida: { tipo: 'monto', max: 99_999_999, silencioso: true }, // cant_facturar decimal(10,2)
      cantidadComprar: { tipo: 'monto', max: 99_999_999, silencioso: true }, // cantidad decimal(10,2)
      mesesDepreciacion: { tipo: 'entero', min: 1, max: 999, silencioso: true }, // frecuencia decimal(3,0)
      valorMesMantenimiento: { tipo: 'monto', max: 999_999_999_999, silencioso: true }, // vlr_mes_mantenimiento int(15)
    },
  },
  // Pestaña Servs. No Continuos (`fc_contratos_no_continuos_iniciales`): cada servicio (sin los de Valor agregado), con el
  // código y la UEN del catálogo de no continuos, su frecuencia (código 1-15 de Grupo Colba), el costo de cada servicio por
  // rubro y lo que vale por mes, sin A.I.U.
  serviciosNoContinuos: {
    max: 200,
    aviso: null,
    campos: {
      actividad: { tipo: 'entero', min: 0, max: 999, silencioso: true }, // actividad int(3)
      uen: { tipo: 'codigo', max: 3, silencioso: true }, // UEN_Adm y uen_punto char(3)
      descripcion: { tipo: 'texto', max: 250, requerido: true },
      frecuencia: { tipo: 'entero', min: 1, max: 15, requerido: true },
      manoObra: { tipo: 'monto', max: 999_999_999_999, silencioso: true },
      insumos: { tipo: 'monto', max: 999_999_999_999, silencioso: true },
      equipos: { tipo: 'monto', max: 999_999_999_999, silencioso: true },
      otrosCostos: { tipo: 'monto', max: 999_999_999_999, silencioso: true },
      valorServicio: { tipo: 'monto', max: 999_999_999_999, requerido: true }, // valor decimal(18,0)
      valorMensual: { tipo: 'monto', max: 999_999_999, requerido: true }, // vlr_mes int(12)
      // Duración de cada servicio, de sus tarifas y cargos en LiciColba (null si el servicio no lo dice).
      diasServicio: { tipo: 'entero', min: 0, max: 999, silencioso: true }, // cant_max_dias_servicio y dias_habiles int(10)
      horasServicio: { tipo: 'numero', min: 0, max: 24, silencioso: true }, // horas_jornada decimal(10,7) y cant_max_hrs_servicio
      operarios: { tipo: 'entero', min: 0, max: 9999, silencioso: true }, // oper_fijos
    },
  },
  // Pestaña Valores Agregados (`fc_contratos_vlrs_agregs_iniciales`): cada fila de la pestaña Valor Agregado de LiciColba con
  // su valor mensual sin A.I.U.; las reinversiones traen además su tipo y su porcentaje.
  valoresAgregados: {
    max: 500,
    aviso: null,
    campos: {
      tipo: { tipo: 'opcion', opciones: ['REINVERSION', 'MANO_DE_OBRA', 'INSUMOS', 'MAQUINARIA', 'SNC', 'EPP'], requerido: true },
      descripcion: { tipo: 'texto', max: 254, silencioso: true }, // solo para los mensajes
      valorMensual: { tipo: 'monto', max: 9_999_999_999_999, requerido: true }, // valor decimal(15,2)
      frecuencia: { tipo: 'entero', min: 1, max: 15, silencioso: true }, // frec_reinv int(3)
      tipoReinversion: { tipo: 'opcion', opciones: ['VALOR', 'PORCENTAJE'], silencioso: true },
      porcentaje: { tipo: 'monto', max: 100, silencioso: true }, // porc_reinv decimal(7,4)
    },
  },
};

/** Secciones que pueden faltar (los remitentes de los módulos 1 y 2 no las mandan); para escribir son obligatorias. */
const SECCIONES_OPCIONALES = new Set(['oferta', 'tarifa']);

const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/; // todo control salvo tab, salto de línea y retorno
const esObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const vacio = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

const VALIDADORES = {
  texto(valor, { max, multilinea = false }) {
    if (typeof valor !== 'string') return { error: 'Debe ser texto.' };
    let t = valor.normalize('NFC');
    if (CONTROL.test(t)) return { error: 'Contiene caracteres de control.' };
    const fuera = caracteresNoGuardables(t);
    if (fuera.length > 0) return { error: `Contiene caracteres que Contratos no puede guardar: ${fuera.slice(0, 5).map((c) => `«${c}»`).join(' ')}.` };
    t = multilinea ? t.replace(/\r\n?/g, '\n').split('\n').map((l) => l.trimEnd()).join('\n').trim() : t.replace(/\s+/g, ' ').trim();
    const largo = Array.from(t).length; // caracteres, no unidades UTF-16
    return largo > max ? { error: `Máximo ${max} caracteres (tiene ${largo}).` } : { valor: t };
  },
  nit(valor) {
    return typeof valor === 'string' && /^\d{5,15}$/.test(valor.trim()) ? { valor: valor.trim() } : { error: 'Debe tener entre 5 y 15 dígitos, sin puntos, guion ni dígito de verificación.' };
  },
  entero(valor, { min, max = Number.MAX_SAFE_INTEGER }) {
    if (!Number.isInteger(valor)) return { error: 'Debe ser un número entero.' };
    return valor < min || valor > max ? { error: `Debe estar entre ${min} y ${max}.` } : { valor };
  },
  numero(valor, { min, max = Number.MAX_SAFE_INTEGER }) {
    if (typeof valor !== 'number' || !Number.isFinite(valor)) return { error: 'Debe ser un número.' };
    if (!/^-?\d+(\.\d{1,2})?$/.test(String(valor))) return { error: 'Máximo 2 decimales.' };
    return valor < min || valor > max ? { error: `Debe estar entre ${min} y ${max}.` } : { valor };
  },
  /** Código de Contratos (empresa, UEN, concepto): letras y números, sin espacios. */
  codigo(valor, { max }) {
    if (typeof valor !== 'string') return { error: 'Debe ser texto.' };
    const t = valor.trim();
    if (!/^[A-Za-z0-9]+$/.test(t)) return { error: 'Solo letras y números, sin espacios.' };
    return t.length > max ? { error: `Máximo ${max} caracteres (tiene ${t.length}).` } : { valor: t };
  },
  /** Código de grupo del catálogo: su prefijo y dígitos («M025», «EP095»), en mayúsculas, sin pasarse de la columna. */
  grupo(valor, { prefijo, max }) {
    if (typeof valor !== 'string') return { error: 'Debe ser texto.' };
    const t = valor.trim().toUpperCase();
    const prefijos = [prefijo].flat();
    if (!prefijos.some((p) => new RegExp(`^${p}[0-9]+$`).test(t))) return { error: `Debe ser un código de grupo ${prefijos.join(' o ')} seguido de dígitos.` };
    return t.length > max ? { error: `Máximo ${max} caracteres (tiene ${t.length}).` } : { valor: t };
  },
  opcion(valor, { opciones }) {
    const t = typeof valor === 'string' ? valor.trim() : valor;
    return opciones.includes(t) ? { valor: t } : { error: `Debe ser uno de: ${opciones.join(', ')}.` };
  },
  /** Pesos enteros (sin decimales): lo que se guarda en las columnas `tar_*` y en el salario. */
  pesos(valor, { max = Number.MAX_SAFE_INTEGER } = {}) {
    if (typeof valor !== 'number' || !Number.isSafeInteger(valor)) return { error: 'Debe ser un número entero de pesos.' };
    if (valor < 0) return { error: 'No puede ser negativo.' };
    return valor > max ? { error: `No puede superar ${max.toLocaleString('es-CO')}.` } : { valor };
  },
  /**
   * Importe con centavos: el costo calculado por LiciColba trae muchos decimales y la columna guarda 5. Se redondea a 5
   * decimales (el sexto es ruido de la coma flotante), nunca más allá.
   */
  monto(valor, { max }) {
    if (typeof valor !== 'number' || !Number.isFinite(valor)) return { error: 'Debe ser un número.' };
    if (valor < 0) return { error: 'No puede ser negativo.' };
    return valor > max ? { error: `No puede superar ${max.toLocaleString('es-CO')}.` } : { valor: Math.round(valor * 1e5) / 1e5 };
  },
};

/** Valida un objeto contra sus campos y devuelve el objeto limpio (los errores y advertencias se acumulan en `ctx`). */
function validarCampos(origen, campos, prefijo, { paraEscribir, errores, advertencias }) {
  const salida = {};
  for (const k of Object.keys(origen)) if (!(k in campos)) errores.push({ campo: `${prefijo}.${k}`, mensaje: 'Campo no permitido.' });
  for (const [nombre, regla] of Object.entries(campos)) {
    const ruta = `${prefijo}.${nombre}`;
    if (vacio(origen[nombre])) {
      if (regla.requerido) errores.push({ campo: ruta, mensaje: 'Es obligatorio.' });
      else if (regla.escribe && paraEscribir) errores.push({ campo: ruta, mensaje: 'Es obligatorio para escribir en Contratos.' });
      else if (!regla.silencioso) advertencias.push({ campo: ruta, mensaje: regla.escribe ? 'Falta para poder escribir en Contratos.' : 'Sin dato: se completa en Contratos.' });
      salida[nombre] = null;
      continue;
    }
    const r = VALIDADORES[regla.tipo](origen[nombre], regla);
    if (r.error) errores.push({ campo: ruta, mensaje: r.error });
    else salida[nombre] = r.valor;
  }
  return salida;
}

/**
 * @param {unknown} entrada
 * @param {{paraEscribir?: boolean}} [opciones] con `paraEscribir`, lo marcado `escribe` es obligatorio (modo «escritura»)
 * @returns {{ok: true, datos: object, advertencias: object[]} | {ok: false, errores: {campo: string, mensaje: string}[]}}
 */
export function validarContrato(entrada, { paraEscribir = false } = {}) {
  if (!esObjeto(entrada)) return { ok: false, errores: [{ campo: '(cuerpo)', mensaje: 'Se esperaba un objeto JSON.' }] };
  const errores = [];
  const advertencias = [];
  const ctx = { paraEscribir, errores, advertencias };
  const datos = { version: 1 };

  if (entrada.version !== 1) errores.push({ campo: 'version', mensaje: 'La versión del contrato debe ser 1.' });
  for (const k of Object.keys(entrada)) if (k !== 'version' && !(k in ESQUEMA) && !(k in LISTAS)) errores.push({ campo: k, mensaje: 'Campo no permitido.' });

  for (const [seccion, campos] of Object.entries(ESQUEMA)) {
    const origen = entrada[seccion];
    if (SECCIONES_OPCIONALES.has(seccion) && (origen === undefined || origen === null)) {
      datos[seccion] = null;
      if (paraEscribir) errores.push({ campo: seccion, mensaje: 'Falta la sección: es obligatoria para escribir en Contratos.' });
      else advertencias.push({ campo: seccion, mensaje: 'Sin esta sección no se puede escribir en Contratos.' });
      continue;
    }
    if (!esObjeto(origen)) {
      errores.push({ campo: seccion, mensaje: 'Falta la sección.' });
      continue;
    }
    datos[seccion] = validarCampos(origen, campos, seccion, ctx);
  }

  // Las listas ausentes o vacías no llevan clave en `datos`: así la huella de un envío sin ellas no cambia al agregar módulos.
  for (const [seccion, lista] of Object.entries(LISTAS)) {
    const valor = entrada[seccion];
    if (valor === undefined || valor === null || (Array.isArray(valor) && valor.length === 0)) {
      if (lista.aviso) advertencias.push({ campo: seccion, mensaje: lista.aviso });
      continue;
    }
    if (!Array.isArray(valor)) {
      errores.push({ campo: seccion, mensaje: 'Debe ser una lista.' });
      continue;
    }
    if (valor.length > lista.max) {
      errores.push({ campo: seccion, mensaje: `Máximo ${lista.max} elementos (tiene ${valor.length}).` });
      continue;
    }
    datos[seccion] = valor.map((elemento, i) => {
      if (esObjeto(elemento)) return validarCampos(elemento, lista.campos, `${seccion}[${i}]`, ctx);
      errores.push({ campo: `${seccion}[${i}]`, mensaje: 'Debe ser un objeto.' });
      return null;
    });
  }
  return errores.length > 0 ? { ok: false, errores } : { ok: true, datos, advertencias };
}

const canonico = (v) => {
  if (Array.isArray(v)) return v.map(canonico);
  if (esObjeto(v)) return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonico(v[k])]));
  return v;
};

/** Huella SHA-256 del contenido validado (claves ordenadas): mismo contenido ⇒ misma huella. Base de la idempotencia. */
export function huella(datos) {
  return createHash('sha256').update(JSON.stringify(canonico(datos))).digest('hex');
}
