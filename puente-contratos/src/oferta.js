/**
 * Núcleo de los módulos 4 a 6 — oferta, tarifa, cargos y precios. Funciones PURAS (sin base de datos ni reloj): las filas de
 * `fc_contratos_tarifa_inicial` y `fc_contratos_cargos_iniciales` (lo que escribe «Guardar oferta» de Contratos), de
 * `fc_ofertas_adjudicadas` y de `fc_preciosventas_oferta`. El escritor MySQL solo las ejecuta.
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
 * La marca que cabe en una columna de `largo` caracteres (null = largo desconocido): completa si cabe; si no, la corta
 * «LICICOLBA:<solicitud>:» (sigue reconociendo un reenvío, pero ya no distingue si cambió el contenido).
 */
export function marcaQueCabe(solicitudId, huella, largo) {
  const completa = marcaDeOrigen(solicitudId, huella);
  return largo === null || largo === undefined || completa.length <= largo ? completa : `${PREFIJO_MARCA}${solicitudId}:`;
}

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

/**
 * Fila de `fc_ofertas_adjudicadas` (la tabla que existe en la base viva de Contratos): una por oferta adjudicada, con los
 * valores de la tarifa en pesos enteros (columnas int). Mismo criterio que la tarifa de Contratos: la columna de impuestos
 * guarda los costos administrativos y «otros» el valor agregado. `vlr_adjudicado` es la suma de los seis valores.
 * Las columnas `int` de MySQL admiten hasta 2.147.483.647 aunque se declaren int(18): un valor mayor se rechaza aquí.
 *
 * @param {object} datos contrato v1 ya validado, con las secciones `oferta` y `tarifa`
 * Como en las demás tablas de Contratos: `user_add` = LICICOLBA, `fadd` = NOW() del servidor y en `pc_add` la marca de
 * origen (así se reconoce un reenvío sin columnas nuevas). `user_mod`, `fmod` y `pc_mod` no se tocan.
 *
 * @param {object} datos contrato v1 ya validado, con las secciones `oferta` y `tarifa`
 * @param {{cliente: {nit: string, rsocial: string}, numOferta?: number | null, huella?: string, largoUserAdd?: number | null, largoPcAdd?: number | null}} contexto
 *   `numOferta` null = aún no reservado; los largos son los de la base real (null = desconocido)
 * @returns {{errores: {campo: string, mensaje: string}[], fila: Record<string, unknown> | null}}
 */
export function planDeOfertaAdjudicada(datos, { cliente, numOferta = null, huella = '', largoUserAdd = null, largoPcAdd = null }) {
  const { oferta, tarifa: t, origen } = datos;
  const pesosEnteros = (v) => Math.round(aEntero(v));
  const valores = {
    vlr_manoobra: pesosEnteros(t.manoObra),
    vlr_insumos: pesosEnteros(t.insumos),
    vlr_maquinaria: pesosEnteros(t.maquinaria),
    vlr_impuestos: pesosEnteros(t.administrativos),
    vlr_otros: pesosEnteros(t.valorAgregado),
    vlr_nocontinuos: pesosEnteros(t.serviciosNoContinuos),
  };
  const vlr_adjudicado = Object.values(valores).reduce((suma, v) => suma + v, 0);
  const errores = Object.entries({ vlr_adjudicado, ...valores })
    .filter(([, v]) => v > MAX_INT10)
    .map(([columna]) => ({ campo: 'tarifa', mensaje: `«${columna}» supera el máximo que admite Contratos (${MAX_INT10.toLocaleString('es-CO')}).` }));
  if (errores.length > 0) return { errores, fila: null };
  return {
    errores,
    fila: {
      empresa: oferta.empresa,
      undnegocio: oferta.undnegocio,
      num_oferta: numOferta,
      nit: cliente.nit,
      rsocial: cliente.rsocial,
      vlr_adjudicado,
      ...valores,
      user_add: largoUserAdd ? USUARIO_PUENTE.slice(0, largoUserAdd) : USUARIO_PUENTE,
      fadd: AHORA,
      pc_add: marcaQueCabe(origen.solicitudId, huella, largoPcAdd),
    },
  };
}

/** Cliente (plantilla) y punto con que se escribe la lista de precios: LiciColba no maneja puntos de entrega. */
export const CLIENTE_PLANTILLA = 'tmp1';

const cuatroDecimales = (n) => Math.round(n * 1e4) / 1e4;

