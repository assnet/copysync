# Provedores de IA

Geração de texto por IA com dois modos: **IA da plataforma** (provedores cadastrados pelo super admin) e
**chave do próprio tenant**. Módulo `api/src/modules/assistants/`. Spec: `.specs/features/offer-generator-v2/spec.md` (Parte B).

## Modos

| Setting (`platform_settings`) | Padrão | Efeito |
| --- | --- | --- |
| `ai.platform.enabled` | `true` | Tenants usam os provedores da plataforma (se o plano permitir) |
| `ai.tenant_keys.enabled` | `true` | Tenants podem cadastrar a própria chave |

**Nunca os dois desligados** (`AI_MODES_BOTH_DISABLED` 422). Modo desligado some da interface.

Resolução (`ResolveAiTextProviderUseCase`), em ordem:
1. Plataforma ligada **e** entitlement `ai_rewrite_enabled` ≠ `false` (ausente = liberado) **e** provedor ativo com chave →
   o de menor `priority`. Teto `dailyLimitPerTenant` conta `ai_usage_logs` com sucesso desde 00:00 de São Paulo →
   `AI_DAILY_LIMIT_REACHED` 429 (não cai para a chave do tenant).
2. Senão, chaves do tenant ligadas **e** `tenant_ai_credentials.enabled`.
3. Senão `AI_NOT_CONFIGURED` 409.

O tenant só vê o formulário de chave própria quando a IA da plataforma não está disponível para ele e o modo de chaves está ligado.

## Para quem consome

Use a porta `IAiTextGenerator` (`assistants/domain/contracts`) via `assistantsContainer.aiTextGenerator()`. Nunca chame
adapter direto. Toda chamada grava `ai_usage_logs` (sem prompt nem resposta). Erros: `AI_NOT_CONFIGURED` 409,
`AI_DAILY_LIMIT_REACHED` 429, `AI_PROVIDER_REJECTED` 422, `AI_PROVIDER_RATE_LIMITED` 429, `AI_PROVIDER_UNAVAILABLE` 503.
Quem consome deve ter fallback (o gerador de ofertas cai no modelo fixo).

## Adapters

`fetch` + timeout 30 s, sem SDK. Anthropic: `POST /v1/messages`, `anthropic-version: 2026-10-21`, modelo padrão
`claude-haiku-5-5` (thinking desligado para Haiku 5.x). OpenAI: Chat Completions, padrão `gpt-4o-mini`. Corpo de erro do
provedor nunca é lido para a mensagem.

## Rotas

- Super admin (`authHook` + `superAdminHook`) `/api/admin/ai`: `GET/PUT /settings`, `GET/POST /providers`,
  `PATCH/DELETE /providers/:id`, `POST /providers/:id/test`.
- Tenant (`authHook` + `tenantHook`) `/api/ai`: `GET /status`, `PUT/DELETE /credential`, `POST /credential/test`.
- Painel: `/admin/ai` (menu só para `isSuperAdmin`) e `Configurações → Inteligência artificial` (`/settings/ai`).

## Segredos

Chaves cifradas com `ISecretCipher` (AES-256-GCM, `CREDENTIALS_ENCRYPTION_KEY`). AAD `platform:ai:<id>` e
`<tenantId>:ai:apikey`. Respostas só trazem `hasKey`/`masked` fixo (`••••`). Nunca logar corpo dessas rotas.

## Pendências

- Auditoria vai para log estruturado `ai:audit` (o enum `AuditAction` do Prisma não tem `AI_*`; precisa de migration).
- Gemini e outros provedores: novo adapter + valor no enum `AiProviderKind`.
