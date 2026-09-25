import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { MediaProcessingFailedError } from '../../../../shared/errors/internal/MediaErrors';
import { createProcessRunner, type RunProcessInput, type SpawnProcess } from './runProcess';

/** Processo falso: stdout/stderr emitem `data` na hora; `close` só quando o teste manda. */
class ProcessoFalso extends EventEmitter {
  readonly stdout = new EventEmitter();
  readonly stderr = new EventEmitter();
  readonly kill = vi.fn((signal: NodeJS.Signals) => {
    queueMicrotask(() => this.emit('close', null, signal));
    return true;
  });

  sai(code: number): void {
    this.emit('close', code, null);
  }
}

function montar(opts: { concurrency?: number } = {}) {
  const processos: ProcessoFalso[] = [];
  const spawn = vi.fn(() => {
    const processo = new ProcessoFalso();
    processos.push(processo);
    return processo as unknown as ChildProcess;
  });
  const log = { warn: vi.fn() };
  const run = createProcessRunner({ spawn: spawn as unknown as SpawnProcess, concurrency: opts.concurrency ?? 2, log });
  return { run, spawn, processos, log };
}

const ENTRADA: RunProcessInput = { command: 'ffprobe', args: ['-of', 'json', '/tmp/a.webm'], timeoutMs: 15_000, operation: 'probe' };

/** Deixa as promessas pendentes (semáforo, spawn) andarem. */
const esvaziar = () => new Promise<void>((resolve) => setImmediate(resolve));

