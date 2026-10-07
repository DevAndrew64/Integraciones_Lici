import { describe, expect, it } from 'vitest';
import {
  clasificarProductoCatalogo, filtrarRegistrosPorCategoria,
  resolverPrefijoGrupoObligatorio, filtrarPorPrefijoGrupoCategoria, validarCodigoGrupoParaCategoria,
  esFiltroSinGrupo, TEXTO_FILTRO_SIN_GRUPO,
} from './catalogo-dotacion-filtro';

describe('clasificarProductoCatalogo', () => {
  it('clasifica por campo estructurado "sexo" (M/F)', () => {
    expect(clasificarProductoCatalogo({ sexo: 'M', nombre: 'Pantalón' })).toBe('MASCULINO');
    expect(clasificarProductoCatalogo({ sexo: 'F', nombre: 'Blusa' })).toBe('FEMENINO');
  });
  it('clasifica por campo estructurado "genero" con variantes de texto', () => {
    expect(clasificarProductoCatalogo({ genero: 'Masculino' })).toBe('MASCULINO');
    expect(clasificarProductoCatalogo({ genero: 'Femenino' })).toBe('FEMENINO');
  });
  it('categoria estructurada EPP prevalece sobre cualquier nombre', () => {
    expect(clasificarProductoCatalogo({ categoria: 'EPP', nombre: 'Pantalón masculino' })).toBe('EPP');
  });
  it('nunca usa el nombre si ya existe un campo estructurado de sexo', () => {
    // nombre dice "femenina" pero el campo estructurado dice masculino — el campo manda.
    expect(clasificarProductoCatalogo({ sexo: 'M', nombre: 'Blusa femenina' })).toBe('MASCULINO');
  });
  it('último recurso: nombre, solo cuando no hay ningún campo estructurado', () => {
    expect(clasificarProductoCatalogo({ nombre: 'Pantalón para caballero' })).toBe('MASCULINO');
    expect(clasificarProductoCatalogo({ nombre: 'Blusa para dama' })).toBe('FEMENINO');
  });
  it('sin ninguna señal reconocible es DESCONOCIDO, nunca se asume un sexo por defecto', () => {
    expect(clasificarProductoCatalogo({ nombre: 'Producto genérico', codigo: '001' })).toBe('DESCONOCIDO');
  });
});

describe('filtrarRegistrosPorCategoria', () => {
  const registros = [
    { codigo: '1', sexo: 'M', nombre: 'Pantalón' },
    { codigo: '2', sexo: 'F', nombre: 'Blusa' },
    { codigo: '3', categoria: 'EPP', nombre: 'Guantes' },
    { codigo: '4', nombre: 'Producto sin clasificar' },
  ];

  it('DOTACION_MASCULINA excluye femeninos y EPP; conserva masculinos y sin clasificar', () => {
    const activos = filtrarRegistrosPorCategoria(registros, 'DOTACION_MASCULINA');
    expect(activos.map(r => r.codigo)).toEqual(['1', '4']);
  });
  it('DOTACION_FEMENINA excluye masculinos y EPP; conserva femeninos y sin clasificar', () => {
    const activos = filtrarRegistrosPorCategoria(registros, 'DOTACION_FEMENINA');
    expect(activos.map(r => r.codigo)).toEqual(['2', '4']);
  });
  it('EPP excluye masculino y femenino; conserva EPP y sin clasificar', () => {
    const activos = filtrarRegistrosPorCategoria(registros, 'EPP');
    expect(activos.map(r => r.codigo)).toEqual(['3', '4']);
  });
  it('nunca mezcla dotación masculina, femenina y EPP en el mismo resultado', () => {
    const masc = filtrarRegistrosPorCategoria(registros, 'DOTACION_MASCULINA');
    expect(masc.find(r => r.codigo === '2')).toBeUndefined();
    expect(masc.find(r => r.codigo === '3')).toBeUndefined();
  });
});

