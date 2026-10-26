import { describe, it, expect, beforeEach } from 'vitest';
import { UpdateAiSettingsUseCase } from './AiSettingsUseCases';
import { CreateAiPlatformProviderUseCase, DeleteAiPlatformProviderUseCase, UpdateAiPlatformProviderUseCase } from './AiPlatformProviderUseCases';
import { DeleteTenantAiCredentialUseCase, UpsertTenantAiCredentialUseCase } from './TenantAiCredentialUseCases';
import { TestAiPlatformProviderUseCase, TestTenantAiCredentialUseCase } from './TestAiProviderUseCases';
import { cipher, FakeAudit, FakeBaseUrlGuard, FakeCredentials, FakeProviders, FakeSettings } from './aiTestFakes';
import { platformProviderAad, tenantCredentialAad } from '../../domain/services/aiProviderDefaults';
import { AiProviderRejectedError } from '../../../../shared/errors/internal/AiErrors';

let audit: FakeAudit;
beforeEach(() => { audit = new FakeAudit(); });

describe('UpdateAiSettingsUseCase', () => {
  it('recusa desligar os dois modos (422) e não grava', async () => {
    const repo = new FakeSettings();
    const uc = new UpdateAiSettingsUseCase(repo, audit);
    await expect(uc.execute({ platformEnabled: false, tenantKeysEnabled: false, userId: 'u' }))
      .rejects.toMatchObject({ code: 'AI_MODES_BOTH_DISABLED', statusCode: 422 });
    expect(repo.value).toEqual({ platformEnabled: true, tenantKeysEnabled: true });
    expect(audit.calls).toHaveLength(0);
  });

  it('grava um modo desligado e audita', async () => {
    const repo = new FakeSettings();
    await new UpdateAiSettingsUseCase(repo, audit).execute({ platformEnabled: false, tenantKeysEnabled: true, userId: 'u' });
    expect(repo.value.platformEnabled).toBe(false);
    expect(audit.calls[0]?.action).toBe('AI_SETTINGS_UPDATED');
  });
});

describe('provedores da plataforma', () => {
  it('cria com id gerado antes da cifra, modelo padrão e audita sem chave', async () => {
    const repo = new FakeProviders();
    const p = await new CreateAiPlatformProviderUseCase(repo, cipher, audit, new FakeBaseUrlGuard(), () => 'fixed-id')
      .execute({ userId: 'u', kind: 'ANTHROPIC', label: ' Principal ', apiKey: '  sk-ant-secret-1  ' });
    expect(p).toMatchObject({ id: 'fixed-id', label: 'Principal', model: 'claude-haiku-5-5', enabled: true, hasKey: true });
    expect(cipher().decrypt(repo.rows.get('fixed-id')!.key, platformProviderAad('fixed-id'))).toBe('sk-ant-secret-1');
    expect(JSON.stringify(audit.calls)).not.toContain('sk-ant-secret-1');
  });

  it('cria sem chave → 422 com field apiKey', async () => {
    const uc = new CreateAiPlatformProviderUseCase(new FakeProviders(), cipher, audit, new FakeBaseUrlGuard());
    await expect(uc.execute({ userId: 'u', kind: 'OPENAI', label: 'x', apiKey: '   ' }))
      .rejects.toMatchObject({ code: 'AI_CREDENTIAL_INVALID', meta: { field: 'apiKey' } });
  });

  it('PATCH sem chave mantém a atual; com chave troca; 404 inexistente', async () => {
    const repo = new FakeProviders();
    repo.add({ id: 'p1' }, 'sk-old-key-123');
    const uc = new UpdateAiPlatformProviderUseCase(repo, cipher, audit, new FakeBaseUrlGuard());
    await uc.execute({ userId: 'u', id: 'p1', priority: 3, apiKey: '' });
    expect(cipher().decrypt(repo.rows.get('p1')!.key, platformProviderAad('p1'))).toBe('sk-old-key-123');
    expect(repo.rows.get('p1')!.p.priority).toBe(3);
    await uc.execute({ userId: 'u', id: 'p1', apiKey: 'sk-new-key-456' });
    expect(cipher().decrypt(repo.rows.get('p1')!.key, platformProviderAad('p1'))).toBe('sk-new-key-456');
    await expect(uc.execute({ userId: 'u', id: 'nope', enabled: false })).rejects.toMatchObject({ statusCode: 404 });
    await expect(new DeleteAiPlatformProviderUseCase(repo, audit).execute({ userId: 'u', id: 'nope' }))
      .rejects.toMatchObject({ code: 'AI_PLATFORM_PROVIDER_NOT_FOUND' });
  });

  it('teste: sucesso → ok; erro do provedor → ok false com código', async () => {
    const repo = new FakeProviders();
    repo.add({ id: 'p1' }, 'sk-probe-key-1');
    const seen: string[] = [];
    let fail = false;
    const adapter = {
      generate: async (c: { apiKey: string; maxOutputTokens: number }) => {
        seen.push(`${c.apiKey}:${c.maxOutputTokens}`);
        if (fail) throw new AiProviderRejectedError(401);
        return { text: '', inputTokens: 1, outputTokens: 1 };
      },
    };
    const uc = new TestAiPlatformProviderUseCase(repo, cipher, () => adapter);
    expect(await uc.execute('p1')).toEqual({ ok: true });
    fail = true;
    expect(await uc.execute('p1')).toEqual({ ok: false, errorCode: 'AI_PROVIDER_REJECTED' });
    expect(seen[0]).toBe('sk-probe-key-1:16');
  });
});

