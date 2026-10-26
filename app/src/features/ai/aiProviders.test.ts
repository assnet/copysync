import { describe, it, expect } from 'vitest';
import type { AiCatalogItem } from '@/types/api.types';
import { AI_KEY_CONSOLE_URLS, aiProviderName, isSuggestedModel, suggestedModel } from './aiProviders';
import { aiErrorCodeMessage, aiErrorField, aiStrings } from './strings';

const catalog: AiCatalogItem[] = [
  { kind: 'ANTHROPIC', label: 'Anthropic', defaultModel: 'claude-haiku-5-5', requiresBaseUrl: false, tenantAllowed: true },
  { kind: 'GEMINI', label: 'Google Gemini', defaultModel: 'gemini-3.5-flash-lite', requiresBaseUrl: false, tenantAllowed: true },
  { kind: 'OPENAI_COMPATIBLE', label: 'OpenAI-compatible', defaultModel: null, requiresBaseUrl: true, tenantAllowed: false },
];

describe('aiProviders', () => {
  it('nome exibido vem dos textos do painel', () => {
    expect(aiProviderName('OPENAI_COMPATIBLE', catalog)).toBe('Outro (compatível com OpenAI)');
    expect(aiProviderName('OPENAI')).toBe('OpenAI (ChatGPT, Codex)');
  });

  it('modelo sugerido segue o catálogo; endpoint próprio não sugere', () => {
    expect(suggestedModel(catalog, 'GEMINI')).toBe('gemini-3.5-flash-lite');
    expect(suggestedModel(catalog, 'OPENAI_COMPATIBLE')).toBe('');
    expect(isSuggestedModel('claude-haiku-5-5', catalog)).toBe(true);
    expect(isSuggestedModel(' ', catalog)).toBe(true);
    expect(isSuggestedModel('meu-modelo', catalog)).toBe(false);
  });

  it('todo provedor com chave do cliente tem link de console em https', () => {
    for (const url of Object.values(AI_KEY_CONSOLE_URLS)) expect(url).toMatch(/^https:\/\//);
    expect(AI_KEY_CONSOLE_URLS.OPENAI_COMPATIBLE).toBeUndefined();
  });
});

describe('mensagens de erro de IA', () => {
  it('SECRET_CIPHER_UNAVAILABLE detalhado só para o super admin', () => {
    expect(aiErrorCodeMessage('SECRET_CIPHER_UNAVAILABLE', 'admin')).toContain('CREDENTIALS_ENCRYPTION_KEY');
    expect(aiErrorCodeMessage('SECRET_CIPHER_UNAVAILABLE')).toBe(aiStrings.errors.SECRET_CIPHER_UNAVAILABLE);
    expect(aiErrorCodeMessage('AI_PROVIDER_REJECTED', 'admin')).toBe(aiStrings.errors.AI_PROVIDER_REJECTED);
    expect(aiErrorCodeMessage(null, 'admin')).toBe(aiStrings.errors.generic);
  });

  it('aiErrorField lê o campo anexado pelo apiClient', () => {
    expect(aiErrorField({ code: 'AI_CREDENTIAL_INVALID', field: 'baseUrl' })).toBe('baseUrl');
    expect(aiErrorField(new Error('x'))).toBeNull();
  });
});
