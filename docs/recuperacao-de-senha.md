# Recuperação de senha ("Esqueci minha senha")

Link de uso único enviado por e-mail para quem não lembra a senha do painel. Também serve a quem nunca
definiu a senha e ficou com o convite vencido. Origem: caso de 2026-11-11 (cliente criou a senha, não
lembrou, e não havia caminho sem suporte).

## Fluxo

1. Login → "Esqueci minha senha" → `/forgot-password` (painel) → `POST /api/auth/password/forgot { email, turnstileToken? }`.
2. API responde **sempre** `202 { status: 'ACCEPTED' }`, exista ou não a conta. Com conta: gera token
   (32 bytes, base64url), guarda só o SHA-256 e envia `{PANEL_URL}/reset-password/<token>` (vale 1 h).
3. `/reset-password/:token` (painel) → `POST /api/auth/password/reset/inspect { token }` → `{ email, expiresAt }` ou `404 PASSWORD_RESET_INVALID`.
4. `POST /api/auth/password/reset { token, password, confirmPassword }` → `200 { status: 'RESET' }`.
   Numa transação: consome o token (só se aberto e no prazo), grava a senha (`passwordSetAt`,
   `mustChangePassword=false`), invalida os outros links abertos da conta e **revoga todos os refresh tokens e as
   sessões da extensão** (`extension_sessions`). O access token (JWT sem estado, `JWT_ACCESS_EXPIRES_IN`, 15 min)
   já emitido segue válido até vencer: janela aceita.
   A transação começa com `SELECT … FOR UPDATE` na linha do usuário (dois links da mesma conta em fila, sem deadlock).
   Depois: evento `PASSWORD_RESET_OK` em `login_events` (zera a contagem de falhas e a suspeita do e-mail,
   como um login limpo) e `AuditLog PASSWORD_RESET_COMPLETED` (sem tenant).

## Regras

| Regra | Valor | Onde |
| --- | --- | --- |
| Pedidos por e-mail normalizado | 3/h → `429 PASSWORD_RESET_TOO_MANY_REQUESTS` (`meta.retryAt`) | `PASSWORD_RESET_LIMITS.maxEmailRequests` |
| Pedidos por IP | 10/h → mesmo 429 | `maxIpRequests` |
| Validade do link | 1 h, uso único | `tokenTtlMs` |
| Vários links abertos | todos valem até um ser usado; o uso invalida os demais | `consumeAndSetPassword` |
| Turnstile | o mesmo do login (`LoginGuard.assertHuman`, `action` = `login`); só em `LOGIN_GUARD_MODE=enforce` com as chaves | `docs/seguranca-login.md` |
| Política de senha | `validatePasswordPolicy` (a mesma do convite) | `shared/utils/passwordPolicy.ts` |
| Retenção | 30 dias; poda probabilística (1% dos pedidos) | `retentionMs` |

O teto vale em qualquer `LOGIN_GUARD_MODE` (inclusive `off`): o e-mail custa envio e incomoda a vítima.
O pedido é gravado **antes** de avaliar o teto (pedidos paralelos se enxergam); o recusado é apagado.

A entrega (`deliver`) roda fora da requisição, sem fila nem limite de concorrência próprio: o volume é contido pelo
teto por e-mail/IP e pelo rate limit global da API. Aceito; se virar gargalo, vai para fila (ver `arquitetura-escala.md`),
nunca de volta para dentro da resposta.

## Onde fica

- Regras puras: `api/src/modules/auth/domain/services/passwordResetRules.ts`.
- Use cases: `RequestPasswordResetUseCase`, `ResetPasswordUseCase` (`inspect` + `execute`).
- Persistência: `PrismaPasswordResetRepository` → tabela `password_reset_requests` (global, sem tenant: a conta é global).
  Toda requisição grava uma linha (`email`, `ip`); `userId`/`tokenHash`/`expiresAt` só quando há conta.
- Rotas: `auth/presentation/routes/passwordReset.routes.ts`, registradas por `authRoutes` sob `/api/auth`.
- Painel: `app/src/features/passwordReset/`, páginas `/forgot-password` e `/reset-password/:token`.

## E-mail (central)

`IEmailSender.send({ to, template: 'RESET_PASSWORD', data: { name, link, expiresAt } })` → central
`template: RESET_PASSWORD`, `vars: { name, resetPasswordUrl, expiresInHours }` (`hubEmailMapping.ts`).
Não confundir com o `PASSWORD_RESET` da central (código do login dela) nem com `SET_PASSWORD`
(primeiro acesso: "sua conta foi criada").

**Ligar em produção**: a central precisa estar publicada com o template `RESET_PASSWORD` e com ele na
`Application.emailTemplateAllow` do CopySync **antes** do painel mostrar o link. Sem isso a API responde
202, a central recusa o envio e só aparece `password reset email not sent` no log.

## O que não fazer

- Não revelar se o e-mail tem conta: mesma resposta, mesmo status; busca da conta, gravação do token e envio
  do e-mail rodam **sem `await`** (`RequestPasswordResetUseCase.deliver`): o tempo de resposta não pode depender
  de a conta existir. Não trocar por `await` nem responder erro de envio.
- Não guardar nem logar o token ou o link; no banco só o hash. Log só com `emailRef`.
- Não pôr o token na URL da API (path ou query): a URL entra no log de requisições. Token só no corpo.
- Não devolver tokens de sessão no reset: o usuário faz login normal (Turnstile/código seguem valendo).
- Não reaproveitar `UserInvite` nem o template `SET_PASSWORD` para redefinir senha.
- Não manter refresh tokens nem sessão da extensão depois da troca: quem redefine pode estar expulsando um invasor.
- Não diferenciar "vencido" de "já usado" na API: o caminho é o mesmo (pedir outro link).
- Não colocar token/senha em `localStorage`/`sessionStorage`/`usePersistedState` no painel.
- Não segurar transação durante o bcrypt (hash antes; o `UPDATE … WHERE usedAt IS NULL` decide a corrida).
