/**
 * Zipa o CONTEÚDO de `dist-store/` para envio à Chrome Web Store:
 * `release/<name>-<versão>-store.zip`. Exige build de loja (`pnpm build:store`,
 * sem `key` no manifest — a loja recusa manifest com `key`).
 *
 * `--with-key`: inclui `key.pem` na raiz do zip. SÓ no PRIMEIRO envio de uma
 * listagem nova, para a loja adotar o mesmo ID do build local. Apague o zip
 * depois do upload — ele contém a chave privada.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { PRIVATE_KEY_PATH, resolveExtensionId } from './extension-id.mjs';

const fail = (msg) => { console.error(`✖ ${msg}`); process.exit(1); };
const withKey = process.argv.includes('--with-key');

const DIST = 'dist-store';
if (!existsSync(`${DIST}/manifest.json`)) fail(`${DIST}/ ausente — rode \`pnpm build:store\` antes.`);
const manifest = JSON.parse(readFileSync(`${DIST}/manifest.json`, 'utf8'));
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
if (manifest.version !== pkg.version) fail(`${DIST}/manifest.json ${manifest.version} ≠ package.json ${pkg.version} — rebuild.`);
if (manifest.key) fail(`${DIST}/manifest.json contém "key" — a Web Store recusa. Use \`pnpm build:store\`.`);
if (existsSync(`${DIST}/_metadata`)) fail(`${DIST}/_metadata presente — não pode ir no zip.`);

const keyInDist = path.join(DIST, 'key.pem');
rmSync(keyInDist, { force: true });
if (withKey) {
  if (!existsSync(PRIVATE_KEY_PATH)) fail(`${PRIVATE_KEY_PATH} ausente.`);
  copyFileSync(PRIVATE_KEY_PATH, keyInDist);
}

mkdirSync('release', { recursive: true });
const out = path.resolve('release', `${pkg.name}-${pkg.version}-store${withKey ? '-with-key' : ''}.zip`);
rmSync(out, { force: true });
const res = spawnSync('zip', ['-r', '-X', out, '.', '-x', '.DS_Store', '-x', '*/.DS_Store'], { cwd: DIST, stdio: 'inherit' });
rmSync(keyInDist, { force: true });
if (res.status !== 0) fail('zip falhou.');

const { id } = resolveExtensionId();
console.log(`✔ ${path.relative('.', out)}  (ID esperado na loja: ${id})`);
if (withKey) console.warn('⚠ zip contém key.pem — use só no primeiro upload e apague em seguida.');
