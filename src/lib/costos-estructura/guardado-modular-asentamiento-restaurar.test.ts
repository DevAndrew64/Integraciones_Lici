/**
 * Ajuste "ASENTAMIENTO TRAS RESTAURAR UN COSTEO" — los chulos del stepper de
 * Costos desaparecían de forma intermitente tras abrir un costeo guardado.
 *
 * Causa (medida en vivo con el diagnóstico, aseo/BAQ, proceso RFP 002-2026):
 * la copia base ("baseline") de cada módulo se tomaba en UN solo render tras
 * restaurar, pero los efectos derivados seguían recalculando datos 1-2 s más
 * tarde — p. ej. las cantidades automáticas de Costos Administrativos
 * (`sincronizarCantidadesAutomaticasVariables`, page.tsx) suben 0 → 1 → 2
 * conforme terminan de asentarse Mano de Obra y Turnantes; en la base la
 * Papelería está guardada con cantidad 2. Cada cambio se leía como "cambios
 * sin guardar" y le quitaba el chulo al módulo, según la velocidad de la red.
 *
 * Corrección: mientras el usuario no haya interactuado desde la restauración
 * (y dentro de un tope de 10 s), los cambios de datos se adoptan como nueva
 * base. La regla pura vive en guardado-modular.ts; el cableado en page.tsx.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { restauracionAsentandose, VENTANA_ASENTAMIENTO_TRAS_RESTAURAR_MS } from './guardado-modular';

const PAGE_TSX = readFileSync(join(__dirname, '../../app/page.tsx'), 'utf-8');

function bloque(inicioMarcador: string, finMarcador: string, desde = 0): string {
  const inicio = PAGE_TSX.indexOf(inicioMarcador, desde);
  if (inicio === -1) throw new Error(`No se encontró el marcador de inicio: ${inicioMarcador}`);
  const fin = PAGE_TSX.indexOf(finMarcador, inicio);
  if (fin === -1) throw new Error(`No se encontró el marcador de fin: ${finMarcador}`);
  return PAGE_TSX.slice(inicio, fin);
}

describe('restauracionAsentandose — regla pura', () => {
  const T0 = 1_000_000;
  const hasta = T0 + VENTANA_ASENTAMIENTO_TRAS_RESTAURAR_MS;

  it('el tope de la ventana es de 10 s', () => {
    expect(VENTANA_ASENTAMIENTO_TRAS_RESTAURAR_MS).toBe(10_000);
  });

  it('dentro de la ventana y sin interacción → se está asentando (los cambios se adoptan)', () => {
    expect(restauracionAsentandose({ ahora: T0 + 1, hasta, usuarioInteractuo: false })).toBe(true);
    // los cambios medidos en vivo llegaron a ~0,9 s y ~1,4 s de la restauración
    expect(restauracionAsentandose({ ahora: T0 + 1_400, hasta, usuarioInteractuo: false })).toBe(true);
  });

  it('en cuanto el usuario interactúa deja de asentarse — un cambio posterior SÍ es una edición', () => {
    expect(restauracionAsentandose({ ahora: T0 + 1_400, hasta, usuarioInteractuo: true })).toBe(false);
  });

  it('vencida la ventana deja de asentarse aunque el usuario no haya tocado nada (nunca adopta indefinidamente)', () => {
    expect(restauracionAsentandose({ ahora: hasta, hasta, usuarioInteractuo: false })).toBe(false); // borde exacto: vence
    expect(restauracionAsentandose({ ahora: hasta + 1, hasta, usuarioInteractuo: false })).toBe(false);
    expect(restauracionAsentandose({ ahora: hasta - 1, hasta, usuarioInteractuo: false })).toBe(true);
  });

  it('sin restauración previa (hasta=0) nunca se asienta — un costeo nuevo o un borrador local no se ven afectados', () => {
    expect(restauracionAsentandose({ ahora: T0, hasta: 0, usuarioInteractuo: false })).toBe(false);
  });
});

describe('page.tsx — cableado del asentamiento', () => {
  it('importa la regla pura desde el módulo compartido (no la reimplementa en el JSX)', () => {
    expect(PAGE_TSX).toContain('restauracionAsentandose, VENTANA_ASENTAMIENTO_TRAS_RESTAURAR_MS,');
    expect(PAGE_TSX).toContain("} from '@/lib/costos-estructura/guardado-modular';");
  });

  it('abrirVentanaAsentamientoTrasRestaurar fija el vencimiento con el tope y reinicia "el usuario interactuó"', () => {
    const b = bloque('const abrirVentanaAsentamientoTrasRestaurar=()=>{', '\n  };');
    expect(b).toContain('restauracionAsentandoseHastaRef.current=Date.now()+VENTANA_ASENTAMIENTO_TRAS_RESTAURAR_MS;');
    expect(b).toContain('usuarioInteractuoTrasRestaurarRef.current=false;');
  });

  it('la ventana se abre SOLO al restaurar desde el servidor (verDetallesCosteo y cargarCosteoEmbebido), nunca en un borrador local', () => {
    const bVer = bloque('async function verDetallesCosteo(', '\n  // Recarga la lista cada vez');
    const bEmb = bloque('async function cargarCosteoEmbebido(', '\n  // Dispara la carga automática SOLO en modo embebido');
    for (const b of [bVer, bEmb]) {
      const i = b.indexOf('capturarBaselinesTrasRestaurarRef.current=true;');
      expect(i).toBeGreaterThan(-1);
      expect(b.indexOf('abrirVentanaAsentamientoTrasRestaurar();', i)).toBeGreaterThan(i);
    }
    const bDraft = bloque('const restaurarDraft=()=>{', '\n  const descartarDraft=');
    expect(bDraft).not.toContain('abrirVentanaAsentamientoTrasRestaurar');
    expect(bDraft).not.toContain('capturarBaselinesTrasRestaurarRef');
    expect((PAGE_TSX.match(/abrirVentanaAsentamientoTrasRestaurar\(\);/g) ?? [])).toHaveLength(2);
  });

  it('el efecto que recaptura las bases sigue corriendo mientras dura el asentamiento, no solo en el render de restauración', () => {
    const b = bloque('// Ajuste "ASENTAMIENTO TRAS RESTAURAR UN COSTEO" — además del render de', 'manoObraBaseline.current=JSON.stringify(construirDatosEntradaManoObra());');
    expect(b).toContain('if(!capturarBaselinesTrasRestaurarRef.current&&!restauracionEnAsentamiento())return;');
  });

  it('la base de Resultado (último consumidor de la bandera) también sigue el asentamiento', () => {
    const b = bloque('useEffect(()=>{\n    if(!capturarBaselinesTrasRestaurarRef.current&&!restauracionEnAsentamiento())return;\n    capturarBaselinesTrasRestaurarRef.current=false;'.replace(/\n/g, PAGE_TSX.includes('\r\n') ? '\r\n' : '\n'), 'setHayCambiosSinGuardarResultado(false);');
    expect(b).toContain('resultadoBaseline.current=JSON.stringify(construirDatosEntradaResultado());');
  });

  it('cualquier interacción real cierra la ventana; solo navegar entre pasos del stepper (data-tab-key) no cuenta', () => {
    const b = bloque('const alInteractuar=(e:Event)=>{', '},[]);');
    expect(b).toContain("destino.closest('[data-tab-key]'");
    expect(b).toContain('usuarioInteractuoTrasRestaurarRef.current=true;');
    expect(b).toContain("['pointerdown','keydown','input','change','paste']");
    // captura=true para ver el evento aunque un componente lo detenga; y se limpia al desmontar
    expect(b).toContain('document.addEventListener(ev,alInteractuar,true)');
    expect(b).toContain('document.removeEventListener(ev,alInteractuar,true)');
  });

  it('los pasos del stepper llevan data-tab-key (si se renombra, el filtro anterior dejaría de reconocerlos)', () => {
    expect(PAGE_TSX).toContain('data-tab-key={key}');
  });
});
