# Rodízio de links — Design

**Spec**: `spec.md` · **Decisões**: `context.md` · **Pesquisa**: `research/*.md` · **Status**: Draft (2026-10-28)

## 1. Visão

```
Visitante ──GET https://promodemae1.copysync.app──▶ Cloudflare (proxy, WAF skip webviews)
   ──▶ Render (wildcard *.copysync.app no serviço da API) ──▶ Fastify `publicLinkRoutes`
        resolve Host → LinkRotation(ACTIVE) → escolhe LinkRotationGroup elegível (função pura `pickGroup`)
        → UPDATE atômico de cliques → HTML leve (OG + botão + meta refresh) → chat.whatsapp.com/<code>

Painel tenant ──/link-rotation──▶ use cases (entitlements link_rotations / link_rotation_groups)
Super-admin ──/admin/link-domains──▶ CRUD de LinkDomain + probe
Job 15 min (flag LINK_ROTATION_MEMBER_SYNC_ENABLED) ──▶ IMessagingEngine.getGroupSummary → memberCount
```

Módulo novo `api/src/modules/link-rotation/{domain,application,infrastructure,presentation}` (roadmap chama
`campaigns/link-rotation`; fica módulo próprio porque não compartilha entidade com ofertas; prefixo HTTP
`/link-rotation` e `/admin/link-domains`). Painel: `app/src/features/linkRotation/`, páginas
`pages/link-rotation/`, `pages/admin/AdminLinkDomainsPage.tsx`.

## 2. Alternativas avaliadas

