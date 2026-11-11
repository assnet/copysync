# Afiliado Shein — Especificação

Status: **implementado em código** (api 0.78.0 · app 0.95.0 · extensão 3.4.0, 2026-11-10). Falta smoke do dono (T16) e deploy. Roadmap: item 3 (credenciais) e tabela "Marketplaces"
de `docs/produto-roadmap.md`. Desenho em `design.md`, tarefas em `tasks.md`.

## Problema

Afiliado Shein não consegue usar o gerador nem o monitoramento: `AffiliateProvider` só tem SHOPEE,
MERCADO_LIVRE e AMAZON, e link Shein capturado vira `unsupported` e é **removido** do texto repostado
(`ProcessPendingCapturedOffersUseCase.ts:163`).

A Shein não tem API de afiliados. O link nasce no servidor dela, numa chamada autenticada pela sessão
do painel `m.shein.com/br/affiliate`.

## O que foi verificado (2026-11-10, conta do dono, do Mac — IP residencial)

| Fato | Evidência |
|---|---|
| "ID de afiliado" = `memberId` da conta | cookie `memberId` (m.shein.com) = corpo `uid` = `m` no payload do token |
| Autenticação = cookie `AT` (httpOnly, m.shein.com, cookie de 30 dias) enviado como header `token` | sem `token` → 403 `100105`; com `token` + `siteuid: mbr`, sem cookie e sem header anti-bot → 200 |
| `POST /br/affiliate/api/goods/recommend/detailNew` devolve nome, preço, preço cheio, desconto, foto, `shareLink` e `shareCode` | resposta real para `goodsId` 533885353 |
| Link `onelink.shein.com/60/<t>` responde 200 HTML com `<input id="url" value="…-p-<goodsId>-cat-N.html?…&url_from=affiliate_koc_<memberId>">`, sem login | curl sem cookie |
| Página de produto sem cookie cai em `/risk/challenge` | curl |

**Sonda na Render (T0, 2026-11-10, Shell do serviço da API):** `detailNew` com `token` + `siteuid: mbr` e
corpo mínimo `{language, playId: 5, goodsId, uid}` → **200 `code: "0"`**; sem token → 403 `100105`;
`onelink` por GET → 200 com `input#url`. Portão passou.

**Verificação com sessão logada (2026-11-10, navegador com o perfil do dono):**
- `AT`: cookie expira exatamente 30 dias após o login (`g`/`l` do payload = hora do login); novo login emite
  token novo. Se o token antigo morre no novo login/logout: não testado.
- Produto inexistente no conversor (`from/url`): HTTP 200 com erro de negócio, tela "Link inválido ou
  código inválido". Coerente com o cliente tratar `code ≠ 0` como "sem link". `detailNew` com id
  inexistente: não testado.
- Foto `img.ltwebstatic.com`: 200 `image/jpeg` do Mac. Da Render: não testado.
- URL só com o id (`br.shein.com/product-p-<id>.html`): **válida** — depois do desafio "Eu sou humano"
  (resolvido à mão pelo dono) abre o produto certo, com o mesmo preço do `detailNew` (R$29,99 / R$50,00).
  A página segue sem ser aberta pelo sistema; a URL é só referência interna.
- Permissão opcional da extensão: não dá para verificar por navegação; segue como spike T9.

**Não verificado**: duração efetiva do `AT` além da validade do cookie; os itens "não testado" acima.

## Termos do programa — decisão do dono pendente ⚠️

Termos de serviço do Programa de Afiliados SHEIN, em vigor desde 2026-05-18 (lidos em
`/affiliate/my-account/personal` → "Termos de serviço"). Trechos que atingem este plano:

- **3.3.2** — "todo e qualquer Afiliado não poderá […] utilizar qualquer sistema, bot ou outro dispositivo
  ou artifício para participar ou receber qualquer benefício do Programa." Sanção: rescisão imediata e
  perda das comissões.
- **Anexo 3, §6 (Comportamentos Proibidos)** — "O Afiliado não deverá e não permitirá que terceiros:
  (ii) utilizar robôs ou outras ferramentas de consulta automatizadas […]; (iv) utilizar qualquer meio
  automatizado ou forma de scraping, ou outros métodos de extração de dados para acessar, consultar,
  coletar ou usar a propriedade intelectual da SHEIN […] e outras informações confidenciais do(s) site(s)."
- **2.1** — "O Programa está acessível apenas por meio de dispositivos móveis (aplicativo ou site SHEIN)."
- **1.1** — permitido: compartilhar links/códigos em "sites de cupons, grupos de mídia social".
  Links devem usar o formato fornecido pela SHEIN.

