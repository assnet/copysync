# Central de Atendimento Multiusuário — Especificação

Decisões: ver `context.md` (D1–D7).

## Problema

Cada tenant tem um único usuário de fato. Todo usuário do tenant vê todas as sessões e conversas.
`role` entra no contexto, mas nenhuma rota confere. `assignedUserId` existe e não é usado. O cliente
não consegue montar uma equipe, dividir números ou chats entre ela, nem distribuir atendimentos
automaticamente.

## Objetivos

- [ ] O ADMIN monta a equipe (usuários + departamentos) sem ajuda da plataforma
- [ ] Todo chat novo recebe departamento e responsável em < 2 s, sem ação manual, quando a
      distribuição é automática
- [ ] O OPERATOR nunca lê chat fora do escopo dele (API bloqueia, não só a UI)
- [ ] Cada atendimento tem histórico completo (quem, quando, de onde para onde)

## Fora de escopo

| Item                                   | Motivo                                              |
| -------------------------------------- | --------------------------------------------------- |
| Papéis customizados / RBAC granular    | Flags por usuário bastam na v1                       |
| Flow builder / bot com IA na triagem   | O menu simples (D3) cobre a v1; flows vêm depois    |
| SLA com alertas e escalonamento        | Depende das métricas; fica para a v2                 |
| Dashboard de métricas por operador     | A v1 só grava o histórico, que é a base das métricas |
| Autocadastro público / checkout        | Decisão pendente sobre a API central — ver `integracao-api-central.md`. Nesta feature, tenant nasce pelo SUPER_ADMIN via `ProvisionTenantUseCase`, porta única que o webhook de billing reaproveita depois |

## Conceito central: Atendimento

Uma **conversa** (`ChatConversation`) tem vários **atendimentos** ao longo do tempo. Um atendimento
é um ciclo: aberto → na fila → em atendimento → finalizado. Departamento, responsável, histórico e
métricas pertencem ao atendimento, não à conversa.

---

## P1 — MVP

### P1.0 Provisionar tenant (o cliente nasce como ADMIN) ⭐

**História**: como plataforma, quero criar um cliente pronto para usar, com o contratante como
ADMIN, para que ele monte a própria equipe.

1. WHEN o SUPER_ADMIN provisiona um tenant (nome, slug, e-mail e nome do contratante) THEN o
   sistema SHALL criar, em uma transação, `Tenant` + `User` + `UserTenant(ADMIN)` + departamento
   padrão. Se o e-mail já tiver conta, SHALL só criar o vínculo, sem alterar senha nem
   `mustChangePassword`. (PROV-01)
2. WHEN o tenant é provisionado e a conta do contratante é nova ou ainda sem senha THEN ele
   SHALL receber um link de primeiro acesso (mesmo mecanismo do convite, USR-01) para definir a
   senha. WHEN a conta já tem senha THEN SHALL só ser vinculada, sem link. (PROV-02)
3. WHEN o tenant está `SUSPENDED` ou `CANCELLED` THEN o `tenantHook` SHALL negar toda rota
   tenant-aware com erro `TENANT_SUSPENDED` (403), preservando o login. (PROV-03)
4. WHEN o provisionamento vier de outra origem (ex.: webhook de billing) THEN SHALL reutilizar o
   mesmo use case, identificando a origem no `AuditLog`. (PROV-04)

**Teste independente**: o SUPER_ADMIN provisiona; o contratante abre o link, define a senha e
entra como ADMIN de um tenant com departamento padrão.

### P1.1 Equipe: cadastro de usuários ⭐

**História**: como ADMIN, quero incluir usuários no meu tenant para formar a equipe.

1. WHEN o ADMIN convida um e-mail THEN o sistema SHALL gerar um convite de uso único que expira em
   72 h, enviar por e-mail se houver provedor e sempre exibir um link copiável. (USR-01)
2. WHEN o convidado abre o link válido THEN o sistema SHALL pedir nome + senha e vincular o usuário
   ao tenant com o papel do convite. Se o e-mail já tiver conta **com senha**, o sistema SHALL
   ignorar a senha informada, exigir login nessa conta e só então criar o vínculo — o link nunca
   redefine senha existente. (USR-02)
3. WHEN o ADMIN cria um usuário direto com e-mail novo THEN o sistema SHALL gerar uma senha
   provisória e exigir a troca no primeiro login. WHEN o e-mail já tem conta THEN SHALL criar
   só o vínculo, sem tocar na senha existente, e informar que a conta já existia. (USR-03)
