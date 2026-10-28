# Aviso de credencial de afiliado no monitoramento — Specification

Status: **implementado** (api 0.43.0 · app 0.49.0, 2026-10-28). T1–T13 feitos; migrations e repositórios validados em Postgres descartável (`pnpm -C api test:int`, 4 testes). `test:int` não roda no CI: gate manual de release. Roadmap: item 4 Monitoramento + item 3 Credenciais de afiliado (`docs/produto-roadmap.md`).
Docs base: `docs/monitoramento-grupos.md` §2.1, `docs/integracoes-credenciais-afiliado.md`.

## Problem Statement

Quando a sessão do Mercado Livre expira (ou a chave da Shopee é recusada), cada oferta capturada falha com o texto
genérico "Não foi possível gerar o seu link", o monitoramento continua chamando a API da loja a cada captura, e a
credencial segue marcada como configurada. O usuário só descobre olhando captura por captura. Loja nunca configurada
tem o mesmo problema: só aparece dentro da lista, como "Ignorada".

## Goals

- [ ] Captura com credencial recusada mostra motivo próprio ("sessão expirada / chave recusada") e a loja fica
      **pausada** até o usuário reconfigurar: capturas dessa loja saem `SKIPPED` sem chamar a API.
- [ ] Monitoramento mostra aviso fixo por loja (sem credencial / recusada) com atalho para Credenciais de afiliado.
- [ ] Tela de credenciais mostra o estado "Recusada"; some ao corrigir o que foi recusado (secret/AppID novo na Shopee, token novo do ML pela extensão).
- [ ] Outras lojas não são afetadas (pausa é por `provider`).

## Out of Scope

| Feature | Reason |
| --- | --- |
| Validar credencial ativamente (ping periódico na loja) | Custo de rede e risco de bloqueio; a rejeição real já chega pelo uso |
| Reprocessar capturas automaticamente ao salvar credencial nova | Já existe "Tentar de novo" por captura; automático pode reenviar oferta vencida |
| Notificação por e-mail/WhatsApp | Item 13 do roadmap (notificações), fora daqui |
| Aviso no gerador de ofertas | Lá credencial ausente só desliga a verificação (`GenerateOfferUseCase.ts:116-118`); comportamento diferente, fica para depois |
| Amazon | Link é montado localmente (`?tag=`), nunca é recusado |

---

## User Stories

### P1: Loja pausada com motivo claro ⭐ MVP

**User Story**: Como operador, quero que uma credencial recusada pela loja marque a loja como recusada e pare de
tentar, para saber o que houve e não queimar a API.

**Acceptance Criteria**:
1. WHEN a loja responde credencial recusada (`AFFILIATE_CREDENTIAL_REJECTED`) ao gerar o link de uma captura
   THEN o sistema SHALL gravar `rejectedAt`/`rejectedCode` na credencial do tenant/loja
   AND marcar a captura `SKIPPED / CREDENTIAL_REJECTED` com `marketplace`.
2. WHEN existe credencial com `rejectedAt` preenchido para a loja da captura
   THEN o sistema SHALL marcar a captura `SKIPPED / CREDENTIAL_REJECTED` **sem** chamar a API da loja.
3. WHEN a loja responde rate limit ou indisponível (`AFFILIATE_API_RATE_LIMITED`, `AFFILIATE_API_UNAVAILABLE`)
   THEN o sistema SHALL manter `FAILED / LINK_RESOLVE_FAILED` (transitório, retryable) e **não** marcar a credencial.
4. WHEN o usuário salva a credencial pelo painel (`PUT /integrations/affiliate-credentials/:provider`)
   THEN o sistema SHALL zerar `rejectedAt`/`rejectedCode` **só para loja sem sessão** (`!providerUsesSession`,
   Shopee) **e só se algo mudou**: secret novo validado (variável local `secret !== null`,
   `UpsertAffiliateCredentialUseCase.ts:32-39`; `input.secret` chega `undefined`/`''`, nunca `null`) **ou**
   `publicIdentifier` diferente do existente (Shopee recusa também por AppID errado). Para ML
   (`providerUsesSession`) o painel só grava a etiqueta e a rejeição é da sessão: nunca limpa; só token novo (4b).
