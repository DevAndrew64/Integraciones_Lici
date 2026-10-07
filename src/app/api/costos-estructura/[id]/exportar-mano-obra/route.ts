import { NextRequest, NextResponse } from 'next/server';
import path from 'node:path';
import { leerPlantillaExcel, PlantillaExcelNoEncontradaError, cuerpoPlantillaFaltante, RUTA_RELATIVA_PLANTILLA_MANO_OBRA } from '@/lib/costos-mano-obra/exportacion/plantilla-excel';
import { MENSAJE_ERROR_GENERAR_EXCEL } from '@/lib/costos-mano-obra/exportacion/mensajes-exportacion';
import { getSession } from '@/lib/session';
import { requireSession } from '@/lib/authz';
import prisma from '@/lib/prisma';
import { obtenerModulo, resolverModuloManoObraParaRestaurar, resolverDatosEntradaManoObra } from '@/lib/costos-estructura/guardado-modular';
import { validarDtoExportacion } from '@/lib/costos-mano-obra/exportacion/validar-dto-exportacion';
import { generarExcelManoObra, nombreArchivoExportacion } from '@/lib/costos-mano-obra/exportacion/generar-excel-mano-obra';
import type { ExportacionManoObraDto } from '@/lib/costos-mano-obra/exportacion/tipos-exportacion';

// Ajuste "IMPLEMENTAR EXPORTACIÓN DE MANO DE OBRA USANDO EXACTAMENTE LA
// PLANTILLA 'Mano de obra.xlsx'" — deuda arquitectónica documentada (§11
// del ajuste, decisión explícita del usuario): la orquestación canónica de
// Mano de Obra (agrupar por cargo+horario, resolver turnantes, aplicar
// dotación/EPP/exámenes/cursos/vacunas por línea) SOLO existe hoy dentro
// de page.tsx, repartida en más de 15 React.useMemo — no es una función
// invocable desde el servidor sin duplicarla. Por eso esta ruta NO
// recalcula la liquidación laboral: recibe un DTO ya calculado por el
// mismo flujo que alimenta la pantalla (page.tsx) y se limita a:
//   1) autenticar/autorizar, 2) validar identidad+versión contra lo
//   persistido, 3) validar esquema y reconciliaciones aritméticas del
//   DTO, 4) generar el Excel a partir de la plantilla real. Nunca guarda
//   el DTO permanentemente — solo se usa para esta exportación puntual.
// Mejora futura independiente (fuera de alcance aquí): extraer esa
// orquestación a una función pura compartida entre cliente y servidor.
//
// Ajuste "PERMISOS DE COSTOS — EQUIPO COMERCIAL" — deja de exigir
// 'ver_estructura_costos' (permiso de BD reutilizado de la navegación
// standalone): exportar es lectura, sigue el mismo criterio que ya usa
// `GET /api/costos-estructura/[id]` — solo sesión válida. Habilita a
// Mercadeo a exportar sin tocar el permiso de escritura
// (`requireEditarCostos`, sin cambios en este archivo).

