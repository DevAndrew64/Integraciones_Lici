import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

const DEPARTAMENTOS_POR_PERFIL: Record<string, string[]> = {
  vigicolba: [
    'Atlántico',
    'Bolívar',
    'Cundinamarca',
    'Magdalena',
  ],

  tempocolba: [
    'Antioquia',
    'Arauca',
    'Atlántico',
    'Bolívar',
    'Boyacá',
    'Caldas',
    'Cauca',
    'Cesar',
    'Córdoba',
    'Cundinamarca',
    'Huila',
    'La Guajira',
    'Magdalena',
    'Nariño',
    'Norte de Santander',
    'Quindío',
    'Risaralda',
    'San Andrés, Providencia y Santa Catalina',
    'Santander',
    'Sucre',
    'Tolima',
    'Valle del Cauca',
  ],

  aseocolba: [
    'Antioquia',
    'Atlántico',
    'Bolívar',
    'Boyacá',
    'Caldas',
    'Cauca',
    'Cesar',
    'Córdoba',
    'Cundinamarca',
    'Huila',
    'La Guajira',
    'Magdalena',
    'Nariño',
    'Norte de Santander',
    'Quindío',
    'Risaralda',
    'San Andrés, Providencia y Santa Catalina',
    'Santander',
    'Sucre',
    'Tolima',
    'Valle del Cauca',
  ],
};

function normalizarTexto(valor: string) {
  return String(valor || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function limpiarDepartamento(valor: string) {
  return String(valor || '')
    .replace(/\s+/g, ' ')
    .replace(/\s+:/g, ' :')
    .replace(/:\s+/g, ': ')
    .trim();
}

function extraerDepartamentos(valor: string | null | undefined): string[] {
  const texto = String(valor || '').trim();

  if (!texto) return [];

  return texto
    .split(';')
    .map((parte) => parte.trim())
    .filter(Boolean)
    .map((parte) => {
      const departamento = parte.split(':')[0]?.trim() || '';
      return limpiarDepartamento(departamento);
    })
    .filter(Boolean)
    .filter((dep) => {
      const normalizado = normalizarTexto(dep);

      const noValidos = [
        'colombia',
        'nacional',
        'todo el pais',
        'todos',
        'varios',
        'no definido',
        'no disponible',
        'sin informacion',
      ];

      return !noValidos.includes(normalizado);
    });
}

function obtenerDepartamentosPermitidos(perfiles: string[]) {
  const mapa = new Map<string, string>();

  perfiles.forEach((perfil) => {
    const clavePerfil = normalizarTexto(perfil);
    const departamentos = DEPARTAMENTOS_POR_PERFIL[clavePerfil] || [];

    departamentos.forEach((dep) => {
      const claveDep = normalizarTexto(dep);

      if (claveDep && !mapa.has(claveDep)) {
        mapa.set(claveDep, dep);
      }
    });
  });

  return mapa;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);

    const perfilesParam =
      searchParams.get('perfiles') ||
      searchParams.get('perfil') ||
      '';

    const perfiles = perfilesParam
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean)
      .map((x) => normalizarTexto(x));

    if (perfiles.length === 0) {
      return NextResponse.json({
        ok: true,
        total: 0,
        departamentos: [],
        mensaje: 'Selecciona primero un perfil.',
      });
    }

    const departamentosPermitidos = obtenerDepartamentosPermitidos(perfiles);

    if (departamentosPermitidos.size === 0) {
      return NextResponse.json({
        ok: true,
        total: 0,
        departamentos: [],
        mensaje: 'No hay departamentos parametrizados para los perfiles seleccionados.',
      });
    }

    const rows = await prisma.proceso.findMany({
      where: {
        departamento: {
          not: null,
        },
        OR: perfiles.map((perfil) => ({
          perfil: {
            contains: perfil,
            mode: 'insensitive',
          },
        })),
      },
      select: {
        departamento: true,
        perfil: true,
      },
    });

    const mapaResultado = new Map<string, string>();

    rows.forEach((row) => {
      const departamentosProceso = extraerDepartamentos(row.departamento);

      departamentosProceso.forEach((dep) => {
        const claveDep = normalizarTexto(dep);

        if (departamentosPermitidos.has(claveDep) && !mapaResultado.has(claveDep)) {
          mapaResultado.set(claveDep, departamentosPermitidos.get(claveDep) || dep);
        }
      });
    });

    const departamentos = Array.from(mapaResultado.values()).sort((a, b) =>
      a.localeCompare(b, 'es', { sensitivity: 'base' })
    );

    return NextResponse.json({
      ok: true,
      total: departamentos.length,
      perfiles,
      departamentos,
    });
  } catch (error) {
    console.error('[GET /api/procesos/filtros/departamentos]', error);

    return NextResponse.json(
      {
        ok: false,
        total: 0,
        departamentos: [],
        error: 'No fue posible consultar los departamentos dependientes.',
      },
      { status: 500 }
    );
  }
}