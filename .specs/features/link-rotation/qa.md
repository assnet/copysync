# QA — Rodízio de links (T23)

Data: 2026-10-29 · Branch `feature/link-rotation` (worktree `copysync-link-rotation`, base `a364896`) ·
Painel v0.51.0.

## Ambiente

| Item | Como |
| --- | --- |
| Banco | Postgres 16 descartável (`api/scripts/postgres-descartavel.sh start`, porta 55520, `127.0.0.1`), todas as migrations aplicadas. Removido no fim (`stop`). |
| Seed | `prisma/seed.ts` com `DATABASE_URL` local explícito. Super-admin `copysyncapp@gmail.com` (acesso a todos os tenants). |
| API | `npm run build` + `node --env-file=<scratchpad>/api.env dist/app/server.js`, cwd no scratchpad (sem `.env.local`), porta 3399, `NODE_ENV=development`, segredos falsos, workers/jobs desligados (flags padrão). Conexão confirmada em `pg_stat_activity` do cluster local (`127.0.0.1`). |
| Painel | `VITE_API_URL=/api VITE_DEV_PROXY_TARGET=http://127.0.0.1:3399 npx vite --port 5199`. |
| Dados | Via SQL local: sessões `Atendimento Principal` (CONNECTED no banco) e `Vendas` (DISCONNECTED) no Acme, `Beta Sessao` no Beta; 4 grupos no Acme e 1 no Beta. Domínio `copysync.com.br` criado pela tela admin. Entitlements `link_rotations=1` e `link_rotation_groups=3` no Acme (banco local). |
| Navegador | agent-browser (Chrome headless), 1440×900 e 390×844. Página pública aberta com `--host-resolver-rules=MAP *copysync.com.br 127.0.0.1:3399`. |

Atenção: o `api/.env.dev` que já existe no worktree aponta para o banco de **produção** (Render).
Não foi usado nem alterado. O env do QA ficou no scratchpad e foi apagado no fim.

## Checklist

### 1. Admin — `/admin/link-domains`