/**
 * Módulo 6 — filas de `fc_preciosventas_oferta` («Listas de Precio en la Oferta»): una por código de elemento de los
 * insumos, con el costo unitario (`vr_costo`), el A.I.U. como fracción y el precio de venta = costo × (1 + A.I.U.).
 * Como en Contratos, `cliente` es la plantilla («tmp1», el primer punto) y `nom_punto` el nombre del punto: LiciColba no
 * maneja puntos de entrega, así que va el código de la UEN y Contratos lo reparte por puntos. Un código repetido se
 * escribe una sola vez (el primero) y se avisa.
 *
 * @param {object} datos contrato v1 ya validado
 * @param {{numOferta?: number | null}} contexto `numOferta` null = aún no reservado (modo prueba)
 * @returns {{errores: {campo: string, mensaje: string}[], advertencias: {campo: string, mensaje: string}[], filas: Record<string, unknown>[]}}
 */
export function planDePreciosOferta(datos, { numOferta = null } = {}) {
  const errores = [];
  const advertencias = [];
  const insumos = datos.insumos ?? [];
  if (insumos.length === 0 || !datos.oferta) return { errores, advertencias, filas: [] };
  const { oferta, contrato } = datos;
  if (String(oferta.undnegocio ?? '').length > 3) {
    errores.push({ campo: 'oferta.undnegocio', mensaje: 'La lista de precios de Contratos guarda la UEN en 3 caracteres.' });
    return { errores, advertencias, filas: [] };
  }
  const aiu = contrato?.porcentajeAIU ?? 0;
  const vistos = new Set();
  const filas = [];
  insumos.forEach((insumo, i) => {
    const codigo = insumo.codigo.toUpperCase();
    if (vistos.has(codigo)) {
      advertencias.push({ campo: `insumos[${i}].codigo`, mensaje: `El código ${codigo} ya está en la lista: se escribe una sola vez (el primero).` });
      return;
    }
    vistos.add(codigo);
    const costo = cuatroDecimales(insumo.valorUnitario);
    filas.push({
      undnegocio: oferta.undnegocio,
      num_oferta: numOferta,
      ncontrato: '',
      cliente: CLIENTE_PLANTILLA,
      nom_punto: oferta.undnegocio,
      codigo,
      valor: cuatroDecimales(costo * (1 + aiu / 100)),
      valor_anterior: 0,
      aiu: aiuComoFraccion(aiu),
      fadd: AHORA,
      user_add: USUARIO_PUENTE,
      vr_costo: costo,
    });
  });
  return { errores, advertencias, filas };
}

/** Punto de entrega de las filas de la oferta que no son de una sede: así lo deja el formulario en las ofertas hechas a mano. */
export const PUNTO_SIN_SEDE = '0000000000';
/** Tipo de insumo con que el formulario guarda los insumos de una oferta en `fc_elemxcont` (todas las ofertas a mano: «F»). */
export const TIPO_INSUMO_OFERTA = 'F';
const NOMBRE_PUNTO_MAX = 60; // fc_elemxcont.nombre_punto y fc_contratos_costos_admtivos_iniciales.nombre_punto
const cincoDecimales = (n) => Math.round(n * 1e5) / 1e5;
const recortar = (texto, largo) => Array.from(String(texto ?? '').trim()).slice(0, largo).join('');

/**
 * Pestaña «Insumos» de la Oferta Inicial — filas de `fc_elemxcont` (MyISAM, compartida con los contratos vigentes: el
 * puente solo escribe y, si algo falla, borra las suyas). Una por insumo con código, como las ofertas hechas a mano:
 * cantidad y frecuencia (meses) de facturación y el valor unitario CON IVA, que es con el que LiciColba calcula el
 * valor mensual (cantidad × valor ÷ frecuencia): así la pestaña suma lo mismo que «Vr. Insumos» de la tarifa, sin A.I.U.
 * Un insumo que llegue sin cantidad, frecuencia o valor con IVA va solo a la lista de precios, y se avisa.
 *
 * @param {object} datos contrato v1 ya validado
 * @param {{numOferta?: number | null, huella?: string, cliente?: {nit: string, rsocial: string} | null}} contexto
 */
