import { NextRequest, NextResponse } from 'next/server';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { leerPlantillaExcel, PlantillaExcelNoEncontradaError, cuerpoPlantillaFaltante, RUTA_RELATIVA_PLANTILLA_MANO_OBRA } from '@/lib/costos-mano-obra/exportacion/plantilla-excel';
import { MENSAJE_ERROR_GENERAR_EXCEL } from '@/lib/costos-mano-obra/exportacion/mensajes-exportacion';
import { getSession } from '@/lib/session';
import { requireSession } from '@/lib/authz';
import prisma from '@/lib/prisma';
import {
  obtenerModulo, resolverPendientesModulos, CLAVES_MODULO_NO_APLICA,
  resolverModuloManoObraParaRestaurar, resolverDatosEntradaManoObra,
} from '@/lib/costos-estructura/guardado-modular';
import type { ClaveModulo, EstadoModuloResultado } from '@/lib/costos-estructura/guardado-modular';
import { validarDtoExportacion } from '@/lib/costos-mano-obra/exportacion/validar-dto-exportacion';
import { poblarHojaManoObra, nombreArchivoExportacion } from '@/lib/costos-mano-obra/exportacion/generar-excel-mano-obra';
import type { ExportacionManoObraDto } from '@/lib/costos-mano-obra/exportacion/tipos-exportacion';
import { escribirHojaResumen } from '@/lib/costos-estructura/exportacion/resumen';
import { escribirHojaDotacionEpp } from '@/lib/costos-estructura/exportacion/dotacion-epp';
import { escribirHojaExamenesMedicos } from '@/lib/costos-estructura/exportacion/examenes-medicos';
import { escribirHojaInsumos } from '@/lib/costos-estructura/exportacion/insumos';
import { escribirHojaMaquinaria } from '@/lib/costos-estructura/exportacion/maquinaria';
import { escribirHojaCostosAdministrativos } from '@/lib/costos-estructura/exportacion/costos-administrativos';
import { validarCostosPantallaDto } from '@/lib/costos-estructura/exportacion/costos-pantalla';
import type { CostosPantallaDto } from '@/lib/costos-estructura/exportacion/costos-pantalla';
import { escribirHojaResultado } from '@/lib/costos-estructura/exportacion/resultado';

const RUTA_PLANTILLA = path.join(process.cwd(), 'data', 'importaciones', 'Mano de obra', 'Mano de obra.xlsx');

interface BodyExportar {
  manoObraDto: ExportacionManoObraDto;
  /** Valores que la pantalla ya calculó (panel + pestañas); el servidor solo los escribe. */
  costosDto: CostosPantallaDto;
}

