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

## Catálogo de provedores

Fonte única: `assistants/domain/services/aiProviderCatalog.ts` (função pura). Painel lê `GET /api/ai/catalog`
(super admin: `/api/admin/ai/catalog`) — **não** duplique a lista no front; lá só ficam nome exibido e link da chave
(`app/src/features/ai/aiProviders.ts`, textos em `strings.ts`). Novo provedor = valor no enum Prisma `AiProviderKind`
(migration) + entrada no catálogo + texto/link no painel.

| Tipo | Protocolo | URL base | Modelo padrão | Teto | Tenant |
| --- | --- | --- | --- | --- | --- |
| `ANTHROPIC` | Messages | `https://api.anthropic.com` | `claude-haiku-5-5` | `max_tokens` | sim |
| `OPENAI` | Chat Completions | `https://api.openai.com/v1` | `gpt-4o-mini` | `max_completion_tokens` | sim |
| `GEMINI` | Chat Completions | `https://generativelanguage.googleapis.com/v1beta/openai` | `gemini-3.5-flash-lite` | `max_tokens` | sim |
| `XAI` | Chat Completions | `https://api.x.ai/v1` | `grok-4.20-0309-non-reasoning` ¹ | `max_tokens` | sim |
| `DEEPSEEK` | Chat Completions | `https://api.deepseek.com` | `deepseek-flash` | `max_tokens` | sim |
| `GROQ` | Chat Completions | `https://api.groq.com/openai/v1` | `llama-3.3-70b-versatile` | `max_tokens` | sim |
| `MISTRAL` | Chat Completions | `https://api.mistral.ai/v1` | `mistral-small-latest` ¹ | `max_tokens` | sim |
| `OPENROUTER` | Chat Completions | `https://openrouter.ai/api/v1` | `openai/gpt-4o-mini` ¹ | `max_tokens` | sim |
| `OPENAI_COMPATIBLE` | Chat Completions | do cadastro (`baseUrl`) | — (obrigatório) | `max_tokens` | **não** |

¹ Não verificado na doc do provedor em 2026-10-26 (marcado `// não verificado` no código). Modelo padrão só é usado
quando o cadastro deixa o campo vazio; o painel sugere e o usuário pode trocar.

## Adapters

`fetch` + timeout 30 s, sem SDK, `redirect: 'error'` (nunca segue redirect). Corpo de erro do provedor nunca é lido.
- `AnthropicTextAdapter`: `POST /v1/messages`, `anthropic-version: 2026-10-21` (thinking desligado no Haiku 5.x).
- `OpenAiCompatibleTextAdapter(baseUrl)`: `POST ${baseUrl}/chat/completions`, `Authorization: Bearer`. Vários
  compatíveis recusam `max_completion_tokens`; por isso só a OpenAI recebe esse nome.
- `AiTextProviderAdapterFactory`: escolhe pelo `protocol` do catálogo; recebe `{ kind, baseUrl }` (`AiAdapterTarget`).

## Endpoint próprio (`OPENAI_COMPATIBLE`) e SSRF

Só o super admin cadastra; só `ai_platform_providers.baseUrl` guarda URL (nos outros tipos o campo é ignorado/null).
Tenant que envia `OPENAI_COMPATIBLE` recebe 400 (schema) / 422 `AI_CREDENTIAL_INVALID` `meta.field='kind'` (use case).

Regras (`domain/services/customBaseUrl.ts`, 422 `AI_CREDENTIAL_INVALID` com `meta.field='baseUrl'`):
- `https:` apenas, porta padrão (443 ou nenhuma), sem userinfo, sem query/fragmento, até 300 caracteres;
- sem IP literal (v4, v6, formas numéricas que o WHATWG normaliza, ex. `0x7f.1`);
- sem `localhost`, host sem ponto, `*.local`, `*.internal`, `*.localhost`, `*.localdomain`, `*.home.arpa`;
- DNS (`DnsAiBaseUrlGuard`, `dns.lookup` com `all: true`): **todos** os endereços precisam ser públicos — bloqueia
  loopback, RFC 1918, CGNAT `100.64/10`, link-local (inclui `169.254.169.254`), multicast, reservados, ULA `fc00::/7`,
  `fe80::/10`, NAT64, IPv4 mapeado em IPv6 (conferido nas regras IPv4). Falha de DNS ao salvar também é 422.
- A checagem de DNS roda **de novo antes de cada chamada** (DNS rebinding): bloqueado → `AI_PROVIDER_REJECTED`;
  DNS fora → `AI_PROVIDER_UNAVAILABLE` (`reason: dns`). Resta a janela entre essa consulta e a do `fetch` (TOCTOU);
  fixar o IP no socket exigiria um dispatcher próprio do undici — não fazer sem revisar esta seção.

Não: aceitar `http:`, liberar porta, aceitar URL do tenant, seguir redirect, logar a URL com chave.

## Rotas

- Super admin (`authHook` + `superAdminHook`) `/api/admin/ai`: `GET /catalog`, `GET/PUT /settings`, `GET/POST /providers`,
  `PATCH/DELETE /providers/:id`, `POST /providers/:id/test`.
- Tenant (`authHook` + `tenantHook`) `/api/ai`: `GET /catalog`, `GET /status`, `PUT/DELETE /credential`, `POST /credential/test`.
- Painel: `/admin/ai` (menu só para `isSuperAdmin`) e `Configurações → Inteligência artificial` (`/settings/ai`).

## Segredos

Chaves cifradas com `ISecretCipher` (AES-256-GCM, `CREDENTIALS_ENCRYPTION_KEY`). AAD `platform:ai:<id>` e
`<tenantId>:ai:apikey`. Respostas só trazem `hasKey`/`masked` fixo (`••••`). Nunca logar corpo dessas rotas. Sem
`CREDENTIALS_ENCRYPTION_KEY` → `SECRET_CIPHER_UNAVAILABLE`; o painel do super admin diz qual variável configurar, o
do tenant mostra mensagem genérica.

## Pendências

- Auditoria vai para log estruturado `ai:audit` (o enum `AuditAction` do Prisma não tem `AI_*`; precisa de migration).
- Fixar o IP resolvido no `fetch` do endpoint próprio (hoje há TOCTOU entre a checagem de DNS e a conexão).
