# Extensão de navegador — sessão de afiliado

Pasta: `extension/` · README operacional: [`extension/README.md`](../extension/README.md)

## Objetivo

Capturar, no navegador do operador, a sessão logada do marketplace (Mercado Livre) e enviá-la ao
painel para o tenant gerar links de afiliado automaticamente. A extensão **não** lê senha do
marketplace nem cookie da própria API: só o cookie `ssid` do domínio do marketplace e o
`meta[name="csrf-token"]` da página aberta. Substitui o legado "Redirect Flow"
(`legadoML/iiobglifbapgfafnghkcakggkcaddpap/`), que mandava os tokens para uma API de terceiro.

## Arquitetura

```
 popup (UI)                 background (service worker)                 content (página do marketplace)
 ───────────                ───────────────────────────                 ──────────────────────────────
 RuntimeRequest ──────────▶ index.ts (onMessage/onAlarm)
                               │
                               ├─ authStore.ts ── chrome.storage.local (auth, settings, syncState)
                               ├─ apiClient.ts ── fetch(env.apiUrl + path)  ──▶  API (login/refresh/PUT session)
                               ├─ marketplaceSession.ts
                               │     ├─ chrome.cookies.getAll({ domain: MARKETPLACE_COOKIE_DOMAIN })
                               │     ├─ chrome.tabs.query({ url: MARKETPLACE_URL_PATTERN })
                               │     └─ tabs.sendMessage('page/get-csrf') ─────▶ content/index.ts (lê o meta)
                               │            └─ fallback: scripting.executeScript
                               └─ syncSession.ts ── runSync('alarm'|'manual') com mutex → SyncState
 ◀──────── RuntimeResponse ────┘ ({ ok, state: SessionStateSnapshot } | { ok:false, errorCode })
```

Módulos: `src/config/env.ts` (único `process.env`), `src/contract/{api,messages}.ts` (tipos
compartilhados), `src/core/{devLog,i18n}.ts`. Nenhuma regra mora em `index.ts`.

## Contrato com a API

| Rota | Headers | Body | Resposta |
|---|---|---|---|
| `POST {API_URL}/auth/login` | — | `{ email, password }` | `LoginResponse` (`accessToken`, `refreshToken`, `user`, `tenants[]`) |
| `POST {API_URL}/auth/refresh` | — | `{ refreshToken }` | `{ accessToken }` |
| `PUT {API_URL}/integrations/affiliate-credentials/MERCADO_LIVRE/session` | `Authorization: Bearer`, `X-Tenant-Id` | `{ sessionToken, csrfToken, affiliateTag?, capturedAt }` | `{ provider, status, updatedAt }` |

Todas no envelope `{ success, data, error? }` de `shared/http/httpResponse.ts`.

**Rota implementada (API 0.18.0):** `PUT …/session` em `api/src/modules/integrations`
(`.specs/features/affiliate-credentials`, T7b). Sessão gravada cifrada (AES-256-GCM); `affiliateTag`
inválida é descartada sem recusar a sessão e só preenche ID vazio (o painel vence); auditoria só
quando o token muda. Ver `docs/integracoes-credenciais-afiliado.md`. API antiga (sem a rota)
responde 404 e a extensão mostra `err_api_route_missing`. Manter `AffiliateSessionSyncRequest`
(`extension/src/contract/api.ts`) como contrato.

Tradução de erros (padrão AGENTS.md §13): `apiClient.ts` nunca propaga texto da API; cada falha
vira `SyncErrorCode` → chave `err_<code>` nas locales. 401 → um refresh e repete; refresh recusado
(401) → limpa auth + `api_unauthorized`; refresh falhou por rede/5xx → propaga sem deslogar. 404 →
`api_route_missing`. Outros → `api_rejected`. Rede → `api_unreachable`. Login: 401 →
`login_invalid`; sem tenant → `login_no_tenant`. "Sair" chama `POST /auth/logout` (best-effort)
antes de limpar o storage. Tokens nunca saem do background: o popup recebe `AuthSummary`
(usuário, tenants, tenant ativo).

## Sistema de proteção

### Removido do legado

- `_metadata/verified_contents.json` — assinatura da Chrome Web Store do "Redirect Flow". Fica
  inválida após qualquer edição e só serve para a listagem original; o Chrome recusa carregá-la
  em outra listagem. `check-dist` falha se `_metadata/` aparecer em `dist/`.
