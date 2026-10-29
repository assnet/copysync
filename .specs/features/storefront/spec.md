# Página de Ofertas — Especificação

Roadmap item 12 (`docs/produto-roadmap.md`, "Site de ofertas", módulo `storefront`, chave
`storefront_enabled`). Termo de produto: **Página de Ofertas**. Nome técnico: `storefront`.
Referência visual: Redirect Flow ("Página de Ofertas", `bio.php`), prints na conversa de 2026-10-29.

## Problema

Afiliado divulga oferta em grupo, mas não tem um endereço fixo para a bio do Instagram/TikTok/WhatsApp
que mostre as melhores ofertas do dia. Hoje ele cola link por link. Uma vitrine própria, num link só,
com o nome dele, converte visita de rede social em clique de afiliado.

## Objetivos

- [ ] Tenant Profissional/Business publica uma vitrine em `<nome>.<domínio de links>` em menos de 5 min
- [ ] Oferta colada vira card (imagem, título, preço) sem digitar nada, com link de afiliado do tenant sempre que a credencial permitir gerar/verificar
- [ ] Starter (ou tenant sem plano) vê o convite de upgrade, nunca a tela

## Fora de escopo (v1)

| Item | Motivo |
| --- | --- |
| Checkout real do nome especial | Hub de billing é 1 assinatura por tenant; add-on não existe. Banner com placeholder + concessão manual pelo super-admin |
| Domínio próprio do cliente | Roadmap item 15 |
| Contagem de cliques por oferta / estatísticas | P3; exige nova rota pública e retenção |
| Mais de uma página por tenant | Não pedido; schema já permite subir depois |
| Oferta vinda do gerador/monitoramento automaticamente | Integração futura; v1 só colar link |
| Tradução da página pública | Painel não tem lib de i18n (padrão `strings.ts`); página pública é pt-BR |

---

## Histórias

### P1: Acesso por plano ⭐ MVP

**Como** tenant, **quero** ver a Página de Ofertas só se meu plano incluir, **para** entender o que ganho no upgrade.

1. WHEN tenant com `storefront_enabled = true` abre `/storefront` THEN painel SHALL mostrar a tela
2. WHEN `storefront_enabled` não é `true` (false ou ausente) (Starter, tenant sem plano) THEN API SHALL responder `403 PLAN_FEATURE_UNAVAILABLE` em toda rota `/storefront/*` e o painel SHALL redirecionar para `/plans?feature=storefront`
3. WHEN `/plans` abre com `feature=storefront` THEN painel SHALL mostrar o aviso "Faça upgrade agora mesmo e acesse a Página de Ofertas, exclusiva dos planos Profissional e Business"
4. WHEN plano perde `storefront_enabled` THEN página pública SHALL sair do ar (status `PAUSED_BY_PLAN`), dados e nome SHALL ser mantidos; WHEN volta THEN SHALL reativar sem ação do tenant

**Teste**: tenant Starter clica no menu (selo "Profissional" no item) e cai em `/plans` com o aviso; Profissional abre a tela.

### P1: Configurar a página (passos 1–4) ⭐ MVP

**Como** tenant, **quero** dar nome, subdomínio, foto, capa, subtítulo, categorias e cores **para** a página ter a minha cara.

1. WHEN tenant sem página abre a tela THEN SHALL ver card "Criar minha Página" com botão Editar
2. WHEN digita subdomínio THEN painel SHALL consultar disponibilidade (debounce 400 ms) e mostrar um estado:
   `AVAILABLE` "Disponível" · `OWNED` "É seu" · `TAKEN` "Em uso, tente outro…" (+ até 5 sugestões) ·
   `RESERVED` "Indisponível" · `PREMIUM` "Comprar" · `INVALID` regra do formato