4b. WHEN a extensão sincroniza a sessão (`PUT /extension/marketplaces/ml/session` → `UpsertAffiliateSessionUseCase`;
   também `PUT /integrations/affiliate-credentials/:provider/session`) THEN o sistema SHALL zerar a rejeição **só se o
   token mudou** (`changed` já calculado em `UpsertAffiliateSessionUseCase.ts:43`). A extensão ressincroniza os mesmos
   cookies por alarme/startup; sem essa regra a loja voltaria a ser chamada a cada sync.
4c. WHEN a sessão é removida (`ClearAffiliateSessionUseCase` / "Desconectar") THEN a rejeição SHALL ser zerada junto:
   sem sessão o estado volta a "não conectado", não "recusada".
5. WHEN a captura é `SKIPPED / CREDENTIAL_REJECTED` THEN "Tentar de novo" SHALL estar disponível (reason retryable).

**Independent Test**: fake de links devolve `failed` com `code: 'AFFILIATE_CREDENTIAL_REJECTED'` → credencial fica
rejeitada; segunda captura da mesma loja sai `SKIPPED` sem o fake ser chamado; captura de outra loja segue normal.

---

### P1: Aviso no monitoramento ⭐ MVP

**User Story**: Como operador, quero ver no topo do monitoramento quais lojas estão sem credencial ou recusadas,
para corrigir antes de perder mais ofertas.

**Acceptance Criteria**:
1. WHEN `GET /api/automation/group-monitoring/config?sessionId` é chamado THEN a resposta SHALL incluir
   `credentialAlerts: { provider, kind: 'MISSING' | 'REJECTED', since: string | null }[]`, só com lojas em alerta.
2. WHEN `kind = 'REJECTED'` THEN a entrada SHALL existir para toda credencial do tenant com `rejectedAt` preenchido.
   **No máximo um alerta por loja**: com `rejectedAt`, é `REJECTED` mesmo que também haja capturas `CREDENTIAL_MISSING`
   recentes (ex.: credencial `INACTIVE` + rejeitada).
3. WHEN `kind = 'MISSING'` THEN a entrada SHALL existir para toda loja **sem credencial utilizável** que tenha ao
   menos uma captura `SKIPPED / CREDENTIAL_MISSING` nos últimos 7 dias para o tenant (evita avisar loja que o usuário
   nunca recebe). Utilizável = o mesmo que o gerador de link exige: `ACTIVE` + `publicIdentifier` + secret quando
   `providerRequiresSecret` + sessão quando `providerUsesSession` (`affiliateProviderFields.ts:36-42`,
   `BuildTenantAffiliateLinkUseCase.ts:78,84-85`). `since` é `null` para MISSING e `rejectedAt` para REJECTED.
4. WHEN `credentialAlerts` não está vazio THEN a página de monitoramento SHALL mostrar um `Alert` por loja
   (severity `warning` para MISSING, `error` para REJECTED) com texto da loja e botão "Configurar credencial"
   que navega para `/settings/affiliate-credentials?returnTo=/monitoring`.
5. WHEN `credentialAlerts` está vazio THEN nenhum bloco SHALL ser renderizado.
6. WHEN a tela de credenciais abre com `returnTo` válido (`safeReturnPath`) THEN SHALL mostrar botão "Voltar ao
   monitoramento" e limpar o parâmetro da URL ao recarregar (mesmo padrão de `SessionsPage.tsx:23-49`).

**Independent Test**: tenant com credencial ML rejeitada e capturas Shopee `CREDENTIAL_MISSING` → resposta traz 2
alertas; página mostra 2 `Alert`s; sem alertas, nada aparece.

---

### P2: Estado "Recusada" na tela de credenciais

**User Story**: Como operador, quero ver na tela de credenciais que a loja foi recusada e quando, para saber que
preciso reconectar.

**Acceptance Criteria**:
1. WHEN a credencial tem `rejectedAt` THEN `GET /integrations/affiliate-credentials` SHALL expor `rejectedAt`
   e `rejectedCode`.
