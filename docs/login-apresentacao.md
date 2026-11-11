# Login: compra, primeiro acesso, vídeo e botão de suporte

Desde app 0.97.0. Tudo no painel (`app/`), sem API nova.

## O que existe

| Recurso | Onde | Destino |
|---|---|---|
| "Comprar agora" (bloco "Ainda não é cliente?") | `pages/LoginPage.tsx` | `BUY_NOW_PATH` = `/redirect/comprar-login`, nova aba |
| "Meu primeiro acesso" (link discreto abaixo do Entrar) | `pages/LoginPage.tsx` | `/obrigado` com state `THANK_YOU_FROM_LOGIN_STATE` |
| Vídeo de apresentação | `pages/login/LoginIntroVideo.tsx` | YouTube `INTRO_VIDEO_ID`, player em Dialog |
| Botão flutuante de suporte (WhatsApp) | `features/supportChat/`, montado em `app/App.tsx` | `SUPPORT_CHAT_PATH` = `/redirect/suporte`, nova aba |

Caminhos e id do vídeo: `features/platformLinks/links.ts`. Textos: `pages/login/loginContent.ts`
(`LOGIN_COPY`), `features/supportChat/strings.ts`, `features/thankYou/strings.ts`.

## Links de redirecionamento

Compra e suporte passam por `/redirect/<slug>` ([`redirect-links.md`](redirect-links.md)): o super-admin
troca o destino e vê os cliques em Plataforma → Links de redirecionamento. Os slugs `comprar-login` e
`suporte` precisam existir e estar ativos; sem eles o visitante vê "Link indisponível". Para medir
outra origem de compra, criar outro slug (ex.: `comprar-<origem>`), não reaproveitar este.

## Vídeo

- Fachada: só a capa (`i.ytimg.com`, `maxresdefault` com queda para `hqdefault`) até o clique. O iframe
  (`www.youtube-nocookie.com`) é montado no clique e desmontado ao fechar. Nenhum script do YouTube.
- Desktop (lg+): card ao lado dos passos no painel de apresentação. Mobile: linha compacta na faixa
  superior, para o formulário continuar aparecendo cedo. Player sempre em Dialog 16:9.
- CSP (`render.yaml`): `frame-src https://www.youtube-nocookie.com`. O YouTube exige referrer; o painel
  usa `strict-origin-when-cross-origin` (não trocar por `no-referrer`, o player dá erro 153).
- Trocar o vídeo = trocar `INTRO_VIDEO_ID`.

## Botão de suporte

- Sem auth e sem API: aparece logado e deslogado. `z-index` = `theme.zIndex.speedDial` (abaixo de
  Dialog, Drawer e Snackbar).
- `features/supportChat/routes.ts`: `SUPPORT_CHAT_HIDDEN_PATHS` (`/redirect`, `/chat`, `/admin/workers/settings`:
  "Revisar e salvar" no fim do formulário, não sticky; subir só cobriria campo/slider) e
  `SUPPORT_CHAT_RAISED_PATHS` (`/monitoring`, por causa da barra "Salvar"; `/offer-story`, por causa do
  "Continuar" preso ao rodapé no celular).
- Tela nova com ação fixa no canto inferior direito entra em uma dessas listas.
- Página pública nova: deixar ~88 px livres no fim (xs) para o botão não cobrir o rodapé.

## O que não fazer

- Não apontar "Comprar agora" direto para a página de vendas (perde a contagem de cliques).
- Não carregar a API de iframe/script do YouTube nem montar o iframe antes do clique.
- Não fazer o botão de suporte depender de `AuthContext` ou de chamada à API.
- Não ler query string em `/obrigado` para escolher a variante: só o router state
  ([`pagina-obrigado.md`](pagina-obrigado.md)).
- Sem ícone de brilho/estrela; marca só por `APP_NAME`/`BrandLogo`.