describe('Ajuste "CORREGIR FILTRO DE CÓDIGO DE GRUPO PARA DOTACIÓN MASCULINA" — filtro obligatorio por prefijo M/F', () => {
  it('1/2) resolverPrefijoGrupoObligatorio devuelve M para masculina, F para femenina, null para EPP (nunca F001 como prefijo masculino)', () => {
    expect(resolverPrefijoGrupoObligatorio('DOTACION_MASCULINA')).toBe('M');
    expect(resolverPrefijoGrupoObligatorio('DOTACION_FEMENINA')).toBe('F');
    expect(resolverPrefijoGrupoObligatorio('EPP')).toBeNull();
  });

  it('3) filtrarPorPrefijoGrupoCategoria — masculina solo devuelve filas cuyo codgrp empieza por M (caso real: M013/M015 sí, F001/F009/F018 no)', () => {
    const registros = [
      { codigo: '06339', codgrp: 'M013', descripcion: 'CAMISA TIPO POLO HOMBRE' },
      { codigo: '06489', codgrp: 'M015', descripcion: 'PANTALONETA CADIS' },
      { codigo: '06009', codgrp: 'F001', descripcion: 'COFIA AZUL' },
      { codigo: '06612', codgrp: 'F009', descripcion: 'DELANTAL' },
      { codigo: '99999', codgrp: 'F018', descripcion: 'ZAPATO PLAYERO' },
    ];
    const resultado = filtrarPorPrefijoGrupoCategoria(registros, 'DOTACION_MASCULINA');
    expect(resultado.map(r => r.codigo)).toEqual(['06339', '06489']);
    expect(resultado.some(r => r.codgrp.startsWith('F'))).toBe(false);
  });

  it('femenina solo devuelve filas cuyo codgrp empieza por F', () => {
    const registros = [
      { codigo: 'A', codgrp: 'M013', descripcion: 'x' },
      { codigo: 'B', codgrp: 'F001', descripcion: 'y' },
      { codigo: 'C', codgrp: 'F009', descripcion: 'z' },
    ];
    const resultado = filtrarPorPrefijoGrupoCategoria(registros, 'DOTACION_FEMENINA');
    expect(resultado.map(r => r.codigo)).toEqual(['B', 'C']);
  });

  it('EPP no aplica ningún filtro por prefijo (la fuente de EPP no trae codgrp)', () => {
    const registros = [{ codigo: 'A' }, { codigo: 'B', codgrp: 'M013' }];
    expect(filtrarPorPrefijoGrupoCategoria(registros, 'EPP')).toHaveLength(2);
  });

  it('nunca mezcla variantes M y F en el mismo resultado (regresión "mezcla masculina/femenina")', () => {
    const registros = [
      { codigo: 'A', codgrp: 'M013', descripcion: 'PRODUCTO SIN PALABRA DE GENERO' },
      { codigo: 'B', codgrp: 'F001', descripcion: 'PRODUCTO SIN PALABRA DE GENERO' },
    ];
    // ambos productos son "DESCONOCIDO" por nombre (sin hombre/dama) — el
    // filtro por prefijo los separa igual, sin depender del nombre.
    const masc = filtrarPorPrefijoGrupoCategoria(registros, 'DOTACION_MASCULINA');
    const fem = filtrarPorPrefijoGrupoCategoria(registros, 'DOTACION_FEMENINA');
    expect(masc.map(r => r.codigo)).toEqual(['A']);
    expect(fem.map(r => r.codigo)).toEqual(['B']);
  });

  it('4) campo vacío es válido (consulta todos los grupos de la categoría)', () => {
    expect(validarCodigoGrupoParaCategoria('', 'DOTACION_MASCULINA')).toEqual({ ok: true });
  });

  it('5) "M013" filtra únicamente M013 y es válido para masculina', () => {
    expect(validarCodigoGrupoParaCategoria('M013', 'DOTACION_MASCULINA').ok).toBe(true);
    expect(validarCodigoGrupoParaCategoria('m013', 'DOTACION_MASCULINA').ok).toBe(true); // minúsculas normalizadas
  });

  it('6) "F001" es rechazado en masculina, con mensaje explicativo — nunca se corrige en silencio a M001', () => {
    const r = validarCodigoGrupoParaCategoria('F001', 'DOTACION_MASCULINA');
    expect(r.ok).toBe(false);
    expect(r.mensaje).toBe('Para dotación masculina, el código de grupo debe comenzar por M.');
  });

  it('"M013" es rechazado en femenina', () => {
    const r = validarCodigoGrupoParaCategoria('M013', 'DOTACION_FEMENINA');
    expect(r.ok).toBe(false);
    expect(r.mensaje).toContain('femenina');
  });

  it('15) EPP no valida ningún prefijo (siempre válido, cualquier texto)', () => {
    expect(validarCodigoGrupoParaCategoria('CUALQUIER-COSA', 'EPP')).toEqual({ ok: true });
  });
});

