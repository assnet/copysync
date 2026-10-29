# Rodízio de links

Um link fixo por tenant (`https://<slug>.<domínio>`) para divulgar nas redes. Cada visita cai numa página leve com o
botão "Entrar no grupo", que leva a um grupo de WhatsApp da sessão com vaga. Quando um grupo enche, o próximo assume.
Roadmap item 9. Specs: `.specs/features/link-rotation/` (`spec`, `design`, `context`, `api-contract`, `tasks`).
Termo de produto: **rodízio de links**. Nomes de código: `linkRotation`, `link-rotation`, `LinkDomain`.

## Termos

| Termo | O que é |
| --- | --- |
| Rotação (`LinkRotation`) | Um link público do tenant: sessão dona dos grupos, domínio, slug, estratégia, título |
| Domínio de link (`LinkDomain`) | Domínio da plataforma (sem `tenantId`) com wildcard apontando para a API. Hoje: `copysync.com.br` |
| Slug | Rótulo do subdomínio (`promodemae1`). Único por domínio, entre todos os tenants |
| Grupo (`LinkRotationGroup`) | Grupo da sessão dentro da rotação: convite, teto (`capacity`), peso, ordem, contadores |
| Estratégia | Regra de escolha do grupo: `BALANCED`, `SEQUENTIAL`, `WEIGHTED`, `RANDOM` |

## Fluxo público (por Host)

`registerPublicLinkRoutes` (`publicLink.routes.ts`) registra um hook `onRequest` no escopo raiz, fora do `API_PREFIX`,
antes das rotas da API (`app.ts`):

1. Normaliza o `Host` (minúsculo, sem porta, sem ponto final; IPv6 literal é ignorado).
2. Host da plataforma (`app.copysync.app`, `api.copysync.app`, host de `PANEL_URL`) ou subdomínio dele → passa direto.
   Vale **mesmo com o domínio pai (`copysync.app`) cadastrado** como domínio de link. Sem essa checagem a API cai.
3. Host fora de qualquer domínio ACTIVE → passa direto. A lista vem de `ActiveLinkDomainCache`: TTL 60 s, carga sob
   demanda (nunca no boot), single flight. Falha sem lista anterior → nada é interceptado e nova tentativa em 5 s.
4. Host sob domínio ativo (apex ou subdomínio): só `GET|HEAD /` e `/.well-known/link-rotation` respondem. Qualquer
   outro caminho, **inclusive `/health`, `/docs` e `/api/...`**, recebe o 404 HTML da marca sem chegar ao handler.
   Em host da API essas duas rotas dão o 404 padrão (`callNotFound`).

`matchPublicHost` (função pura): host = domínio ou `www.` + domínio → apex; exatamente um rótulo antes → slug; `www.slug.dom` → 404.
Com domínios aninhados vence o mais longo. Domínio `PAUSED` sai do cache em até 60 s e deixa de ser interceptado.

| Situação (`ResolvePublicLinkUseCase`) | HTTP | Página |
| --- | --- | --- |
| Apex com `landingUrl` | 302 | redirect para a landing (302: destino editável, 301 ficaria no cache do navegador) |
| Rate limit (60/min por IP) | 429 | página "Muitos acessos" em HTML |
| Apex sem `landingUrl`, slug inexistente, `www.slug.dom` | 404 | 404 da marca |
| Segredos ausentes, tenant não `ACTIVE`, erro inesperado | 503 | indisponível |
| Rotação `PAUSED` ou `PAUSED_BY_PLAN` | 200 | pausado |
| Bot (`classifyUserAgent`) | 200 | só prévia (título, OG), **sem convite, não conta** |
| Nenhum grupo elegível | 200 | lotado; grava `allFullNotifiedAt` no máx. 1×/h |
| Grupo escolhido | 200 | botão + `meta refresh` de 1 s para `chat.whatsapp.com/<code>` |

Página: templates em `presentation/templates/` (string, sem engine), tudo escapado, marca via `APP_NAME`, claro/escuro por
`prefers-color-scheme`. CSP própria: `default-src 'none'`, estilo só pelo hash SHA-256 do CSS fixo, nenhum script, nenhuma
imagem. Headers: `Cache-Control: no-store`, `X-Robots-Tag: noindex, nofollow`, `Referrer-Policy: no-referrer`. Rate limit
preset `publicLink` (60/min por IP).

`classifyUserAgent` é heurística (`WhatsApp/…`, `facebookexternalhit`, `curl/` etc. = bot; Instagram/FBAN/TikTok =
webview). UA vazio = bot. Revisar quando as estatísticas mostrarem bot/webview fora do esperado.

## Escolha do grupo

`pickGroup` (função pura, `rng` injetável). Elegível = `status ACTIVE` **e** `inviteCode` **e** estimado `< capacity`,
com **estimado = `memberCount ?? 0` + `clicksSinceSync`**.

