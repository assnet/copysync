# Saver — Especificação

**Status**: Draft, decisões do dono incorporadas até 2026-11-11 (aguarda aprovação do dono; pré-requisito `product-access` **aprovado** em 2026-11-11) · api e app: próxima minor após `product-access` (hoje api 0.99.0, app 0.122.1; conferir no início da execução)
**Roadmap**: `docs/produto-roadmap.md:49` (`Saver | em breve | a definir`) — a T1 preenche o item antes de qualquer código.
**Depende de**: `.specs/features/product-access/` (produto `SAVER`, gate, cobrança por produto, menu por produto).
**Inspiração**: aba "iSaver" de `/Users/adrielss/www/waiochat_extension/src/content/components/tabs/saver.tsx`.

## Problema

Quem administra ou participa de grupos de WhatsApp quer a lista de membros (número e nome) para levar à agenda ou
a uma planilha. O iSaver legado fazia isso dentro do WhatsApp Web, pela extensão. No CopySync a sessão já está
conectada no servidor, então o Saver pode entregar a mesma lista sem extensão, com fila, limites e registro. Ele
precisa ser um produto à parte: plano, permissões e configurações próprios, e nenhum acesso a Afiliados ou Chat
para quem comprou só o Saver.

## O que foi verificado

| Fato | Evidência |
| --- | --- |
| Legado exporta só **Telefone** e **Nome**, em CSV e vCard | `waiochat_extension/src/content/components/tabs/saver.tsx:156,267,275` |
| Legado: escopo principal = participantes de grupos escolhidos; opções prefixo, remover admins, dedup por telefone | `saver.tsx:172-182,239-257,379-401` |
| Legado descarta membro sem número em silêncio, sem progresso e sem ritmo anti-bloqueio | `saver.tsx:162-170,241` |
| Legado: CSV sem escape nem BOM; vCard grava o cabeçalho como contato e `EMAIL:` vazio | `lib/download-csv.ts:2`; `saver.tsx:261` |
| Legado: acesso por permissão `SAVER` + plano próprio (mensal/anual), sem cota no backend | `saver.tsx:128-148`; `utils/checkout.ts:12-14` |
| A extensão do CopySync não roda no WhatsApp Web e o doc proíbe content script em outra origem | `docs/extensao-navegador.md:30,131` |
| `getGroupParticipants` atual busca foto de até 200 membros, sem cache, e perde o `lid` quando há telefone | `BaileysMessagingEngineAdapter.ts:889-950`; `IMessagingEngine.ts:385-398` |
| Eventos `group-participants.update` não são tratados | `BaileysMessagingEngineAdapter.ts:94-105` |
| Chamada de engine vinda do processo `http` tem teto de 10 s | `transport/RedisEngineRpc.ts:15`; `remote/engineCallPlan.ts:35-38` |
| Job singleton por `JobLease` só alcança sessões do worker onde roda; por isso o rodízio usa lease por processo e filtra as sessões do processo por `ownerWorkerId` + `leaseUntil` no SQL (api 0.85.1) | `LinkRotationMemberSyncJob.ts:14-19,44-47`; `PrismaLinkRotationMemberSyncStore.ts:24`; `docs/arquitetura-escala.md:510` |
| Não há backoff para limite de taxa em metadata de grupo | `BaileysErrorTranslator.ts` |
| Nome de membro só é persistido pelo módulo chat (`chat_contacts`); com chat desligado, nada | `BaileysMessagingEngineAdapter.ts:1582-1621,1784` |
| O código já reserva o par LID de participante para o Saver | `docs/chat-ingestao-por-entitlement.md:42,56` |
| Telegram: teto de 200 participantes, sem admin, sem tradução de erro | `TelegramMessagingEngineAdapter.ts:1021-1032` |
| Não existe rota de exportação CSV/vCard nem proteção contra injeção de fórmula | busca em `api/src` e `app/src` |
| Molde de módulo com tabela, job e limites: `link-rotation` | `api/src/modules/link-rotation/` |
| Painel sem lib de i18n: textos em `features/<x>/strings.ts` | `app/src/features/plans/strings.ts:2` |

## Termos

