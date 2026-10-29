import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProbeLinkDomainUseCase, type ProbeFetch, type ProbeHostGuard } from './ProbeLinkDomainUseCase';
import { FakeLinkDomainRepository } from './linkDomainTestFakes';
import { createProbeToken, PROBE_TOKEN_TTL_MS, verifyProbeToken } from './probeToken';

const SECRET = 's'.repeat(32);
const NOW = new Date('2026-10-29T12:00:00Z');
const okGuard: ProbeHostGuard = { check: async () => 'ok' };

let repo: FakeLinkDomainRepository;
let domainId: string;
beforeEach(() => {
  repo = new FakeLinkDomainRepository();
  domainId = repo.seed({ hostname: 'copysync.com.br' }).id;
});

const build = (fetch: ProbeFetch, guard: ProbeHostGuard = okGuard, timeoutMs?: number) =>
  new ProbeLinkDomainUseCase(repo, { secret: SECRET, guard, fetch, now: () => NOW, randomHex: () => 'abcdef12', timeoutMs });

describe('ProbeLinkDomainUseCase', () => {
  it('usa o hostname do registro, sem redirect nem credencial; 204 → ok', async () => {
    const fetch = vi.fn<ProbeFetch>(async () => ({ status: 204 }));
    const input = { id: domainId, hostname: '169.254.169.254' } as { id: string };
    const r = await build(fetch).execute(input);
    const [url, init] = fetch.mock.calls[0]!;
    const u = new URL(url);
    expect(u.hostname).toBe('probe-abcdef12.copysync.com.br');
    expect(u.pathname).toBe('/.well-known/link-rotation');
    expect(verifyProbeToken(u.searchParams.get('token')!, { domainId, hostname: 'copysync.com.br' }, NOW, SECRET)).toBe(true);
    expect(init).toMatchObject({ redirect: 'manual', credentials: 'omit', method: 'GET' });
    expect(r).toMatchObject({ ok: true, status: 204 });
    expect(repo.rows.get(domainId)).toMatchObject({ lastProbeOk: true, lastProbeAt: NOW });
  });

  it('IP privado → recusado sem fetch', async () => {
    const fetch = vi.fn<ProbeFetch>();
    const r = await build(fetch, { check: async () => 'blocked' }).execute({ id: domainId });
    expect(fetch).not.toHaveBeenCalled();
    expect(r).toMatchObject({ ok: false, reason: 'BLOCKED_ADDRESS' });
    expect(repo.rows.get(domainId)?.lastProbeOk).toBe(false);
  });

  it('3xx → falha REDIRECT', async () => {
    const r = await build(async () => ({ status: 301 })).execute({ id: domainId });
    expect(r).toMatchObject({ ok: false, reason: 'REDIRECT', status: 301 });
  });

  it('200 → falha (só 204 vale)', async () => {
    expect(await build(async () => ({ status: 200 })).execute({ id: domainId })).toMatchObject({ ok: false, reason: 'UNEXPECTED_STATUS' });
  });

  it('timeout → falha TIMEOUT', async () => {
    const hang: ProbeFetch = (_u, init) =>
      new Promise((_, reject) => init.signal!.addEventListener('abort', () => reject(new Error('aborted'))));
    const r = await build(hang, okGuard, 10).execute({ id: domainId });
    expect(r).toMatchObject({ ok: false, reason: 'TIMEOUT' });
    expect(repo.probes).toHaveLength(1);
  });

  it('sem segredo → 503; domínio inexistente → 404', async () => {
    const noSecret = new ProbeLinkDomainUseCase(repo, { secret: undefined, guard: okGuard });
    await expect(noSecret.execute({ id: domainId })).rejects.toMatchObject({ statusCode: 503 });
    await expect(build(async () => ({ status: 204 })).execute({ id: 'nope' })).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('verifyProbeToken', () => {
  const subject = { domainId: 'd1', hostname: 'copysync.com.br' };
  const token = createProbeToken(subject, NOW, SECRET);

  it('válido dentro de 5 min', () => {
    expect(verifyProbeToken(token, subject, new Date(NOW.getTime() + PROBE_TOKEN_TTL_MS - 1000), SECRET)).toBe(true);
  });

  it('expirado', () => {
    expect(verifyProbeToken(token, subject, new Date(NOW.getTime() + PROBE_TOKEN_TTL_MS + 1000), SECRET)).toBe(false);
  });

  it('adulterado: assinatura, domínio, host, segredo ou formato', () => {
    const [exp, sig] = token.split('.');
    const flipped = `${exp}.${sig!.slice(0, -1)}${sig!.endsWith('A') ? 'B' : 'A'}`;
    expect(verifyProbeToken(flipped, subject, NOW, SECRET)).toBe(false);
    expect(verifyProbeToken(`${Number(exp) + 60}.${sig}`, subject, NOW, SECRET)).toBe(false);
    expect(verifyProbeToken(token, { ...subject, domainId: 'd2' }, NOW, SECRET)).toBe(false);
    expect(verifyProbeToken(token, { ...subject, hostname: 'evil.com' }, NOW, SECRET)).toBe(false);
    expect(verifyProbeToken(token, subject, NOW, 'o'.repeat(32))).toBe(false);
    expect(verifyProbeToken('lixo', subject, NOW, SECRET)).toBe(false);
  });
});