| Estratégia | Regra |
| --- | --- |
| `BALANCED` (padrão) | menor estimado/capacidade; empate → menor `clickCount` → menor `position` |
| `SEQUENTIAL` | menor `position` elegível (enche e passa) |
| `WEIGHTED` | roleta por `weight` (1–100); peso ≤ 0 não concorre |
| `RANDOM` | uniforme |

Contagem: `ipHash = sha256(ip + dia UTC + LINK_CLICK_SALT)`; IP cru nunca é gravado. Mesmo `ipHash` na mesma rotação em
10 min não conta de novo, mas o destino é recalculado (pode cair em outro grupo). Contar nunca bloqueia o redirect: falha
é logada e engolida. `incrementClick` sobe `clickCount`/`clicksSinceSync` do grupo e da rotação numa transação;
`LinkClick` é gravado depois, fora dela.

## Contagem de membros (job)

`LinkRotationMemberSyncJob` (ligado em `server.ts`), tick de 60 s, só com **`LINK_ROTATION_MEMBER_SYNC_ENABLED=true`**.
Lease `link-rotation-member-sync` em `job_leases` (5 min): um processo por tick no cluster.

- Vencido: `memberCountAt` nulo ou > 15 min, **ou** `clicksSinceSync ≥ 25` com piso de 2 min da leitura anterior.
- Só grupos `ACTIVE`/`FULL` de rotação `ACTIVE`, sessão `CONNECTED` não excluída, tenant `ACTIVE`.
- Lote de 50 por tick (≤ 50 chamadas/min ao WhatsApp), mais antigos primeiro, agrupados por sessão, orçamento de 4 min.
- `IMessagingEngine.getGroupSummary` → `memberCount`, zera `clicksSinceSync` (desconta só os cliques vistos) e ajusta
  `FULL ↔ ACTIVE` pelo teto. Sessão desconectada: pula o resto da sessão sem gravar.
- Outra falha de leitura grava só a tentativa: **`memberCountAt` = última tentativa**, não última leitura boa (contagem
  pode ser antiga com horário recente).
- Retenção: `LinkClick` > 90 dias apagado no mesmo job, no máx. 1×/h (lease `link-click-retention` de 1 h, não liberado).

## Limites por plano

Entitlements `link_rotations` e `link_rotation_groups`. Presets (data migration `20261029020000_create_link_rotation`,
`ON CONFLICT DO NOTHING`): Starter 1/3, Profissional 1/5, Business 2/10. Travados em `tenants/domain/planPresets.ts` e
`features/plans/catalog.ts`.

- **Chave ausente = ilimitado** (convenção do projeto). Em 2026-10-29 os tenants estão sem `planSlug`, logo sem limite.
  Os presets chegam no próximo evento de plano do hub.
- Rebaixo: `applyLinkRotationPlanLimits` roda em `SyncTenantEntitlementsUseCase` e, no mesmo commit, em
  `ApplyBillingEventUseCase`. Idempotente. Rotações não `PAUSED` ordenadas por `createdAt`: as N mais antigas ficam
  `ACTIVE`, o resto `PAUSED_BY_PLAN`. Grupos por `position`: os N primeiros mantêm o status, o resto `PAUSED_BY_PLAN`;
  quem volta a caber recebe o status calculado (`NEEDS_LINK`/`FULL`/`ACTIVE`).
- Pausa manual (`PAUSED`) de rotação ou grupo nunca é tocada e não ocupa vaga.
- Reativar (`PATCH status=ACTIVE`, inclusive de `PAUSED_BY_PLAN`) checa o plano: só `ACTIVE` ocupa vaga.
- Criar conta **todas** as rotações do tenant, inclusive pausadas: o limite é de links que o tenant possui. Pausar
  não libera vaga para criar outro; excluir libera. Ativas nunca passam do limite.
- Salvar grupos acima de `link_rotation_groups` → 403 `PLAN_LIMIT_REACHED` (`meta.key`); painel mostra `PlanLimitBanner`.
- Sessão excluída (`DeleteSessionUseCase`) → rotações dela viram `PAUSED` (`pauseBySession`). FK de sessão é `NO ACTION`.

## Convite

`SaveLinkRotationGroupsUseCase` e `RefreshLinkRotationGroupUseCase`:

- `AUTO`: `engine.getGroupInviteLink` pela sessão. Exige a sessão admin do grupo.
- Sem permissão (`GROUP_INVITE_NOT_ALLOWED`) → `NEEDS_LINK`, `linkSource` nulo. Engine/sessão fora → mantém o que tinha
  ou `NEEDS_LINK`, sem derrubar o salvamento. Outro erro sobe.
- `MANUAL`: usuário cola o link; `parseInviteCode` aceita variações de `chat.whatsapp.com/<code>` (code 16–32
  alfanumérico). Banco guarda só o code.

