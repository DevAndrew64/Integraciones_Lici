/**
 * Detecta si una pregunta requiere búsqueda web en tiempo real.
 * Regla: NO activar en modo RAG (con documento), solo en modo general.
 */

// Palabras que el usuario dice explícitamente para pedir internet
const TRIGGERS_EXPLICITOS = [
  'busca en internet', 'busca en la web', 'busca online', 'busca en línea',
  'consulta en internet', 'consulta en la web', 'consulta online',
  'verifica en internet', 'verifica en la web', 'verifica online',
  'revisa en internet', 'revisa en la web', 'busca la norma',
  'fuente oficial', 'fuente actualizada', 'dato actual', 'dato actualizado',
  'busca en google', 'googlea',
];

// Temas que por naturaleza cambian y requieren fuente actual
const TRIGGERS_IMPLICITOS = [
  'trm', 'tasa representativa', 'tasa de cambio', 'dólar hoy', 'precio del dólar',
  'decreto reciente', 'resolución reciente', 'circular reciente', 'norma reciente',
  'ley reciente', 'actualizacion normativa', 'cambio normativo',
  'salario minimo', 'smmlv', 'aumento salarial',
  'precio actual', 'tarifa actual', 'costo actual',
  'indicadores economicos', 'inflacion', 'ipc', 'ibd',
  'noticia', 'noticias', 'novedad',
  'proceso en secop', 'proceso secop', 'licitacion publicada',
  'convocatoria abierta', 'estado del proceso',
  'ultima resolucion', 'ultimo decreto',
  'cuando vence', 'plazo vigente', 'plazo actual',
];

const DOMINIOS_OFICIALES_CO = [
  'gov.co',                     // cubre todo el gobierno colombiano
  'banrep.gov.co',
  'dane.gov.co',
  'superfinanciera.gov.co',
  'datos.gov.co',
  'secop.gov.co',
  'colombiacompra.gov.co',
  'funcionpublica.gov.co',
  'mintrabajo.gov.co',
  'dian.gov.co',
  'suin-juriscol.gov.co',
  'presidencia.gov.co',
  'congreso.gov.co',
  'supersalud.gov.co',
  'minsalud.gov.co',
  'mineducacion.gov.co',
  'dnp.gov.co',
];

export type TipoFuente = 'oficial' | 'secundaria' | 'desconocida';

export interface WebSource {
  title: string;
  url: string;
  sourceType: TipoFuente;
  fetchedAt: string;
}

function quitarAcentos(s: string) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export function necesitaBusquedaWeb(pregunta: string): boolean {
  const q = quitarAcentos(pregunta.toLowerCase());
  return (
    TRIGGERS_EXPLICITOS.some(t => q.includes(quitarAcentos(t))) ||
    TRIGGERS_IMPLICITOS.some(t => q.includes(quitarAcentos(t)))
  );
}

export function clasificarFuente(url: string): TipoFuente {
  if (!url) return 'desconocida';
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    if (DOMINIOS_OFICIALES_CO.some(d => hostname === d || hostname.endsWith('.' + d))) {
      return 'oficial';
    }
    // Medios de comunicación conocidos → secundaria
    const secundarios = ['eltiempo.com', 'semana.com', 'portafolio.co', 'dinero.com',
      'elespectador.com', 'larepublica.co', 'valoraanalitik.com'];
    if (secundarios.some(d => hostname.includes(d))) return 'secundaria';
    return 'desconocida';
  } catch {
    return 'desconocida';
  }
}