describe('credencial do tenant', () => {
  it('criação exige chave; edição sem chave mantém; troca de tipo exige chave', async () => {
    const repo = new FakeCredentials();
    const uc = new UpsertTenantAiCredentialUseCase(repo, cipher, audit);
    const base = { tenantId: 't1', userId: 'u' };
    await expect(uc.execute({ ...base, kind: 'OPENAI' })).rejects.toMatchObject({ meta: { field: 'apiKey' } });

    const created = await uc.execute({ ...base, kind: 'OPENAI', apiKey: 'sk-tenant-key-1' });
    expect(created).toMatchObject({ kind: 'OPENAI', model: 'gpt-4o-mini', enabled: true });
    expect(cipher().decrypt(repo.rows.get('t1')!.key, tenantCredentialAad('t1'))).toBe('sk-tenant-key-1');

    await uc.execute({ ...base, kind: 'OPENAI', model: 'gpt-4.1-mini', apiKey: '' });
    expect(repo.rows.get('t1')!.c.model).toBe('gpt-4.1-mini');
    expect(cipher().decrypt(repo.rows.get('t1')!.key, tenantCredentialAad('t1'))).toBe('sk-tenant-key-1');

    await expect(uc.execute({ ...base, kind: 'ANTHROPIC' })).rejects.toMatchObject({ code: 'AI_CREDENTIAL_INVALID' });
    await expect(uc.execute({ ...base, kind: 'OPENAI', model: 'bad model!' })).rejects.toMatchObject({ meta: { field: 'model' } });
    expect(JSON.stringify(audit.calls)).not.toContain('sk-tenant-key-1');
  });

  it('DELETE inexistente → 404; teste sem credencial → 404', async () => {
    const repo = new FakeCredentials();
    await expect(new DeleteTenantAiCredentialUseCase(repo, audit).execute({ tenantId: 't1', userId: 'u' }))
      .rejects.toMatchObject({ code: 'AI_CREDENTIAL_NOT_FOUND', statusCode: 404 });
    const adapter = { generate: async () => ({ text: 'OK', inputTokens: null, outputTokens: null }) };
    await expect(new TestTenantAiCredentialUseCase(repo, cipher, () => adapter).execute('t1'))
      .rejects.toMatchObject({ statusCode: 404 });
    repo.add('t1');
    expect(await new TestTenantAiCredentialUseCase(repo, cipher, () => adapter).execute('t1')).toEqual({ ok: true });
  });
});

