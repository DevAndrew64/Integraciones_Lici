// src/data/costos-estructura/catalogo-vacunas.ts
// Ajuste "IMPLEMENTAR CATÁLOGO DE VACUNAS EN EL MÓDULO DE EXÁMENES, CURSOS
// Y VACUNAS" — fuente local tipada y versionada (nunca leída desde una
// imagen en tiempo de ejecución). `precioPreferencial` corresponde al
// "Precio de venta a estudiantes, fuerza pública y profesionales de la
// salud" del catálogo suministrado; `esquemaVacunacion` se conserva
// exactamente como texto de referencia de la fuente — nunca se traduce a
// una regla clínica ni se usa para inferir cantidad de dosis.

export type VacunaCatalogo = {
  codigo: string;
  nombre: string;
  precioPreferencial: number;
  precioPublicoGeneral: number;
  esquemaVacunacion: string;
};

export const CATALOGO_VACUNAS: VacunaCatalogo[] = [
  { codigo: 'VAC001', nombre: 'Antirrábica', precioPreferencial: 180000, precioPublicoGeneral: 185000, esquemaVacunacion: 'POM' },
  { codigo: 'VAC002', nombre: 'Antitetánica', precioPreferencial: 17500, precioPublicoGeneral: 22000, esquemaVacunacion: '1°-1 mes-6 meses' },
  { codigo: 'VAC003', nombre: 'Dengue', precioPreferencial: 290000, precioPublicoGeneral: 290000, esquemaVacunacion: '1-3 meses' },
  { codigo: 'VAC004', nombre: 'Difteria, tétano y tosferina (DPTa)', precioPreferencial: 110000, precioPublicoGeneral: 115000, esquemaVacunacion: 'Cada 10 años' },
  { codigo: 'VAC005', nombre: 'Fiebre amarilla', precioPreferencial: 110000, precioPublicoGeneral: 115000, esquemaVacunacion: 'Dosis única' },
  { codigo: 'VAC006', nombre: 'Fiebre tifoidea', precioPreferencial: 132000, precioPublicoGeneral: 137000, esquemaVacunacion: 'Dosis única PRN' },
  { codigo: 'VAC007', nombre: 'Hepatitis A', precioPreferencial: 142000, precioPublicoGeneral: 147000, esquemaVacunacion: '1°-6 meses' },
  { codigo: 'VAC008', nombre: 'Hepatitis A+B', precioPreferencial: 165000, precioPublicoGeneral: 172000, esquemaVacunacion: 'T-1 mes-6 meses' },
  { codigo: 'VAC009', nombre: 'Hepatitis B', precioPreferencial: 37000, precioPublicoGeneral: 42000, esquemaVacunacion: 'T-1 mes-5 meses' },
  { codigo: 'VAC010', nombre: 'Herpes zóster', precioPreferencial: 650000, precioPublicoGeneral: 655000, esquemaVacunacion: 'Dosis única' },
  { codigo: 'VAC011', nombre: 'Herpes zóster (SHINGRIX)', precioPreferencial: 1000000, precioPublicoGeneral: 1000000, esquemaVacunacion: 'T-2 a 5 meses' },
  { codigo: 'VAC012', nombre: 'Influenza', precioPreferencial: 48000, precioPublicoGeneral: 58000, esquemaVacunacion: 'Anual' },
  { codigo: 'VAC013', nombre: 'Meningococo', precioPreferencial: 160000, precioPublicoGeneral: 165000, esquemaVacunacion: 'Según la edad' },
  { codigo: 'VAC014', nombre: 'Meningococo B', precioPreferencial: 620000, precioPublicoGeneral: 620000, esquemaVacunacion: '0-2 meses' },
  { codigo: 'VAC015', nombre: 'Neumococo 23', precioPreferencial: 90000, precioPublicoGeneral: 95000, esquemaVacunacion: 'Dosis única' },
  { codigo: 'VAC016', nombre: 'Neumococo 15', precioPreferencial: 230000, precioPublicoGeneral: 230000, esquemaVacunacion: 'Según la edad' },
  { codigo: 'VAC017', nombre: 'VPH', precioPreferencial: 610000, precioPublicoGeneral: 610000, esquemaVacunacion: '1a-2m-6m' },
  { codigo: 'VAC018', nombre: 'Triple viral', precioPreferencial: 105000, precioPublicoGeneral: 110000, esquemaVacunacion: 'Cada 10 años' },
  { codigo: 'VAC019', nombre: 'Varicela', precioPreferencial: 129000, precioPublicoGeneral: 135000, esquemaVacunacion: '1a-2m' },
];