4. WHEN o ADMIN desativa um usuário THEN o sistema SHALL negar o acesso dele a este tenant no
   próximo request e no tempo real, devolver os atendimentos abertos dele para a fila e
   desfazer os números roteados a ele, sem afetar o acesso dele a outros tenants. (USR-04)
5. WHEN um OPERATOR tenta qualquer ação de gestão — equipe, departamentos, roteamento e
   **sessões (criar, conectar, desconectar, apagar número)** — THEN a API SHALL responder 403;
   WHEN lista sessões THEN SHALL ver só os números do próprio escopo. (USR-05)

**Teste independente**: o ADMIN convida um e-mail; o convidado entra e vê só o que lhe cabe.

### P1.2 Autorização por papel ⭐

1. WHEN uma rota exige um papel THEN um guard SHALL conferir `tenantContext.role` antes do
   handler. (RBAC-01)
2. WHEN o schema HTTP expõe `role` THEN SHALL usar o enum do Prisma (`ADMIN`, `OPERATOR`),
   corrigindo o enum atual `OWNER/MEMBER`. (RBAC-02)

### P1.3 Departamentos ⭐

1. WHEN o ADMIN cria um departamento THEN o sistema SHALL guardar nome, membros em ordem e as
   estratégias de D2. (DEPT-01)
2. WHEN o ADMIN reordena os membros THEN o rodízio SHALL seguir a nova ordem a partir do próximo
   atendimento. (DEPT-02)
3. WHEN um usuário pertence a vários departamentos THEN SHALL aparecer na fila de todos. (DEPT-03)
4. WHEN o tenant não configura nada THEN SHALL existir um departamento padrão com triagem manual e
   visibilidade "tudo do número" (comportamento atual preservado). (DEPT-04)

### P1.4 Atribuição de números e chats ⭐

1. WHEN o ADMIN vincula um número a um usuário ou departamento THEN os chats novos desse número
   SHALL entrar no escopo dele. (ASG-01)
2. WHEN o ADMIN atribui um chat específico a um usuário THEN SHALL abrir ou atualizar o atendimento
   com esse responsável, sem mudar o vínculo do número. A atribuição SHALL existir por um único
   caminho (o do atendimento); o `PATCH` genérico da conversa deixa de aceitar responsável e fila
   — mudança de contrato documentada como breaking. (ASG-02)
3. WHEN um número não tem vínculo THEN seus chats SHALL cair no departamento padrão. (ASG-03)

### P1.5 Visibilidade configurável ⭐

1. WHEN um OPERATOR lista conversas, mensagens, metadados de mídia ou recebe eventos em tempo
   real THEN a API SHALL aplicar o escopo do modo configurado: atribuídos + fila, tudo do número
   ou só atribuídos. Todo evento em tempo real que cite uma conversa SHALL ser filtrado pelo
   mesmo escopo; evento sem informação de escopo SHALL ser descartado, nunca entregue a todos. Limitação conhecida: o arquivo de mídia em si é servido por URL opaca sem
   autenticação (pré-existente); URL assinada fica para feature própria. (VIS-01)
2. WHEN um OPERATOR pede um chat ou atendimento fora do escopo pelo id, em qualquer rota
   (detalhe, mensagens, mídia, histórico ou ação) THEN a API SHALL responder 404 (não revela que
   existe). (VIS-02)
3. WHEN o usuário é ADMIN THEN SHALL ver tudo do tenant. (VIS-03)

### P1.6 Triagem e distribuição ⭐

1. WHEN chega a primeira mensagem de um chat sem atendimento aberto THEN o sistema SHALL abrir um
   atendimento, triar o departamento (número → depto ou manual) e distribuir pela estratégia do
   departamento. (DIST-01)
2. Rodízio: SHALL entregar ao próximo membro na ordem, pulando os indisponíveis. (DIST-02)
3. Menor carga: SHALL entregar a quem tem menos atendimentos em aberto; empate segue a ordem. (DIST-03)
4. Operador puxa: SHALL deixar na fila; o botão "Atender" atribui a quem clicou, com trava
   contra dois operadores pegarem o mesmo chat. (DIST-04)
5. Fixo por número: SHALL entregar ao usuário vinculado ao número. (DIST-05)
6. WHEN ninguém está disponível THEN o atendimento SHALL ficar na fila do departamento e ser
   distribuído assim que alguém ficar disponível. (DIST-06)
7. WHEN o sistema abre um chat (envio ativo pelo painel) THEN o atendimento SHALL ficar com quem
   enviou. (DIST-07)

### P1.7 Presença e limite ⭐

1. WHEN a presença está ativa THEN o usuário SHALL ter status online, pausa ou offline, e só
   online recebe distribuição automática. (PRES-01)