describe('endpoint próprio (OPENAI_COMPATIBLE)', () => {
  const base = { userId: 'u', kind: 'OPENAI_COMPATIBLE' as const, label: 'Próprio', apiKey: 'sk-custom-key-1', model: 'my-model' };

  it('cria com URL normalizada e consulta o DNS; tipos fixos ignoram baseUrl', async () => {
    const repo = new FakeProviders();
    const guard = new FakeBaseUrlGuard();
    const uc = new CreateAiPlatformProviderUseCase(repo, cipher, audit, guard, () => 'c1');
    const p = await uc.execute({ ...base, baseUrl: ' https://API.Example.com/v1/ ' });
    expect(p.baseUrl).toBe('https://api.example.com/v1');
    expect(guard.checked).toEqual(['https://api.example.com/v1']);
    const fixed = await new CreateAiPlatformProviderUseCase(repo, cipher, audit, guard, () => 'c2')
      .execute({ ...base, kind: 'GEMINI', model: undefined, baseUrl: 'https://evil.example.com' });
    expect(fixed).toMatchObject({ baseUrl: null, model: 'gemini-3.5-flash-lite' });
  });

  it.each([
    [undefined], ['http://api.example.com/v1'], ['https://10.0.0.1/v1'], ['https://[::1]/v1'],
    ['https://user:pw@api.example.com'], ['https://api.example.com:8443/v1'], ['https://localhost/v1'],
    ['https://svc.internal/v1'], ['https://printer.local'], ['https://api.example.com/v1?x=1'],
    [`https://a.example.com/${'x'.repeat(300)}`],
  ])('URL inválida %s → 422 field baseUrl', async (baseUrl) => {
    const uc = new CreateAiPlatformProviderUseCase(new FakeProviders(), cipher, audit, new FakeBaseUrlGuard());
    await expect(uc.execute({ ...base, baseUrl })).rejects.toMatchObject({ code: 'AI_CREDENTIAL_INVALID', statusCode: 422, meta: { field: 'baseUrl' } });
  });

  it('DNS privado ou sem resposta → 422 field baseUrl', async () => {
    for (const verdict of ['blocked', 'unresolvable'] as const) {
      const uc = new CreateAiPlatformProviderUseCase(new FakeProviders(), cipher, audit, new FakeBaseUrlGuard(verdict));
      await expect(uc.execute({ ...base, baseUrl: 'https://api.example.com/v1' })).rejects.toMatchObject({ meta: { field: 'baseUrl' } });
    }
  });

  it('modelo é obrigatório (sem padrão no catálogo)', async () => {
    const uc = new CreateAiPlatformProviderUseCase(new FakeProviders(), cipher, audit, new FakeBaseUrlGuard());
    await expect(uc.execute({ ...base, model: '', baseUrl: 'https://api.example.com/v1' })).rejects.toMatchObject({ meta: { field: 'model' } });
  });

  it('PATCH troca a URL validando de novo', async () => {
    const repo = new FakeProviders();
    repo.add({ id: 'p1', kind: 'OPENAI_COMPATIBLE', model: 'm', baseUrl: 'https://a.example.com/v1' });
    const guard = new FakeBaseUrlGuard();
    const uc = new UpdateAiPlatformProviderUseCase(repo, cipher, audit, guard);
    expect((await uc.execute({ userId: 'u', id: 'p1', baseUrl: 'https://b.example.com/v1' })).baseUrl).toBe('https://b.example.com/v1');
    guard.verdict = 'blocked';
    await expect(uc.execute({ userId: 'u', id: 'p1', baseUrl: 'https://c.example.com/v1' })).rejects.toMatchObject({ meta: { field: 'baseUrl' } });
    expect(repo.rows.get('p1')!.p.baseUrl).toBe('https://b.example.com/v1');
  });

  it('tenant não pode usar OPENAI_COMPATIBLE; pode usar os demais do catálogo', async () => {
    const repo = new FakeCredentials();
    const uc = new UpsertTenantAiCredentialUseCase(repo, cipher, audit);
    await expect(uc.execute({ tenantId: 't1', userId: 'u', kind: 'OPENAI_COMPATIBLE', model: 'm', apiKey: 'sk-tenant-key-1' }))
      .rejects.toMatchObject({ code: 'AI_CREDENTIAL_INVALID', statusCode: 422, meta: { field: 'kind' } });
    expect(repo.rows.size).toBe(0);
    expect(await uc.execute({ tenantId: 't1', userId: 'u', kind: 'GROQ', apiKey: 'gsk-tenant-key-1' }))
      .toMatchObject({ kind: 'GROQ', model: 'llama-3.3-70b-versatile' });
  });

  it('teste repassa kind e baseUrl ao resolvedor de adapter', async () => {
    const repo = new FakeProviders();
    repo.add({ id: 'p1', kind: 'OPENAI_COMPATIBLE', model: 'm', baseUrl: 'https://a.example.com/v1' });
    const targets: unknown[] = [];
    const adapter = { generate: async () => ({ text: 'OK', inputTokens: null, outputTokens: null }) };
    await new TestAiPlatformProviderUseCase(repo, cipher, (t) => { targets.push(t); return adapter; }).execute('p1');
    expect(targets).toEqual([{ kind: 'OPENAI_COMPATIBLE', baseUrl: 'https://a.example.com/v1' }]);
  });
});
