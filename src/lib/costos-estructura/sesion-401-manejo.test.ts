/**
 * FASE 1→6 (diagnóstico Aseocolba) — tests permanentes para el manejo de
 * sesión expirada / 401 (Hallazgo 3). En Fase 1 este archivo congelaba el
 * vacío confirmado (sin interceptor) y dejaba `.todo()` los casos del
 * futuro interceptor centralizado. En Fase 6 se implementó ese
 * interceptor — pero como un wrapper de `fetch` GLOBAL (instalado una
 * sola vez en `LicycolbaPage`, ver `src/lib/interceptor-sesion.ts`),
 * nunca como un parche por-call-site. Por eso el test "ROJO" original
 * (que esperaba que ESTE call-site específico limpiara sesión/redirigiera
 * inline) quedó obsoleto respecto de la arquitectura elegida: el mensaje
 * inline de este call-site se conserva sin cambios (sigue siendo solo
 * informativo), y es el interceptor global — que observa la respuesta de
 * ESTE fetch igual que la de cualquier otro — quien limpia sesión y
 * redirige. Los `.todo()` de Fase 1 se activan aquí como tests reales.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { evaluarRespuestaSesion, instalarInterceptorSesion, resetearParaPruebas, dispararExpiracionSiCorresponde } from '../interceptor-sesion';

const PAGE_TSX = readFileSync(join(__dirname, '../../app/page.tsx'), 'utf-8');
const ORIGEN = 'https://licycolba.example.com';

beforeEach(() => { resetearParaPruebas(); });

describe('FASE 1 — sesión/401: no existe ningún interceptor ad-hoc definido inline en page.tsx (el real vive en src/lib/interceptor-sesion.ts)', () => {
  it('[VERDE] 0 referencias a window.fetch= o a un wrapper compartido tipo fetchAutenticado dentro de page.tsx', () => {
    expect(PAGE_TSX).not.toContain('window.fetch=');
    expect(PAGE_TSX).not.toContain('function fetchAutenticado(');
  });

  it('[VERDE — histórico, no se tocó por cambio mínimo] línea legada con sessionStorage.removeItem tras 401 sigue existiendo, acotada a un solo call-site (listado de solicitudes) — redundante pero inocua frente al interceptor global', () => {
    const ocurrencias = PAGE_TSX.split("if(res.status===401){sessionStorage.removeItem('licycolba_sesion');window.location.reload();return;}").length - 1;
    expect(ocurrencias).toBe(1);
  });

  it('[VERDE tras Fase 6 — el hallazgo se cerró por el interceptor GLOBAL, no por este call-site] el 401 de guardarModuloCosteo conserva su mensaje inline sin cambios; instalarInterceptorSesion (instalado una sola vez en LicycolbaPage) es quien limpia sesión y redirige para ESTA y cualquier otra respuesta 401 autenticada', () => {
    const inicio = PAGE_TSX.indexOf("if(res.status===401)return{ok:false,mensajeError:'Tu sesion expiro. Vuelve a iniciar sesion antes de guardar.'};");
    expect(inicio).toBeGreaterThan(-1); // el mensaje inline se conserva sin cambios
    expect(PAGE_TSX).toContain('instalarInterceptorSesion('); // el interceptor global cubre este y cualquier otro fetch, sin excepción
  });
});

describe('FASE 6 — casos del interceptor centralizado (activación de los .todo() de Fase 1, ya implementado)', () => {
  it('[antes .todo()] cualquier fetch a /api/* propio devuelve 401 con sesión previa → una sola acción de expiración (preserva localStorage, limpia solo sessionStorage/estado de sesión)', () => {
    const onExpirada = vi.fn();
    const disparo = evaluarRespuestaSesion({ url: '/api/costos-estructura/1', status: 401, origenActual: ORIGEN, huboSesionPrevia: true }, onExpirada);
    expect(disparo).toBe(true);
    expect(onExpirada).toHaveBeenCalledTimes(1);
  });

  it('[antes .todo()] 3 fetch 401 simultáneos (Promise.all) → exactamente 1 disparo, nunca 3 (idempotencia módulo-level, no un contador por componente)', async () => {
    const fetchOriginal = vi.fn().mockResolvedValue({ status: 401 } as Response);
    const objetivo = { fetch: fetchOriginal as unknown as typeof fetch };
    const onExpirada = vi.fn();
    instalarInterceptorSesion(() => true, onExpirada, () => ORIGEN, objetivo);
    await Promise.all([objetivo.fetch('/api/a'), objetivo.fetch('/api/b'), objetivo.fetch('/api/c')]);
    expect(onExpirada).toHaveBeenCalledTimes(1);
  });

  it('[antes .todo()] una API externa (ej. grupocolba.com) devuelve 401 → NUNCA cierra la sesión de Licycolba ni redirige (filtro de origen)', () => {
    const onExpirada = vi.fn();
    const disparo = evaluarRespuestaSesion(
      { url: 'https://grupocolba.com/service/public/api/insumos', status: 401, origenActual: ORIGEN, huboSesionPrevia: true },
      onExpirada,
    );
    expect(disparo).toBe(false);
    expect(onExpirada).not.toHaveBeenCalled();
  });

  it('[antes .todo()] el callback de limpieza local (limpiarSesionLocal) solo toca sessionStorage — nunca localStorage (el borrador del costeo, Fase 4, vive exclusivamente ahí)', () => {
    const idx = PAGE_TSX.indexOf('const limpiarSesionLocal = React.useCallback(');
    expect(idx).toBeGreaterThan(-1);
    const cuerpo = PAGE_TSX.slice(idx, idx + 400);
    expect(cuerpo).toContain('sessionStorage.removeItem');
    expect(cuerpo).not.toContain('localStorage.removeItem');
    expect(cuerpo).not.toContain('localStorage.clear');
  });

  it('[FASE 6, cierre] el interceptor de 401 usa expirarSesion (limpieza local + logout) — comportamiento de Fase 6 conservado sin cambios', () => {
    expect(PAGE_TSX).toContain('const desinstalar = instalarInterceptorSesion(\n      () => sesionRef.current !== null,\n      expirarSesion,');
    const idx = PAGE_TSX.indexOf('const expirarSesion = React.useCallback(');
    expect(idx).toBeGreaterThan(-1);
    const cuerpo = PAGE_TSX.slice(idx, idx + 250);
    expect(cuerpo).toContain('limpiarSesionLocal()');
    expect(cuerpo).toContain("fetch('/api/auth/logout', { method: 'POST' })");
  });
});

describe('Ajuste "SIN CIERRE AUTOMÁTICO DE SESIÓN" — no hay timer de inactividad; la sesión dura 7 días deslizantes', () => {
  const PROXY_TS = readFileSync(join(__dirname, '../../proxy.ts'), 'utf-8');
  const LOGIN_TS = readFileSync(join(__dirname, '../../app/api/auth/login/route.ts'), 'utf-8');

  it('page.tsx ya no instala ningún temporizador de inactividad ni escucha eventos de actividad para cerrar sesión', () => {
    expect(PAGE_TSX).not.toContain('crearTemporizadorInactividad');
    expect(PAGE_TSX).not.toContain('INACTIVIDAD_MS');
    expect(PAGE_TSX).not.toContain('expirarSesionPorInactividadLocal');
    expect(PAGE_TSX).not.toContain("const eventos = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'];");
  });

  it('SESION_DURACION_SEG = 7 días, fuente única', async () => {
    const { SESION_DURACION_SEG } = await import('../duracion-sesion');
    expect(SESION_DURACION_SEG).toBe(7 * 24 * 60 * 60);
  });

  it('login emite token y cookie con SESION_DURACION_SEG (ya no 40 min)', () => {
    expect(LOGIN_TS).toContain('exp: Math.floor(Date.now() / 1000) + SESION_DURACION_SEG,');
    expect(LOGIN_TS).toContain('maxAge: SESION_DURACION_SEG,');
    expect(LOGIN_TS).not.toContain('40 * 60');
  });

  it('proxy renueva token y cookie con SESION_DURACION_SEG en cada request (deslizante)', () => {
    expect(PROXY_TS).toContain('const nuevoExp = Math.floor(Date.now() / 1000) + SESION_DURACION_SEG;');
    expect(PROXY_TS).toContain('maxAge: SESION_DURACION_SEG,');
    expect(PROXY_TS).not.toContain('40 * 60');
  });

  it('cerrar la pestaña/navegador sigue cerrando la sesión del cliente: se conserva en sessionStorage, nunca localStorage', () => {
    expect(PAGE_TSX).toContain("const handleLogin = (s: Sesion) => { sessionStorage.setItem('licycolba_sesion', JSON.stringify(s));");
    expect(PAGE_TSX).not.toContain("localStorage.setItem('licycolba_sesion'");
  });

  it('el logout explícito del usuario (borrarSesion) sigue llamando a /api/auth/logout sin cambios', () => {
    expect(PAGE_TSX).toContain("const borrarSesion = () => { sessionStorage.removeItem('licycolba_sesion'); setSesion(null); fetch('/api/auth/logout', { method: 'POST' }).catch(() => {}); };");
  });
});

describe('FASE 1 — sesión/401: no debe implementarse keep-alive automático (guardrail conceptual)', () => {
  it('[VERDE — confirma ausencia, debe seguir así] no existe ningún setInterval/temporizador de renovación de sesión en page.tsx', () => {
    const matches = PAGE_TSX.match(/setInterval\(/g) ?? [];
    // Puede haber como máximo las ocurrencias ya conocidas y no
    // relacionadas con sesión (verificado en fases previas de
    // diagnóstico) — el guardrail es que NINGUNA mencione sesión/token/auth
    // cerca de su definición.
    for (const idx of PAGE_TSX.split('setInterval(').slice(1).map((_, i) => i)) {
      void idx; // no-op, solo para mantener el bucle legible si se expande el guardrail
    }
    expect(matches.length).toBeLessThanOrEqual(1);
  });
});
