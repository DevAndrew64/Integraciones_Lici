/**
 * Ajuste "IMPLEMENTAR FICHAS DE TURNANTES USANDO EXACTAMENTE LA MISMA
 * ESTRUCTURA DE MANO DE OBRA" + "LAS UBICACIONES DEBEN IR SEGÚN LO QUE SE
 * EJECUTA" + "Y EN LAS FICHAS CREADAS EL TURNANTE YA VA POR FUERA NO ACA"
 * — verificación de cableado en page.tsx (texto fuente, mismo patrón que
 * el resto de *-page.test.ts: no existe arnés de render para este archivo
 * de ~32.000 líneas). La ficha del turnante se renderiza como su PROPIA
 * ficha (componente FichaTurnante).
 *
 * Ajuste (petición directa) "DEBERIA VERSE TIPO IMAGEN 2 Y 3" — revierte
 * la ubicación anterior (intercalada justo debajo del cargo que la
 * requiere, vía turnantesPorClaveFichaCargo): ahora TODOS los turnantes se
 * agrupan en su propia sección "Turnantes" al final, numerada igual que
 * los cargos arriba (1. X, 2. X...) — mismo patrón de tarjetas numeradas
 * ya usado en Dotación/EPP. turnantesPorClaveFichaCargo sigue definido
 * (su lógica de agrupación por último cargo servido no cambió), pero ya
 * no se usa para decidir la posición de render.
 *
 * Ajuste "CORREGIR DEFINITIVAMENTE LA UNIDAD ECONÓMICA DEL TURNANTE" — la
 * ficha representa el PAQUETE económico de referencia de 42h (`fin.*`,
 * SIEMPRE por trabajador, nunca escalado/dividido/multiplicado para
 * mostrarlo): un paquete de 42h puede estar compuesto físicamente por 1
 * turnante de tiempo completo o por 2 turnantes de medio tiempo en
 * horarios complementarios — el costo es el mismo en ambos casos. La
 * cantidad de paquetes es `equivalentesTiempoCompleto`; el total del pool
 * sigue viniendo de `resultado.costoMensualTotalLinea` (línea real, ×N),
 * la MISMA fuente que el total general de Mano de Obra — nunca se
 * reemplaza por costoUnitarioPaquete×cantidadPaquetes.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PAGE_TSX = readFileSync(join(__dirname, '../../../app/page.tsx'), 'utf-8');

describe('1) el bloque de referencia42hCompleta viene DIRECTAMENTE de finRef.* (por trabajador), nunca dividido/multiplicado', () => {
  it('referencia42hCompleta se construye sin dividir ni multiplicar los campos de finRef', () => {
    const inicio = PAGE_TSX.indexOf('const gruposTurnantesManoObra=React.useMemo(');
    expect(inicio).toBeGreaterThan(-1);
    const bloque = PAGE_TSX.slice(inicio, inicio + 11000);
    expect(bloque).toContain('salarioBasico:finRef.salarioBaseMensual,');
    expect(bloque).toContain('auxilioTransporte:finRef.auxilioTransporteMensual,');
    expect(bloque).toContain('prestaciones:finRef.prestacionesSocialesMensuales,');
    expect(bloque).toContain('seguridadSocial:finRef.seguridadSocialMensual,');
    expect(bloque).toContain('parafiscales:finRef.parafiscalesMensuales,');
    // Nunca dividir por cantidadTrabajadoresLinea al construir referencia42hCompleta.
    expect(bloque).not.toContain('salarioBasico:finRef.salarioBaseMensual/cantidadTrabajadoresLinea');
  });

  it('finRef es fin42 cuando existen bloques integrados, y fin21 SOLO cuando la demanda es un remanente puro (N=1, sin bloques) — nunca al revés', () => {
    const inicio = PAGE_TSX.indexOf('const gruposTurnantesManoObra=React.useMemo(');
    const bloque = PAGE_TSX.slice(inicio, inicio + 11000);
    expect(bloque).toContain('const finRef=fin42??fin21;');
    expect(bloque).toContain('const resultadoRef=resultado42??resultado21;');
  });
});

describe('2) el costo unitario del paquete viene de la referencia de 42h completa, escalada por el factor proporcional (nunca por diferencia contra el total del pool)', () => {
  it('costoUnitarioPaquete42hCompleto = costoLaboralTotal + otros de la referencia SIN escalar; costoUnitarioPaquete aplica calcularCostoProporcionalTurnante SOLO para HORAS_REALES (factor=1 en la excepción de 12h)', () => {
    const inicio = PAGE_TSX.indexOf('const gruposTurnantesManoObra=React.useMemo(');
    const bloque = PAGE_TSX.slice(inicio, inicio + 11000);
    expect(bloque).toContain('const costoUnitarioPaquete42hCompleto=referencia42hCompleta.costoLaboralTotal+referencia42hCompleta.otros;');
    expect(bloque).toContain('const costoUnitarioPaquete=esHorasReales');
    expect(bloque).toContain('?calcularCostoProporcionalTurnante(costoUnitarioPaquete42hCompleto,grupo.horasCoberturaPorPosicion)');
    expect(bloque).toContain(':costoUnitarioPaquete42hCompleto;');
    expect(bloque).not.toMatch(/costoUnitarioPaquete=costoMensualTotal-/);
  });

  it('otros de la referencia42hCompleta divide resultadoRef.otrosCostosMensualesLinea por cantidadTrabajadoresLinea; otrosCostosPaquete y referenciaUnitaria son la referencia SIN escalar (el factor se aplica solo al total, nunca fila por fila). Desde el ajuste "CORRECCIÓN DE REGLA DE NEGOCIO", resultadoRef.otrosCostosMensualesLinea YA incluye el heredado del cargo (ver resultadosTurnantesConOtrosCostos) — esta fórmula no necesita ningún término adicional', () => {
    const inicio = PAGE_TSX.indexOf('const gruposTurnantesManoObra=React.useMemo(');
    const bloque = PAGE_TSX.slice(inicio, inicio + 11000);
    expect(bloque).toContain('otros:cantidadTrabajadoresLinea>0?Math.round(resultadoRef.otrosCostosMensualesLinea/cantidadTrabajadoresLinea):0,');
    expect(bloque).toContain('const otrosCostosPaquete=referencia42hCompleta.otros;');
    expect(bloque).toContain('const referenciaUnitaria=referencia42hCompleta;');
    expect(bloque).not.toMatch(/otrosCostosPaquete=Math\.round\(referencia42hCompleta\.otros\*factorProporcional\)/);
  });
});

describe('3) el total del pool viene de costoTotalGrupoTurnante — fuente ÚNICA compartida, nunca un factor de escala', () => {
  it('costoMensualTotal viene de costoTotalGrupoTurnante(grupo,resultado42,resultado21) (proporcional para HORAS_REALES, suma directa 42/21 para el resto)', () => {
    const inicio = PAGE_TSX.indexOf('const gruposTurnantesManoObra=React.useMemo(');
    const bloque = PAGE_TSX.slice(inicio, inicio + 11000);
    expect(bloque).toContain('const costoMensualTotal=costoTotalGrupoTurnante(grupo,resultado42,resultado21);');
    expect(bloque).not.toContain('const costoMensualTotal=costoUnitarioPaquete*');
    expect(bloque).not.toContain('factorEscalaContrato');
  });

  it('costoTurnantePorCargo usa el MISMO criterio (costoTotalGrupoTurnante, nunca un factor de escala distinto)', () => {
    const inicio = PAGE_TSX.indexOf('const costoTurnantePorCargo=React.useMemo(');
    expect(inicio).toBeGreaterThan(-1);
    const bloque = PAGE_TSX.slice(inicio, inicio + 2200);
    expect(bloque).toContain('const costoContratoGrupo=costoTotalGrupoTurnante(grupo,resultado42,resultado21);');
    expect(bloque).not.toContain('factorEscalaContrato');
  });

  it('costoTotalGrupoTurnante es la fuente ÚNICA — mismo helper referenciado en ambos sitios (nunca dos fórmulas divergentes)', () => {
    const ocurrencias = (PAGE_TSX.match(/costoTotalGrupoTurnante\(grupo,resultado42,resultado21\)/g) ?? []).length;
    expect(ocurrencias).toBeGreaterThanOrEqual(2);
  });

  // Corrección "AGREGADO MENSUAL DE TURNANTES HORAS_REALES" — el total
  // pasó de leer `resultadosTurnantesConOtrosCostos` (crudo) a
  // `resultadosTurnantesConOtrosCostosParaAgregado` (mismo array, pero
  // escalado por `factorAgregadoTurnanteHorasReales` para HORAS_REALES —
  // factor=1 para la excepción de 21/42h, así que el comportamiento que
  // este test protege sigue exactamente igual para esos casos). No revive
  // `resultadosTurnantesEscaladosParaTotal` (ese mecanismo, retirado por
  // completo, escalaba TODO por un solo factor global — este es un factor
  // POR GRUPO, calculado con la misma fuente única `costoTotalGrupoTurnante`).
  it('agregadoCostoMensualTotalManoObra suma resultadosTurnantesConOtrosCostosParaAgregado (ya no existe resultadosTurnantesEscaladosParaTotal — cada línea de la excepción 21/42h ya nace con su cantOpeFijos correcto; HORAS_REALES se escala por grupo vía factorAgregadoTurnanteHorasReales)', () => {
    const inicio = PAGE_TSX.indexOf('const agregadoCostoMensualTotalManoObra=React.useMemo(');
    expect(inicio).toBeGreaterThan(-1);
    const bloque = PAGE_TSX.slice(inicio, inicio + 500);
    expect(bloque).toContain('...resultadosTurnantesConOtrosCostosParaAgregado.map(r=>r.resultado)');
    expect(bloque).not.toContain('gruposTurnantesManoObra');
    expect(PAGE_TSX).not.toContain('const resultadosTurnantesEscaladosParaTotal=React.useMemo(');
  });
});

describe('4) cantidad de paquetes = equivalentesTiempoCompleto — aumentar la cantidad NUNCA cambia el desglose unitario, solo el total', () => {
  it('equivalentesTiempoCompleto = horasContratadasTotal/42', () => {
    const inicio = PAGE_TSX.indexOf('const gruposTurnantesManoObra=React.useMemo(');
    const bloque = PAGE_TSX.slice(inicio, inicio + 11000);
    expect(bloque).toContain('const equivalentesTiempoCompleto=grupo.necesidad.horasContratadasTotal/CAPACIDAD_REFERENCIA_TIEMPO_COMPLETO;');
  });

  it('la ficha expone cantidadTurnantesFisicos leído directamente de grupo.necesidad, nunca recalculado', () => {
    const inicio = PAGE_TSX.indexOf('const gruposTurnantesManoObra=React.useMemo(');
    const bloque = PAGE_TSX.slice(inicio, inicio + 11000);
    expect(bloque).toContain('cantidadTurnantesFisicos:grupo.necesidad.cantidadTurnantesFisicos,');
  });
});

describe('5) atribución de cargo(s) servidos — vía coberturaPorPosicion + id, nunca por nombre de cargo', () => {
  it('cargosServidos se construye desde idAFicha (detalleLineasMensualUI por id)', () => {
    const inicio = PAGE_TSX.indexOf('const gruposTurnantesManoObra=React.useMemo(');
    const bloque = PAGE_TSX.slice(inicio, inicio + 11000);
    expect(bloque).toContain('const idAFicha=new Map(detalleLineasMensualUI.map(f=>[String(f.id),{claveFicha:f.claveFicha,tituloFicha:f.tituloFicha,nombreCargo:f.nombreCargo,horarioCortoFicha:f.horarioCortoFicha}]));');
    expect(bloque).toContain('for(const c of grupo.coberturaPorPosicion){');
  });

  it('esPoolCompartido = cargosServidos.length>1 (dato expuesto en el objeto, aunque la ficha ya no lo despliega como aviso aparte)', () => {
    const inicio = PAGE_TSX.indexOf('const gruposTurnantesManoObra=React.useMemo(');
    const bloque = PAGE_TSX.slice(inicio, inicio + 11000);
    expect(bloque).toContain('esPoolCompartido:cargosServidos.length>1,');
  });
});

describe('6) identidad estable — la ficha se identifica por claveGrupo (nunca por índice ni por nombre de cargo)', () => {
  it('el React key de cada ficha es g.claveGrupo', () => {
    const inicio = PAGE_TSX.indexOf('function FichaTurnante(');
    expect(inicio).toBeGreaterThan(-1);
    const bloque = PAGE_TSX.slice(inicio, inicio + 800);
    expect(bloque).toContain("<BloqueColapsable key={g.claveGrupo} titulo={indice!=null?`${indice}. ${g.tituloFicha}`:g.tituloFicha} subtitulo={g.subtituloFicha??undefined} valor={g.costoMensualTotal}");
  });

  it('el estado de apertura/cierre de cada ficha se indexa por claveGrupo, en un state independiente del de las tarjetas de cargo', () => {
    expect(PAGE_TSX).toContain('const [panelesFichaTurnanteAbiertos,setPanelesFichaTurnanteAbiertos]=useState<Record<string,boolean>>({});');
    const inicio = PAGE_TSX.indexOf('function FichaTurnante(');
    const bloque = PAGE_TSX.slice(inicio, inicio + 800);
    expect(bloque).toContain('abierto={panelesFichaTurnanteAbiertos[g.claveGrupo]??false}');
  });
});

describe('7) reutiliza el MISMO componente visual que Mano de Obra — nunca una plantilla distinta', () => {
  it('la ficha de turnante usa BloqueColapsable, el mismo componente de las tarjetas de cargo', () => {
    const inicio = PAGE_TSX.indexOf('function FichaTurnante(');
    const bloque = PAGE_TSX.slice(inicio, inicio + 6000);
    expect(bloque).toContain('<BloqueColapsable key={g.claveGrupo}');
  });

  it('el desglose por concepto usa las mismas etiquetas que la ficha de Mano de Obra, más el costo unitario del paquete y el total del pool', () => {
    const inicio = PAGE_TSX.indexOf('function FichaTurnante(');
    const bloque = PAGE_TSX.slice(inicio, inicio + 16000);
    expect(bloque).toContain('Salario básico mensual:');
    expect(bloque).toContain('Bono prestacional mensual:');
    expect(bloque).toContain('Recargos y horas extras mensuales:');
    expect(bloque).toContain('Auxilio de transporte mensual:');
    expect(bloque).toContain('Subtotal salarial mensual:');
    expect(bloque).toContain('Prestaciones sociales mensuales:');
    expect(bloque).toContain('Seguridad social mensual:');
    expect(bloque).toContain('Aportes parafiscales mensuales:');
    expect(bloque).toContain('Otros costos mensuales:');
    expect(bloque).toContain('Costo laboral mensual del cargo:');
    expect(bloque).toContain('Costo mensual de turnantes:');
    // Ajuste "MEJORAR LA PRESENTACIÓN DE LA TARJETA DE TURNANTES" — la
    // palabra "ficha" ya no aparece en ningún texto visible al usuario.
    expect(bloque).not.toContain('Total de la ficha');
  });

  it('cada fila del desglose viene de g.referenciaUnitaria.* (NUNCA de un objeto escalado/reconciliado) — nunca reconstruye el salario por diferencia', () => {
    const inicio = PAGE_TSX.indexOf('function FichaTurnante(');
    const bloque = PAGE_TSX.slice(inicio, inicio + 12000);
    expect(bloque).toContain('{cop(g.referenciaUnitaria.salarioBasico)}');
    expect(bloque).toContain('{cop(g.referenciaUnitaria.auxilioTransporte)}');
    expect(bloque).toContain('{cop(g.referenciaUnitaria.prestaciones)}');
    expect(bloque).toContain('{cop(g.referenciaUnitaria.seguridadSocial)}');
    expect(bloque).toContain('{cop(g.referenciaUnitaria.parafiscales)}');
    expect(bloque).not.toContain('{cop(g.totales.salarioBaseMensual)}');
  });
});

describe('8) información propia del turnante ANTES del desglose económico — cobertura OPERATIVA vs horas CONTRATADAS, nunca confundidas', () => {
  it('la ficha muestra cantidad de turnantes físicos, cobertura operativa total, jornada individual y horas contratadas totales', () => {
    const inicio = PAGE_TSX.indexOf('function FichaTurnante(');
    const bloque = PAGE_TSX.slice(inicio, inicio + 3500);
    expect(bloque).toContain('Cantidad de turnantes físicos');
    expect(bloque).toContain('Cobertura operativa total');
    expect(bloque).toContain('Jornada individual');
    expect(bloque).toContain('Horas contratadas totales');
  });

  it('la jornada individual depende de la modalidad: HORAS_REALES usa horasCoberturaPorPosicion real; la excepción de 12h usa bloques (42h tiempo completo) o remanente (21h medio tiempo) — nunca un valor fijo', () => {
    const inicio = PAGE_TSX.indexOf('const gruposTurnantesManoObra=React.useMemo(');
    const bloque = PAGE_TSX.slice(inicio, inicio + 11000);
    expect(bloque).toContain("const esHorasReales=grupo.modalidadCobertura==='HORAS_REALES';");
    expect(bloque).toContain('const jornadaContractualTexto=esHorasReales');
    expect(bloque).toContain('`${grupo.horasCoberturaPorPosicion} h semanales`');
    expect(bloque).toContain("?`${CAPACIDAD_REFERENCIA_TIEMPO_COMPLETO} h semanales (tiempo completo)`");
    expect(bloque).toContain("`${JORNADA_MEDIO_TIEMPO} h semanales (medio tiempo)`");
  });

  it('coberturaOperativaTotal viene de horasRelevoSemanales (demanda real) y horasContratadasTotal de horasContratadasTotal (lo pagado) — nunca se confunden', () => {
    const inicio = PAGE_TSX.indexOf('const gruposTurnantesManoObra=React.useMemo(');
    const bloque = PAGE_TSX.slice(inicio, inicio + 11000);
    expect(bloque).toContain('coberturaOperativaTotal:grupo.necesidad.horasRelevoSemanales,');
    expect(bloque).toContain('horasContratadasTotal:grupo.necesidad.horasContratadasTotal,');
  });
});

describe('9) cobertura incompleta — la ficha advierte cuando el costo es preliminar, nunca lo presenta como definitivo', () => {
  it('coberturaCompleta viene de grupo.necesidad.coberturaCompleta y la ficha muestra una advertencia cuando es false', () => {
    const inicioMemo = PAGE_TSX.indexOf('const gruposTurnantesManoObra=React.useMemo(');
    expect(PAGE_TSX.slice(inicioMemo, inicioMemo + 11000)).toContain('coberturaCompleta:grupo.necesidad.coberturaCompleta,');
    const inicioJsx = PAGE_TSX.indexOf('function FichaTurnante(');
    expect(PAGE_TSX.slice(inicioJsx, inicioJsx + 3500)).toContain('Cobertura parcial pendiente de programación');
  });
});

describe('10) EPP/Dotación/Exámenes no se ven afectados por esta ficha — puramente aditiva, nunca cambia lineasManoObraDisponibles', () => {
  it('lineasManoObraDisponibles sigue derivando de lineasExtra por id, sin ninguna referencia a gruposTurnantesManoObra', () => {
    expect(PAGE_TSX).toContain("const lineasManoObraDisponibles=React.useMemo(()=>[");
    expect(PAGE_TSX).not.toContain('lineasManoObraDisponibles=React.useMemo(()=>gruposTurnantesManoObra');
  });
});

describe('11) ubicación — la ficha del turnante se renderiza debajo del cargo (o cargos) que la requieren, nunca en una sección aparte al final ni anidada dentro de la ficha del cargo', () => {
  // Ajuste "CAMBIA LA POSICIÓN DE ESTE BLOQUE, TURNANTE VA SIEMPRE DEBAJO
  // DEL CARGO(S) QUE APLIQUEN" — se ancla al ÚLTIMO cargo servido en el
  // orden de renderizado real (gruposCargoManoObra), nunca al primero:
  // así, cuando el pool sirve a VARIAS fichas del mismo cargo (ej.
  // VIGILANTE 18-06 y VIGILANTE 06-18), el orden queda VIGILANTE,
  // VIGILANTE, TURNANTE — nunca intercalado entre las dos fichas del
  // cargo. Un pool compartido se renderiza una sola vez (bajo su último
  // cargo servido).
  it('turnantesPorClaveFichaCargo agrupa por el ÚLTIMO cargo servido en el orden real de gruposCargoManoObra, nunca por el primero', () => {
    const inicio = PAGE_TSX.indexOf('const turnantesPorClaveFichaCargo=React.useMemo(');
    expect(inicio).toBeGreaterThan(-1);
    const bloque = PAGE_TSX.slice(inicio, inicio + 1200);
    expect(bloque).toContain('const indicePorClaveFicha=new Map(gruposCargoManoObra.map((grupo,i)=>[grupo.claveFicha,i]));');
    expect(bloque).toContain('if(indice>indiceMaximo){indiceMaximo=indice;claveFichaUltima=cargo.claveFicha;}');
    expect(bloque).not.toContain('const claveFichaPrincipal=g.cargosServidos[0]?.claveFicha;');
  });

  it('turnantesPorClaveFichaCargo se declara DESPUÉS de gruposCargoManoObra (nunca antes — evita ReferenceError por uso antes de declaración)', () => {
    const inicioGrupos = PAGE_TSX.indexOf('const gruposCargoManoObra=React.useMemo(');
    const inicioTurnantes = PAGE_TSX.indexOf('const turnantesPorClaveFichaCargo=React.useMemo(');
    expect(inicioGrupos).toBeGreaterThan(-1);
    expect(inicioTurnantes).toBeGreaterThan(inicioGrupos);
  });

  // Ajuste (petición directa) "DEBERIA VERSE TIPO IMAGEN 2 Y 3" — revierte
  // la ubicación anterior: los turnantes ya NO se intercalan dentro del
  // mismo .map de cargos; se agrupan en su propia sección "Turnantes",
  // renderizada DESPUÉS de que termina el .map de gruposCargoManoObra,
  // igual al patrón numerado de tarjetas ya usado en Dotación/EPP.
  it('los turnantes se agrupan en su propia sección "Turnantes", renderizada DESPUÉS del .map de cargos (nunca intercalada dentro de él)', () => {
    const inicioMapCargos = PAGE_TSX.indexOf('{gruposCargoManoObra.map((grupo,indiceCargo)=>{');
    expect(inicioMapCargos).toBeGreaterThan(-1);
    const finMapCargos = PAGE_TSX.indexOf('})}', inicioMapCargos);
    const bloqueMapCargos = PAGE_TSX.slice(inicioMapCargos, finMapCargos);
    expect(bloqueMapCargos).not.toContain('<FichaTurnante');
    const inicioSeccionTurnantes = PAGE_TSX.indexOf('gruposTurnantesManoObra.map((g,indiceTurnante)=>(', finMapCargos);
    expect(inicioSeccionTurnantes).toBeGreaterThan(finMapCargos);
    const bloque = PAGE_TSX.slice(inicioSeccionTurnantes, inicioSeccionTurnantes + 200);
    expect(bloque).toContain('<FichaTurnante key={g.claveGrupo} g={g} indice={indiceTurnante+1}/>');
  });

  it('ya no existe una sección "Detalle mensual de turnantes" separada al final del módulo', () => {
    expect(PAGE_TSX).not.toContain('Detalle mensual de turnantes');
  });

  it('el detalle del turnante ya no está anidado dentro de la ficha del cargo (hayTurnanteGrupo&&( ... Costo mensual del turnante ... ) ya no existe)', () => {
    expect(PAGE_TSX).not.toContain('{hayTurnanteGrupo&&(');
    expect(PAGE_TSX).not.toContain('Costo mensual del turnante:');
  });
});
