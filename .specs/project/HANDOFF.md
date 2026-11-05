# Handoff — 2026-11-04 (sessão até 21:00)

> **🔴 ALERTA DE SEGURANÇA — PulsoSocial em produção (central 1.86.0), CONFIRMADO no código:**
> 1. **Crítica — tomada de conta**: `module.ts:~367` aceita qualquer senha via basic-auth em conta sem senha e `session.ts` grava a senha enviada. Basta o e-mail. Expostas: contas criadas por checkout, checkout-sessions, checkout-security (OTP de cartão), free-tier, trial e Cakto antes do 1º login. Só mitigado se `LOGIN_EMAIL_OTP=true` na Render (verificar).
> 2. **Alta — LGPD**: `GET /checkout/customer-lookup/:email` público devolve nome, telefone e CPF/CNPJ completos (e enumera contas). Revisar também `GET /checkout/saved-cards/:email`.
> 3. **Alta**: `checkout/process` público sobrescreve dados cadastrais de conta existente sem pagar.
> 4. **Alta**: `GET /cakto/orders`, `/cakto/subscriptions`, `/cakto/balance` só exigem login, não ADMIN.
> **Hotfix 1.86.1 pronto** no branch local `hotfix/seguranca-acesso-dados` da central (base 0906d9f; fixes `abe0b5a`, `ce43c96`, `be1f4e7`, `1493d74`; release notes `docs/releases/1.86.1.md`; sem migration; testes que falhavam antes passam). Contrato: sign-in de conta sem senha → 401 `PASSWORD_NOT_SET` + `withoutPassword`; customer-lookup com `docNumber`/`phone` vazios + `*Masked`; `/cakto/*` de leitura → 403 sem ADMIN. **Revisão de segurança independente: pronto para deploy** (4 fixes corretos, sem contorno, sem regressão). A revisão achou mais falhas já em produção → **1.86.2 pronto** no branch `hotfix/seguranca-acesso-dados-2` (sobre o 1.86.1, topo `756b2e0`, `docs/releases/1.86.2.md`, sem migration; revisão independente em andamento): 🔴 `GET /checkout/address/:email` público com endereço completo; 🔴 `/admin/abandoned-checkouts*` e campanhas de abandono sem ADMIN (qualquer logado lista PII e dispara e-mail em massa); 🔴 rotas de `admin-gateway-recurrences` sem papel; 🟡 upsert de endereço, start-trial e free-tier sobrescrevendo dados; 🟡 token de change-password reusável/500. Achados extras: `GET /reviews` (e-mail/nome de todos) e `GET /protect/global` (números do Protect de todos) para qualquer logado. Impacto: checkout anônimo só pré-preenche cidade/UF; endereço salvo não é sobrescrito; tokens de troca de senha emitidos até 10 min antes do deploy dão 401. **Decisão do dono (produto):** exigir OTP de checkout para `customer-lookup` (ainda devolve nome), `saved-cards` (id/final/validade) e `checkout/upgrade/check` (plano e valor de qualquer e-mail). **Extensão do PulsoSocial pronta** (`/Users/adrielss/www/pulsosocial_extension`, branch `fix/primeiro-acesso-sem-senha` `f937251`, base `feature/site` 5.241.5 → 5.241.6): conta sem senha vai direto ao código por e-mail; corpo do sign-in nunca leva senha. Publicar junto ou logo após o 1.86.1 (antes disso, o 1º acesso na extensão antiga mostra a mensagem do 401 e o usuário usa "Esqueci a senha"). **Antes do deploy:** checar `LOGIN_EMAIL_OTP` na Render; se estava desligado, revisar logs `[sign-in] Senha criada para usuário`.

Retomar por aqui. Branches locais, nada com push. Juntar = `git cherry-pick <branch>` na `feature/rebranding-app` e rodar
`tsc --noEmit` + `vitest run src/modules/sessions src/modules/messaging src/shared` em `api/` (último verde: api 3088/3088, app 1218/1218).

## CopySync (`feature/rebranding-app`)

