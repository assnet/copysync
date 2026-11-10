import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IExtensionLifecycleRepository, LifecycleWrite } from '../../domain/contracts/IExtensionLifecycleRepository';
import type { IExtensionInstallationRepository } from '../../domain/contracts/IExtensionInstallationRepository';
import type { IExtensionSessionRepository } from '../../domain/contracts/IExtensionSessionRepository';
import type { ExtensionInstallation } from '../../domain/entities/ExtensionInstallation';
import { RecordStoreClickUseCase } from './RecordStoreClickUseCase';
import { RecordLifecycleSignalUseCase } from './RecordLifecycleSignalUseCase';
import { RecordUninstallUseCase, sanitizeFeedbackComment, normalizeReasons } from './RecordUninstallUseCase';
import { IssueExtensionSessionUseCase } from './IssueExtensionSessionUseCase';

const NOW = new Date('2026-11-07T12:00:00.000Z');
const INST = '6f1c2a4e-1b2c-4d5e-8f90-123456789abc';
const EXT_ID = 'nokcbnoicaebghagbhlfcbepheohdgnd';

function lifecycleRepo(overrides: Partial<IExtensionLifecycleRepository> = {}) {
  const writes: LifecycleWrite[] = [];
  const repo: IExtensionLifecycleRepository = {
    record: vi.fn(async (w: LifecycleWrite) => { writes.push(w); return { created: true }; }),
    recordStoreClick: vi.fn(async (w) => { writes.push(w); return { recorded: true, id: 'click-1' }; }),
    attributeStoreClick: vi.fn(async () => null),
    findClientKeyForTenant: vi.fn(async () => 'central-user-1'),
    findTenantForInstallation: vi.fn(async () => 'tenant-1'),
    upsertUninstallFeedback: vi.fn(async () => true),
    ...overrides,
  };
  return { repo, writes };
}

function installation(over: Partial<ExtensionInstallation> = {}): ExtensionInstallation {
  return {
    installationId: INST, extensionId: EXT_ID, channel: 'cs-ext', deviceId: null, userId: null, version: '3.3.0',
    status: 'ACTIVE', firstSeenAt: NOW, installedAt: NOW, lastSeenAt: NOW, lastHeartbeatAt: null, lastSiteSeenAt: null,
    uninstalledAt: null, previousInstallationId: null, createdAt: NOW, updatedAt: NOW, ...over,
  };
}

function installationRepo(row: ExtensionInstallation | null) {
  let current = row;
  const repo: IExtensionInstallationRepository = {
    findById: vi.fn(async () => current),
    findByDeviceAndExtension: vi.fn(async () => []),
    upsert: vi.fn(async (i) => (current = installation({ ...current, ...i, userId: i.userId ?? null, deviceId: i.deviceId ?? null }))),
    updateStatus: vi.fn(async () => {}),
    updateLastSeen: vi.fn(async () => {}),
    createUnowned: vi.fn(async (i) => { current = installation({ ...i, userId: null }); }),
    markReplaced: vi.fn(async () => {}),
  };
  return repo;
}

describe('RecordStoreClickUseCase', () => {
  it('grava STORE_CLICK sem instalação, com janela de dedupe e outbox com clientKey', async () => {
    const { repo, writes } = lifecycleRepo();
    const result = await new RecordStoreClickUseCase(repo, () => NOW).execute({ userId: 'u1', tenantId: 'tenant-1', source: 'ml_wizard' });
    expect(result).toEqual({ recorded: true });
    const w = writes[0] as LifecycleWrite & { dedupeSince: Date };
    expect(w.dedupeSince.toISOString()).toBe('2026-11-07T11:59:00.000Z');
    expect(w.event).toMatchObject({ installationId: null, type: 'STORE_CLICK', userId: 'u1', tenantId: 'tenant-1', source: 'ml_wizard' });
    expect(w.outbox).toEqual({
      type: 'extension.lifecycle',
      payload: { event: 'STORE_CLICK', occurredAt: NOW.toISOString(), installationId: null, clientKey: 'central-user-1', version: null, channel: null, source: 'ml_wizard' },
    });
  });

  it('sem clientKey (tenant sem cliente na central) não enfileira', async () => {
    const { repo, writes } = lifecycleRepo({ findClientKeyForTenant: vi.fn(async () => null) });
    await new RecordStoreClickUseCase(repo, () => NOW).execute({ userId: 'u1', tenantId: 't', source: 'settings' });
    expect(writes[0]!.outbox).toBeNull();
  });

  it('clique deduplicado devolve recorded=false', async () => {
    const { repo } = lifecycleRepo({ recordStoreClick: vi.fn(async () => ({ recorded: false, id: 'old' })) });
    expect(await new RecordStoreClickUseCase(repo, () => NOW).execute({ userId: 'u1', tenantId: 't', source: 'onboarding' }))
      .toEqual({ recorded: false });
  });
});

