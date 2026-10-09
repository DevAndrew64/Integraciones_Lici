/**
 * Núcleo del módulo 4 — oferta y tarifas. Funciones PURAS (sin base de datos ni reloj): las reglas del formulario de
 * Contratos y la fila que se escribe en `fc_contratos_tarifa_inicial`. El escritor MySQL solo la ejecuta.
 *
 * Fuente: `cmdGrabar.Click` de `frmcntrto_inicial` (versión de octubre de 2026). Su INSERT de tarifa escribe 30 columnas y el
 * de cargos 47; aquí se escriben esas mismas, en su mismo orden, para que lo guardado sea indistinguible de lo digitado a mano.
 */

/** Valor `NOW()` de MySQL (la fecha la pone el servidor, como hace Visual FoxPro). */
export const AHORA = Object.freeze({ sql: 'NOW()' });

/** Quién figura como autor de lo que escribe el puente. `user_add` es varchar(12). */
export const USUARIO_PUENTE = 'LICICOLBA';

const PREFIJO_MARCA = 'LICICOLBA:';

/** `tar_otros` es int(10): el mayor valor que admite. */
export const MAX_INT10 = 2_147_483_647;

/** Las 30 columnas del INSERT de tarifa de `cmdGrabar.Click`, en su orden. */
export const COLUMNAS_TARIFA_VFP = [
  'empresa', 'undnegocio', 'num_oferta', 'ncontrato', 'nit', 'rsocial', 'consec', 'codservicio', 'descripcion', 'tipo_adm',
  'tarifa', 'tar_manoobra', 'tar_examenes', 'tar_dotacion', 'tar_impuestos', 'aiu', 'aiu_examenes', 'aiu_dotacion',
  'exa_medico_vta', 'venta_dotacion', 'dot_epp_factur', 'costos_reembol', 'aplica_dotacion', 'aplica_examen', 'aplica_curso', 'curso_vta',
  'origen_proceso', 'user_add', 'fadd', 'pc_add',
];

/**
 * Componentes que el formulario de octubre ya no escribe (los insumos van repartidos en las líneas de cargos), pero cuyas
 * columnas existen y las usaron las ofertas anteriores (tarifa = suma de los seis `tar_*` en el 99,7 % de las filas).
 * Se escriben para que lo costeado en LiciColba no se pierda. Pendiente de confirmar con Contratos.
 */
export const COLUMNAS_TARIFA_HISTORICAS = ['tar_insumos', 'tar_maquinaria', 'tar_otros', 'tar_nocontinuos'];

/**
 * Marca de origen que queda en `pc_add` (el equipo que creó el registro). Identifica la fila como creada por LiciColba y
 * permite reconocer un reenvío de la misma solicitud sin tocar la estructura de Contratos: «LICICOLBA:42:3fa9c21b07de».
 */
export const marcaDeOrigen = (solicitudId, huella) => `${PREFIJO_MARCA}${solicitudId}:${huella.slice(0, 12)}`;

/** Patrón LIKE de cualquier envío de esa solicitud (el id solo tiene dígitos: sin comodines que escapar). */
export const patronDeSolicitud = (solicitudId) => `${PREFIJO_MARCA}${solicitudId}:%`;

/**
 * El A.I.U. se guarda como FRACCIÓN en la tarifa (10 % → 0.1000). El porcentaje tiene máximo 2 decimales (lo valida el
 * contrato), así que la conversión es exacta: se hace con enteros, sin coma flotante.
 * @param {number} porcentaje p. ej. 12.32
 * @returns {string} p. ej. «0.1232» (cabe en decimal(13,10))
 */
export function aiuComoFraccion(porcentaje) {
  const centesimas = Math.round(porcentaje * 100);
  return `${Math.floor(centesimas / 10_000)}.${String(centesimas % 10_000).padStart(4, '0')}`;
}

const aEntero = (valor) => (valor === null || valor === undefined ? 0 : valor);

/**
 * Arma la fila de `fc_contratos_tarifa_inicial` y comprueba las reglas del formulario que no dependen de la base:
 * el A.I.U. no puede ser 0 ("Falta el AIU de la Tarifa.") y cada valor debe caber en su columna.
 *
 * @param {object} datos contrato v1 ya validado, con las secciones `oferta` y `tarifa`
 * @param {{cliente: {nit: string, rsocial: string}, numOferta?: number | null, huella?: string}} contexto
 *   `cliente` es el de Contratos (NIT tal como está guardado); `numOferta` null = aún no reservado (modo prueba)
 * @returns {{errores: {campo: string, mensaje: string}[], fila: Record<string, unknown> | null}}
 */