- **Grupo salvo**: grupo que o tenant escolheu acompanhar no Saver.
- **Extração**: pedido de leitura dos membros de um ou mais grupos; executada no worker, um grupo por vez.
- **Contato**: pessoa única **na plataforma** (telefone e/ou LID), não importa em quantos grupos ou tenants apareça. Fica na **base de contatos da plataforma**: dado da CopySync, não do tenant. Só o super admin consulta.
- **Vínculo**: ligação contato × grupo salvo de um tenant (quem extraiu, nome como apareceu naquele grupo, administrador, data e hora da primeira e da última extração, saída). É por ele que o tenant exporta o que ele mesmo extraiu.
- **Membro só com LID**: participante com número oculto; o WhatsApp entrega só o identificador `@lid`.
- **Sessão**: conexão WhatsApp do tenant (nunca "instância").

## Alternativas avaliadas

| Alternativa | Veredito | Por quê |
| --- | --- | --- |
| A. Portar o iSaver para a extensão do CopySync (content script no WhatsApp Web) | ❌ | Doc proíbe; nova permissão de host e revisão na Web Store; depende do store interno do WhatsApp Web |
| B. Chamar `getGroupParticipants` existente | ❌ | Busca fotos (parte cara e sujeita a limite), sem `lid` separado |
| **C. Método novo na porta, sem foto (`getGroupMembers`)** | ✅ | 1 chamada de metadata por grupo; não altera o caminho usado por menção e chat |
| D. Parâmetro novo em `getGroupParticipants` | ❌ | Muda contrato usado por Afiliados e Chat e a serialização remota; risco de regressão |
| E. Extração síncrona na requisição HTTP | ❌ | Estoura o teto de 10 s do RPC; sem ritmo entre grupos |
| **F. Fila em tabela + job no worker iterando sessões locais** | ✅ | Sobrevive a reinício e adoção; ritmo por sessão; funciona em `all` e em multi-worker |
| G. Job singleton de cluster (padrão do rodízio) | ❌ | Pula sessões de outros workers |
| H. BullMQ para a fila | ❌ | Em produção (`all`, sem Redis) não existe; tabela já resolve o volume |
| I. Delta por evento `group-participants.update` | ❌ v1 | Evento não é tratado hoje; mexer no adapter para isso é outra entrega |
| J. Nome via tabela do chat (`chat_contacts`) | ❌ | Acopla o Saver ao Chat; quebra a independência pedida |
| K. Gerar o arquivo no navegador | ❌ | Lista paginada no servidor; exportar exige o conjunto todo, auditoria e limite de plano |

**Decisão**: C + F, exportação gerada na API.

## Objetivos

- [ ] Tenant com produto `SAVER` extrai os membros de um grupo de 1.000 pessoas e baixa CSV e vCard válidos.
- [ ] Nenhum arquivo de `api/src/modules/saver` importa de `chat`, `campaigns`, `automation`, `link-rotation` ou `storefront` (teste automático).
- [ ] Tenant só-Saver usa o Saver de ponta a ponta sem receber nenhum 200 de rota de Afiliados/Chat.
- [ ] No máximo 1 leitura de grupo a cada 3–5 s por sessão; nenhuma busca de foto.
- [ ] Suítes existentes de `api/` e `app/` passam sem edição de teste alheio ao Saver, com duas exceções declaradas: os testes de contrato do engine que contam/indexam métodos (`engineCallPlan.test.ts:43`, `ARGS` em `RemoteMessagingEngineAdapter.test.ts:21`) ganham o método novo.

## Fora de escopo (v1)

| Item | Motivo |
| --- | --- |
| Foto de perfil | Decisão do dono (2026-11-09): parte cara e arriscada |
| Telegram | Teto de 200 membros e sem tradução de erro; responde `ENGINE_OPERATION_UNSUPPORTED` |
| Etiquetas do WhatsApp Business, contatos da agenda, "arquivados" | Dependem de sync de app-state/contatos que o servidor não mantém |
| Escopos "Filtros", "Etiquetas" e "Envios em massa" do legado | Eram dados locais da extensão |
| Adicionar contato na agenda / Google Contacts / XLSX | Não existia no legado; vCard e CSV cobrem |
| Envio de mensagem aos membros extraídos | Saver só guarda e exporta; disparo é outro produto |
| Matriz completa de permissões por usuário | v1 = matriz por papel + liberação individual só de **exportar** (D2, SAVER-43) |
| Tela de contatos para o tenant | Decisão do dono: a base é da plataforma; tenant só vê contagens e exporta o arquivo |
| Expurgo automático (retenção, perda do produto) | D5 em aberto: v1 não apaga nada sozinho; só remoção manual |
| Atualização por evento de entrada/saída | Alternativa I |

