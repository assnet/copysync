# Handoff — 2026-11-04

Retomar por aqui. Tudo em branches locais, nada com push. Juntar no CopySync = `git cherry-pick <branch>` na
`feature/rebranding-app` + `tsc --noEmit` e `vitest run` em `api/` e `app/` (último verde: api 3334/3334, app 1330/1330;
versões api 0.64.0 · app 0.82.0). `git add` só com caminhos explícitos (o dono tem rascunhos não rastreados em `.specs/` e `docs/`).

## 🔴 Segurança — PulsoSocial em produção (central 1.86.0)

Falhas confirmadas no código e hotfixes prontos na central (`/Users/adrielss/www/pulsosocial_api`), cada um com revisão
independente aprovada, sem migration. **Ordem de deploy: 1.86.1 (urgente) → 1.86.2 → 1.86.3.**

| Versão | Branch (topo) | Fecha |
| --- | --- | --- |
| 1.86.1 | `hotfix/seguranca-acesso-dados` (`4d3e28f`) | tomada de conta por basic-auth em conta sem senha; CPF/telefone no `customer-lookup`; checkout sobrescrevendo dados; `/cakto/*` sem ADMIN |
| 1.86.2 | `hotfix/seguranca-acesso-dados-2` (`756b2e0`) | endereço completo público; abandoned-checkouts e campanhas sem ADMIN; recorrências de gateway sem papel; endereço/trial/free-tier sobrescrevendo; token de troca de senha reusável |
| 1.86.3 | `hotfix/seguranca-acesso-dados-3` (`d70fd3a`) | `/protect/global` (só assinante válido, 5 campos, amostra estável por hora, teto) e `/reviews` (lista só ADMIN/master); dono do endereço por id; gravações atômicas |

Antes do deploy: conferir `LOGIN_EMAIL_OTP` na Render (se estava desligado, revisar logs `[sign-in] Senha criada para usuário`).
Extensão do PulsoSocial: `/Users/adrielss/www/pulsosocial_extension` branch `fix/primeiro-acesso-sem-senha` (`e6d1097`, 5.241.7),
publicar junto ou logo após o 1.86.1. Não rodar `api/scripts/ops/create-index-loguserhardware-userid-updatedat.sql` sem `EXPLAIN`
provando ganho. Decisões do dono: OTP de checkout para `customer-lookup`/`saved-cards`/`checkout/upgrade/check`; rate limit opcional
no `/protect/global`; garantir que todo e-mail master já tenha conta. Notas em `docs/releases/1.86.{1,2,3}.md`.

## CopySync (`feature/rebranding-app`)

| Frente | Estado | Pendência |
| --- | --- | --- |
| Limite do gerador 5/20/ilimitado | ✅ | deploy aplica a migration de presets |
| E2 lease de sessão | ✅ T1–T23, F1–F14; 6 revisões, ciclo encerrado | `DATABASE_SOCKET_TIMEOUT_S` é pré-requisito para mais de um processo |
| E3 http × worker | ✅ T1–T25 (revisão independente: `all` sem mudança; correções T22–T25) | sessão real no smoke; Redis ~US$ 10 só ao separar (timeout de texto 60 s: decidido) |
| E4 adoção por capacidade | ✅ T1–T23 (revisão independente; correções T21–T23) | ✅ T24 (só login concluído ocupa vaga, revisada); Telegram `AWAITING_QR/PAIRING` ainda adotável |
| Tela Assinatura | ✅ T1–T20 (visual conferido; revisão independente; T19/T20) | D2–D6 com recomendações |
| Grupos de disparo + horário | ✅ T1–T30 (visual conferido; revisão independente; T28–T30) | D1–D5 com recomendações; tenant acima do limite pela soma fica sem salvar novos destinos |
| Receiver de cobrança | ✅ seq BigInt, 2 segredos na rotação, vencimento gravado, `expiresAt` malformado → 400 | hub manda `null` para limpar |
| Painel | ✅ tema sistema/claro/escuro, tenant borra no cabeçalho, MUI pt-BR | conferir visual com login local |

Checklist antes de ligar mais de um processo na Render: `docs/arquitetura-escala.md` §5.1.

## Central — roadmap do hub

| Frente | Branch | Estado |
| --- | --- | --- |
| S1 CI + S2 caracterização | `test/char-prod` (`a7339bc`) | ✅ 6 áreas; 19 riscos em `riscos-caracterizacao.md` |
| S3 staging | `chore/staging-runbook` (`be5cc95`) | ✅ 3 revisões; dono executa `docs/staging.md` |
| H1 | `feature/hub-h1` (`5824ea3`) | T01–T05, T10, T26 ✅; **bloqueado em D1** (recomendado `NOT NULL DEFAULT`, Postgres 18.6) e D8 (branch de destino) |
| H2 / H3a / H4 | planos em `docs/multi-application-hub`; funções puras em `hub/h2-t5..t13`, `hub/h4-t17`, `hub/h4-overrides` (T21–T25) | esperam H1 |

## Pendências do dono

- Deploy dos hotfixes 1.86.1 → 1.86.3 e publicação da extensão 5.241.7.
- D1 e D8 da H1; push/PR dos branches (CI só roda no GitHub).
- Commit `5868258` contém por engano `.specs/features/plans-modal/spec.md` (já tirado do índice em `674cf50`); limpar do histórico antes do push, se quiser.
