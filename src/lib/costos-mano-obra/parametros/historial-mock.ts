/**
 * Historial en memoria — mock controlado (§14: "historial en memoria o
 * mock controlado" para esta primera entrega). Nunca sobreescribe ni
 * borra: "restaurar valor normativo" cierra el perfil empresarial vigente
 * (`fechaFinal`) en vez de eliminarlo, y toda acción queda además en la
 * auditoría. No usa Prisma ni ninguna tabla real — se pierde al reiniciar
 * el proceso, tal como se pidió para este prototipo aislado.
 */
import type {
  PerfilEmpresarialParametro,
  AjusteProcesoParametro,
  EntradaAuditoriaParametros,
  AccionAuditoria,
  RolParametros,
} from './tipos';

let perfilesEmpresariales: PerfilEmpresarialParametro[] = [];
let ajustesProceso: AjusteProcesoParametro[] = [];
let auditoria: EntradaAuditoriaParametros[] = [];
let contador = 0;

function siguienteId(prefijo: string): string {
  contador += 1;
  return `${prefijo}-${contador}`;
}

function registrarAuditoria(
  accion: AccionAuditoria,
  parametroId: string,
  usuario: string,
  rol: RolParametros,
  detalle: string,
): void {
  auditoria.push({
    id: siguienteId('aud'),
    accion,
    parametroId,
    usuario,
    rol,
    fecha: new Date().toISOString(),
    detalle,
  });
}

export interface EntradaPerfilEmpresarial {
  parametroId: string;
  empresa: string;
  valorAplicado: number;
  fechaInicial: string;
  motivo: string;
  creadoPor: string;
  rol: RolParametros;
  aprobadoPor?: string | null;
  referenciaPerfilNormativoId?: string | null;
}

/** Crea un perfil empresarial nuevo — nunca reemplaza uno existente, solo
 * agrega (el resolver, no este módulo, decide cuál está vigente por fecha). */
export function crearPerfilEmpresarial(entrada: EntradaPerfilEmpresarial): PerfilEmpresarialParametro {
  const perfil: PerfilEmpresarialParametro = {
    id: siguienteId('pe'),
    parametroId: entrada.parametroId,
    empresa: entrada.empresa,
    valorAplicado: entrada.valorAplicado,
    fechaInicial: entrada.fechaInicial,
    fechaFinal: null,
    motivo: entrada.motivo,
    creadoPor: entrada.creadoPor,
    aprobadoPor: entrada.aprobadoPor ?? null,
    referenciaPerfilNormativoId: entrada.referenciaPerfilNormativoId ?? null,
    creadoEn: new Date().toISOString(),
  };
  perfilesEmpresariales.push(perfil);
  registrarAuditoria(
    'CREAR_AJUSTE_EMPRESARIAL',
    entrada.parametroId,
    entrada.creadoPor,
    entrada.rol,
    `Ajuste empresarial creado para ${entrada.empresa}: valor=${entrada.valorAplicado}. Motivo: ${entrada.motivo}`,
  );
  return perfil;
}

export interface EntradaAjusteProceso {
  parametroId: string;
  procesoId: string;
  valorAplicado: number;
  motivo: string;
  responsable: string;
  rol: RolParametros;
}

export function crearAjusteProceso(entrada: EntradaAjusteProceso): AjusteProcesoParametro {
  const ajuste: AjusteProcesoParametro = {
    id: siguienteId('ap'),
    parametroId: entrada.parametroId,
    procesoId: entrada.procesoId,
    valorAplicado: entrada.valorAplicado,
    motivo: entrada.motivo,
    responsable: entrada.responsable,
    creadoEn: new Date().toISOString(),
  };
  ajustesProceso.push(ajuste);
  registrarAuditoria(
    'CREAR_AJUSTE_PROCESO',
    entrada.parametroId,
    entrada.responsable,
    entrada.rol,
    `Ajuste de proceso creado para proceso ${entrada.procesoId}: valor=${entrada.valorAplicado}. Motivo: ${entrada.motivo}`,
  );
  return ajuste;
}

/** "Restaurar valor normativo" — nunca borra el perfil empresarial, lo
 * cierra (fechaFinal) para que el resolver deje de aplicarlo desde ahora. */
export function restaurarValorNormativo(
  parametroId: string,
  empresa: string,
  usuario: string,
  rol: RolParametros,
): PerfilEmpresarialParametro[] {
  const ahora = new Date().toISOString();
  const cerrados: PerfilEmpresarialParametro[] = [];
  perfilesEmpresariales = perfilesEmpresariales.map((p) => {
    if (p.parametroId === parametroId && p.empresa === empresa && p.fechaFinal == null) {
      const cerrado = { ...p, fechaFinal: ahora };
      cerrados.push(cerrado);
      return cerrado;
    }
    return p;
  });
  if (cerrados.length > 0) {
    registrarAuditoria(
      'RESTAURAR_VALOR_NORMATIVO',
      parametroId,
      usuario,
      rol,
      `Perfil(es) empresarial(es) de ${empresa} cerrado(s); el resolver vuelve a aplicar el perfil normativo vigente.`,
    );
  }
  return cerrados;
}

export function listarPerfilesEmpresariales(parametroId?: string): PerfilEmpresarialParametro[] {
  return parametroId == null
    ? [...perfilesEmpresariales]
    : perfilesEmpresariales.filter((p) => p.parametroId === parametroId);
}

export function listarAjustesProceso(parametroId?: string): AjusteProcesoParametro[] {
  return parametroId == null ? [...ajustesProceso] : ajustesProceso.filter((a) => a.parametroId === parametroId);
}

export function listarAuditoria(parametroId?: string): EntradaAuditoriaParametros[] {
  return parametroId == null ? [...auditoria] : auditoria.filter((a) => a.parametroId === parametroId);
}

/** Solo para pruebas/reinicio del prototipo — nunca se llama desde el
 * motor productivo (no existe tal consumidor todavía, es aislado). */
export function reiniciarHistorialMock(): void {
  perfilesEmpresariales = [];
  ajustesProceso = [];
  auditoria = [];
  contador = 0;
}