async function erroDe(promessa: Promise<unknown>): Promise<MediaProcessingFailedError> {
  const err = await promessa.then(
    () => expect.unreachable('deveria falhar'),
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(MediaProcessingFailedError);
  return err as MediaProcessingFailedError;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('runProcess', () => {
  it('executa sem shell, com stdin fechado, e devolve o stdout inteiro', async () => {
    const { run, spawn, processos } = montar();
    const resultado = run(ENTRADA);
    await esvaziar();

    expect(spawn).toHaveBeenCalledWith('ffprobe', ['-of', 'json', '/tmp/a.webm'], expect.objectContaining({ shell: false, stdio: ['ignore', 'pipe', 'pipe'] }));
    processos[0].stdout.emit('data', Buffer.from('{"a"'));
    processos[0].stdout.emit('data', Buffer.from(':1}'));
    processos[0].sai(0);

    await expect(resultado).resolves.toEqual(Buffer.from('{"a":1}'));
  });

  it('falha com MEDIA_PROCESSING_FAILED quando o processo sai com código diferente de zero', async () => {
    const { run, processos, log } = montar();
    const resultado = run(ENTRADA);
    await esvaziar();
    processos[0].stderr.emit('data', Buffer.from('Invalid data found when processing input'));
    processos[0].sai(1);

    const err = await erroDe(resultado);
    expect(err.code).toBe('MEDIA_PROCESSING_FAILED');
    expect(err.meta).toEqual({ operation: 'probe', reason: 'exit_code', exitCode: 1 });
    expect(log.warn).toHaveBeenCalledOnce();
    expect(log.warn.mock.calls[0][0]).toMatchObject({ operation: 'probe', exitCode: 1, stderr: 'Invalid data found when processing input' });
  });

  it('trunca o stderr em 2 KiB e o manda só para o log, nunca para o erro', async () => {
    const { run, processos, log } = montar();
    const resultado = run(ENTRADA);
    await esvaziar();
    processos[0].stderr.emit('data', Buffer.alloc(1500, 'a'));
    processos[0].stderr.emit('data', Buffer.alloc(1500, 'b'));
    processos[0].sai(1);

    const err = await erroDe(resultado);
    const stderr = log.warn.mock.calls[0][0].stderr as string;
    expect(stderr).toHaveLength(2048);
    expect(stderr).toBe('a'.repeat(1500) + 'b'.repeat(548));
    expect(JSON.stringify(err.meta)).not.toContain('aaa');
    expect(err.message).not.toContain('aaa');
  });

  it('mata com SIGKILL quando passa do tempo e falha com motivo timeout', async () => {
    vi.useFakeTimers();
    const { run, processos } = montar();
    const falha = erroDe(run({ ...ENTRADA, timeoutMs: 1000 }));
    await vi.advanceTimersByTimeAsync(999);
    expect(processos[0].kill).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(processos[0].kill).toHaveBeenCalledWith('SIGKILL');

    const err = await falha;
    expect(err.meta).toMatchObject({ operation: 'probe', reason: 'timeout' });
  });

  it('não mata o processo que termina antes do tempo', async () => {
    vi.useFakeTimers();
    const { run, processos } = montar();
    const resultado = run({ ...ENTRADA, timeoutMs: 1000 });
    await vi.advanceTimersByTimeAsync(10);
    processos[0].sai(0);
    await expect(resultado).resolves.toEqual(Buffer.alloc(0));

    await vi.advanceTimersByTimeAsync(5000);
    expect(processos[0].kill).not.toHaveBeenCalled();
  });

  it('mata e falha quando o stdout passa do teto em memória', async () => {
    const { run, processos } = montar();
    const resultado = run({ ...ENTRADA, maxStdoutBytes: 4 });
    await esvaziar();
    processos[0].stdout.emit('data', Buffer.from('1234'));
    expect(processos[0].kill).not.toHaveBeenCalled();
    processos[0].stdout.emit('data', Buffer.from('5'));
    expect(processos[0].kill).toHaveBeenCalledWith('SIGKILL');

    const err = await erroDe(resultado);
    expect(err.meta).toMatchObject({ reason: 'stdout_limit' });
  });

  it('entrega o stdout em pedaços ao consumidor, sem acumular nem aplicar o teto', async () => {
    const { run, processos } = montar();
    const pedacos: string[] = [];
    const resultado = run({
      ...ENTRADA,
      maxStdoutBytes: 1,
      onStdout: (chunk) => pedacos.push(chunk.toString()),
    });
    await esvaziar();
    processos[0].stdout.emit('data', Buffer.from('abc'));
    processos[0].stdout.emit('data', Buffer.from('def'));
    processos[0].sai(0);

    await expect(resultado).resolves.toEqual(Buffer.alloc(0));
    expect(pedacos).toEqual(['abc', 'def']);
    expect(processos[0].kill).not.toHaveBeenCalled();
  });

  it('falha uma vez só quando o binário não pode ser iniciado', async () => {
    const { run, processos, log } = montar();
    const resultado = run(ENTRADA);
    await esvaziar();
    processos[0].emit('error', Object.assign(new Error('spawn ffprobe ENOENT'), { code: 'ENOENT' }));
    processos[0].emit('close', -2, null);

    const err = await erroDe(resultado);
    expect(err.meta).toMatchObject({ operation: 'probe', reason: 'spawn_failed' });
    expect(log.warn).toHaveBeenCalledOnce();
    expect(log.warn.mock.calls[0][0]).toMatchObject({ errorCode: 'ENOENT' });
  });

  it('falha quando o spawn lança na hora', async () => {
    const { run, spawn } = montar({ concurrency: 1 });
    spawn.mockImplementationOnce(() => {
      throw new TypeError('argumento inválido');
    });
    const err = await erroDe(run(ENTRADA));
    expect(err.meta).toMatchObject({ reason: 'spawn_failed' });

    // a vaga do semáforo voltou
    const segundo = run(ENTRADA);
    await esvaziar();
    expect(spawn).toHaveBeenCalledTimes(2);
    void segundo.catch(() => undefined);
  });

  it('o semáforo limita processos simultâneos e libera a vaga ao terminar', async () => {
    const { run, spawn, processos } = montar({ concurrency: 2 });
    const execucoes = [1, 2, 3].map(() => run(ENTRADA));
    await esvaziar();
    expect(spawn).toHaveBeenCalledTimes(2);

    processos[0].sai(0);
    await esvaziar();
    expect(spawn).toHaveBeenCalledTimes(3);

    processos[1].sai(0);
    processos[2].sai(0);
    await expect(Promise.all(execucoes)).resolves.toHaveLength(3);
  });

  it('libera a vaga mesmo quando o processo falha', async () => {
    const { run, spawn, processos } = montar({ concurrency: 1 });
    const primeiro = run(ENTRADA);
    const segundo = run(ENTRADA);
    await esvaziar();
    expect(spawn).toHaveBeenCalledTimes(1);

    processos[0].sai(1);
    await erroDe(primeiro);
    await esvaziar();
    expect(spawn).toHaveBeenCalledTimes(2);

    processos[1].sai(0);
    await expect(segundo).resolves.toEqual(Buffer.alloc(0));
  });
});