3. WHEN estado é `PREMIUM` e o tenant não tem concessão THEN painel SHALL abrir banner de compra do nome especial (título, benefícios, preço e link vindos de `features/plans/catalog.ts`, placeholders por ora; sem link → botão "Em breve" desabilitado) e Salvar SHALL ser bloqueado
4. WHEN super-admin concede o nome premium ao tenant THEN o estado SHALL virar `AVAILABLE` para ele e `TAKEN` para os demais após o uso
5. WHEN salva THEN API SHALL validar: nome 2–60, subtítulo ≤ 80, slug pelas regras do rodízio (`slugRules.ts`), cores `#RRGGBB`, categorias ⊂ catálogo fixo (máx. 17)
6. WHEN salva com subdomínio já reivindicado por outro tenant (corrida) THEN API SHALL responder `409 LINK_SLUG_TAKEN` com sugestões, nada gravado
7. WHEN troca o subdomínio THEN nome antigo SHALL ficar reservado ao tenant por 30 dias (mesma regra do rodízio) e o painel SHALL avisar que o link antigo para de funcionar
8. WHEN escolhe subtítulo THEN SHALL ter 4 sugestões prontas clicáveis ou texto livre
9. WHEN envia foto THEN SHALL aceitar JPEG/PNG/WebP ≤ 2 MiB, mínimo 200×200; servidor SHALL recortar quadrado e gravar WebP 320×320
10. WHEN envia capa THEN SHALL aceitar JPEG/PNG/WebP ≤ 4 MiB, mínimo 1200×400; servidor SHALL recortar 3:1 e gravar WebP 1500×500
11. WHEN arquivo foge da regra THEN API SHALL responder `413 MEDIA_TOO_LARGE` / `415 UNSUPPORTED_MEDIA_TYPE` / `422 MEDIA_PROCESSING_FAILED` e o painel SHALL dizer a regra (formato, tamanho, dimensão mínima)
12. WHEN troca ou remove foto/capa THEN arquivo anterior SHALL ser apagado do storage

**Teste**: criar página `minhaloja`, subir foto e capa, salvar, abrir `minhaloja.<domínio>`.

### P1: Preview em tempo real (passo 5) ⭐ MVP

1. WHEN altera qualquer campo (antes de salvar) THEN preview SHALL refletir em ≤ 1 s, renderizado pelo **mesmo** template da página pública
2. WHEN alterna Mobile/Desktop THEN preview SHALL mudar a largura (390 px / 1280 px escalado)
3. WHEN não há oferta publicada THEN preview SHALL mostrar 3 ofertas de exemplo marcadas "Ofertas de exemplo"; a página pública nunca mostra exemplos

### P1: Adicionar oferta (passos 6–7) ⭐ MVP

1. WHEN cola link e clica Extrair THEN API SHALL aceitar só host da allowlist (Shopee, Mercado Livre, Amazon), expandir link curto revalidando cada salto, e criar oferta `DRAFT` com imagem, título, preço e preço "de"
2. WHEN o link não tem referência de produto reconhecida (vitrine/loja) THEN API SHALL responder `OFFER_URL_UNSUPPORTED` e o painel SHALL repetir o aviso "use o link do PRODUTO"; exceção herdada do gerador: ML `meli.la`/`/social/` é aceito e o produto vem do 1º card
3. WHEN o link não é de afiliado do tenant THEN SHALL aplicar a regra do gerador: `OFFER_LINK_NOT_OWNED` / `OFFER_LINK_NOT_AFFILIATE`; ML com cookies gera o link; Amazon sem `?tag=` → `OFFER_LINK_NOT_AFFILIATE` (painel pede link com a tag do tenant)
3a. WHEN Shopee THEN, com credencial (appId + secret), API SHALL gerar o link do tenant via `BuildTenantAffiliateLinkUseCase`; sem credencial SHALL gravar o link colado com `attributionVerified = false` e o painel SHALL mostrar o selo "comissão não verificada" com atalho para credenciais
4. WHEN imagem é obtida THEN SHALL ser baixada (≤ 5 MiB, `image/*`), redimensionada para WebP ≤ 600 px e gravada no storage; falha na imagem não impede o rascunho
5. WHEN escolhe categoria THEN SHALL ser uma das categorias selecionadas na página, ou "Sem categoria"
6. WHEN extrações passam de 60 por hora por tenant THEN API SHALL responder 429
7. WHEN total de ofertas chega a 200 THEN API SHALL responder `409 STOREFRONT_OFFER_LIMIT` (apague antes)

### P1: Rascunhos, publicação e ordem (passos 8–9) ⭐ MVP

1. WHEN abre "Suas Ofertas" THEN SHALL ver abas Rascunhos e Publicadas com contador
2. WHEN publica THEN oferta SHALL ir para o fim das Publicadas e aparecer na página pública (≤ 60 s de cache)
3. WHEN publicadas chegam a 60 THEN publicar SHALL responder `409 STOREFRONT_PUBLISHED_LIMIT`
4. WHEN arrasta THEN nova ordem SHALL ser gravada (lista completa de ids da aba; id estranho ou faltando → 400)
5. WHEN edita THEN pode mudar título (≤ 140), preço, preço "de", categoria; link não muda (apague e cole de novo)
6. WHEN apaga THEN SHALL pedir confirmação, remover a linha e a imagem
7. WHEN despublica THEN volta para Rascunhos