2. WHEN `rejectedAt` presente THEN o card SHALL mostrar status "Recusada" (cor `error`) com data e dica
   "Reconecte pela extensão" (ML) ou "Confira AppID e secret" (Shopee).
3. WHEN o usuário corrige a credencial (Shopee: secret ou AppID novo pelo painel; ML: token novo pela extensão)
   THEN o card SHALL voltar a "Configurado". Salvar sem mudar nada mantém "Recusada".
4. WHEN o usuário só reativa (`PATCH /:provider/status` INACTIVE→ACTIVE) THEN a rejeição SHALL permanecer: reativar
   não troca a chave/sessão recusada. Só salvar (`PUT /:provider` ou `PUT /:provider/session`) limpa.

---

## Edge Cases

- WHEN a credencial é `INACTIVE` (pausa manual) THEN captura segue `SKIPPED / CREDENTIAL_MISSING` como hoje e
  entra em `credentialAlerts` como `MISSING` (o usuário pausou; aviso lembra). Se além de `INACTIVE` tiver
  `rejectedAt`, prevalece `REJECTED` (leitura por `findByTenantAndProvider`, não pelo `findActive…`).
- WHEN a credencial é apagada entre resolver e marcar THEN `markRejected` SHALL ser no-op (`updateMany`), sem erro.
- WHEN a rejeição chega durante a leitura da página "social" do ML (`mlRefFromPage`) THEN SHALL tratar igual
  (mesmo `catch`).
- WHEN duas capturas da mesma loja são processadas no mesmo tick e ambas recebem rejeição THEN a segunda gravação
  de `rejectedAt` SHALL ser idempotente (sobrescreve data; sem erro de unicidade).
- WHEN a credencial é apagada (`DELETE /:provider`) THEN o alerta REJECTED some junto (linha some) e, havendo
  capturas recentes, vira MISSING.
- WHEN `rejectedAt` existe mas a loja é AMAZON THEN SHALL nunca acontecer (Amazon não chama API); nenhum tratamento.
- WHEN o ML responde HTTP 200 com erro por item (`MercadoLivreAffiliateClient.ts:150-170`, array `errors`) THEN o
  sistema SHALL manter `FAILED / LINK_RESOLVE_FAILED` (hoje `failed/AFFILIATE_LINK_NOT_CREATED`): o código por item
  que indica sessão expirada não é conhecido. **Limitação registrada**: só 401/403 do ML e código 10020 da Shopee
  marcam rejeição. O log já guarda `errorCode` por item; revisar após observar em produção.

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| CRED-01 | P1 Loja pausada: gravar rejeição na credencial | Design | Pending |
| CRED-02 | P1 Loja pausada: reason `CREDENTIAL_REJECTED` na captura, retryable | Design | Pending |
| CRED-03 | P1 Loja pausada: curto-circuito sem chamar API | Design | Pending |
| CRED-04 | P1 Loja pausada: transitórios continuam `LINK_RESOLVE_FAILED` | Design | Pending |
| CRED-05 | P1 Loja pausada: salvar credencial zera rejeição | Design | Pending |
| CRED-06 | P1 Aviso: `credentialAlerts` no `GET /monitoring/config` | Design | Pending |
| CRED-07 | P1 Aviso: `Alert` por loja na página com atalho e volta | Design | Pending |
| CRED-08 | P2 Tela de credenciais: expor e mostrar "Recusada" | Design | Pending |

---

## Cobertura de teste (lacuna aceita)

Regras que vivem no repositório Prisma (`markRejected`, `clearSession` zerando, `setStatus` mantendo, `upsert*` com
`clearRejection`) só têm teste de integração (`pnpm -C api test:int`, Postgres descartável, T9), que não roda no CI.
É gate manual de release. Use cases e fluxo de captura têm teste unitário na suíte padrão.

## Success Criteria

- [ ] Sessão ML expirada → após a 1ª captura recusada, zero chamadas ao ML até a extensão enviar um token **diferente**
      ou o usuário salvar pelo painel (teste de unidade conta chamadas, inclusive após sync com os mesmos cookies).
- [ ] Operador vê o aviso no monitoramento sem abrir a lista de capturas.
- [ ] Shopee/Amazon seguem gerando link enquanto ML está recusado.
