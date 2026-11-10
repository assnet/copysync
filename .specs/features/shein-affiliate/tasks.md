# Afiliado Shein — Tarefas

Branch `feature/shein-affiliate` a partir de `feature/rebranding-app`; merge de volta nela. Commits atômicos
`tipo(escopo): …`. Cada task fecha com `pnpm tsc --noEmit` + testes do pacote tocado. Migration **nunca**
roda local (`api/.env` = produção): validar SQL em Postgres descartável.

`[P]` = pode rodar em paralelo com as outras `[P]` da mesma fase.

## F0 — Portão

| # | Task | Arquivos | Verificação |
|---|---|---|---|
| T0 | ✅ **Feita em 2026-11-10** (Shell da API na Render, token do dono só em memória): corpo mínimo → 200 `code "0"`; sem token → 403 `100105`; `onelink` por GET → 200 com `input#url`. **Ficou sem testar** (as duas primeiras rodadas foram sem token): `goodsId` inexistente e download da `mainImage` — cobertos por teste do cliente (T4: `code` ≠ 0 → `null`) e conferidos no smoke T16 | — | Portão passou |

## F0b — Decisão

| # | Task | Verificação |
|---|---|---|
| T0b | ✅ **Decidido em 2026-11-10: (a)** seguir; risco assumido pelo tenant, com aviso no card e aceite registrado por tenant com data e hora (SHEIN-18…20) | Registrado em `spec.md` |

## F1 — API: marketplace e plano

