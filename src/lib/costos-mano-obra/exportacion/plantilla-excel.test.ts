/**
 * Ajuste "EXPORTAR SIN LA PLANTILLA" — `data/importaciones/` está en
 * .gitignore y nunca se versionó, así que un equipo sin esa carpeta recibía
 * un 500 genérico al exportar. Aquí se prueba, con archivos reales en una
 * carpeta temporal, que "falta el archivo" se distingue de cualquier otro
 * error de disco y que el mensaje es accionable.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import {
  leerPlantillaExcel, PlantillaExcelNoEncontradaError, cuerpoPlantillaFaltante, RUTA_RELATIVA_PLANTILLA_MANO_OBRA,
} from './plantilla-excel';
import { MENSAJE_ERROR_GENERAR_EXCEL } from './mensajes-exportacion';

let dir: string;
beforeAll(async () => { dir = await mkdtemp(join(tmpdir(), 'plantilla-excel-')); });
afterAll(async () => { await rm(dir, { recursive: true, force: true }); });

describe('leerPlantillaExcel', () => {
  it('devuelve el contenido del archivo cuando existe', async () => {
    const ruta = join(dir, 'existe.xlsx');
    await writeFile(ruta, Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    const buf = await leerPlantillaExcel(ruta, 'data/importaciones/x.xlsx');
    expect([...buf]).toEqual([0x50, 0x4b, 0x03, 0x04]);
  });

  it('archivo inexistente → PlantillaExcelNoEncontradaError con la ruta RELATIVA (nunca la absoluta del servidor)', async () => {
    const err = await leerPlantillaExcel(join(dir, 'no-existe.xlsx'), RUTA_RELATIVA_PLANTILLA_MANO_OBRA).catch(e => e);
    expect(err).toBeInstanceOf(PlantillaExcelNoEncontradaError);
    expect(err.codigo).toBe('PLANTILLA_NO_ENCONTRADA');
    expect(err.rutaRelativa).toBe('data/importaciones/Mano de obra/Mano de obra.xlsx');
    expect(err.message).not.toContain(dir);
  });

  it('carpeta padre inexistente (caso real: no existe data/) también cuenta como plantilla faltante', async () => {
    const err = await leerPlantillaExcel(join(dir, 'data', 'importaciones', 'Mano de obra', 'Mano de obra.xlsx'), RUTA_RELATIVA_PLANTILLA_MANO_OBRA).catch(e => e);
    expect(err).toBeInstanceOf(PlantillaExcelNoEncontradaError);
  });

  it('cualquier OTRO error de disco se propaga tal cual (no se disfraza de "falta la plantilla")', async () => {
    const carpeta = join(dir, 'es-carpeta');
    await mkdir(carpeta);
    const err = await leerPlantillaExcel(carpeta, 'data/importaciones/x.xlsx').catch(e => e);
    expect(err).not.toBeInstanceOf(PlantillaExcelNoEncontradaError);
    expect((err as NodeJS.ErrnoException).code).toBe('EISDIR');
  });
});

describe('cuerpoPlantillaFaltante — lo que ve el usuario cuando falta la plantilla', () => {
  const cuerpo = cuerpoPlantillaFaltante(new PlantillaExcelNoEncontradaError(RUTA_RELATIVA_PLANTILLA_MANO_OBRA));

  it('es un error de generación como cualquier otro: mensaje genérico "ocurrió un error" (pedido del usuario), con un código corto para soporte', () => {
    expect(cuerpo.ok).toBe(false);
    expect(cuerpo.error).toBe('PLANTILLA_NO_ENCONTRADA');
    expect(cuerpo.mensaje).toBe(MENSAJE_ERROR_GENERAR_EXCEL);
    expect(cuerpo.mensaje).toMatch(/^Ocurrió un error/);
  });

  it('NO expone al usuario qué archivo falta ni dónde ponerlo (ese detalle queda en el log del servidor, en el mensaje del error)', () => {
    const texto = JSON.stringify(cuerpo);
    expect(texto).not.toContain('plantilla');
    expect(texto).not.toContain('.xlsx');
    expect(texto).not.toContain('data/importaciones');
    expect(new PlantillaExcelNoEncontradaError(RUTA_RELATIVA_PLANTILLA_MANO_OBRA).message).toContain('data/importaciones/Mano de obra/Mano de obra.xlsx');
  });
});

describe('wiring — ambos routes de export usan el mismo helper (ninguno lee la plantilla por su cuenta)', () => {
  const RUTAS = [
    '../../../app/api/costos-estructura/[id]/exportar/route.ts',
    '../../../app/api/costos-estructura/[id]/exportar-mano-obra/route.ts',
  ];
  for (const ruta of RUTAS) {
    it(ruta, () => {
      const src = readFileSync(join(__dirname, ruta), 'utf-8');
      expect(src).toContain('leerPlantillaExcel(RUTA_PLANTILLA, RUTA_RELATIVA_PLANTILLA_MANO_OBRA)');
      expect(src).not.toContain('readFile(');
      expect(src).toContain('if (e instanceof PlantillaExcelNoEncontradaError) return NextResponse.json(cuerpoPlantillaFaltante(e), { status: 500 });');
    });
  }
});
