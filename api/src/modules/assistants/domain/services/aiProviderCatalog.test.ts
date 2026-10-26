import { describe, it, expect } from 'vitest';
import { AI_PROVIDER_CATALOG, aiProviderCatalogEntry } from './aiProviderCatalog';
import { AI_PROVIDER_KINDS } from '../enums/AiProviderKind';

describe('aiProviderCatalog', () => {
  it('cobre todo o enum, na ordem', () => {
    expect(AI_PROVIDER_CATALOG.map((e) => e.kind)).toEqual([...AI_PROVIDER_KINDS]);
  });

  it('URLs fixas em https sem barra final; só o endpoint próprio pede URL e fica fora do tenant', () => {
    for (const e of AI_PROVIDER_CATALOG) {
      if (e.kind === 'OPENAI_COMPATIBLE') {
        expect(e).toMatchObject({ baseUrl: null, defaultModel: null, requiresBaseUrl: true, tenantAllowed: false, protocol: 'openai' });
        continue;
      }
      expect(e.baseUrl).toMatch(/^https:\/\/[^/]+(\/.*[^/])?$/);
      expect(e.defaultModel).toBeTruthy();
      expect(e).toMatchObject({ requiresBaseUrl: false, tenantAllowed: true });
    }
  });

  it('protocolo e parâmetro de teto por provedor', () => {
    expect(aiProviderCatalogEntry('ANTHROPIC')).toMatchObject({ protocol: 'anthropic', defaultModel: 'claude-haiku-5-5' });
    expect(aiProviderCatalogEntry('OPENAI')).toMatchObject({ protocol: 'openai', maxTokensParam: 'max_completion_tokens' });
    for (const k of ['GEMINI', 'XAI', 'DEEPSEEK', 'GROQ', 'MISTRAL', 'OPENROUTER', 'OPENAI_COMPATIBLE'] as const) {
      expect(aiProviderCatalogEntry(k)).toMatchObject({ protocol: 'openai', maxTokensParam: 'max_tokens' });
    }
  });
});