| # | Task | Depende | Arquivos | Verificação |
|---|---|---|---|---|
| T1 | Enum `SHEIN`, coluna `sheinConsentAt`, tabela `marketplace_risk_acceptances`, 2 valores de `AuditAction` (5 migrations) e listas do domínio | T0, T0b | `schema.prisma`,  `prisma/migrations/<ts>_add_shein_affiliate_provider/`, `<ts>_add_shein_extension_consent/`, `<ts>_add_audit_action_plan_entitlement_changed/`, `<ts>_add_audit_action_marketplace_risk_accepted/`, `<ts>_create_marketplace_risk_acceptances/` (timestamps nessa ordem: enum de provider antes da tabela), `AffiliateProvider.ts`, `shared/audit/IAuditLogRepository.ts` | SQL aplicado em Postgres descartável; `tsc` aponta todo `Record<AffiliateProvider>`/switch sem SHEIN (lista vira checklist de T2–T6) |
| T2 `[P]` | Regras puras: campos do provider, hosts, `parseProductRef`, `verifyAffiliateLink`, `productRefOf` | T1 | `affiliateProviderFields.ts`, `detectMarketplace.ts`, `parseProductRef.ts`, `verifyAffiliateLink.ts`, `ResolveProductDataUseCase.ts` + testes | Tabela de URLs: `br.shein.com/…-p-N.html`, `…-p-N-cat-M.html`, `m.shein.com/br/…`, `m.shein.com/us/…` (recusa), `us.shein.com` (recusa), `evilshein.com` (recusa), `url_from=affiliate_koc_N`, `url_from=GM…` (sem id), dois ids divergentes (`not_owned`) |
| T3 `[P]` | Entitlement: chave, presets, allowlist admin, repositório de presets, migration de dados, seed sem sobrescrever chave editável | T1 | `entitlementKeys.ts`, `planPresets.ts(.test)`, `adminEditableEntitlements.ts`, `tenants/domain/contracts/IPlanEntitlementPresetRepository.ts`, `tenants/infrastructure/repositories/PrismaPlanEntitlementPresetRepository(.int.test).ts`, `prisma/migrations/<ts>_add_marketplace_shein_entitlement/`, `prisma/seed.ts` | `planPresets.test.ts` verde; SQL em Postgres descartável (presets + tenants por plano; reexecução não duplica) |
| T4 `[P]` | `ISheinAffiliateClient` + `SheinAffiliateClient` | T1 | `campaigns/domain/contracts/`, `campaigns/infrastructure/http/SheinAffiliateClient(.test).ts` | Respostas gravadas (sem token): ok; preço em reais → centavos; `code 0` sem `shareLink`/com host estranho → null; `retailPrice` ≤ preço → null; imagem `http://` → `https://`; 403 e `100105` → rejeitada; 302, 500, timeout, JSON inválido → indisponível; `code` desconhecido → null; log sem token |
| T5 `[P]` | Expansor: `onelink.shein.com` (2xx HTML → `input#url`) + `ltwebstatic.com` no fetcher de imagem | T2 | `HttpShortLinkExpander(.test).ts`, `HttpOfferImageFetcher(.test).ts`, `HttpProductPageReader(.test).ts` | onelink vai por GET (nunca HEAD) e o corpo é lido; a URL do produto extraída é devolvida **sem** nova requisição (fetch chamado 1 vez); `HttpProductPageReader.read` com host Shein → null sem rede; `&amp;` desfeito; destino fora da allowlist recusado; corpo > 32 KiB cortado; sem `input` → URL atual; 3xx segue `location`; demais hosts seguem HEAD sem ler corpo |
| T5b `[P]` | Aceite de risco: versão do aviso, contrato + repositório, `AcceptMarketplaceRiskUseCase`, `requireMarketplaceRiskAccepted`, erros, rota `risk-acceptance`, rota admin de consulta | T1 | `integrations/domain/services/marketplaceRiskNotice.ts`, `integrations/domain/contracts/IMarketplaceRiskAcceptanceRepository.ts`, `integrations/infrastructure/repositories/PrismaMarketplaceRiskAcceptanceRepository(.int.test).ts` + mapper, `integrations/application/use-cases/AcceptMarketplaceRiskUseCase(.test).ts`, `integrations/application/services/requireMarketplaceRiskAccepted.ts`, `shared/errors/internal/` (`MARKETPLACE_RISK_NOT_ACCEPTED` 403, `MARKETPLACE_RISK_NOTICE_OUTDATED` 409), `affiliateCredential.routes.ts` + schema, rota admin + registro em `app/routes.ts` | Aceite grava tenant/usuário/versão/idioma/hora, lidos de `request.tenantContext`; operador → 403; super admin em tenant alheio → 403; repetido na mesma versão devolve o existente; versão antiga → 409; provider sem aviso → 422; outro tenant não enxerga; repositório não expõe update/delete; auditoria gravada; admin lista, não super admin → 401 |
| T6 | Gate + use cases: `requireMarketplaceEnabled`, ramo SHEIN no resolver e no builder, `plan_unavailable`, motivo `MARKETPLACE_PLAN_UNAVAILABLE`, porta `IMarketplaceRiskGate` obrigatória nas 3 instâncias (com credencial e sem aceite → sem chamada à Shein), kind `risk_not_accepted` (campaigns e `IMonitorPorts`), alerta `RISK_NOT_ACCEPTED` em `credentialAlerts` (`GroupMonitorConfigUseCases.ts`, método novo em `ICapturedOfferRepository`/`PrismaCapturedOfferRepository`, `GroupMonitorDTO.ts`, `groupMonitoring.schema.ts`), container | T2–T5b | `marketplaceEntitlement.ts`, `requireMarketplaceEnabled.ts`, `ResolveAffiliateProductUseCase(.test).ts`, `BuildTenantAffiliateLinkUseCase(.test).ts`, `ProcessPendingCapturedOffersUseCase(.test).ts`, `CapturedOffer.ts`, `automation/domain/contracts/IMonitorPorts.ts`, `CampaignsMonitorAdapters.ts`, `offersContainer.ts` (`:129`, `:141`), `GenerateOfferUseCase.ts` (`GenerateOfferDeps` + instância interna `:73`) | Cada linha da tabela do `design.md` (resolver) vira um teste; resolver: sessão rejeitada propaga sem `markRejected`; builder: sem plano, sem sessão, rejeitada (marca `rejected`), `null`, `shareLink` fora da allowlist → `failed`, ok com `product`; com credencial e sem aceite: resolver 403, builder `risk_not_accepted`, monitor `SKIPPED/MARKETPLACE_RISK_NOT_ACCEPTED` e alerta no painel; sem credencial o aceite não é exigido; Mercado Livre, Shopee e Amazon nunca passam pelo gate de aceite; monitor: `SKIPPED/MARKETPLACE_PLAN_UNAVAILABLE` também quando a mensagem tem outro link válido (o link Shein não some em silêncio); resolver: link gerado sai com `attributionVerified = true`; chave ausente bloqueia; outros 3 marketplaces sem mudança de comportamento |

