/**
 * Ajuste "CORREGIR AGRUPACIÓN DE CARGOS EN MANO DE OBRA — SEPARAR POR
 * CARGO + HORARIO" — verificación de cableado en page.tsx (texto fuente,
 * mismo patrón que el resto de *-page.test.ts: no existe arnés de render
 * para este archivo de ~32.000 líneas). La cobertura numérica de la
 * firma/llave en sí vive en firma-programacion.test.ts (función pura,
 * sin readFileSync) — este archivo solo confirma que page.tsx
 * efectivamente usa esa función para agrupar, nunca reimplementa la
 * lógica ni vuelve a agrupar solo por nombre.
 *
 * Caso real reportado: VIGILANTE 18:00-06:00 y VIGILANTE 06:00-18:00
 * (mismo nombre, horarios opuestos) se integraban en una sola ficha.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PAGE_TSX = readFileSync(join(__dirname, '../../../app/page.tsx'), 'utf-8');

describe('1/2) gruposCargoManoObra agrupa por Cargo+Horario (claveFicha), nunca solo por nombreCargo', () => {
  it('la llave de agrupación es fila.claveFicha, nunca fila.nombreCargo', () => {
    const inicio = PAGE_TSX.indexOf('const gruposCargoManoObra=React.useMemo(');
    expect(inicio).toBeGreaterThan(-1);
    const bloque = PAGE_TSX.slice(inicio, inicio + 900);
    expect(bloque).toContain('const clave=fila.claveFicha;');
    expect(bloque).not.toContain("const clave=fila.nombreCargo||'Sin nombre de cargo';");
  });

  it('claveFicha se construye con construirClaveFichaManoObra + construirFirmaProgramacion (nunca con el nombre del cargo solo)', () => {
    const inicio = PAGE_TSX.indexOf('function construirFilaMensualUI(');
    expect(inicio).toBeGreaterThan(-1);
    const bloque = PAGE_TSX.slice(inicio, inicio + 2900);
    // El 4.º parámetro (jornadaFlexible) mantiene separadas las fichas del
    // mismo cargo y horario con y sin jornada flexible pactada.
    expect(bloque).toContain('construirFirmaProgramacion(r.distribucionesHorario,r.incluyeFestivos,r.diaDescansoObligatorio,r.jornadaFlexible)');
    expect(bloque).toContain('construirClaveFichaManoObra(nombreCargoMostrado,firmaProgramacion)');
  });

  it('page.tsx importa las funciones puras, nunca las reimplementa inline', () => {
    expect(PAGE_TSX).toContain("import { construirFirmaProgramacion, construirClaveFichaManoObra } from '@/lib/costos-mano-obra/horarios/firma-programacion';");
  });
});

describe('5/6) título de la ficha distingue por horario, nunca con un nombre artificial ("VIGILANTE 2"/"VVIGILANTE")', () => {
  it('tituloFicha combina nombreCargo + horario corto + festivos, nunca solo el nombre cuando hay un horario simple', () => {
    const inicio = PAGE_TSX.indexOf('function construirFilaMensualUI(');
    const bloque = PAGE_TSX.slice(inicio, inicio + 3900);
    expect(bloque).toContain("const tituloFicha=horarioCorto?`${nombreCargoMostrado}: ${horarioCorto}${r.incluyeFestivos?' + Incluye festivos':''}`:nombreCargoMostrado;");
  });

  it('la tarjeta usa claveFicha como React key del React.Fragment que envuelve la tarjeta + su ficha de turnante (identidades separadas); el título visible es solo el nombre del cargo, con el horario como subtítulo gris aparte (nunca combinados con ":" en una sola línea)', () => {
    expect(PAGE_TSX).toContain('<React.Fragment key={grupo.claveFicha}>');
    expect(PAGE_TSX).toContain('<BloqueColapsable titulo={`${indiceCargo+1}. ${grupo.nombreCargo}`} subtitulo={grupo.horarioCortoFicha??undefined}');
  });
});

describe('5) identidad estable de la fila — editar/eliminar SIEMPRE por id, nunca por nombreCargo', () => {
  it('gruposCargoManoObra.filas conserva el id real de cada línea (idsGrupo, nunca el índice del arreglo)', () => {
    const inicio = PAGE_TSX.indexOf('const gruposCargoManoObra=React.useMemo(');
    const bloque = PAGE_TSX.slice(inicio, inicio + 900);
    expect(bloque).toContain('const idsGrupo=new Set(filas.map(f=>f.id));');
  });
});

describe('8) resumen mensual — filas diferenciadas por ficha (Cargo+Horario), nunca "de VIGILANTE" ambiguo repetido', () => {
  it('la fila del resumen (tabla RESUMEN MANO DE OBRA MENSUAL) atribuye el costo de turnante por claveFicha vía costoTurnantePorCargo, combinado en un solo VR TOTAL por cargo', () => {
    const inicioResumen = PAGE_TSX.indexOf('titulo="RESUMEN MANO DE OBRA MENSUAL"');
    expect(inicioResumen).toBeGreaterThan(-1);
    const inicio = PAGE_TSX.indexOf('gruposCargoManoObra.map(grupo=>{', inicioResumen);
    expect(inicio).toBeGreaterThan(-1);
    const bloque = PAGE_TSX.slice(inicio, inicio + 400);
    expect(bloque).toContain('costoTurnantePorCargo.get(grupo.claveFicha)');
  });

  it('el React key de cada fila del resumen es f.claveFicha (por ficha, Cargo+Horario), nunca nombreCargo — solo la celda combinada CARGO/TURNO se agrupa por nombre, HORARIO/CANT/VR UNITARIO/VR TOTAL siguen por ficha', () => {
    const inicioResumen = PAGE_TSX.indexOf('titulo="RESUMEN MANO DE OBRA MENSUAL"');
    expect(inicioResumen).toBeGreaterThan(-1);
    const inicio = PAGE_TSX.indexOf('gruposCargoManoObra.map(grupo=>{', inicioResumen);
    expect(inicio).toBeGreaterThan(-1);
    const bloque = PAGE_TSX.slice(inicio, inicio + 4200);
    expect(bloque).toContain('<React.Fragment key={f.claveFicha}>');
  });
});

describe('9/10) turnantes compartidos — costoTurnantePorCargo atribuye por claveFicha, la clave de pool sigue siendo otra (claveGrupoTurnante)', () => {
  it('costoTurnantePorCargo acumula por claveFicha (idAClaveFicha), nunca por nombre de cargo crudo', () => {
    const inicio = PAGE_TSX.indexOf('const costoTurnantePorCargo=React.useMemo(');
    expect(inicio).toBeGreaterThan(-1);
    const bloque = PAGE_TSX.slice(inicio, inicio + 1700);
    expect(bloque).toContain('idAClaveFicha=new Map(detalleLineasMensualUI.map(f=>[String(f.id),f.claveFicha]))');
    // claveFichaManoObra (Cargo+Horario) es DISTINTA de claveGrupoTurnante
    // (calculo-turnantes.ts) — este bloque sigue leyendo el pool por
    // claveGrupo (compatibilidad de turnante), nunca lo confunde con la
    // ficha visual.
    expect(bloque).toContain('l.claveGrupoTurnante===grupo.claveGrupo');
  });

  it('las claves de ficha y de pool de turnantes viven en módulos distintos — nunca se fusionan en una sola función', () => {
    expect(PAGE_TSX).toContain("from '@/lib/costos-mano-obra/horarios/firma-programacion'");
    expect(PAGE_TSX).toContain("from '@/lib/costos-mano-obra/turnantes/calculo-turnantes'");
  });
});

describe('§14.H) EPP/Dotación/Exámenes no se ven afectados — ya se asocian por lineaManoObraId, nunca por nombreCargo', () => {
  it('lineasManoObraDisponibles/lineasManoObraResumen siguen derivando de l.id (lineasExtra), nunca de claveFicha ni de gruposCargoManoObra', () => {
    expect(PAGE_TSX).toContain("const lineasManoObraDisponibles=React.useMemo(()=>[");
    expect(PAGE_TSX).toContain('...lineasExtra.map(l=>({id:l.id,codigo:l.codigo,nombre:l.nombreCargo');
    expect(PAGE_TSX).not.toContain('lineasManoObraDisponibles=React.useMemo(()=>gruposCargoManoObra');
  });

  it('la tarjeta de EPP/Dotación (tarjetaCargo) ya muestra el horario real como subtítulo (formatearResumenSujetoDotEpp) — la ambigüedad visual entre dos cargos homónimos ya estaba resuelta ahí, sin cambios necesarios', () => {
    const inicio = PAGE_TSX.indexOf('const tarjetaCargo=(linea:typeof lineasManoObraDisponibles[number],indice:number)=>{');
    expect(inicio).toBeGreaterThan(-1);
    const bloque = PAGE_TSX.slice(inicio, inicio + 3400);
    expect(bloque).toContain('formatearResumenSujetoDotEpp(linea.cantidadTrabajadores,distribuciones)');
  });
});
