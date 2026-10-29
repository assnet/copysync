# Rodízio de links (link-rotation) — Especificação

Status: **spec** (2026-10-28). Decisões do owner: `context.md`. Roadmap: item 9 (`docs/produto-roadmap.md`),
módulo `campaigns/link-rotation`. Planos: `docs/planos.md`, presets em `tenants/domain/planPresets.ts`.

## Problema

Afiliado divulga o link do grupo nas redes; o link do WhatsApp expira/é revogado e o grupo lota em 1024.
Ele precisa de **um link fixo** (`promodemae1.copysync.app`) que nunca expira e sempre leva a um grupo com vaga,
distribuindo visitantes entre os grupos dele conforme uma estratégia.

## Objetivos

- [ ] Tenant configura subdomínio em domínio da plataforma e copia o link em < 1 min.
- [ ] Visitante do link sempre chega num grupo com vaga (ou vê aviso claro quando todos lotaram).
- [ ] Super-admin cadastra domínios disponíveis sem deploy.
- [ ] Limites por plano (rodízios e grupos) só em entitlement, nunca hardcoded.

## Fora de escopo (v1)

| Item | Motivo |
| --- | --- |
| Domínio próprio do cliente (CNAME) | Roadmap 15, Profissional+; depende de TLS por cliente |
| Telegram | Engine ainda não existe |
| UTM / origem do clique / gráficos | v2; v1 conta total e por grupo |
| Mais de um rodízio por sessão no Starter/Profissional | Owner decide depois (`context.md` #5) |
| Criar grupo automaticamente quando todos lotam | Risco de automação no número; avaliar depois |

---

## Histórias

### P1 — Admin cadastra domínios ⭐

Como super-admin, quero cadastrar/pausar os domínios base (`copysync.app`, `copysync.pro`, …) para que tenants
escolham subdomínios neles.

1. WHEN super-admin cria domínio válido (FQDN minúsculo) THEN sistema SHALL salvar com status `ACTIVE` e lista de
   nomes reservados padrão (`www`, `app`, `api`, `admin`, `mail`, `cdn`, `static`, `status`, `hub`).
2. WHEN domínio é pausado (`PAUSED`) THEN novos rodízios SHALL não oferecê-lo e links existentes SHALL continuar
   servindo.
3. WHEN domínio tem rodízios ativos THEN exclusão SHALL ser recusada (`LINK_DOMAIN_IN_USE`, 409).
4. WHEN usuário não super-admin chama `/admin/link-domains` THEN SHALL 401 (hook compartilhado com `/admin/ai`).
5. WHEN admin abre a tela THEN SHALL ver instrução de DNS (CNAME `*` proxied no Cloudflare → host da API) e
   resultado da última verificação (`GET https://_probe.<dominio>/.well-known/link-rotation` responde 204).

Teste independente: cadastrar `copysync.app`, pausar, tentar excluir com rodízio → 409.

### P1 — Tenant configura subdomínio ⭐

Como tenant, quero escolher `nome` + domínio e copiar o link.

1. WHEN tenant escolhe nome válido (`^[a-z0-9](?:[a-z0-9-]{1,48}[a-z0-9])?$`, 3–50) em domínio `ACTIVE` e não
   reservado e livre THEN sistema SHALL criar rodízio ligado a **uma sessão** do tenant e mostrar botão "Copiar link".
2. WHEN nome já usado em qualquer tenant (ou reservado por 30 dias) THEN SHALL `LINK_SLUG_TAKEN` (409) e tela
   sugere variações (`nome-2`, `nome-promo`).
3. WHEN tenant já tem `link_rotations` rodízios THEN SHALL `PLAN_LIMIT_REACHED {key:'link_rotations', limit}`
   e tela mostra aviso de upgrade com link `/plans`.
4. WHEN tenant troca o nome THEN SHALL confirmar em modal ("link antigo para de funcionar"), reservar o antigo por
   30 dias para o mesmo tenant e atualizar o link.
5. WHEN tenant exclui rodízio THEN SHALL remover grupos e reservar nome 30 dias; link passa a responder 404 com
   página "link indisponível".
6. WHEN tenant pausa rodízio THEN link SHALL mostrar página "pausado" (sem redirecionar).
7. Preview do link atualiza enquanto digita; contador `n/50`; regras visíveis como na referência.

Teste independente: criar `promodemae1` em `copysync.app`, copiar, abrir no navegador anônimo.

### P1 — Tenant escolhe grupos e estratégia ⭐

Como tenant, quero escolher quais grupos entram, em que ordem/peso e como rotacionar.

1. WHEN tenant abre "Grupos" THEN SHALL ver grupos da sessão do rodízio (busca por nome, mostrando `x de y`),
   com indicador "sessão é admin" e contagem de membros quando conhecida.
2. WHEN tenant seleciona até `link_rotation_groups` grupos THEN SHALL salvar; menos que o limite é aceito.
3. WHEN tenta selecionar acima do limite THEN checkbox SHALL ficar bloqueado e aparecer banner animado/atraente
   "No plano X você pode ter até N grupos" com CTA `/plans` (sem erro, sem perder seleção).
4. WHEN grupo tem sessão admin THEN sistema SHALL obter o invite link automaticamente (porta do engine) e marcar
   origem `AUTO`; WHEN não é admin THEN SHALL pedir link manual (`https://chat.whatsapp.com/<code>`), origem `MANUAL`.
5. WHEN tenant escolhe estratégia THEN SHALL aceitar `BALANCED` (default), `SEQUENTIAL` (ordem arrastável),
   `WEIGHTED` (peso 1–100 por grupo, soma livre), `RANDOM`.
6. WHEN tenant define teto por grupo (default 1000, 50–1024) THEN SHALL respeitar ao decidir "cheio".
7. WHEN tenant desmarca grupo THEN SHALL sair do rodízio na hora, mantendo contagem histórica de cliques.
8. Grupo com link `AUTO` revogado/expirado (erro ao resolver) SHALL ficar `NEEDS_LINK` e sair do rodízio até
   corrigir; painel avisa.

Teste independente: 2 grupos, estratégia sequencial, teto 50 no 1º: visitantes vão ao 1º até 50, depois ao 2º.

### P1 — Visitante é redirecionado ⭐

Como visitante, abro `promodemae1.copysync.app` e entro num grupo com vaga.

1. WHEN host resolve para rodízio `ACTIVE` com ≥1 grupo elegível THEN API SHALL responder página HTML leve
   (nome do grupo, botão "Entrar no grupo", meta OG, auto-redirect ~1,5 s, sem JS obrigatório: `<meta refresh>`
   + botão `href`), **sem cookies de sessão** e sem expor dados além do nome do grupo.
2. Grupo elegível = `ACTIVE`, link conhecido, `membros estimados < teto`. Membros estimados =
   último `memberCount` da sessão + cliques desde a última atualização.
3. WHEN estratégia `BALANCED` THEN SHALL escolher o elegível com menor `membros estimados / teto`; empate →
   menos cliques.
4. WHEN `SEQUENTIAL` THEN primeiro elegível na ordem. WHEN `WEIGHTED` THEN sorteio proporcional ao peso entre
   elegíveis. WHEN `RANDOM` THEN uniforme.
5. WHEN nenhum elegível THEN SHALL página "grupos lotados / em breve" (200, sem redirect) e evento `ALL_FULL`
   registrado uma vez por hora para o painel avisar.
6. WHEN host não corresponde a rodízio (ou pausado/excluído) THEN 404 com página genérica da marca.
7. Clique SHALL ser contado por rodízio e por grupo (`clickCount`, `lastClickAt`); IP só como hash diário
   (`sha256(ip + dia + salt)`) para dedupe/abuso, nunca em claro. Bot conhecido (UA de crawler) não conta e
   recebe só a página sem redirect.
8. Rota pública SHALL ter rate limit por IP (ex.: 60/min) e `Cache-Control: no-store`.
9. `GET /.well-known/link-rotation` em qualquer host cadastrado SHALL 204 (verificação do admin).

Teste independente: abrir link 3× com teto 1 no 1º grupo → 1º clique vai ao grupo A, 2º e 3º ao B.

### P2 — Membros conferidos pela sessão

1. WHEN sessão do rodízio está conectada THEN job SHALL atualizar `memberCount` dos grupos a cada 15 min
   (metadata do grupo via porta do engine, cache do adapter) e após cada 25 cliques no grupo; zera "cliques desde
   atualização".
2. WHEN `memberCount ≥ teto` THEN grupo vira `FULL` e sai do rodízio; WHEN cai abaixo THEN volta.
3. WHEN sessão desconectada THEN SHALL usar último valor + cliques (estimativa) e painel mostra "contagem
   desatualizada desde <data>".
4. Volume: no máximo 1 chamada de metadata por grupo por 15 min por sessão (regra de 2026-09-21: nada de
   tráfego fora de padrão humano).

### P2 — Painel: métricas e estado

1. Card do rodízio SHALL mostrar: link, status, sessão, grupos cadastrados, total de cliques, cliques 7 dias,
   grupos cheios / precisando de link.
2. Tela de grupos SHALL mostrar por grupo: membros, teto, cliques, estado (`ACTIVE`/`FULL`/`NEEDS_LINK`/`PAUSED`).
3. Dados sensíveis (nome do grupo, foto, subdomínio) SHALL ter flags de privacidade (`privacyFlags.ts`) e `Blurred`.
4. Rascunho da configuração SHALL persistir contra reload (`usePersistedState`, escopo `tab`), limpo ao salvar.

### P3 — Extras

1. Página de redirect com foto/descrição do grupo (quando sessão fornece) e tema da marca.
2. Reset de contagem de cliques pelo tenant.
3. Entitlement `link_rotations` maior no Profissional (decisão futura).

---

## Casos de borda

- WHEN sessão do rodízio é excluída THEN rodízio SHALL ficar `PAUSED` com aviso "sessão removida"; tenant escolhe
  outra sessão (grupos são re-selecionados, pois são da sessão).
- WHEN tenant é rebaixado de plano e tem mais grupos/rodízios que o novo limite THEN sistema SHALL manter os
  primeiros N ativos (ordem) e marcar o resto `PAUSED_BY_PLAN`; painel avisa com CTA `/plans`.
- WHEN tenant `SUSPENDED` THEN link SHALL responder página "indisponível" (não redireciona).
- WHEN dois cliques simultâneos THEN contagem SHALL ser atômica (`UPDATE … SET clickCount = clickCount + 1`).
- WHEN domínio pausado THEN links existentes continuam; novo rodízio não lista o domínio.
- WHEN nome contém maiúscula/acento THEN SHALL normalizar para minúsculo e recusar caractere inválido com
  mensagem clara.
- WHEN Host chega com porta ou `www.` THEN SHALL ignorar porta e tratar `www.<slug>.<dom>` como 404.

## Rastreabilidade

| ID | História | Fase | Status |
| --- | --- | --- | --- |
| LROT-01 | P1 Admin domínios (CRUD, status, reservados) | Design | Pending |
| LROT-02 | P1 Admin: verificação DNS/probe | Design | Pending |
| LROT-03 | P1 Subdomínio: criar/validar/unicidade/reserva 30d | Design | Pending |
| LROT-04 | P1 Subdomínio: limite `link_rotations` + aviso upgrade | Design | Pending |
| LROT-05 | P1 Subdomínio: trocar/pausar/excluir | Design | Pending |
| LROT-06 | P1 Grupos: seleção, limite `link_rotation_groups`, banner upgrade | Design | Pending |
| LROT-07 | P1 Grupos: invite link AUTO (porta engine) + MANUAL | Design | Pending |
| LROT-08 | P1 Grupos: estratégias BALANCED/SEQUENTIAL/WEIGHTED/RANDOM, teto, ordem, peso | Design | Pending |
| LROT-09 | P1 Redirect: resolução por Host, página leve, escolha do grupo | Design | Pending |
| LROT-10 | P1 Redirect: contagem atômica, hash de IP, bots, rate limit, no-store | Design | Pending |
| LROT-11 | P1 Redirect: páginas 404/pausado/lotado/suspenso + probe `.well-known` | Design | Pending |
| LROT-12 | P2 Membros via sessão (job 15 min / 25 cliques, FULL, estimativa) | Design | Pending |
| LROT-13 | P2 Painel: card, métricas, privacidade, persistência | Design | Pending |
| LROT-14 | Borda: sessão excluída, rebaixo de plano, tenant suspenso | Design | Pending |
| LROT-15 | Entitlements `link_rotations` (1/1/2) e `link_rotation_groups` (3/5/10) em presets + catálogo | Design | Pending |
| LROT-16 | i18n (strings pt-BR), tema claro/escuro, docs `docs/rodizio-de-links.md`, CHANGELOG, versões | Design | Pending |

Cobertura: 16 total, 16 mapeados em tarefas (`tasks.md`).

## Sucesso

- [ ] Tenant cria rodízio e copia link em < 1 min, sem suporte.
- [ ] 0 visitantes enviados a grupo lotado em teste com teto baixo.
- [ ] Redirect responde < 200 ms p95 (uma consulta indexada por host + update atômico).
- [ ] Nenhuma chamada Baileys fora do adapter; nenhuma consulta sem `tenantId` exceto a resolução pública por host.
