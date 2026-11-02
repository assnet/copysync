/**
 * Empacota `dist/` em `.crx` assinado com `.keys/extension-private.pem`, via
 * `chrome --pack-extension` (formato CRX3, o único que o Chrome atual aceita).
 * Saída: `release/<name>-<versão>.crx`. Distribuição fora da loja (política de
 * empresa, teste interno). Para a Web Store use `pnpm pack:store` (zip).
 *
 * Pré-requisito: `pnpm build` (com `key`; `check-dist` já passou).
 * Chrome: `CHROME_BIN` ou caminho padrão por SO.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import { PRIVATE_KEY_PATH, resolveExtensionId } from './extension-id.mjs';

const CHROME_CANDIDATES = {
  darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
  linux: ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'],
  win32: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ],
};

const fail = (msg) => { console.error(`✖ ${msg}`); process.exit(1); };

const chrome = process.env.CHROME_BIN
  || (CHROME_CANDIDATES[process.platform] ?? []).find((c) => c.includes(path.sep) ? existsSync(c) : true);
if (!chrome) fail('Chrome não encontrado. Defina CHROME_BIN=/caminho/para/chrome.');
if (!existsSync(PRIVATE_KEY_PATH)) fail(`${PRIVATE_KEY_PATH} ausente — rode \`pnpm keys:generate\` ou restaure o backup.`);
if (!existsSync('dist/manifest.json')) fail('dist/ ausente — rode `pnpm build` antes.');

const manifest = JSON.parse(readFileSync('dist/manifest.json', 'utf8'));
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
if (manifest.version !== pkg.version) fail(`dist/manifest.json ${manifest.version} ≠ package.json ${pkg.version} — rebuild.`);
if (!manifest.key) fail('dist/manifest.json sem "key" — o CRX precisa do `pnpm build` normal (build de loja fica em dist-store/).');

const { id, publicKeyB64 } = resolveExtensionId();
if (manifest.key !== publicKeyB64) fail('"key" do manifest não corresponde à chave privada em .keys/ — o ID mudaria.');

const distAbs = path.resolve('dist');
const crxTmp = `${distAbs}.crx`;
const pemTmp = `${distAbs}.pem`;
rmSync(crxTmp, { force: true });

const res = spawnSync(chrome, [
  `--pack-extension=${distAbs}`,
  `--pack-extension-key=${path.resolve(PRIVATE_KEY_PATH)}`,
  '--no-message-box',
], { stdio: 'inherit' });
if (res.error) fail(`falha ao executar o Chrome: ${res.error.message}`);
if (!existsSync(crxTmp)) fail('Chrome não gerou dist.crx (veja a mensagem acima).');
rmSync(pemTmp, { force: true }); // Chrome só cria .pem quando não recebe a chave; garantia.

mkdirSync('release', { recursive: true });
const out = path.join('release', `${pkg.name}-${pkg.version}.crx`);
rmSync(out, { force: true });
renameSync(crxTmp, out);
console.log(`✔ ${out}  (ID ${id})`);
