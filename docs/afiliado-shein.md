# Afiliado Shein

Shein é o 4º marketplace no gerador, no monitoramento, na vitrine e no story, pelo caminho único de sempre
(`ResolveAffiliateProductUseCase` / `BuildTenantAffiliateLinkUseCase`). Roadmap: item 3 e tabela "Marketplaces"
de [`produto-roadmap.md`](produto-roadmap.md). Specs: `.specs/features/shein-affiliate/` (`spec`, `design`, `tasks`).
Entrou em api 0.78.0 · app 0.95.0 · extensão 3.4.0. Só `br.shein.com` e `m.shein.com/br/` (Brasil).

## Como funciona

A Shein **não tem API de afiliados**. O link nasce no servidor dela, numa chamada autenticada pela sessão do
painel `m.shein.com/br/affiliate`.

```
extensão ──cookies AT+memberId──▶ PUT /api/extension/marketplaces/shein/session
                                      │ consentimento → aceite → plano → vínculo → ID do token
                                      ▼
                         affiliate_credentials (SHEIN): sessão cifrada, publicIdentifier = memberId
                                      │
gerador / vitrine / story ─▶ ResolveAffiliateProductUseCase ─┐
monitoramento ─▶ BuildTenantAffiliateLinkUseCase ────────────┼─▶ ISheinAffiliateClient.getProductShare
                                                             │      POST m.shein.com/br/affiliate/api/goods/recommend/detailNew
                              HttpShortLinkExpander (onelink: 200 HTML → URL do produto)
```

- **Sessão**: a extensão lê os cookies `AT` (httpOnly, 30 dias) e `memberId` de `m.shein.com` e envia à API. A API
  grava a sessão cifrada (`ISecretCipher`, AAD `tenantId:SHEIN:session`).
- **ID de afiliado** = `memberId` da conta. Vem do **próprio token**: `sheinSessionMemberId(token)`
  (`integrations/domain/services/`) lê o campo `m` do payload do `AT` (2º segmento, base64url JSON) e confere com o
  cookie `memberId`. Ilegível ou divergente → 422 `AFFILIATE_CREDENTIAL_INVALID`. O ID nunca é digitado nem vem do
  corpo; na Shein ele **segue a sessão** (`providerIdentifierFollowsSession`), troca de conta troca o ID.
- **Link e dados do produto**: `SheinAffiliateClient` (`campaigns/infrastructure/http/`) chama o endpoint fixo
  `detailNew` com header `token` (= `AT`) e `siteuid: mbr`, corpo `{ language: 'pt-br', playId: 5, goodsId, uid }`.
  Uma chamada devolve `shareLink` (`onelink.shein.com/…`), nome, preço (em reais → centavos), preço cheio e foto
  (`img.ltwebstatic.com`, forçada para https). URL fixa em constante: nada vem da entrada, sem SSRF. Timeout 8 s,
  corpo ≤ 256 KiB, `redirect: 'manual'`.
- **Erros do cliente**: 401/403 ou `code 100105` → `AffiliateCredentialRejectedError`; 3xx (desafio de risco), 5xx,
  timeout, JSON inválido → `AffiliateApiUnavailableError` (não pausa a loja); outro `code ≠ 0`, ou `shareLink`
  ausente/fora de `onelink.shein.com` → `null` ("sem link"). `shareLink` é revalidado na allowlist
  (`isSupportedShareLink`) antes de virar oferta.
- **`onelink`**: `onelink.shein.com/<n>/<t>` responde 200 HTML com `<input id="url" value="…-p-<goodsId>…">`. O
  `HttpShortLinkExpander` trata esse host à parte: só GET, lê até 32 KiB, extrai o `input#url`, desfaz entidades,
  valida na allowlist e devolve essa URL **sem nova requisição**. A página do produto nunca é aberta (sem cookie cai
  em `/risk/challenge`). `HttpProductPageReader` devolve `null` para host Shein (segunda barreira).
- **Endpoints chamados** (lista fechada, só `m.shein.com/br/affiliate/api/`, URLs em constante, sempre `POST`):
  `goods/recommend/detailNew` (`SheinAffiliateClient`) e, no catálogo do Caçador de Ofertas (`SheinCatalogClient`),
  `seller/activity/category`, `seller/activity/categoryRate`, `seller/activity/goods/list`,
  `seller/activity/goods/search`. Endpoint novo só entra mudando esta lista, o `AGENTS.md` e a constante do cliente.
