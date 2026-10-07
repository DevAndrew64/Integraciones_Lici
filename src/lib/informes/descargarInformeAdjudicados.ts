/**
 * Descarga del "INFORME PROCESOS ADJUDICADOS Y NO ADJUDICADOS".
 *
 * Único punto de descarga en el cliente — lo consumen tanto el botón del
 * Dashboard (anillo de adjudicación) como el módulo "Informes Gerenciales".
 * NO contiene lógica de cálculo ni de plantilla: todo eso vive en el backend
 * (`GET /api/informes/procesos-adjudicados` +
 * `src/lib/informes/plantilla-procesos-adjudicados.ts`). Aquí solo se arma la
 * query, se pide el .xlsx y se dispara la descarga del blob — para que
 * Dashboard e Informes no tengan dos implementaciones que puedan divergir.
 *
 * Lanza `Error` con el mensaje del servidor si algo falla; el caller decide
 * cómo mostrarlo (mismo patrón que ya usaba `generarInforme` en el Dashboard).
 */
export interface ParametrosInformeAdjudicados {
  /** YYYY-MM-DD — obligatorio (el endpoint responde 400 sin él). */
  desde: string;
  /** YYYY-MM-DD — obligatorio. */
  hasta: string;
  /** Perfil/empresa opcional ("Aseocolba", "Vigicolba", …). Vacío = todas. */
  empresa?: string;
}

export async function descargarInformeAdjudicados({ desde, hasta, empresa }: ParametrosInformeAdjudicados): Promise<void> {
  if (!desde || !hasta) throw new Error('Selecciona el rango de fechas.');

  const qs = new URLSearchParams({ desde, hasta });
  if (empresa) qs.set('empresa', empresa);

  const res = await fetch(`/api/informes/procesos-adjudicados?${qs}`);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'No se pudo generar el informe.');
  }

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Informe_Procesos_Adjudicados_${desde}_${hasta}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