---

## Histórias

### P1: Acesso, plano e permissões próprios ⭐ MVP

**História**: como dono, quero vender o Saver separado, com limites e permissões só dele.

1. **SAVER-01** WHEN o tenant não tem o produto `SAVER` ativo THEN toda rota `/saver/*` SHALL responder 403 `PRODUCT_UNAVAILABLE`, em qualquer modo do gate. Plano de Afiliados (`COPYSYNC_*`, `copysync-{lite|pro|max}-*` e as ofertas de teste de `planPresets.ts:8`) e suas permissões **nunca** dão `SAVER`; só plano/permissão Saver (`copysync-saver-*`, `SAVER_{TIER}`) ou concessão do super admin.
2. **SAVER-02** WHEN um plano Saver é sincronizado THEN o sistema SHALL gravar as chaves `saver_groups`, `saver_group_scans_per_day`, `saver_contacts` e `saver_auto_refresh_enabled`; o preset SHALL declarar as compartilhadas `whatsapp_sessions` e `telegram_sessions: 0`, aplicadas só pela regra de união de `product-access` (sem `telegram_sessions`, tenant só-Saver ficaria com Telegram ilimitado).
3. **SAVER-03** WHEN uma ação passa de um limite THEN SHALL responder 403 `PLAN_LIMIT_REACHED` com `key` e `limit`; chave `saver_*` ausente SHALL valer **zero/desligado** (nunca ilimitado).
4. **SAVER-04** WHEN o usuário age no Saver THEN SHALL valer a matriz por papel: `ADMIN` = ver, extrair, exportar, configurar; `OPERATOR` = ver e extrair, e exportar **só se** um `ADMIN` liberou para ele (SAVER-43). Sem permissão: 403 `FORBIDDEN`.
5. **SAVER-05** WHEN o painel pede o resumo do Saver THEN SHALL receber limites, uso atual, permissões do usuário e configuração numa chamada.

5a. **SAVER-43** WHEN um `ADMIN` liga ou desliga "pode exportar" para um `OPERATOR` do próprio tenant THEN SHALL persistir a liberação por (tenant, usuário), valer na requisição seguinte e registrar `AuditLog` `SAVER_PERMISSION_CHANGED`; alvo de outro tenant ou que não é `OPERATOR` SHALL ser recusado; a liberação SHALL sumir quando o usuário sai do tenant. `OPERATOR` nunca libera ninguém.

5b. **SAVER-47** WHEN a audiência do Saver é "Só super admin" (valor inicial; flag em `/admin/plan-entitlements`, `platform_settings.feature_audience`, lida a cada pedido, mesmo mecanismo do caçador) THEN só o super admin SHALL ver o Saver no menu (nem cadeado nem "Em breve" para os demais) e usar `/saver/*`; os demais com o produto SHALL receber 403 `SAVER_UNAVAILABLE`, mesmo com plano Saver (sem produto vale antes `PRODUCT_UNAVAILABLE`, SAVER-01). WHEN a audiência é aberta THEN vale só SAVER-01. O super admin passa o gate de produto (piloto no próprio tenant sem plano).

**Teste independente**: tenant com `SAVER` concedido pelo super admin e outro sem; tenant com plano Saver e audiência "Só super admin" → 403; `inject` nas rotas.

### P1: Escolher grupos ⭐ MVP

**História**: como usuário, quero ver os grupos da minha sessão e escolher de quais salvar os membros.

6. **SAVER-06** WHEN o usuário escolhe uma sessão WhatsApp conectada THEN SHALL listar os grupos dela com nome e marca de "já salvo" e data da última leitura.
7. **SAVER-07** WHEN a sessão está desconectada THEN SHALL responder `SESSION_NOT_CONNECTED` e a tela SHALL oferecer o caminho para reconectar.
8. **SAVER-08** WHEN a sessão é Telegram THEN SHALL responder `ENGINE_OPERATION_UNSUPPORTED` e a tela SHALL dizer que o Saver funciona só com WhatsApp.
9. **SAVER-09** WHEN o usuário pede a extração de N grupos THEN SHALL criar a extração com um item por grupo, validando `saver_groups` (grupos salvos) e `saver_group_scans_per_day` (leituras nas últimas 24 h) **antes** de criar qualquer linha.
10. **SAVER-10** WHEN já existe item pendente para o mesmo grupo THEN SHALL não duplicar.

