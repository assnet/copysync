/**
 * Guarda do ARTEFATO de produção. Roda depois de `pnpm build` contra `dist/`
 * e falha se o que vai para a Web Store carrega sinal de desenvolvimento,
 * versão divergente ou resquício do legado (assinatura/`update_url`).
 *
 * Confere o artefato, não a intenção: invariante que ninguém vê de olho
 * é promessa esquecida (mesmo raciocínio de `check-cookie-scope.mjs`).
 *
 * Uso: `pnpm check:dist` (automático no final de `pnpm build`).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import dotenv from 'dotenv';

const DIST = 'dist';
const failures = [];

const DEV_MARKS = [
  'localhost',
  '127.0.0.1',
  /\b(?:10|127|192\.168)\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/,
  /\b172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}\b/,
];
const DEBUG_MARKS = ['console.log(', 'debugger'];

const manifestPath = join(DIST, 'manifest.json');
if (!existsSync(manifestPath)) {
  console.error(`✖ ${manifestPath} não existe — rode \`pnpm build\` antes.`);
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));

if (manifest.version !== pkg.version) {
  failures.push(`manifest.version "${manifest.version}" ≠ package.json "${pkg.version}"`);
}
if (manifest.update_url) {
  failures.push('manifest.update_url presente — resquício da listagem antiga; remova.');
}
if (existsSync(join(DIST, '_metadata'))) {
  failures.push('dist/_metadata/ presente — assinatura da Web Store do legado não pode ir no zip.');
}

const envFile = dotenv.parse(existsSync('.env') ? readFileSync('.env', 'utf8') : '');
let apiHost = '';
try {
  apiHost = new URL(envFile.API_URL ?? '').host;
} catch {
  failures.push('.env: API_URL ausente ou inválida.');
}

const bundles = readdirSync(DIST).filter((f) => f.endsWith('.js'));
if (!bundles.length) failures.push('dist/ sem bundles .js — build incompleto?');

for (const bundle of bundles) {
  const content = readFileSync(join(DIST, bundle), 'utf8');
  for (const mark of DEV_MARKS) {
    const hit = typeof mark === 'string' ? content.includes(mark) : mark.test(content);
    if (hit) failures.push(`${bundle}: contém "${mark}" — origem de dev no build de produção.`);
  }
  for (const mark of DEBUG_MARKS) {
    if (content.includes(mark)) failures.push(`${bundle}: contém "${mark}" — Terser deveria ter removido.`);
  }
}

if (apiHost && bundles.includes('background.js')) {
  const bg = readFileSync(join(DIST, 'background.js'), 'utf8');
  if (!bg.includes(apiHost)) {
    failures.push(`background.js não contém o host "${apiHost}" de API_URL — o .env usado no build não é o de produção?`);
  }
}

if (failures.length) {
  console.error('✖ check:dist falhou:\n');
  for (const f of failures) console.error('  - ' + f);
  console.error('\nSe isto falhou depois de `pnpm dev`, o dist/ é do build DEV — rode `pnpm build`.');
  process.exit(1);
}

console.log(`✔ check:dist OK (${bundles.length} bundles, versão ${manifest.version}).`);