export function planDeInsumosOferta(datos, { numOferta = null, huella = '', cliente = null } = {}) {
  const errores = [];
  const advertencias = [];
  const insumos = datos.insumos ?? [];
  if (insumos.length === 0 || !datos.oferta) return { errores, advertencias, filas: [] };
  const { oferta, origen } = datos;
  const sinDetalle = [];
  const filas = [];
  insumos.forEach((insumo, i) => {
    const { cantidad, frecuenciaMeses, valorUnitarioConIva } = insumo;
    if ([cantidad, frecuenciaMeses, valorUnitarioConIva].some((v) => v === null || v === undefined) || cantidad <= 0) {
      sinDetalle.push(insumo.codigo ?? `#${i + 1}`);
      return;
    }
    filas.push({
      empresa: oferta.empresa,
      undnegocio: oferta.undnegocio,
      nit: cliente?.nit ?? '',
      ncontrato: '',
      tipo_insumo: TIPO_INSUMO_OFERTA,
      codele: insumo.codigo.toUpperCase(),
      cantidad,
      frecuencia: frecuenciaMeses > 0 ? frecuenciaMeses : 1,
      vlr_unitario: cincoDecimales(valorUnitarioConIva),
      cantsoli: 0,
      num_oferta: numOferta,
      consec: 1,
      concepto: oferta.codServicio,
      codmun: '',
      fadd: AHORA,
      user_add: USUARIO_PUENTE,
      pc_add: marcaDeOrigen(origen.solicitudId, huella),
      nitloc: '',
      nombre_punto: recortar(cliente?.rsocial, NOMBRE_PUNTO_MAX),
      clase: 1,
      vlr_unitario_va: 0,
    });
  });
  if (sinDetalle.length > 0) {
    advertencias.push({ campo: 'insumos', mensaje: `Sin cantidad, frecuencia o valor con IVA (van solo a la lista de precios): ${sinDetalle.join(', ')}.` });
  }
  return { errores, advertencias, filas };
}

/**
 * Catálogo `fc_conceptos_costos_admtivos` como está hoy en Contratos. El escritor lee el real; esta copia es solo para el
 * modo prueba, que no consulta la base.
 */
export const CATALOGO_COSTOS_ADMTIVOS = Object.freeze([
  { id: 1, descripcion: 'PÓLIZAS' },
  { id: 2, descripcion: 'IMPUESTOS' },
  { id: 3, descripcion: 'TRANSPORTE INSUMOS' },
  { id: 4, descripcion: 'SUPERVISIÓN - VISITAS' },
  { id: 5, descripcion: 'VIÁTICOS SUPERVISIÓN' },
  { id: 6, descripcion: 'PAPELERÍA Y OFICINAS' },
  { id: 7, descripcion: 'EXCEDENTE DE I.U.' },
  { id: 8, descripcion: 'PLANES DE DATOS' },
  { id: 9, descripcion: 'MANTENIMIENTO DE EQUIPOS' },
  { id: 10, descripcion: 'VALORES AGREGADOS CUANDO X OBLIGACION SE REQUIERA' },
  { id: 11, descripcion: 'OTROS' },
]);

/** Conceptos de LiciColba que en Contratos se llaman distinto (comparables, sin tildes ni puntuación). */
const ALIAS_COSTO_ADMTIVO = {
  PAPELERIA: 'PAPELERIA Y OFICINAS',
  'PLAN DE DATOS': 'PLANES DE DATOS',
  'TRANSPORTE DE INSUMOS': 'TRANSPORTE INSUMOS',
  SUPERVISION: 'SUPERVISION VISITAS',
  'VISITAS DE SUPERVISION': 'SUPERVISION VISITAS',
  'VIATICOS DE SUPERVISION': 'VIATICOS SUPERVISION',
  VIATICOS: 'VIATICOS SUPERVISION',
};
const OTROS_COSTOS = 'OTROS';

/** El concepto de Contratos para un concepto de LiciColba: por nombre (o su alias); si no hay, «OTROS». */
export function conceptoDeCostoAdmtivo(concepto, catalogo = CATALOGO_COSTOS_ADMTIVOS) {
  const clave = comparable(concepto);
  const buscado = ALIAS_COSTO_ADMTIVO[clave] ?? clave;
  const porNombre = catalogo.find((c) => comparable(c.descripcion) === buscado);
  if (porNombre) return { ...porNombre, esOtros: false };
  const otros = catalogo.find((c) => comparable(c.descripcion) === OTROS_COSTOS);
  return otros ? { ...otros, esOtros: true } : null;
}

/**
 * Pestaña «Costos Admtivos» de la Oferta Inicial — filas de `fc_contratos_costos_admtivos_iniciales`: una por concepto de
 * Contratos (`id_cpto_costo` de `fc_conceptos_costos_admtivos`) con su valor MENSUAL en pesos, SIN A.I.U. (la pantalla
 * muestra aparte el valor con A.I.U.). Pólizas e impuestos van a sus conceptos; cada variable administrativa de LiciColba
 * va al concepto de igual nombre y, si Contratos no lo tiene, a «OTROS» (se avisa cuáles). Varios conceptos de LiciColba
 * que caen en el mismo de Contratos se suman en una sola fila, como en las ofertas hechas a mano.
 *
 * @param {object} datos contrato v1 ya validado
 * @param {{numOferta?: number | null, huella?: string, cliente?: {rsocial: string} | null, catalogo?: {id: number, descripcion: string}[]}} contexto
 */