## Slug

`slugRules.ts` (pura): normaliza (sem acento, minúsculo, espaço/`_` → hífen), regex 3–50 `[a-z0-9-]` sem hífen nas pontas.
Reservados padrão: `www app api admin mail cdn static status hub probe` + `LinkDomain.reservedNames`. Trocar nome ou
excluir reserva o antigo 30 dias para o mesmo tenant (`link_slug_reservations`). Ocupado → 409 `LINK_SLUG_TAKEN` com até
5 sugestões em `meta.suggestions` (`-oficial`, `-vip`, `2`, `3`…), checadas numa consulta. Corrida no unique também ganha
sugestões.

## Admin de domínios (`/api/admin/link-domains`, super-admin)

- CRUD. Hostname só ASCII, ≥ 2 rótulos. Host da plataforma ou subdomínio dele é recusado (400 `LINK_DOMAIN_INVALID`).
  Duplicado → 409 `LINK_DOMAIN_TAKEN`; excluir com rotação → 409 `LINK_DOMAIN_IN_USE`.
- `landingUrl` opcional, só `https://`. Vazio = apex mostra o 404 da marca. Não fixar em código, seed ou env.
- Probe (`POST /:id/probe`): `GET https://probe-<8hex>.<hostname>/.well-known/link-rotation?token=` espera 204. Token
  HMAC-SHA256 (`LINK_PROBE_SECRET`) sobre id + hostname + expiração, válido 5 min, comparação em tempo constante.
  Hostname sempre do registro salvo; guarda anti-SSRF recusa IP não público; `redirect: 'manual'`, sem credencial,
  timeout 5 s. Motivos: `REDIRECT`, `UNEXPECTED_STATUS`, `TIMEOUT`, `NETWORK_ERROR`, `BLOCKED_ADDRESS`, `UNRESOLVABLE`.
- Painel: `/admin/link-domains` (`AdminLinkDomainsPage`, `DnsSetupGuide` com os passos abaixo).

## Infra por domínio