2. WHEN o usuário atinge o limite de atendimentos simultâneos THEN SHALL ser pulado. (PRES-02)
3. WHEN o usuário fecha o painel ou perde a conexão em tempo real por mais de N min THEN SHALL
   virar offline. (PRES-03)

### P1.8 Ações de atendimento ⭐

1. Transferir: WHEN o responsável transfere para um usuário ou departamento, com nota opcional,
   THEN SHALL mudar o responsável ou a fila e notificar o destino. (ACT-01)
2. Finalizar: SHALL fechar o atendimento e liberar a vaga. Reabrir: SHALL criar um novo
   atendimento com o mesmo responsável. (ACT-02)
3. Assumir: WHEN o ADMIN ou um usuário com a flag assume um chat de outro THEN SHALL trocar o
   responsável e registrar. (ACT-03)
4. Retorno: WHEN um contato com atendimento finalizado volta a escrever THEN SHALL aplicar o modo
   configurado: último atendente se disponível dentro de X h, senão nova triagem. (ACT-04)

### P1.9 Histórico / auditoria ⭐

1. WHEN ocorre abrir, distribuir, atender, transferir, assumir, finalizar ou reabrir THEN o
   sistema SHALL gravar o evento com ator, origem, destino e timestamp. (HIST-01)
2. WHEN alguém abre os detalhes da conversa THEN SHALL ver a linha do tempo dos atendimentos. (HIST-02)

---

## P2

### P2.1 Menu simples de triagem (D3)

1. WHEN o departamento de entrada usa menu THEN o sistema SHALL enviar a pergunta com as opções,
   ler a resposta (número ou texto) e encaminhar. (TRI-01)
2. WHEN a resposta é inválida N vezes ou não chega em X min THEN SHALL mandar para o departamento
   de fallback. (TRI-02)

### P2.2 Triagem por regras

1. WHEN uma mensagem casa com uma regra (palavra-chave, lista, etiqueta) THEN SHALL encaminhar para
   o departamento da regra; a ordem das regras decide o empate. (TRI-03)

### P2.3 Expediente

1. WHEN o atendimento chega fora do expediente do departamento THEN SHALL ficar na fila e,
   opcionalmente, enviar uma mensagem automática configurável. (PRES-04)

---

## Casos de borda

- WHEN dois eventos da mesma conversa chegam juntos THEN SHALL abrir um único atendimento
  (idempotência por conversa com atendimento aberto).
- WHEN o responsável é removido do departamento THEN seus atendimentos abertos SHALL voltar à fila.
- WHEN a mensagem é de grupo THEN SHALL seguir a mesma triagem (o grupo é tratado como um chat).
- WHEN a mensagem é enviada pelo próprio número em outro aparelho (`fromMe`) THEN SHALL NÃO abrir
  atendimento.
- WHEN o convite já foi usado ou expirou THEN SHALL responder erro claro, sem revelar se o e-mail
  tem conta.
- WHEN o último ADMIN tenta se rebaixar ou se desativar THEN SHALL bloquear.

## Rastreabilidade

| IDs                  | História            | Fase    | Status   |
| -------------------- | ------------------- | ------- | -------- |
| PROV-01..04          | P1.0 Provisionar    | Design  | Pending  |
| USR-01..05           | P1.1 Equipe         | Design  | Pending  |
| RBAC-01..02          | P1.2 Autorização    | Design  | Pending  |
| DEPT-01..04          | P1.3 Departamentos  | Design  | Pending  |
| ASG-01..03           | P1.4 Atribuição     | Design  | Pending  |
| VIS-01..03           | P1.5 Visibilidade   | Design  | Pending  |
| DIST-01..07          | P1.6 Distribuição   | Design  | Pending  |
| PRES-01..03          | P1.7 Presença       | Design  | Pending  |
| ACT-01..04           | P1.8 Ações          | Design  | Pending  |
| HIST-01..02          | P1.9 Histórico      | Design  | Pending  |
| TRI-01..03, PRES-04  | P2                  | -       | Pending  |

**Cobertura**: 41 requisitos, 0 mapeados a tarefas.

## Critérios de sucesso

- [ ] Teste de integração: um OPERATOR não obtém nenhum chat fora do escopo em lista, detalhe,
      mensagens, metadados de mídia, histórico, ações ou WebSocket
- [ ] 100 mensagens simultâneas de chats novos abrem exatamente 100 atendimentos, sem duplicar
- [ ] Tenant existente sem configuração continua funcionando igual (DEPT-04)
- [ ] Telas novas com i18n (padrão `strings.ts`) e tema sistema/claro/escuro
