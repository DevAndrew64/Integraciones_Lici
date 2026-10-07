/**
 * Ajuste "AGREGAR PRODUCTOS MANUALES Y MOSTRAR DETALLE COMPLETO" — Registrar
 * Dotación y EPP. Funciones puras (validación, normalización, duplicados)
 * usadas por el modal "Agregar producto manual"; el cálculo mensual sigue
 * siendo el mismo motor ya existente (valorMesRow en page.tsx), nunca una
 * fórmula nueva — este módulo solo valida/normaliza texto de entrada.
 */

export interface EntradaProductoManual {
  codigoGrupo: string;
  codigo: string;
  descripcion: string;
  cantidad: string;
  frecuencia: string;
  valorUnitario: string;
  fechaUltimaCompra: string; // "YYYY-MM-DD"
}

export type ErroresProductoManual = Partial<Record<keyof EntradaProductoManual, string>>;

export interface ResultadoValidacionProductoManual {
  ok: boolean;
  errores: ErroresProductoManual;
}

/** Mayúsculas + espacios colapsados — "f 001" / "F001" / " F001 " → "F001". */
export function normalizarCodigoGrupo(s: string): string {
  return s.trim().toUpperCase().replace(/\s+/g, ' ');
}

/** Conserva ceros iniciales (nunca se trata como número) — solo recorta bordes. */
export function normalizarCodigoProducto(s: string): string {
  return s.trim();
}

/** Espacios repetidos → uno solo; nunca trunca el contenido. */
export function normalizarDescripcion(s: string): string {
  return s.trim().replace(/\s+/g, ' ');
}

/**
 * Valida la entrada del formulario manual. `requiereCodigoGrupo` es false
 * únicamente para EPP (la fuente de EPP no maneja este dato — nunca se
 * exige ni se guarda "Sin grupo" como valor artificial, ver §2 del ajuste).
 * `ahora` se recibe explícito (nunca `new Date()` interno) para que la
 * regla "fecha no futura" sea determinística en pruebas.
 */
export function validarProductoManual(
  entrada: EntradaProductoManual,
  requiereCodigoGrupo: boolean,
  ahora: Date,
): ResultadoValidacionProductoManual {
  const errores: ErroresProductoManual = {};

  if (requiereCodigoGrupo && normalizarCodigoGrupo(entrada.codigoGrupo) === '') {
    errores.codigoGrupo = 'El código de grupo es obligatorio.';
  }
  if (normalizarCodigoProducto(entrada.codigo) === '') {
    errores.codigo = 'El código es obligatorio.';
  }
  if (normalizarDescripcion(entrada.descripcion) === '') {
    errores.descripcion = 'La descripción es obligatoria.';
  }

  const cantidad = Number(entrada.cantidad);
  if (!entrada.cantidad.trim() || isNaN(cantidad) || cantidad <= 0) {
    errores.cantidad = 'La cantidad debe ser mayor que cero.';
  }

  const frecuencia = Number(entrada.frecuencia);
  if (!entrada.frecuencia.trim() || isNaN(frecuencia) || frecuencia <= 0) {
    errores.frecuencia = 'La frecuencia es obligatoria.';
  }

  const valorUnitario = Number(entrada.valorUnitario);
  if (!entrada.valorUnitario.trim() || isNaN(valorUnitario) || valorUnitario <= 0) {
    errores.valorUnitario = 'El valor unitario debe ser mayor que cero.';
  }

  if (!entrada.fechaUltimaCompra.trim()) {
    errores.fechaUltimaCompra = 'La última fecha de compra es obligatoria.';
  } else {
    const fecha = new Date(entrada.fechaUltimaCompra + 'T00:00:00');
    if (isNaN(fecha.getTime())) {
      errores.fechaUltimaCompra = 'La fecha no es válida.';
    } else if (fecha.getTime() > ahora.getTime()) {
      errores.fechaUltimaCompra = 'La fecha no puede ser futura.';
    }
  }

  return { ok: Object.keys(errores).length === 0, errores };
}

export interface IdentidadProducto {
  codigo: string;
  codigoGrupo?: string;
}

/**
 * Duplicado = mismo código, o misma combinación código de grupo + código
 * (§10 del ajuste) — nunca se compara por descripción. `existentes` debe
 * ser SIEMPRE el conjunto ya acotado a la misma categoría/sujeto (el
 * llamador filtra el grupo correcto antes de invocar esta función).
 */
export function existeProductoDuplicado(
  existentes: readonly IdentidadProducto[],
  candidato: IdentidadProducto,
  idExcluido?: number & { __brand?: never },
): boolean {
  const codigo = normalizarCodigoProducto(candidato.codigo).toLowerCase();
  const grupo = candidato.codigoGrupo ? normalizarCodigoGrupo(candidato.codigoGrupo).toLowerCase() : '';
  return existentes.some(e => {
    const eCodigo = normalizarCodigoProducto(e.codigo).toLowerCase();
    if (eCodigo !== codigo) return false;
    const eGrupo = e.codigoGrupo ? normalizarCodigoGrupo(e.codigoGrupo).toLowerCase() : '';
    if (grupo || eGrupo) return grupo === eGrupo;
    return true;
  });
}