export function planDeCostosAdministrativos(datos, { numOferta = null, huella = '', cliente = null, catalogo = CATALOGO_COSTOS_ADMTIVOS } = {}) {
  const errores = [];
  const advertencias = [];
  const costos = datos.costosAdministrativos ?? [];
  if (costos.length === 0 || !datos.oferta) return { errores, advertencias, filas: [] };
  const { oferta, origen } = datos;
  const porConcepto = new Map();
  const aOtros = [];
  costos.forEach((c, i) => {
    if (!(c.valorMensual > 0)) return;
    const destino = conceptoDeCostoAdmtivo(c.concepto, catalogo);
    if (!destino) {
      errores.push({ campo: `costosAdministrativos[${i}].concepto`, mensaje: `El concepto «${c.concepto}» no existe en Contratos y Contratos no tiene el concepto «OTROS».` });
      return;
    }
    if (destino.esOtros && comparable(c.concepto) !== OTROS_COSTOS) aOtros.push(c.concepto);
    const actual = porConcepto.get(destino.id) ?? { id: destino.id, valor: 0 };
    actual.valor += c.valorMensual;
    porConcepto.set(destino.id, actual);
  });
  if (aOtros.length > 0) {
    advertencias.push({ campo: 'costosAdministrativos', mensaje: `Van en «OTROS» porque Contratos no tiene ese concepto: ${aOtros.join(', ')}.` });
  }
  const filas = [...porConcepto.values()]
    .sort((a, b) => a.id - b.id)
    .map(({ id, valor }) => ({
      empresa: oferta.empresa,
      undnegocio: oferta.undnegocio,
      num_oferta: numOferta,
      ncontrato: '',
      consec: 1,
      concepto: oferta.codServicio,
      punto_entrega: PUNTO_SIN_SEDE,
      nombre_punto: recortar(cliente?.rsocial, NOMBRE_PUNTO_MAX),
      codmun: '',
      id_cpto_costo: id,
      valor: Math.round(valor),
      user_add: USUARIO_PUENTE,
      fadd: AHORA,
      pc_add: marcaDeOrigen(origen.solicitudId, huella),
    }));
  return { errores, advertencias, filas };
}

const dosDecimales = (n) => Math.round(n * 100) / 100;
const NOMBRE_PUNTO_EQUIPOS_MAX = 50; // fc_contratos_equipos_iniciales.nom_punto_entrega char(50)
const DESCRIPCION_EQUIPO_MAX = 50; // descrip_equipo varchar(50)

/**
 * Pestaña «Equipos» de la Oferta Inicial — filas de `fc_contratos_equipos_iniciales`, una por máquina de la pestaña
 * Maquinaria de LiciColba (las de Valor agregado van a su pestaña). Grupo y subtipo del activo son los del catálogo de
 * activos fijos (los mismos códigos de Contratos: `tipo_equipo`/`subtipo_equipo`). Como en las ofertas hechas a mano:
 * `cantidad` = a comprar, `cant_facturar` = requeridas, `frecuencia` = meses de depreciación. El precio va CON IVA y
 * `porc_vlr_compra` en 1, así `valor × cantidad ÷ frecuencia` + el mantenimiento mensual suman lo de «Vr. Maquinaria» de la
 * tarifa, sin A.I.U. (las ofertas a mano usan 0,82; se ajusta en Contratos si aplica).
 *
 * @param {object} datos contrato v1 ya validado
 * @param {{numOferta?: number | null, huella?: string, cliente?: {rsocial: string} | null}} contexto
 */