export function planDeTarifa(datos, { cliente, numOferta = null, huella = '' }) {
  const errores = [];
  const { oferta, tarifa: t, contrato, origen } = datos;
  const aiu = contrato.porcentajeAIU;

  if (!aiu) errores.push({ campo: 'contrato.porcentajeAIU', mensaje: 'El A.I.U. no puede estar vacío ni ser 0: Contratos no deja guardar una tarifa sin A.I.U.' });
  if (t.valorAgregado !== null && t.valorAgregado > MAX_INT10) {
    errores.push({ campo: 'tarifa.valorAgregado', mensaje: `Supera el máximo que admite Contratos en esta columna (${MAX_INT10.toLocaleString('es-CO')}).` });
  }
  const total = [t.manoObra, t.insumos, t.maquinaria, t.administrativos, t.valorAgregado, t.serviciosNoContinuos].reduce((suma, v) => suma + aEntero(v), 0);
  if (!Number.isSafeInteger(total)) errores.push({ campo: 'tarifa', mensaje: 'La suma de la tarifa supera el máximo que admite Contratos.' });
  if (errores.length > 0) return { errores, fila: null };

  const fila = {
    empresa: oferta.empresa,
    undnegocio: oferta.undnegocio,
    num_oferta: numOferta,
    ncontrato: '', // la oferta nace sin contrato; el contrato la enlaza después
    nit: cliente.nit,
    rsocial: cliente.rsocial,
    consec: 1,
    codservicio: oferta.codServicio,
    descripcion: oferta.descripcionServicio ?? '',
    tipo_adm: oferta.tipoAdm,
    tarifa: total,
    // «Vr. Mano Obra» de LiciColba ya incluye turnantes, dotación/EPP y exámenes: no se venden aparte (los indicadores quedan en 0).
    tar_manoobra: t.manoObra,
    tar_examenes: 0,
    tar_dotacion: 0,
    // «Costos Admtivos.»: la columna conserva su nombre antiguo (impuestos) pero guarda los costos administrativos.
    tar_impuestos: t.administrativos,
    aiu: aiuComoFraccion(aiu),
    aiu_examenes: 0,
    aiu_dotacion: 0,
    exa_medico_vta: 0,
    venta_dotacion: 0,
    dot_epp_factur: 0,
    costos_reembol: 0,
    aplica_dotacion: 0,
    aplica_examen: 0,
    aplica_curso: 0,
    curso_vta: 0,
    origen_proceso: oferta.origenProceso,
    user_add: USUARIO_PUENTE,
    fadd: AHORA,
    pc_add: marcaDeOrigen(origen.solicitudId, huella),
    tar_insumos: t.insumos,
    tar_maquinaria: t.maquinaria,
    tar_otros: t.valorAgregado,
    tar_nocontinuos: t.serviciosNoContinuos,
  };
  return { errores, fila };
}

/** Las 47 columnas del INSERT de cargos de `cmdGrabar.Click`, en su orden. */
export const COLUMNAS_CARGO_VFP = [
  'empresa', 'undnegocio', 'ncontrato', 'num_oferta', 'consec', 'concepto', 'cod_seccion', 'tipo_cargo', 'item', 'cargo', 'jornada', 'horassem',
  'cantidad', 'vlr_unitario', 'vlr_total', 'codmun', 'salario', 'dotm', 'dotf', 'riesgo', 'tipocont',
  'epp', 'examen', 'snextras', 'snrecargos', 'snfestivos', 'snextrasf', 'cnextras', 'cnrecargos', 'cnfestivos', 'cnextrasf',
  'rnocturno', 'ediurnas', 'rfestivas', 'enocturnas', 'hfestivas', 'efestivas', 'enocturnasf', 'nom_cargo', 'nivel_educacion', 'titulo_educacion',
  'curso_formacion', 'experiencia', 'cod_grupo_curso', 'user_add', 'fadd', 'pc_add',
];

/** Se escribe además cuando LiciColba lo trae: el horario del cargo (su código debe existir en `fc_horarios`). */
export const COLUMNA_CARGO_HORARIO = 'codhorario';

const pesos = (n) => Math.round(n).toLocaleString('es-CO');

/**
 * Filas de `fc_contratos_cargos_iniciales`: una por línea de cargo, con el mismo orden y los mismos valores que el INSERT de
 * Visual FoxPro. Lo que LiciColba no trae (sección de nómina, estudios, experiencia, grupos de dotación/EPP/exámenes/cursos,
 * tipo de contrato, municipio, bonos y recargos) queda en el valor con que el formulario lo inserta —el mismo de la base—
 * y se completa en Contratos.
 *
 * - El **código de cargo es un consecutivo por oferta** (ya no el código de nómina): la misma información de cargo (nombre y
 *   salario) tiene el mismo código y dos cargos distintos nunca comparten uno; así lo exige el formulario.
 * - `item` es el número de la línea dentro de la oferta (1, 2, 3…): nunca se repite dentro de (sección, cargo), como exige el formulario.
 * - `valorTotal` debe ser `valorUnitario × cantidad` (con 1 peso de holgura por el redondeo a 5 decimales).
 * - Si los cargos no suman lo que equivale la mano de obra de la tarifa, avisa (puede faltar algún cargo): no bloquea.
 *
 * @param {object} datos contrato v1 ya validado
 * @param {{numOferta?: number | null, huella?: string}} contexto `numOferta` null = aún no reservado (modo prueba)
 * @returns {{errores: {campo: string, mensaje: string}[], advertencias: {campo: string, mensaje: string}[], filas: Record<string, unknown>[]}}
 */
