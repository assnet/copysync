/** Espelha o enum Prisma `AiProviderKind` sem importar `@prisma/client`. */
export const AI_PROVIDER_KINDS = [
  'ANTHROPIC',
  'OPENAI',
  'GEMINI',
  'XAI',
  'DEEPSEEK',
  'GROQ',
  'MISTRAL',
  'OPENROUTER',
  'OPENAI_COMPATIBLE',
] as const;
export type AiProviderKind = (typeof AI_PROVIDER_KINDS)[number];

/** Origem da chave usada numa chamada. Espelha `AiUsageSource`. */
export type AiUsageSource = 'PLATFORM' | 'TENANT';

/** Modo efetivo de IA de um tenant, como o painel mostra. */
export type AiMode = 'PLATFORM' | 'TENANT' | 'NONE';