### P1: Extração no worker ⭐ MVP

**História**: como usuário, quero que a leitura aconteça em segundo plano, sem arriscar meu número.

11. **SAVER-11** WHEN o job lê um grupo THEN SHALL usar `getGroupMembers` (1 metadata, sem foto) e obter por membro: telefone (ou nulo), LID (ou nulo), nome (ou nulo) e se é administrador.
12. **SAVER-12** WHEN há itens na fila THEN o job SHALL processar no máximo 1 grupo por sessão a cada 3–5 s (intervalo sorteado), só para sessões abertas no próprio processo.
13. **SAVER-13** WHEN a leitura retorna THEN SHALL gravar em lotes de 500: contato novo insere na base da plataforma; vínculo com o grupo do tenant é criado ou atualizado com nome lido, administrador e **data e hora desta extração**; quem não veio mais recebe data de saída no vínculo; LID que ganhou telefone é fundido no mesmo contato.
13a. **SAVER-44** WHEN um membro lido já existe na base da plataforma (mesmo telefone ou mesmo LID, vindo de qualquer grupo de qualquer tenant) THEN SHALL reaproveitar o contato, nunca duplicar; WHEN a mesma leitura traz LID e telefone que estavam em contatos distintos THEN SHALL fundir os dois (fica o mais antigo, vínculos migram). Unicidade garantida no banco por telefone e por LID. **O telefone é o dado principal da base**: uma vez guardado, nunca é apagado nem trocado por leitura que venha sem ele.
14. **SAVER-14** WHEN a leitura falha THEN SHALL tentar até 3 vezes com espera crescente; WHEN o erro é de limite de taxa THEN SHALL pausar a sessão no Saver por 15 min.
15. **SAVER-15** WHEN todos os itens terminam THEN a extração SHALL fechar como `DONE`, `PARTIAL` (algum falhou) ou `FAILED` (todos falharam).
16. **SAVER-16** WHEN o processo cai com item em andamento THEN o item SHALL voltar à fila após o prazo da trava (60 s).
17. **SAVER-17** WHEN o usuário cancela THEN itens ainda não iniciados SHALL ser cancelados; o item em andamento termina.
18. **SAVER-18** WHEN `SAVER_EXTRACTION_WORKER_ENABLED` não é `true` THEN o job SHALL não iniciar (flag ligada só na Render) e a API SHALL informar "fila parada" no resumo.
19. **SAVER-19** WHEN o total de contatos distintos vinculados ao tenant atingiria `saver_contacts` THEN o item SHALL parar com `PLAN_LIMIT_REACHED` sem gravar o grupo pela metade. Contato que já existe na base por outro tenant conta para este tenant ao ganhar o primeiro vínculo dele.
20. **SAVER-20** WHEN o tenant perde o produto `SAVER` THEN itens na fila SHALL ser cancelados na próxima passada.

**Teste independente**: use case do tick com engine e repositórios falsos; integração do claim em Postgres descartável.

### P1: Acompanhar a extração (tenant não vê contatos) ⭐ MVP

21. **SAVER-21** WHEN o usuário do tenant usa o painel THEN SHALL ver por grupo salvo só **contagens** (membros, com número, só LID) e a data e hora da última extração; nenhuma rota do tenant SHALL devolver linha de contato (nome, telefone ou LID) em JSON. O único caminho do tenant até os dados é o arquivo exportado (SAVER-25..30).
22. **SAVER-22** WHEN há membros só com LID THEN a tela SHALL mostrar a contagem e a explicação de que o número é oculto pelo próprio WhatsApp; nunca omitir em silêncio.
23. **SAVER-23** WHEN o modo privacidade está ligado THEN nome de grupo e nome de operador SHALL ficar borrados por flags próprias (`saver.groupNames`, `saver.teamNames`); na tela do super admin, nome, telefone/LID e nome do tenant por `saverAdmin.contactNames`, `saverAdmin.contactPhones`, `saverAdmin.tenantNames`.
24. **SAVER-24** WHEN a extração está em andamento THEN a tela SHALL mostrar progresso (grupos feitos/total, membros encontrados) atualizado por consulta periódica, com `serverNow()` para horários.

