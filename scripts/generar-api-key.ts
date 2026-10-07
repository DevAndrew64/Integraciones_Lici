/**
 * Gestión de API Keys de la API pública (tabla api_clients).
 * La clave completa se muestra UNA sola vez; en BD solo queda el hash SHA-256.
 *
 * Uso (local, con DATABASE_URL):
 *   npx dotenv -e .env -- npx tsx scripts/generar-api-key.ts crear "Nombre cliente" [scopes] [empresas] [rateLimit] [expiraEnDias]
 *   npx dotenv -e .env -- npx tsx scripts/generar-api-key.ts listar
 *   npx dotenv -e .env -- npx tsx scripts/generar-api-key.ts revocar <id>
 *
 * Ejemplos:
 *   ... crear "Power BI Gerencia"
 *   ... crear "Integración X" "procesos:indicadores:read,procesos:detalle:read" "" 120 365
 */
import prisma from '../src/lib/prisma';
import { generarApiKey } from '../src/lib/public-api/auth';

const SCOPES_DEFAULT = ['procesos:indicadores:read'];

async function main() {
  const [cmd, ...args] = process.argv.slice(2);

  if (cmd === 'crear') {
    const nombre = args[0]?.trim();
    if (!nombre) { console.error('Falta el nombre del cliente.'); process.exit(1); }
    const scopes = args[1] ? args[1].split(',').map(s => s.trim()).filter(Boolean) : SCOPES_DEFAULT;
    const empresas = args[2] ? args[2].split(',').map(s => s.trim()).filter(Boolean) : [];
    const rateLimit = Number(args[3]) || Number(process.env.PUBLIC_API_RATE_LIMIT_DEFAULT) || 60;
    const expiraDias = args[4] ? Number(args[4]) : null;

    const { key, prefix, hash } = generarApiKey();
    const cliente = await prisma.apiClient.create({
      data: {
        nombre, apiKeyPrefix: prefix, apiKeyHash: hash,
        scopes, empresasPermitidas: empresas, rateLimitPorMinuto: rateLimit,
        expiraEn: expiraDias ? new Date(Date.now() + expiraDias * 86400000) : null,
      },
    });
    console.log('Cliente API creado:');
    console.log(`  id:        ${cliente.id}`);
    console.log(`  nombre:    ${cliente.nombre}`);
    console.log(`  scopes:    ${cliente.scopes.join(', ')}`);
    console.log(`  empresas:  ${cliente.empresasPermitidas.join(', ') || '(todas)'}`);
    console.log(`  rate/min:  ${cliente.rateLimitPorMinuto}`);
    console.log(`  expira:    ${cliente.expiraEn?.toISOString() ?? 'nunca'}`);
    console.log('');
    console.log('  API KEY (guárdala AHORA — no volverá a mostrarse):');
    console.log(`  ${key}`);
  } else if (cmd === 'listar') {
    const clientes = await prisma.apiClient.findMany({ orderBy: { id: 'asc' } });
    for (const c of clientes) {
      console.log(`#${c.id} ${c.activo ? '✔' : '✖ revocada'} "${c.nombre}" prefix=${c.apiKeyPrefix} scopes=[${c.scopes.join(',')}] rate=${c.rateLimitPorMinuto}/min ultimoUso=${c.ultimoUsoEn?.toISOString() ?? '—'} expira=${c.expiraEn?.toISOString() ?? '—'}`);
    }
    if (!clientes.length) console.log('(sin clientes)');
  } else if (cmd === 'revocar') {
    const id = Number(args[0]);
    if (!Number.isInteger(id)) { console.error('Uso: revocar <id>'); process.exit(1); }
    await prisma.apiClient.update({ where: { id }, data: { activo: false } });
    console.log(`Cliente #${id} revocado (activo=false). Efecto inmediato en la API.`);
  } else {
    console.error('Comandos: crear | listar | revocar');
    process.exit(1);
  }
  await prisma.$disconnect();
}

main().catch(e => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
