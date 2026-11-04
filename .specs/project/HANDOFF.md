# Handoff — 2026-11-04 (sessão até 21:00)

Retomar por aqui. Branches locais, nada com push. Juntar = `git cherry-pick <branch>` na `feature/rebranding-app` e rodar
`tsc --noEmit` + `vitest run src/modules/sessions src/modules/messaging src/shared` em `api/` (último verde: 536/536).

## CopySync (`feature/rebranding-app`)

| Frente | Estado | Próximo passo |
| --- | --- | --- |
| Limite do gerador (5/20/ilimitado) | ✅ `ba85963`, api 0.58.0 | deploy aplica migration de presets |
| E2 lease de sessão | ✅ T1–T23 + F1–F4; api 0.59.0 | 2ª revisão (`/caveman-review`) até só nits; **não fazer deploy antes** |
| E3 http × worker | plano ✅; onda 1 T1–T4 ✅ juntada (594/594 verdes); onda 2 (T5, T6, T13–T17) em `e3/t*` | juntar onda 2; depois T7→T8–T12→T18→T19→T20→T21; D1–D11 propostas, Redis ~US$10 só ao separar |
| E4 adoção | plano em `e4/plan` (se pronto) | juntar |
| Tela Assinatura | plano em `assinatura/plan` (se pronto) | juntar e executar |
| Grupos de disparo + horário | plano em `disparo/plan` (se pronto) | juntar e executar |

## Central (`pulsosocial_api`) — produção = `feature/calibracao-backend` 1.86.0 (develop/main obsoletos)

| Frente | Branch | Estado |
| --- | --- | --- |
| S1 CI | `test/char-prod-base` (`9ee0609`) | ✅ validado local; 1º run no GitHub só após push (decisão do dono) |
| S2 vitest + caracterização | `test/char-prod-base` (`c695428`) + `test/char-prod-<área>` | 6 áreas verdes; integração em `test/char-prod` + `riscos-caracterizacao.md` (em andamento) |
| S3 staging | `chore/staging-runbook` (`c0b2d12`) | anonimizador testado; revisão independente em andamento; **dono executa** `docs/staging.md` |
| H1 | plano ✅ `docs/multi-application-hub` (`tasks-h1.md`, 31 tarefas + 6 adiadas) | dono decide D1 (recomendado: `NOT NULL DEFAULT` constante, Postgres 18.6 confirmado → sem trigger/backfill) e D8 (branch de destino); executar após S2 integrado |
| H2, H3a+H4 | `docs/hub-h2-plan`, `docs/hub-h3h4-plan` (se prontos) | juntar no branch docs |
| Branches obsoletos (base develop) | `chore/ci-safety-net`, `test/characterization`, `test/char-<área>` | podem ser apagados |

## Decisões do dia (detalhe em `STATE.md`)

Checkout pela Cakto até a escala; log de corpo igual ao PulsoSocial; gerador 5/20/ilimitado; E2 D1–D7.

## Pendências do dono

- Push e PR dos branches da central (CI só roda no GitHub).
- Executar staging (`docs/staging.md` no branch `chore/staging-runbook`).
- Banco dedicado do CopySync (Virginia) no início da H1.
- `api/.env.dev` aponta para produção: trocar por env local seguro.
- **Credencial "somente leitura" do AGENTS.md não é read-only** (`default_transaction_read_only = off`): criar usuário Postgres só com SELECT e trocar no AGENTS.md; a senha está em texto puro no git.
