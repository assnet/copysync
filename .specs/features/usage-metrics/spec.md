# Uso dos recursos pelo super admin — Spec

**Status:** Implementado (P1–P3, api 0.104.0 · app 0.127.0, 2026-11-18). O código mudou o desenho em pontos registrados em [`docs/uso-dos-recursos.md`](../../../docs/uso-dos-recursos.md) (fila no portão de leitura, `inScope`, corte gravado do contador, consolidação por grupo de fonte, adoção só com direito); em caso de divergência, vale o doc e o código.

**Fonte:** pedido do dono em 2026-11-17: "uma tela de métricas para o super admin de recursos mais usados pelos
usuários, com filtros de medição adequados, para entender o que os usuários mais estão usando".
Base: [`docs/produto-roadmap.md`](../../../docs/produto-roadmap.md) (funcionalidades 1–18 e produtos),
[`docs/navegacao-produtos.md`](../../../docs/navegacao-produtos.md) (`buildNavigation`),
[`docs/acesso-por-produto.md`](../../../docs/acesso-por-produto.md) (`AFFILIATES`/`CHAT`/`SAVER`),
[`docs/ops-metricas.md`](../../../docs/ops-metricas.md) e [`docs/custos-infraestrutura.md`](../../../docs/custos-infraestrutura.md)
(telas irmãs do super admin, mesmo módulo `metrics`), [`docs/arquitetura-escala.md`](../../../docs/arquitetura-escala.md).
**Tamanho:** Large. Desenho em [`design.md`](design.md); tarefas em [`tasks.md`](tasks.md). **Status:** Draft, aguarda aprovação do dono.

## Problema

O painel tem 18 funcionalidades em 3 produtos, mas ninguém sabe quais são usadas de fato. A decisão do que
melhorar, o que vender em cada plano e o que cortar é feita por impressão. Não existe rastreio de uso nem de
navegação no painel (conferido: nenhum analytics no `app/`), e os dados que respondem à pergunta estão
espalhados em tabelas de domínio que só o banco conhece.

O que foi medido no banco de produção em 2026-11-17 (somente leitura, só contagens):

| Fato | Número |
| --- | --- |
| Contas (tenants) | 19, todas `ACTIVE`: 9 `COPYSYNC_MAX`, 5 `COPYSYNC_PRO`, 5 `COPYSYNC_LITE` |
| Contas com um membro super admin (candidatas a "interna") | 4 |
| `tenant_products` | 0 linhas (todas as contas são legado: Afiliados e Chat ativos, Saver inativo) |
| Histórico mais antigo em qualquer tabela candidata | 2026-10-26 (cerca de 3 semanas) |
| Ofertas (`offers`) | 24.265: monitoramento 24.046 (11 contas), gerador 89 (5 contas), Caçador 130 (1 conta) |
| Envios (`offer_dispatches`) | 216.328: `SENT` 185.274 (11 contas), `SKIPPED` 30.344, `FAILED` 77 |
| Capturas do monitoramento (`captured_offers`) | 38.905 (11 contas) |
| Mensagens do chat (`chat_messages`) | cerca de 280 mil: `OUTBOUND` 188.099 (11 contas, quase tudo envio automático de oferta), `INBOUND` 92.568 (4 contas) |
| IA (`ai_usage_logs`) | 193: `offer.text` 150, `offer_hunt_ranking` 30, `offer_story_headline` 11, `offer_hunt_config` 2 |
| Gestor de Links | 8 links (5 contas), 38 cliques (4 contas; cliques são apagados após 90 dias) |
| Página de Ofertas | 24 ofertas publicadas/criadas (4 contas) |
| Saver | 5 extrações (1 conta), 5 exportações auditadas |
| Sessões | 43 criadas; conectadas agora: 18 WhatsApp, 5 Telegram |
| Auditoria (`audit_logs`) | 282 linhas, 20 ações distintas em uso |
| Extensão (`extension_lifecycle_events`) | 193 eventos (`STARTUP` 95, `INSTALL` 38, `LINKED` 18) |
| Logins (`login_events`) | `LOGIN_OK` 68 e `LOGIN_CODE_VERIFIED` 3 desde 2026-11-07; a tabela é podada em 30 dias |