Leitura: publicar o link em grupos é permitido; **gerar o link por servidor com a sessão do afiliado e
ler dados de produto por chamada automatizada cai no texto das proibições**. O risco é do tenant (conta
de afiliado encerrada, comissões perdidas), não só da plataforma. Isso não é parecer jurídico.

**Decisão do dono (2026-11-10): seguir, com o risco assumido pelo tenant.** O painel avisa, antes de
conectar e de forma permanente no card, que os termos da SHEIN proíbem ferramentas automatizadas, que a
SHEIN pode encerrar a conta de afiliado e reter comissões, e que a responsabilidade pelo uso é do
tenant. Conectar exige aceite explícito desse aviso; cada aceite fica gravado por tenant com data e
hora, usuário e versão do texto (SHEIN-18…20).

## Alternativas avaliadas

| Alternativa | Veredito | Por quê |
|---|---|---|
| A. API oficial ou rede de afiliados (Awin etc.) | ❌ | Não existe para o programa BR |
| B. Link montado só com o ID (`?url_from=affiliate_koc_<id>`), padrão Amazon | ❌ v1 | Atribuição sem o `onelink` registrado não foi provada; errar = afiliado sem comissão e sem aviso |
| C. Extensão chama o conversor dentro da página Shein | ❌ | Só funciona com navegador aberto; monitoramento 24/7 para |
| D. Usuário cola o token `AT` no painel | ❌ | Cookie httpOnly: exige DevTools |
| E. Extensão captura `AT` + `memberId`, API guarda cifrado, servidor chama a Shein (este plano) | ✅ | Mesmo padrão do Mercado Livre; funciona sem navegador; uma chamada dá link + dados |
| F. Ler dados do produto pela página (scraping, API paga, Chrome no worker) | ❌ | `detailNew` já entrega os dados com a mesma sessão |

Decisão: **E**. Se a T0 falhar na Render, o plano para e volta para decisão (C vira a opção restante).

## Objetivos

1. Shein como 4º marketplace no gerador, monitoramento, vitrine e story, pelo caminho único de sempre.
2. Conectar a conta Shein sem digitar nada: a extensão captura sessão e ID.
3. Só plano MAX no lançamento; super admin libera para outro plano sem deploy.

## Fora de escopo (v1)

- Shein de outros países (só `br.shein.com` e `m.shein.com/br/`).
- Código de indicação (`shareCode`) na oferta, códigos de campanha, vitrine de produtos da Shein.
- Captura do StoreID da Amazon pela extensão (fase F6, opcional, com spike próprio).
- Link montado sem sessão (alternativa B).
- Tela genérica de edição de todos os entitlements: v1 edita só chaves de marketplace.

## Histórias

### P1: Acesso por plano ⭐ MVP

- **SHEIN-01** Chave `marketplace_shein_enabled`: só `true` libera; ausente/false bloqueia. Preset LITE
  false, PRO false, MAX true.
- **SHEIN-02** Sem a chave: gerador/vitrine/story recusam link Shein com `PLAN_FEATURE_UNAVAILABLE`;
  sync de sessão e conexão respondem 403; monitoramento pula a captura com motivo próprio
  (`MARKETPLACE_PLAN_UNAVAILABLE`), sem remover o link em silêncio.
- **SHEIN-03** Painel mostra o card Shein travado com selo dos planos que têm o recurso (lista vinda da
  API, não fixa) e leva a `/plans`.

### P1: Conectar a conta ⭐ MVP

- **SHEIN-04** Extensão, com consentimento explícito para a Shein, envia `AT` + `memberId`; API grava
  a sessão cifrada (`ISecretCipher`, AAD `tenantId:SHEIN:session`) e o `memberId` como
  `publicIdentifier`. Para a Shein o ID **sempre** segue a sessão (não é editável no painel).
- **SHEIN-05** Logout/troca de conta na Shein é detectado pela extensão (`cookies.onChanged`) e
  ressincroniza; sessão recusada pela Shein **no monitoramento** marca a credencial `rejected` e pausa
  a loja, como nos outros marketplaces (gerador/vitrine/story só devolvem o erro, igual ao ML hoje).
- **SHEIN-06** Desconectar no painel revoga o consentimento e apaga a credencial (sessão e ID). Extensão
  re-vinculada a outro tenant perde o consentimento Shein.
- **SHEIN-07** Extensão antiga (sem capacidade `shein.session`): painel pede para atualizar.
- **SHEIN-08** Token nunca volta em resposta, log ou canal da extensão.

### P1: Aviso de risco e aceite ⭐ MVP

- **SHEIN-18** O card Shein mostra o aviso de risco em todo estado com plano liberado (da instalação da
  extensão até conectado); o texto completo abre antes de "Conectar Shein", com caixa de aceite desmarcada por padrão.