### P1: Exportar ⭐ MVP

25. **SAVER-25** WHEN quem tem permissão de exportar exporta em CSV THEN SHALL receber `text/csv` UTF-8 com BOM, colunas `Nome,Telefone,LID,Extraído em` (data e hora da última extração daquele contato pelo tenant, `America/Sao_Paulo`, `dd/MM/aaaa HH:mm`), campos escapados (RFC 4180) e valor iniciado por `=`, `+`, `-`, `@`, tab ou CR neutralizado.
26. **SAVER-26** WHEN exporta em vCard THEN SHALL receber vCard 3.0, um cartão por contato, `TEL` com `+` e DDI, sem linha de cabeçalho e sem campo vazio.
27. **SAVER-27** WHEN exporta THEN SHALL escolher os grupos salvos (um, vários ou todos) e as opções: só com número, prefixo de nome, remover administradores, só quem ainda está no grupo e "uma linha por grupo" (desligada por padrão: uma linha por contato; ligada, acrescenta a coluna `Grupo`).
27a. **SAVER-46** WHEN o tenant exporta THEN o arquivo SHALL conter só contatos com vínculo em grupo **do próprio tenant**, com o nome como foi lido nos grupos dele; nome, grupo ou data vindos da extração de outro tenant SHALL nunca aparecer.
28. **SAVER-28** WHEN há contatos só com LID no conjunto THEN o CSV SHALL incluí-los (telefone vazio, LID preenchido) e o vCard SHALL deixá-los fora (não há número), informando quantos ficaram fora antes e depois do download.
29. **SAVER-29** WHEN contato não tem nome THEN no vCard o nome SHALL ser o prefixo (se houver) mais o próprio número; no CSV a coluna `Nome` SHALL levar só o prefixo (ou vazio).
30. **SAVER-30** WHEN uma exportação é gerada THEN SHALL registrar `AuditLog` `SAVER_EXPORTED` com formato, filtros e quantidade; nunca nomes ou números.

### P1: Configurações do Saver ⭐ MVP

31. **SAVER-31** WHEN o `ADMIN` salva configurações THEN SHALL persistir por tenant: prefixo padrão, remover administradores por padrão, formato padrão, atualização diária (se o plano permitir). Retenção fica fora até a D5.
32. **SAVER-32** WHEN o `OPERATOR` tenta salvar THEN SHALL receber 403.

### P1: Guarda e descarte de dados ⭐ MVP

33. **SAVER-33** WHEN o `ADMIN` remove um grupo salvo THEN o grupo SHALL sair da lista e do limite do tenant, deixar de ser exportável por ele e ter os itens pendentes cancelados; contatos e vínculos SHALL permanecer na base da plataforma (remoção lógica).
36. **SAVER-36** WHEN a sessão é excluída (exclusão lógica: `sessions.deletedAt` preenchido) THEN grupos, vínculos e contatos SHALL permanecer para exportação, itens pendentes dela SHALL ser cancelados e a extração SHALL fechar; o grupo salvo é único por (tenant, grupo), então reler o mesmo grupo por outra sessão SHALL atualizar o mesmo registro, nunca duplicar.

### P1: Base de contatos da plataforma (super admin) ⭐ MVP

**História**: como dono da plataforma, quero consultar todos os contatos extraídos por todos os tenants.

36a. **SAVER-45** WHEN o `SUPER_ADMIN` abre a base THEN SHALL ver contatos paginados por cursor opaco (nome, telefone, LID, primeira e última extração, nº de tenants e de grupos), com busca por nome/número/LID e filtro por tenant e período, abrir as extrações de um contato (tenant, grupo, data e hora) e exportar em CSV; toda consulta e exportação SHALL registrar `AuditLog` (sem nome nem número). WHEN quem chama não é `SUPER_ADMIN` THEN 403, com ou sem produto `SAVER`.

### P1: Painel ⭐ MVP