export function planDeEquipos(datos, { numOferta = null, huella = '', cliente = null } = {}) {
  const errores = [];
  const advertencias = [];
  const equipos = datos.equipos ?? [];
  if (equipos.length === 0 || !datos.oferta) return { errores, advertencias, filas: [] };
  const { oferta, origen } = datos;
  const sinValor = [];
  const sinGrupo = [];
  const filas = [];
  equipos.forEach((e, i) => {
    const comprar = e.cantidadComprar ?? 0;
    const mantenimiento = e.valorMesMantenimiento ?? 0;
    if (!(comprar > 0 && e.valorUnitario > 0) && !(mantenimiento > 0)) {
      sinValor.push(e.descripcion || `#${i + 1}`);
      return;
    }
    if (!e.codigoGrupo || !e.codigoSubtipo) sinGrupo.push(e.descripcion || `#${i + 1}`);
    const precio = dosDecimales(e.valorUnitario ?? 0);
    filas.push({
      empresa: oferta.empresa,
      undnegocio: oferta.undnegocio,
      num_oferta: numOferta,
      ncontrato: '',
      consec: 1,
      concepto: oferta.codServicio,
      tipo_servicio: '',
      codmun: '',
      punto_entrega: PUNTO_SIN_SEDE,
      nom_punto_entrega: recortar(cliente?.rsocial, NOMBRE_PUNTO_EQUIPOS_MAX),
      tipo_equipo: e.codigoGrupo ?? '',
      subtipo_equipo: e.codigoSubtipo ?? '',
      codigo: '',
      descrip_equipo: recortar(e.descripcion, DESCRIPCION_EQUIPO_MAX),
      precio_costo: precio,
      porc_vlr_compra: 1,
      cantidad: dosDecimales(comprar),
      frecuencia: e.mesesDepreciacion ?? 1,
      valor: precio,
      cant_facturar: dosDecimales(e.cantidadRequerida ?? comprar),
      valor_inicial: precio,
      user_add: USUARIO_PUENTE,
      fadd: AHORA,
      pc_add: marcaDeOrigen(origen.solicitudId, huella),
      vlr_mes_mantenimiento: Math.round(mantenimiento),
      vlr_mes_otr_rubros: 0,
      clase: 1,
      valor_inicial_va: 0,
    });
  });
  if (sinValor.length > 0) advertencias.push({ campo: 'equipos', mensaje: `Sin compra ni mantenimiento (no van a la pestaña Equipos): ${sinValor.join(', ')}.` });
  if (sinGrupo.length > 0) advertencias.push({ campo: 'equipos', mensaje: `Sin grupo o subtipo del activo (se completan en Contratos): ${sinGrupo.join(', ')}.` });
  return { errores, advertencias, filas };
}

/** Tipo de actividad de un no continuo en Contratos, según qué lleva: personal (REHUM), equipos (MAQUI) o ambos. */
export function tipoDeActividad({ manoObra, equipos }) {
  if (manoObra > 0 && equipos > 0) return 'AMBOS';
  return equipos > 0 ? 'MAQUI' : 'REHUM';
}
/** Facturación por valor mensual: LiciColba reparte cada servicio en los meses de su frecuencia. */
export const FACTURACION_NO_CONTINUO = 'VM';

/**
 * Pestaña «Servs. No Continuos» de la Oferta Inicial — filas de `fc_contratos_no_continuos_iniciales`, una por servicio
 * no continuo de LiciColba (los de Valor agregado van a su pestaña). `actividad` y `UEN_Adm`/`uen_punto` son el código y la
 * UEN del catálogo de no continuos (el mismo de Contratos); `frecuencia` es el código de periodicidad de Grupo Colba (1-12
 * meses, 13 quincenal, 14 semanal, 15 a solicitud). `valor` es el costo de cada servicio (mano de obra + insumos + equipos
 * + otros costos) y `vlr_mes` lo que vale por mes, sin A.I.U.: la suma de `vlr_mes` es lo de «Vr. Servicios No Continuos».
 *
 * @param {object} datos contrato v1 ya validado
 * @param {{numOferta?: number | null, huella?: string, cliente?: {rsocial: string} | null}} contexto
 */
export function planDeNoContinuos(datos, { numOferta = null, huella = '', cliente = null } = {}) {
  const errores = [];
  const advertencias = [];
  const servicios = datos.serviciosNoContinuos ?? [];
  if (servicios.length === 0 || !datos.oferta) return { errores, advertencias, filas: [] };
  const { oferta, origen, contrato } = datos;
  const sinCatalogo = [];
  const filas = [];
  servicios.forEach((s, i) => {
    if (!(s.valorMensual > 0)) return;
    if (!s.actividad) sinCatalogo.push(s.descripcion || `#${i + 1}`);
    const manoObra = Math.round(s.manoObra ?? 0);
    const insumos = Math.round(s.insumos ?? 0);
    const equipos = Math.round(s.equipos ?? 0);
    const otros = Math.round(s.otrosCostos ?? 0);
    const meses = s.frecuencia >= 1 && s.frecuencia <= 12 ? s.frecuencia : null;
    filas.push({
      empresa: oferta.empresa,
      undnegocio: oferta.undnegocio,
      num_oferta: numOferta,
      ncontrato: '',
      consec: 1,
      concepto: oferta.codServicio,
      UEN_Adm: s.uen ?? '',
      actividad: s.actividad ?? 0,
      tipo_actividad: tipoDeActividad({ manoObra, equipos }),
      tipo: 1,
      clase: 1,
      frecuencia: s.frecuencia,
      punto_entrega: PUNTO_SIN_SEDE,
      nombre_punto: recortar(cliente?.rsocial, NOMBRE_PUNTO_MAX),
      codmun: '',
      descrip_servicio: recortar(s.descripcion, 250),
      tipo_facturacion: FACTURACION_NO_CONTINUO,
      valor: Math.round(s.valorServicio),
      vlr_mes: Math.round(s.valorMensual),
      vlr_mano_obra: manoObra,
      vlr_insumos: insumos,
      vlr_equipos: equipos,
      vlr_costos: otros,
      cant_servs_mes: 1,
      cant_servs_contrato: meses && contrato?.plazoMeses ? Math.max(1, Math.floor(contrato.plazoMeses / meses)) : 0,
      uen_punto: s.uen ?? '',
      user_add: USUARIO_PUENTE,
      fadd: AHORA,
      pc_add: marcaDeOrigen(origen.solicitudId, huella),
    });
  });
  if (sinCatalogo.length > 0) advertencias.push({ campo: 'serviciosNoContinuos', mensaje: `Sin código del catálogo de no continuos (la actividad se elige en Contratos): ${sinCatalogo.join(', ')}.` });
  return { errores, advertencias, filas };
}