- **SHEIN-19** Sem aceite da **versão vigente** do aviso nada chama a Shein em nome do tenant:
  consentimento e sync respondem 403 (`MARKETPLACE_RISK_NOT_ACCEPTED`); com conta já conectada, gerador,
  vitrine e story recusam link Shein com o mesmo erro e o monitoramento pula a captura com motivo
  `MARKETPLACE_RISK_NOT_ACCEPTED`, avisando no painel. Texto do aviso muda → versão muda → novo aceite.
  Só **administrador do tenant** aceita; operador vê o aviso e não consegue aceitar; super admin não
  aceita em nome de tenant.
- **SHEIN-20** Cada aceite grava, por tenant: marketplace, versão do aviso, usuário que aceitou, idioma em que
  o texto foi exibido e data e hora do servidor (UTC). O registro é a **declaração** do usuário de que
  leu e aceitou; o servidor não prova a exibição. Registro é só de inclusão: desconectar, trocar de plano ou reconectar não
  apaga nem altera aceites anteriores. Super admin consulta os aceites por tenant.

### P1: Gerador ⭐ MVP

- **SHEIN-09** Link de produto Shein BR ou `onelink` colado → oferta com título, preço, preço cheio e
  foto vindos do `detailNew`.
- **SHEIN-10** (**Substituído** na api 0.81.0 por [`.specs/features/tenant-affiliate-link/spec.md`](../tenant-affiliate-link/spec.md): todo link que não é o `onelink` já do tenant é recriado; sem `OfferLinkNotOwnedError`.) Link sem afiliação → link do tenant gerado pela sessão. Link já do tenant
  (`url_from=affiliate_koc_<memberId>`) → mantido. Link de outro afiliado → `OfferLinkNotOwnedError`.
- **SHEIN-11** (**Substituído** na api 0.81.0 por [`.specs/features/tenant-affiliate-link/spec.md`](../tenant-affiliate-link/spec.md): sem conta → `AFFILIATE_CREDENTIAL_REQUIRED`.) Sem conta Shein conectada (plano liberado): link que já traz afiliação segue **sem
  conferência de dono** e sem dados do produto — regra atual dos outros marketplaces sem credencial
  (gerador e vitrine: preenchimento manual; story recusa com `OFFER_STORY_PRODUCT_INCOMPLETE`). Link sem
  afiliação é recusado com `OFFER_LINK_NOT_AFFILIATE` (422).

### P1: Monitoramento ⭐ MVP

- **SHEIN-12** Link Shein capturado (produto ou `onelink` de terceiro) → link do tenant; nada da URL
  de origem sobrevive além do id do produto.
- **SHEIN-13** Dados do produto vêm na mesma chamada (campo `product` do resultado), sem ler página.
- **SHEIN-14** Sem credencial / recusada / sem plano / conta conectada sem aceite vigente: captura
  `SKIPPED` com o motivo certo.

### P2: Liberação por plano pelo super admin

- **SHEIN-15** Super admin liga/desliga `marketplace_shein_enabled` por plano; vale na hora para os
  tenants do plano e para os próximos eventos de billing. Auditado.
- **SHEIN-16** Só chaves de uma allowlist são editáveis por essa rota.

### P3: StoreID da Amazon pela extensão (opcional)

- **SHEIN-17** Extensão lê o StoreID em `associados.amazon.com.br` e preenche a tag **só se vazia**.
  Depende de spike (F6).

## Critérios de pronto

- `tsc --noEmit` limpo em `api/`, `app/` e `extension/`; testes dos pacotes tocados verdes.
- Teste de trava: `marketplace_shein_enabled` ausente/false bloqueia nos 4 pontos (SHEIN-02).
- Teste do aceite: sem aceite da versão vigente → 403 em consentimento e sync; com conta
  conectada, 403 no gerador e captura `SKIPPED/MARKETPLACE_RISK_NOT_ACCEPTED` com alerta no monitoramento; operador e super admin não aceitam; aceite grava uma linha
  com tenant, usuário, versão e hora; versão nova exige aceite novo; desconectar não apaga (SHEIN-19/20).
- Teste do cliente Shein com respostas gravadas (sem token): 200 ok, 403 → rejeitada, `code ≠ 0`.
- Teste de `onelink` (HTML → URL do produto, host fora da allowlist recusado, corpo acima do teto).
- Migration validada em Postgres descartável (nunca local contra `api/.env`).
- Smoke manual do dono: conectar → gerar oferta → captura de grupo com link Shein de terceiro.
- i18n, claro/escuro, flags de privacidade (ID de afiliado) e `usePersistedState` conferidos.
- `docs/afiliado-shein.md`, `AGENTS.md`, roadmap, `CHANGELOG.md` e versões atualizados.
