import { describe, expect, it, vi } from 'vitest';
import { buildM2MCanonical, signM2MCanonical } from '../../../../shared/http/m2m/m2mSignature';
import { HubEmailSender } from './HubEmailSender';
import { toHubEmailBody } from './hubEmailMapping';

const config = { hubUrl: 'https://hub.example.com', applicationKey: 'copysync', secret: 'm2m-secret' };
const NOW = Date.parse('2026-11-06T12:00:00Z');
const setPassword = { to: 'ana@example.com', template: 'SET_PASSWORD', data: { name: 'Ana', link: 'https://app.example.com/invite/tok', expiresAt: '2026-11-13T12:00:00Z' } };

function reply(status: number, body: unknown = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function sender(fetchFn: ReturnType<typeof vi.fn>, hubUrl = config.hubUrl) {
  const sleep = vi.fn().mockResolvedValue(undefined);
  return { s: new HubEmailSender({ ...config, hubUrl }, { fetchFn: fetchFn as unknown as typeof fetch, sleep }), sleep };
}

describe('toHubEmailBody', () => {
  it('SET_PASSWORD: link → setPasswordUrl, expiresAt → expiresInHours', () => {
    expect(toHubEmailBody(setPassword, NOW)).toEqual({
      template: 'SET_PASSWORD', to: 'ana@example.com',
      vars: { name: 'Ana', setPasswordUrl: 'https://app.example.com/invite/tok', expiresInHours: 168 },
    });
  });

  it('TEAM_INVITE: link → inviteUrl, tenantName → workspaceName, locale repassado', () => {
    const body = toHubEmailBody({ to: 'b@example.com', template: 'TEAM_INVITE', locale: 'pt-BR', data: { link: 'https://x/i', tenantName: 'Loja', expiresAt: '2026-11-07T12:00:00Z' } }, NOW);
    expect(body).toEqual({ template: 'TEAM_INVITE', to: 'b@example.com', locale: 'pt-BR', vars: { inviteUrl: 'https://x/i', workspaceName: 'Loja', expiresInHours: 24 } });
  });

  it('SESSION_DISCONNECTED: link → reconnectUrl', () => {
    const body = toHubEmailBody({ to: 'c@example.com', template: 'SESSION_DISCONNECTED', data: { name: 'Caio', sessionName: 'Loja 1', disconnectedAt: '06/11 12:00', link: 'https://x/s' } }, NOW);
    expect(body?.vars).toEqual({ name: 'Caio', sessionName: 'Loja 1', disconnectedAt: '06/11 12:00', reconnectUrl: 'https://x/s' });
  });

  it('descarta chave fora da allowlist, tipo inválido e tira "<"/">"', () => {
    const body = toHubEmailBody({ to: 'a@x.com', template: 'SET_PASSWORD', data: { name: '<b>Ana</b>', extra: 'x', link: { a: 1 }, supportUrl: 'https://evil' } }, NOW);
    expect(body?.vars).toEqual({ name: 'bAna/b' });
  });

  it('template sem equivalente na central → null', () => {
    expect(toHubEmailBody({ to: 'a@x.com', template: 'WELCOME', data: {} })).toBeNull();
  });
});

describe('HubEmailSender', () => {
  it('202 → sent; assina POST /integrations/email/send com o corpo exato', async () => {
    const fetchFn = vi.fn().mockResolvedValue(reply(202, { id: 'e1', status: 'QUEUED' }));
    const { s } = sender(fetchFn);
    await expect(s.send(setPassword)).resolves.toEqual({ sent: true });

    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://hub.example.com/integrations/email/send');
    const h = init.headers as Record<string, string>;
    expect(h['Content-Type']).toBe('application/json');
    expect(h['X-Application-Key']).toBe('copysync');
    expect(h['X-Timestamp']).toMatch(/^\d{10}$/);
    expect(h['X-Nonce']).toMatch(/^[0-9a-f-]{36}$/);
    const canonical = buildM2MCanonical({ method: 'POST', path: '/integrations/email/send', timestamp: h['X-Timestamp'], nonce: h['X-Nonce'], body: init.body as string });
    expect(h['X-Signature']).toBe(signM2MCanonical('m2m-secret', canonical));
    expect(JSON.parse(init.body as string)).toMatchObject({ template: 'SET_PASSWORD', to: 'ana@example.com' });
  });

  it('path base do HUB_API_URL entra na URL e na canônica', async () => {
    const fetchFn = vi.fn().mockResolvedValue(reply(202, { id: 'e1' }));
    const { s } = sender(fetchFn, 'https://hub.example.com/api/');
    await s.send(setPassword);
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://hub.example.com/api/integrations/email/send');
    const h = init.headers as Record<string, string>;
    const canonical = buildM2MCanonical({ method: 'POST', path: '/api/integrations/email/send', timestamp: h['X-Timestamp'], nonce: h['X-Nonce'], body: init.body as string });
    expect(h['X-Signature']).toBe(signM2MCanonical('m2m-secret', canonical));
  });

  it.each([400, 401, 403, 409, 429])('%i → sent:false sem retry', async (status) => {
    const fetchFn = vi.fn().mockResolvedValue(reply(status, { code: 'X' }));
    const { s, sleep } = sender(fetchFn);
    await expect(s.send(setPassword)).resolves.toEqual({ sent: false });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('5xx e erro de rede repetem com nonce novo até 3 tentativas', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(reply(503))
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(reply(202, { id: 'e1' }));
    const { s, sleep } = sender(fetchFn);
    await expect(s.send(setPassword)).resolves.toEqual({ sent: true });
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    const nonces = fetchFn.mock.calls.map(([, init]) => (init as RequestInit & { headers: Record<string, string> }).headers['X-Nonce']);
    expect(new Set(nonces).size).toBe(3);
  });

  it('5xx persistente → sent:false após 3 tentativas', async () => {
    const fetchFn = vi.fn().mockImplementation(async () => reply(500));
    const { s } = sender(fetchFn);
    await expect(s.send(setPassword)).resolves.toEqual({ sent: false });
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it('template sem equivalente não chama a central', async () => {
    const fetchFn = vi.fn();
    const { s } = sender(fetchFn);
    await expect(s.send({ to: 'a@x.com', template: 'WELCOME', data: {} })).resolves.toEqual({ sent: false });
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
