import type { IUploadSessionStore } from '../../domain/contracts/IUploadSessionStore';
import { diskBudget } from '../../domain/services/diskBudget';
import { logger as sharedLogger } from '../../../../shared/logger/logger';

/** Só o que a varredura usa do store — nada de banco. */
export type SweepableUploadStore = Pick<
  IUploadSessionStore,
  'listExpired' | 'discard' | 'diskStats' | 'openReservedBytes'
>;

/** Só o que a varredura registra; o logger compartilhado (pino) satisfaz. */
export interface UploadSessionSweeperLogger {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

export interface UploadSessionSweeperOptions {
  store: SweepableUploadStore;
  /** `MEDIA_UPLOAD_TTL_MINUTES` em ms: upload parado há mais que isso é apagado. */
  ttlMs: number;
  /** Padrão: 10 minutos. */
  intervalMs?: number;
  /** Relógio da expiração; injetável no teste. */
  now?: () => Date;
  logger?: UploadSessionSweeperLogger;
  /** Reserva de disco para o total informado; padrão: a calculada por `diskBudget`, sem override. */
  reserveFor?: (totalBytes: number) => number;
}

const DEFAULT_INTERVAL_MS = 10 * 60_000;

/**
 * Varredura dos uploads em partes: no boot e a cada intervalo.
 *
 * Apaga (`.bin` + lateral) o que o store dá como expirado — o `listExpired` já cobre o `.bin`
 * sem lateral (pelo `mtime`) e o `CONSUMED`, que guarda só o lateral até o TTL para a
 * confirmação repetida. Depois confere o espaço: livre abaixo de 2× a reserva vira `warn` a
 * cada varredura, porque a mídia **recebida** grava no mesmo disco e perde o arquivo em
 * silêncio quando falta espaço.
 *
 * Só disco local: seguro com qualquer banco. Execuções não se sobrepõem e nenhuma falha
 * derruba o agendamento.
 */
export class UploadSessionSweeper {
  private readonly intervalMs: number;
  private readonly now: () => Date;
  private readonly log: UploadSessionSweeperLogger;
  private readonly reserveFor: (totalBytes: number) => number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running: Promise<void> | null = null;

  constructor(private readonly options: UploadSessionSweeperOptions) {
    this.intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.now = options.now ?? (() => new Date());
    this.log = options.logger ?? sharedLogger.child({ module: 'UploadSessionSweeper' });
    this.reserveFor = options.reserveFor ?? ((totalBytes) => diskBudget({ totalBytes }).reserveBytes);
  }

  /** Roda já e agenda as próximas; o timer não segura o processo. Repetir não duplica. */
  start(): void {
    if (this.timer) return;
    void this.runOnce();
    this.timer = setInterval(() => void this.runOnce(), this.intervalMs);
    this.timer.unref();
  }

  /** Para o agendamento; uma varredura em curso termina sozinha. */
  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  /** Nunca rejeita. Chamada durante outra varredura devolve a que está em curso. */
  runOnce(): Promise<void> {
    this.running ??= this.sweep().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async sweep(): Promise<void> {
    try {
      await this.removeExpired();
    } catch (err) {
      this.log.error({ err }, 'Upload sweep failed to list expired uploads');
    }
    try {
      await this.checkFreeSpace();
    } catch (err) {
      this.log.error({ err }, 'Upload sweep failed to check free space');
    }
  }

  private async removeExpired(): Promise<void> {
    const expired = await this.options.store.listExpired(this.now(), this.options.ttlMs);
    let removed = 0;
    // Um upload que falha ao apagar não pode prender os demais em toda varredura.
    for (const uploadId of expired) {
      try {
        await this.options.store.discard(uploadId);
        removed++;
      } catch (err) {
        this.log.error({ err, uploadId }, 'Upload sweep failed to discard expired upload');
      }
    }
    if (removed > 0) this.log.info({ removed }, 'Expired uploads removed');
  }

  private async checkFreeSpace(): Promise<void> {
    const { totalBytes, freeBytes } = await this.options.store.diskStats();
    const reserveBytes = this.reserveFor(totalBytes);
    if (freeBytes >= 2 * reserveBytes) return;

    const openReservedBytes = await this.options.store.openReservedBytes();
    this.log.warn(
      { freeBytes, totalBytes, reserveBytes, openReservedBytes },
      'Upload disk is running low — free space below twice the reserve',
    );
  }
}