- `update_url` apontando para a listagem antiga `iiobglifbapgfafnghkcakggkcaddpap`. Deixava o
  Chrome auto-atualizar para o pacote de terceiro. `check-dist` falha se existir no manifest.
- `console.log` em produção e content script com polling/`window.load` e leitura de
  `document.cookie`.

### O que entrou

- **`key` no manifest** → ID estável da extensão em qualquer máquina e na Web Store. Chave privada
  em `extension/.keys/extension-private.pem` (ignorada pelo git; guardar fora do repositório).
- **Terser** remove `console.*` e `debugger` no build de produção; **`devLog`/`devError`** só
  executam com `DEV=true` (gate no código, não só no minificador).
- **`scripts/check-dist.mjs`** — pós-build: versão = `package.json`, sem `localhost`/IP privado,
  host de `API_URL` presente no `background.js`, sem `console.log(`/`debugger`, sem `_metadata/`
  nem `update_url`.
- **`scripts/check-cookie-scope.mjs`** — `chrome.cookies.*` só em `marketplaceSession.ts` e com
  `MARKETPLACE_COOKIE_DOMAIN` a até 240 chars.
- **`scripts/check-i18n.mjs`** — paridade pt_BR ⇄ en e toda chave usada (`t()`, `data-i18n`,
  `data-i18n-attr`, `err_<SyncErrorCode>`) existe.
- `onMessage` do background ignora remetente que não seja a própria extensão.
- **Não portado** do PulsoSocial: gate de e-mail do dono. Lá ele protege sondas de desenvolvimento;
  aqui não há sondas — tudo que a extensão faz é o fluxo de produção.

## Versionamento

`extension/package.json` é a fonte (`2.0.0` reinicia a série após o legado `1.x`). O webpack
(`CopyPlugin.transform`) escreve a mesma versão em `dist/manifest.json`; `check-dist` confere.
Nunca editar `version` em `public/manifest.json` à mão. SemVer igual ao resto do monorepo.

## i18n e temas

- Strings em `public/_locales/{pt_BR,en}/messages.json`; `default_locale: pt_BR`. Manifest usa
  `__MSG_extName__`; código usa `t('chave')` ou `data-i18n`.
- Nome da marca só em `NAME_APP` (.env) e nas locales — identificadores descrevem o recurso.
- Popup segue `prefers-color-scheme` com override `system|light|dark` salvo em `settings.theme`.

## Publicação na Chrome Web Store

1. `pnpm type-check && pnpm build` (o `check-dist` roda no fim).
2. Zipar o **conteúdo** de `dist/` (`cd dist && zip -r ../extension-<versão>.zip .`).
3. Enviar na listagem nova do CopySync (não reaproveitar a listagem do legado). O `key` do
   manifest garante o mesmo ID da versão carregada sem compactação.
4. Bump de `extension/package.json` + entrada no `CHANGELOG.md` antes de cada envio.

## Pendências

| # | Item | Onde | Bloqueia |
|---|---|---|---|
| 1 | ~~Rota `PUT …/MERCADO_LIVRE/session` na API~~ — feita na API 0.18.0 (T7b) | `docs/integracoes-credenciais-afiliado.md` | — |
| 2 | Smoke test com a extensão carregada (`pnpm dev` → `dist/` em `chrome://extensions`): login, captura, PUT, alarme, troca de tenant, logout | `extension/README.md` | Fechamento da feature |
| 3 | Publicação na Chrome Web Store: nova listagem (a antiga `iiobglifbapgfafnghkcakggkcaddpap` era do "Redirect Flow"); guardar `extension/.keys/extension-private.pem` fora do repositório (cofre) | seção *Publicação* | Distribuição |
| 4 | Expiração da sessão do marketplace: a API precisa sinalizar quando `sessionToken` deixou de funcionar para a extensão forçar nova captura (hoje só renova por alarme) | API + `syncSession.ts` | Confiabilidade do gerador de links |
| 5 | Outros marketplaces (Shopee, Amazon) não têm captura por extensão; só Mercado Livre exige sessão logada | roadmap item 3 | — |
| 6 | Testes unitários (`vitest`) para `apiClient` (tradução de erros, retry de refresh) e `authStore` (fila de escrita, `syncing` velho) — `pnpm test` existe mas não há specs | `extension/src/**/*.test.ts` | Gate do CHANGELOG §36 |