const RUTA_PLANTILLA = path.join(process.cwd(), 'data', 'importaciones', 'Mano de obra', 'Mano de obra.xlsx');

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  const denied = requireSession(session);
  if (denied) return denied;

  try {
    const { id } = await ctx.params;
    const dto = (await req.json()) as ExportacionManoObraDto;

    // §5-A — identidad: el id de la ruta debe coincidir con el
    // estructuraCostoId declarado en el DTO (nunca exportar la estructura
    // A usando un DTO construido para la estructura B).
    if (String(dto?.estructuraCostoId) !== String(id)) {
      return NextResponse.json({ ok: false, error: 'estructuraCostoId no coincide con la ruta solicitada.' }, { status: 400 });
    }

    const registro = await prisma.costoEstructura.findUnique({ where: { id: Number(id) } });
    if (!registro) return NextResponse.json({ ok: false, error: 'No encontrado' }, { status: 404 });

    // §2/§5-A — Mano de Obra debe estar guardado, y la versión enviada
    // debe coincidir con la persistida (mismo token de concurrencia que
    // ya usa PUT /api/costos-estructura/[id] — ultimaActualizacion).
    const moduloManoObra = obtenerModulo(registro.datos, 'manoObra') ?? resolverModuloManoObraParaRestaurar(registro.datos);
    if (!moduloManoObra || !moduloManoObra.ultimaActualizacion) {
      return NextResponse.json({ ok: false, error: 'GUARDAR_REQUERIDO', mensaje: 'Guarde los cambios de Mano de Obra antes de generar el archivo Excel.' }, { status: 409 });
    }
    if (dto.ultimaActualizacionManoObra !== moduloManoObra.ultimaActualizacion) {
      return NextResponse.json({ ok: false, error: 'CONFLICTO_CONCURRENCIA', mensaje: 'Mano de Obra fue actualizada desde que se cargó esta pantalla. Recargue antes de exportar.' }, { status: 409 });
    }

    // §5-B/C/D — esquema, límites y reconciliaciones aritméticas del DTO
    // (nunca reconstrucción del motor de liquidación).
    const validacion = validarDtoExportacion(dto);
    if (!validacion.ok) {
      return NextResponse.json({ ok: false, error: 'DTO_INVALIDO', errores: validacion.errores }, { status: 400 });
    }

    // §6 — verificación ligera contra lo persistido, sin reimplementar el
    // motor: el número de fichas de tipo CARGO no puede exceder el número
    // de líneas de Mano de Obra realmente guardadas (lineasExtra). Esto
    // detecta una ficha inventada/ajena sin necesitar recalcular nada.
    //
    // Ajuste "TENEMOS UN ERROR EN LA EXPORTACIÓN MULTIFICHAS: DTO_INVALIDO"
    // — la comparación equivalente para TURNANTE contra `cargosTurnantes`
    // (registros persistidos) se retiró: a diferencia de CARGO, los GRUPOS
    // de necesidad de turnante (gruposNecesidadTurnantes/
    // gruposTurnantesManoObra en page.tsx) se recalculan en cada render a
    // partir de la programación de `lineasExtra` — no son 1:1 con
    // `cargosTurnantes` (que solo guarda las líneas "automáticas" de
    // bloque-42/remanente-21 ya materializadas). Comparar contra
    // `cargosTurnantes.length` rechazaba exportaciones legítimas de varios
    // grupos de turnante detectados en pantalla que aún no tenían esa
    // misma cantidad de líneas materializadas. Cada grupo de turnante SÍ
    // cubre siempre al menos una `lineaExtra` real, así que el límite
    // estructuralmente válido (sin recalcular el motor) es el mismo total
    // de `lineasExtra` guardadas.
    const datosEntrada = resolverDatosEntradaManoObra(moduloManoObra);
    const lineasExtra = Array.isArray(datosEntrada.lineasExtra) ? datosEntrada.lineasExtra : [];
    const fichasCargo = dto.fichas.filter(f => f.tipo === 'CARGO').length;
    const fichasTurnante = dto.fichas.filter(f => f.tipo === 'TURNANTE').length;
    if (fichasCargo > lineasExtra.length) {
      return NextResponse.json({ ok: false, error: 'FICHA_NO_RECONOCIDA', mensaje: 'El DTO incluye más fichas de cargo que las líneas guardadas de Mano de Obra.' }, { status: 400 });
    }
    if (fichasTurnante > lineasExtra.length) {
      return NextResponse.json({ ok: false, error: 'FICHA_NO_RECONOCIDA', mensaje: 'El DTO incluye más fichas de turnante que líneas de Mano de Obra guardadas.' }, { status: 400 });
    }

    const bufferPlantilla = await leerPlantillaExcel(RUTA_PLANTILLA, RUTA_RELATIVA_PLANTILLA_MANO_OBRA);
    const excelBuffer = await generarExcelManoObra({ bufferPlantilla, fichas: dto.fichas });
    const nombreArchivo = nombreArchivoExportacion(dto.numeroProceso || String(dto.procesoId));

    return new NextResponse(new Uint8Array(excelBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${nombreArchivo}"`,
      },
    });
  } catch (e) {
    console.error('[POST /api/costos-estructura/[id]/exportar-mano-obra]', e);
    if (e instanceof PlantillaExcelNoEncontradaError) return NextResponse.json(cuerpoPlantillaFaltante(e), { status: 500 });
    return NextResponse.json({ ok: false, error: 'ERROR_GENERAR_EXCEL', mensaje: MENSAJE_ERROR_GENERAR_EXCEL }, { status: 500 });
  }
}
