/**
 * Lote F1 — el botón "+" (crear solicitud manual) dentro de Solicitudes
 * (Todas las solicitudes / Procesos públicos / Procesos privados) debe
 * verse también para Analista Mercadeo, alineado con la regla de negocio
 * aprobada ("Mercadeo puede crear solicitudes manuales") y con el mismo
 * permiso ya usado en el servidor (POST /api/solicitudes).
 *
 * Mismo patrón de verificación de fuente (sin jsdom/RTL) ya usado en el
 * resto del repo — confirma el cableado exacto en page.tsx.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PAGE_TSX = readFileSync(join(__dirname, 'page.tsx'), 'utf-8');

describe('Botón "+" crear solicitud manual — visible también para Analista Mercadeo', () => {
  it('la condición del botón incluye busqueda.gestionar además de solicitudesComercial.crear', () => {
    expect(PAGE_TSX).toContain(
      "{(puedeConBD(sesion.rol,'solicitudesComercial','crear',sesion.permisosRol)||puedeConBD(sesion.rol,'busqueda','gestionar',sesion.permisosRol))&&<button className=\"icon-btn blue-fill\" title={tituloBotonCrear} onClick={()=>setModalCrear(true)}><IcoPlus/></button>}"
    );
  });
});

describe('Cierre del rol "Asistente Mercadeo" — selector de usuario y visibilidad de menú', () => {
  it('el selector de Rol (crear Y editar usuario) incluye la opción "Asistente Mercadeo", sin fusionarla con "Analista Mercadeo"', () => {
    const ocurrencias = PAGE_TSX.split('<option>Asistente Mercadeo</option>').length - 1;
    expect(ocurrencias).toBe(2); // formulario de creación + formulario de edición
    expect(PAGE_TSX).toContain('<option>Analista Mercadeo</option>');
  });

  it('"Todas las solicitudes" se gatea por la clave BD sol_ver_todas directamente — cualquier rol con ese flag (incluido Asistente Mercadeo) la ve, sin lista de roles hardcodeada', () => {
    expect(PAGE_TSX).toContain('{pb?.sol_ver_todas===true&&');
  });
});
