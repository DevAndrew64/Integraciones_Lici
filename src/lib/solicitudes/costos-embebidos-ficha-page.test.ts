/**
 * Ajuste "COSTOS COMPLETOS DENTRO DE LA MISMA FICHA" + "COSTOS SOLO DESDE
 * 'EN EJECUCIÓN' EN ADELANTE" — verificación de cableado en page.tsx:
 * `ModuloEstructuraCostos` se reutiliza EXACTAMENTE igual en el módulo
 * standalone y en `VistFichaAsignacion` (pestaña "Costos"), nunca una
 * segunda implementación ni un `CostoEstructura` paralelo; la pestaña
 * "Costos" solo aparece desde `puedeMostrarCostosEnFicha` (En ejecución/En
 * evaluación/Cerrado), nunca antes; "Requisitos" se retira de la
 * navegación exactamente en el mismo momento (misma fuente), sin borrar su
 * ruta/lógica.
 *
 * No existe arnés de render de componentes para page.tsx (~38.000 líneas,
 * sin jsdom/RTL en este proyecto) — mismo patrón de verificación de TEXTO
 * exacto del código fuente ya usado en el resto de *-page.test.ts.
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

const BLOQUE_VIST_FICHA_ASIGNACION = bloque(
  "function VistFichaAsignacion({sol,sesion,onVolver,onGuardado,onModuleChange=()=>{}}:",
  '\n/* =========================================================\n   MÓDULO PROCESOS POR VALIDAR',
);

const BLOQUE_MODULO_COSTOS = bloque(
  'function ModuloEstructuraCostos({sesion,modoEmbebido=false,solicitudIdEmbebida}:',
  '\nfunction Placeholder({nombre}',
);

describe('VistFichaAsignacion — la pestaña "Costos" nace de la misma fuente que oculta "Requisitos" (nunca dos reglas separadas)', () => {
  it('costosElegible usa puedeMostrarCostosEnFicha(estadoGlobalCanonico) — nunca una regla local reimplementada', () => {
    expect(BLOQUE_VIST_FICHA_ASIGNACION).toContain('const costosElegible = puedeMostrarCostosEnFicha(estadoGlobalCanonico);');
    expect(PAGE_TSX).toContain('puedeMostrarCostosEnFicha');
    expect(PAGE_TSX).toMatch(/from '@\/lib\/solicitudes\/estados-canonicos'/);
  });

  it('TABS incluye "Costos" AL FINAL y excluye "Requisitos" cuando costosElegible es true', () => {
    expect(BLOQUE_VIST_FICHA_ASIGNACION).toContain(
      "?[['Resumen','resumen'],['Cronograma','cronograma'],['Documentación','documentacion'],['Adendas','adendas'],['Costos','costos']]",
    );
  });

  it('TABS incluye "Requisitos" y NUNCA "Costos" cuando costosElegible es false (comportamiento histórico intacto)', () => {
    expect(BLOQUE_VIST_FICHA_ASIGNACION).toContain(
      ":[['Resumen','resumen'],['Requisitos','requisitos'],['Cronograma','cronograma'],['Documentación','documentacion'],['Adendas','adendas']];",
    );
  });

  it('Requisitos nunca se borra: la ruta/contenido `tabActiva===\'requisitos\'` sigue existiendo en el código, solo deja de listarse en TABS', () => {
    expect(BLOQUE_VIST_FICHA_ASIGNACION).toContain("tabActiva==='requisitos'&&(");
  });

  it('protección contra URL/estado manipulado: un efecto resetea tabActiva a "resumen" si "costos" ya no es elegible, o si "requisitos" ya no debería mostrarse', () => {
    const b = bloque("if(tabActiva==='costos'&&!costosElegible)setTabActiva('resumen');", '},[tabActiva,costosElegible]);', PAGE_TSX.indexOf(BLOQUE_VIST_FICHA_ASIGNACION.slice(0, 50)));
    expect(b).toContain("if(tabActiva==='requisitos'&&costosElegible)setTabActiva('resumen');");
  });
});

describe('VistFichaAsignacion — clic en "Costos" NUNCA redirige, reemplaza el contenido normal de la ficha', () => {
  it('el contenido de "Costos" usa setTabActiva (navegación interna), nunca router.push/onModuleChange/window.location', () => {
    const inicioTabsMap = BLOQUE_VIST_FICHA_ASIGNACION.indexOf('{TABS.map(([label,key])=>(');
    const finTabsMap = BLOQUE_VIST_FICHA_ASIGNACION.indexOf('))}', inicioTabsMap);
    const bloqueBotones = BLOQUE_VIST_FICHA_ASIGNACION.slice(inicioTabsMap, finTabsMap);
    expect(bloqueBotones).toContain('onClick={()=>setTabActiva(key as typeof tabActiva)}');
    expect(bloqueBotones).not.toContain('router.push');
    expect(bloqueBotones).not.toContain('window.location');
  });

  it('cuando tabActiva es "costos", se reemplaza TODO el contenido normal de la ficha (grilla de 2 columnas) por el módulo de Costos a ancho completo — nunca "Resumen + Costos debajo"', () => {
    expect(BLOQUE_VIST_FICHA_ASIGNACION).toContain("tabActiva==='costos'&&costosElegible?(");
    const inicio = BLOQUE_VIST_FICHA_ASIGNACION.indexOf("tabActiva==='costos'&&costosElegible?(");
    const fin = BLOQUE_VIST_FICHA_ASIGNACION.indexOf('):(', inicio);
    const ramaCostos = BLOQUE_VIST_FICHA_ASIGNACION.slice(inicio, fin);
    expect(ramaCostos).toContain('<ModuloEstructuraCostos sesion={sesion} modoEmbebido solicitudIdEmbebida={solLocal.id}/>');
    // La rama de costos no incluye la grilla de 2 columnas (Responsables/acciones/cierre).
    expect(ramaCostos).not.toContain("gridTemplateColumns:'1fr 280px'");
  });

  it('el `solicitudIdEmbebida` viene de `solLocal.id` (el mismo id de Solicitud que gobierna el resto de la ficha), nunca un id distinto o inventado', () => {
    expect(BLOQUE_VIST_FICHA_ASIGNACION).toContain('solicitudIdEmbebida={solLocal.id}');
  });
});

describe('ModuloEstructuraCostos — reutilizado EXACTAMENTE igual por standalone y por la ficha (nunca una segunda implementación)', () => {
  it('el módulo standalone (case \'estructuraDeCostos\') sigue invocando el MISMO componente, sin props embebidos — comportamiento intacto', () => {
    expect(PAGE_TSX).toContain("case 'estructuraDeCostos': return <ModuloEstructuraCostos key={rk('estructuraDeCostos')} sesion={sesion}/>;");
  });

  it('no existe un segundo componente/tipo paralelo ("CostoEstructuraFicha"/"EstructuraCostosProceso"/motor duplicado)', () => {
    expect(PAGE_TSX).not.toMatch(/function\s+CostoEstructuraFicha/);
    expect(PAGE_TSX).not.toMatch(/function\s+EstructuraCostosProceso/);
    expect((PAGE_TSX.match(/function ModuloEstructuraCostos\(/g) ?? []).length).toBe(1);
  });

  it('modoEmbebido/solicitudIdEmbebida son props ADITIVAS con default seguro (el standalone, sin pasarlas, se comporta como antes)', () => {
    expect(BLOQUE_MODULO_COSTOS).toContain('modoEmbebido=false');
  });

  it('en modo embebido se oculta la barra de información (Estado/Presupuesto/Empresa/No. Proceso) — nunca se repite el contexto que ya muestra la ficha', () => {
    const inicio = BLOQUE_MODULO_COSTOS.indexOf('{!modoEmbebido&&(\n              <div style={{padding:\'10px 16px\'');
    expect(inicio).toBeGreaterThan(-1);
    const finLabelNoProceso = BLOQUE_MODULO_COSTOS.indexOf('label="No. Proceso"', inicio);
    expect(finLabelNoProceso).toBeGreaterThan(inicio);
    const bloqueInfo = BLOQUE_MODULO_COSTOS.slice(inicio, finLabelNoProceso + 40);
    expect(bloqueInfo).toContain('label="Estado"');
    expect(bloqueInfo).toContain('label="Presupuesto"');
    expect(bloqueInfo).toContain('label="Empresa"');
  });

  it('en modo embebido se oculta el botón "Volver" interno (cambiar de proceso no aplica: el proceso lo fija la ficha)', () => {
    expect(BLOQUE_MODULO_COSTOS).toContain('{!modoEmbebido&&(\n                <button onClick={()=>intentarNavegarFueraDeManoObra(()=>{setSolicitudProceso(null);setModalProcesoAbierto(true);})}');
  });

  it('las tabs internas de Costos (ahora un stepper) quedan en una sola línea con scroll horizontal (overflowX:auto+flexWrap:nowrap) — mismo bloque para standalone y embebido, nunca duplicado', () => {
    expect(BLOQUE_MODULO_COSTOS).toContain("flexWrap:'nowrap' as const,overflowX:'auto' as const");
    expect((BLOQUE_MODULO_COSTOS.match(/\{TABS\.map\(\(t,i\)=>\{/g) ?? []).length).toBe(1);
  });

  it('Exportar costos sigue siendo la misma función `exportarCostos` (sin una variante "exportarCostosDesdeFicha")', () => {
    expect(PAGE_TSX).toContain('async function exportarCostos(){');
    expect(PAGE_TSX).not.toMatch(/function\s+exportarCostosDesdeFicha/);
    expect(BLOQUE_MODULO_COSTOS).toContain('onClick={exportarCostos}');
  });
});

describe('ModuloEstructuraCostos — auto-selección del proceso en modo embebido, mismo CostoEstructura, nunca duplicado', () => {
  it('cargarCosteoEmbebido reutiliza seleccionarSolicitudProceso (mismo fetch /api/solicitudes/{id}) — nunca un segundo camino de carga de la Solicitud', () => {
    const b = bloque('async function cargarCosteoEmbebido(id:number){', '\n  // Dispara la carga automática', PAGE_TSX.indexOf('function ModuloEstructuraCostos('));
    expect(b).toContain('const resultado=await seleccionarSolicitudProceso(id);');
  });

  it('cargarCosteoEmbebido busca el CostoEstructura EXISTENTE por procesoCodigo (registrosPorCodigo) antes de conformarse con un costeo en blanco — nunca crea un duplicado a ciegas', () => {
    const b = bloque('async function cargarCosteoEmbebido(id:number){', '\n  // Dispara la carga automática', PAGE_TSX.indexOf('function ModuloEstructuraCostos('));
    expect(b).toContain('const regId=registrosPorCodigo[codigoProceso];');
    expect(b).toContain("fetch('/api/costos-estructura/'+regId)");
    expect(b).toContain('setCostoEstructuraIdActual(regId);');
    expect(b).toContain('aplicarDatosGuardados(d.registro.datos);');
    expect(b).not.toContain("method:'POST'"); // nunca crea aquí — solo lee/reutiliza
  });

  it('la auto-selección espera a `registrosPorCodigoCargado` antes de decidir "existe/no existe costeo previo" — evita la condición de carrera que crearía un CostoEstructura duplicado', () => {
    const b = bloque('useEffect(()=>{\n    if(!modoEmbebido||solicitudIdEmbebida==null', '},[modoEmbebido,solicitudIdEmbebida,registrosPorCodigoCargado]);', PAGE_TSX.indexOf('function ModuloEstructuraCostos('));
    expect(b).toContain('!registrosPorCodigoCargado');
    expect(b).toContain('cargarCosteoEmbebido(solicitudIdEmbebida);');
  });

  it('registrosPorCodigoCargado se marca true al terminar el fetch de /api/costos-estructura (éxito o error) — nunca se queda colgado en falso', () => {
    const b = bloque("fetch('/api/costos-estructura').then(r=>r.json()).then(d=>{", '},[]);', PAGE_TSX.indexOf('function ModuloEstructuraCostos('));
    expect(b).toContain('.finally(()=>setRegistrosPorCodigoCargado(true))');
  });

  it('modo standalone nunca dispara la carga automática (modalProcesoAbierto arranca en true, igual que antes, para poder listar procesos)', () => {
    expect(BLOQUE_MODULO_COSTOS).toContain('useState(!modoEmbebido)');
  });
});
