/**
 * Gera o par de chaves do CRX (RSA 2048, PKCS#8) em `.keys/`, igual ao que o
 * Chrome produz em `--pack-extension`. Nunca sobrescreve: a chave privada é o
 * que mantém o ID da extensão; perdê-la ou trocá-la muda o ID.
 *
 * Saída: `.keys/extension-private.pem` (segredo, fora do git),
 *        `.keys/public-key.b64` (vai em `public/manifest.json#key`).
 * Uso: `pnpm keys:generate` — depois cole o `key` no manifest e atualize
 * `EXTENSION_ORIGINS` (API) e `VITE_EXTENSION_IDS` (painel) com o ID impresso.
 */
import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { extensionIdFromDer, PRIVATE_KEY_PATH, publicKeyDerFromPem } from './extension-id.mjs';

if (existsSync(PRIVATE_KEY_PATH)) {
  console.error(`✖ ${PRIVATE_KEY_PATH} já existe. Trocar a chave muda o ID da extensão — apague à mão se for intencional.`);
  process.exit(1);
}

mkdirSync('.keys', { recursive: true });
const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicExponent: 0x10001,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
const der = publicKeyDerFromPem(privateKey);
const publicKeyB64 = der.toString('base64');

writeFileSync(PRIVATE_KEY_PATH, privateKey, { mode: 0o600 });
writeFileSync('.keys/public-key.b64', publicKeyB64 + '\n');

console.log(`✔ ${PRIVATE_KEY_PATH} gerada (RSA 2048, PKCS#8, modo 600).`);
console.log(`✔ .keys/public-key.b64 — cole este valor em public/manifest.json → "key".`);
console.log(`ID da extensão: ${extensionIdFromDer(der)}`);
console.log('Próximos passos: manifest.key, api EXTENSION_ORIGINS, app VITE_EXTENSION_IDS, backup da .pem.');
