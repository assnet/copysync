/**
 * Sessão MTProto (StringSession) cifrada em repouso: uma chave `session` em `SessionAuthKey`,
 * provider `telegram`, AAD `tenantId:telegram:session`. A string dá acesso total à conta —
 * nunca sai do adapter nem vai para log.
 */
import type { ISessionAuthStateRepository } from '../../../../sessions/domain/contracts/ISessionAuthStateRepository';
import type { ISecretCipher, EncryptedBlob } from '../../../../../shared/security/ISecretCipher';

export const TELEGRAM_AUTH_PROVIDER = 'telegram';
const SESSION_KEY = 'session';

interface StoredBlob {
  ciphertext: string;
  iv: string;
  tag: string;
  keyVersion: number;
}

function aad(tenantId: string): string {
  return `${tenantId}:${TELEGRAM_AUTH_PROVIDER}:${SESSION_KEY}`;
}

export class TelegramAuthStatePersistence {
  constructor(
    private readonly authStateRepo: ISessionAuthStateRepository,
    private readonly cipher: () => ISecretCipher,
  ) {}

  /** StringSession salva, ou null (sessão nunca logou / credenciais apagadas). */
  async load(sessionId: string, tenantId: string): Promise<string | null> {
    const keys = await this.authStateRepo.findAllKeys(sessionId);
    const raw = keys[SESSION_KEY] as StoredBlob | undefined;
    if (!raw || typeof raw.ciphertext !== 'string') return null;
    const blob: EncryptedBlob = {
      ciphertext: Buffer.from(raw.ciphertext, 'base64'),
      iv: Buffer.from(raw.iv, 'base64'),
      tag: Buffer.from(raw.tag, 'base64'),
      keyVersion: raw.keyVersion,
    };
    return this.cipher().decrypt(blob, aad(tenantId));
  }

  /** Há StringSession salva (login concluído antes)? Lê só a chave, sem decifrar. */
  async hasSaved(sessionId: string): Promise<boolean> {
    const raw = (await this.authStateRepo.findKey(sessionId, SESSION_KEY)) as Partial<StoredBlob> | null;
    return typeof raw?.ciphertext === 'string';
  }

  async save(sessionId: string, tenantId: string, sessionString: string): Promise<void> {
    const blob = this.cipher().encrypt(sessionString, aad(tenantId));
    const stored: StoredBlob = {
      ciphertext: blob.ciphertext.toString('base64'),
      iv: blob.iv.toString('base64'),
      tag: blob.tag.toString('base64'),
      keyVersion: blob.keyVersion,
    };
    await this.authStateRepo.writeKeys({
      sessionId,
      tenantId,
      provider: TELEGRAM_AUTH_PROVIDER,
      upserts: { [SESSION_KEY]: stored },
      deletes: [],
    });
  }

  async clear(sessionId: string): Promise<void> {
    await this.authStateRepo.clearCredentials(sessionId);
  }
}
