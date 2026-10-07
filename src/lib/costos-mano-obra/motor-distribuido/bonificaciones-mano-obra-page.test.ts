/**
 * Verificación de fuente — cierre "IMPLEMENTACIÓN — CINCO TIPOS DE BONO
 * CONFIRMADOS". No hay arnés de render de componentes para page.tsx
 * (~25.000 líneas) en este proyecto; verificación honesta y acotada del
 * TEXTO/estructura exacta en el código fuente, mismo patrón ya usado en
 * texto-ui-mano-obra*.test.ts / anio-calculo-festivos-estabilidad.test.ts.
 * Complementa las pruebas puras de bonificaciones-mano-obra.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PAGE_TSX = readFileSync(join(__dirname, '../../../app/page.tsx'), 'utf-8');

describe('§2 — contrato de datos: LineaMOExtra tiene los 4 bonos no prestacionales por línea', () => {
  it('los 8 campos (con+valor ×4) existen en la interfaz LineaMOExtra', () => {
    expect(PAGE_TSX).toContain('conBonoAlimentacion:boolean;');
    expect(PAGE_TSX).toContain('bonoAlimentacionValor:string;');
    expect(PAGE_TSX).toContain('conBonoTransporte:boolean;');
    expect(PAGE_TSX).toContain('bonoTransporteValor:string;');
    expect(PAGE_TSX).toContain('conBonoProductividad:boolean;');
    expect(PAGE_TSX).toContain('bonoProductividadValor:string;');
    expect(PAGE_TSX).toContain('conBonoOcasional:boolean;');
    expect(PAGE_TSX).toContain('bonoOcasionalValor:string;');
  });

  it('Bono Prestacional sigue siendo un campo separado de los 4 no prestacionales', () => {
    expect(PAGE_TSX).toContain('conBonoPrestacional:boolean;');
    expect(PAGE_TSX).toContain('bonoPrestacionalValor:string;');
  });
});

describe('§14.5/§14.6/§14.17 — todos inician en 0/false y se restauran (normalizarBonificacionesLinea)', () => {
  it('normalizarBonificacionesLinea inicializa los 4 bonos ausentes en un JSON histórico', () => {
    const inicio = PAGE_TSX.indexOf('const normalizarBonificacionesLinea=');
    const fin = PAGE_TSX.indexOf('});', inicio);
    const bloque = PAGE_TSX.slice(inicio, fin);
    expect(bloque).toContain("conBonoAlimentacion:l.conBonoAlimentacion??false");
    expect(bloque).toContain("bonoAlimentacionValor:l.bonoAlimentacionValor??'0'");
    expect(bloque).toContain("conBonoTransporte:l.conBonoTransporte??false");
    expect(bloque).toContain("bonoTransporteValor:l.bonoTransporteValor??'0'");
    expect(bloque).toContain("conBonoProductividad:l.conBonoProductividad??false");
    expect(bloque).toContain("bonoProductividadValor:l.bonoProductividadValor??'0'");
    expect(bloque).toContain("conBonoOcasional:l.conBonoOcasional??false");
    expect(bloque).toContain("bonoOcasionalValor:l.bonoOcasionalValor??'0'");
  });

  it('abrirModalCargoNuevo (borrador compartido por lineasExtra/cargosTurnantes, corrección "ESTADO TRANSACCIONAL DEL MODAL") inicializa los 4 bonos en false/"0" para un cargo nuevo', () => {
    const ocurrencias = PAGE_TSX.split("conBonoAlimentacion:false,bonoAlimentacionValor:'0',conBonoTransporte:false,bonoTransporteValor:'0',conBonoProductividad:false,bonoProductividadValor:'0',conBonoOcasional:false,bonoOcasionalValor:'0',").length - 1;
    expect(ocurrencias).toBeGreaterThanOrEqual(1); // abrirModalCargoNuevo — un único borrador base para ambas colecciones (lineasExtra y cargosTurnantes)
  });
});

describe('§11/§3 — Bono Prestacional conserva su tratamiento financiero actual (sin auditar de nuevo el cálculo)', () => {
  it('bonoPrestacionalMensual sigue siendo el único bono salarial que entra a construirLineaCalculadaMensualComercial30Dias', () => {
    expect(PAGE_TSX).toContain('bonoPrestacionalMensual:bonoL');
  });

  it('cierre "LÍMITE DEL 40%" — los 4 bonos no prestacionales SÍ entran, pero ÚNICAMENTE vía pagosNoSalarialesMensualesPorTrabajador (nunca como salarioMensual/bonoPrestacionalMensual/cantidadTrabajadores)', () => {
    const inicio = PAGE_TSX.indexOf('const construirCalculadaLinea=React.useCallback');
    const fin = PAGE_TSX.indexOf('},[conAux,auxValor,parametrosFinancierosResueltos,anioCalculoFestivosResuelto]);', inicio);
    const bloque = PAGE_TSX.slice(inicio, fin);
    expect(bloque).toContain('pagosNoSalarialesMensualesPorTrabajador:pagosNoSalarialesPorTrabajadorL');
    // Los 4 bonos se leen SOLO dentro del cálculo de pagosNoSalarialesPorTrabajadorL,
    // nunca se pasan sueltos como otro argumento del constructor.
    const idxOpciones = bloque.indexOf('pagosNoSalarialesPorTrabajadorL=');
    const idxLlamada = bloque.indexOf('construirLineaCalculadaMensualComercial30Dias(');
    const argumentosConstructor = bloque.slice(idxLlamada, bloque.indexOf(');', idxLlamada));
    // Dentro de los argumentos de la llamada, los 4 bonos solo aparecen
    // referenciados a través de la variable ya calculada, no repetidos sueltos.
    expect(argumentosConstructor).not.toContain('l.bonoAlimentacionValor');
    expect(argumentosConstructor).not.toContain('l.bonoTransporteValor');
    expect(argumentosConstructor).not.toContain('l.bonoProductividadValor');
    expect(argumentosConstructor).not.toContain('l.bonoOcasionalValor');
    expect(idxOpciones).toBeGreaterThan(-1);
  });
});

describe('§5/§12/§13/§14 — Bono Transporte nunca se mezcla con el auxilio legal de transporte', () => {
  it('usa una propiedad de persistencia distinta (bonoTransporteValor vs auxValor)', () => {
    expect(PAGE_TSX).toContain('bonoTransporteValor');
    expect(PAGE_TSX).toContain('auxValor');
    // obtenerBonosNoPrestacionalesLinea nunca lee auxValor/conAux.
    const inicio = PAGE_TSX.indexOf('const obtenerBonosNoPrestacionalesLinea=React.useCallback');
    const fin = PAGE_TSX.indexOf('},[]);', inicio);
    const bloque = PAGE_TSX.slice(inicio, fin);
    expect(bloque).not.toContain('conAux');
    expect(bloque).not.toContain('auxValor');
  });

  it('el nombre visible aclara "Bono de transporte adicional" sin cambiar el ID interno BONO_TRANSPORTE', () => {
    // La aclaración textual "Concepto diferente del auxilio legal de
    // transporte." se retiró de la UI a pedido del usuario — el nombre
    // "Bono de transporte adicional" ya es suficientemente explícito, y la
    // separación real (bonoTransporteValor vs auxValor, sin mezclar en
    // obtenerBonosNoPrestacionalesLinea) se verifica en la prueba anterior.
    expect(PAGE_TSX).toContain('Bono de transporte adicional');
  });
});

describe('§7 — resumen financiero: fila independiente, fuera del subtotal salarial', () => {
  it('"Bonos no prestacionales por trabajador" es una fila propia, después de "Subtotal salarial por trabajador" y de "Otros costos por trabajador" (reubicada a pedido del usuario, justo antes del costo mensual total)', () => {
    const idxSubtotal = PAGE_TSX.indexOf('Subtotal salarial por trabajador:');
    const idxOtrosCostos = PAGE_TSX.indexOf("{label:'Otros costos por trabajador'");
    const idxBonos = PAGE_TSX.indexOf('Bonos no prestacionales por trabajador:');
    const idxCostoTotal = PAGE_TSX.indexOf('Costo mensual total del cargo:');
    expect(idxSubtotal).toBeGreaterThan(-1);
    expect(idxBonos).toBeGreaterThan(idxSubtotal);
    expect(idxBonos).toBeGreaterThan(idxOtrosCostos);
    expect(idxBonos).toBeLessThan(idxCostoTotal);
  });

  it('el subtotal salarial NO incluye los bonos no prestacionales en su fórmula', () => {
    const inicio = PAGE_TSX.indexOf('Subtotal salarial por trabajador:');
    const fin = PAGE_TSX.indexOf('</div>', inicio + 400);
    const bloque = PAGE_TSX.slice(Math.max(0, inicio - 400), fin);
    expect(bloque).not.toContain('totalBonosNoPrestacionalesGrupo');
  });

  it('el costo mensual total del cargo SÍ suma los bonos no prestacionales', () => {
    // Ajuste "MEJOR CAMBIEMOS... EN RESUMEN MANO DE OBRA" — la expresión
    // ahora se asigna a una variable (subtotalPosiciones) antes de
    // pasarla a cop(), en vez de inlinearse directamente — misma fórmula,
    // nunca cambiada.
    expect(PAGE_TSX).toContain('grupo.agregadoOtrosCostos.costoMensualTotalManoObra+grupo.totalBonosNoPrestacionalesGrupo');
  });
});

describe('§8 — detalle desplegable de bonos no prestacionales (organizado en columnas, una fila por cargo, mismo patrón que Prestaciones/Seguridad/Parafiscales)', () => {
  it('la tabla tiene una columna por cada uno de los 4 bonos, más N.°/Cargo/Total línea', () => {
    expect(PAGE_TSX).toContain("['N.°','Cargo','Bono Alimentación','Bono de transporte adicional','Bono Productividad','Bono Ocasional','Por trabajador']");
  });
  it('una fila por cargo (grupo.filas.map), no una fila por concepto', () => {
    const inicio = PAGE_TSX.indexOf("['N.°','Cargo','Bono Alimentación','Bono de transporte adicional','Bono Productividad','Bono Ocasional','Por trabajador']");
    const fin = PAGE_TSX.indexOf('BONOS NO PRESTACIONALES POR TRABAJADOR', inicio);
    const bloque = PAGE_TSX.slice(inicio, fin);
    expect(bloque).toContain('grupo.filas.map(d=>{');
  });
  it('Bono Prestacional no aparece como columna ni fila del desplegable no prestacional', () => {
    const inicio = PAGE_TSX.indexOf("['N.°','Cargo','Bono Alimentación','Bono de transporte adicional','Bono Productividad','Bono Ocasional','Por trabajador']");
    const fin = PAGE_TSX.indexOf('BONOS NO PRESTACIONALES POR TRABAJADOR', inicio);
    const bloque = PAGE_TSX.slice(inicio, fin);
    expect(bloque).not.toContain('Bono Prestacional');
  });
});

describe('§13/§21 — trazabilidad: nunca doble suma entre línea, cargo y total de Mano de Obra', () => {
  it('el total global usa agregarBonosNoPrestacionales sobre Mano de Obra + Turnantes, una sola vez', () => {
    expect(PAGE_TSX).toContain('const totalBonosNoPrestacionalesManoObra=React.useMemo(');
    expect(PAGE_TSX).toContain('tarifaMensualTotalManoObra=agregadoCostoMensualTotalManoObra.costoMensualTotalManoObra+totalBonosNoPrestacionalesManoObra');
  });

  it('ya no existe el antiguo total global "bonoTotal" (retirado al migrar a por-línea)', () => {
    expect(PAGE_TSX).not.toMatch(/\bconst bonoTotal\s*=/);
  });
});

describe('§5/§6 — presentación comercial del límite del 40% (cierre "LÍMITE DEL 40% DE PAGOS NO SALARIALES PARA IBC")', () => {
  it('mensaje cuando hay exceso', () => {
    expect(PAGE_TSX).toContain('Los pagos no salariales superan el 40% de la remuneración total. El exceso se incorpora a la base de salud, pensión y riesgos laborales.');
  });
  it('cierre "APLICAR EL IBC AJUSTADO TAMBIÉN A ARL" — sin exceso, el bloque completo no se muestra (nunca "sin ajuste" como ruido)', () => {
    const inicio = PAGE_TSX.indexOf('const filasConLimite=grupo.filas.map');
    const fin = PAGE_TSX.indexOf('{([', inicio);
    const bloque = PAGE_TSX.slice(inicio, fin);
    expect(bloque).toContain('if(conExceso.length===0)return null;');
    expect(bloque).not.toContain('No se genera ajuste adicional al IBC');
  });
  it('muestra los 4 datos exigidos: total pagos no salariales, límite, exceso, IBC ajustado (salud, pensión y ARL)', () => {
    expect(PAGE_TSX).toContain('Total pagos no salariales:');
    expect(PAGE_TSX).toContain('Límite excluible del 40%:');
    expect(PAGE_TSX).toContain('Exceso incorporado al IBC:');
    expect(PAGE_TSX).toContain('IBC ajustado (salud, pensión y ARL):');
  });
  it('§6 — aclaración de naturaleza configurada, sin afirmar validación jurídica automática', () => {
    expect(PAGE_TSX).toContain('Clasificación configurada como pago no salarial. Su aplicación depende de la documentación y condiciones laborales correspondientes.');
  });
  it('salud 0% se aclara explícitamente en el detalle', () => {
    expect(PAGE_TSX).toContain('El porcentaje de salud configurado es 0%, por lo que no genera aporte, aunque comparte la base ajustada.');
  });
  it('nunca muestra nombres de funciones/propiedades técnicas en el mensaje (ej. "ibcAjustado", "excesoNoSalarialIBC" como texto crudo)', () => {
    const inicio = PAGE_TSX.indexOf('Los pagos no salariales superan el 40%') - 200;
    const fin = PAGE_TSX.indexOf('Clasificación configurada como pago no salarial');
    const bloque = PAGE_TSX.slice(Math.max(0,inicio), fin);
    expect(bloque).not.toMatch(/>ibcAjustado</);
    expect(bloque).not.toMatch(/>excesoNoSalarialIBC</);
  });
});