# Segurança do login

Proteção do `POST /api/auth/login` contra força bruta e uso de senha vazada. Padrão espelhado da
central PulsoSocial (`login-guard.ts`, `login-otp.ts`, `turnstile.ts`), com regras próprias do CopySync.

## Regras

| Regra | Valor | Onde |
| --- | --- | --- |
| Janela deslizante | 1 h | `LOGIN_GUARD_LIMITS.windowMs` |
| Falhas por e-mail normalizado (trim + minúsculas) | 3/h → bloqueio | `maxEmailFailures` |
| Falhas por IP | 10/h → bloqueio | `maxIpFailures` |
| Fim do bloqueio (`retryAt`) | falha que completou o teto + 1 h (com 3 falhas: a mais antiga + 1 h) | `slidingWindowRetryAt` |
| E-mail suspeito | atingiu 3 falhas numa mesma hora desde o último login limpo/código verificado (até 7 dias) — continua suspeito depois que o bloqueio vence | `isEmailSuspicious` |
| Código | 6 dígitos (CSPRNG), vale 10 min, só HMAC no banco | `HmacLoginCodeHasher` |
| Envios de código | 3/h por usuário + 60 s entre envios | `evaluateCodeSend` |
| Tentativas por código | 5 erradas invalidam | `maxCodeAttempts` |
| Ticket do passo | `lt1.<payload>.<hmac>`, 10 min, ligado ao usuário; chave derivada do `JWT_SECRET` com rótulo próprio (não vale como token de acesso) | `HmacLoginTicketSigner` |
| Retenção | eventos 30 dias, códigos 1 dia; poda probabilística (1% das gravações) | `LoginGuard.record` |

Regras puras: `api/src/modules/auth/domain/services/loginGuardRules.ts`.

## Fluxo

1. **Bloqueio** — e-mail ou IP no teto → `429 LOGIN_TOO_MANY_ATTEMPTS` com `meta.retryAt` (ISO) e
   `Retry-After`. A senha nem é conferida (não vira oráculo). A falha que completa o teto já responde 429.
2. **Turnstile** — `turnstileToken` no corpo; verificado no servidor (`siteverify`, `action` = `login`).
   Sem token `403 LOGIN_CAPTCHA_REQUIRED`; inválido `403 LOGIN_CAPTCHA_INVALID`. Não conta falha.
3. **Senha** — errada ou e-mail inexistente: `401 INVALID_CREDENTIALS` idêntico; grava `LOGIN_FAILED`
   **sem userId** (o admin lê o último IP por usuário; o IP do atacante viraria o da vítima).
4. **Senha certa + suspeito** (enforce + `LOGIN_EMAIL_OTP=on`) — envia o código e responde
   `202 { status: 'OTP_REQUIRED', ticket, codeSent, codeExpiresAt, resendAvailableAt }`.
   Se o teto/intervalo impede o envio mas há código aberto válido, devolve `codeSent: false` (usa o já
   recebido); sem código aberto → `429 LOGIN_CODE_SEND_LIMIT` com `retryAt`.
   Envio falhou → `503 LOGIN_CODE_DELIVERY_FAILED` e o código pendente é apagado (não consome o teto).
5. **`POST /auth/login/verify` `{ ticket, code }`** — certo: grava `LOGIN_CODE_VERIFIED` (zera a contagem do
   e-mail) e devolve os tokens normais (200, mesmo corpo do login). Errado `400 LOGIN_CODE_INVALID`
   (`meta.attemptsLeft`); 5ª errada `LOGIN_CODE_EXHAUSTED`; vencido/consumido `LOGIN_CODE_EXPIRED`;
   ticket ruim `LOGIN_TICKET_INVALID` (400, não 401: o painel não tenta refresh).
6. **`POST /auth/login/resend` `{ ticket }`** — novo código (o anterior é invalidado); `202` com novo ticket.
7. **Senha certa sem suspeita** — fluxo antigo; grava `LOGIN_OK` (zera a contagem do e-mail).

Tentativas e consumo do código são atômicos no banco (`UPDATE … RETURNING`): seguro com várias instâncias.

## Variáveis