- **`sourceUrl`** do monitoramento = `https://br.shein.com/product-p-<goodsId>.html`, montada só com o id. É
  referência interna: nunca requisitada nem exibida como link. Todo link clicável ou enviado é o `onelink`.
- **Hosts** (`detectMarketplace.ts`): `br.shein.com`, `m.shein.com` (só caminho `/br/`), `onelink.shein.com`. Nunca
  `shein.com` inteiro. Produto pelo `pathname` `-p-<id>(-cat-N).html`. Link do próprio afiliado =
  `url_from=affiliate_koc_<memberId>`.

### Gerador, vitrine e story

Ordem fixa: **plano → credencial → aceite → chamada**. O plano é checado já na URL colada, antes de expandir
(link curto Shein não é buscado sem plano), e de novo se o redirect mudar o marketplace. Desde a api 0.81.0 o link é
sempre do tenant (regra comum aos 4 marketplaces em [`gerador-de-ofertas.md`](gerador-de-ofertas.md), "Link do
tenant"; substitui SHEIN-10/11 da spec antiga). Até a 0.80.0 link de outro afiliado era recusado com
`OFFER_LINK_NOT_OWNED` e, sem conta, o link com afiliação passava sem conferência (histórico).

| Situação | Resultado |
|---|---|
| link curto `onelink` já do tenant (`affiliate_koc_<ID do tenant>`) | mantido; 1 chamada `detailNew` só para os dados (sem `AT`: produto vazio, preenchimento manual) |
| qualquer outro (de outro afiliado, sem afiliação, link longo do tenant), conta conectada | recriado: 1 chamada `detailNew`, sai o `shareLink` (`linkRebuilt: true`); dados da mesma chamada |
| conta conectada, cliente devolve `null` ou link fora da allowlist | `OFFER_LINK_REBUILD_FAILED` (`reason = SHEIN_LINK_NOT_CREATED`) |
| sem conta conectada (ou sem `AT`) | `AFFILIATE_CREDENTIAL_REQUIRED` (422); nunca passa o link colado |
| sem `marketplace_shein_enabled` | `PLAN_FEATURE_UNAVAILABLE` (403) |
| conta conectada sem aceite da versão vigente | `MARKETPLACE_RISK_NOT_ACCEPTED` (403), sem chamar a Shein |
| sessão recusada pela Shein | erro da requisição; **não** pausa a loja (só o monitoramento marca `rejected`) |

## Observado × garantido

Tudo que descreve a Shein por dentro (endpoint, headers, corpo, formato do `AT`, HTML do `onelink`) é **observado**,
não contrato. `detailNew` é endpoint interno do painel de afiliados, sem documentação nem aviso de mudança.

| Observado em 2026-11-10 | Como |
|---|---|
| `detailNew` com `token` + `siteuid: mbr` e corpo mínimo → 200 `code "0"`; sem token → 403 `100105` | Mac (IP residencial) e **sonda no Shell da API na Render** (portão T0) |
| `onelink` por GET → 200 com `input#url`, sem login | Mac e Render |
| `AT` expira 30 dias após o login (validade do cookie) | navegador do dono |
| URL só com o id (`product-p-<id>.html`) abre o produto certo, mas passa por desafio "Eu sou humano" | navegador do dono |

| Observado em 2026-11-12 (sonda do catálogo, `seller/activity`) | Como |
|---|---|
| Com 5 headers (`token`, `siteuid: mbr`, `language: pt-br`, `mi: <memberId>`, `channel: 1`), sem nenhum anti-bot: `category`, `categoryRate`, `goods/list` (p. 1–3) e `goods/search` → 200 `code "0"`, 10 itens/página, `total` teto 1000 | curl do Mac (IP residencial) e `fetch` do Node no **Shell da API na Render** (portão T0a) |
| Só `token` + `siteuid`: `category` ok, mas `goods/list` → 200 `code "0"` com **`goodsList: null`** (sintoma de `language`/`mi`/`channel` faltando; o cliente trata como fonte indisponível, não lista vazia) | curl do Mac |
| `pageSize` ignorado: sempre 10; página 2 não repete a 1; ≈ 30–34 KB por página | Mac e Render |
| `sort` não muda o resultado (`12` = mesma ordem de `0`): é só dica, a ordem que vale é a pontuação local | curl do Mac |
| `commRate` 1–5 → `did` distintos; **4 = ">15%" confirmado** na tela; 1 "<5%", 2 "5–10%", 3 "10–15%", 5 sem filtro **inferidos** pela ordem | tela do painel + curl |
| Categoria (`cateId`) muda o resultado; busca por termo devolve itens com o termo | curl do Mac |

**Não verificado**: duração real do `AT` além do cookie; se novo login/logout mata o token antigo; `detailNew` com
`goodsId` inexistente (tratado como `code ≠ 0` → `null`); download da foto `ltwebstatic.com` a partir da Render.

Garantido pelo código (com teste): o token nunca sai em resposta/log/canal/mensagem de erro; só os endpoints da lista
fechada acima são chamados (URL em constante, nada da entrada; o `onelink` é só lido pelo expansor); headers fixos,
nenhum anti-bot; a página de produto não é lida; sem plano ou sem aceite nada chama a Shein.

Se a Shein mudar: o cliente fica isolado atrás de `ISheinAffiliateClient`, campo ausente vira `null`. Se passar a
exigir header anti-bot ou bloquear IP de datacenter, **o recurso para e volta para decisão do dono** (não forjar).

## Plano

- Entitlement booleano **`marketplace_shein_enabled`**: LITE `false`, PRO `false`, MAX `true`
  (`tenants/domain/planPresets.ts`). **Ausente = bloqueado** (`requireMarketplaceEnabled`, só `=== true` libera).
- Migration de dados `20261111090500_add_marketplace_shein_entitlement`: presets explícitos nos 3 planos + backfill
  dos `tenant_entitlements` pelo preset vigente, `ON CONFLICT DO NOTHING` (não desfaz liberação do super admin).
- Sem a chave: gerador/vitrine/story recusam com `PLAN_FEATURE_UNAVAILABLE`; consentimento e sync da extensão
  respondem 403; monitoramento pula com `MARKETPLACE_PLAN_UNAVAILABLE`; o card Shein aparece travado com selo dos
  planos que têm o recurso (lista vinda da API em `marketplaceAvailability`) e link para `/plans`.
- **Liberar para outro plano** (super admin, sem deploy): `/admin/plan-entitlements` (seção Plataforma) → tabela
  chave × plano com `<Switch>`. Rotas `GET /api/admin/plan-entitlements` e
  `PUT /api/admin/plan-entitlements/:planSlug/:key` (`{ value }`), `[authHook, superAdminHook]`. Só chaves da
  allowlist `ADMIN_EDITABLE_ENTITLEMENT_KEYS` (hoje só `marketplace_shein_enabled`; outra → 400). Numa transação:
  preset + `tenant_entitlements` de todos os tenants do plano + auditoria `PLAN_ENTITLEMENT_CHANGED`. Não chama a
  central. O `seed.ts` não sobrescreve chave da allowlist (`update: {}`).
- **Texto de vitrine é código**: "a partir do MAX" em `features/plans/catalog.ts` e `FIXED_MIN_PLAN` de
  `features/subscription/strings.ts` ([`planos.md`](planos.md)). Liberou no PRO pelo admin → atualizar esses dois
  arquivos; o card de credenciais já segue a API.

## Aviso de risco e aceite

Os Termos de serviço do Programa de Afiliados SHEIN (em vigor desde 2026-05-18) proíbem o que este recurso faz:

- **3.3.2** — o afiliado não pode "utilizar qualquer sistema, bot ou outro dispositivo ou artifício para participar ou
  receber qualquer benefício do Programa" (sanção: rescisão imediata e perda das comissões).
- **Anexo 3, §6 (Comportamentos Proibidos)** — proíbe "(ii) utilizar robôs ou outras ferramentas de consulta
  automatizadas" e "(iv) utilizar qualquer meio automatizado ou forma de scraping, ou outros métodos de extração de
  dados".

Publicar o link em grupos é permitido (1.1); gerar o link por servidor com a sessão do afiliado cai no texto das
proibições. Isto não é parecer jurídico. **Decisão do dono (2026-11-10): seguir, com o risco assumido pelo tenant.**

- **Aviso fixo** no card Shein em todo estado com plano liberado (só o card travado não mostra): os termos proíbem
  bots e ferramentas automatizadas; a SHEIN pode encerrar a conta e reter comissões; o uso é por conta e risco do
  titular; a plataforma não responde por bloqueio ou perda. Com aceite gravado, mostra data e hora (e "por você").
- **Aceite**: "Conectar Shein" abre o texto completo com caixa "Li e assumo o risco" **desmarcada** e botão
  desabilitado até marcar. Confirmar chama `POST /api/integrations/affiliate-credentials/SHEIN/risk-acceptance`
  (`{ noticeVersion, locale }`) e só depois `/consent`. A caixa não vai para `usePersistedState`.
- **Só administrador do tenant aceita** (`role === 'ADMIN'`). Operador vê o texto com o botão desabilitado; super
  admin não aceita em nome de tenant (403).
- **Versão do aviso**: `MARKETPLACE_RISK_NOTICE_VERSION` em
  `api/src/modules/integrations/domain/services/marketplaceRiskNotice.ts` (`SHEIN: '2026-11-10'`), espelhada em
  `app/src/features/settings/strings.ts`, onde vive o texto. Versão enviada ≠ vigente → 409
  `MARKETPLACE_RISK_NOTICE_OUTDATED` (painel recarrega o texto). **Mudou o texto ⇒ mudar a versão nos dois lados**;
  um teste do app trava o hash do texto pt-BR junto da versão espelhada.
- **Sem aceite da versão vigente**: consentimento e sync → 403 `MARKETPLACE_RISK_NOT_ACCEPTED`; com conta conectada,
  gerador/vitrine/story recusam com o mesmo erro e o monitoramento pula. A credencial não é apagada; o card pede novo
  aceite.
- **Registro** em `marketplace_risk_acceptances` (`20261111090400`): tenant, provider, versão, usuário, idioma
  exibido, hora do servidor (UTC). Um por (tenant, provider, versão); reaceite da mesma versão devolve o existente.
  **Só inclusão**: o repositório não tem update/delete; desconectar, trocar de plano ou reconectar não apaga.
  Auditoria `MARKETPLACE_RISK_ACCEPTED`. É a declaração do usuário, não prova de exibição.
- **Consulta** (super admin): `GET /api/admin/tenants/:tenantId/marketplace-risk-acceptances`.

## Extensão

Detalhes em [`extensao-navegador.md`](extensao-navegador.md) (seção "Shein") e
[`../extension/CHANGELOG.md`](../extension/CHANGELOG.md) 3.4.0.

- **Permissão opcional** `https://m.shein.com/*` (`optional_host_permissions`): host obrigatório novo desativaria a
  extensão em toda a base até o aceite. O Chrome só pede a permissão em gesto do usuário e a extensão não tem popup:
  o painel manda `shein.requestAccess` (pendência de 10 min) e orienta clicar no ícone da extensão; o clique chama
  `chrome.permissions.request`. Concedida → sincroniza e foca o painel; negada → limpa e foca. Sem pendência, o
  clique só foca o painel.
- **Ops do canal**: `shein.status` (`permission`, `pending`, `loggedIn`, `syncStatus`, `lastSyncAt`, `errorCode`, sem
  segredo), `shein.syncSession`, `shein.requestAccess`; `caps` inclui `shein.session`. Exigem tenant ativo +
  permissão `shein.session` (vem do `/extension/me` quando o tenant tem o plano). `AT` e `token` são removidos pelo
  sanitize. Extensão sem a cap → card pede para atualizar.
- **Gatilhos**: `cookies.onChanged` só para `AT`/`memberId` de `m.shein.com`; estado de sync, hash, rate limit e
  single-flight separados do Mercado Livre.
- **Erros** (`SyncErrorCode`): `shein_not_logged`, `shein_permission_missing`, `shein_sync_failed`,
  `risk_not_accepted`, `consent_required`, `plan_unavailable` (403 lido por `error.code`).
- **Rotas**: `POST /api/extension/marketplaces/shein/consent` (painel; plano e aceite antes de gravar; sem sessão da
  extensão → 404 `SESSION_NOT_FOUND`), `PUT …/shein/session` (cookie da extensão; resposta `{ affiliateId }`),
  `DELETE …/shein/session` (painel; revoga consentimento e apaga a credencial inteira, idempotente → 204).
- **Desconectar** só pela rota da Shein (`DELETE …/shein/session`, chamada pelo painel). As rotas genéricas recusam SHEIN: `PUT /:provider` e
  `PUT /:provider/session` → 422, `DELETE /:provider` → 409 `USE_MARKETPLACE_DISCONNECT`. Re-vínculo da extensão a
  outro tenant zera `sheinConsentAt`.

## Monitoramento

- Link Shein capturado (produto ou `onelink` de terceiro) → link do tenant gerado pela sessão; nada da origem
  sobrevive além do id. Dados do produto vêm na mesma chamada (`product` do resultado).
- Motivos de `SKIPPED` (retryable): `MARKETPLACE_PLAN_UNAVAILABLE` (sem plano; o link não some em silêncio, mesmo com
  outro link válido na mensagem), `MARKETPLACE_RISK_NOT_ACCEPTED` (conta conectada sem aceite vigente),
  `CREDENTIAL_MISSING`, `CREDENTIAL_REJECTED` como nos outros marketplaces. `null` do cliente → falha
  `SHEIN_LINK_NOT_CREATED`.
- Sessão recusada no monitoramento marca a credencial `rejected` e pausa a loja (regra geral,
  [`integracoes-credenciais-afiliado.md`](integracoes-credenciais-afiliado.md)).
- **Alerta** `RISK_NOT_ACCEPTED` em `credentialAlerts` (captura recente com o motivo, credencial existente e sem
  aceite); `REJECTED` tem precedência. O texto no painel leva ao card da Shein.
- Cada chamada cria um `onelink` novo na conta do afiliado (sem dedupe entre mensagens): aceito.

## Migrations

`20261111090000_add_shein_affiliate_provider` · `…090100_add_shein_extension_consent` ·
`…090200_add_audit_action_plan_entitlement_changed` · `…090300_add_audit_action_marketplace_risk_accepted` ·
`…090400_create_marketplace_risk_acceptances` · `…090500_add_marketplace_shein_entitlement`. Rodam no boot da Render
(`start:migrate`); nunca local (`api/.env` = produção).

## Riscos aceitos

- **ID lido do token sem verificar assinatura**: conferido só com o cookie `memberId`. Quem tem a sessão da extensão
  já controla o tenant; o link é gerado pelo token, que a Shein valida.
- **Operador conecta e desconecta** (igual ao ML); o aceite, só de administrador, é pré-requisito.
- **Propagação do entitlement numa transação, sem lotes**: poucos tenants por plano; atomicidade vale mais.
- **Texto "a partir do MAX"** na vitrine e na assinatura é código (ver Plano).
- **Termos da SHEIN** (acima): o tenant pode perder a conta de afiliado e as comissões. Revisar se os termos mudarem.

## O que não fazer

- Não resolver, pular nem automatizar o desafio anti-bot da Shein (`/risk/challenge`), em servidor ou extensão.
- Não ler página de produto Shein nem chamar endpoint da Shein fora da lista fechada (`detailNew` + os 4 de
  `seller/activity`); não montar URL da Shein com dado de entrada.
- Não enviar headers anti-bot forjados (`armortoken`, `smdeviceid`, `x-oest`, `anti-in`) nem outro header além dos
  fixos de cada cliente: se a Shein passar a exigir, o recurso para e volta para decisão.
- Não tratar `goodsList: null` como "nenhuma oferta": é fonte indisponível.
- Não montar link de afiliado à mão (`url_from`) como se rendesse comissão.
- Não devolver, logar nem pôr em evento o `AT`; não guardar fora de `sessionCiphertext`.
- Não aceitar `memberId` digitado: o ID vem da sessão.
- Não apagar nem alterar linha de `marketplace_risk_acceptances`; não marcar aceite por padrão, por seed, por
  migration nem por super admin em nome do tenant.
- Não suavizar o aviso: precisa citar proibição nos termos, encerramento de conta e perda de comissão.
- Não mudar o texto do aviso sem subir a versão em `marketplaceRiskNotice.ts` e no espelho do app.
- Não persistir a caixa de aceite (`usePersistedState`): aceite não sobrevive a reload sem novo clique.
- Não liberar plano por código: preset + rota admin.
- Não tornar `m.shein.com` permissão obrigatória da extensão nem pedir a permissão fora de gesto do usuário.
- Não desconectar a Shein pelo `DELETE` genérico: consentimento ficaria e o próximo sync recriaria a credencial.
- Não usar `sourceUrl` da Shein como link clicável nem requisitá-la.
- Não trocar o `CMD` nem rodar migration local (`api/.env` = produção).

## Smoke manual pendente (T16, dono, após deploy)

1. Extensão 3.4.0 carregada; tenant MAX; aceitar o aviso no card (conferir data e hora gravadas).
2. "Conectar Shein" → clicar no ícone da extensão → aceitar o prompt do Chrome. Repetir com o service worker
   dormindo (esperar ~30 s ocioso ou parar em `chrome://extensions`) antes do clique. Card chega a "conectado"
   sozinho, com o ID certo.
3. Gerar oferta com link de produto Shein sem afiliação → sai `onelink` do tenant, título, preço e foto.
4. Monitoramento: captura de grupo com `onelink` de **terceiro** → repostado com o link do tenant.
5. Abrir o link de afiliado em aba anônima e no celular; conferir o clique no painel de afiliado da Shein.
6. Deslogar/trocar de conta na Shein → ressincroniza ou acusa; "Desconectar" apaga a credencial.

Antes do smoke nada é ligado em produção sem o dono; a extensão 3.4.0 exige nova publicação na Chrome Web Store.

## Caçador de Ofertas

Recurso MAX que busca sozinho no catálogo de comissão (`seller/activity`), pontua e envia os melhores a 1 grupo.
Spec, desenho e tarefas: `.specs/features/offer-hunter/`. Cliente: `SheinCatalogClient` (porta
`ISheinCatalogClient`), mesmos erros, timeout, limite de corpo e `redirect: 'manual'` do `SheinAffiliateClient`;
headers exatos `token`, `siteuid`, `language`, `mi`, `channel`, `content-type`, `User-Agent`. Palavra-chave ≤ 60
caracteres sem controle é a única entrada livre enviada; o resto são enums fechados (ordenação, faixa) e ids vindos da
própria Shein. `sellGoodsEndTime` sem fuso é lido como horário de São Paulo (UTC−3). Link final de cada escolhido
sai só do `ResolveAffiliateProductUseCase`.

## Mapa de arquivos

| Camada | Caminho |
|---|---|
| Domínio | `integrations/domain/services/{affiliateProviderFields,marketplaceRiskNotice,sheinSessionMemberId}.ts`; `campaigns/domain/services/{detectMarketplace,parseProductRef,verifyAffiliateLink,marketplaceEntitlement,isSupportedShareLink}.ts`; `campaigns/domain/contracts/{ISheinAffiliateClient,ISheinCatalogClient,IMarketplaceRiskGate}.ts`; `campaigns/domain/hunter/HuntCandidate.ts`, `campaigns/domain/services/hunter/*`; `tenants/domain/{entitlementKeys,planPresets,adminEditableEntitlements}.ts` |
| Use cases | `ResolveAffiliateProductUseCase`, `BuildTenantAffiliateLinkUseCase`, `ProcessPendingCapturedOffersUseCase`, `AcceptMarketplaceRiskUseCase`, `SyncSheinSessionUseCase`, `UpsertAffiliateSessionUseCase`, `ListAffiliateCredentialsUseCase`, `{ListAdminPlanEntitlements,SetPlanEntitlement}UseCase`; `campaigns/application/services/requireMarketplaceEnabled.ts`, `integrations/application/services/requireMarketplaceRiskAccepted.ts` |
| Infra | `campaigns/infrastructure/http/{SheinAffiliateClient,SheinCatalogClient,HttpShortLinkExpander,HttpOfferImageFetcher,HttpProductPageReader}.ts`; `PrismaMarketplaceRiskAcceptanceRepository`, `PrismaPlanEntitlementPresetRepository` |
| Rotas | `extension.routes.ts` (shein), `affiliateCredential.routes.ts` (`risk-acceptance`), `marketplaceRiskAdmin.routes.ts`, `planEntitlementAdmin.routes.ts` |
| Erros | `shared/errors/internal/{MarketplaceRiskErrors,AffiliateCredentialErrors,ExtensionErrors}.ts` |
| Painel | `app/src/features/settings/` (card, aviso, diálogo de aceite), `features/extension/`, `pages/admin/AdminPlanEntitlementsPage.tsx`, `features/planEntitlementsAdmin/` |
| Extensão | `extension/src/background/{marketplaceSession,syncSession,actionClick,cookieWatch,store}.ts`, `config/env.ts` |