| Verificação | Resultado |
| --- | --- |
| Estado vazio + passo a passo de DNS (6 passos + tabela de 5 registros com copiar) | OK |
| Criar domínio: `CopySync.com.br` vira minúsculo; `http://` no endereço do domínio puro é recusado com mensagem clara; nome reservado extra `Promo` salvo como `promo` | OK |
| Domínio duplicado → `LINK_DOMAIN_TAKEN` 409; hostname inválido → `LINK_DOMAIN_INVALID` 400 (API) | OK |
| Editar endereço do domínio puro: https salvo; campo vazio grava `null` ("Página 404 da marca") | OK |
| Pausar/ativar (switch): domínio pausado some de `GET /link-rotation` do tenant | OK |
| Excluir com rodízio → toast "Há clientes com links neste domínio. Pause o domínio em vez de excluir." (409) | OK |
| Probe: falha local traduzida ("O subdomínio respondeu, mas não pelo serviço da API… (resposta HTTP 404)") | OK |
| `/.well-known/link-rotation`: token válido → 204 (em `_probe.` e em slug); sem token ou inválido → 404 | OK |
| Não super-admin → 401 `UNAUTHORIZED` | OK pelo contrato (a spec P1 #4 fala em 403; ver B13) |
| Tooltips nas ações (testar, editar, excluir) | OK |
| Claro e escuro | OK |

### 2. Tenant — `/link-rotation`

| Verificação | Resultado |
| --- | --- |
| Estado vazio com os 3 passos e CTA | OK |
| Criar: prévia ao vivo, contador `n/50`, `Promo Mãe Ção!` → `promo-mae-cao` | OK |
| Nome reservado (`www`, e o extra `promo`) → "Esse nome é reservado. Escolha outro." | OK |
| Nome tomado por outro tenant → erro + 5 sugestões clicáveis; sugestão preenche o campo | OK |
| Nome inválido (`ab`) → `LINK_SLUG_INVALID`; apelido > 80 → 400 (API) | OK |
| Criar leva direto ao diálogo de grupos com toast "Link criado. Agora escolha os grupos." | OK |
| Copiar link → botão vira "Copiado!" (o conteúdo da área de transferência não pôde ser lido no headless) | OK |
| Status no card (switch): pausa/ativa; página pública reflete | OK |
| Configurar: renomear abre confirmação com link antigo riscado e aviso de 30 dias; nome antigo fica reservado ao próprio tenant (o tenant consegue voltar a usá-lo) | OK |
| Estratégia (Equilibrado / Um de cada vez / Por peso / Aleatório) salva | OK |
| Grupos: lista da sessão com aviso "lista pode estar incompleta" (engine offline); `x de y selecionados`; limite do plano visível | OK |
| Selecionar acima do limite → aviso animado de upgrade "Seu link está pronto para mais gente!" com CTA "Ver planos"; "Agora não" mantém a seleção | OK (é um diálogo sobreposto, não um banner embutido) |
| Menos que o limite salva | OK |
| Ordem (setas), teto 50–1024 (slider, `Home`/`End`), peso 1–100 só em "Por peso" | OK (gravado no banco) |
| Link manual: URL fora de `chat.whatsapp.com` bloqueada no painel e na API (`LINK_INVITE_URL_INVALID`); válido → `MANUAL`, status `ACTIVE`; sem link → `NEEDS_LINK` ("Falta o link de convite") | OK |
| "Atualizar agora" sem engine → "A sessão está desconectada. Conecte-a para continuar." | OK (ver B9) |
| Grupo de outra sessão/tenant → `LINK_GROUP_INVALID`; acima do limite → `PLAN_LIMIT_REACHED` (API) | OK |
| Limite de links (1 de 1) → aviso de upgrade "Seus links estão a todo vapor!" | OK |
| Isolamento: admin do Beta recebe 404 nas rotas do rodízio do Acme e 403 ao forçar `x-tenant-id` do Acme | OK |
| Persistência: diálogo de grupos aberto sobrevive ao reload | OK |
| Estatísticas: total, 7 dias, último clique, por grupo com ocupação | OK depois da correção de B1 |
| Excluir link pelo painel | **FALHA** (B3) |

### 3. Limite por plano

Sem entitlement → `limits` nulos (ilimitado, "Sem limite de grupos no plano"). Com `link_rotations=1` e
`link_rotation_groups=3` → avisos acima. **OK**.

### 4. i18n / textos

Todos os textos visíveis estão em pt-BR (centralizados em `features/linkRotation/strings.ts` e
`features/linkDomainsAdmin/strings.ts`). Nenhuma chave crua nem texto em inglês nas telas. Exceção: o
429 da página pública (B5). **OK**, com pontos cosméticos em B12.

### 5. Privacidade

Flags `linkRotation.rotationLink`, `sessionName`, `groupName`, `groupAvatar` em `/privacidade`.
Card, prévia, sessão, nomes e fotos de grupos (card, estatísticas, lista e itens) borram.
Os campos "Nome do link" e "Apelido" do diálogo Configurar não borravam (B2, corrigido). O link de
convite manual continua visível (B4).

### 6. Página pública (curl com `Host:`)

| Caso | Resposta |
| --- | --- |
| Rodízio ativo com grupo com convite | 200, título, "Você está entrando em **Promo Mamães 2**", botão `href` + `meta refresh` de 1 s; sem cookie | OK |
| Headers | `Cache-Control: no-store`, `X-Robots-Tag: noindex, nofollow`, `<meta robots noindex>`, `Referrer-Policy: no-referrer`, CSP `default-src 'none'` + hash do style, `frame-ancestors 'none'` | OK |
| Pausado | 200 "Link em pausa" | OK |
| Lotado (`capacity=50`, `memberCount=60`) | 200 "Grupos lotados"; `allFullNotifiedAt` gravado | OK |
| Não encontrado / excluído | 404 "Link não encontrado" | OK |
| Apex sem endereço do domínio puro | 404 | OK |
| Apex com endereço | 301 → URL configurada (só depois de até 60 s, ver B6) | OK |
| `www.<slug>.<dominio>` | 404 | OK |
| `/health`, `/api/health` em host público | 404 HTML | OK |
| Host com maiúscula e porta (`MAMAES-VIP.CopySync.com.br:8443`) | 200 | OK |
| UA de bot (`facebookexternalhit`) | 200 prévia sem convite nem refresh; clique não contado | OK |
| `api.copysync.app` e `localhost:3399` | não interceptados (`/health` 200 JSON) | OK |
| Contagem | atômica por rodízio e por grupo; `ipHash` sha256 (64 hex), sem IP em claro; mesmo IP em 10 min não conta de novo | OK |
| Sequencial com teto 50 e 49 membros | 1º IP novo → grupo A; os seguintes → B | OK |
| Rate limit 60/min por IP | 61ª → 429 | OK (ver B5) |
| Navegador claro/escuro (390 px) | 404, pausado, lotado e redirect (redirect salvo sem o `meta refresh` para não sair para o WhatsApp) | OK |

### 7. Responsivo (390 px)

Card, diálogo de grupos e Configurar sem rolagem horizontal (`scrollWidth = 390`). Link e nomes
longos truncam com reticências. **OK**.

## Bugs

| # | Gravidade | Onde | Problema | Status |
| --- | --- | --- | --- | --- |
| B1 | Média | `app/src/features/linkRotation/components/RotationCard.tsx:160`, `RotationStatsCard.tsx:43-75` | A área de estatísticas buscava `/stats` só ao montar. Depois de salvar grupos, mudar teto ou pausar, "Por grupo" continuava "Nenhum grupo neste link ainda" até recarregar a página. | **Corrigido**: prop `refreshKey` (status + id/status/teto/membros dos grupos) recarrega em modo suave, sem voltar ao esqueleto. Teste novo em `__tests__/RotationStatsCard.test.tsx`. |
| B2 | Média | `RotationConfigDialog.tsx:85-88, 248, 390` | Com "Link público e apelido" ligado, os campos Nome do link e Apelido mostravam o texto sem borrar (a prévia já borrava). | **Corrigido**: borra só o texto digitado (mesmo padrão de `OfferEditor.tsx:49`). |
| B3 | Alta | `RotationCard.tsx` / `pages/link-rotation/LinkRotationPage.tsx` | O tenant não tem como excluir um link pelo painel (spec P1 "Tenant configura subdomínio" #5). `linkRotationService.remove`, `strings.card.remove` ("Excluir link"), `card.moreActions` e `toast.removed` existem, mas nada os usa. A API (`DELETE /:id`) funciona: 204, página passa a 404, nome reservado 30 dias. | Não corrigido (precisa de menu "Mais ações" e confirmação; fora de "bug pequeno"). |
| B4 | Média | `RotationGroupItem.tsx:~185` (campo "Link de convite do grupo") | O link de convite manual (`https://chat.whatsapp.com/…`) dá entrada no grupo e não borra com nenhuma flag. | Não corrigido: falta decidir se usa flag nova (ex.: `linkRotation.inviteLink`) ou uma existente. |
| B5 | Baixa | `publicLink.routes.ts:109-112` + `rateLimitPresets.publicLink` | No host público, o 429 sai como JSON em inglês (`Rate limit exceeded, retry in 1 minute`) sem `no-store`/`noindex`/CSP. O visitante vê JSON cru. | Não corrigido. Sugestão: `errorResponseBuilder`/tratamento que responda a página HTML da marca com 429. |
| B6 | Baixa | `infrastructure/cache/ActiveLinkDomainCache.ts:4` | Alteração do admin (endereço do domínio puro, pausa, domínio novo) leva até 60 s para valer na página pública (TTL sem invalidação). A tela não avisa. | Não corrigido: aceitável com várias instâncias; vale um texto "pode levar até 1 minuto". |
| B7 | Baixa | `publicLink.routes.ts:76` | Apex responde **301** para um destino editável. Navegadores guardam 301 mesmo com `no-store`: quem já visitou não vê a troca. | Não corrigido. Sugestão: 302/307. |
| B8 | Baixa | `domain/services/publicHost.ts` | `www.<dominio>` (o guia de DNS cria `CNAME www`) responde 404 em vez de seguir o endereço do domínio puro. | Decisão de produto. |
| B9 | Baixa | `RotationGroupItem.tsx` | O erro de "Atualizar agora" (sessão desconectada) aparece como erro do campo de link de convite (borda vermelha no input), mesmo com o link certo. | Não corrigido. |
| B10 | Baixa (a11y) | `RotationGroupItem.tsx:~110-125`, `DnsSetupGuide.tsx` | "Subir na ordem", "Descer na ordem", "Tirar do link" e "Atualizar agora" não incluem o nome do grupo no `aria-label` (leitor de tela ouve 3× o mesmo rótulo). No guia de DNS, o `aria-label` "Mostrar ou esconder o passo a passo" substitui o título visível. | Não corrigido. |
| B11 | Baixa | `RotationGroupItem.tsx` / `groupStatus` | Grupo com estimativa no teto (`memberCount 49` + `clicksSinceSync 1` com teto 50) aparece "Recebendo cliques" e "49 de 50", mas o redirect já não o escolhe. | Não corrigido: mostrar o estimado ou um selo "no limite". |
| B12 | Cosmético | `strings.ts:59, 253`; erro de nome tomado | Card sem grupos mostra duas mensagens seguidas ("Nenhum grupo escolhido…" e "Nenhum grupo neste link ainda."). Nome tomado repete "Esse nome já está em uso" no erro e no título das sugestões. Subtítulo da página sem ponto final. | Não corrigido. |
| B13 | Info | spec P1 #4 × `api-contract.md` | Spec diz 403 para não super-admin; implementação e contrato usam 401 (hook compartilhado com `/admin/ai`). | Alinhar a spec. |

Observações sem bug: `-abc` vira `abc` (normalização, por design); `xn--abc` é aceito (prefixo
punycode; avaliar se deve ser reservado). A página pública herda `access-control-allow-credentials: true`
do CORS global (sem `Access-Control-Allow-Origin`, inofensivo). `trustProxy: 1` + guia com DNS only
(sem proxy da Cloudflare) é coerente; se o proxy for ligado, IP de dedupe e rate limit vira o da borda.

## Alterações de código feitas no QA

- `app/src/features/linkRotation/components/RotationStatsCard.tsx` — prop `refreshKey` (B1).
- `app/src/features/linkRotation/components/RotationCard.tsx` — passa `refreshKey` (B1).
- `app/src/features/linkRotation/components/RotationConfigDialog.tsx` — borra slug e apelido (B2).
- `app/src/features/linkRotation/__tests__/RotationStatsCard.test.tsx` — teste do `refreshKey`.

`tsc --noEmit` (app) sem erros; `vitest run src/features/linkRotation`: 59/59. Sem commit.

## Não testado

| Item | Motivo |
| --- | --- |
| Link de convite `AUTO` (sessão admin), `NEEDS_LINK` por link revogado, contagem real de membros e job de 15 min / 25 cliques | Sem WhatsApp conectado localmente (engine offline). |
| Distribuição BALANCED, WEIGHTED e RANDOM ao vivo | Só SEQUENTIAL foi exercitado via HTTP; as outras dependem de muitos IPs distintos. Cobertas pelos testes unitários de `pickGroup`. |
| Tenant `SUSPENDED`, `PAUSED_BY_PLAN` por rebaixamento, sessão excluída | Exigem fluxo de billing ou exclusão de sessão; não montados. |
| Probe com sucesso real (DNS/TLS) | Ambiente local; só a falha e o 204 com token local. |
| Aviso de "todos lotados" no painel | `allFullNotifiedAt` foi gravado; o aviso no painel não foi procurado. |
| Conteúdo copiado para a área de transferência | O headless nega `clipboard.readText`. |
| Modo "sistema" do tema | O painel só alterna claro/escuro no seletor; os dois foram cobertos. |

## Screenshots

Pasta: `/private/tmp/claude-501/-Users-adrielss-www-copysync/1e9a83ea-6d3c-4d38-95e8-ee7e5384d446/scratchpad/qa/shots/`
(o scratchpad é temporário; copie se for guardar).

- Admin: `01-admin-vazio-claro.png`, `02-admin-dns-claro.png`, `03-admin-add-erro-claro.png`, `04-admin-add-dialog-claro.png`,
  `05-admin-lista-claro.png`, `06-admin-tooltip-claro.png`, `07-admin-probe-claro.png`, `08-admin-pausado-claro.png`,
  `09-admin-lista-escuro.png`, `50-admin-excluir-confirm-claro.png`, `51-admin-excluir-bloqueado-claro.png`
- Tenant: `10-tenant-vazio-escuro.png`, `11-tenant-vazio-claro.png`, `12-tenant-criar-claro.png`, `13-tenant-criar-previa-claro.png`,
  `14-tenant-reservado-claro.png`, `15-tenant-nome-tomado-claro.png`, `16-tenant-criado-claro.png`, `17-tenant-reload-claro.png`,
  `18-tenant-banner-limite-claro.png`, `19-tenant-grupos-config-claro.png`, `20-tenant-grupos-invalido-claro.png`,
  `21-tenant-card-salvo-claro.png` (B1 antes), `22-tenant-card-reload-claro.png`, `23-tenant-rename-confirm-claro.png`,
  `24-tenant-apos-rename-claro.png`, `25-tenant-grupos-peso-claro.png`, `26-tenant-stats-apos-remover-claro.png` (B1 depois),
  `27-tenant-limite-links-claro.png`, `28-tenant-pausado-claro.png`, `34-tenant-card-escuro.png`, `35-tenant-grupos-escuro.png`,
  `36-tenant-banner-limite-escuro.png`, `37-tenant-refresh-sem-engine-escuro.png`
- Privacidade: `29-privacidade-flags-claro.png`, `30-privacidade-card-claro.png`, `31-privacidade-grupos-claro.png` (B4),
  `32-privacidade-config-claro.png` (B2 corrigido), `33-privacidade-lista-grupos-claro.png`
- Celular: `38-mobile-card-escuro.png`, `39-mobile-grupos-escuro.png`, `40-mobile-config-claro.png`, `41-mobile-card-claro.png`
- Página pública: `42-publica-404-escuro.png`, `43-publica-404-claro.png`, `44-publica-pausado-claro.png`,
  `45-publica-pausado-escuro.png`, `46-publica-redirect-escuro.png`, `47-publica-redirect-claro.png`,
  `48-publica-lotado-claro.png`, `49-publica-lotado-escuro.png`

## Correções após o QA (2026-10-29)

| Bug | Situação |
| --- | --- |
| B1, B2 | Corrigidos no QA |
| B3 | Corrigido: "Mais ações" → "Excluir link" com confirmação |
| B4 | Corrigido: flag `linkRotation.inviteLink` |
| B5 | Corrigido: 429 do host público é página HTML da marca |
| B6 | Corrigido: aviso de até 1 minuto na tela admin |
| B7 | Corrigido: apex com 302 |
| B8 | Corrigido: `www.<domínio>` segue o domínio puro |
| B9, B10, B11, B12 | Corrigidos |
| B13 | Spec alinhada ao contrato (401) |

Não testado localmente (precisa de WhatsApp e DNS reais): convite automático, contagem de membros pelo job,
probe real, estratégias ao vivo além da sequencial, tenant suspenso e rebaixo de plano ponta a ponta.