| Variável | Onde | Valores | Padrão |
| --- | --- | --- | --- |
| `LOGIN_GUARD_MODE` | API | `off` \| `monitor` \| `enforce` | `monitor` |
| `LOGIN_EMAIL_OTP` | API | `on` \| `off` | `off` |
| `TURNSTILE_SECRET_KEY` | API (secret, Render) | secret do widget | — |
| `VITE_TURNSTILE_SITE_KEY` | painel (build) | site key, modo gerenciado | — |

Envio do código: `EMAIL_SENDER=hub` (+ `HUB_API_URL`, `HUB_APPLICATION_KEY`, `HUB_M2M_SECRET`).

### Modo × comportamento

| Modo | Grava eventos | Bloqueio 429 | Turnstile | Código por e-mail |
| --- | --- | --- | --- | --- |
| `off` | não | não | não | não (comportamento antigo) |
| `monitor` (padrão) | sim | sim | não | não; login suspeito só vai para o log |
| `enforce` | sim | sim | sim, se houver `TURNSTILE_SECRET_KEY` (sem ela: pulado + aviso no boot) | só com `LOGIN_EMAIL_OTP=on` |

Sem nenhuma env (dev/test): `monitor` sem Turnstile e sem código — o login funciona como antes,
só com o bloqueio de 3/h.

## E-mail (central)

`IEmailSender.send({ to, template: 'LOGIN_VERIFICATION', data: { code, expiresInMinutes: 10, name } })`
→ central `template: LOGIN_VERIFICATION`, `vars: { code: '012345' (string, 6 dígitos), expiresInMinutes: 10, name? }`,
`locale: 'pt-BR'` (padrão, como os outros templates). Allowlist em `hubEmailMapping.ts`; a central precisa
ter o template na allowlist dela.

## Painel

- `features/login-protection/`: `strings.ts` (textos), `loginProtection.ts` (código de erro → mensagem,
  horário pelo relógio do servidor), `TurnstileWidget.tsx`, `LoginCodeStep.tsx`.
- Bloqueio: "Muitas tentativas. Tente novamente às HH:MM" (`serverToLocal`), botão desabilitado até o `retryAt` (`serverNow`).
- Código: campo único (`one-time-code`, colar aceito), reenvio com `CooldownBar`, voltar.
- CSP do painel (`render.yaml`): `script-src` e `frame-src` com `https://challenges.cloudflare.com`.
  Se o Blueprint não estiver vinculado, replicar em Settings > Headers — sem isso o widget não carrega e,
  em enforce, ninguém entra.

## IP real

`resolveClientIp` (`shared/http/clientIp.ts`): `cf-connecting-ip` válido, senão `request.ip`
(`trustProxy: 1` = salto da Render). Nunca o 1º `X-Forwarded-For`. Se a API não estiver atrás da
Cloudflare, `cf-connecting-ip` pode ser forjado: o limite por IP fica fraco, o por e-mail continua valendo.

## Ligar em produção

1. Central com `LOGIN_VERIFICATION` na allowlist; `EMAIL_SENDER=hub` funcionando.
2. Widget Turnstile (modo gerenciado, hostname do painel): `VITE_TURNSTILE_SITE_KEY` no painel, CSP publicada.
3. API: `TURNSTILE_SECRET_KEY`, depois `LOGIN_GUARD_MODE=enforce`; observar logs; então `LOGIN_EMAIL_OTP=on`.

## O que não fazer

- Não revelar se o e-mail existe (mensagem, status ou tempo diferente por caso).
- Não enviar código antes da senha correta nem em senha errada.
- Não gravar `userId` em `LOGIN_FAILED`; não logar e-mail (só `emailRef`, hash curto), código ou ticket.
- Não guardar ticket/código em `localStorage`/`sessionStorage`/`usePersistedState`.
- Não usar o 1º `X-Forwarded-For` como IP.
- Não ligar `enforce` + `LOGIN_EMAIL_OTP=on` com `EMAIL_SENDER=noop`: todo login suspeito falharia com 503.
- Não colocar estado do bloqueio em memória do processo: tudo em `login_events`/`login_codes` (multi-instância).
- Leitura do banco que falha na guarda segue sem bloqueio (só log): a guarda não derruba o login.