/**
 * Tipo de valor agregado en Contratos (`fc_contratos_vlrs_agregs_iniciales.tipo`) para cada tipo de LiciColba.
 * POR CONFIRMAR con Contratos: se tomó el orden de los tipos de la pestaña Valor Agregado de LiciColba.
 */
export const TIPO_VALOR_AGREGADO = Object.freeze({ REINVERSION: 1, MANO_DE_OBRA: 2, INSUMOS: 3, MAQUINARIA: 4, SNC: 5, EPP: 6 });

/**
 * Pestaña «Valores Agregados» de la Oferta Inicial — filas de `fc_contratos_vlrs_agregs_iniciales`, una por fila de la
 * pestaña Valor Agregado de LiciColba (reinversiones y recursos marcados como valor agregado), con su valor MENSUAL sin
 * A.I.U. (la suma es «Vr. Valor Agregado» de la tarifa), el tipo de reinversión (1 valor, 2 porcentaje), su frecuencia
 * (código de Grupo Colba) y el porcentaje. Esta tabla no tiene `user_add`/`pc_add`: la marca va en `usuario`/`pc`.
 *
 * @param {object} datos contrato v1 ya validado
 * @param {{numOferta?: number | null, huella?: string}} contexto
 */
export function planDeValoresAgregados(datos, { numOferta = null, huella = '' } = {}) {
  const errores = [];
  const advertencias = [];
  const valores = datos.valoresAgregados ?? [];
  if (valores.length === 0 || !datos.oferta) return { errores, advertencias, filas: [] };
  const { oferta, origen } = datos;
  const filas = valores
    .filter((v) => v.valorMensual > 0)
    .map((v) => ({
      empresa: oferta.empresa,
      undnegocio: oferta.undnegocio,
      num_oferta: numOferta,
      ncontrato: '',
      consec: 1,
      concepto: oferta.codServicio,
      tipo: TIPO_VALOR_AGREGADO[v.tipo],
      valor: dosDecimales(v.valorMensual),
      tipo_reinv: v.tipoReinversion === 'PORCENTAJE' ? 2 : 1,
      frec_reinv: v.frecuencia ?? 1,
      porc_reinv: Math.round((v.porcentaje ?? 0) * 1e4) / 1e4,
      fproc: AHORA,
      usuario: USUARIO_PUENTE,
      pc: marcaDeOrigen(origen.solicitudId, huella),
    }));
  return { errores, advertencias, filas };
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

/**
 * Tablas de la oferta que se ADAPTAN a la base real (las activaron después y pueden traer menos columnas que producción):
 * las columnas que el puente escribe y las esenciales. Si falta una esencial no se escribe nada; si falta otra, se omite y
 * se informa. Nunca se crea ni se cambia una columna.
 */
export const TABLAS_ADAPTABLES = {
  fc_contratos_tarifa_inicial: {
    escritas: [...COLUMNAS_TARIFA_VFP, ...COLUMNAS_TARIFA_HISTORICAS],
    esenciales: ['empresa', 'undnegocio', 'num_oferta', 'nit', 'rsocial', 'codservicio', 'tarifa', 'tar_manoobra', 'tar_impuestos', 'aiu', 'pc_add'],
  },
  fc_contratos_cargos_iniciales: {
    escritas: [...COLUMNAS_CARGO_VFP, COLUMNA_CARGO_HORARIO],
    esenciales: ['empresa', 'undnegocio', 'num_oferta', 'item', 'cargo', 'cantidad', 'vlr_unitario', 'vlr_total', 'pc_add'],
  },
};

/** Qué dato de LiciColba se pierde si la base no tiene la columna (para avisarlo en «no escrito»). */
const CAMPO_DE_COLUMNA = {
  aiu: 'contrato.porcentajeAIU', tipo_adm: 'oferta.tipoAdm', origen_proceso: 'oferta.origenProceso', codservicio: 'oferta.codServicio',
  descripcion: 'oferta.descripcionServicio',
};

/** Sin la columna en la base: una entrada «no escrito» por dato de LiciColba que no quedó guardado. */
export function noEscritoPorColumnasAusentes(datos, omitidas = {}) {
  const lista = [];
  for (const columna of omitidas.fc_contratos_tarifa_inicial ?? []) {
    const campo = CAMPO_DE_COLUMNA[columna];
    const valor = campo?.split('.').reduce((o, k) => o?.[k], datos);
    if (campo && valor !== null && valor !== undefined && valor !== '') lista.push({ campo, motivo: `La tabla de tarifas de esta base de Contratos no tiene la columna ${columna}.` });
  }
  const cargos = omitidas.fc_contratos_cargos_iniciales ?? [];
  if (cargos.length > 0 && datos.cargos?.length > 0) lista.push({ campo: 'cargos', motivo: `La tabla de cargos de esta base de Contratos no tiene: ${cargos.join(', ')}.` });
  return lista;
}

const pesos = (n) => Math.round(n).toLocaleString('es-CO');

/** Desde este largo, el nombre de nómina puede venir cortado (`nominamn.cargos.nombre` es char(30)). */
const LARGO_NOMBRE_CORTADO = 30;

/**
 * Código de nómina de cada línea de cargo. Contratos muestra el cargo de la oferta buscando su código en la tabla `cargos`
 * de la base de nómina de la UEN (`gl_undnegocios.dbnomina`: `nominabq` en Barranquilla, `nominamn` en la mina), así que el
 * código escrito debe ser ese, no un número propio de LiciColba.
 *
 * - Se cruza por nombre (sin tildes, mayúsculas ni espacios repetidos). Un nombre de nómina cortado (30 caracteres) sirve
 *   si el de LiciColba empieza igual. El turnante automático de LiciColba («Turnante — …») es el cargo TURNANTE.
 * - Solo cuentan las filas sin empresa/UEN o de la misma empresa y UEN de la oferta (`nominamn.cargos` no tiene esas columnas).
 *   Se prefieren las generales (sin UEN), que son los cargos operativos; las de la UEN son el personal de la sede.
 * - Si hay varios códigos con el mismo nombre se usa el menor y se avisa. Si no hay ninguno, es un error: no se escribe.
 *
 * @param {object[]} cargos `datos.cargos`
 * @param {Record<string, unknown>[]} filasNomina filas de `<dbnomina>.cargos`
 * @param {{empresa: string, undnegocio: string, base: string}} contexto
 * @returns {{codigos: (number | null)[], errores: {campo: string, mensaje: string}[], advertencias: {campo: string, mensaje: string}[]}}
 */
export function codigosDeNomina(cargos, filasNomina, { empresa, undnegocio, base }) {
  const errores = [];
  const advertencias = [];
  const mayus = (v) => String(v ?? '').trim().toUpperCase();
  const candidatas = filasNomina
    .map((f) => ({ codigo: Number(f.codigo), nombre: String(f.nombre ?? '').trim(), empresa: mayus(f.empresa), undnegocio: mayus(f.undnegocio) }))
    .filter((f) => Number.isInteger(f.codigo) && f.codigo > 0 && f.nombre)
    .filter((f) => (!f.empresa || f.empresa === mayus(empresa)) && (!f.undnegocio || f.undnegocio === mayus(undnegocio)))
    .map((f) => ({ ...f, clave: comparable(f.nombre) }));

  const codigos = cargos.map((c, i) => {
    const campo = `cargos[${i}].nombre`;
    const nombre = comparable(c.nombre ?? '');
    if (!nombre) {
      errores.push({ campo, mensaje: `La línea ${i + 1} de cargos no tiene nombre de cargo.` });
      return null;
    }
    let opciones = candidatas.filter((f) => f.clave === nombre);
    if (opciones.length === 0) opciones = candidatas.filter((f) => f.nombre.length >= LARGO_NOMBRE_CORTADO && nombre.startsWith(f.clave));
    if (opciones.length === 0 && nombre.startsWith('TURNANTE')) opciones = candidatas.filter((f) => f.clave === 'TURNANTE');
    if (opciones.length === 0) {
      errores.push({ campo, mensaje: `El cargo «${String(c.nombre).trim()}» no existe en la nómina de la UEN ${undnegocio} (${base}.cargos). Use el nombre del cargo como está en nómina o pida a Nómina que lo cree, y vuelva a enviar.` });
      return null;
    }
    const generales = opciones.filter((f) => !f.undnegocio);
    const todos = [...new Set(opciones.map((f) => f.codigo))].sort((a, b) => a - b);
    const elegido = Math.min(...(generales.length > 0 ? generales : opciones).map((f) => f.codigo));
    if (todos.length > 1) {
      advertencias.push({ campo, mensaje: `En ${base}.cargos hay varios cargos «${String(c.nombre).trim()}» (códigos ${todos.join(', ')}): se escribió el ${elegido}. Revíselo en Contratos.` });
    }
    return elegido;
  });
  return { codigos, errores, advertencias };
}

/**
 * Filas de `fc_contratos_cargos_iniciales`: una por línea de cargo, con el mismo orden y los mismos valores que el INSERT de
 * Visual FoxPro. Los grupos de dotación (M/F), EPP, examen y curso van cuando LiciColba los identifica (uno por tipo). Lo que
 * LiciColba no trae (sección de nómina, estudios, experiencia,
 * tipo de contrato, municipio, bonos y recargos) queda en el valor con que el formulario lo inserta —el mismo de la base—
 * y se completa en Contratos.
 *
 * - El **código de cargo es el de la nómina de la UEN** (`codigosNomina`, ver `codigosDeNomina`): Contratos muestra el cargo
 *   buscando ese código en `nominabq.cargos`, `nominamn.cargos`… Sin él (modo prueba, que no consulta la base) va nulo.
 * - `item` es el número de la línea dentro de la oferta (1, 2, 3…): nunca se repite dentro de (sección, cargo), como exige el formulario.
 * - `valorTotal` debe ser `valorUnitario × cantidad` (con 1 peso de holgura por el redondeo a 5 decimales).
 * - Si los cargos no suman lo que equivale la mano de obra de la tarifa, avisa (puede faltar algún cargo): no bloquea.
 *
 * @param {object} datos contrato v1 ya validado
 * @param {{numOferta?: number | null, huella?: string, codigosNomina?: (number | null)[] | null}} contexto `numOferta` null = aún
 *   no reservado (modo prueba); `codigosNomina[i]` = código de nómina de la línea i
 * @returns {{errores: {campo: string, mensaje: string}[], advertencias: {campo: string, mensaje: string}[], filas: Record<string, unknown>[]}}
 */
export function planDeCargos(datos, { numOferta = null, huella = '', codigosNomina = null } = {}) {
  const errores = [];
  const advertencias = [];
  const cargos = datos.cargos ?? [];
  if (cargos.length === 0 || !datos.oferta) return { errores, advertencias, filas: [] };
  const { oferta, origen, contrato, tarifa } = datos;

  const filas = cargos.map((c, i) => {
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
      cargo: codigosNomina?.[i] ?? null,
      jornada: c.jornada,
      horassem: c.horasSemana,
      cantidad: c.cantidad,
      vlr_unitario: c.valorUnitario,
      vlr_total: c.valorTotal,
      codmun: '',
      salario: c.salario,
      dotm: c.grupoDotacionMasculina ?? '',
      dotf: c.grupoDotacionFemenina ?? '',
      riesgo: c.riesgo,
      tipocont: '',
      epp: c.grupoEpp ?? '',
      examen: c.grupoExamen ?? '',
      snextras: 0, snrecargos: 0, snfestivos: 0, snextrasf: 0,
      cnextras: 0, cnrecargos: 0, cnfestivos: 0, cnextrasf: 0,
      rnocturno: 0, ediurnas: 0, rfestivas: 0, enocturnas: 0, hfestivas: 0, efestivas: 0, enocturnasf: 0,
      nom_cargo: c.nombre,
      nivel_educacion: '',
      titulo_educacion: '',
      curso_formacion: '',
      experiencia: 0,
      cod_grupo_curso: c.grupoCurso ?? '',
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
      motivo: 'Se escriben el cargo, las personas, las horas, el salario, el riesgo, el horario y los valores. Los grupos de dotación, EPP, examen y curso van cuando la línea usa uno de cada tipo. La sección de nómina, los estudios y la experiencia, el tipo de contrato, los bonos y los recargos se completan en Contratos.',
    });
  }
  return lista;
}

/** Normalización mínima para contrastar razones sociales (mayúsculas, sin tildes, sin puntuación ni espacios repetidos). */
export const comparable = (texto) =>
  String(texto).normalize('NFD').replace(/\p{Diacritic}/gu, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