Duas consequências: (1) o banco é pequeno, então consultar as tabelas de domínio sob demanda custa pouco hoje;
(2) o volume automático (24 mil ofertas de monitoramento) esconde o uso manual (89 do gerador) se a tela ordenar
por contagem. A medida principal precisa ser **contas que usaram**, não volume.

## Objetivo

Uma tela do super admin (`/admin/usage`, seção Plataforma) mostra, para um período e um recorte escolhidos,
o ranking dos recursos por contas que usaram e por volume, a tendência contra o período anterior, a quebra por
plano, os recursos que ninguém usou e, por recurso, as contas que mais usam. A P1 sai só com dado que já existe.

## Alternativas avaliadas

| Tema | Alternativa | Veredito | Por quê |
| --- | --- | --- | --- |
| Fonte | (a) Consultar tabelas de domínio sob demanda | **Adotada na P1** | Zero instrumentação e zero tabela. Histórico desde 2026-10-26 para o que não é apagado (ofertas, envios, IA, auditoria); itens da vitrine, links e cliques que o usuário apagou somem da conta, e logins só existem por 30 dias. Maior tabela lida: `offer_dispatches` com 216 mil linhas. Os índices atuais começam por `tenantId`, então a P1 cria dois índices por período (`offers(createdAt)`, `offer_dispatches(status, updatedAt)`); as demais tabelas são pequenas e lidas por varredura. Orçamento de 2 s para a leitura inteira e teto de 90 dias. Não mede o que não deixa linha (Story, Tutoriais, chat humano) |
| | (b) Tabela de eventos `feature_usage_events`, uma linha por uso, gravada pelos use cases | Descartada | Duplicaria o que as tabelas de domínio já guardam (216 mil envios virariam 216 mil eventos), toca dezenas de use cases, e não dá histórico retroativo. Uma linha por uso com `userId` também é dado pessoal a mais para reter |
| | (c) Agregado diário `feature_usage_daily` (dia × conta × recurso × tipo) preenchido por job no `worker` a partir das tabelas de domínio | **Adotada na P2** | Leitura constante e barata quando a base crescer, histórico que sobrevive às retenções das fontes (cliques somem em 90 dias), período até 400 dias. Backfill do que as fontes ainda guardam; daí em diante o agregado não perde o que for apagado. Só contagens: nenhum dado pessoal |
| | (b') Contador direto no agregado para o que não tem tabela (Story, chat enviado por pessoa) | **Adotada na P2** | Um `upsert` de incremento por uso, em 2 ou 3 use cases. Cobre a lacuna de (a) sem criar tabela de eventos |
| | (d) Front envia visita de tela | **Adotada na P3**, própria e por conta | Único jeito de saber "o que foi aberto" e de medir Tutoriais (progresso só no navegador). Entra por último porque não tem histórico e mede interesse, não valor. Sem id de usuário, sem URL crua: só a chave do item do menu |
| | (e) Analytics externo (PostHog, GA etc.) | Descartada | Envia dado de navegação de cliente a terceiro (LGPD: novo operador, consentimento), exige script externo (o `DomGuardian` remove injeção sem `data-app`), custo mensal, e não enxerga o uso de valor que está no banco. Contraria "sem APM" de `ops-metricas.md` |
| | `AuditLog` como fonte única | Parcial | Só 282 linhas e 20 ações: cobre sessão, credencial, extensão e exportação do Saver (com `userId`), mas não ofertas, envios, links nem IA. Entra como **uma das fontes** de (a) |
| | `ops_metrics_samples` / snapshots de custo | Descartada | Medem máquina e dinheiro, não uso de recurso; retenção de 7 dias |
| | Contadores diários de limite por plano | Não existem | `offer_generations_per_day`, `offer_hunter_finds_per_day` e IA são `count` nas mesmas tabelas de domínio (conferido); não há tabela de contador para reaproveitar |
| Onde fica a tela | Aba em `/admin/workers` ou em `/admin/costs` | Descartada | Assunto de produto, não de infraestrutura; as duas páginas já têm 4 abas |
| | **Página própria `/admin/usage`, abas por sub-rota** | Adotada | Mesmo padrão de `/admin/costs` (`COST_TABS`, `lazy`, `SuperAdminRoute`) |
| Medida que ordena | Volume de eventos | Descartada como padrão | O automático esmaga o manual (24.046 × 89) |
| | **Contas que usaram (distintas)** | Adotada como padrão | Responde "o que os usuários usam"; volume fica como segunda ordenação |
| Conta interna | Flag nova no `Tenant` ou lista em `platform_settings` | Adiada | Exige migration ou cadastro; ver pergunta 1 |
| | **Conta com membro `isSuperAdmin` = interna** | Adotada (padrão) | Deriva do que existe (4 de 19 hoje), sem schema novo. Risco: conta real em que o suporte entrou como membro some do recorte padrão |
| Fuso do dia | UTC | Descartada | O dia do afiliado fecha às 21 h UTC; "hoje" ficaria errado |
| | **`America/Sao_Paulo` fixo** (`POSTING_TIME_ZONE`) | Adotada | Já é o fuso do horário de postagem; sem horário de verão desde 2019 |

**Recomendação:** (a) na P1, (c) + (b') na P2, (d) na P3. O leitor da P1 e o da P2 devolvem a mesma forma
(dia × conta × recurso × tipo × contagem), então a conta e a tela não mudam quando a fonte troca.

## Recursos medidos

`tipo`: **ação** = alguém fez na tela; **automático** = o sistema trabalhou pela conta; **audiência** = terceiro
(quem clicou); **acesso** = entrou no painel. O tipo é do **evento**, não do recurso: um recurso pode ter mais de um
(o Caçador tem execução manual e agendada). `cobertura`: **total** ou **parcial** (a tela avisa o motivo). Na P1 todo recurso lido de tabela em que o usuário
apaga linha mede **o que ainda existe**; histórico firme só com o agregado da P2.

| Chave | Recurso (roadmap) | Produto | Tipo | Evento que conta como uso | Fonte | Fase | Cobertura |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `offer_generator` | Gerador de ofertas (8) | Afiliados | ação | oferta criada com `origin = GENERATOR` | `offers.createdAt` | P1 | total |
| `group_monitoring` | Monitoramento (4) | Afiliados | automático | oferta **criada** pelo monitoramento, `origin = MONITORING` (o envio é `offer_dispatch`) | `offers.createdAt` | P1 | total |
| `offer_hunter` | Caçador de Ofertas (17) | Afiliados | ação (`trigger = MANUAL`) e automático (`trigger = SCHEDULED`) | execução do Caçador iniciada, fora as puladas (`status <> SKIPPED`: pausa ou portão recusado) | `offer_hunt_runs.startedAt` | P1 | total |
| `offer_dispatch` | Envio aos grupos de disparo (5) | Afiliados | automático (tipo fixo: a fonte não separa o disparo manual) | envio concluído, `status = SENT`, de **qualquer origem** (gerador, monitoramento e Caçador; sem join com a oferta) | `offer_dispatches.updatedAt` | P1 | parcial: inclui também os envios disparados à mão (suposição S1 para a data) |
| `ai_rewrite` | Geração de texto com IA (7) | Afiliados | automático (tipo fixo: `ai_usage_logs` não guarda a origem) | chamada de IA com sucesso, `purpose = offer.text` (geração, regeneração e monitoramento; inclui texto que acabou descartado) | `ai_usage_logs.createdAt` | P1 | parcial: inclui também as gerações pedidas à mão |
| `link_rotation` | Gestor de Links (9) | Afiliados | ação | link criado | `link_rotations.createdAt` | P1 | parcial: só links que ainda existem |
| `link_rotation_click` | Cliques no Gestor de Links (9) | Afiliados | audiência | clique registrado | `link_clicks.createdAt` | P1 | parcial: últimos 90 dias e só de links que ainda existem |
| `storefront` | Página de Ofertas (12) | Afiliados | ação | oferta adicionada à vitrine (rascunho ou publicada) | `storefront_offers.createdAt` | P1 | parcial: só ofertas que ainda existem |
| `offer_story` | Story de Oferta (11) | Afiliados | ação | até a véspera da data de corte: título de story gerado por IA (`purpose = offer_story_headline`); a partir do corte (P2): arte gerada | `ai_usage_logs` até o corte; contador a partir dele (uma fonte por faixa de data) | P1 → P2 | parcial antes do corte (só conta quando a IA escreve o título) |
| `affiliate_credentials` | Credenciais de afiliado (3) | Afiliados | ação | credencial ou etiqueta salva | `audit_logs` `AFFILIATE_CREDENTIAL_UPSERTED` | P1 | parcial: mistura credencial e etiqueta do ML |
| `extension_sync` | Extensão do navegador (3) | Afiliados | ação | troca de token pela extensão (a sincronização só é gravada quando o token mudou) | `audit_logs` `AFFILIATE_SESSION_SYNCED` | P1 | parcial: subestima o uso da extensão |
| `whatsapp_session` | Conexão WhatsApp (1) | sessão (do tenant) | ação | sessão criada com `engine <> telegram` | `sessions.createdAt` | P1 | total |
| `telegram_session` | Conexão Telegram (2) | sessão (do tenant) | ação | sessão criada com `engine = telegram` | `sessions.createdAt` | P1 | total |
| `saver_extraction` | Saver, extração (18) | Saver | ação | extração pedida | `saver_extractions.createdAt` | P1 | total |
| `saver_export` | Saver, exportação (18) | Saver | ação | exportação CSV/vCard concluída (`meta.completed = true`) | `audit_logs` `SAVER_EXPORTED` | P1 | total |
| `panel_login` | Entrada no painel | acesso | acesso | login concluído: `type IN (LOGIN_OK, LOGIN_CODE_VERIFIED)` (um login grava só um dos dois), conta resolvida por `user_tenants` | `login_events.createdAt` | P1 | parcial: últimos 30 dias |
| `chat_send` | Chat, mensagem enviada por pessoa | Chat | ação | mensagem enviada pela rota do painel (`origin = PANEL`; o envio automático de oferta usa o mesmo use case e não conta) | contador no use case de envio | P2 | — |
| `tutorials` | Tutoriais | Afiliados | acesso | tela aberta | visita de tela | P3 | — |
| `view:<chave do menu>` | Qualquer tela do menu | conforme o item | acesso | tela aberta | visita de tela | P3 | — |

Fora do inventário: grupos monitorados e grupos de disparo **configurados** (estado, não evento; aparecem como
denominador de adoção na P3), links de redirecionamento e telas do super admin (ferramenta da plataforma, não do cliente),
recursos "em breve" (10, 13–16). A oferta do Caçador (`origin = HUNTER`) não é contada como **criação** em nenhum
recurso: a execução entra em `offer_hunter` e o envio dela entra em `offer_dispatch`, como todo envio concluído.
Como não existe soma entre recursos, isso não conta nada duas vezes.

## Medidas

| Medida | Definição | Fase |
| --- | --- | --- |
| Usos | Soma dos eventos **de um recurso** no período, depois dos filtros. Não existe soma entre recursos: eles medem etapas diferentes da mesma oferta (criação em `offers`, envio em `offer_dispatches`) e somar contaria a mesma oferta duas vezes | P1 |
| Contas que usaram | Contas distintas com ≥ 1 uso do recurso no período | P1 |
| Alcance | Contas que usaram ÷ contas do recorte na família de planos do recurso (mesmos filtros de plano, status e interna). Não considera se a conta tem direito ao recurso | P1 |
| Tendência | Variação de usos e de contas que usaram do recurso contra o período anterior de mesma duração. `null` ("sem base") quando o período anterior começa antes do primeiro dado do recurso ou antes da retenção da fonte (logins: 30 dias; cliques: 90) | P1 |
| Nunca usado | Recurso do recorte (produto, plano e **tipo de uso** escolhidos) com 0 contas no período. Recurso cujos tipos não cruzam o filtro de tipo não aparece, nem como nunca usado | P1 |
| Contas ativas | Contas distintas com ≥ 1 uso de qualquer recurso do recorte (distinto entre recursos, não soma) | P1 |
| Recursos usados | Recursos do recorte com ≥ 1 uso, sobre o total de recursos do recorte (o "x de N" conta só recursos cujos tipos cruzam o filtro de tipo) | P1 |
| Último uso | Dia mais recente com uso do recurso no período | P1 |
| Adoção | Contas que usaram ÷ contas **com direito** ao recurso (produto ativo por `resolveProductAccess` + entitlement do recurso, ex. `storefront_enabled`, `offer_story_enabled`, `offer_hunter_enabled`). Direito lido **hoje**, não na data do uso | P3 |
| Recorrência | Contas que usaram o recurso em ≥ N dias distintos do período (N padrão 3; opções 2, 3, 5) ÷ contas que usaram | P3 |
| Retenção | Das contas que usaram no período anterior, quantas usaram de novo no atual | P3 |
| Visitas | Contas que abriram a tela no dia, por chave do menu (uma marca por dia × conta × tela; não é número de aberturas) | P3 |

## Filtros

| Filtro | Valores | Padrão | Observação |
| --- | --- | --- | --- |
| Período | hoje, 7, 30, 90 dias, personalizado | 30 dias | Dias em `America/Sao_Paulo`, calculados com o relógio do servidor (`serverNow()`); teto de 90 dias na P1 e 400 na P2. O filtro guarda o **preset** (`today`, `7d`, `30d`, `90d`, `custom`) e datas só no personalizado; personalizado acima do teto é barrado no painel antes de enviar. Os padrões desta tabela valem também na API (schema da rota), e o painel envia sempre explícito |
| Granularidade | dia, semana, mês | dia (≤ 31 dias), semana (acima) | Semana começa na segunda. "Dia" só até 90 dias: acima disso o mínimo é semana (a API recusa e o painel desabilita a opção) |
| Produto | todos, Afiliados, Chat, Saver, sessão, acesso | todos | Atributo do recurso no catálogo |
| Tipo de uso | todos, ação, automático, audiência, acesso | ação + automático | Filtra **eventos**: recurso com mais de um tipo (Caçador) aparece com a parte escolhida; recurso sem nenhum tipo escolhido some da tela (no padrão, `panel_login` e `link_rotation_click` não aparecem). `ai_rewrite` e `offer_dispatch` são sempre automático, mesmo quando disparados à mão: "só ação" não os mostra |
| Plano | todos, `COPYSYNC_LITE`, `COPYSYNC_PRO`, `COPYSYNC_MAX`, `SAVER_LITE`, `SAVER_PRO`, `SAVER_MAX`, `NONE` (sem plano) | todos | Duas famílias. **Afiliados** (recursos de Afiliados, Chat, sessão e acesso): plano = `Tenant.planSlug` só se a conta tem Afiliados ativo hoje (`resolveProductAccess`); senão `NONE` (o `planSlug` sobrevive ao cancelamento). **Saver**: `tenant_products(SAVER).planSlug` com o produto ativo; senão `NONE`. Escolher um plano restringe às contas com ele **e** aos recursos da família dele (com `SAVER_PRO` os recursos de Afiliados não aparecem). `NONE` mostra as duas famílias, cada uma com as contas sem plano nela |
| Recurso | um ou todos | todos | Abre o detalhe |
| Conta | uma conta (`tenantId`, escolhida na lista do detalhe; aparece na barra como chip removível) | todas | Sem campo de busca por nome na P1. O filtro guarda só o id; o chip mostra o nome quando ele está na lista carregada do detalhe e, senão, o id curto |
| Contas internas | incluir / excluir | excluir | Interna = tem membro `isSuperAdmin` |
| Status da conta | todas, ativa, suspensa, cancelada | ativa | `Tenant.status` de hoje |
| Ordenar por | contas que usaram, usos, tendência | contas que usaram | |

## Requisitos

| ID | Requisito | Fase |
| --- | --- | --- |
| USAGE-01 | Só super admin acessa rotas e tela (`authHook` + `superAdminHook`; `SuperAdminRoute`); os demais recebem 401 `UNAUTHORIZED` (resposta atual do `superAdminHook`) e não veem o item no menu | P1 |
| USAGE-02 | Catálogo de recursos é dado de domínio (função pura), com chave, produto, tipos de evento, fonte (e data de corte quando a fonte muda), motivos de cobertura parcial e retenção; a API devolve chaves e códigos, o rótulo vive em `strings.ts` do painel | P1 |
| USAGE-03 | Resumo devolve, por recurso: usos, contas que usaram, alcance, tendência, último uso, quebra por tipo e por plano, `retentionDays` e motivos de cobertura; no total, só `activeTenants`, `activeTenantsPrevious`, `featuresUsed`, `featuresNeverUsed` e `topFeature` (sem soma de usos entre recursos) | P1 |
| USAGE-04 | Série temporal de contas ativas (geral) e de usos e contas de um recurso, na granularidade pedida, com buckets vazios preenchidos com zero | P1 |
| USAGE-05 | Todos os filtros da tabela "Filtros" funcionam e combinam entre si; validação por schema, valor inválido = 400; pedido sem query usa os padrões da tabela (definidos no schema da rota). Quebra por plano usa a família de planos do produto do recurso; em cada família cada conta do recorte conta uma vez (no plano dela ou em `NONE`); as famílias não se somam. Filtro de plano restringe contas e recursos à família do plano | P1 |
| USAGE-06 | Dia e período calculados em `America/Sao_Paulo` no próprio SQL (colunas são `timestamp` sem fuso em UTC). A resposta informa fuso, período anterior e, por recurso, `firstDataDay` (primeiro dado real, mesmo filtro da consulta do recurso; `null` sem dado) e `dataFrom` (limite efetivo = o maior entre o primeiro dado e hoje menos a retenção) | P1 |
| USAGE-07 | Período: o schema valida formato, o teto absoluto de 400 dias e a granularidade (`day` só até 90 dias); o use case aplica o teto da fonte (90 dias sem agregado, 400 com) e devolve 400 `USAGE_METRICS_RANGE_INVALID`. O pedido inteiro (fontes, primeiro dado e diretório de contas, **inclusive a espera por conexão**) tem orçamento de 2 s, e cada consulta recebe o que resta; as consultas rodam em sequência e só uma leitura de uso roda por processo. Orçamento esgotado, `statement_timeout`, outra leitura em andamento ou linhas acima da guarda (100 mil sob demanda, 300 mil no agregado) = 503 `USAGE_METRICS_READ_UNAVAILABLE` (nunca 500, nunca espera aberta) | P1 |
| USAGE-08 | Detalhe do recurso lista as contas que mais usam, paginado por cursor keyset assinado (nunca offset; tamanho da página decidido pelo servidor); cursor inválido = 400 `USAGE_METRICS_CURSOR_INVALID` | P1 |
| USAGE-09 | Nome da conta só vem da lista de contas do detalhe e só aparece ali e no chip do filtro de conta (quando o nome já está nessa lista carregada; senão o chip mostra o id curto), sempre sob a flag `usage.tenantName` (`Blurred`/`useBlur`); resumo, série e CSV não levam nome; o nome nunca é persistido no navegador | P1 |
| USAGE-10 | Abrir a lista de contas de um recurso fica em `audit_logs` (`USAGE_METRICS_VIEWED`, com filtros e contagem, sem dado pessoal). O CSV do resumo não tem nome de conta nem rota, então não audita | P1 |
| USAGE-11 | Métrica nunca lê conteúdo: nenhuma consulta seleciona texto de mensagem, nome ou telefone de contato, link, título de oferta, e-mail ou IP. Só `count`, data, `tenantId` e colunas de classificação (`origin`, `status`, `engine`, `purpose`, `action`, `type`, `trigger`); `userId` de `login_events` serve só para achar a conta em `user_tenants` e não sai da consulta. Exceção única: o booleano `meta.completed` de `SAVER_EXPORTED`; nenhum outro campo de `meta` é lido | P1 |
| USAGE-12 | Tela com faixa de KPIs (contas ativas, recursos usados, mais usado), ranking em barras, série temporal, tabela recurso × plano, lista de nunca usados, detalhe do recurso; estados carregando, vazio, erro com tentar de novo (inclusive o 503 de leitura lenta) e "serviço atualizando" | P1 |
| USAGE-13 | Filtros (inclusive a conta escolhida) persistem com `usePersistedState` (escopo `tab`, versão, `deserialize` que valida); o período persiste como preset (datas só no personalizado; personalizado no futuro ou acima do teto é descartado ao reler); recurso aberto no detalhe fica na URL | P1 |
| USAGE-14 | Tela funciona em claro, escuro e sistema, em 390 px sem rolagem horizontal da página; gráfico com tabela alternativa; ícones Lucide via `AppIcon`; `Tooltip` em todo ícone e em cada medida | P1 |
| USAGE-15 | Exportar CSV do resumo (recurso × medidas, sem nome de conta), gerado no painel com neutralização de fórmula | P1 |
| USAGE-16 | Recurso com cobertura parcial ou com fonte mais nova que o período leva aviso visível (um texto por motivo em `coverageReasons`; "dados desde DD/MM" usa `firstDataDay`, e o corte por retenção aparece só pelo motivo `RETENTION`). A resposta traz só os motivos que valem para o período pedido | P1 |
| USAGE-17 | Tabela `feature_usage_daily` (dia × conta × recurso × tipo), migration aditiva, só contagens | P2 |
| USAGE-18 | Job `FeatureUsageRollupJob` só no `worker`, flag `FEATURE_USAGE_ROLLUP_ENABLED` (padrão `false`, ligada só na Render), sob lease, idempotente (recalcula hoje e ontem), com backfill em passos e retenção de 400 dias; nunca grava recurso contado por contador nem dia a partir da data de corte desse recurso | P2 |
| USAGE-19 | Contador direto para recurso sem tabela (`offer_story` a partir da data de corte, `chat_send` só com origem painel): uma fonte por faixa de data, declarada no catálogo; todo recurso de contador tem data de corte (`recordedFrom`) e o primeiro dado dele é o menor dia gravado no agregado; falha do contador nunca falha o use case | P2 |
| USAGE-20 | Leitura passa a usar o agregado quando o backfill terminou (marco gravado em `platform_settings`, nunca em memória) e ele cobre o período; fora disso cai no leitor sob demanda (≤ 90 dias); a resposta diz qual fonte respondeu e a hora da última atualização. Acima de 90 dias o agregado é lido já agrupado por semana ou mês. `dataFrom` e cobertura são por recurso: com agregado, o corte de retenção deixa de valer a partir do primeiro dia agregado; recurso de contador começa na data de corte | P2 |
| USAGE-21 | Adoção por direito ao recurso, recorrência e retenção | P3 |
| USAGE-22 | Visita de tela: painel envia a chave do item do menu (lista fechada), no máximo 1 por chave × aba × dia; no servidor a gravação é idempotente por dia × conta × tela (repetir não soma) e a rota tem limite de taxa por conta; sem `userId`, sem URL, sem IP | P3 |
| USAGE-23 | Aba "Telas" com o ranking de telas por contas que abriram, separada do ranking de uso e lida por consulta própria agregada no banco | P3 |
| USAGE-24 | Documentação `docs/uso-dos-recursos.md`, linha no `AGENTS.md`, linha em "Ferramentas operacionais da plataforma" do roadmap, linha em "Telas cobertas" de `docs/padrao-ui-painel.md`, versão e CHANGELOG por fase | P1–P3 |
| USAGE-25 | Migration aditiva com os índices `offers(createdAt)` e `offer_dispatches(status, updatedAt)` (`IF NOT EXISTS`), para o filtro de período sem `tenantId`; tempo de criação medido antes do deploy e, se passar de 2 s, índice criado antes com `CREATE INDEX CONCURRENTLY` | P1 |
| USAGE-26 | Contrato amarrado entre API e painel: fixtures JSON versionadas em `contracts/feature-usage/` (resposta do resumo, do detalhe e lista de chaves e códigos do catálogo), validadas pelo teste da API e consumidas pelo teste do painel, sem import entre `api/` e `app/` | P1 |

## Fora do escopo

- Funil, sessão de navegação, mapa de calor, gravação de tela, tempo na tela.
- Métrica por usuário individual (quem clicou no quê) e contagem de usuários distintos por recurso (futuro: só `audit_logs` e `login_events` têm `userId`, e nada produz esse número hoje). A menor unidade é a conta.
- Receita, churn e cobrança (isso é da central).
- Alertas e e-mail de relatório.
- Qualquer chamada à Render, APM ou endpoint `/metrics` público.
- Plano histórico da conta (o recorte por plano usa o plano de hoje).
- Tela para o tenant ver o próprio uso.

## Critérios de aceite (smoke, depois da última tarefa de cada fase)

- **P1:** com o filtro padrão a tela abre em menos de 2 s; o ranking mostra `group_monitoring` e `offer_dispatch`
  com 11 contas (menos as internas) e `offer_generator` com até 5; trocar para "só ação" tira os automáticos;
  "hoje" bate com `count` manual no banco para um recurso; período de 91 dias devolve 400; usuário comum recebe 401.
- **P2:** job ligado em Postgres descartável preenche o histórico e a tela devolve os mesmos números com
  `source = daily`; com a data de corte já passada, gerar um Story soma 1 em `offer_story` e o rollup seguinte não apaga essa soma.
- **P3:** adoção de `storefront` usa só contas com `storefront_enabled`; abrir `/offers` várias vezes no mesmo dia, em abas diferentes, marca a conta 1 vez naquele dia.

## Suposições (conferir na execução)

- **S1:** `offer_dispatches.updatedAt` de uma linha `SENT` é a hora do envio (a linha não é tocada depois). Sem `createdAt` na tabela.
- **S2 (confirmada no código):** `AFFILIATE_SESSION_SYNCED` grava `tenantId` e `userId`, mas só quando o token mudou (`UpsertAffiliateSessionUseCase`); por isso a medida é "troca de token" e a cobertura é parcial.
- **S3:** `offers`, `offer_dispatches`, `offer_hunt_runs` e `ai_usage_logs` não têm job de retenção (não encontrei). Têm perda conhecida: `login_events` (podada em 30 dias pelo `LoginGuard`), `link_clicks` (90 dias) e as linhas que o usuário apaga de verdade em `storefront_offers`, `link_rotations` e `link_clicks` (cascade).
- **S4:** todo Story gera uma linha `offer_story_headline` só quando a IA escreve o título; por isso "parcial".
- **S5:** `OUTBOUND` do chat não distingue pessoa de envio automático (188.099 `OUTBOUND` × 185.274 envios `SENT`); por isso o chat só entra com contador na P2.
- **S6:** o nome da ação nova de auditoria segue a convenção atual; conferir no topo da branch. (O ícone `ChartColumn` foi conferido no `lucide-react` instalado.)

## Perguntas em aberto para o dono

Cada uma tem padrão; sem resposta, o plano segue com ele.

1. **O que é "conta interna"?** Padrão: conta com algum membro super admin (4 de 19 hoje), excluída por padrão. Risco: se o suporte entrar como membro numa conta real, ela some do recorte padrão sem aviso (a tela mostra quantas internas foram excluídas). Alternativa: lista manual de contas internas em `platform_settings` ou flag no `Tenant`.
2. **Ordenar o ranking por quê?** Padrão: contas que usaram (volume como segunda opção), porque o automático tem 270 vezes mais eventos que o manual.
3. **Uso automático conta como uso?** Padrão: sim, com o filtro "Tipo de uso" separando ação de automático e o rótulo visível em cada linha.
4. **Visitas de tela entram?** Padrão: só na P3, medidas por nós, por conta e por dia, sem usuário e sem ferramenta externa.
5. **Chat entra na P1?** Padrão: não; `/chat` é só super admin e a fonte atual não separa pessoa de automação. Entra na P2 com contador.
6. **Nome da conta no detalhe?** Padrão: sim, borrado pela flag `usage.tenantName` e com a abertura auditada. Alternativa: mostrar só o id.