| Alternativa | Veredito | Por quê |
| --- | --- | --- |
| Domínios no hub | ✗ | `arquitetura-central-billing.md`: hub só billing |
| Worker Cloudflare com `X-Forwarded-Host` | ✗ v1 | Cota e header forjável; wildcard nativo Render é mais simples (`research/dns-cloudflare-render.md`) |
| 302 direto sem página | ✗ | Webview Instagram/TikTok e preview OG (`context.md` #3) |
| Contagem só por cliques | ✗ | Não desconta quem saiu; metadata Baileys dá `size` (`research/baileys-invite.md`) |
| Cache de metadata com `size` no adapter (TTL) | ✓ | Snapshot atual não tem `size` nem TTL; estender snapshot, invalidar como hoje |
| Contagem em memória do processo | ✗ | AGENTS §22 / escala: estado operacional no banco |

## 3. Modelo de dados (Prisma, migration `create_link_rotation`)

```prisma
enum LinkDomainStatus { ACTIVE PAUSED }
enum LinkRotationStatus { ACTIVE PAUSED PAUSED_BY_PLAN }
enum LinkRotationStrategy { BALANCED SEQUENTIAL WEIGHTED RANDOM }
enum LinkRotationGroupStatus { ACTIVE PAUSED FULL NEEDS_LINK PAUSED_BY_PLAN }
enum LinkRotationGroupLinkSource { AUTO MANUAL }

model LinkDomain {            // plataforma, sem tenantId
  id            String   @id @default(cuid())
  hostname      String   @unique            // "copysync.app", minúsculo, sem ponto final
  status        LinkDomainStatus @default(ACTIVE)
  landingUrl    String?                     // 301 do apex
  reservedNames String[]                    // além dos padrão (www, app, api, admin, mail, cdn, static, status, hub, probe)
  lastProbeAt   DateTime?
  lastProbeOk   Boolean?
  createdAt/updatedAt
  rotations     LinkRotation[]
  @@map("link_domains")
}

model LinkRotation {
  id          String  @id @default(cuid())
  tenantId    String
  sessionId   String                       // sessão dona dos grupos
  domainId    String
  slug        String                       // "promodemae1"
  status      LinkRotationStatus @default(ACTIVE)
  strategy    LinkRotationStrategy @default(BALANCED)
  title       String?                      // nome exibido na página pública (default: nome da sessão)
  clickCount  Int @default(0)
  lastClickAt DateTime?
  allFullNotifiedAt DateTime?
  createdAt/updatedAt
  groups      LinkRotationGroup[]
  @@unique([domainId, slug])
  @@index([tenantId])
  @@map("link_rotations")
}

model LinkRotationGroup {
  id             String @id @default(cuid())
  tenantId       String
  rotationId     String
  conversationId String                    // ChatConversation (isGroup)
  groupJid       String                    // sem @g.us, cópia para o job
  position       Int                       // ordem (SEQUENTIAL)
  weight         Int @default(1)           // 1–100 (WEIGHTED)
  capacity       Int @default(1000)        // teto 50–1024
  inviteCode     String?                   // só o code; link = https://chat.whatsapp.com/<code>
  linkSource     LinkRotationGroupLinkSource?
  status         LinkRotationGroupStatus @default(ACTIVE)
  memberCount    Int?                      // última leitura via sessão
  memberCountAt  DateTime?
  clicksSinceSync Int @default(0)
  clickCount     Int @default(0)
  lastClickAt    DateTime?
  @@unique([rotationId, conversationId])
  @@index([tenantId])
  @@map("link_rotation_groups")
}

model LinkSlugReservation {                // nome trocado/excluído fica 30 dias com o tenant
  id        String @id @default(cuid())
  domainId  String
  slug      String
  tenantId  String
  expiresAt DateTime
  @@unique([domainId, slug])
  @@map("link_slug_reservations")
}

model LinkClick {                          // 1 linha por clique contado; base para "7 dias" e dedupe
  id         String @id @default(cuid())
  tenantId   String
  rotationId String
  groupId    String?
  ipHash     String                        // sha256(ip + dia + LINK_CLICK_SALT)
  userAgentClass String                    // 'webview' | 'browser' | 'bot'
  createdAt  DateTime @default(now())
  @@index([rotationId, createdAt])
  @@map("link_clicks")
}
```

Retenção: `LinkClick` > 90 dias apagado pelo job (mesmo padrão `ExtensionRetentionJob`). Contadores agregados
ficam em `clickCount` (atômico), `LinkClick` só alimenta "7 dias" e abuso.

Entitlements (`entitlementKeys.ts` + `planPresets.ts` + seed + `catalog.ts` + testes de trava):
`link_rotations` 1/1/2 · `link_rotation_groups` 3/5/10. Atenção: `catalog.ts:45,66` já exibe
"Rodízio de links inteligentes" com hint sobre credenciais de afiliado — corrigir hint para este recurso e
adicionar `limits.linkRotations/linkRotationGroups`.

## 4. Backend

### 4.1 Domain (`link-rotation/domain`)
- Entidades: `LinkDomain`, `LinkRotation`, `LinkRotationGroup` (tipos puros) + enums.
- `services/slugRules.ts` — função pura: normaliza (`toLowerCase`, remove acento), valida regex
  `^[a-z0-9](?:[a-z0-9-]{1,48}[a-z0-9])?$`, checa reservados (lista padrão + `reservedNames` do domínio),
  sugere variações. Testável sem banco.
- `services/pickGroup.ts` — função pura `pickGroup(groups, strategy, rng)`: elegível = `status ACTIVE && inviteCode
  && estimado(memberCount ?? 0 + clicksSinceSync) < capacity`. BALANCED = menor `estimado/capacity`, empate
  menor `clickCount`; SEQUENTIAL = menor `position`; WEIGHTED = roleta por `weight`; RANDOM = uniforme. Retorna
  `null` se nenhum.
- `services/classifyUserAgent.ts` — `bot | webview | browser` (lista de UAs: facebookexternalhit, WhatsApp,
  Twitterbot, Googlebot…; webview: Instagram, FBAN/FBAV, musical_ly, BytedanceWebview). Lista não é oficial —
  marcada no código como heurística.
- Contratos: `ILinkDomainRepository`, `ILinkRotationRepository` (inclui `findPublicByHost(hostname, slug)` que
  devolve rotação + grupos + status do tenant; `incrementClick(rotationId, groupId)` atômico;
  `reserveSlug`, `isSlugAvailable`), `ILinkClickRepository`.

### 4.2 Application
| Use case | Regra |
| --- | --- |
| `ListLinkDomainsUseCase`, `CreateLinkDomainUseCase`, `UpdateLinkDomainUseCase`, `DeleteLinkDomainUseCase` | super-admin; delete recusa com `LinkDomainInUseError` (409) se houver rotação |
| `ProbeLinkDomainUseCase` | `GET https://probe-<rand>.<hostname>/.well-known/link-rotation?token=` com token HMAC de 5 min; anti-SSRF: hostname tem de ser o do registro; grava `lastProbeOk/At` |
| `GetLinkRotationOverviewUseCase` | `{ rotations[], domains (ACTIVE), limits: { linkRotations, linkRotationGroups }, sessions }` |
| `CreateLinkRotationUseCase` | sessão do tenant; domínio ACTIVE; `slugRules`; `isSlugAvailable` (unique + reserva de outro tenant) → `LinkSlugTakenError` 409 com `suggestions[]`; conta rotações do tenant vs `link_rotations` → `PlanLimitReachedError` |
| `RenameLinkRotationUseCase` | mesmas regras; cria `LinkSlugReservation` do nome antigo (30 d, tenant) |
| `UpdateLinkRotationUseCase` | status (ACTIVE/PAUSED), strategy, title, sessionId (trocar sessão limpa grupos) |
| `DeleteLinkRotationUseCase` | apaga grupos, reserva slug 30 d |
| `SaveLinkRotationGroupsUseCase` | lista `{conversationId, position, weight, capacity, manualInviteUrl?}`; grupo tem de ser `isGroup` da sessão da rotação e do tenant; `n > link_rotation_groups` → `PlanLimitReachedError`; para cada grupo sem link manual chama `engine.getGroupInviteLink` (sessão conectada); erro `GROUP_INVITE_NOT_ALLOWED` → `status NEEDS_LINK`, `linkSource null`; manual: valida `https://chat.whatsapp.com/<code>` |
| `RefreshLinkRotationGroupUseCase` | re-tenta invite AUTO + `getGroupSummary` sob demanda (botão "atualizar") |
| `ResolvePublicLinkUseCase` | entrada `{hostname, slug, ip, userAgent, now}` → `{ kind: 'redirect', inviteUrl, groupName, title } \| 'all_full' \| 'paused' \| 'not_found' \| 'unavailable' \| 'apex' (landingUrl)`. Bot não conta e não recebe invite (só página). Conta: `incrementClick` (rotation + group, `clicksSinceSync++`), insere `LinkClick`. `ALL_FULL`: grava `allFullNotifiedAt` se > 1 h |
| `SyncLinkRotationMembersUseCase` | job: por sessão conectada, grupos com `memberCountAt` > 15 min ou `clicksSinceSync ≥ 25`; `getGroupSummary` → `memberCount`, `clicksSinceSync=0`; `≥ capacity` → FULL, senão volta ACTIVE (se estava FULL). Máx. 1 chamada/grupo/15 min |
| `ApplyPlanLimitsToLinkRotationsUseCase` | chamado por `SyncTenantEntitlementsUseCase` (hook de rebaixo): excedentes → `PAUSED_BY_PLAN` por ordem |

Erros novos (`shared/errors/internal/LinkRotationErrors.ts`): `LINK_DOMAIN_IN_USE` 409, `LINK_DOMAIN_INVALID` 400,
`LINK_SLUG_INVALID` 400, `LINK_SLUG_RESERVED` 409, `LINK_SLUG_TAKEN` 409 (details `suggestions`), `LINK_ROTATION_NOT_FOUND` 404,
`LINK_GROUP_INVALID` 400, `LINK_INVITE_URL_INVALID` 400. Messaging: `GROUP_INVITE_NOT_ALLOWED` 403 (`GroupErrors.ts`).

### 4.3 Porta do engine (messaging)
`IMessagingEngine` ganha, após `listParticipatingGroups` (`IMessagingEngine.ts:244`):
```ts
getGroupInviteLink(sessionId: string, groupJid: string): Promise<{ inviteCode: string }>;
getGroupSummary(sessionId: string, groupJid: string): Promise<{ name: string; memberCount: number; isSelfAdmin: boolean }>;
```
Adapter (`BaileysMessagingEngineAdapter.ts`, ao lado de `getGroupParticipants :478`): `socket.groupInviteCode(jid)` /
`socket.groupMetadata(jid)` (`size`, `participants[].admin`); `isSelfAdmin` casa `jidNormalizedUser(socket.user.id)` e
`socket.user.lid` com `p.id/p.phoneNumber/p.lid`. Snapshot de metadata ganha `size`, `selfIsAdmin` e `fetchedAt`
(TTL 15 min) — invalidação existente mantida. Tradutor: `translateGroupInviteError` em `BaileysErrorTranslator.ts`
(Boom com `err.data ∈ {401,403}` ou `forbidden|not-authorized` → `GroupInviteNotAllowedError`). Único
`implements` é o adapter; fakes de teste são parciais.

### 4.4 Presentation
- `linkRotation.routes.ts` (`[authHook, tenantHook]`, prefixo `/link-rotation`): `GET /` overview · `POST /` ·
  `PATCH /:id` · `POST /:id/rename` · `DELETE /:id` · `GET /:id/groups` (candidatos da sessão com `isSelfAdmin`
  quando em cache, reaproveita listagem de `offer.routes.ts:115`) · `PUT /:id/groups` · `POST /:id/groups/:gid/refresh` ·
  `GET /:id/stats` (7 dias por grupo).
- `linkDomainAdmin.routes.ts` (`[authHook, superAdminHook]`, `/admin/link-domains`): CRUD + `POST /:id/probe`.
- `publicLink.routes.ts` **sem auth, registrado fora de `API_PREFIX`**, com `config.rateLimit` preset `publicLink`
  60/min, `Cache-Control: no-store`, `X-Robots-Tag: noindex`: `GET /` e `GET /.well-known/link-rotation`.
  Dispatch por `Host`: hook `onRequest` em `app.ts` só ativa quando `Host` (sem porta) termina em um
  `LinkDomain.hostname` **carregado em cache de 60 s** (consulta `link_domains`, sem estado novo além de cache
  com TTL); hosts `api.copysync.app`/`PANEL` passam direto. `trustProxy: 1` já existe (`app.ts:78`).
  Páginas HTML: templates em `presentation/templates/*.ts` (string, sem engine), marca via `APP_NAME` da API
  (branding central), OG `og:title`/`og:description`, `<meta http-equiv="refresh" content="1;url=…">` + botão.
- Schemas JSON por rota (`presentation/schemas`), presenter `LinkRotationPresenter` (nunca model Prisma).

### 4.5 Infra
- `PrismaLinkDomainRepository`, `PrismaLinkRotationRepository` (mappers), `PrismaLinkClickRepository`.
- `linkRotationContainer.ts` (lazy, entitlements de `offersContainer.entitlements()`, engine da factory).
- `LinkRotationMemberSyncJob` (padrão `OfferDispatchWorker`, 60 s tick, flag `LINK_ROTATION_MEMBER_SYNC_ENABLED`
  default false, `JobLease` `link-rotation-member-sync` para rodar em 1 processo). Retenção `LinkClick` 90 d no mesmo job.
- Env: `LINK_ROTATION_MEMBER_SYNC_ENABLED`, `LINK_CLICK_SALT` (32 bytes base64, obrigatório em prod), `LINK_PROBE_SECRET`.

## 5. Painel

| Peça | Onde | Reusa |
| --- | --- | --- |
| Item de menu "Rodízio de links" (`Link2`) após Monitoramento | `AppLayout.tsx:49-61` | `AppIcon` |
| `pages/link-rotation/LinkRotationPage.tsx` — header + card por rodízio (link, status, sessão, chips grupos/cliques, botões Configurar/Grupos/Copiar) + estado vazio "Criar meu link" | `MonitoringPage.tsx:101-112` `PageHeader`, `SectionCard` | `Blurred` |
| `features/linkRotation/components/RotationConfigDialog.tsx` — sessão, domínio (select), slug com preview ao vivo e contador, regras, sugestões em 409, estratégia (RadioGroup com descrição), título; rename abre `ConfirmRenameDialog` | `usePersistedState('linkRotation.config', …, {scope:'tab'})`, `clear()` ao salvar | — |
| `features/linkRotation/components/RotationGroupsDialog.tsx` — lista de grupos da sessão (busca, `x de y`), checkbox bloqueia acima do limite + `PlanLimitBanner`, por grupo selecionado: ordem (setas, como `BroadcastGroupsCard.tsx:82-91`), peso (`RangeSlider` só em WEIGHTED), teto (`RangeSlider` 50–1024), link AUTO/MANUAL com campo e estado `NEEDS_LINK` | `useSessionGroups` (`offers/hooks`), `GroupPickerDialog` como referência | `Blurred` |
| `features/linkRotation/components/PlanLimitBanner.tsx` — banner animado (gradiente `primary→secondary` com `alpha()`, ícone `Sparkles`, micro-animação CSS respeitando `prefers-reduced-motion`), texto "No plano X você tem até N grupos. No Y são M!" + CTA `/plans` | padrão `GroupPickerDialog.tsx:170-176` | — |
| `features/linkRotation/components/RotationStatsCard.tsx` — total, 7 dias, por grupo (barras simples MUI) | — | — |
| `features/linkRotation/strings.ts` (pt-BR, chaves semânticas) · `services/linkRotation.service.ts` · `utils/linkRotationErrors.ts` (mapeia `PLAN_LIMIT_REACHED`, `LINK_SLUG_TAKEN` + `suggestions`) | `monitoring/utils/apiErrors.ts:50-55` | — |
| Privacidade: `PRIVACY_SCREENS` ganha `linkRotation` com flags `rotationLink`, `groupName`, `groupAvatar` | `privacyFlags.ts:8` | — |
| `pages/admin/AdminLinkDomainsPage.tsx` — tabela de domínios, form (hostname, landingUrl, reservados), status, probe com resultado, instruções DNS colapsáveis (passos de `research/dns-cloudflare-render.md` §5); item em `NAV_ADMIN_ITEMS` | `AdminAiPage.tsx`, `adminAi.service.ts` | — |
| Catálogo: `limits.linkRotations/linkRotationGroups`, benefício "Rodízio de links" com hint correto; `catalog.test.ts` e `planPresets.test.ts` travam | `catalog.ts:25,45,66` | — |

Tooltips via MUI `Tooltip describeChild` (padrão da página de monitoramento). Modos sistema/claro/escuro só
via `theme.palette`.

## 6. Fluxo público (sequência)

1. Cloudflare → Render → Fastify; hook lê `Host`, remove porta, casa sufixo com cache de domínios.
2. Apex (`host === hostname`) → 301 `landingUrl` (ou 404 da marca se vazio). `www.<slug>.<dom>` → 404.
3. `/.well-known/link-rotation` → valida token → 204.
4. `ResolvePublicLinkUseCase`: `findPublicByHost` (índice `@@unique([domainId, slug])`), tenant `ACTIVE`, rotação
   `ACTIVE`, `pickGroup`. Transação: `UPDATE link_rotation_groups SET click_count = click_count+1,
   clicks_since_sync = clicks_since_sync+1 WHERE id=…` + rotação + `INSERT link_clicks`. p95 alvo < 200 ms.
5. HTML: título, nome do grupo, botão `href=https://chat.whatsapp.com/<code>`, meta refresh 1 s, `noindex`,
   sem cookies, sem script obrigatório.

## 7. Infra por domínio

Validado em 2026-10-29 com `copysync.com.br` (registro.br → Cloudflare, conta `CopySync` separada da do Pulso).
Serviço Render: `copysync_api` (`copysync-ithg.onrender.com`, `srv-db6hlm8n74is73a1udtg`).

Passos por domínio novo:
1. Cloudflare: Add domain, plano Free. Em "AI training & search policies" marcar Search/Agent/Training = **Block**
   (subdomínio de tenant não deve ser indexado); Bot Preference Sync pode ficar ligado.
2. registro.br (ou outro registrador): trocar nameservers para o par da zona. Não ativar DNSSEC.
   Delegação `.br` leva ~2 h.
3. Render, serviço `copysync_api`, Custom Domains: adicionar `dominio`, `*.dominio` e (opcional) `www.dominio`
   com redirect para o apex. A Render exige o apex junto do wildcard.
4. Cloudflare DNS, **todos DNS only** nesta fase (a Cloudflare liga o proxy sozinha em A/CNAME novos — conferir):

   | Tipo | Nome | Conteúdo |
   | --- | --- | --- |
   | A | `@` | `216.24.57.1` |
   | CNAME | `www` | `copysync-ithg.onrender.com` |
   | CNAME | `*` | `copysync-ithg.onrender.com` |
   | CNAME | `_acme-challenge` | `copysync-ithg.verify.renderdns.com` |
   | CNAME | `_cf-custom-hostname` | `copysync-ithg.hostname.renderdns.com` |

   Sem AAAA. Sem CAA (ou liberar `letsencrypt.org` e `pki.goog`). Os dois registros com `_` ficam cinza para sempre.
5. Render: Retry Verification até Verified + Certificate Issued. Com os registros corretos a emissão sai sozinha
   em minutos depois da delegação propagar — não foi preciso clicar em Retry.
6. Parar aqui. **Manter tudo DNS only** até a página pública existir (decisão 13 em `context.md`).
7. Painel super-admin: cadastrar o domínio (`landingUrl` do apex) e rodar o probe.

Na T24, ao abrir o rodízio aos tenants, ligar a proteção de borda:
- Proxy laranja em `@` e `*`, com SSL/TLS em **Full (strict)** (Flexible gera loop de redirect).
- **Bot Fight Mode desligado** — desafia webview de Instagram/TikTok.
- WAF custom rule de *Skip* para esses user agents + rate limit por IP na rota de redirect.

**Restrição de custo (medida na prática):** o plano do workspace na Render inclui **2 custom domains** e eles já
estão ocupados por `copysync.app` e `copysync.com.br`. A Render agrupa por domínio raiz (wildcard + apex + www = 1).
Logo, a ideia de vários domínios base (`.pro`, `.online`, `.sys`) custa por raiz adicional. Estratégia v1: **um
domínio de rodízio** com muitos subdomínios, que é o que o modelo de dados já suporta; abrir domínio novo só por
decisão comercial (nome bonito para um nicho), nunca por limite técnico.

**Resultado medido em 2026-10-29 03:51 UTC** (`copysync.com.br`, tudo DNS only):

| Checagem | Resultado |
| --- | --- |
| Delegação `.br` | `courtney.ns.cloudflare.com` / `garret.ns.cloudflare.com` |
| Certificado | Let's Encrypt, `CN=copysync.com.br`, válido 2026-10-29 → 2027-01-27 |
| `https://teste.copysync.com.br/health` | `200`, corpo igual ao de `api.copysync.app` (mesmo serviço) |
| `http://teste.copysync.com.br/health` | `301` para HTTPS |
| `https://copysync.com.br/` | `404` da API — esperado até o apex ganhar o 301 para `landingUrl` (T10) |
| `https://www.copysync.com.br/health` | `301` |

Conclusões confirmadas: wildcard na Render roteia por Host para o mesmo serviço, um certificado cobre apex +
`*.dominio`, e subdomínio arbitrário não precisa de cadastro na Render. O resolver do domínio (T9) é quem decide
o que existe. Pendente de validação: proxy laranja + Full (strict) sobre o wildcard, que só entra na T24.

## 8. Riscos / CONCERNS
- `groupInviteCode` sem ser admin: erro vira Boom 500 no tradutor atual → mapear por `err.data`; confirmar
  empiricamente no primeiro teste (`research/baileys-invite.md` §1).
- Volume Baileys: 1 metadata/grupo/15 min, job único por lease; sem chamadas por clique.
- Slug global por domínio é dado público: validação server-side; nunca listar slugs de outros tenants.
- Rota pública sem tenant context: única consulta sem `tenantId` é `findPublicByHost` (documentar na doc).
- Hash de IP com salt em env; `LinkClick` 90 d.

## 9. Docs a criar/atualizar
`docs/rodizio-de-links.md` (novo: fluxo, DNS, o que não fazer), `docs/produto-roadmap.md` item 9 ✅,
`docs/planos.md` (limites), `docs/padrao-ui-painel.md` (PlanLimitBanner se virar padrão), `CHANGELOG.md`,
versões: api minor (0.44.0), app minor (0.50.0).
