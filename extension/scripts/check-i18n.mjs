/**
 * Guarda de i18n: paridade de chaves entre `public/_locales/pt_BR` e `en`, e
 * toda chave usada em `src/**` existe nas duas locales.
 *
 * Usos reconhecidos: `t('chave')`, `data-i18n="chave"`,
 * `data-i18n-attr="attr:chave;attr2:chave2"` e `err_<code>` para cada membro
 * do union `SyncErrorCode` em `src/background/store.ts`.
 *
 * Uso: `pnpm check:i18n` (roda em `pnpm type-check`).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const LOCALES_DIR = join('public', '_locales');
const LOCALES = ['pt_BR', 'en'];
const SRC = 'src';
const CONTRACT = join('src', 'background', 'store.ts');

const loadKeys = (locale) => {
  const file = join(LOCALES_DIR, locale, 'messages.json');
  return new Set(Object.keys(JSON.parse(readFileSync(file, 'utf8'))));
};
const keysByLocale = Object.fromEntries(LOCALES.map((l) => [l, loadKeys(l)]));

const failures = [];

// 1) paridade
const [a, b] = LOCALES;
for (const k of keysByLocale[a]) if (!keysByLocale[b].has(k)) failures.push(`"${k}" existe em ${a} mas não em ${b}`);
for (const k of keysByLocale[b]) if (!keysByLocale[a].has(k)) failures.push(`"${k}" existe em ${b} mas não em ${a}`);

// 2) chaves usadas no código
const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|html)$/.test(p)) files.push(p);
  }
};
walk(SRC);

const used = new Map(); // key -> first location
const add = (key, where) => {
  if (!used.has(key)) used.set(key, where);
};

const PATTERNS = [
  /\bt\(\s*['"]([A-Za-z0-9_]+)['"]/g,
  /data-i18n=["']([A-Za-z0-9_]+)["']/g,
];

for (const file of files) {
  // Ignora comentários: exemplos em docstrings não são uso real.
  const content = readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  for (const re of PATTERNS) {
    let m;
    while ((m = re.exec(content)) !== null) add(m[1], `${file}:${content.slice(0, m.index).split('\n').length}`);
  }
  const attrRe = /data-i18n-attr=["']([^"']+)["']/g;
  let m;
  while ((m = attrRe.exec(content)) !== null) {
    for (const pair of m[1].split(';')) {
      const key = pair.split(':')[1]?.trim();
      if (key) add(key, `${file}:${content.slice(0, m.index).split('\n').length}`);
    }
  }
}

// 3) err_<code> para cada SyncErrorCode
const contract = readFileSync(CONTRACT, 'utf8');
const unionMatch = contract.match(/export type SyncErrorCode\s*=([\s\S]*?);/);
if (!unionMatch) {
  failures.push(`${CONTRACT}: union SyncErrorCode não encontrado`);
} else {
  for (const m of unionMatch[1].matchAll(/['"]([A-Za-z0-9_]+)['"]/g)) add(`err_${m[1]}`, `${CONTRACT} (SyncErrorCode)`);
}

for (const [key, where] of used) {
  for (const locale of LOCALES) {
    if (!keysByLocale[locale].has(key)) failures.push(`"${key}" usada em ${where} não existe em ${locale}`);
  }
}

if (failures.length) {
  console.error('✖ check:i18n falhou:');
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}

console.log(`✔ check:i18n OK (${keysByLocale[a].size} chaves, ${used.size} usadas em ${files.length} arquivos).`);