## F2 — API: sessão e admin

| # | Task | Depende | Arquivos | Verificação |
|---|---|---|---|---|
| T7 | Sessão Shein: `SyncSheinSessionUseCase` (consentimento → plano → vínculo → `m` do token → upsert → releitura do consentimento), `UpsertAffiliateSessionUseCase` (provider, cookie de token por provider, `sessionIdentifier`), recusa de `PUT` manual, consentimento por marketplace (zerado no re-vínculo), 3 rotas Shein, `marketplaceAvailability` na listagem | T3, T5b, T6 | `extension/application/use-cases/SyncSheinSessionUseCase(.test).ts`, `GetExtensionProfileUseCase.ts` (leitura), `integrations/domain/services/sheinSessionMemberId(.test).ts`, `AffiliateCredentialDTO.ts`, `UpsertAffiliateSessionUseCase(.test).ts`, `UpsertAffiliateCredentialUseCase.ts`, `ListAffiliateCredentialsUseCase.ts`, `affiliateCredential.schema.ts`, `AffiliateCredentialPresenter.ts`, repositório/mapper de credencial, extensão: `ExtensionSession.ts`, `PrismaExtensionSessionMapper.ts`, `PrismaExtensionSessionRepository.ts`, `IExtensionSessionRepository.ts`, `IssueExtensionSessionUseCase.ts`, `IExtensionEntitlementReader.ts` (`hasMarketplace`, + adapter em `extension.routes.ts:31`), `extensionAuthHook.ts`, `extension/domain/constants.ts`, `extension.routes.ts`, `affiliateCredential.routes.ts` | `inject`: sem consentimento 403; sem plano 403 (sync **e** consent); sem aceite da versão vigente 403 `MARKETPLACE_RISK_NOT_ACCEPTED` (sync **e** consent); listagem devolve `riskNotice`; rota genérica `PUT /:provider/session` com SHEIN → 422; `DELETE /:provider` genérico com SHEIN → 409; `DELETE` da extensão sem credencial → 204; `m` do token ≠ `memberId` do corpo, token ilegível → 422; cookie extra é removido pelo schema antes do use case (sync 200, credencial só com `AT`/`memberId`); sem `AT` ou sem `memberId` → 400 do schema; mesmo `AT` em sync repetido não zera recusa nem audita de novo; sem `extensionRequestGuard` (headers da extensão) → recusa; usuário sem vínculo ativo ou tenant suspenso → 403; consentimento revogado entre a checagem e o upsert → credencial apagada e 403; ok grava cifrado e responde sem token; troca de conta substitui o ID (override no create e no update do upsert); `DELETE` revoga e apaga a credencial; re-vínculo a outro tenant zera `sheinConsentAt` (sync volta a dar 403); listagem e sync devolvem os campos novos (schema atualizado); ML inalterado (testes atuais verdes) |
| T8 `[P]` | Admin: listar e alterar entitlement de plano | T3 | `tenants/application/use-cases/{ListAdminPlanEntitlements,SetPlanEntitlement}UseCase(.test).ts`, `tenants/presentation/routes/planEntitlementAdmin.routes.ts`, `app/routes.ts` | `inject` com `[authHook, superAdminHook]`: sem login e não super admin → 401 (o que o hook devolve hoje); chave fora da allowlist 400; plano inválido 400; ok atualiza preset + todos os tenants do plano na mesma transação e audita; teste int. em Postgres descartável |