Domínio atual: **`copysync.com.br`**, validado em 2026-10-29 (certificado Let's Encrypt apex + wildcard, tudo DNS only).
Serviço Render `copysync_api` (`copysync-ithg.onrender.com`).

1. Cloudflare: Add domain (Free). AI training & search policies = Block.
2. Registrador: trocar nameservers para os da zona. Sem DNSSEC. `.br` leva ~2 h.
3. Render, Custom Domains do serviço: `dominio` + `*.dominio` (+ `www` opcional). A Render exige o apex junto do wildcard.
4. Cloudflare DNS, **todos DNS only**:

   | Tipo | Nome | Conteúdo |
   | --- | --- | --- |
   | A | `@` | `216.24.57.1` |
   | CNAME | `www` | `copysync-ithg.onrender.com` |
   | CNAME | `*` | `copysync-ithg.onrender.com` |
   | CNAME | `_acme-challenge` | `copysync-ithg.verify.renderdns.com` |
   | CNAME | `_cf-custom-hostname` | `copysync-ithg.hostname.renderdns.com` |

   Sem AAAA, sem CAA (ou liberar `letsencrypt.org` e `pki.goog`). Os dois com `_` ficam cinza para sempre.
5. Render: aguardar Verified + Certificate Issued.
6. Painel admin: cadastrar o domínio e rodar o probe.

- **Custo**: o plano da Render inclui 2 custom domains, já usados (`copysync.app`, `copysync.com.br`). Conta por raiz
  (apex + wildcard + www = 1). Cada raiz extra custa: um domínio de rodízio, muitos subdomínios.
- **Proxy laranja só no lançamento (T24)**, com SSL/TLS **Full (strict)** (Flexible = loop de redirect), **Bot Fight Mode
  desligado** (desafia webview Instagram/TikTok), regra WAF *Skip* para esses UAs e rate limit por IP na rota pública.

## Env

| Variável | Sem ela |
| --- | --- |
| `LINK_CLICK_SALT` (≥ 32) | Produção: recurso desligado, página pública 503 |
| `LINK_PROBE_SECRET` (≥ 32) | Produção: probe 503 `LINK_ROTATION_NOT_CONFIGURED` e `/.well-known` 404. Página pública segue funcionando |
| `LINK_ROTATION_MEMBER_SYNC_ENABLED` | `false` (padrão): sem contagem de membros nem retenção |

Segredo ausente ou curto **não derruba o boot**: loga aviso e `isLinkRotationConfigured()` fica false. Fora de produção
há valor sintético fixo. Telas do tenant e do admin seguem funcionando.

## Consultas sem `tenantId`

- `findPublicByHost(hostname, slug)`: a rota pública não tem tenant context; o tenant **sai** do registro (domínio +
  slug únicos). É a única leitura que resolve tenant a partir de dado externo. `incrementClick` usa os ids devolvidos
  por ela; dedupe, rótulos e `allFullNotifiedAt` já levam o `tenantId` da rotação.
- Retenção (`deleteOlderThan`) e `listDue` do job são varreduras globais de manutenção por desenho (um job por cluster).
  Gravações do job levam `tenantId`.
- `link_domains` é tabela da plataforma, sem tenant.

## O que não fazer

- Não interceptar Host sem checar `isPlatformHostname` primeiro, nem cadastrar host da plataforma como domínio.
- Não trocar a página por 302 direto: quebra webview e prévia OG, e conta bot como clique.
- Não contar nem entregar convite a bot. Não gravar IP cru.
- Não deixar `/health`, `/docs` ou `/api` responderem em host público.
- Não afrouxar a CSP (`unsafe-inline`, script) nem pôr CSS dinâmico: o hash é do CSS fixo.
- Não ligar `LINK_ROTATION_MEMBER_SYNC_ENABLED` fora da Render (`api/.env` = produção).
- Não chamar o WhatsApp por clique: membros só pelo job/refresh.
- Não guardar estado operacional em memória sem TTL (o cache de domínios é TTL 60 s e descartável).
- Não usar o nome do app em código, rota, chave ou evento (white label); marca só via `APP_NAME`.
- No painel, não comparar `Date.now()` com horário do servidor: `serverNow()`.
- Não rodar `prisma migrate`/`start:migrate` local contra `api/.env`.
- Não fixar `landingUrl` em código/seed/env; não editar a migration aplicada (preset novo = migration nova).
- Não mudar ordem/critério de rebaixo sem atualizar `ApplyPlanLimitsToLinkRotationsUseCase` **e** `UpdateLinkRotationUseCase`.

## Riscos conhecidos e pendências

- Rate limit 60/min por IP: CGNAT/rede móvel pode bloquear gente real numa campanha forte. Medir antes de soltar.
- O 429 sai em JSON do rate limit global, não na página HTML.
- `incrementClick` e `LinkClick` fora da mesma transação (e dedupe antes deles): o agregado pode passar 1 do
  registro detalhado; duas requisições simultâneas do mesmo IP podem contar as duas.
- `superAdminHook` devolve 401 (não 403) sem super-admin.
- Lotação só grava `allFullNotifiedAt`; aviso ao tenant (e-mail) ainda não existe.
- Proxy laranja, WAF e rate limit de borda: T24, ainda não validados sobre o wildcard.

## Mapa de arquivos

| Camada | Caminho |
| --- | --- |
| Domínio (puro) | `api/src/modules/link-rotation/domain/services/` (`publicHost`, `pickGroup`, `slugRules`, `hashClickIp`, `classifyUserAgent`, `inviteUrl`) |
| Use cases | `link-rotation/application/use-cases/` (+ `admin/`: domínios, probe, `probeToken`, `linkDomainRules`) |
| Infra | `link-rotation/infrastructure/` (`repositories/`, `cache/ActiveLinkDomainCache`, `jobs/LinkRotationMemberSyncJob`, `publicLinkComposition`, `linkRotationPlanLimits`) |
| Rotas | `presentation/routes/` (`linkRotation`, `linkDomainAdmin`, `publicLink`) · `templates/` · registro em `app/app.ts`, `app/routes.ts`, job em `app/server.ts` |
| Erros | `shared/errors/internal/LinkRotationErrors.ts`, `GroupErrors.ts` |
| Env | `shared/config/env.ts` (`resolveLinkRotationSecret`, `isLinkRotationConfigured`) |
| Banco | `prisma/migrations/20261029020000_create_link_rotation` (`link_domains`, `link_rotations`, `link_rotation_groups`, `link_slug_reservations`, `link_clicks` + presets) |
| Painel tenant | `app/src/pages/link-rotation/LinkRotationPage.tsx` · `app/src/features/linkRotation/` · `services/linkRotation.service.ts` · `/link-rotation` |
| Painel admin | `app/src/pages/admin/AdminLinkDomainsPage.tsx` · `app/src/features/linkDomainsAdmin/` · `services/adminLinkDomains.service.ts` |
| Privacidade | `privacyFlags.ts`: `linkRotation.rotationLink`, `.sessionName`, `.groupName`, `.groupAvatar` |

## Identidade da página pública

Favicon, logo do rodapé e ícone de prévia saem de `PANEL_URL/assets/brand/`; a foto do grupo, de
`ChatConversation.groupAvatarUrl` no armazenamento (`S3_PUBLIC_URL`). A API só escreve as URLs: nenhum arquivo
servido por ela. `img-src` da CSP = essas duas origens. Foto fora do armazenamento vira a inicial do nome.
Não embutir imagem em base64 no HTML nem servir arquivo pela API (peso por clique).

