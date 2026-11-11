# Página de obrigado pós-compra

URL: **`https://app.copysync.app/obrigado`** (app 0.88.0). Caminho em português de propósito: é o que o
cliente brasileiro vê na barra depois de pagar.

## Onde cadastrar

Na Cakto, em cada oferta (mensal e anual de cada plano): campo **página de obrigado** e o botão
**"Acessar meu produto"**. Mesma URL para todas as ofertas, sem parâmetro.

## O que a página faz

- Rota pública do painel, fora do login e do `AppLayout` (como `/redirect/:slug` e `/invite/:token`):
  `app/src/pages/ThankYouPage.tsx`, textos em `app/src/features/thankYou/strings.ts` (`THANK_YOU_PATH`).
- Diz que a compra foi confirmada e o próximo passo: abrir o e-mail de `CopySync <nao-responda@copysync.app>`,
  clicar em "Definir senha" (link válido por 7 dias, pode levar 1–2 min, olhar Spam/Promoções). Quem já tem
  conta entra normalmente; o plano novo aparece em Configurações → Assinatura.
- Três passos numerados (abrir o e-mail, "Definir senha", entrar), remetente em destaque e atalhos
  "Abrir Gmail"/"Abrir Outlook". "Ir para o login" é secundário (quem acabou de comprar ainda não tem senha).
  Suporte em nova aba por `SUPPORT_CHAT_PATH` (`/redirect/suporte`).
- **Variante "Primeiro acesso"** (app 0.97.0): o link "Meu primeiro acesso" do login navega com router
  state `THANK_YOU_FROM_LOGIN_STATE` (`{ from: 'login' }`). Mesmos passos, cabeçalho sem afirmar pagamento
  recém-confirmado, título "Primeiro acesso · CopySync". Qualquer outro state = variante de compra.
  Ver [`login-apresentacao.md`](login-apresentacao.md).
- `noindex` (meta do `index.html`; a página cria a meta se faltar) e título "Compra confirmada · CopySync".
- Temas sistema/claro/escuro e mobile primeiro (gutter 16 px).

## O que não fazer

- **Não exibir nem ler a query string.** A Cakto pode anexar dados do comprador; a página tira query e hash da
  barra (`navigate(pathname, { replace: true, state })`, preservando o state da variante) e nunca
  mostra os valores. A variante nunca é escolhida por query.
- **Não chamar a API** nem buscar dado do pedido: a página é estática. Status e plano chegam pelo webhook da
  central (ver `arquitetura-central-billing.md`); a senha, pelo convite de primeiro acesso.
- Não mudar o caminho sem trocar a URL em todas as ofertas da Cakto.
- Não usar ícone de brilho/estrela; marca só por `APP_NAME`/`BrandLogo`.

## Relacionados

- Primeiro acesso (`/invite/<token>`, campo `firstAccess`): `arquitetura-central-billing.md`, seção "Primeiro acesso".
- Ofertas e links de pagamento: `planos.md`.
