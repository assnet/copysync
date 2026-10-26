import { describe, it, expect, vi } from 'vitest';
import { AnthropicTextAdapter } from './AnthropicTextAdapter';
import { OpenAiCompatibleTextAdapter } from './OpenAiCompatibleTextAdapter';
import { createAiTextProviderAdapterFactory } from './AiTextProviderAdapterFactory';
import { DnsAiBaseUrlGuard, type LookupAllFn } from './DnsAiBaseUrlGuard';
import type { FetchFn } from './httpAiErrors';

const call = { apiKey: 'sk-key-abc', model: 'claude-haiku-5-5', system: 'sys', prompt: 'hello', maxOutputTokens: 64 };

const respond = (status: number, body: unknown = {}) =>
  vi.fn<FetchFn>(async () => new Response(JSON.stringify(body), { status }));

describe.each([
  ['Anthropic', (f: FetchFn) => new AnthropicTextAdapter(f)],
  ['OpenAI', (f: FetchFn) => new OpenAiCompatibleTextAdapter({ baseUrl: 'https://api.openai.com/v1', maxTokensParam: 'max_completion_tokens', fetchFn: f })],
  ['Groq', (f: FetchFn) => new OpenAiCompatibleTextAdapter({ baseUrl: 'https://api.groq.com/openai/v1', maxTokensParam: 'max_tokens', fetchFn: f })],
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
    expect(init?.redirect).toBe('error');
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

describe('OpenAiCompatibleTextAdapter (OpenAI)', () => {
  it('monta Chat Completions e lê o primeiro choice', async () => {
    const f = respond(200, { choices: [{ message: { content: 'Oi' } }], usage: { prompt_tokens: 7, completion_tokens: 2 } });
    expect(await new OpenAiCompatibleTextAdapter({ baseUrl: 'https://api.openai.com/v1', maxTokensParam: 'max_completion_tokens', fetchFn: f }).generate({ ...call, model: 'gpt-4o-mini' }))
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

const ok = () => respond(200, { choices: [{ message: { content: 'Oi' } }] });
const body = (f: ReturnType<typeof respond>) => JSON.parse(String(f.mock.calls[0]![1]?.body));

describe('fábrica por catálogo', () => {
  it.each([
    ['OPENAI', 'https://api.openai.com/v1/chat/completions', 'max_completion_tokens'],
    ['GEMINI', 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', 'max_tokens'],
    ['XAI', 'https://api.x.ai/v1/chat/completions', 'max_tokens'],
    ['DEEPSEEK', 'https://api.deepseek.com/chat/completions', 'max_tokens'],
    ['GROQ', 'https://api.groq.com/openai/v1/chat/completions', 'max_tokens'],
    ['MISTRAL', 'https://api.mistral.ai/v1/chat/completions', 'max_tokens'],
    ['OPENROUTER', 'https://openrouter.ai/api/v1/chat/completions', 'max_tokens'],
  ] as const)('%s → %s com %s', async (kind, url, param) => {
    const f = ok();
    const lookup = vi.fn<LookupAllFn>();
    await createAiTextProviderAdapterFactory(f, new DnsAiBaseUrlGuard(lookup))({ kind, baseUrl: 'https://ignored.example.com' }).generate(call);
    expect(f.mock.calls[0]![0]).toBe(url);
    const b = body(f);
    expect(b[param]).toBe(64);
    expect(Object.keys(b)).toHaveLength(3);
    expect(lookup).not.toHaveBeenCalled();
  });

  it('ANTHROPIC usa a Messages API', async () => {
    const f = respond(200, { content: [] });
    await createAiTextProviderAdapterFactory(f)({ kind: 'ANTHROPIC', baseUrl: null }).generate(call);
    expect(f.mock.calls[0]![0]).toBe('https://api.anthropic.com/v1/messages');
  });

  it('OPENAI_COMPATIBLE: URL do cadastro, max_tokens e DNS conferido antes de cada chamada', async () => {
    const f = ok();
    let n = 0;
    const lookup = vi.fn<LookupAllFn>(async () => [{ address: n++ === 0 ? '8.8.8.8' : '10.0.0.7', family: 4 }]);
    const make = createAiTextProviderAdapterFactory(f, new DnsAiBaseUrlGuard(lookup));
    const target = { kind: 'OPENAI_COMPATIBLE' as const, baseUrl: 'https://llm.example.com/v1' };
    await make(target).generate(call);
    expect(f.mock.calls[0]![0]).toBe('https://llm.example.com/v1/chat/completions');
    expect(body(f).max_tokens).toBe(64);
    // rebinding: o mesmo host agora resolve para rede privada → recusa sem chamar o provedor
    await expect(make(target).generate(call)).rejects.toMatchObject({ code: 'AI_PROVIDER_REJECTED', statusCode: 422 });
    expect(f).toHaveBeenCalledTimes(1);
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it('OPENAI_COMPATIBLE: DNS falhando → 503; sem URL → 422 sem rede', async () => {
    const f = ok();
    const fail = vi.fn<LookupAllFn>(async () => { throw new Error('ENOTFOUND'); });
    const make = createAiTextProviderAdapterFactory(f, new DnsAiBaseUrlGuard(fail));
    await expect(make({ kind: 'OPENAI_COMPATIBLE', baseUrl: 'https://x.example.com' }).generate(call))
      .rejects.toMatchObject({ code: 'AI_PROVIDER_UNAVAILABLE', meta: { reason: 'dns' } });
    await expect(make({ kind: 'OPENAI_COMPATIBLE', baseUrl: null }).generate(call)).rejects.toMatchObject({ code: 'AI_PROVIDER_REJECTED' });
    expect(f).not.toHaveBeenCalled();
  });
});
