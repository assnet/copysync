# Excluir Página de Ofertas — spec + design + tasks

Estado: **decisões fechadas; em implementação**. Base: api 0.95.0 · app 0.118.0. Doc: `docs/pagina-de-ofertas.md`.
Escopo médio (1 use case, 1 rota, 1 serviço de confirmação de senha, 1 diálogo). Branch `feature/storefront-delete`.

## Objetivo

Admin do tenant ou super admin exclui a Página de Ofertas inteira, confirmando a **própria senha**. Exclusão limpa:
página, produtos, imagens (produtos, foto e capa) e o subdomínio, que volta a ficar disponível.

## Fatos do código (mapa 2026-11-13)

- Não há rota de exclusão. `PrismaStorefrontRepository.delete(tenantId)` existe sem chamador (`:79`).
- `Storefront` (1 por tenant) → `StorefrontOffer` e `PublicSlugClaim` em `Cascade`. Cascade **não** apaga arquivo:
  imagens `storefront-<uuid>.webp` (`StorefrontMediaStore`) ficariam órfãs; não há job de órfãos.
- Padrão de exclusão com slug: `DeleteLinkRotationUseCase` = `runInSlugTransaction` → `slugs.release` (reserva o nome
  ao tenant antigo por `SLUG_RESERVATION_DAYS = 30`) → delete, mesma transação. `docs/pagina-de-ofertas.md:41-42` já
  prevê isso para a página.
- Rotas do storefront não checam papel (OPERATOR age igual a ADMIN). `resolveMembership` dá `ADMIN | OPERATOR |
  SUPER_ADMIN`; super admin entra com o `userId` dele.
- Nenhuma rota confere a senha atual hoje (`ChangePasswordUseCase` não pede a antiga). Existe `verifyPassword`
  (bcryptjs) e `bcryptPasswordVerifier` (compara com hash fixo quando não há hash: sem oráculo de tempo). O
  `LoginGuard` é acoplado a login por e-mail/IP.
- Auditoria: sem ação `STOREFRONT_*`; ação nova = migration `ALTER TYPE` (molde `20261029040000`).
- Página pública tem `Cache-Control: max-age=60` → até 60 s de resíduo em cache após excluir.

## Alternativas avaliadas

| Alternativa | Veredito | Por quê |
|---|---|---|
| A. Use case próprio: confere papel e senha → transação (libera slug, apaga página, audita) → apaga imagens | **Escolhida** | Segue o padrão do rodízio; nada órfão; auditável. |
| B. Só `DELETE` com cascade do banco | Descartada | Imagens órfãs, slug sem regra, sem auditoria nem senha. |
| C. "Desativar" em vez de excluir | Descartada | Dono pediu exclusão real, liberando subdomínio e produtos. |
| D. Reusar o `LoginGuard` para a senha | Descartada | É por e-mail/IP de login; aqui o usuário já está logado. Contador próprio por usuário. |
| E. Confirmar digitando o subdomínio em vez da senha | Descartada | Dono pediu senha do logado. |

## Requisitos

- **SD-01** `POST /api/storefront/delete` `{ password }` → 204. (POST e não DELETE: corpo com segredo.) Hooks do
  storefront atuais + rate limit de rota.
- **SD-02** Só `ADMIN` do tenant ou super admin. `OPERATOR` → 403.
- **SD-03** Senha conferida = a do usuário logado (`request.user.userId`; super admin usa a dele). Errada → 401
  `INVALID_CREDENTIALS` genérico. **5 erros em 15 min por usuário → 429** por 15 min (tentativa reservada antes do
  bcrypt, como no login). Senha nunca em log, auditoria, resposta ou storage do navegador.
- **SD-04** Numa transação: coleta os nomes de imagem (produtos + foto + capa) → trata o slug (D1) → apaga a página
  (produtos em cascade) → auditoria `STOREFRONT_DELETED` (tenant, usuário, `bySuperAdmin`, subdomínio, nº de produtos).
  Depois do commit: remove as imagens do storage (best effort, `media.remove` nunca lança; falha vai para log com
  contagem). Sem página → 404 `STOREFRONT_NOT_FOUND`.