describe('RecordLifecycleSignalUseCase', () => {
  const signal = { installationId: INST, type: 'INSTALL', version: '3.3.0', channel: 'cs-ext', dedupeKey: 'INSTALL', extensionId: EXT_ID };

  it('INSTALL desconhecido cria linha sem dono e não vai ao outbox', async () => {
    const inst = installationRepo(null);
    const { repo, writes } = lifecycleRepo();
    expect(await new RecordLifecycleSignalUseCase(inst, repo, () => NOW).execute(signal)).toEqual({ created: true });
    expect(inst.createUnowned).toHaveBeenCalledWith(expect.objectContaining({ installationId: INST, extensionId: EXT_ID }));
    expect(writes[0]!.event).toMatchObject({ type: 'INSTALL', userId: null, tenantId: null });
    expect(writes[0]!.outbox).toBeNull();
  });

  it('INSTALL sem extensionId válido de instalação desconhecida é descartado', async () => {
    const inst = installationRepo(null);
    const { repo } = lifecycleRepo();
    expect(await new RecordLifecycleSignalUseCase(inst, repo, () => NOW).execute({ ...signal, extensionId: 'x' })).toEqual({ created: false });
    expect(inst.createUnowned).not.toHaveBeenCalled();
  });

  it('UPDATE de instalação com dono vai ao outbox e não troca a versão gravada', async () => {
    const inst = installationRepo(installation({ userId: 'u1' }));
    const { repo, writes } = lifecycleRepo();
    await new RecordLifecycleSignalUseCase(inst, repo, () => NOW).execute({ ...signal, type: 'update', version: '3.4.0', dedupeKey: 'UPDATE:3.4.0' });
    expect(writes[0]!.outbox?.payload).toMatchObject({ event: 'UPDATE', version: '3.4.0', installationId: INST, clientKey: 'central-user-1' });
    expect(inst.updateLastSeen).toHaveBeenCalledWith(INST, { lastSeenAt: NOW });
  });

  it('STARTUP fica só no banco local; sinal reativa instalação desinstalada', async () => {
    const inst = installationRepo(installation({ userId: 'u1', status: 'UNINSTALLED' }));
    const { repo, writes } = lifecycleRepo();
    await new RecordLifecycleSignalUseCase(inst, repo, () => NOW).execute({ ...signal, type: 'STARTUP', dedupeKey: 'STARTUP:1' });
    expect(writes[0]!.outbox).toBeNull();
    expect(inst.updateStatus).toHaveBeenCalledWith(INST, 'ACTIVE');
  });

  it('tipo desconhecido ou installationId inválido não grava', async () => {
    const { repo } = lifecycleRepo();
    const uc = new RecordLifecycleSignalUseCase(installationRepo(installation()), repo, () => NOW);
    expect(await uc.execute({ ...signal, type: 'HACK' })).toEqual({ created: false });
    expect(await uc.execute({ ...signal, installationId: 'abc' })).toEqual({ created: false });
    expect(repo.record).not.toHaveBeenCalled();
  });
});

