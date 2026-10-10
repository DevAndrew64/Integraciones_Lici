import type { NextConfig } from "next";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

// Versión y commit que se escriben en la consola del navegador (ver layout.tsx),
// para confirmar qué está desplegado. Un build sin carpeta .git (p. ej. Docker)
// debe recibir el commit en la variable GIT_COMMIT; si no, se muestra "desconocido".
function idCommit(): string {
  const dado = (process.env.GIT_COMMIT ?? "").trim();
  if (dado) return dado.slice(0, 7);
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim() || "desconocido";
  } catch {
    return "desconocido";
  }
}

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_APP_VERSION: JSON.parse(readFileSync("package.json", "utf8")).version,
    NEXT_PUBLIC_APP_COMMIT: idCommit(),
  },
  serverExternalPackages: ['pdfjs-dist', 'pdfkit', 'puppeteer', 'puppeteer-core', 'mysql2'],
  // Excluye del rastreo de archivos de Next.js (Output File Tracing) los paquetes de
  // puppeteer para esta ruta. Rutas verificadas contra la estructura real del proyecto
  // (node_modules/puppeteer/.local-chromium NO existe en esta versión — se descartó).
  // Nota: el binario de Chromium descargado vive en $HOME/.cache/puppeteer/{chrome,
  // chrome-headless-shell}, fuera de node_modules — el rastreo de Next probablemente no
  // llega ahí, así que esta exclusión ataca lo que sí es rastreable, no necesariamente
  // la causa completa del EEXIST.
  outputFileTracingExcludes: {
    '/api/lectura/export-pdf/**': [
      'node_modules/puppeteer/**',
      'node_modules/puppeteer-core/**',
      'node_modules/@puppeteer/browsers/**',
    ],
  },
  async headers() {
    return [
      {
        // Servir archivos .mjs con Content-Type correcto para que import() funcione
        source: '/:path*.mjs',
        headers: [
          { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
        ],
      },
      {
        // Headers de seguridad para todas las páginas y rutas API
        source: '/:path*',
        headers: [
          // Previene que el navegador detecte tipos MIME incorrectamente
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // Bloquea embebido en iframes (anti-clickjacking)
          { key: 'X-Frame-Options', value: 'DENY' },
          // Fuerza HTTPS durante 1 año (incluye subdominios)
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
          // Limita información de referrer
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // Deshabilita APIs del navegador no usadas
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          // Content-Security-Policy: permite recursos necesarios para Next.js + PDFjs + UploadThing + Highcharts + XLSX
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://code.highcharts.com https://cdnjs.cloudflare.com",
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "img-src 'self' data: blob: https:",
              "font-src 'self' data: https://fonts.gstatic.com",
              "connect-src 'self' https://uploadthing.com https://*.uploadthing.com https://utfs.io https://*.utfs.io",
              "frame-src 'self' blob: data:",
              "frame-ancestors 'none'",
              "object-src 'none'",
              "base-uri 'self'",
            ].join('; '),
          },
        ],
      },
    ];
  },
};

export default nextConfig;