- **SD-05** Depois de excluir, o tenant pode criar página nova do zero (mesmo fluxo de hoje), se o plano permitir.
  Funciona também com a página `PAUSED_BY_PLAN` (não exige `storefront_enabled` para excluir).
- **SD-06** Painel: bloco "Zona de perigo" no fim da tela da Página de Ofertas (só ADMIN/super admin), botão
  "Excluir Página de Ofertas" → diálogo com o subdomínio e a contagem de produtos que serão apagados, campo de senha
  (toggle de visibilidade, nunca em `usePersistedState`), botão vermelho desabilitado até digitar. Erros: senha
  incorreta, muitas tentativas, sem permissão. Sucesso: limpa o rascunho persistido (`storefront.form`) e volta ao
  estado "criar página". Textos em `strings.ts`, `Blurred` no subdomínio, claro/escuro, Tooltip.
- **SD-07** Docs (`pagina-de-ofertas.md`: exclusão, o que não fazer), CHANGELOG, versões api 0.96.0 / app 0.119.0.

## Decisões (dono: "prossiga" com as recomendações, 2026-11-13)

- **D1** Subdomínio **livre na hora** para qualquer conta (sem reserva de 30 dias); nome premium/especial continua
  exigindo liberação do super admin. O diálogo avisa que outra conta poderá usar o endereço.
- **D2** Exclusão só para `ADMIN` do tenant e super admin; `OPERATOR` 403 e sem botão.
- **D3** 5 senhas erradas em 15 min por usuário → 429 `PASSWORD_CONFIRMATION_LOCKED` por 15 min; erro de senha =
  401 `INVALID_CREDENTIALS` genérico.

Contrato fixo: `POST /api/storefront/delete` corpo `{ "password": string }` → 204. Erros: 401 `INVALID_CREDENTIALS`,
429 `PASSWORD_CONFIRMATION_LOCKED` (`meta.retryAfterSeconds`), 403 `FORBIDDEN` (papel), 404 `STOREFRONT_NOT_FOUND`.
`GET /api/storefront` passa a informar `canDelete: boolean` (papel do usuário) para o painel mostrar a zona de perigo.

## Tasks

- **T1** Migration `ALTER TYPE … ADD VALUE 'STOREFRONT_DELETED'` + tabela `password_confirmation_attempts`
  (userId, action, success, createdAt; índice `(userId, createdAt)`).
- **T2** `ConfirmUserPasswordService` (shared/auth): reserva tentativa → bcrypt (`bcryptPasswordVerifier`) → 401/429;
  testes (errada, bloqueio, sucesso zera, usuário sem hash, sem oráculo).
- **T3** `DeleteStorefrontUseCase` (papel, senha, transação com slug conforme D1, auditoria, imagens pós-commit) +
  `IPublicSlugRegistry` (método de liberar sem reserva, se D1 = livre na hora) + testes unitários e de integração
  (Postgres descartável): página+produtos+claim somem, slug disponível para outro tenant, imagens removidas, rollback
  se a auditoria falhar.
- **T4** Rota + schema + rate limit + teste de rota (OPERATOR 403, senha errada 401, 5ª errada 429, super admin 204).
- **T5** Painel: zona de perigo, diálogo, service, strings, testes; limpa `storefront.form`.
- **T6** Docs, CHANGELOG, versões; `/caveman-review` do diff; conferência visual.

## Critérios de aceite

1. Admin com senha certa: página, produtos, imagens e claim somem; outro tenant consegue criar página com o mesmo
   subdomínio (D1).
2. Senha errada não apaga nada e responde genérico; 5 erros bloqueiam 15 min.
3. Operador não vê o botão e recebe 403 na rota.
4. Super admin exclui usando a própria senha; auditoria marca `bySuperAdmin`.
5. Depois de excluir, a tela oferece criar página nova e o rascunho antigo não reaparece.