describe('RecordUninstallUseCase', () => {
  it('desinstalação marca UNINSTALLED e enfileira UNINSTALL', async () => {
    const inst = installationRepo(installation({ userId: 'u1' }));
    const { repo, writes } = lifecycleRepo();
    expect(await new RecordUninstallUseCase(inst, repo, () => NOW).execute({ installationId: INST, version: '3.3.0' })).toEqual({ accepted: true });
    expect(writes.map(w => w.event.type)).toEqual(['UNINSTALL']);
    expect(writes[0]!.event.dedupeKey).toBe('UNINSTALL');
    expect(inst.updateStatus).toHaveBeenCalledWith(INST, 'UNINSTALLED');
  });

  it('pesquisa grava motivos válidos, comentário saneado e UNINSTALL_FEEDBACK com motivos (sem comentário)', async () => {
    const inst = installationRepo(installation({ userId: 'u1' }));
    const { repo, writes } = lifecycleRepo();
    await new RecordUninstallUseCase(inst, repo, () => NOW).execute({
      installationId: INST, feedback: { reasons: ['slow', 'slow', 'bogus', 'price'], comment: ' fale comigo a@b.com ' },
    });
    expect(repo.upsertUninstallFeedback).toHaveBeenCalledWith({ installationId: INST, reasons: ['slow', 'price'], comment: 'fale comigo [removido]', version: '3.3.0' });
    const fb = writes.find(w => w.event.type === 'UNINSTALL_FEEDBACK')!;
    expect(fb.outbox?.payload).toMatchObject({ event: 'UNINSTALL_FEEDBACK', reasons: ['slow', 'price'] });
    expect(JSON.stringify(fb.outbox?.payload)).not.toContain('fale comigo');
  });

  it('instalação desconhecida responde igual sem gravar; sem motivo válido recusa', async () => {
    const { repo } = lifecycleRepo();
    expect(await new RecordUninstallUseCase(installationRepo(null), repo).execute({ installationId: INST })).toEqual({ accepted: true });
    expect(repo.record).not.toHaveBeenCalled();
    expect(await new RecordUninstallUseCase(installationRepo(installation()), repo).execute({ installationId: INST, feedback: { reasons: ['x'] } }))
      .toEqual({ accepted: false });
  });

  it('saneamento: telefone removido, teto 500, vazio vira null', () => {
    expect(sanitizeFeedbackComment('ligue +55 (11) 99999-8888')).toBe('ligue [removido]');
    expect(sanitizeFeedbackComment('x'.repeat(600))).toHaveLength(500);
    expect(sanitizeFeedbackComment('   ')).toBeNull();
    expect(normalizeReasons(['other', 'other'])).toEqual(['other']);
  });
});

describe('IssueExtensionSessionUseCase — vínculo e atribuição do clique', () => {
  let sessionRepo: IExtensionSessionRepository;
  beforeEach(() => {
    sessionRepo = {
      issue: vi.fn(async (i) => ({ id: 's1', ...i })),
    } as unknown as IExtensionSessionRepository;
  });
  const input = {
    userId: 'u1', mlTenantId: 'tenant-1', installationId: INST, extVersion: '3.3.0', extensionId: EXT_ID, channel: 'cs-ext', mlSessionConsent: true,
  };
  const entitled = { hasMarketplaceExtension: vi.fn(async () => true) };

  it('primeiro vínculo atribui o clique e enfileira LINKED com storeClick', async () => {
    const clickAt = new Date('2026-11-07T11:50:00.000Z');
    const { repo, writes } = lifecycleRepo({ attributeStoreClick: vi.fn(async () => ({ id: 'click-1', occurredAt: clickAt })) });
    await new IssueExtensionSessionUseCase(sessionRepo, installationRepo(installation()), entitled, repo, () => NOW).execute(input);
    expect(repo.attributeStoreClick).toHaveBeenCalledWith('u1', INST, new Date('2026-10-31T12:00:00.000Z'));
    expect(writes[0]!.event).toMatchObject({ type: 'LINKED', dedupeKey: 'LINKED:u1', tenantId: 'tenant-1' });
    expect(writes[0]!.outbox?.payload).toMatchObject({ event: 'LINKED', storeClickId: 'click-1', storeClickAt: clickAt.toISOString() });
  });

  it('re-vínculo (inclusive a outro tenant) zera o consentimento Shein e mantém o do ML pedido', async () => {
    const { repo } = lifecycleRepo();
    await new IssueExtensionSessionUseCase(sessionRepo, installationRepo(installation({ userId: 'u1' })), entitled, repo, () => NOW)
      .execute({ ...input, mlTenantId: 'tenant-2' });
    expect(sessionRepo.issue).toHaveBeenCalledWith(expect.objectContaining({ mlTenantId: 'tenant-2', sheinConsentAt: null, mlConsentAt: NOW }));
  });

  it('revincular a mesma instalação ao mesmo usuário não gera LINKED', async () => {
    const { repo } = lifecycleRepo();
    await new IssueExtensionSessionUseCase(sessionRepo, installationRepo(installation({ userId: 'u1' })), entitled, repo, () => NOW).execute(input);
    expect(repo.record).not.toHaveBeenCalled();
  });

  it('falha da telemetria não derruba a emissão da sessão', async () => {
    const onErr = vi.fn();
    const { repo } = lifecycleRepo({ attributeStoreClick: vi.fn(async () => { throw new Error('db'); }) });
    const res = await new IssueExtensionSessionUseCase(sessionRepo, installationRepo(null), entitled, repo, () => NOW, onErr).execute(input);
    expect(res.rawToken).toBeTruthy();
    expect(onErr).toHaveBeenCalled();
  });
});
