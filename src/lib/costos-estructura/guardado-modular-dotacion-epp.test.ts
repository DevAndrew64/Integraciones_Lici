/**
 * Rediseño "EPP y Dotación" — modal vertical por cargo (acordeón, uno
 * abierto a la vez), SIN desplegable de tipo de dotación: el tipo se
 * infiere automáticamente de qué categorías (masculina/femenina) terminan
 * con elementos al pulsar "Almacenar" — nunca lo elige el usuario. Cada
 * categoría abre el catálogo externo YA EXISTENTE (showSelDot/showSelEpp)
 * filtrado a ella. No existe arnés de render de componentes para page.tsx
 * (~28.000 líneas, sin jsdom/RTL en este proyecto); mismo patrón de
 * verificación de TEXTO exacto del código fuente ya usado en
 * guardado-modular-page.test.ts/guardado-modular-turnantes.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PAGE_TSX = readFileSync(join(__dirname, '../../app/page.tsx'), 'utf-8');

function bloque(inicioMarcador: string, finMarcador: string, desde = 0): string {
  const inicio = PAGE_TSX.indexOf(inicioMarcador, desde);
  if (inicio === -1) throw new Error(`No se encontró el marcador de inicio: ${inicioMarcador}`);
  const fin = PAGE_TSX.indexOf(finMarcador, inicio);
  if (fin === -1) throw new Error(`No se encontró el marcador de fin: ${finMarcador}`);
  return PAGE_TSX.slice(inicio, fin);
}

describe('1) El modal es vertical por cargo (acordeón, no tabla horizontal)', () => {
  it('ModalDotacionEpp itera lineasManoObraDisponiblesOrdenadas (agrupada por cargo, ver orden-sujetos-costeo.ts) con tarjetaCargo (bloques verticales)', () => {
    const b = bloque('function ModalDotacionEpp()', '\n  function Sec(');
    expect(b).toContain(':lineasManoObraDisponiblesOrdenadas).map((linea,i)=>tarjetaCargo(linea,i))');
  });

  // Ajuste "DOTACIÓN/EPP SERÍA ALGO TIPO ASÍ" — los CARGOS siguen apilados
  // verticalmente (tarjetaCargo, acordeón, sin cambios); lo que cambió es
  // el contenido DENTRO de cada categoría (masculina/femenina/EPP): antes
  // eran tarjetas sueltas, ahora es una lista con encabezado (Grupo/Código/
  // Descripción/Cant/Frecuencia/Valor sin IVA/Valor con IVA/Valor mes/Últ.
  // compra + fila de Total) — nunca una tabla horizontal de TODOS los
  // cargos a la vez, que es lo que esta prueba original quería descartar.
  // Ajuste posterior "AHORA TAMBIÉN EN DOTACIÓN, EPP" (feedback en vivo) —
  // el <table> se cambió por filas flex (mismo patrón ya adoptado en
  // Exámenes/Cursos/Vacunas/Insumos: nunca envolvía bien la descripción
  // larga ni evitaba el scroll horizontal).
  it('la lista de ítems de cada categoría (bloqueCategoria) tiene su propio encabezado flex, uno por categoría — no una tabla única horizontal de todos los cargos', () => {
    const b = bloque('const bloqueCategoria=', '\n    const tarjetaCargo=');
    expect(b).toContain('>Grupo</div>');
    expect(b).toContain('>Vr sin iva</div>');
    expect(b).toContain('>Vr con iva</div>');
    expect(b).toContain('>Valor mes</div>');
    expect(b).toContain('>Últ. compra</div>');
    expect(b).toContain('TOTAL {titulo.toUpperCase()}');
  });

  it('cada tarjeta es un acordeón — abierto solo si cargoDotEppAbiertoId===linea.id', () => {
    const b = bloque('const tarjetaCargo=', '\n    return(\n      <div style={{position:\'fixed\'');
    expect(b).toContain('const abierto=ocultarEncabezado?true:cargoDotEppAbiertoId===linea.id;');
    expect(b).toContain('{abierto&&(');
  });
});

describe('2) No existe el desplegable de tipo de dotación', () => {
  it('ModalDotacionEpp no contiene ningún <select> ni las opciones Sin configurar/Masculina/Femenina/Ambas/No requiere', () => {
    const b = bloque('function ModalDotacionEpp()', '\n  function Sec(');
    expect(b).not.toContain('<select');
    expect(b).not.toContain('Sin configurar</option>');
    expect(b).not.toContain('No requiere dotación</option>');
  });
});

describe('3/4/5) Botones "Seleccionar masculina"/"Seleccionar femenina"/"Seleccionar EPP"', () => {
  it('la tarjeta invoca bloqueCategoria para las 3 categorías, cada una con su propio catálogo', () => {
    const b = bloque('const tarjetaCargo=', '\n    return(\n      <div style={{position:\'fixed\'');
    // Ajuste "NO APLICA POR CARGO Y POR SUB-CONCEPTO" agregó un 8º
    // argumento opcional (`noAplica`, independiente por bloque) a cada
    // llamada — el resto de los parámetros (catálogo/manual/renombrar) no
    // cambió.
    expect(b).toContain("bloqueCategoria('Dotación masculina',grupoMasc,linea.id,'masculina',()=>abrirCatalogoDotParaLinea(linea,'M'),()=>abrirModalManualDot(linea.id,'masculina'),(codigoAnterior,codigoNuevo)=>renombrarGrupoDot(linea.id,'masculina',codigoAnterior,codigoNuevo),'masculina',{activo:dotacionMasculinaNoAplicaLineas.includes(linea.id),onToggle:()=>toggleNoAplicaLinea(setDotacionMasculinaNoAplicaLineas,linea.id),nombre:'Dotación masculina'})");
    expect(b).toContain("bloqueCategoria('Dotación femenina',grupoFem,linea.id,'femenina',()=>abrirCatalogoDotParaLinea(linea,'F'),()=>abrirModalManualDot(linea.id,'femenina'),(codigoAnterior,codigoNuevo)=>renombrarGrupoDot(linea.id,'femenina',codigoAnterior,codigoNuevo),'femenina',{activo:dotacionFemeninaNoAplicaLineas.includes(linea.id),onToggle:()=>toggleNoAplicaLinea(setDotacionFemeninaNoAplicaLineas,linea.id),nombre:'Dotación femenina'})");
    // Ajuste "TRAER EPP POR CÓDIGO DE GRUPO": EPP pasa `categoriaGrupo='epp'`
    // (7º arg `onEditarGrupo` sigue en undefined: la columna Grupo es solo lectura).
    expect(b).toContain("bloqueCategoria('EPP',grupoEpp,linea.id,'EPP',()=>abrirCatalogoEppParaLinea(linea),()=>abrirModalManualDot(linea.id,'EPP'),undefined,'epp',{activo:eppNoAplicaLineas.includes(linea.id),onToggle:()=>toggleNoAplicaLinea(setEppNoAplicaLineas,linea.id),nombre:'EPP'})");
  });

  it('el botón dice "Seleccionar X" sin elementos y "Agregar otro X" con elementos — nunca un menú combinado', () => {
    const b = bloque('const bloqueCategoria=', '\n    const tarjetaCargo=');
    expect(b).toContain('{tieneItems?`Agregar otro ${etiqueta}`:`Seleccionar ${etiqueta}`}');
  });
});

describe('6/7/8) Cada selector filtra únicamente su categoría', () => {
  it('abrirCatalogoDotParaLinea fija selDotSexo (M o F) antes de abrir showSelDot — nunca mezcla con EPP', () => {
    const b = bloque('const abrirCatalogoDotParaLinea=', '\n  const abrirCatalogoEppParaLinea=');
    expect(b).toContain('setSelDotSexo(sexo);');
    expect(b).toContain('setShowSelDot(true);');
    expect(b).not.toContain('setShowSelEpp');
  });

  it('abrirCatalogoEppParaLinea abre exclusivamente showSelEpp, nunca showSelDot', () => {
    const b = bloque('const abrirCatalogoEppParaLinea=', '\n  };', PAGE_TSX.indexOf('const abrirCatalogoEppParaLinea='));
    expect(b).toContain('setShowSelEpp(true);');
    expect(b).not.toContain('setShowSelDot');
  });

  it('agregarSeleccionadosDot exige selDotSexo antes de agregar — el catálogo nunca mezcla productos de ambos sexos en un mismo grupo', () => {
    const b = bloque('const agregarSeleccionadosDot=', '\n  const [duplicandoMujer');
    expect(b).toContain("if(!selDotSexo){setSelDotErr(");
  });
});

describe('9/10/11/12) Inferencia automática del tipo (§2, nunca elegido manualmente)', () => {
  it('inferirTipoDotacionDesdeGrupos: solo masculina→MASCULINA, solo femenina→FEMENINA, ambas→AMBAS, ninguna→undefined', () => {
    const b = bloque('const inferirTipoDotacionDesdeGrupos=', '\n  // Resumen de configuración');
    expect(b).toContain("if(masc&&fem)return 'AMBAS';");
    expect(b).toContain("if(masc)return 'MASCULINA';");
    expect(b).toContain("if(fem)return 'FEMENINA';");
    expect(b).toContain('return undefined;');
  });

  it('12) ninguna combinación de masculina/femenina queda "sin configurar" cuando alguna tiene ítems (12 cubierto por los 3 casos anteriores; solo el caso "ninguna" resuelve undefined)', () => {
    const b = bloque('const inferirTipoDotacionDesdeGrupos=', '\n  // Resumen de configuración');
    // Las 3 combinaciones con al menos una categoría activa producen un tipo definido:
    expect(b).not.toMatch(/if\(masc\|\|fem\)return undefined/);
  });

  it('almacenarConfiguracionDotacionEpp recalcula tipoDotacionPorSujeto para CADA sujeto a partir de sus grupos, nunca de una selección manual', () => {
    const b = bloque('const almacenarConfiguracionDotacionEpp=', '\n  };\n\n  /** Ajuste "CATÁLOGO DE DOTACIÓN');
    expect(b).toContain('for(const linea of lineasManoObraDisponibles){');
    expect(b).toContain('const inferido=inferirTipoDotacionDesdeGrupos(');
    expect(b).toContain('if(inferido===undefined)delete siguiente[key];else siguiente[key]=inferido;');
  });
});

describe('13) EPP no se duplica (un solo grupo EPP por sujeto)', () => {
  it('la tarjeta busca EXACTAMENTE un grupo EPP (find, no filter) y lo pasa una sola vez a bloqueCategoria', () => {
    const b = bloque('const tarjetaCargo=', '\n    return(\n      <div style={{position:\'fixed\'');
    expect(b).toContain("gruposSujeto.find(g=>resolverCategoriaDotGroup(g)==='EPP')");
    const ocurrenciasBloqueEpp = (b.match(/bloqueCategoria\('EPP'/g) ?? []).length;
    expect(ocurrenciasBloqueEpp).toBe(1);
  });
});

describe('14/15/16) Cargo de solo lectura; cantidad/frecuencia editables; valor/código de solo lectura', () => {
  it('14) el encabezado muestra "N. Cargo" (nunca un <input>); la segunda línea nunca repite el nombre del cargo ni "Línea N" — usa el horario real de Mano de Obra (formatearResumenSujetoDotEpp, que reutiliza formatearResumenHorarioMO)', () => {
    const b = bloque('const tarjetaCargo=', '\n    return(\n      <div style={{position:\'fixed\'');
    expect(b).toContain('{indice+1}. {linea.nombre}');
    expect(b).toContain('{resumenCompacto}');
    expect(b).toContain('formatearResumenSujetoDotEpp(linea.cantidadTrabajadores,distribuciones)');
    expect(b).not.toContain('descripcionLineaManoObra(linea)');
  });

  it('el estado ya no ocupa espacio visible en la cabecera del modal (Ajuste "CABECERA DEL CARGO")', () => {
    const b = bloque('const tarjetaCargo=', '\n    return(\n      <div style={{position:\'fixed\'');
    expect(b).not.toContain('resumenConfigSujetoDotEpp(key)');
  });

  it('varios horarios se listan legiblemente ("Horario 1:"/"Horario 2:"), nunca concatenados en una sola línea', () => {
    const b = bloque('const tarjetaCargo=', '\n    return(\n      <div style={{position:\'fixed\'');
    expect(b).toContain('<b style={{color:\'#6b7280\'}}>Horario {i+1}:</b>');
  });

  it('pluraliza correctamente trabajador/trabajadores (delegado a formatearResumenSujetoDotEpp, ver resumen-sujeto-dotacion.test.ts)', () => {
    const b = bloque('const tarjetaCargo=', '\n    return(\n      <div style={{position:\'fixed\'');
    expect(b).toContain('formatearResumenSujetoDotEpp(linea.cantidadTrabajadores,distribuciones)');
  });

  it('Corrección "HORARIO FALTANTE" — nunca concatena resumenCompacto a mano; el helper único ya evita el separador suelto y el import viene de resumen-sujeto-dotacion', () => {
    expect(PAGE_TSX).toContain("import { formatearResumenSujetoDotEpp } from '@/lib/costos-mano-obra/horarios/resumen-sujeto-dotacion';");
    const b = bloque('const tarjetaCargo=', '\n    return(\n      <div style={{position:\'fixed\'');
    expect(b).not.toContain('nTrabTexto');
  });

  it('10/11) la distribución se lee en vivo de linea.distribucionesHorario (reactivo a MO) y la clave del sujeto sigue basada en lineaManoObraId — la asociación de Dotación/EPP no cambia', () => {
    const b = bloque('const tarjetaCargo=', '\n    return(\n      <div style={{position:\'fixed\'');
    expect(b).toContain('const distribuciones=linea.distribucionesHorario??[];');
    expect(b).toContain('const key=construirSujetoDotacionKey(linea.origen,linea.id);');
    expect(b).toContain('gruposSujeto.find(g=>resolverCategoriaDotGroup(g)===');
    expect(b).toContain('g.lineaManoObraId===linea.id');
  });

  it('15) cantidad y frecuencia son <input> editables (updCargoRow)', () => {
    const b = bloque('const filaSoloLectura=', '\n    // Mini-tarjeta de UNA categoría');
    expect(b).toContain("updCargoRow(dotGroups.find(g=>g.lineaManoObraId===lineaId&&g.rows.some(x=>x.id===r.id))!.id,r.id,'cant',e.target.value)");
    expect(b).toContain("updCargoRow(dotGroups.find(g=>g.lineaManoObraId===lineaId&&g.rows.some(x=>x.id===r.id))!.id,r.id,'frec',e.target.value)");
  });

  // Ajuste "DOTACIÓN/EPP SERÍA ALGO TIPO ASÍ" — descripción/valor mensual
  // ya NO están en <span> (esa fila se convirtió en <tr>/<td> de tabla),
  // pero la garantía de fondo sigue intacta: siguen siendo SOLO LECTURA
  // (nunca <input> de texto/valor), únicamente Cant./Frec. son editables.
  it('16) descripción/valor mensual son de solo lectura (nunca <input> editable de texto/valor)', () => {
    const b = bloque('const filaSoloLectura=', '\n    // Mini-tarjeta de UNA categoría');
    expect(b).toContain('{cop(valorMesRow(r))}');
    expect(b).toContain('{r.desc||\'—\'}');
    expect(b).not.toMatch(/type="text"[^>]*value=\{r\.desc/);
    expect(b).not.toMatch(/type="number"[^>]*value=\{r\.vUnit/);
  });
});

describe('17) Permite varios elementos por categoría', () => {
  it('bloqueCategoria renderiza TODAS las filas del grupo (map), nunca solo la primera', () => {
    const b = bloque('const bloqueCategoria=', '\n    const tarjetaCargo=');
    expect(b).toContain('grupo!.rows.map(r=>filaSoloLectura(lineaId,r,mostrarGrupo,onEditarGrupo))');
  });
});

describe('18) El modal conserva los productos al cambiar de cargo (dotGroups es global, no por-tarjeta)', () => {
  it('cada tarjeta lee de dotGroups (estado global de la pestaña), nunca de un estado local por cargo que se resetee al colapsar/expandir', () => {
    const b = bloque('const tarjetaCargo=', '\n    return(\n      <div style={{position:\'fixed\'');
    expect(b).toContain('dotGroups.filter(g=>resolverSujetoKeyDeGrupo(g)===key||g.lineaManoObraId===linea.id)');
  });
});

describe('19) Almacenar no ejecuta fetch', () => {
  it('almacenarConfiguracionDotacionEpp nunca llama fetch — solo recalcula tipoDotacionPorSujeto y cierra el modal', () => {
    const b = bloque('const almacenarConfiguracionDotacionEpp=', '\n  };\n\n  /** Ajuste "CATÁLOGO DE DOTACIÓN');
    expect(b).not.toContain('fetch(');
    expect(b).toContain('setModalDotEppAbierto(false);');
  });

  it('el dirty de dotacionEpp se marca automáticamente por el useEffect existente, nunca manualmente dentro de almacenarConfiguracionDotacionEpp', () => {
    const b = bloque('const almacenarConfiguracionDotacionEpp=', '\n  };\n\n  /** Ajuste "CATÁLOGO DE DOTACIÓN');
    expect(b).not.toContain('setHayCambiosSinGuardarDotacionEpp');
  });
});

describe('20) La ficha exterior es solo de lectura', () => {
  it('el bloque de ficha exterior no contiene ningún <input>/<select> — es de solo lectura', () => {
    const b = bloque('const totalGrupoDotEpp=(g:DotGroup)=>g.rows.reduce', 'Guardado modular por etapas — pie fijo de EPP y');
    expect(b).not.toContain('<input');
    expect(b).not.toContain('<select');
  });

  it('"Gestionar dotación y EPP" abre el mismo modal (sin lápiz por tarjeta — un único punto de entrada, mismo patrón de Insumos)', () => {
    const b = bloque('const totalGrupoDotEpp=(g:DotGroup)=>g.rows.reduce', 'Guardado modular por etapas — pie fijo de EPP y');
    expect(b).toContain('>Gestionar dotación y EPP</button>');
    expect(b).not.toContain('title="Editar dotación y EPP"');
  });

  it('la ficha exterior nunca tiene botones "Agregar ítem" — toda la creación pasa por el modal', () => {
    const b = bloque('const totalGrupoDotEpp=(g:DotGroup)=>g.rows.reduce', 'Guardado modular por etapas — pie fijo de EPP y');
    expect(b).not.toContain('>Agregar ítem<');
    expect(b).not.toContain('addDotRow');
    expect(b).not.toContain('addEppRow');
  });

  it('TODOS los sujetos de Mano de Obra se muestran desde el inicio en la ficha exterior (feedback "deben salir al inicio todos los cargos... para gestionar de forma individual"), no solo los que ya tienen configuración real', () => {
    const b = bloque('const seccion=(origen:OrigenSujetoDotacion', '\n                const hayAlgunSujetoConfigurado=');
    expect(b).not.toContain('.filter(l=>resumenConfigSujetoDotEpp(construirSujetoDotacionKey(l.origen,l.id)).configuracionReal)');
    expect(b).toContain('lineasManoObraDisponiblesOrdenadas.filter(l=>l.origen===origen);');
  });
});

describe('Botón único de creación', () => {
  it('existe exactamente un botón principal "Agregar dotación y EPP" que abre el modal (sin argumento, expande el primer cargo)', () => {
    expect(PAGE_TSX).toContain('Agregar dotación y EPP');
    expect(PAGE_TSX).toContain('onClick={()=>abrirModalDotacionEpp()}');
  });

  it('no existe el viejo menú "Agregar dotación / Agregar EPP" separado por cargo', () => {
    expect(PAGE_TSX).not.toContain('setEppMenuAgregarAbierto');
  });
});

describe('Modal con ancho razonable y scroll interno (§8)', () => {
  it('el modal tiene ancho fijo ~900px (dentro del rango 900-1000 pedido), cuerpo con overflowY auto, encabezado y pie fijos (mismo lenguaje visual que ModalCargo)', () => {
    const b = bloque('function ModalDotacionEpp()', '\n  function Sec(');
    expect(b).toContain('width:900');
    expect(b).toContain("overflowY:'auto' as const,overflowX:'hidden' as const,flex:'1 1 auto',minHeight:0");
    // Encabezado y pie con flexShrink:0 dentro de un contenedor flex-column
    // con maxHeight — mismo patrón de "fijos" que ModalCargo (sticky/flex),
    // sin depender de las clases genéricas modal-header/modal-actions.
    expect(b).toContain("flexDirection:'column' as const,boxShadow:'0 12px 40px rgba(15,23,42,.22)'");
    expect(b).toContain("borderBottom:'1px solid #e2e8f0',display:'flex',justifyContent:'space-between',alignItems:'center',background:'white',flexShrink:0");
    expect(b).toContain("borderTop:'1px solid #e2e8f0',display:'flex',justifyContent:'flex-end',gap:10,background:'white',flexShrink:0");
  });
});

describe('Abrir por defecto solo el primer cargo o el editado (§9)', () => {
  it('abrirModalDotacionEpp sin argumento expande el primer cargo del listado', () => {
    const b = bloque('const abrirModalDotacionEpp=', '\n  const cancelarModalDotacionEpp=');
    // Ajuste "SERVICIOS NO CONTINUOS — REUTILIZACIÓN REAL DE CATÁLOGOS" —
    // `listaCargos` es `lineasManoObraDisponiblesOrdenadas` (comportamiento
    // histórico intacto) cuando el modal NO está destinado a un servicio,
    // o los cargos del servicio cuando sí lo está.
    expect(b).toContain('const listaCargos=servicioId!=null?lineasManoObraDisponiblesEfectivas:lineasManoObraDisponiblesOrdenadas;');
    expect(b).toContain('setCargoDotEppAbiertoId(linea?linea.id:(listaCargos[0]?.id??null));');
  });
});

describe('Estado automático de 3 valores (§10) — nunca el viejo desplegable', () => {
  it('SIN_CONFIGURAR: sin dotación y sin EPP', () => {
    const b = bloque('const resumenConfigSujetoDotEpp=React.useCallback', '\n  },[dotGroups,resolverSujetoKeyDeGrupo]);');
    expect(b).toContain("(!tieneDot&&!tieneEpp)?'SIN_CONFIGURAR'");
  });
  it('CONFIGURACION_PARCIAL: dotación sin EPP, o EPP sin dotación', () => {
    const b = bloque('const resumenConfigSujetoDotEpp=React.useCallback', '\n  },[dotGroups,resolverSujetoKeyDeGrupo]);');
    expect(b).toContain("'CONFIGURACION_PARCIAL'");
  });
  it('CONFIGURADO: tiene dotación Y EPP', () => {
    const b = bloque('const resumenConfigSujetoDotEpp=React.useCallback', '\n  },[dotGroups,resolverSujetoKeyDeGrupo]);');
    expect(b).toContain("(tieneDot&&tieneEpp)?'CONFIGURADO'");
  });
});

describe('Guardado modular independiente (dotacionEpp)', () => {
  it('el botón "Guardar EPP y Dotación" llama guardarAvanceDotacionEpp, que usa ejecutarGuardadoModuloCosteo con la clave dotacionEpp', () => {
    expect(PAGE_TSX).toContain('onClick={guardarAvanceDotacionEpp}');
    const b = bloque('async function guardarModuloDotacionEpp', 'async function guardarAvanceDotacionEpp');
    expect(b).toContain("ejecutarGuardadoModuloCosteo('dotacionEpp',estadoDestino,datosEntrada,dotacionEppUltimaActualizacion)");
  });

  it('guardarModuloDotacionEpp nunca toca el baseline/dirty de Mano de Obra ni Turnantes', () => {
    const b = bloque('async function guardarModuloDotacionEpp', 'async function guardarAvanceDotacionEpp');
    expect(b).not.toContain('manoObraBaseline');
    expect(b).not.toContain('turnantesBaseline');
    expect(b).not.toContain('setHayCambiosSinGuardarManoObra');
    expect(b).not.toContain('setHayCambiosSinGuardarTurnantes');
  });

  it('el payload persistible es {tipoDotacionPorSujeto, dotGroups} + las 3 decisiones "No aplica" por cargo (Ajuste "NO APLICA POR CARGO Y POR SUB-CONCEPTO")', () => {
    const b = bloque('function construirDatosEntradaDotacionEpp()', '\n  }');
    expect(b).toContain('return { tipoDotacionPorSujeto, dotGroups, dotacionMasculinaNoAplicaLineas, dotacionFemeninaNoAplicaLineas, eppNoAplicaLineas };');
  });

  it('hidratación: aplicarDatosGuardados resuelve el módulo dotacionEpp con obtenerModulo, con respaldo histórico a d.dotGroups, y restaura las 3 decisiones "No aplica" por cargo', () => {
    const inicio = PAGE_TSX.indexOf('function aplicarDatosGuardados');
    const finIdx = PAGE_TSX.indexOf('const dotGroupsCrudo=', inicio) + 500;
    const b = PAGE_TSX.slice(inicio, finIdx);
    expect(b).toContain("obtenerModulo<{tipoDotacionPorSujeto?:TipoDotacionPorSujeto;dotGroups?:unknown;dotacionMasculinaNoAplicaLineas?:number[];dotacionFemeninaNoAplicaLineas?:number[];eppNoAplicaLineas?:number[]}>(dCrudo,'dotacionEpp')");
    expect(b).toContain('moduloDotacionEppResuelto?.datos?.dotGroups');
    expect(b).toContain(':d.dotGroups;');
    expect(b).toContain('setDotacionMasculinaNoAplicaLineas(');
    expect(b).toContain('setDotacionFemeninaNoAplicaLineas(');
    expect(b).toContain('setEppNoAplicaLineas(');
  });
});

describe('Producto sin valor vigente no puede almacenarse', () => {
  it('agregarSeleccionadosDot/Epp omiten productos con vUnit<=0, con aviso', () => {
    const bDot = bloque('const agregarSeleccionadosDot=', '\n  const [duplicandoMujer');
    expect(bDot).toContain('if(vUnit<=0){omitidosSinValor++;return;}');
    const bEpp = bloque('const agregarSeleccionadosEpp=', '\n    const IVA_DOTACION');
    expect(bEpp).toContain('if(vUnit<=0){omitidosSinValor++;return;}');
  });
});

describe('Retiro del aprovisionamiento automático', () => {
  it('ya no existe el useEffect que crea Hombre/Mujer/EPP vacíos automáticamente por línea', () => {
    expect(PAGE_TSX).not.toContain("nombre:'Hombre',rows:[],cargoCodigo:l.codigo,lineaManoObraId:l.id");
  });
});
