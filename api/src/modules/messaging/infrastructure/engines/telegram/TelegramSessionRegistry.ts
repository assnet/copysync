import type { TelegramClient } from 'telegram';
import { Deferred } from './deferred';
import type { SessionStatus } from '../../../../sessions/domain/enums/SessionStatus';

/** Login em andamento: o `client.start`/QR roda em background e espera o operador por estas promessas. */
export interface PendingLogin {
  mode: 'code' | 'qr';
  /** Resolvida quando o Telegram aceitou o pedido e enviou o código ao app do usuário. */
  codeSent: Deferred<void>;
  /** Próximo código que o operador vai digitar (renovada a cada tentativa errada). */
  code: Deferred<string>;
  /** Senha de duas etapas (só existe se a conta pedir). */
  password: Deferred<string>;
  /** Quem chamou submit*; recebe o resultado do passo (ou o erro traduzido). */
  waiter: Deferred<{ status: SessionStatus }> | null;
  /** Promessa do fluxo inteiro (`start`/`signInUserWithQrCode`). */
  flow: Promise<void>;
}

export interface TelegramSessionEntry {
  client: TelegramClient;
  tenantId: string;
  /** Cada connect cria um novo cliente; eventos do antigo são ignorados. */
  epoch: number;
  pending: PendingLogin | null;
  latestQr: string | null;
  /** Login concluído neste cliente (`finishLogin`): só aí a sessão ocupa vaga do worker. */
  authorized?: boolean;
  /** Telefone da conta logada (dígitos), quando conhecido. */
  phone: string | null;
  /** Ids de mensagens que esta engine enviou — o eco (`out`) não vira recebimento duplicado. */
  sentIds: Set<string>;
  /** Ids recebidos (push ou recuperação de canal): a mesma mensagem não é emitida duas vezes. */
  seenIds?: Set<string>;
  /** Recuperação de canais monitorados (`TelegramChannelCatchUp`); parada no teardown. */
  catchUp?: { stop(): void; notePush(chatId: string): void } | null;
}

const SENT_IDS_MAX = 500;
const SEEN_IDS_MAX = 2_000;

export class TelegramSessionRegistry {
  private readonly entries = new Map<string, TelegramSessionEntry>();
  private epochs = 0;

  nextEpoch(): number {
    return ++this.epochs;
  }

  set(sessionId: string, entry: TelegramSessionEntry): void {
    this.entries.set(sessionId, entry);
  }

  get(sessionId: string): TelegramSessionEntry | undefined {
    return this.entries.get(sessionId);
  }

  isCurrent(sessionId: string, epoch: number): boolean {
    return this.entries.get(sessionId)?.epoch === epoch;
  }

  delete(sessionId: string): void {
    this.entries.delete(sessionId);
  }

  rememberSent(entry: TelegramSessionEntry, id: string): void {
    if (entry.sentIds.size >= SENT_IDS_MAX) {
      const first = entry.sentIds.values().next().value;
      if (first !== undefined) entry.sentIds.delete(first);
    }
    entry.sentIds.add(id);
  }

  /** Primeira vez que o id chega a esta entrada? Marca e devolve true; repetido devolve false. */
  markSeen(entry: TelegramSessionEntry, id: string): boolean {
    const seen = entry.seenIds ??= new Set();
    if (seen.has(id)) return false;
    if (seen.size >= SEEN_IDS_MAX) {
      const first = seen.values().next().value;
      if (first !== undefined) seen.delete(first);
    }
    seen.add(id);
    return true;
  }

  all(): [string, TelegramSessionEntry][] {
    return [...this.entries.entries()];
  }
}