37. **SAVER-37** WHEN o tenant tem `SAVER` THEN o menu SHALL mostrar o produto Saver com Grupos, Configurações e Planos (sem tela de contatos).
38. **SAVER-38** WHEN qualquer tela do Saver é usada THEN SHALL funcionar em sistema/claro/escuro, com textos em `features/saver/strings.ts`, ícones por `AppIcon`, dica por `Tooltip`, e estado de trabalho (sessão escolhida, grupos marcados, filtros, opções de exportação) em `usePersistedState`, limpo ao concluir.
39. **SAVER-39** WHEN o usuário abre `/saver/plans` THEN SHALL ver a vitrine dos planos Saver (texto de marketing em catálogo próprio; preço nunca no banco).

### P2: Atualização diária

40. **SAVER-40** WHEN `saver_auto_refresh_enabled` e a configuração estão ligados THEN o job SHALL enfileirar 1 leitura por grupo salvo a cada 24 h, no mesmo ritmo e contando no limite diário.

### P2: Enriquecimento passivo

41. **SAVER-41** WHEN chega `MESSAGE_RECEIVED` de grupo salvo, com flag `SAVER_PASSIVE_ENRICHMENT_ENABLED` ligada THEN o Saver SHALL completar nome e par telefone↔LID do autor, com no máximo 1 escrita por membro a cada 24 h.

### P2: Aviso de uso responsável

42. **SAVER-42** WHEN o tenant usa o Saver pela primeira vez THEN um `ADMIN` SHALL aceitar o aviso versionado (dados de terceiros, LGPD, sem spam) antes da primeira extração; aceite só por inclusão.

### P2: Descarte automático (aguarda D5)

34. **SAVER-34** WHEN a regra de retenção da base da plataforma for definida THEN o expurgo SHALL apagar o que estiver fora dela. Sem decisão, nada é apagado sozinho.
35. **SAVER-35** WHEN o dono definir o que acontece ao tenant perder o produto THEN aplicar. Até lá: tenant sem produto não extrai nem exporta (SAVER-01) e a base da plataforma fica intacta.

### P3: ideias adiadas

Telegram com paginação; etiquetas do WhatsApp Business; matriz completa de permissão por usuário; XLSX; delta por evento de participantes.

---

## Casos de borda

- WHEN o grupo deixou de existir ou a sessão saiu dele THEN o item SHALL falhar sem nova tentativa e o grupo SHALL ser marcado como inacessível, mantendo os membros já guardados.
- WHEN a sessão desconecta no meio da extração THEN os itens SHALL esperar (sem contar tentativa) e a extração SHALL mostrar "aguardando sessão".
- WHEN o mesmo número está em vários grupos do tenant THEN o arquivo traz uma linha (data da extração mais recente), salvo "uma linha por grupo".
- WHEN o contato já tem telefone e uma leitura posterior traz só o LID dele THEN o telefone SHALL ser mantido; nenhuma leitura apaga telefone, LID ou nome já guardados (só preenche o que falta).
- WHEN o contato só tem telefone (LID ainda desconhecido) e a pessoa reaparece só com LID THEN não há como saber que é a mesma: entra um contato só-LID à parte, e os dois são fundidos na primeira leitura que trouxer LID e telefone juntos. O telefone nunca se perde no caminho.
- WHEN uma leitura traz, para um LID conhecido, um telefone diferente do guardado THEN o guardado SHALL ficar e o novo SHALL entrar como outro contato (dois telefones valem mais que um para a base).
- WHEN o mesmo número foi extraído por dois tenants THEN existe um contato na base e dois vínculos; cada tenant exporta só o seu.
- WHEN o plano é `SAVER_MAX` (sem teto de contatos) THEN a exportação SHALL sair por fluxo (stream), sem montar o arquivo inteiro em memória.
- WHEN o `OPERATOR` com exportação liberada vira `ADMIN` ou sai do tenant THEN a liberação deixa de existir; se voltar como `OPERATOR`, começa sem ela.
- WHEN o nome contém vírgula, aspas, quebra de linha ou emoji THEN CSV e vCard SHALL continuar válidos.
- WHEN o conjunto exportado é vazio THEN SHALL responder 422 com mensagem clara, sem arquivo vazio.
- WHEN o plano é rebaixado e há mais grupos salvos que o novo limite THEN os grupos SHALL permanecer legíveis e exportáveis; novas leituras SHALL exigir estar dentro do limite.
- WHEN dois usuários pedem a extração do mesmo grupo ao mesmo tempo THEN SHALL existir um único item pendente (unicidade no banco).
- WHEN a busca tem menos de 2 caracteres THEN SHALL ser ignorada.

