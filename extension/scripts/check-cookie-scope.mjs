/**
 * Guarda: `chrome.cookies.*` só existe em `src/background/marketplaceSession.ts`
 * e sempre mira `MARKETPLACE_COOKIE_DOMAIN`.
 *
 * A permissão `cookies` permite ler QUALQUER cookie — inclusive o da API, se um
 * dia ela usar cookie. Restringir o escopo a um módulo e a um domínio é regra
 * de leitura de código; regra sem verificação vira promessa esquecida.
 *
 * Uso: `pnpm check:cookie-scope` (roda em `pnpm type-check`).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'src';
const ALLOWED_FILE = join('src', 'background', 'marketplaceSession.ts');
const DOMAIN_CONST = 'MARKETPLACE_COOKIE_DOMAIN';
const WINDOW = 240;

const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith('.ts')) files.push(p);
  }
};
walk(ROOT);

const failures = [];
const re = /chrome\.cookies\.[a-zA-Z]+/g;

for (const file of files) {
  const content = readFileSync(file, 'utf8');
  let m;
  while ((m = re.exec(content)) !== null) {
    const line = content.slice(0, m.index).split('\n').length;
    if (file !== ALLOWED_FILE) {
      failures.push(`${file}:${line} — ${m[0]} fora de ${ALLOWED_FILE}`);
      continue;
    }
    const slice = content.slice(m.index, m.index + WINDOW);
    if (!slice.includes(DOMAIN_CONST)) {
      failures.push(`${file}:${line} — ${m[0]} sem ${DOMAIN_CONST} nos ${WINDOW} chars seguintes`);
    }
  }
}

if (failures.length) {
  console.error('✖ chrome.cookies fora do escopo permitido:');
  for (const f of failures) console.error('  ' + f);
  console.error('\nCookie só do marketplace, só em marketplaceSession.ts. A API autentica por token.');
  process.exit(1);
}

console.log(`✔ check:cookie-scope OK (${files.length} arquivos).`);