## F3 — Extensão

| # | Task | Depende | Arquivos | Verificação |
|---|---|---|---|---|
| T9 | ✅ **Spike feito em 2026-11-10**: plano A passa a checagem de gesto (sem gesto é recusado); prompt nativo não observável na automação → confirmar no smoke T16. Plano B de reserva | T0 | `scratchpad/t9-spike/ext` | A adotado |
| T10 | Mapa por marketplace + sessão Shein + canal (`shein.status`, `shein.syncSession`, cap `shein.session`) | T7, T9 | `config/env.ts`, `background/{constants,marketplaceSession,syncSession,store,sessionResolver,index}.ts`, `contract/channel.ts` + espelho idêntico `app/src/features/extension/contract/channel.ts`, `background/channel/{handlers,validate,guard,sanitize}.ts`, `background/apiFetch.ts`, `__mocks__/env.ts`, `webpack.js`, `public/manifest.json`, `scripts/check-*.mjs`, `cookie-parity.test.ts`, `_locales/*`, `package.json` (3.4.0), `CHANGELOG.md`; API: `GetExtensionProfileUseCase` (permissão `shein.session`; `hasMarketplace` vem da T7) | Testes da extensão + scripts de checagem verdes; sanitize remove `AT`/`token`; sync Shein e ML simultâneos não trocam resultado, rate limit nem hash de cookies; sem `AT` → `shein_not_logged`; mudança de outro cookie de `m.shein.com` não agenda sync; 403 por `error.code` vira `consent_required`/`plan_unavailable`/`risk_not_accepted`; op `shein.*` sem tenant/permissão é barrada no guard; clique no ícone sem pendência só foca o painel; fluxo ML idêntico; smoke: conectar, deslogar da Shein (ressincroniza/acusa), trocar de conta |

## F4 — Painel

| # | Task | Depende | Arquivos | Verificação |
|---|---|---|---|---|
| T11 | Aviso de risco fixo + diálogo de aceite (SHEIN-18…20), card Shein (6 estados + reaceite), diálogo de sessão por marketplace, `useExtension` (`sync`/`requestAccess`/`supports`), tipos, strings, selo por lista de planos, privacidade | T7, T10 | `types/api.types.ts`, `features/settings/**`, `pages/settings/AffiliateCredentialsPage.tsx`, `features/extension/hooks/useExtension.ts`, `features/extension/services/extensionApi.ts`, `features/extension/strings.ts`, `services/affiliateCredential.service.ts`, `features/plans/components/PlanAvailabilityBadges.tsx`, `features/privacy/privacyFlags.ts`, `public/assets/marketplaces/` | Aviso visível em todo estado com plano liberado; "Conectar Shein" abre o diálogo e só depois chama `/consent`; com aceite vigente pula o diálogo; alerta de monitoramento `RISK_NOT_ACCEPTED` leva ao card; botão de confirmar desabilitado até marcar a caixa; `risk-acceptance` é chamado antes de `/consent`; reload no meio do diálogo não mantém a caixa marcada; data e hora do aceite aparecem no card; versão nova pede reaceite; teste do app trava hash do texto × versão espelhada; operador não consegue confirmar; testes de estado do card e do selo; "Desconectar" e a lixeira chamam a rota da extensão, nunca o DELETE genérico; card sem vínculo não chama `/consent`; 404 no clique leva a "sem vínculo" e some após `refresh()`; depois do clique no ícone o card chega a "conectado" sozinho (consulta `shein.status`, para ao expirar a pendência); sync Shein é avaliado pela credencial SHEIN, não pela do ML; i18n completo; claro/escuro |
| T12 `[P]` | Rótulos e hosts nos demais módulos | T1, T3 | `features/storefront/{types,strings}.ts`, `features/monitoring/strings.ts`, `features/offers/utils/offerStore.ts`, `features/subscription/strings.ts`, `features/plans/catalog.ts`, `api …/subscriptionLimits.ts` | `satisfies Record` compila; `catalog.test.ts` (app) verde |
| T13 `[P]` | Tela admin `/admin/plan-entitlements` | T8 | `pages/admin/AdminPlanEntitlementsPage.tsx`, service, `AppRoutes.tsx`, navegação, `strings.ts` | Liga PRO → tenant PRO destrava o card sem novo login; desliga → trava |
| T14 | QA visual com agent-browser (card nos 6 estados, admin, claro/escuro, celular) | T11–T13 | — | Prints revisados com ui-ux-pro-max |

