# Handoff — 2026-11-04 (sessão até 21:00)

Retomar por aqui. Branches locais, nada com push. Juntar = `git cherry-pick <branch>` na `feature/rebranding-app` e rodar
`tsc --noEmit` + `vitest run src/modules/sessions src/modules/messaging src/shared` em `api/` (último verde: suíte completa 2881/2881).

## CopySync (`feature/rebranding-app`)

| Frente | Estado | Próximo passo |
| --- | --- | --- |
| Limite do gerador (5/20/ilimitado) | ✅ `ba85963`, api 0.58.0 | deploy aplica migration de presets |
| E2 lease de sessão | ✅ T1–T23 + F1–F4; 2ª revisão achou 3🔴 3🟡 → F5–F8 em `e2/f5..f8` | juntar F5–F8; 3ª revisão (`/caveman-review`) até só nits; **não fazer deploy antes** |
| E3 http × worker | T1–T6, T13–T17 ✅ juntadas (vitest completo 2848/2848) | próximo: T7→T8–T12→T18→T19→T20→T21; D1–D11 propostas, Redis ~US$10 só ao separar |
| E4 adoção | plano ✅ (`.specs/features/session-adoption/`, D1–D8 propostas); T1–T4, T6, T12 ✅ juntadas (vitest completo 2881/2881); onda 2 (T5, T7, T8, T17) em `e4/t*` | juntar; depois T10, T13, T9, T11, T18 |
| Tela Assinatura | plano ✅ (`.specs/features/subscription-page/`) | dono decide D1–D6 (recomendações no arquivo); executar |
| Grupos de disparo + horário | plano ✅ (`.specs/features/broadcast-schedule/`) | dono decide D1–D5; executar |

## Central (`pulsosocial_api`) — produção = `feature/calibracao-backend` 1.86.0 (develop/main obsoletos)

| Frente | Branch | Estado |
| --- | --- | --- |
| S1 CI | `test/char-prod-base` (`9ee0609`) | ✅ validado local; 1º run no GitHub só após push (decisão do dono) |
| S2 vitest + caracterização | `test/char-prod-base` (`c695428`) + `test/char-prod-<área>` | 6 áreas verdes; integração em `test/char-prod` + `riscos-caracterizacao.md` (em andamento) |
| S3 staging | `chore/staging-runbook` (`c0b2d12`) | 12 achados da revisão corrigidos (`0bc0478`: script com trava real, senhas aleatórias, admin por variável, Cakto sem credencial, EFI sandbox); re-revisão em andamento. **Só executar depois da re-revisão convergir** |
| H1 | plano ✅ `docs/multi-application-hub` (`tasks-h1.md`, 31 tarefas + 6 adiadas) | dono decide D1 (recomendado: `NOT NULL DEFAULT` constante, Postgres 18.6 confirmado → sem trigger/backfill) e D8 (branch de destino); executar após S2 integrado |
| H2, H3a+H4 | planos ✅ `docs/hub-h2-plan` (`3826d8b`), `docs/hub-h3h4-plan` (`ca43dae`) | juntar no branch docs; follow-ups CopySync: `Tenant.lastBillingEventSeq` Int→BigInt, receiver aplicar `expiresAt` de `subscription.updated`, aceitar 2 segredos na rotação |
| Branches obsoletos (base develop) | `chore/ci-safety-net`, `test/characterization`, `test/char-<área>` | podem ser apagados |

## Decisões do dia (detalhe em `STATE.md`)

Checkout pela Cakto até a escala; log de corpo igual ao PulsoSocial; gerador 5/20/ilimitado; E2 D1–D7.

## Pendências do dono

- Push e PR dos branches da central (CI só roda no GitHub).
- Executar staging (`docs/staging.md` no branch `chore/staging-runbook`).
- Banco dedicado do CopySync (Virginia) no início da H1.
- `api/.env.dev` aponta para produção: trocar por env local seguro.
- **Credencial "somente leitura" do AGENTS.md não é read-only** (`default_transaction_read_only = off`): criar usuário Postgres só com SELECT e trocar no AGENTS.md; a senha está em texto puro no git.