/**
 * Ajuste "EXPORTAR COSTOS — EXCEL GENERAL CON TODAS LAS PESTAÑAS"
 * (reemplaza el flujo legacy de `guardarCosteo()`/`POST /api/costos-estructura`,
 * que creaba un `CostoEstructura` plano y duplicado sin generar ningún
 * archivo). Este endpoint es de SOLO LECTURA/EXPORTACIÓN — nunca crea,
 * actualiza ni elimina ningún registro.
 *
 * Ajuste "PERMISOS DE COSTOS — EQUIPO COMERCIAL" — deja de exigir el
 * permiso de BD 'ver_estructura_costos' (reutilizado de la navegación
 * standalone): exportar es lectura, no mutación, así que sigue el MISMO
 * criterio que ya usa `GET /api/costos-estructura/[id]` (que trae los mismos
 * datos) — solo sesión válida. Esto habilita a Mercadeo (que ya podía leer
 * estos datos vía GET) a exportarlos también, sin tocar el permiso de
 * escritura (`requireEditarCostos`, sin cambios en este archivo). Deuda
 * técnica documentada y fuera de alcance de este ajuste: ni este endpoint
 * ni el GET validan pertenencia de la CostoEstructura a una Solicitud/ficha
 * concreta (no existe ese vínculo en el modelo hoy).
 *
 * Orden: 1) sesión, 2) cargar estructura persistida, 3) validar
 * completitud de los 4 módulos con NO_APLICA (fuente de verdad server-side,
 * `resolverPendientesModulos`+`CLAVES_MODULO_NO_APLICA`, nunca confía en lo
 * que diga el navegador), 4) validar identidad/versión/esquema del DTO de
 * Mano de Obra (mismo criterio que `exportar-mano-obra`: esa liquidación solo
 * existe calculada en el navegador — ver `generar-excel-mano-obra.ts`),
 * 5) validar `costosDto`, 6) cargar la plantilla real y delegar el llenado
 * de cada hoja a su propio helper puro, 7) devolver el XLSX.
 *
 * Principio (decisión del usuario 2026-10-02): "lo correcto es lo que el
 * usuario puede ver". Los totales y las filas de EPP, Exámenes y Costos
 * Administrativos NO se recalculan en el servidor — el navegador manda en
 * `costosDto` lo que ya calculó y muestra, y aquí solo se escribe. Así no
 * existen dos calculadoras que puedan dar valores distintos.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  const denied = requireSession(session);
  if (denied) return denied;

  try {
    const { id } = await ctx.params;
    const registro = await prisma.costoEstructura.findUnique({ where: { id: Number(id) } });
    if (!registro) return NextResponse.json({ ok: false, error: 'No encontrado' }, { status: 404 });

    // Fuente de verdad server-side — nunca confía en un "todo completo" enviado por el cliente.
    const estados: Partial<Record<ClaveModulo, EstadoModuloResultado>> = {};
    for (const clave of CLAVES_MODULO_NO_APLICA) {
      estados[clave] = obtenerModulo(registro.datos, clave)?.estado;
    }
    const { completo, pendientes } = resolverPendientesModulos(estados, CLAVES_MODULO_NO_APLICA);
    if (!completo) {
      return NextResponse.json(
        { ok: false, error: 'Existen módulos de costos pendientes por definir.', pendientes },
        { status: 409 },
      );
    }

    const body = (await req.json()) as BodyExportar;
    const dto = body?.manoObraDto;
    if (!dto || String(dto.estructuraCostoId) !== String(id)) {
      return NextResponse.json({ ok: false, error: 'estructuraCostoId no coincide con la ruta solicitada.' }, { status: 400 });
    }
    const moduloManoObra = obtenerModulo(registro.datos, 'manoObra') ?? resolverModuloManoObraParaRestaurar(registro.datos);
    if (!moduloManoObra || !moduloManoObra.ultimaActualizacion) {
      return NextResponse.json({ ok: false, error: 'GUARDAR_REQUERIDO', mensaje: 'Guarde los cambios de Mano de Obra antes de generar el archivo Excel.' }, { status: 409 });
    }
    if (dto.ultimaActualizacionManoObra !== moduloManoObra.ultimaActualizacion) {
      return NextResponse.json({ ok: false, error: 'CONFLICTO_CONCURRENCIA', mensaje: 'Mano de Obra fue actualizada desde que se cargó esta pantalla. Recargue antes de exportar.' }, { status: 409 });
    }
    const validacion = validarDtoExportacion(dto);
    if (!validacion.ok) {
      return NextResponse.json({ ok: false, error: 'DTO_INVALIDO', errores: validacion.errores }, { status: 400 });
    }
    const datosEntrada = resolverDatosEntradaManoObra(moduloManoObra);
    const lineasExtra = Array.isArray(datosEntrada.lineasExtra) ? datosEntrada.lineasExtra : [];
    const fichasCargo = dto.fichas.filter((f) => f.tipo === 'CARGO').length;
    const fichasTurnante = dto.fichas.filter((f) => f.tipo === 'TURNANTE').length;
    if (fichasCargo > lineasExtra.length || fichasTurnante > lineasExtra.length) {
      return NextResponse.json({ ok: false, error: 'FICHA_NO_RECONOCIDA', mensaje: 'El DTO incluye más fichas que las líneas guardadas de Mano de Obra.' }, { status: 400 });
    }

    // Los valores de Mano de Obra, EPP, Exámenes y Costos Administrativos NO se
    // recalculan aquí: llegan en `costosDto`, tal como los calculó y muestra la
    // pantalla. Solo se valida su forma y que las sumas del propio JSON cuadren.
    const validacionCostos = validarCostosPantallaDto(body?.costosDto);
    if (!validacionCostos.ok) {
      return NextResponse.json({ ok: false, error: 'COSTOS_DTO_INVALIDO', errores: validacionCostos.errores }, { status: 400 });
    }
    const costos = body.costosDto;

    // De lo guardado solo se toma el ESTADO de cada módulo (para el banner de
    // "No aplica" y el Resumen); todos los valores salen de `costosDto`.
    const moduloDotacionEpp = obtenerModulo(registro.datos, 'dotacionEpp');
    const moduloExamenes = obtenerModulo(registro.datos, 'examenesMedicos');
    const moduloInsumos = obtenerModulo(registro.datos, 'insumos');
    const moduloMaquinaria = obtenerModulo(registro.datos, 'maquinariaEquipos');

    const bufferPlantilla = await leerPlantillaExcel(RUTA_PLANTILLA, RUTA_RELATIVA_PLANTILLA_MANO_OBRA);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bufferPlantilla as unknown as ExcelJS.Buffer);
    poblarHojaManoObra(wb, dto.fichas);

    escribirHojaResumen(wb, {
      procesoCodigo: registro.procesoCodigo, procesoNombre: registro.procesoNombre, cargos: costos.cargos,
      nTrabajadores: costos.nTrabajadores, totales: costos.totales, estados,
    });
    escribirHojaDotacionEpp(wb, { estado: moduloDotacionEpp?.estado ?? 'NO_INICIADO', cargos: costos.dotacionEpp.cargos, total: costos.dotacionEpp.total });
    escribirHojaExamenesMedicos(wb, { estado: moduloExamenes?.estado ?? 'NO_INICIADO', cargos: costos.examenes.cargos, total: costos.examenes.total });
    escribirHojaInsumos(wb, { estado: moduloInsumos?.estado ?? 'NO_INICIADO', filas: costos.insumos.filas, total: costos.insumos.total });
    escribirHojaMaquinaria(wb, { estado: moduloMaquinaria?.estado ?? 'NO_INICIADO', ...costos.maquinaria, total: costos.totales.maquinaria });
    escribirHojaCostosAdministrativos(wb, { ...costos.administrativos, total: costos.totales.administrativos });
    escribirHojaResultado(wb, { totales: costos.totales, administrativos: costos.administrativos });

    // Orden final de pestañas (§2 del ajuste "REVISIÓN FUNCIONAL FINAL") —
    // `orderNo` es una propiedad PÚBLICA de ExcelJS que solo controla el
    // orden de las pestañas al escribir el archivo (`workbook.worksheets`
    // las ordena por este campo antes de serializar) — nunca toca
    // celdas/fórmulas/estilos/merges/área de impresión de ninguna hoja
    // (confirmado: Mano de Obra conserva sus 94 fórmulas, sus 68 merges y
    // su área de impresión exactamente igual con y sin este reordenamiento).
    const ordenFinalHojas = ['Resumen', 'Mano de Obra', 'EPP y Dotación', 'Exámenes Médicos', 'Insumos', 'Maquinaria y Equipos', 'Costos Administrativos', 'Resultado'];
    ordenFinalHojas.forEach((nombre, indice) => {
      const hoja = wb.getWorksheet(nombre) as (ExcelJS.Worksheet & { orderNo: number }) | undefined;
      if (hoja) hoja.orderNo = indice;
    });

    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    const nombreArchivo = `Estructura_Costos_${nombreArchivoExportacion(dto.numeroProceso).replace('Mano_de_Obra_', '')}`;

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${nombreArchivo}"`,
      },
    });
  } catch (e) {
    console.error('[POST /api/costos-estructura/[id]/exportar]', e);
    if (e instanceof PlantillaExcelNoEncontradaError) return NextResponse.json(cuerpoPlantillaFaltante(e), { status: 500 });
    return NextResponse.json({ ok: false, error: 'ERROR_GENERAR_EXCEL', mensaje: MENSAJE_ERROR_GENERAR_EXCEL }, { status: 500 });
  }
}
