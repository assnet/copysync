import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { env } from '../../../../shared/config/env';
import { MediaProcessingFailedError } from '../../../../shared/errors/internal/MediaErrors';
import { logger } from '../../../../shared/logger/logger';

/** Operação de mídia — vai para o log e para o `meta` do erro. */
export type MediaProcessOperation = 'version' | 'probe' | 'voice' | 'thumbnail' | 'waveform';

export interface RunProcessInput {
  command: string;
  args: readonly string[];
  /** Conta a partir do `spawn` (não inclui a espera por vaga no semáforo). */
  timeoutMs: number;
  operation: MediaProcessOperation;
  /** Teto do stdout acumulado em memória; acima dele o processo é morto. Padrão 256 KiB. */
  maxStdoutBytes?: number;
  /** Consome o stdout em stream: nada é acumulado e o teto não se aplica (forma de onda). */
  onStdout?: (chunk: Buffer) => void;
}

/** Roda o processo e devolve o stdout acumulado (vazio com `onStdout`). */
export type RunProcess = (input: RunProcessInput) => Promise<Buffer>;

export type SpawnProcess = (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess;

export interface ProcessLog {
  warn(obj: object, msg: string): void;
}

export interface ProcessRunnerOptions {
  /** Processos simultâneos (`MEDIA_PROCESS_CONCURRENCY`). */
  concurrency?: number;
  spawn?: SpawnProcess;
  log?: ProcessLog;
}

type FailureReason = 'timeout' | 'exit_code' | 'spawn_failed' | 'stdout_limit';

const DEFAULT_MAX_STDOUT_BYTES = 256 * 1024;
/** Só o começo do stderr vai para o log — com `-loglevel error` é onde está a causa. */
const STDERR_LOG_BYTES = 2048;
/** Sem shell e sem stdin: nenhum argumento é interpretado, e o processo não espera o terminal. */
const SPAWN_OPTIONS: SpawnOptions = { shell: false, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true };

const moduleLog = logger.child({ module: 'runProcess' });

/** Semáforo simples: a vaga passa direto para o próximo da fila. */
function createSemaphore(limit: number): () => Promise<() => void> {
  let active = 0;
  const waiting: Array<() => void> = [];
  return async () => {
    if (active < limit) active++;
    else await new Promise<void>((resolve) => waiting.push(resolve));

    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = waiting.shift();
      if (next) next();
      else active--;
    };
  };
}

/**
 * Executor de ffmpeg/ffprobe: `spawn` com array (nunca shell), timeout com `SIGKILL` e limite de
 * processos simultâneos. Falha sempre vira `MediaProcessingFailedError`; o stderr (truncado) só
 * vai para o log, porque pode conter caminho de disco.
 *
 * Uma instância por processo — cada instância tem o próprio semáforo.
 */
export function createProcessRunner(options: ProcessRunnerOptions = {}): RunProcess {
  const spawnProcess = options.spawn ?? spawn;
  const log = options.log ?? moduleLog;
  const acquire = createSemaphore(options.concurrency ?? env.MEDIA_PROCESS_CONCURRENCY);

  return async (input) => {
    const release = await acquire();
    try {
      return await execute(input, spawnProcess, log);
    } finally {
      release();
    }
  };
}

function execute(input: RunProcessInput, spawnProcess: SpawnProcess, log: ProcessLog): Promise<Buffer> {
  const { operation } = input;
  const maxStdoutBytes = input.maxStdoutBytes ?? DEFAULT_MAX_STDOUT_BYTES;

  return new Promise<Buffer>((resolve, reject) => {
    const stdout: Buffer[] = [];
    let stdoutBytes = 0;
    const stderr: Buffer[] = [];
    let stderrBytes = 0;
    let killedFor: FailureReason | null = null;
    let settled = false;
    let timer: NodeJS.Timeout | undefined;

    const fail = (reason: FailureReason, details: { exitCode?: number | null; signal?: string | null; errorCode?: string }) => {
      log.warn(
        { operation, reason, ...details, stderr: Buffer.concat(stderr).toString('utf8') },
        'Processo de mídia falhou',
      );
      reject(new MediaProcessingFailedError(undefined, { operation, reason, exitCode: details.exitCode }));
    };

    const settle = (outcome: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      outcome();
    };

    let child: ChildProcess;
    try {
      child = spawnProcess(input.command, input.args, SPAWN_OPTIONS);
    } catch (err) {
      settle(() => fail('spawn_failed', { errorCode: errorCodeOf(err) }));
      return;
    }

    const kill = (reason: FailureReason) => {
      if (killedFor !== null) return;
      killedFor = reason;
      child.kill('SIGKILL');
    };

    timer = setTimeout(() => kill('timeout'), input.timeoutMs);

    child.stdout?.on('data', (chunk: Buffer) => {
      if (killedFor !== null) return;
      if (input.onStdout) {
        input.onStdout(chunk);
        return;
      }
      stdoutBytes += chunk.length;
      if (stdoutBytes > maxStdoutBytes) {
        kill('stdout_limit');
        return;
      }
      stdout.push(chunk);
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderrBytes >= STDERR_LOG_BYTES) return;
      const part = chunk.subarray(0, STDERR_LOG_BYTES - stderrBytes);
      stderr.push(part);
      stderrBytes += part.length;
    });

    child.on('error', (err: Error) => settle(() => fail('spawn_failed', { errorCode: errorCodeOf(err) })));

    child.on('close', (exitCode: number | null, signal: NodeJS.Signals | null) =>
      settle(() => {
        if (killedFor !== null) fail(killedFor, { exitCode, signal });
        else if (exitCode !== 0) fail('exit_code', { exitCode, signal });
        else resolve(Buffer.concat(stdout));
      }),
    );
  });
}

function errorCodeOf(err: unknown): string | undefined {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : undefined;
}
