# Central de Atendimento — Decisões de Contexto

Decisões do usuário na fase Specify (2026-09-27). Restringem o design.

## D1 — Cada cliente é um tenant, com vários usuários

Papéis: `ADMIN` (gestor do cliente) e `OPERATOR` (atendente). `SUPER_ADMIN` é da plataforma.
Nenhum papel novo na v1. Permissões finas (ex.: "pode assumir chat") são flags por usuário.

## D2 — Tudo é configurável pelo cliente (Strategy + registry)

Cada eixo abaixo é uma estratégia que o ADMIN escolhe **por departamento** (e, quando fizer
sentido, por usuário). Estratégia nova entra no registry sem tocar no núcleo.

| Eixo          | Modos v1                                                                 |
| ------------- | ------------------------------------------------------------------------ |
| Visibilidade  | atribuídos + fila · tudo do número · só atribuídos                       |
| Distribuição  | rodízio na ordem · menor carga · operador puxa · fixo por número         |
| Triagem       | número → depto · menu simples · regras · manual                          |
| Presença      | presença + limite · + expediente · sem presença                          |
| Retorno       | último atendente (janela X h) · nova triagem                             |

## D3 — Menu de triagem próprio e simples

Pergunta + opções → departamento, dentro do módulo de triagem. Depois vira um bloco do flow
builder. Não depende do módulo `flows`.

## D4 — Ações v1: transferir, finalizar/reabrir, assumir, histórico/auditoria

## D5 — Entrada de usuários: convite por e-mail **e** criação direta com senha provisória

**Implicação**: a API não tem envio de e-mail hoje. O convite gera um link de uso único. Sem
provedor de e-mail configurado, o ADMIN copia o link. O provedor fica atrás de uma porta
(`EmailSender`).

## D7 — Onboarding do cliente: porta única, integração adiada (2026-09-27)

Análise da API central em `integracao-api-central.md`. Decisão: **não decidir agora** entre
webhook da central (opção A) e SSO (opção B). Esta feature entrega `ProvisionTenantUseCase`
exposto só ao SUPER_ADMIN. Qualquer integração futura entra como nova porta de entrada do mesmo
use case, sem tocar no atendimento.

**Implicação**: `Tenant` ganha campos neutros (`billingCustomerId?`, `planSnapshot?`) já nesta
feature, para o webhook futuro não exigir migration no núcleo.

## D8 — Resposta pelo celular não mexe no atendimento (2026-09-27)

Dono do número que responde pelo aparelho a uma conversa na fila: o ticket **fica na fila**,
marcado "respondida pelo aparelho". Um operador ainda pode assumir. Fechar o ticket
automaticamente esconderia cliente sem atendimento de quem está no painel.

**Implicação**: `fromMe` nunca publica evento de conversa; a marcação é derivada (última
`OUTBOUND` mais recente que `Ticket.openedAt`), sem campo novo. Configurável por departamento
fica para depois, se surgir demanda.

## D6 — Desacoplamento

O módulo de atendimento só consome eventos internos (`MESSAGE_RECEIVED`, conversa criada/aberta
pelo sistema) e publica os próprios eventos. `chat`/`messaging` não importam nada dele.
A visibilidade entra nas consultas do chat por uma porta (`ConversationAccessScope`),
resolvida uma vez por request.
