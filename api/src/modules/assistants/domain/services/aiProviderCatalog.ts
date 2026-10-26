import { AI_PROVIDER_KINDS, type AiProviderKind } from '../enums/AiProviderKind';

/** Formato da API HTTP: Messages (Anthropic) ou Chat Completions (OpenAI e compatíveis). */
export type AiProviderProtocol = 'anthropic' | 'openai';

/** Nome do teto de saída no corpo do Chat Completions (vários compatíveis recusam o da OpenAI). */
export type AiMaxTokensParam = 'max_tokens' | 'max_completion_tokens';

export interface AiProviderCatalogEntry {
  kind: AiProviderKind;
  /** Nome do provedor (terceiro). O painel pode trocar por texto próprio. */
  label: string;
  protocol: AiProviderProtocol;
  /** null = vem do cadastro (`OPENAI_COMPATIBLE`). Sem barra final. */
  baseUrl: string | null;
  /** null = modelo obrigatório no cadastro. */
  defaultModel: string | null;
  maxTokensParam: AiMaxTokensParam;
  /** Cadastro exige `baseUrl` (só super admin). */
  requiresBaseUrl: boolean;
  /** Tenant pode usar na chave própria (nunca URL arbitrária). */
  tenantAllowed: boolean;
}

type Spec = Omit<AiProviderCatalogEntry, 'kind' | 'requiresBaseUrl' | 'tenantAllowed' | 'maxTokensParam'> &
  Partial<Pick<AiProviderCatalogEntry, 'maxTokensParam'>>;

/*
 * Conferido nas docs dos provedores em 2026-10-26, salvo onde marcado `// não verificado`.
 * Modelo padrão = barato e rápido para textos curtos; o super admin/tenant pode trocar.
 */
const SPECS: Record<AiProviderKind, Spec> = {
  ANTHROPIC: { label: 'Anthropic', protocol: 'anthropic', baseUrl: 'https://api.anthropic.com', defaultModel: 'claude-haiku-5-5' },
  OPENAI: {
    label: 'OpenAI', protocol: 'openai', baseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-4o-mini',
    maxTokensParam: 'max_completion_tokens',
  },
  GEMINI: {
    label: 'Google Gemini', protocol: 'openai',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    // 2.5 só para contas que já usavam; a doc indica 3.5 Flash-Lite para projeto novo.
    defaultModel: 'gemini-3.5-flash-lite',
  },
  // Modelo: grok-3-mini saiu da lista; Chat Completions e preço não verificados.
  XAI: { label: 'xAI', protocol: 'openai', baseUrl: 'https://api.x.ai/v1', defaultModel: 'grok-4.20-0309-non-reasoning' },
  DEEPSEEK: { label: 'DeepSeek', protocol: 'openai', baseUrl: 'https://api.deepseek.com', defaultModel: 'deepseek-flash' },
  GROQ: { label: 'Groq', protocol: 'openai', baseUrl: 'https://api.groq.com/openai/v1', defaultModel: 'llama-3.3-70b-versatile' },
  // não verificado: alias `mistral-small-latest` (a doc só lista versões datadas).
  MISTRAL: { label: 'Mistral', protocol: 'openai', baseUrl: 'https://api.mistral.ai/v1', defaultModel: 'mistral-small-latest' },
  // não verificado: id `openai/gpt-4o-mini` (base URL conferida).
  OPENROUTER: { label: 'OpenRouter', protocol: 'openai', baseUrl: 'https://openrouter.ai/api/v1', defaultModel: 'openai/gpt-4o-mini' },
  OPENAI_COMPATIBLE: { label: 'OpenAI-compatible', protocol: 'openai', baseUrl: null, defaultModel: null },
};

export const AI_PROVIDER_CATALOG: readonly AiProviderCatalogEntry[] = AI_PROVIDER_KINDS.map((kind) => ({
  kind,
  maxTokensParam: 'max_tokens' as const,
  ...SPECS[kind],
  requiresBaseUrl: SPECS[kind].baseUrl === null,
  tenantAllowed: SPECS[kind].baseUrl !== null,
}));

const BY_KIND = new Map(AI_PROVIDER_CATALOG.map((e) => [e.kind, e]));

export function aiProviderCatalogEntry(kind: AiProviderKind): AiProviderCatalogEntry {
  return BY_KIND.get(kind)!;
}