| Frente | Estado | Próximo passo |
| --- | --- | --- |
| Limite do gerador (5/20/ilimitado) | ✅ `ba85963`, api 0.58.0 | deploy aplica migration de presets |
| E2 lease de sessão | ✅ T1–T23 + F1–F4; F1–F9 ✅; 3ª revisão: 3🔴 (estado de retomada dividido) → F10 em `e2/f10`, depois F11 | juntar F10, rodar F11, 4ª revisão; **não fazer deploy antes** (`/caveman-review`) até só nits; **não fazer deploy antes** |
| E3 http × worker | T1–T6, T13–T17 ✅ juntadas (vitest completo 2848/2848) + T7 ✅ | próximo: T8–T12 (usar `engineCallSessionId`, `EngineCallsOf<K>`, portas com `close()`)→T8–T12→T18→T19→T20→T21; D1–D11 propostas, Redis ~US$10 só ao separar |
| E4 adoção | plano ✅ (`.specs/features/session-adoption/`, D1–D8 propostas); T1–T14, T17, T18 ✅ juntadas (T18 sem conferência visual) | T15 (precisa E3 T19), T16 (E3 T18), T19, T20; spec T13 diz 403 mas hook dá 401
| Tela Assinatura | ✅ T1–T18 (api 0.60.0 · app 0.77.0); visual conferido (capturas em `/private/tmp/claude-501/shots-assinatura/`) | D1 seguido pela recomendação (vencimento guardado); D2–D6 com recomendações, dono pode rever |
| Grupos de disparo + horário | plano ✅ (`.specs/features/broadcast-schedule/`) | T1, T7, T8, T9, T11 ✅ juntadas | dono decide D1–D5; depois T2–T6, T22, T23, T10, T12–T19 |

## Central (`pulsosocial_api`) — produção = `feature/calibracao-backend` 1.86.0 (develop/main obsoletos)

| Frente | Branch | Estado |
| --- | --- | --- |
| S1 CI | `test/char-prod-base` (`9ee0609`) | ✅ validado local; 1º run no GitHub só após push (decisão do dono) |
| S2 vitest + caracterização | `test/char-prod` (`a7339bc`) | ✅ 6 áreas integradas; CI local verde; char:db 469/469 2x; riscos em `docs/multi-application-hub:.specs/features/multi-application-hub/riscos-caracterizacao.md` (`e2cc83e`, 19 riscos) |
| S3 staging | `chore/staging-runbook` (`be5cc95`) | 3 rodadas de revisão; sem 🔴; 2 🟡 finais corrigidos. **Pronto para o dono executar `docs/staging.md`** (Basic Auth/Private antes de liberar, inclusive `/webhook/*`) |
| H1 | plano ✅ `docs/multi-application-hub` (`tasks-h1.md`, 31 tarefas + 6 adiadas) | dono decide D1 (recomendado: `NOT NULL DEFAULT` constante, Postgres 18.6 confirmado → sem trigger/backfill) e D8 (branch de destino); executar após S2 integrado |
| H2, H3a+H4 | planos ✅ `docs/hub-h2-plan` (`3826d8b`), `docs/hub-h3h4-plan` (`ca43dae`) | juntar no branch docs; follow-ups CopySync: `Tenant.lastBillingEventSeq` Int→BigInt, receiver aplicar `expiresAt` de `subscription.updated`, aceitar 2 segredos na rotação |
| Branches obsoletos (base develop) | `chore/ci-safety-net`, `test/characterization`, `test/char-<área>` | podem ser apagados |

## Outros branches em andamento

- CopySync: `billing/seq-bigint` e `billing/two-secrets` ✅ juntados. `expiresAt` do `subscription.updated` NÃO aplicado: falta coluna de vencimento (cruza com Assinatura D1/T1–T2).
- Central: `hub/h2-pure-base` (padrão `*.hub.test.ts`) + ✅ `hub/h2-t5`, `h2-t6`, `h2-t7`, `h2-t8`, `h2-t13`, `h4-t21`, `h4-t23`, `h4-t26` (cada um 1 commit sobre a base; juntar num branch de H2/H4 quando H1 existir). Staging rodada 2 e integração da caracterização (`test/char-prod`, `riscos-caracterizacao.md`) podem ter terminado após 21:00: conferir branches.

## Decisões do dia (detalhe em `STATE.md`)

Checkout pela Cakto até a escala; log de corpo igual ao PulsoSocial; gerador 5/20/ilimitado; E2 D1–D7.

## Achados fora de escopo (backlog)

- ✅ resolvido (app 0.80.0): modo sistema no tema; nome do tenant no cabeçalho borra; textos padrão do MUI em pt-BR; cards do público-alvo.
- Visual a conferir com login local: cabeçalho com privacidade ligada e gerador a 1280 px.

## Pendências do dono

- Push e PR dos branches da central (CI só roda no GitHub).
- Executar staging (`docs/staging.md` no branch `chore/staging-runbook`).
- Banco dedicado do CopySync (Virginia) no início da H1.
- `api/.env.dev` aponta para produção: trocar por env local seguro.
- **Credencial "somente leitura" do AGENTS.md não é read-only** (`default_transaction_read_only = off`): criar usuário Postgres só com SELECT e trocar no AGENTS.md; a senha está em texto puro no git.