describe('Corrección "CHAPUZA DESAPARECE PARA VIGICOLBA" — codgrp vacío nunca excluye, solo un codgrp presente que no matchea', () => {
  // Fixture real: 3 filas de Vigicolba/BAQ con codgrp vacío (medido en vivo
  // contra la API externa, 2026-08-24) — el caso que exponía el bug.
  const chapuzas = [
    { codigo: '07001', codgrp: '', descripcion: 'CHAPUZA CON PORTA BALAS' },
    { codigo: '01067', codgrp: '', descripcion: 'CHAPUZA  EN ACERO' },
    { codigo: '06006', codgrp: '', descripcion: 'CHAPUZA PARA PISTOLA 9MM' },
  ];

  it('codgrp vacío NUNCA se excluye — las 3 filas de CHAPUZA llegan a DOTACION_MASCULINA', () => {
    const resultado = filtrarPorPrefijoGrupoCategoria(chapuzas, 'DOTACION_MASCULINA');
    expect(resultado.map(r => r.codigo)).toEqual(['07001', '01067', '06006']);
  });

  it('codgrp vacío NUNCA se excluye — las mismas 3 filas también llegan a DOTACION_FEMENINA (DESCONOCIDO, nunca se inventa un sexo)', () => {
    const resultado = filtrarPorPrefijoGrupoCategoria(chapuzas, 'DOTACION_FEMENINA');
    expect(resultado.map(r => r.codigo)).toEqual(['07001', '01067', '06006']);
  });

  it('un codgrp vacío mezclado con filas M/F reales: masculina conserva las vacías + las M, excluye las F', () => {
    const registros = [
      ...chapuzas,
      { codigo: 'M1', codgrp: 'M013', descripcion: 'CAMISA TIPO POLO HOMBRE' },
      { codigo: 'F1', codgrp: 'F001', descripcion: 'COFIA AZUL' },
    ];
    const masc = filtrarPorPrefijoGrupoCategoria(registros, 'DOTACION_MASCULINA');
    expect(masc.map(r => r.codigo)).toEqual(['07001', '01067', '06006', 'M1']);
    expect(masc.find(r => r.codigo === 'F1')).toBeUndefined();
  });

  it('un codgrp NO vacío que no matchea el prefijo SIGUE excluyéndose (la corrección no afecta este caso, solo el vacío)', () => {
    const registros = [{ codigo: 'X', codgrp: 'F001', descripcion: 'DELANTAL' }];
    expect(filtrarPorPrefijoGrupoCategoria(registros, 'DOTACION_MASCULINA')).toHaveLength(0);
  });

  it('un codgrp con espacios en blanco (whitespace-only) se trata igual que vacío — nunca excluye', () => {
    const registros = [{ codigo: 'Y', codgrp: '   ', descripcion: 'PRODUCTO SIN GRUPO REAL' }];
    expect(filtrarPorPrefijoGrupoCategoria(registros, 'DOTACION_MASCULINA')).toHaveLength(1);
  });

  it('sin regresión: M013/M015 siguen clasificando masculino y F001/F009/F018 siguen excluidos de masculina (caso ya cubierto arriba)', () => {
    const registros = [
      { codigo: '06339', codgrp: 'M013', descripcion: 'CAMISA TIPO POLO HOMBRE' },
      { codigo: '06489', codgrp: 'M015', descripcion: 'PANTALONETA CADIS' },
      { codigo: '06009', codgrp: 'F001', descripcion: 'COFIA AZUL' },
    ];
    const resultado = filtrarPorPrefijoGrupoCategoria(registros, 'DOTACION_MASCULINA');
    expect(resultado.map(r => r.codigo)).toEqual(['06339', '06489']);
  });
});

describe('Ajuste "SIN GRUPO" (§6/§7) — filtro especial, nunca se confunde con el campo vacío', () => {
  it('esFiltroSinGrupo reconoce el valor especial, insensible a mayúsculas/espacios', () => {
    expect(esFiltroSinGrupo('SIN GRUPO')).toBe(true);
    expect(esFiltroSinGrupo('sin grupo')).toBe(true);
    expect(esFiltroSinGrupo('  Sin Grupo  ')).toBe(true);
  });

  it('esFiltroSinGrupo es false para el campo vacío (nunca se confunde con "no filtrar")', () => {
    expect(esFiltroSinGrupo('')).toBe(false);
    expect(esFiltroSinGrupo('   ')).toBe(false);
  });

  it('esFiltroSinGrupo es false para un código real (M013, F001, etc.)', () => {
    expect(esFiltroSinGrupo('M013')).toBe(false);
    expect(esFiltroSinGrupo(TEXTO_FILTRO_SIN_GRUPO + '1')).toBe(false);
  });

  it('validarCodigoGrupoParaCategoria acepta "SIN GRUPO" en masculina y en femenina, nunca exige el prefijo M/F para este valor', () => {
    expect(validarCodigoGrupoParaCategoria('SIN GRUPO', 'DOTACION_MASCULINA')).toEqual({ ok: true });
    expect(validarCodigoGrupoParaCategoria('SIN GRUPO', 'DOTACION_FEMENINA')).toEqual({ ok: true });
    expect(validarCodigoGrupoParaCategoria('sin grupo', 'DOTACION_MASCULINA')).toEqual({ ok: true });
  });

  it('un código real que SÍ respeta el prefijo sigue validando igual que antes (sin regresión)', () => {
    expect(validarCodigoGrupoParaCategoria('M013', 'DOTACION_MASCULINA').ok).toBe(true);
    expect(validarCodigoGrupoParaCategoria('F001', 'DOTACION_MASCULINA').ok).toBe(false);
  });
});