export function planDeCargos(datos, { numOferta = null, huella = '' } = {}) {
  const errores = [];
  const advertencias = [];
  const cargos = datos.cargos ?? [];
  if (cargos.length === 0 || !datos.oferta) return { errores, advertencias, filas: [] };
  const { oferta, origen, contrato, tarifa } = datos;

  const codigos = new Map();
  const filas = cargos.map((c, i) => {
    const clave = `${comparable(c.nombre)}|${c.salario}`;
    if (!codigos.has(clave)) codigos.set(clave, codigos.size + 1);
    if (Math.abs(c.valorTotal - c.valorUnitario * c.cantidad) > 1) {
      errores.push({ campo: `cargos[${i}].valorTotal`, mensaje: 'No coincide con valorUnitario × cantidad.' });
    }
    const fila = {
      empresa: oferta.empresa,
      undnegocio: oferta.undnegocio,
      ncontrato: '',
      num_oferta: numOferta,
      consec: 1,
      concepto: oferta.codServicio,
      cod_seccion: 0, // la sección de nómina la digita Nómina en Contratos
      tipo_cargo: '',
      item: i + 1,
      cargo: codigos.get(clave),
      jornada: c.jornada,
      horassem: c.horasSemana,
      cantidad: c.cantidad,
      vlr_unitario: c.valorUnitario,
      vlr_total: c.valorTotal,
      codmun: '',
      salario: c.salario,
      dotm: '',
      dotf: '',
      riesgo: c.riesgo,
      tipocont: '',
      epp: '',
      examen: '',
      snextras: 0, snrecargos: 0, snfestivos: 0, snextrasf: 0,
      cnextras: 0, cnrecargos: 0, cnfestivos: 0, cnextrasf: 0,
      rnocturno: 0, ediurnas: 0, rfestivas: 0, enocturnas: 0, hfestivas: 0, efestivas: 0, enocturnasf: 0,
      nom_cargo: c.nombre,
      nivel_educacion: '',
      titulo_educacion: '',
      curso_formacion: '',
      experiencia: 0,
      cod_grupo_curso: '',
      user_add: USUARIO_PUENTE,
      fadd: AHORA,
      pc_add: marcaDeOrigen(origen.solicitudId, huella),
    };
    if (c.codigoHorario) fila[COLUMNA_CARGO_HORARIO] = c.codigoHorario;
    return fila;
  });

  const aiu = contrato?.porcentajeAIU;
  if (aiu && tarifa?.manoObra !== null && tarifa?.manoObra !== undefined) {
    const sinAIU = cargos.reduce((suma, c) => suma + c.valorTotal, 0);
    const esperado = sinAIU * (1 + aiu / 100);
    if (Math.abs(esperado - tarifa.manoObra) > cargos.length + 1) {
      advertencias.push({
        campo: 'cargos',
        mensaje: `Los cargos suman ${pesos(sinAIU)} sin A.I.U. (${pesos(esperado)} con A.I.U.) y la mano de obra de la tarifa es ${pesos(tarifa.manoObra)}: revise que estén todos los cargos.`,
      });
    }
  }
  return { errores, advertencias, filas };
}

/** La fila como JSON legible (en modo prueba): `NOW()` como texto. */
export const describirFila = (fila) => Object.fromEntries(Object.entries(fila).map(([columna, valor]) => [columna, valor === AHORA ? AHORA.sql : valor]));

const MOTIVOS_NO_ESCRITOS = [
  ['contrato.objeto', 'Va en «Descripción» y «Objeto» del contrato, que Contratos crea después de la oferta.'],
  ['contrato.valorMensual', 'El total del contrato lo calcula Contratos con las tarifas y el plazo; la tarifa sale de los seis valores.'],
  ['contrato.plazoMeses', 'Va en las fechas del contrato, que Contratos crea después de la oferta.'],
  ['cliente.direccion', 'La dirección vive en el cliente de Contratos.'],
];

/** Lo que LiciColba envió y que este módulo NO escribe (se digita en Contratos): así nada se pierde sin que se sepa. */
export function noEscritoEnLaOferta(datos) {
  const valor = (ruta) => ruta.split('.').reduce((o, k) => o?.[k], datos);
  const lista = MOTIVOS_NO_ESCRITOS.filter(([campo]) => valor(campo) !== null && valor(campo) !== undefined).map(([campo, motivo]) => ({ campo, motivo }));
  if (datos.cargos?.length > 0) {
    lista.push({
      campo: 'cargos',
      motivo: 'Se escriben el cargo, las personas, las horas, el salario, el riesgo, el horario y los valores. La sección de nómina, los estudios y la experiencia, los grupos de dotación, EPP, exámenes y cursos, el tipo de contrato, los bonos y los recargos se completan en Contratos.',
    });
  }
  return lista;
}

/** Normalización mínima para contrastar razones sociales (mayúsculas, sin tildes, sin puntuación ni espacios repetidos). */
export const comparable = (texto) =>
  String(texto).normalize('NFD').replace(/\p{Diacritic}/gu, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
