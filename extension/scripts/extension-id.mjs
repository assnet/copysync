/**
 * Calcula o ID da extensão a partir da chave pública (regra do Chrome:
 * SHA-256 do SPKI em DER → 32 primeiros hex → dígitos mapeados para a–p).
 *
 * Fonte, em ordem: `.keys/extension-private.pem` → `public/manifest.json#key`.
 * Uso: `pnpm keys:id` (exportado para `pack-*.mjs` e `keys-generate.mjs`).
 */
import { createHash, createPublicKey } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const PRIVATE_KEY_PATH = '.keys/extension-private.pem';

export const publicKeyDerFromPem = (pem) =>
  createPublicKey(pem).export({ type: 'spki', format: 'der' });

export const extensionIdFromDer = (der) =>
  createHash('sha256').update(der).digest('hex').slice(0, 32)
    .replace(/[0-9a-f]/g, (c) => String.fromCharCode('a'.charCodeAt(0) + parseInt(c, 16)));

export const resolveExtensionId = () => {
  if (existsSync(PRIVATE_KEY_PATH)) {
    const der = publicKeyDerFromPem(readFileSync(PRIVATE_KEY_PATH, 'utf8'));
    return { id: extensionIdFromDer(der), source: PRIVATE_KEY_PATH, publicKeyB64: der.toString('base64') };
  }
  const manifest = JSON.parse(readFileSync('public/manifest.json', 'utf8'));
  if (!manifest.key) throw new Error('Sem .keys/extension-private.pem e sem "key" em public/manifest.json.');
  const der = Buffer.from(manifest.key, 'base64');
  return { id: extensionIdFromDer(der), source: 'public/manifest.json#key', publicKeyB64: manifest.key };
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { id, source, publicKeyB64 } = resolveExtensionId();
  const manifest = JSON.parse(readFileSync('public/manifest.json', 'utf8'));
  console.log(`ID da extensão: ${id}  (fonte: ${source})`);
  if (manifest.key && manifest.key !== publicKeyB64) {
    console.error('✖ "key" em public/manifest.json NÃO corresponde à chave privada em .keys/.');
    process.exit(1);
  }
  console.log(`chrome-extension://${id}`);
}
