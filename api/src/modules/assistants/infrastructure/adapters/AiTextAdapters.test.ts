import { describe, it, expect, vi } from 'vitest';
import { AnthropicTextAdapter } from './AnthropicTextAdapter';
import { OpenAiTextAdapter } from './OpenAiTextAdapter';
import type { FetchFn } from './httpAiErrors';

const call = { apiKey: 'sk-key-abc', model: 'claude-haiku-5-5', system: 'sys', prompt: 'hello', maxOutputTokens: 64 };

const respond = (status: number, body: unknown = {}) =>
  vi.fn<FetchFn>(async () => new Response(JSON.stringify(body), { status }));

describe.each([
  ['Anthropic', (f: FetchFn) => new AnthropicTextAdapter(f)],
  ['OpenAI', (f: FetchFn) => new OpenAiTextAdapter(f)],
])('%s: mapeamento de erros', (_name, make) => {
  it.each([
    [401, 'AI_PROVIDER_REJECTED', 422],
    [403, 'AI_PROVIDER_REJECTED', 422],
    [404, 'AI_PROVIDER_REJECTED', 422],
    [429, 'AI_PROVIDER_RATE_LIMITED', 429],
    [500, 'AI_PROVIDER_UNAVAILABLE', 503],
    [529, 'AI_PROVIDER_UNAVAILABLE', 503],
  ])('HTTP %i → %s', async (status, code, statusCode) => {
    const err = await make(respond(status, { error: { message: 'sk-key-abc leaked?' } })).generate(call).catch((e) => e);
    expect(err).toMatchObject({ code, statusCode });
    expect(JSON.stringify({ m: err.message, meta: err.meta })).not.toContain('sk-key-abc');
  });

  it('timeout → 503', async () => {
    const f = vi.fn<FetchFn>(async () => { throw new DOMException('timed out', 'TimeoutError'); });
    await expect(make(f).generate(call)).rejects.toMatchObject({ code: 'AI_PROVIDER_UNAVAILABLE', meta: { reason: 'timeout' } });
  });

  it('falha de rede → 503', async () => {
    const f = vi.fn<FetchFn>(async () => { throw new TypeError('fetch failed'); });
    await expect(make(f).generate(call)).rejects.toMatchObject({ code: 'AI_PROVIDER_UNAVAILABLE', meta: { reason: 'network' } });
  });
});

describe('AnthropicTextAdapter', () => {
  it('monta a requisição da Messages API e junta os blocos de texto', async () => {
    const f = respond(200, {
      content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: 'Olá ' }, { type: 'text', text: 'mundo' }],
      usage: { input_tokens: 10, output_tokens: 4 },
    });
    expect(await new AnthropicTextAdapter(f).generate(call)).toEqual({ text: 'Olá mundo', inputTokens: 10, outputTokens: 4 });
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(init?.headers).toMatchObject({ 'x-api-key': 'sk-key-abc', 'anthropic-version': '2026-10-21' });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(String(init?.body))).toEqual({
      model: 'claude-haiku-5-5', max_tokens: 64, system: 'sys',
      messages: [{ role: 'user', content: 'hello' }], thinking: { type: 'disabled' },
    });
  });

  it('não envia thinking para outros modelos', async () => {
    const f = respond(200, { content: [] });
    await new AnthropicTextAdapter(f).generate({ ...call, model: 'claude-sonnet-5-5' });
    expect(JSON.parse(String(f.mock.calls[0]![1]?.body))).not.toHaveProperty('thinking');
  });
});

describe('OpenAiTextAdapter', () => {
  it('monta Chat Completions e lê o primeiro choice', async () => {
    const f = respond(200, { choices: [{ message: { content: 'Oi' } }], usage: { prompt_tokens: 7, completion_tokens: 2 } });
    expect(await new OpenAiTextAdapter(f).generate({ ...call, model: 'gpt-4o-mini' }))
      .toEqual({ text: 'Oi', inputTokens: 7, outputTokens: 2 });
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(init?.headers).toMatchObject({ authorization: 'Bearer sk-key-abc' });
    expect(JSON.parse(String(init?.body))).toEqual({
      model: 'gpt-4o-mini', max_completion_tokens: 64,
      messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: 'hello' }],
    });
  });
});
