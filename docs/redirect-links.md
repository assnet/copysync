# Links de redirecionamento da plataforma

Links curtos de marketing e suporte **da plataforma** (suporte, loja, vídeos, Chrome Web Store…),
com destino trocável a qualquer momento e divisão A/B opcional. Desde api 0.67.0 · app 0.85.0.

- Formato público: `https://app.copysync.app/redirect/<slug>` (ex.: `/redirect/chrome-web-store-v5.235.2`).
- Não confundir com o Gestor de Links ([`rodizio-de-links.md`](rodizio-de-links.md)): aquele é do
  tenant, por subdomínio; este é da plataforma, por caminho no painel.

## Quem gerencia

Só o super-admin (`User.isSuperAdmin`), em **Plataforma → Links de redirecionamento**
(`/admin/redirect-links`). Rotas da API com `authHook` + `superAdminHook`, o mesmo guard de
`/admin/ai`, `/admin/link-domains` e `/admin/workers`: quem não é super-admin (inclusive ADMIN de
tenant) recebe **401** `UNAUTHORIZED` e não vê o item no menu (`buildNavigation`).

## Modelo (`redirect_links`)

| Campo | Regra |
|---|---|
| `slug` | único; minúsculas, `[a-z0-9.-]`, 1–100, começa e termina com letra/dígito, sem `..` |
| `urlA` | obrigatório, destino (regras abaixo) |
| `urlB` | opcional; `null` = 100% para A |
| `percentA` | **inteiro 0–100** = % dos acessos para A (CHECK no banco). Sem B é sempre 100 |
| `isActive` | desativado responde 404 (painel mostra "link indisponível"), sem perder cliques |
| `hitsA` / `hitsB` | contadores por lado, `UPDATE … SET "hitsX" = "hitsX" + 1` (atômico, não mexe em `updatedAt`) |
| `note` | opcional, até 500, só aparece no admin |

**Sem `tenantId` de propósito:** o link pertence à plataforma, não a um cliente; o CRUD é só do
super-admin e a resolução pública não tem contexto de tenant. É a mesma situação de `link_domains`.

Percentual inteiro (0–100) e não fração (0–1): é o que o slider mostra, evita float no banco e
cabe num CHECK simples. Ao incluir B sem informar percentual, o padrão é 50.

**Slug editável:** ao trocar o slug, o antigo deixa de responder **na hora** (sem alias nem
histórico). Quem divulgou o endereço antigo verá "link indisponível"; o painel avisa no formulário.
Para mudar só o destino, edite `urlA`/`urlB` e mantenha o slug.

## Regras de destino (`domain/services/redirectLinkRules.ts`, função pura testada)

- só `https://` (recusa `http`, `javascript:`, `data:`, `ftp:`…);
- sem credenciais (`user:pass@` ou `user@`);
- até 2048 caracteres;
- sem loop: em host da plataforma (`app.copysync.app`, `api.copysync.app`, host de `PANEL_URL` e
  subdomínios — `platformHostnames()` do Gestor de Links) recusa caminho `/redirect…` ou que contenha
  `/public/redirects` (também com percent-encoding).

Recusa = 400 `REDIRECT_LINK_INVALID` com `meta.field` (`slug|urlA|urlB|percentA|note`) e
`meta.reason` (`NOT_HTTPS`, `CREDENTIALS`, `LOOP`, `TOO_LONG`, `MALFORMED`, `EMPTY`, `FORMAT`, `RANGE`).
Na saída a API confere de novo (`isSafeRedirectTarget`): destino fora da regra gravado por fora = 404.

## API

Super-admin (`/api/admin/redirect-links`): `GET /`, `POST /` (201), `PATCH /:id` (parcial;
`urlB: null` remove B e volta a 100% A; `note: null` remove), `DELETE /:id` (204; apaga os
contadores juntos). Slug repetido = 409 `REDIRECT_LINK_SLUG_TAKEN`.

Pública, sem auth e fora de tenant (`/api/public/redirects`):

- `GET /:slug` → `{ success: true, data: { url } }` (envelope padrão do projeto);
- `GET /:slug/go` → 302 `Location` (para quem quiser link direto da API).

Sorteio A/B no servidor; o clique do lado sorteado é contado **sem esperar** a escrita (falha do
contador só vira `warn` no log). Inexistente/inativo = 404 `REDIRECT_LINK_NOT_FOUND`, mensagem
`Not found` sem o slug. Slug acima de 100 caracteres = 404 do roteador (`maxParamLength`).
Headers: `Cache-Control: no-store` (cada acesso sorteia e conta; cache esconderia cliques),
`X-Robots-Tag: noindex, nofollow`, `Referrer-Policy: no-referrer`. Rate limit `publicRedirect`
(60/min por IP, store em memória por instância como o global).

**Hook por Host do Gestor de Links:** `app.copysync.app` e `api.copysync.app` são hosts da
plataforma e passam direto, mesmo com `copysync.app` cadastrado como domínio de link (coberto em
`publicRedirect.routes.test.ts`). Subdomínio de link (`promo.copysync.app`) não alcança a rota.

## Como o painel resolve

`/redirect/:slug` está em `AppRoutes` **fora** de `PrivateRoute`/`AppLayout` (sem login, sem menu).
`RedirectPage` mostra a marca e "Redirecionando…", chama `GET /public/redirects/:slug` e faz
`window.location.replace(url)` (a página não fica no histórico). Só segue `https://`; 404 ou destino
fora da regra = "Link indisponível"; erro de rede = "Tentar de novo". Resolve uma vez por slug (o
StrictMode do dev rodaria o efeito duas vezes e contaria 2 cliques).

**Deploy estático (Render):** `render.yaml` já tem `rewrite /* → /index.html`; a Render só aplica o
rewrite quando não existe arquivo no caminho, então `/redirect/<slug>` (inclusive com pontos, ex.
`v5.235.2`) cai no SPA. Nenhuma regra nova. Validado também no Vite local.

## Privacidade

Os dados da tela são da própria plataforma (URLs de suporte/marketing), não de cliente/grupo/produto
de tenant: sem flags de borrar (`privacyFlags.ts`).

## O que não fazer

- Não adicionar `tenantId` nem expor ao tenant: se o cliente precisar de algo assim, é o Gestor de Links.
- Não aceitar `http`, credencial na URL nem destino de volta para `/redirect` (loop).
- Não usar 301 (fica preso no cache do navegador; o destino é editável).
- Não colocar cache na resposta pública nem esperar o contador antes de responder.
- Não interpolar nome de coluna no `incrementHit` (SQL fixo por lado).
- Não criar rota pública nova fora de `/api/public/redirects` para isto.
