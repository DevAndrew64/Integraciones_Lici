/**
 * Verificación de fuente — guardado modular por etapas, Mano de Obra
 * (implementación completa, §1-§13). No existe arnés de render de
 * componentes para page.tsx (~25.000 líneas); mismo patrón ya usado en
 * texto-ui-mano-obra*.ts: se verifica el TEXTO exacto del código fuente.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PAGE_TSX = readFileSync(join(__dirname, '../../app/page.tsx'), 'utf-8');

describe('Botones del pie de módulo (§1, §13)', () => {
  it('3) existe el botón secundario "Guardar Mano de Obra" (Ajuste "AJUSTAR UBICACIÓN DE ACCIONES" — movido al pie, texto homologado con los demás módulos)', () => {
    expect(PAGE_TSX).toContain("{guardandoAvanceMO?'Guardando…':'Guardar Mano de Obra'}");
    expect(PAGE_TSX).toContain('onClick={guardarAvanceManoObra}');
  });

  it('Ajuste "quitar esto, que solo sea un solo guardado" — ya no existe un botón separado "Finalizar Mano de Obra": un único guardado corre la validación de finalización', () => {
    expect(PAGE_TSX).not.toContain("'Finalizar Mano de Obra'");
    expect(PAGE_TSX).not.toContain('function finalizarManoObra()');
  });

  it('el pie de módulo de Mano de Obra nunca usa el botón genérico "Guardar costos" en su lugar', () => {
    const inicio = PAGE_TSX.indexOf('Guardado modular por etapas — pie fijo del módulo');
    const fin = PAGE_TSX.indexOf("{/* ══ TURNANTES", inicio);
    const bloque = PAGE_TSX.slice(inicio, fin);
    expect(bloque).not.toContain("'Guardar costos'");
  });

  it('muestra estado, última fecha de guardado y usuario', () => {
    expect(PAGE_TSX).toContain('Estado: {hayCambiosSinGuardarManoObra');
    expect(PAGE_TSX).toContain('Último guardado:');
    expect(PAGE_TSX).toContain('manoObraActualizadoPor');
  });
});

describe('Estados del módulo (§1)', () => {
  it('5) el tipo EstadoModulo define exactamente NO_INICIADO/EN_PROGRESO/COMPLETADO (Ajuste "NO_APLICA EN 4 MÓDULOS" — ahora derivado de ESTADOS_MODULO_RESULTADO excluyendo NO_APLICA, nunca una segunda lista de estados)', () => {
    const guardadoModular = readFileSync(join(__dirname, 'guardado-modular.ts'), 'utf-8');
    expect(guardadoModular).toContain("export const ESTADOS_MODULO_RESULTADO = ['NO_INICIADO', 'EN_PROGRESO', 'COMPLETADO', 'NO_APLICA'] as const;");
    expect(guardadoModular).toContain("export type EstadoModulo = Exclude<EstadoModuloResultado, 'NO_APLICA'>;");
  });

  it('Ajuste "un solo guardado" — guardarAvanceManoObra valida y guarda COMPLETADO si pasa, o EN_PROGRESO si no (nunca se pierde el avance)', () => {
    const inicio = PAGE_TSX.indexOf('async function guardarAvanceManoObra()');
    const fin = PAGE_TSX.indexOf('\n  }', inicio);
    const bloque = PAGE_TSX.slice(inicio, fin);
    expect(bloque).toContain('validarManoObraParaFinalizar(');
    expect(bloque).toContain("guardarModuloManoObra(validacion.valido?'COMPLETADO':'EN_PROGRESO')");
  });
});

describe('Comportamiento A — Guardar avance permite datos incompletos (§1, prueba #4)', () => {
  it('guardarAvanceManoObra no cambia de pestaña (nunca llama setTab)', () => {
    const inicio = PAGE_TSX.indexOf('async function guardarAvanceManoObra()');
    const fin = PAGE_TSX.indexOf('\n  }', inicio);
    const bloque = PAGE_TSX.slice(inicio, fin);
    expect(bloque).not.toContain('setTab(');
  });

  it('muestra el mensaje de confirmación exacto pedido', () => {
    expect(PAGE_TSX).toContain("'Avance de Mano de Obra guardado correctamente.'");
    // Cierre correctivo §2 — "completada" nunca implica finalizar toda la
    // Estructura de Costos.
    expect(PAGE_TSX).toContain("'Mano de Obra completada.'");
  });
});

describe('Comportamiento B — Finalizar bloquea datos incompletos con resumen comercial (§6)', () => {
  it('usa el encabezado comercial exacto, sin códigos internos', () => {
    const validacion = readFileSync(join(__dirname, 'validacion-mano-obra.ts'), 'utf-8');
    expect(validacion).toContain("'No es posible finalizar Mano de Obra. Revisa los siguientes puntos:'");
  });

  it('page.tsx renderiza la lista de problemas devuelta por la validación', () => {
    expect(PAGE_TSX).toContain('manoObraErroresFinalizar.map((p,i)=>(<li key={i}>{p}</li>))');
  });
});

describe('Merge parcial seguro (§4) — wiring de fusionarModulo/PUT', () => {
  // Corrección "INDEPENDENCIA REAL DE GUARDADO POR PESTAÑA" — la lógica de
  // red/concurrencia (PUT-o-POST, códigos de estado) se extrajo a
  // ejecutarGuardadoModuloCosteo (núcleo genérico compartido por Mano de
  // Obra Y Turnantes), en vez de duplicarla en cada wrapper de módulo.
  it('el registro existente se actualiza vía PUT, nunca crea uno nuevo (§5)', () => {
    const inicio = PAGE_TSX.indexOf('async function ejecutarGuardadoModuloCosteo');
    const fin = PAGE_TSX.indexOf('\n  }\n\n  /** Unico punto de persistencia', inicio);
    const bloque = PAGE_TSX.slice(inicio, fin);
    expect(bloque).toContain('if(costoEstructuraIdActual!=null){');
    expect(bloque).toContain("method:'PUT'");
    expect(bloque).toContain("method:'POST'");
  });

  it('el PUT envía versionConocida para el control de concurrencia (§7) — guardarModuloManoObra pasa manoObraUltimaActualizacion al núcleo genérico', () => {
    const inicio = PAGE_TSX.indexOf('async function guardarModuloManoObra');
    const fin = PAGE_TSX.indexOf('\n  }\n\n  async function guardarAvanceManoObra', inicio);
    const bloque = PAGE_TSX.slice(inicio, fin);
    expect(bloque).toContain("ejecutarGuardadoModuloCosteo('manoObra',estadoDestino,datosModulo,manoObraUltimaActualizacion");
    expect(PAGE_TSX).toContain('body:JSON.stringify({modulo:clave,estado:estadoDestino,datos,versionConocida,totales})');
  });

  it('el conflicto 409 se muestra al usuario sin sobrescribir', () => {
    const inicio = PAGE_TSX.indexOf('async function ejecutarGuardadoModuloCosteo');
    const fin = PAGE_TSX.indexOf('\n  }\n\n  /** Unico punto de persistencia', inicio);
    const bloque = PAGE_TSX.slice(inicio, fin);
    expect(bloque).toContain("res.status===409");
    expect(bloque).toContain('return{ok:false');
  });
});

describe('Creación/reutilización del registro (§5, pruebas #1/#2/#3)', () => {
  it('1/3) sin costoEstructuraIdActual, crea vía POST (fusionarModulo genérico por clave de módulo)', () => {
    expect(PAGE_TSX).toContain('const datosIniciales=fusionarModulo(undefined,clave,nuevoModulo);');
  });
  it('2) verDetallesCosteo fija costoEstructuraIdActual para reutilizar el mismo registro', () => {
    const inicio = PAGE_TSX.indexOf('async function verDetallesCosteo');
    const fin = PAGE_TSX.indexOf('\n  }', inicio);
    const bloque = PAGE_TSX.slice(inicio, fin);
    expect(bloque).toContain('setCostoEstructuraIdActual(regId);');
  });
  it('un guardado exitoso vía POST captura el ID devuelto para futuros guardados', () => {
    expect(PAGE_TSX).toContain('setCostoEstructuraIdActual(d.registro.id);');
  });
});

describe('Restauración (§7) — resolverModuloManoObraParaRestaurar', () => {
  it('14/17/18) aplicarDatosGuardados resuelve el módulo antes de leer campos planos', () => {
    const inicio = PAGE_TSX.indexOf('function aplicarDatosGuardados');
    const fin = PAGE_TSX.indexOf('setCargo(d.cargo', inicio);
    const bloque = PAGE_TSX.slice(inicio, fin);
    expect(bloque).toContain('resolverModuloManoObraParaRestaurar(dCrudo)');
  });

  it('12/13) restaura ultimaActualizacion y actualizadoPor solo cuando provienen de un guardado real', () => {
    const inicio = PAGE_TSX.indexOf('function aplicarDatosGuardados');
    const fin = PAGE_TSX.indexOf('setCargo(d.cargo', inicio);
    const bloque = PAGE_TSX.slice(inicio, fin);
    expect(bloque).toContain('if(moduloResuelto?.ultimaActualizacion){');
    expect(bloque).toContain('setManoObraUltimaActualizacion(moduloResuelto.ultimaActualizacion);');
    expect(bloque).toContain('setManoObraActualizadoPor(moduloResuelto.actualizadoPor);');
  });

  it('16) restaura las bonificaciones manuales y el bono prestacional (hueco cerrado)', () => {
    expect(PAGE_TSX).toContain('setConBonoAlimentacion(Boolean(d.conBonoAlimentacion));');
    expect(PAGE_TSX).toContain('setConBonoPrestacional(Boolean(d.conBonoPrestacional));');
  });

  it('15) lineasExtra/cargosTurnantes se restauran con sus IDs (setLineasExtra/setCargosTurnantes ya existentes, sin tocar)', () => {
    expect(PAGE_TSX).toContain('setLineasExtra(lineasD)');
    expect(PAGE_TSX).toContain('setCargosTurnantes(turnantesD)');
  });
});

describe('Cambios sin guardar (§11, pruebas #19/#20/#21)', () => {
  it('19) hayCambiosSinGuardarManoObra se activa cuando cambian los campos relevantes (comparando solo datosEntrada, §4)', () => {
    const inicio = PAGE_TSX.indexOf('const manoObraBaseline=useRef');
    const fin = PAGE_TSX.indexOf('/** Único punto de persistencia', inicio);
    const bloque = PAGE_TSX.slice(inicio, fin);
    // Corrección "STEPPER: MANO DE OBRA COMPLETADA APARECE PENDIENTE AL
    // NAVEGAR" — la comparación sigue siendo manoObraBaseline!==actual
    // (mismo criterio, §4), pero ahora se salta mientras seguimos dentro
    // de la ventana de restauración (capturarBaselinesTrasRestaurarRef),
    // adoptando el valor recién asentado como nuevo baseline en vez de
    // marcar sucio — ver comentario del propio bloque.
    expect(bloque).toContain('const actual=JSON.stringify(construirDatosEntradaManoObra());');
    expect(bloque).toContain('if(capturarBaselinesTrasRestaurarRef.current){');
    expect(bloque).toContain('manoObraBaseline.current=actual;');
    expect(bloque).toContain('setHayCambiosSinGuardarManoObra(manoObraBaseline.current!==actual);');
  });

  it('20) guardar (avance o finalizar) desactiva hayCambiosSinGuardarManoObra', () => {
    const inicio = PAGE_TSX.indexOf('async function guardarModuloManoObra');
    const fin = PAGE_TSX.indexOf('\n  }\n\n  async function guardarAvanceManoObra', inicio);
    const bloque = PAGE_TSX.slice(inicio, fin);
    expect(bloque).toContain('setHayCambiosSinGuardarManoObra(false);');
  });

  it('21) cambiar de pestaña o volver con cambios sin guardar pide confirmación vía el modal propio (cierre correctivo §1 — nunca window.confirm)', () => {
    expect(PAGE_TSX).toContain('function intentarNavegarFueraDeManoObra(accion:()=>void)');
    expect(PAGE_TSX).toContain('setMostrarModalSalidaManoObra(true);');
    expect(PAGE_TSX).not.toContain('function confirmarSalidaManoObraSiHayCambios()');
  });

  it('1) el flujo de navegación interna de Mano de Obra no usa window.confirm/alert/prompt', () => {
    const inicio = PAGE_TSX.indexOf('function intentarNavegarFueraDeManoObra');
    const fin = PAGE_TSX.indexOf('async function exportarCostos', inicio);
    const bloque = PAGE_TSX.slice(inicio, fin);
    expect(bloque).not.toContain('window.confirm(');
    expect(bloque).not.toContain('window.alert(');
    expect(bloque).not.toContain('window.prompt(');
  });

  it('2) el modal propio ModalCambiosSinGuardarManoObra existe y lista dinámicamente los módulos con cambios sin guardar', () => {
    // Corrección "INDEPENDENCIA REAL DE GUARDADO POR PESTAÑA" — el mensaje
    // ya no está hardcodeado a "Mano de Obra": recibe `modulosConCambios`
    // y arma el texto en base a esa lista (Mano de Obra y/o Turnantes).
    expect(PAGE_TSX).toContain('function ModalCambiosSinGuardarManoObra(');
    expect(PAGE_TSX).toContain('modulosConCambios:string[]');
    expect(PAGE_TSX).toContain('Cambios sin guardar');
    expect(PAGE_TSX).toContain('Tienes cambios de ${modulosConCambios[0]');
    expect(PAGE_TSX).toContain('Continuar editando');
    expect(PAGE_TSX).toContain('Salir sin guardar');
  });

  it('3) "Continuar editando" cancela la navegación (nunca ejecuta la acción pendiente)', () => {
    const inicio = PAGE_TSX.indexOf('function continuarEditandoManoObra()');
    const fin = PAGE_TSX.indexOf('\n  }', inicio);
    const bloque = PAGE_TSX.slice(inicio, fin);
    expect(bloque).toContain('accionSalidaManoObraPendiente.current=null;');
    expect(bloque).not.toContain('accion()');
  });

  it('4) "Salir sin guardar" ejecuta la navegación que quedó pendiente', () => {
    const inicio = PAGE_TSX.indexOf('function confirmarSalirSinGuardarManoObra()');
    const fin = PAGE_TSX.indexOf('\n  }', inicio);
    const bloque = PAGE_TSX.slice(inicio, fin);
    expect(bloque).toContain('if(accion)accion();');
  });

  it('el guard de salida (intentarNavegarFueraDeManoObra) se aplica SOLO al botón "Volver", nunca al cambio de pestaña interna', () => {
    // Corrección "INDEPENDENCIA REAL DE GUARDADO POR PESTAÑA" — cambiar de
    // pestaña interna ya no pasa por el gate (cada módulo conserva su
    // propio borrador en memoria); solo la salida real de Estructura de
    // Costos ("Volver") sigue pidiendo confirmación.
    expect(PAGE_TSX).toContain('onClick={()=>setTab(key)}');
    expect(PAGE_TSX).not.toContain("intentarNavegarFueraDeManoObra(()=>setTab(key))");
    expect(PAGE_TSX).toContain('onClick={()=>intentarNavegarFueraDeManoObra(()=>{setSolicitudProceso(null);setModalProcesoAbierto(true);})}');
  });

  it('el gate de salida considera todos los módulos ya conectados al guardado independiente (Mano de Obra y Turnantes), no solo Mano de Obra', () => {
    const inicio = PAGE_TSX.indexOf('const modulosConCambiosSinGuardar:string[]=[');
    const fin = PAGE_TSX.indexOf('];', inicio);
    const bloque = PAGE_TSX.slice(inicio, fin);
    expect(bloque).toContain("hayCambiosSinGuardarManoObra?['Mano de Obra']:[]");
    expect(bloque).toContain("hayCambiosSinGuardarTurnantes?['Turnantes']:[]");
  });
});

describe('Estado visual en las pestañas (§8, prueba #22)', () => {
  it('22) el indicador ✓/•/— por pestaña se retiró (feedback en vivo "quitar esto que no necesito eso ya") — la pestaña solo muestra la etiqueta', () => {
    expect(PAGE_TSX).not.toContain("estadoModuloManoObra==='COMPLETADO'?'✓':estadoModuloManoObra==='EN_PROGRESO'?'•':'—'");
  });
});

describe('Resultado general (cierre correctivo §2, pruebas #5/#6)', () => {
  it('5/6) el badge "Resultado final/provisional" (resolverEstadoResultadoGeneral) se retiró de la pestaña Resultado a pedido explícito del usuario ("QUITAR ESTO") — la vista ejecutiva de Tarifa del servicio ya no lo muestra', () => {
    expect(PAGE_TSX).not.toContain("resolverEstadoResultadoGeneral({manoObra:estadoModuloManoObra,turnantes:estadoModuloTurnantes})==='FINAL'?'Resultado final':'Resultado provisional'");
  });

  it('resolverEstadoResultadoGeneral: Mano de Obra COMPLETADO por sí solo NO produce FINAL (los demás módulos no implementados quedan ausentes del mapa) — Ajuste "NO_APLICA EN 4 MÓDULOS" extrajo el every() a clavesAEvaluar (default CLAVES_MODULO, comportamiento histórico intacto)', () => {
    const guardadoModular = readFileSync(join(__dirname, 'guardado-modular.ts'), 'utf-8');
    expect(guardadoModular).toContain('const todosListos = clavesAEvaluar.every(clave => moduloEstaResuelto(estadosModulos[clave]));');
    expect(guardadoModular).toContain('clavesAEvaluar: readonly ClaveModulo[] = CLAVES_MODULO,');
  });
});

describe('Propiedad canónica (cierre correctivo §3, pruebas #7/#8)', () => {
  it('7) existe la tabla de propiedad canónica en el contrato', () => {
    const guardadoModular = readFileSync(join(__dirname, 'guardado-modular.ts'), 'utf-8');
    expect(guardadoModular).toContain('PROPIEDAD CANÓNICA DE DATOS');
    expect(guardadoModular).toContain('Módulo propietario');
  });

  it('8) Mano de Obra ya no envía una segunda copia completa de dotGroups/examRows/cursosRows/vacunasRows', () => {
    const inicio = PAGE_TSX.indexOf('function construirDatosEntradaManoObra()');
    const fin = PAGE_TSX.indexOf('\n  }', inicio);
    const bloque = PAGE_TSX.slice(inicio, fin);
    expect(bloque).not.toContain('dotGroups');
    expect(bloque).not.toContain('examRows');
    expect(bloque).not.toContain('cursosRows');
    expect(bloque).not.toContain('vacunasRows');
  });
});

describe('Separación datosEntrada/resultadoSnapshot (cierre correctivo §4, prueba #9)', () => {
  it('el contrato define ResultadoSnapshotManoObra y DatosManoObraModular con la forma pedida', () => {
    const guardadoModular = readFileSync(join(__dirname, 'guardado-modular.ts'), 'utf-8');
    expect(guardadoModular).toContain('export interface ResultadoSnapshotManoObra {');
    expect(guardadoModular).toContain("versionMotor: 'COMERCIAL_30_DIAS';");
    expect(guardadoModular).toContain('export interface DatosManoObraModular {');
    expect(guardadoModular).toContain('datosEntrada: Record<string, unknown>;');
  });

  it('9) resolverDatosEntradaManoObra nunca lee resultadoSnapshot como fuente de datos editables', () => {
    const guardadoModular = readFileSync(join(__dirname, 'guardado-modular.ts'), 'utf-8');
    const inicio = guardadoModular.indexOf('export function resolverDatosEntradaManoObra');
    const fin = guardadoModular.indexOf('\n}', inicio);
    const bloque = guardadoModular.slice(inicio, fin);
    expect(bloque).not.toContain('resultadoSnapshot');
  });

  it('page.tsx construye datosEntrada y resultadoSnapshot por separado y los guarda juntos, nunca solo el snapshot', () => {
    expect(PAGE_TSX).toContain('function construirResultadoSnapshotManoObra():ResultadoSnapshotManoObra{');
    expect(PAGE_TSX).toContain("const datosModulo:DatosManoObraModular={datosEntrada,resultadoSnapshot:construirResultadoSnapshotManoObra()};");
  });
});

describe('Protección contra doble guardado (cierre correctivo §5, pruebas #10/#11)', () => {
  it('10/11) guardandoModuloManoObraRef impide una segunda solicitud concurrente (re-entrancy guard sincrónico)', () => {
    const inicio = PAGE_TSX.indexOf('async function guardarModuloManoObra');
    const fin = PAGE_TSX.indexOf('\n  }\n\n  async function guardarAvanceManoObra', inicio);
    const bloque = PAGE_TSX.slice(inicio, fin);
    expect(bloque).toContain('if(guardandoModuloManoObraRef.current)return false;');
    expect(bloque).toContain('guardandoModuloManoObraRef.current=true;');
    expect(bloque).toContain('guardandoModuloManoObraRef.current=false;');
  });

  it('Ajuste "un solo guardado" — el único botón se deshabilita con guardandoModuloManoObra', () => {
    expect(PAGE_TSX).toContain('const guardandoModuloManoObra=guardandoAvanceMO;');
    expect(PAGE_TSX).toContain('onClick={guardarAvanceManoObra} disabled={guardandoModuloManoObra}');
  });

  it('17) un error de guardado conserva hayCambiosSinGuardarManoObra (nunca se limpia en la rama de error)', () => {
    // Corrección "INDEPENDENCIA REAL DE GUARDADO POR PESTAÑA" — el
    // try/catch de red vive ahora dentro de ejecutarGuardadoModuloCosteo
    // (que nunca lanza, siempre retorna {ok:false,...}); guardarModuloManoObra
    // solo debe limpiar la bandera dentro del bloque de éxito, nunca en
    // la rama `if(!r.ok){...}`.
    const inicio = PAGE_TSX.indexOf('async function guardarModuloManoObra');
    const fin = PAGE_TSX.indexOf('\n  }\n\n  async function guardarAvanceManoObra', inicio);
    const bloque = PAGE_TSX.slice(inicio, fin);
    const inicioError = bloque.indexOf('if(!r.ok){');
    const bloqueError = bloque.slice(inicioError, bloque.indexOf('return false;', inicioError));
    expect(bloqueError).not.toContain('setHayCambiosSinGuardarManoObra(false)');
  });
});

describe('Autorización y respuestas del PUT (cierre correctivo §6, pruebas #13/#14/#15/#16)', () => {
  it('13/14) ejecutarGuardadoModuloCosteo (núcleo compartido por Mano de Obra y Turnantes) maneja explícitamente 401/403/404/409 con mensajes comerciales, sin exponer detalles internos', () => {
    const inicio = PAGE_TSX.indexOf('async function ejecutarGuardadoModuloCosteo');
    const fin = PAGE_TSX.indexOf('\n  }\n\n  /** Unico punto de persistencia', inicio);
    const bloque = PAGE_TSX.slice(inicio, fin);
    expect(bloque).toContain("res.status===401");
    expect(bloque).toContain("res.status===403");
    expect(bloque).toContain("res.status===404");
    expect(bloque).toContain("res.status===409");
  });

  it('16) la versión canónica que el cliente guarda es siempre la que retorna el servidor (d.modulo.ultimaActualizacion), nunca una fecha del navegador', () => {
    const inicio = PAGE_TSX.indexOf('async function ejecutarGuardadoModuloCosteo');
    const fin = PAGE_TSX.indexOf('\n  }\n\n  /** Unico punto de persistencia', inicio);
    const bloque = PAGE_TSX.slice(inicio, fin);
    expect(bloque).toContain('return{ok:true,estado:d.modulo.estado,ultimaActualizacion:d.modulo.ultimaActualizacion,actualizadoPor:d.modulo.actualizadoPor};');
  });

  it('guardarModuloManoObra asigna manoObraUltimaActualizacion desde el resultado devuelto por ejecutarGuardadoModuloCosteo (nunca una fecha propia)', () => {
    const inicio = PAGE_TSX.indexOf('async function guardarModuloManoObra');
    const fin = PAGE_TSX.indexOf('\n  }\n\n  async function guardarAvanceManoObra', inicio);
    const bloque = PAGE_TSX.slice(inicio, fin);
    expect(bloque).toContain('setManoObraUltimaActualizacion(r.ultimaActualizacion!);');
  });
});

describe('No se toca Prisma/migraciones/BD física (§16, prueba #24)', () => {
  it('el módulo de guardado modular no importa Prisma directamente', () => {
    const guardadoModular = readFileSync(join(__dirname, 'guardado-modular.ts'), 'utf-8');
    const validacion = readFileSync(join(__dirname, 'validacion-mano-obra.ts'), 'utf-8');
    expect(guardadoModular).not.toContain('@prisma');
    expect(guardadoModular).not.toContain("from '@/lib/prisma'");
    expect(validacion).not.toContain("from '@/lib/prisma'");
  });
});