## F5 — Fechamento

| # | Task | Depende | Arquivos | Verificação |
|---|---|---|---|---|
| T15 | Docs + versões: `docs/afiliado-shein.md`, exceção de persistência em `docs/padrao-ui-painel.md`, `AGENTS.md`, credenciais, extensão, roadmap, gerador, `api/CHANGELOG.md`, `extension/CHANGELOG.md`; `api` 0.78.0, `app` 0.95.0, extensão 3.4.0 | T14 | docs, `package.json` ×3, `manifest.json` | Links válidos |
| T16 | Smoke do dono em produção (após deploy): conectar → gerar oferta → captura com `onelink` de terceiro → conferir clique no painel da Shein | T15 | — | Clique aparece na conta do tenant |

## F6 — Opcional (P3)

| # | Task | Verificação |
|---|---|---|
| T17 | **Spike** StoreID Amazon: service worker lê `associados.amazon.com.br/home` com cookies e acha o StoreID? | Sim → T18; não → descartar e registrar |
| T18 | Marketplace `amazon` no mapa da extensão (host opcional), rota de sync que preenche a tag **só se vazia** | Tag digitada nunca é sobrescrita |

## Riscos

| Risco | Mitigação |
|---|---|
| Shein bloqueia IP de datacenter ou passa a exigir header anti-bot | T0 antes de tudo; erro vira `AffiliateApiUnavailableError` (não pausa a loja); sem forjar header — recurso para e volta para decisão |
| Formato do `AT` muda e o `m` deixa de ser legível | Sync responde 422 e o painel mostra "reconecte"; nada é gravado com ID não conferido. Ajuste isolado no use case de sessão |
| Endpoint interno muda sem aviso | Cliente isolado atrás de `ISheinAffiliateClient`; parsing tolerante (campo ausente = null); alerta por taxa de `SHEIN_*` no log |
| `AT` expira antes dos 30 dias / no logout | Recusa marca `rejected` e o painel avisa; extensão ressincroniza a cada mudança de cookie |
| **Termos do programa proíbem bot/ferramenta automatizada** (3.3.2 e Anexo 3 §6, lidos em 2026-11-10) | Decisão do dono: seguir com risco do tenant. Aviso fixo no card, aceite obrigatório por versão do aviso, registro só de inclusão por tenant (usuário, data e hora). Texto do aviso não pode ser suavizado; revisar se os termos mudarem |
| Cada chamada cria um `onelink` novo na conta | Aceito sem dedupe: a captura só deduplica por mensagem (`PrismaCapturedOfferRepository.ts:44-48`), então mensagens diferentes com o mesmo produto geram um link cada |
| Permissão opcional não funciona sem popup | T9 com planos B e C |
| Seed sobrescreve liberação do super admin | T3: `update: {}` nas chaves da allowlist |
| Tenants sem `planSlug` ficam bloqueados | Igual ao story/vitrine: evento do hub ou concessão manual |