### P1: Página pública e endereço (passo 10) ⭐ MVP

1. WHEN visitante abre `https://<slug>.<domínio>/` de página `ACTIVE` THEN API SHALL responder HTML leve (sem JS) com capa, foto, nome, subtítulo, filtro de categorias e cards publicados na ordem
2. WHEN clica em "Ver oferta" THEN SHALL abrir o link de afiliado (`rel="nofollow sponsored noopener"`, nova aba)
3. WHEN página está `PAUSED_BY_PLAN` THEN SHALL responder 200 página "pausada"; WHEN sem publicadas THEN 200 "em breve"; WHEN tenant não ativo THEN 503 "indisponível"; WHEN não existe THEN 404 (espelha o rodízio, sem vazar dado)
4. WHEN o subdomínio é de um rodízio THEN comportamento do rodízio SHALL ficar idêntico ao atual
5. WHEN tenant clica no endereço no topo THEN painel SHALL copiar a URL e oferecer "abrir"
6. WHEN compartilhado em rede social THEN SHALL ter `og:title`, `og:description`, `og:image` (capa ou foto)

### P2: Nome especial por concessão do super-admin

1. WHEN super-admin cadastra `premiumNames` no domínio (máx. 1000) THEN esses nomes SHALL responder `PREMIUM`
2. WHEN super-admin concede nome a tenant (tela de domínios) THEN SHALL gravar `PremiumSlugGrant` (`source = MANUAL`, validade opcional) e o `AuditLog`
3. WHEN concessão expira THEN página SHALL continuar no nome até o tenant trocar; novo tenant só pega após liberar (job fica para P3)

### P3: Compra automática via hub e cliques

Fora da v1: evento de add-on do hub cria `PremiumSlugGrant(source = BILLING)`; contagem de cliques por oferta.

---

## Casos de borda

- WHEN Host é da API/painel THEN hook SHALL ignorar (regra atual de `PLATFORM_HOSTNAMES`)
- WHEN título/subtítulo contém HTML THEN template SHALL escapar tudo; cores fora de `#RRGGBB` rejeitadas (sem injeção de CSS)
- WHEN imagem armazenada não começa com `S3_PUBLIC_URL` THEN template SHALL cair no fallback (iniciais / sem imagem)
- WHEN tenant é suspenso/cancelado THEN página pública SHALL sair do ar como no rodízio
- WHEN duas abas reordenam ao mesmo tempo THEN última escrita vence; painel recarrega a lista após salvar
- WHEN categoria é removida da página THEN ofertas dela SHALL ficar "Sem categoria"

---

## Rastreabilidade

| ID | História | Status |
| --- | --- | --- |
| STORE-01 | Acesso por plano (gate API + redirect + aviso) | Verified |
| STORE-02 | Pausa/reativação por mudança de plano | Verified |
| STORE-03 | Namespace único de subdomínio com o rodízio | Verified |
| STORE-04 | Disponibilidade com 6 estados + sugestões | Verified |
| STORE-05 | Banner de nome especial (placeholder) | Verified |
| STORE-06 | Salvar configuração (nome, slug, subtítulo, categorias, cores) | Verified |
| STORE-07 | Foto e capa (formato, tamanho, recorte WebP) | Verified |
| STORE-08 | Preview mobile/desktop pelo mesmo template | Verified |
| STORE-09 | Extrair oferta pelo link (allowlist + regra de afiliado do gerador) | Verified |
| STORE-10 | Rascunho → publicada, limites 200/60 | Verified |
| STORE-11 | Ordenar, editar, apagar | Verified |
| STORE-12 | Página pública por Host (HTML sem JS, OG, escape) | Verified |
| STORE-13 | Copiar/abrir endereço | Verified |
| STORE-14 | Nome premium por concessão do super-admin | Verified |
| STORE-15 | Privacidade (borrar) e persistência contra reload | Verified |
| STORE-16 | Documentação, CHANGELOG, versão | Verified |

## Critérios de sucesso

- [ ] Página nova publicada com 3 ofertas em < 5 min (smoke)
- [ ] Rodízio existente segue respondendo igual (testes de `publicLink.routes` verdes sem alteração de expectativa)
- [ ] Página pública < 60 KB HTML+CSS, sem JS, imagens WebP