## Rastreabilidade

| Requisitos | História | Tasks |
| --- | --- | --- |
| SAVER-01..05, 43, 47 | Acesso, plano, permissões | T2, T3, T10, T15, T18, T25 |
| SAVER-06..10 | Escolher grupos | T11, T12, T15 |
| SAVER-11..20, 44 | Extração no worker, contato único | T4, T5, T6, T8, T9, T13, T14 |
| SAVER-21..24 | Acompanhar a extração | T12, T20, T22 |
| SAVER-25..30, 46 | Exportar | T7, T17, T24 |
| SAVER-45 | Base da plataforma (super admin) | T16, T15, T23 |
| SAVER-31..32 | Configurações | T18, T25 |
| SAVER-33, 36 | Guarda | T4, T12, T19 |
| SAVER-37..39 | Painel | T20, T21, T26 |
| SAVER-34, 35, 40..42 | P2 | T29–T32 |

**Cobertura**: 46 requisitos; 41 de P1 mapeados em T1–T28; 5 de P2 em T29–T32.

## Decisões do dono (2026-11-10 e 2026-11-11)

| # | Decisão | Resposta |
| --- | --- | --- |
| D1 | Planos Saver | **Fechado**: `SAVER_LITE` (10 grupos, 10 mil contatos, 1 sessão), `SAVER_PRO` (50, 50 mil, 1 sessão), `SAVER_MAX` (ilimitado, 2 sessões). Preço por mês: mensal R$ 29,90 / 39,90 / 49,90; anual R$ 23,90 / 32,90 / 39,90 (cobrado anualmente: R$ 286,80 / 394,80 / 478,80). **Proposta sem resposta**: leituras/dia e atualização diária (`design.md` §2.1) |
| D2 | Permissões | **Fechado**: matriz por papel; `ADMIN` libera **exportar** para operadores escolhidos (SAVER-43) |
| D3 | Tagline do menu | **Fechado**: "Exporte os contatos dos seus grupos" |
| D4 | Aviso de uso responsável (LGPD) | **Adiado**: segue P2 (SAVER-42); o dono avisa quando entrar |
| D5 | Dono dos dados e retenção | **Fechado (2026-11-11)**: os contatos extraídos são base da plataforma, únicos e sem duplicar, com data e hora de cada extração e vínculo com o tenant que extraiu; tenant nunca navega neles, só exporta o arquivo; só o super admin consulta a base de todos os tenants (SAVER-44, 45, 46). **Adiado**: regra de retenção/expurgo (SAVER-34/35) |
| D6 | `/members` | **Fechado**: redireciona para `/saver` |

Leitura confirmada pelo dono: "exportar" = tirar os contatos do grupo. O contato é gravado já na extração
(não no clique de download). Histórico de downloads fica no `AuditLog`.

**Pendência que deixa de ser adiável antes de vender**: com a base sendo da plataforma, a CopySync passa a decidir sobre
dado pessoal de terceiros (LGPD: papel de controladora). Os termos de uso do Saver precisam dizer ao tenant, com
clareza, que os contatos extraídos também ficam guardados pela plataforma. Texto e base legal: decisão do dono com apoio
jurídico; o plano só reserva o lugar (T27 lista a pendência, T31 traz o aceite).

## Critérios de pronto

- [ ] `pnpm typecheck && pnpm test` verdes em `api/` e `app/`; nenhum teste alheio ao Saver editado.
- [ ] `integration-db` verde para claim da fila e fusão de contatos (unicidade por tenant).
- [ ] Teste de independência de imports verde.
- [ ] Smoke com sessão WhatsApp real: grupo pequeno, grupo de ~1.000, grupo com números ocultos; CSV abre no Excel e no Google Sheets; vCard importa no Android e no iPhone.
- [ ] Smoke de não regressão: enviar oferta com menção a todos e abrir participantes no chat (os dois usam `getGroupParticipants`, que não muda).
- [ ] agent-browser: telas em claro e escuro, privacidade ligada, tenant só-Saver.
- [ ] `docs/saver.md`, linha no `AGENTS.md`, `docs/produto-roadmap.md`, `docs/navegacao-produtos.md`, `api/CHANGELOG.md`, versões.
