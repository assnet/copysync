/**
 * Empacota `dist/` em `.crx` assinado com `.keys/extension-private.pem`, via
 * `chrome --pack-extension` (formato CRX3, o único que o Chrome atual aceita).
 * Saída: `release/<name>-<versão>.crx`. Distribuição fora da loja (política de
 * empresa, teste interno). Para a Web Store use `pnpm pack:store` (zip).
 *
 * Pré-requisito: `pnpm build` (com `key`; `check-dist` já passou).
 * Chrome: `CHROME_BIN` ou caminho padrão por SO.
 *
 * `--upload`: CRX para a Web Store com "uploads de CRX verificados" ativo. Empacota
 * `dist-store/` (sem `key`) assinado com `.keys/verified-upload-private.pem` — par
 * SEPARADO da chave do item (a loja recusa a chave atual do item). Saída
 * `release/<name>-<versão>-upload.crx`. Perder essa chave trava atualizações da loja.
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
const upload = process.argv.includes('--upload');
const VERIFIED_UPLOAD_KEY_PATH = '.keys/verified-upload-private.pem';
const distDir = upload ? 'dist-store' : 'dist';
const keyPath = upload ? VERIFIED_UPLOAD_KEY_PATH : PRIVATE_KEY_PATH;

if (!existsSync(keyPath)) fail(`${keyPath} ausente — restaure o backup (nunca gere outra: a loja só aceita a chave cadastrada).`);
if (!existsSync(`${distDir}/manifest.json`)) fail(`${distDir}/ ausente — rode \`pnpm ${upload ? 'build:store' : 'build'}\` antes.`);

const manifest = JSON.parse(readFileSync(`${distDir}/manifest.json`, 'utf8'));
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
if (manifest.version !== pkg.version) fail(`${distDir}/manifest.json ${manifest.version} ≠ package.json ${pkg.version} — rebuild.`);

const { id, publicKeyB64 } = resolveExtensionId();
if (upload) {
  if (manifest.key) fail(`${distDir}/manifest.json com "key" — o CRX de loja sai do \`pnpm build:store\`.`);
} else {
  if (!manifest.key) fail('dist/manifest.json sem "key" — o CRX precisa do `pnpm build` normal (build de loja fica em dist-store/).');
  if (manifest.key !== publicKeyB64) fail('"key" do manifest não corresponde à chave privada em .keys/ — o ID mudaria.');
}

const distAbs = path.resolve(distDir);
const crxTmp = `${distAbs}.crx`;
const pemTmp = `${distAbs}.pem`;
rmSync(crxTmp, { force: true });

const res = spawnSync(chrome, [
  `--pack-extension=${distAbs}`,
  `--pack-extension-key=${path.resolve(keyPath)}`,
  '--no-message-box',
], { stdio: 'inherit' });
if (res.error) fail(`falha ao executar o Chrome: ${res.error.message}`);
if (!existsSync(crxTmp)) fail(`Chrome não gerou ${distDir}.crx (veja a mensagem acima).`);
rmSync(pemTmp, { force: true }); // Chrome só cria .pem quando não recebe a chave; garantia.

mkdirSync('release', { recursive: true });
const out = path.join('release', `${pkg.name}-${pkg.version}${upload ? '-upload' : ''}.crx`);
rmSync(out, { force: true });
renameSync(crxTmp, out);
console.log(upload ? `✔ ${out}  (upload verificado na loja, item ${id})` : `✔ ${out}  (ID ${id})`);
