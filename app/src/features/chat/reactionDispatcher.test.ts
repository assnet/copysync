import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { MessageReactionResultApiDto } from '@/types/chat.api.types';
import { classifyReactionError, createReactionDispatcher, type ReactionDispatchEvent } from './reactionDispatcher';

const result = (messageId: string): MessageReactionResultApiDto => ({
  messageId,
  conversationId: 'c1',
  reactionsRevision: new Date().toISOString(),
  reactions: [],
});

describe('despachante de reações', () => {
  let send: ReturnType<typeof vi.fn<(id: string, emoji: string | null) => Promise<MessageReactionResultApiDto>>>;

  beforeEach(() => {
    vi.useFakeTimers();
    send = vi.fn((id: string) => Promise.resolve(result(id)));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const setup = () => createReactionDispatcher({ send });

  it('três cliques seguidos viram um envio só, com o último, 400 ms depois do último clique', async () => {
    const d = setup();
    d.enqueue('m1', '❤️', null);
    await vi.advanceTimersByTimeAsync(100);
    d.enqueue('m1', '😂', null);
    await vi.advanceTimersByTimeAsync(100);
    d.enqueue('m1', '👍', null);
    await vi.advanceTimersByTimeAsync(399);
    expect(send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('m1', '👍');
  });

  it('sair da página e voltar antes do envio: um envio só, no horário normal', async () => {
    const d = setup();
    const first: ReactionDispatchEvent[] = [];
    const unsubscribe = d.subscribe((e) => first.push(e));
    d.enqueue('m1', '👍', null);
    unsubscribe(); // desmontou: nada de flush
    await vi.advanceTimersByTimeAsync(200);
    expect(send).not.toHaveBeenCalled();

    const second: ReactionDispatchEvent[] = [];
    d.subscribe((e) => second.push(e));
    await vi.advanceTimersByTimeAsync(200);
    expect(send).toHaveBeenCalledTimes(1);
    expect(first).toEqual([]);
    expect(second.map((e) => e.type)).toEqual(['sent', 'success']);
  });

  it('reset() antes do horário cancela o envio', async () => {
    const d = setup();
    d.enqueue('m1', '👍', null);
    await vi.advanceTimersByTimeAsync(300);
    d.reset();
    await vi.advanceTimersByTimeAsync(5000);
    expect(send).not.toHaveBeenCalled();
  });

  it('reset() com envio em voo descarta o resultado', async () => {
    let resolve!: (v: MessageReactionResultApiDto) => void;
    send.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
    const d = setup();
    const events: ReactionDispatchEvent[] = [];
    d.subscribe((e) => events.push(e));
    d.enqueue('m1', '👍', null);
    await vi.advanceTimersByTimeAsync(400);
    d.reset();
    resolve(result('m1'));
    await vi.advanceTimersByTimeAsync(0);
    expect(events.map((e) => e.type)).toEqual(['sent']);
  });

  it('nunca envia menos de 1000 ms depois do envio anterior da mesma mensagem', async () => {
    const d = setup();
    d.enqueue('m1', '👍', null);
    await vi.advanceTimersByTimeAsync(400);
    expect(send).toHaveBeenCalledTimes(1);
    const firstAt = Date.now();

    d.enqueue('m1', '❤️', null);
    await vi.advanceTimersByTimeAsync(400); // quieto, mas só 400 ms desde o envio
    expect(send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(599);
    expect(send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(send).toHaveBeenCalledTimes(2);
    expect(Date.now() - firstAt).toBeGreaterThanOrEqual(1000);
  });

  it('mensagens diferentes não disputam o mesmo intervalo', async () => {
    const d = setup();
    d.enqueue('m1', '👍', null);
    d.enqueue('m2', '👍', null);
    await vi.advanceTimersByTimeAsync(400);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('vai e volta até a base do servidor não envia e descarta os cliques', async () => {
    const d = setup();
    const events: ReactionDispatchEvent[] = [];
    d.subscribe((e) => events.push(e));
    const server = { revision: 'r', reactions: [{ emoji: '👍', count: 1, reactedByMe: true, reactors: [] }] };
    const a = d.enqueue('m1', null, server);
    const b = d.enqueue('m1', '👍', server);
    await vi.advanceTimersByTimeAsync(1000);
    expect(send).not.toHaveBeenCalled();
    expect(events).toEqual([{ type: 'discarded', messageId: 'm1', requestIds: [a, b] }]);
  });

  it('erro sem inscrito vai para console.warn com messageId e código', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    send.mockRejectedValueOnce(Object.assign(new Error('x'), { status: 429 }));
    const d = setup();
    d.enqueue('m1', '👍', null);
    await vi.advanceTimersByTimeAsync(400);
    expect(warn).toHaveBeenCalledWith(expect.any(String), { messageId: 'm1', code: 'rate_limited' });
  });
});

describe('classifyReactionError', () => {
  it('traduz 429, sessão desconectada e o resto', () => {
    expect(classifyReactionError({ status: 429 })).toBe('rate_limited');
    expect(classifyReactionError({ status: 409, code: 'SESSION_NOT_CONNECTED' })).toBe('session_disconnected');
    expect(classifyReactionError({ status: 409, code: 'CONFLICT' })).toBe('failed');
    expect(classifyReactionError(new Error('rede'))).toBe('failed');
  });
});
