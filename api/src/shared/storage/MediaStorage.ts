/**
 * MediaStorage
 *
 * Salva buffers de mídia em disco (storage/media/) e gera URLs relativas
 * ao prefixo da API.  Pode ser substituído futuramente por um adapter S3/MinIO
 * sem alterar o adapter do Baileys.
 */
import fs from 'fs/promises';
import path from 'path';
import { env } from '../config/env';

const MEDIA_SUBDIR = 'media';

/**
 * Salva o buffer no disco e retorna o caminho relativo do arquivo.
 * Cria os diretórios necessários automaticamente.
 */
export async function saveMediaBuffer(buffer: Buffer, filename: string): Promise<void> {
  const dir = path.resolve(env.STORAGE_PATH, MEDIA_SUBDIR);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, filename), buffer);
}

/**
 * Retorna a URL pública relativa à raiz para o arquivo de mídia.
 * Ex.: /api/storage/media/sess_abc123.jpg
 *
 * Ao usar Vite em dev (/api → http://localhost:3000), o proxy cobre esta URL.
 * Em produção, o servidor serve o prefixo /api diretamente.
 */
export function mediaPublicUrl(filename: string): string {
  return `${env.API_PREFIX}/storage/${MEDIA_SUBDIR}/${filename}`;
}

/**
 * Resolve o caminho absoluto no disco de um arquivo de mídia.
 */
export function mediaFilePath(filename: string): string {
  return path.resolve(env.STORAGE_PATH, MEDIA_SUBDIR, filename);
}

/**
 * Verifica se um arquivo de mídia já existe no disco.
 * Usado para evitar re-download de mídias já salvas (idempotência).
 */
export async function mediaFileExists(filename: string): Promise<boolean> {
  try {
    await fs.access(path.resolve(env.STORAGE_PATH, MEDIA_SUBDIR, filename));
    return true;
  } catch {
    return false;
  }
}
