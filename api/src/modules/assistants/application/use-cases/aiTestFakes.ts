import { SecretCipherFactory } from '../../../../shared/security/SecretCipherFactory';
import type { IAiSettingsRepository } from '../../domain/contracts/IAiSettingsRepository';
import type { IAiPlatformProviderRepository } from '../../domain/contracts/IAiPlatformProviderRepository';
import type { ITenantAiCredentialRepository } from '../../domain/contracts/ITenantAiCredentialRepository';
import type { AiUsageOutcome, AiUsageQuota, IAiUsageLogRepository } from '../../domain/contracts/IAiUsageLogRepository';
import type { IAiAuditTrail } from '../../domain/contracts/IAiAuditTrail';
import type { AiBaseUrlVerdict, IAiBaseUrlGuard } from '../../domain/contracts/IAiBaseUrlGuard';
import type { AiUsageEntry, EncryptedBlob } from '../../domain/contracts/AiRecords';
import type { AiPlatformProvider } from '../../domain/entities/AiPlatformProvider';
import type { TenantAiCredential } from '../../domain/entities/TenantAiCredential';
import type { AiSettings } from '../../domain/entities/AiSettings';
import { platformProviderAad, tenantCredentialAad } from '../../domain/services/aiProviderDefaults';

/** Dublês em memória para os testes de use case (sem banco). Cifra real, chave sintética. */
export const cipher = () => SecretCipherFactory.get();

export class FakeSettings implements IAiSettingsRepository {
  constructor(public value: AiSettings = { platformEnabled: true, tenantKeysEnabled: true }) {}
  async get() { return { ...this.value }; }
  async save(s: AiSettings) { this.value = { ...s }; return { ...s }; }
}

export class FakeProviders implements IAiPlatformProviderRepository {
  rows = new Map<string, { p: AiPlatformProvider; key: EncryptedBlob }>();

  add(p: Partial<AiPlatformProvider> & { id: string }, apiKey = 'sk-platform-123456') {
    const full: AiPlatformProvider = {
      kind: 'ANTHROPIC', label: 'Main', model: 'claude-haiku-5-5', enabled: true, priority: 0,
      dailyLimitPerTenant: null, hasKey: true, baseUrl: null, createdAt: new Date(0), updatedAt: new Date(0), ...p,
    };
    this.rows.set(p.id, { p: full, key: cipher().encrypt(apiKey, platformProviderAad(p.id)) });
    return full;
  }
  async list() { return [...this.rows.values()].map((r) => r.p).sort((a, b) => a.priority - b.priority); }
  async findById(id: string) { return this.rows.get(id)?.p ?? null; }
  async findFirstEnabled() { return (await this.list()).find((p) => p.enabled) ?? null; }
  async findKey(id: string) { return this.rows.get(id)?.key ?? null; }
  async create(r: Parameters<IAiPlatformProviderRepository['create']>[0]) {
    const p: AiPlatformProvider = {
      id: r.id, kind: r.kind, label: r.label, model: r.model, enabled: r.enabled, priority: r.priority,
      dailyLimitPerTenant: r.dailyLimitPerTenant, hasKey: true, baseUrl: r.baseUrl, createdAt: new Date(0), updatedAt: new Date(0),
    };
    this.rows.set(r.id, { p, key: r.apiKey });
    return p;
  }
  async update(id: string, r: Parameters<IAiPlatformProviderRepository['update']>[1]) {
    const row = this.rows.get(id);
    if (!row) return null;
    const { apiKey, ...fields } = r;
    row.p = { ...row.p, ...fields };
    if (apiKey) row.key = apiKey;
    return row.p;
  }
  async delete(id: string) { return this.rows.delete(id); }
}

export class FakeCredentials implements ITenantAiCredentialRepository {
  rows = new Map<string, { c: TenantAiCredential; key: EncryptedBlob }>();

  add(tenantId: string, c: Partial<TenantAiCredential> = {}, apiKey = 'sk-tenant-123456') {
    const full: TenantAiCredential = { tenantId, kind: 'OPENAI', model: 'gpt-4o-mini', enabled: true, updatedAt: new Date(0), ...c };
    this.rows.set(tenantId, { c: full, key: cipher().encrypt(apiKey, tenantCredentialAad(tenantId)) });
  }
  async find(tenantId: string) { return this.rows.get(tenantId)?.c ?? null; }
  async findKey(tenantId: string) { return this.rows.get(tenantId)?.key ?? null; }
  async upsert(r: Parameters<ITenantAiCredentialRepository['upsert']>[0]) {
    const current = this.rows.get(r.tenantId);
    const key = r.apiKey ?? current?.key;
    if (!key) throw new Error('no key');
    const c: TenantAiCredential = { tenantId: r.tenantId, kind: r.kind, model: r.model, enabled: r.enabled, updatedAt: new Date(0) };
    this.rows.set(r.tenantId, { c, key });
    return c;
  }
  async delete(tenantId: string) { return this.rows.delete(tenantId); }
}

export class FakeUsage implements IAiUsageLogRepository {
  entries: AiUsageEntry[] = [];
  /** Linhas do dia já existentes antes do teste (todas contam no teto). */
  usedToday = 0;
  failWrites = false;
  quotas: AiUsageQuota[] = [];
  private ids = new Map<string, number>();
  async record(e: AiUsageEntry) {
    if (this.failWrites) throw new Error('db down');
    this.entries.push(e);
  }
  async reserveWithinDailyLimit(e: AiUsageEntry, q: AiUsageQuota) {
    this.quotas.push(q);
    if (this.usedToday >= q.limit) return null;
    this.usedToday += 1;
    const id = `u${this.ids.size + 1}`;
    this.ids.set(id, this.entries.push({ ...e }) - 1);
    return id;
  }
  async complete(id: string, _tenantId: string, o: AiUsageOutcome) {
    if (this.failWrites) throw new Error('db down');
    Object.assign(this.entries[this.ids.get(id)!], o);
  }
}

export class FakeAudit implements IAiAuditTrail {
  calls: Array<Parameters<IAiAuditTrail['record']>[0]> = [];
  async record(input: Parameters<IAiAuditTrail['record']>[0]) { this.calls.push(input); }
}

/** Guard de DNS falso: devolve o veredito fixo e guarda as URLs consultadas. */
export class FakeBaseUrlGuard implements IAiBaseUrlGuard {
  checked: string[] = [];
  constructor(public verdict: AiBaseUrlVerdict = 'ok') {}
  async check(url: string) { this.checked.push(url); return this.verdict; }
}
