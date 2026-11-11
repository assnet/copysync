# Credenciais de afiliado

Por tenant, guarda a credencial de cada marketplace (Shopee, Mercado Livre, Amazon e Shein) para o
Gerador de ofertas trocar o link do concorrente pelo do cliente. Spec, design e tasks ficam em
`.specs/features/affiliate-credentials/`. Item 3 do roadmap.

## Onde está

| Camada | Caminho |
| --- | --- |
| Domínio | `api/src/modules/integrations/domain/` (entidade, enums, contrato do repositório, `maskIdentifier`, `affiliateProviderFields`) |
| Use cases | `api/src/modules/integrations/application/use-cases/` |
| Prisma | `api/src/modules/integrations/infrastructure/` · tabela `affiliate_credentials` · migration `add_affiliate_credentials` |
| HTTP | `api/src/modules/integrations/presentation/` |
| Cifra | `api/src/shared/security/` (`ISecretCipher`, `AesGcmSecretCipher`, `SecretCipherFactory`) |
| Painel | `app/src/features/settings/` (card, resumo de progresso `AffiliateConnectionSummary`, `MarketplaceLogo`, diálogo, hook, `strings.ts`, `affiliateProviders.ts`; logos em `app/public/assets/marketplaces/`, licenças no `LICENSE.md` da pasta) · `app/src/pages/settings/AffiliateCredentialsPage.tsx` (no celular os cards de marketplace viram carrossel por deslize via `SwipeCards`, indicador configurado/pendente) · rota `/affiliates/credentials` (item do produto Afiliados; `/settings/affiliate-credentials` redireciona e mantém a query) |
| Extensão | `extension/` sincroniza a sessão do Mercado Livre e da Shein (`docs/extensao-navegador.md`) |

## Campos por marketplace

Nenhum programa publica um formato oficial. Por isso as regras de validação são permissivas: o
objetivo é não recusar um valor real. Foram verificadas em 2026-10-22. O domínio é a fonte de
verdade e o painel só repete as regras, para dar retorno ao operador.

| Marketplace | Campo público | Regex | Segredo |
| --- | --- | --- | --- |
| Shopee (Affiliate Open API) | AppID | `^\d{5,20}$` | Secret `^[A-Za-z0-9]{16,128}$` (assina `sha256(appId+timestamp+payload+secret)`) |
| Mercado Livre | Etiqueta de afiliado principal (`matt_word` no link); outras etiquetas da conta podem ser vinculadas até o limite do plano ([Várias etiquetas](#várias-etiquetas-do-mercado-livre)) | `^[A-Za-z0-9._-]{2,64}$` (vale também para cada item da lista da conta) | — (a sessão vem da extensão) |
| Amazon Associados | ID de rastreamento (`?tag=`) | `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}-\d{2}$` | — |
| Shein | ID de afiliado (`memberId`, `url_from=affiliate_koc_<id>`) | `^\d{6,15}$` | — (a sessão vem da extensão; o ID **segue a sessão**, não é editável) |

Assim que houver valores reais do cliente, confira as regras com eles antes de restringi-las.

### Diálogo de configuração (Shopee e Amazon)

`AffiliateCredentialDialog` é um só para os marketplaces com campo digitado (o Mercado Livre usa
`BrowserSessionCredentialDialog`). Cabeçalho com logo e faixa da marca (`brandColor`, só acento),
guia "Onde encontrar" com passos (`strings.ts` → `guideSteps`) e botão para o painel oficial
(`spec.setup.url`, nova aba), sinal de formato válido no campo, prévia do link quando o spec tem
`linkPreview` (Amazon) e nota de segurança (`dialogNote`). Marketplace novo: preencher `setup`,
`guideSteps`, `dialogSubtitle` e `dialogNote`; sem eles o diálogo só mostra os campos.
Sem `usePersistedState`: o Secret nunca vai para o storage.

## Rotas

Prefixo `/api/integrations/affiliate-credentials`, com `authHook` e `tenantHook` (exige o header
`X-Tenant-Id`). As respostas usam o envelope `{ success, data }`.

| Método | Path | Faz |
| --- | --- | --- |
| GET | `/` | Lista mascarada. Não usa a cifra |
| PUT | `/:provider` | `{ publicIdentifier, secret? }`. Um `secret` vazio mantém o atual. 422 quando falta o secret da Shopee nova ou quando se envia secret a um provider que não tem esse campo |
| DELETE | `/:provider` | 204, ou 404 se não existe. Apaga junto a sessão da extensão |
| PATCH | `/:provider/status` | `{ status: ACTIVE \| INACTIVE }` |
| PUT | `/:provider/session` | Usada só pela extensão e só para `MERCADO_LIVRE`. Recebe `{ sessionToken, csrfToken, affiliateTag?, capturedAt }` |
| GET | `/:provider/identifiers` | `{ account, primary, linked, limit, used }`: etiquetas da conta, principal, vinculadas e limite do plano. Só provider com lista da conta (hoje `MERCADO_LIVRE`); outro → 422 `AFFILIATE_CREDENTIAL_INVALID` |
| PUT | `/:provider/identifiers` | `{ primary, linked }`: escolhe a principal e as vinculadas entre as etiquetas da conta. Acima do limite → 403 `PLAN_LIMIT_REACHED` (`meta.key = mercado_livre_affiliate_tags`) |
| POST | `/:provider/risk-acceptance` | `{ noticeVersion, locale }`. Aceite do aviso de risco (hoje só `SHEIN`), só administrador do tenant. Ver [`afiliado-shein.md`](afiliado-shein.md) |

A listagem (`GET /`) traz também `marketplaceAvailability` por provider: `{ enabled, plans, riskNotice }` (plano do tenant, planos que têm o recurso, aceite da versão vigente do aviso).
Cada item traz ainda `accountIdentifiers`, `linkedIdentifiers` e `identifierLimit` (este só para provider com lista da
conta; `null` nos demais).

Erros possíveis:

- `AFFILIATE_CREDENTIAL_INVALID` (422): vem com `meta.field`, e o diálogo marca o campo indicado.
- `AFFILIATE_CREDENTIAL_NOT_FOUND` (404).
- `SECRET_CIPHER_UNAVAILABLE` (503).
- `SECRET_CIPHER_FAILED` (500).

Quando a API precisa da credencial em claro, ela chama o `ResolveAffiliateCredentialUseCase`, que
não tem rota HTTP. É o único ponto que devolve o segredo decifrado. Credenciais `INACTIVE` e linhas
sem ID público são ignoradas.

## Cifra

- Algoritmo AES-256-GCM, com iv de 12 bytes e tag de 16. A implementação usa o `crypto` do Node,
  sem biblioteca externa.
- O AAD é `tenantId:provider:secret|session`. Um blob copiado para outra linha ou coluna não decifra.
- A chave fica em `CREDENTIALS_ENCRYPTION_KEY` e precisa ter 32 bytes em base64. Para gerar:
  `openssl rand -base64 32`.
- Se a chave estiver ausente ou com tamanho errado, a API sobe normalmente e registra
  `logger.error` no boot. Nessa situação, só as gravações que cifram respondem 503: o PUT com
  secret e o PUT de sessão. O GET, o DELETE, o PATCH e o PUT de ML ou Amazon sem secret continuam
  funcionando. Nada é gravado em claro.
- Para desenvolvimento local, a chave vai em `api/.env.local`, que fica fora do git e é carregado
  pelo `env.ts` com `process.loadEnvFile`. Ela **não** vai em `api/.env.dev`, que é versionado,
  nem em `api/.env`.
- Em produção, a variável é criada à mão no dashboard da Render **antes** do deploy. O
  `render.yaml` não declara a API.
- Rotação de chave: cada blob guarda sua versão (`keyVersion` e `sessionKeyVersion`). Por enquanto
  só existe a versão 1. Uma chore futura vai criar o mapa de chaves por versão e um script que
  cifra de novo os dados existentes. **Trocar a chave sem esse script inutiliza todos os segredos
  gravados.**

## Shein: ID segue a sessão

Para provider com `providerIdentifierFollowsSession` (hoje só `SHEIN`) o `publicIdentifier` é o `memberId` lido do
próprio token `AT` no sync da extensão e **substitui** o anterior (`publicIdentifierOverride` no create e no update
do upsert). Por isso as rotas genéricas recusam SHEIN:

- `PUT /:provider` (manual) e `PUT /:provider/session` → 422 `AFFILIATE_CREDENTIAL_INVALID`: sessão Shein só entra
  por `PUT /api/extension/marketplaces/shein/session`, que exige consentimento, plano e aceite do aviso.
- `DELETE /:provider` → 409 `USE_MARKETPLACE_DISCONNECT`: apagar sem revogar o consentimento deixaria o próximo sync
  recriar a credencial. Desconectar pela extensão: `DELETE /api/extension/marketplaces/shein/session` (revoga e apaga
  a credencial inteira; 204 mesmo sem credencial). O painel usa essa rota no botão e na lixeira do card.
- `PATCH /:provider/status` segue genérico.

O cookie que identifica troca de token é por provider (`MERCADO_LIVRE: 'ssid'`, `SHEIN: 'AT'`): mesmo `AT` em sync
repetido não zera recusa nem audita de novo. O sync da Shein não checa a sessão na loja (v1): recusa aparece no uso.
Tudo da Shein: [`afiliado-shein.md`](afiliado-shein.md).

## Sessão da extensão (Mercado Livre)

- A sessão é gravada com o relógio do servidor (`sessionSyncedAt`). O `capturedAt` vai só para a
  auditoria.
- Se a `affiliateTag` vier inválida, ela é descartada e a sessão é gravada mesmo assim
  (`tagIgnored` na auditoria).
- A tag só preenche um ID que esteja vazio, numa condição atômica no `WHERE`. O valor do painel
  sempre vence.
- A auditoria `AFFILIATE_SESSION_SYNCED` só é gravada quando o token muda. O alarme de 30 minutos
  não enche `audit_logs`.
- Se o blob atual não decifra, a sessão é gravada por cima, auditada e registra um `warn`. Nunca
  responde 500 em loop.
- O sync (`PUT /extension/marketplaces/ml/session`) lê `listAccountTags` (no lugar de `getActiveTag`): a etiqueta
  `in_use` alimenta `affiliateTag` e o `sessionCheck`; a lista inteira vai como `accountIdentifiers` ao
  `UpsertAffiliateSessionUseCase`, que grava a lista da conta e poda as vinculadas que saíram dela (seção abaixo).
- `DELETE /extension/marketplaces/ml/session` (`clearSession`) zera junto `accountIdentifiers` e `linkedIdentifiers`.

### Geração automática de links (F4)

A sessão sincronizada pela extensão também é consumida por `MercadoLivreAffiliateClient`
(`campaigns/infrastructure/http/`) para gerar links de afiliado automaticamente quando o operador
cola uma URL de produto ML sem `matt_word`. Detalhes em
[`gerador-de-ofertas.md`](gerador-de-ofertas.md) (seção "Geração automática de link ML").

## Várias etiquetas do Mercado Livre

Uma conta de afiliado do ML pode ter várias etiquetas (`matt_word`), uma só `in_use`. O tenant vincula as que quer usar
como suas, até o limite do plano. Spec/design: `.specs/features/tenant-affiliate-link/` (TLINK-28..39, fase FE).
Formato real do ML: [`extensao-ml-endpoints.md`](extensao-ml-endpoints.md) §4.

**Dados** (`affiliate_credentials`, migration `20261111130000_add_affiliate_account_identifiers_and_ml_tags_entitlement`):

| Coluna | Conteúdo |
| --- | --- |
| `publicIdentifier` | Etiqueta **principal** (preenchida pelo sync só se vazia, ou escolhida na tela; o sync só a troca se ela sumiu da conta) |
| `accountIdentifiers String[]` | Etiquetas da conta vistas na última sincronização |
| `linkedIdentifiers String[]` | Vinculadas **além** da principal, em ordem |

**De onde vem a lista**: só da sincronização da extensão (`listAccountTags` → `GET /stripe/user/tags`). Cada item passa
por `validatePublicIdentifier` (inválido descartado, repetido sem caixa descartado). Lista nula (leitura falhou) ou
vazia depois da validação **não toca** nas colunas. Com lista lida: substitui `accountIdentifiers` e remove de
`linkedIdentifiers` o que não está mais na conta. Etiqueta criada no ML depois do último sync só aparece no próximo
(alarme da extensão, ou botão de sincronizar na tela).

**Limite por plano**: chave `mercado_livre_affiliate_tags` (LITE 1, PRO 2, MAX 10; **principal incluída**). Ausente ou
`null` vale **1** (não é ilimitado), via `identifierLimitOf` (`tenants/domain/services/affiliateIdentifierLimit.ts`),
único ponto de leitura. Chave por provider em `integrations/domain/services/affiliateIdentifierEntitlement.ts`.

**Conjunto efetivo** = principal + primeiras `limite − 1` vinculadas (`effectiveLinkedIdentifiers`, função pura).
Rebaixamento não apaga nada: o excedente só deixa de valer e volta se o plano subir. A tela de Assinatura mostra o uso
(`used` = tamanho do conjunto efetivo) × limite.

**Desconexão e troca de conta**: `clearSession` zera as duas colunas. Troca de conta sem desconectar não tem detecção
própria: o próximo sync lido substitui a lista e poda as vinculadas da conta antiga. Se a principal também não está na
lista nova (sem caixa), ela passa a ser a etiqueta em uso informada pelo sync (`affiliateTag`, na grafia da conta) ou
`null` se essa não estiver na lista — mesma transação da poda. Principal que está na lista nunca muda pelo sync. Mudança
de token não zera nada.

**CAS no vínculo**: `setIdentifiers` só grava se `accountIdentifiers` ainda contém a principal e as vinculadas (`hasEvery`,
grafia exata da conta, que o use case já normalizou). Sync no meio trocou a lista → 422 `AFFILIATE_CREDENTIAL_INVALID`
(`meta.field = linked`), nada gravado.

**Rotas**: `GET|PUT /api/integrations/affiliate-credentials/:provider/identifiers` (tabela de rotas acima). O PUT exige
tudo ∈ `accountIdentifiers`, sem repetição, `1 + linked ≤ limite`; audita `AFFILIATE_CREDENTIAL_UPSERTED` com
`meta { provider, identifiersChanged: true }`, **sem** as etiquetas.

**Uso no link colado** (`ResolveAffiliateProductUseCase`; gerador, Página de Ofertas e Story herdam):

| `matt_word` do link | Resultado |
| --- | --- |
| No conjunto efetivo | Aceito como do tenant (`verified`), com a etiqueta do próprio link |
| Da conta, não vinculada, com vaga | 422 `AFFILIATE_IDENTIFIER_NOT_LINKED` (`meta { provider, limit, used }`): painel leva às credenciais |
| Da conta, não vinculada, sem vaga (sempre no LITE) | 403 `PLAN_LIMIT_REACHED` (`meta.key = mercado_livre_affiliate_tags`): painel lista PRO e MAX |
| De terceiro | Como antes (`OFFER_LINK_NOT_OWNED`) |

Monitoramento, vitrine pública e links gerados pelo sistema seguem usando só a **principal** (TLINK-35).

**Painel** (`app/src/features/settings/`): a fonte das etiquetas é a API (a etiqueta exibida pela extensão sai). O diálogo
do ML (`BrowserSessionCredentialDialog`, recebe o `item`) lista as etiquetas da conta, escolha da principal e das
vinculadas, contador "x de y", item além do limite indisponível com botão para os planos, e pede escolha quando a
principal está vazia e a conta tem etiquetas. O card mostra quantas estão vinculadas. Flag de privacidade
`affiliateCredentials.accountIdentifiers` + `Blurred`; rascunho em `usePersistedState`, limpo ao salvar.

**O que não fazer**:

- Não atualizar a lista da conta na hora da geração (nem chamar o ML para isso): a lista vem só do sync.
- Não trocar a principal sozinho: só o tenant troca, pela tela. **Única exceção**: o sync troca quando ela deixou de
  existir na conta (troca de conta) — vira a em uso, se estiver na lista, ou `null`, e a tela pede nova escolha.
- Não confiar em erro do ML para validar etiqueta: `createLink` com etiqueta fora da conta responde 200 e usa a
  `in_use` em silêncio. A validação é `∈ accountIdentifiers`.
- Não pôr etiqueta em `meta` de erro, auditoria ou log.
- Não tratar chave ausente como ilimitada, nem ler a chave fora de `identifierLimitOf`.
- Não apagar vinculadas no rebaixamento.

## Credencial recusada pela loja (`rejectedAt` / `rejectedCode`)

Quando o monitoramento usa a credencial e a loja responde 401/403 (`AFFILIATE_CREDENTIAL_REJECTED`), o
`BuildTenantAffiliateLinkUseCase` chama `MarkAffiliateCredentialRejectedUseCase`: grava `rejectedAt` + `rejectedCode`
e audita `AFFILIATE_CREDENTIAL_REJECTED` (só `provider` e `code`). A partir daí `resolveState` devolve `rejected`
(vale para ACTIVE, INACTIVE e linha só-sessão) e o monitoramento pausa a loja: capturas saem
`SKIPPED/CREDENTIAL_REJECTED` sem rede. O gerador segue usando `execute` (não muda).

Quem limpa: `UpsertAffiliateCredentialUseCase` quando o que foi recusado muda (secret novo ou ID público diferente;
ML pelo painel só troca etiqueta e **não** limpa); `UpsertAffiliateSessionUseCase` conforme a checagem do sync (abaixo);
`clearSession` zera junto. `setStatus` (reativar) **não** limpa. Rate limit e API fora
não marcam rejeição. O presenter expõe `rejectedAt`/`rejectedCode`; o card mostra "Recusada" com a dica da loja.

### Checagem da sessão no sync (`sessionCheck`)

O `PUT /extension/marketplaces/ml/session` já chama `listAccountTags` (antes `getActiveTag`, que hoje delega a ela), que faz o bootstrap no ML com os cookies
recebidos. O resultado vira `sessionCheck` do `UpsertAffiliateSessionUseCase`:

| Bootstrap no ML | `sessionCheck` | Rejeição |
|---|---|---|
| passou (com ou sem etiqueta) | `VALID` | limpa, **mesmo com o mesmo token** |
| 401/403 ou redirect para login | `REJECTED` | grava `AFFILIATE_CREDENTIAL_REJECTED` e audita; se já recusada, mantém a data original |
| fora do ar, timeout, rate limit | ausente | só token novo limpa (regra antiga) |

Por quê: o navegador pode seguir logado com o **mesmo** `ssid` que a loja recusou pelo servidor. Com a regra
antiga (só token novo limpa), sincronizar não tirava o "Recusada" nunca; o usuário precisava apagar a credencial.
A resposta do PUT traz `sessionRejected`; o painel lê `rejectedAt` da credencial após o sync e mostra
`errors.mlSessionRejected`.

Mensagens do painel (`features/extension/strings.ts`): cada `SyncErrorCode` da extensão tem a sua.
Só `ml_not_logged` fala em login no ML; falha desconhecida vira `syncFailed` (servidor). Se a extensão desistir
(timeout) mas o `sessionSyncedAt` já for posterior ao clique (relógio `serverNow()`), o painel trata como sucesso.

Testes com banco: `api/scripts/postgres-descartavel.sh start` → `INTEGRATION_DATABASE_URL=… pnpm -C api test:int`
(`*.int.test.ts`, fora do `pnpm test` e do CI; gate manual de release) → `stop`.
Testes só-Redis (`*.redis.int.test.ts`, projeto `redis`, sem banco): ver [arquitetura-escala](arquitetura-escala.md) §6.

## O que não fazer

- Nunca devolver o segredo ou a sessão por HTTP, nem acrescentar esses campos ao schema
  `AffiliateCredentialItem`.
- Nunca logar o body dessas rotas, nem pôr valor de chave ou token em `meta` de auditoria ou de erro.
- Nunca gravar em claro como fallback quando a cifra estiver indisponível.
- Não cifrar o `publicIdentifier`. Ele aparece na URL gerada, e cifrá-lo impediria buscas.
- Não acessar Prisma fora de `infrastructure/`, e não criar consulta sem `tenantId`.
- Nunca gravar em `rejectedCode` (nem na auditoria) corpo da resposta da loja, cookie ou chave: só o código interno.
- Não limpar a rejeição ao reativar (`setStatus`), nem em sync do mesmo token **sem** checagem `VALID` da loja.
- Não aceitar ID da Shein digitado nem apagar credencial Shein pelo `DELETE` genérico.
- Não remover Mercado Livre pela lixeira só com o `DELETE` genérico: o consentimento da extensão fica e o próximo sync
  recria a credencial (visto em produção: removida 20:41, recriada 20:43). Nem só com
  `DELETE /api/extension/marketplaces/ml/session`: essa rota revoga o consentimento e limpa a sessão, mas **mantém a
  linha** (etiqueta), e o card voltaria. O painel (app 0.96.2) faz os dois, nessa ordem (`remove(provider, beforeRemove)`
  em `useAffiliateCredentials`), para provider com `usesBrowserSession` + `extensionMarketplace`.
- Não reaproveitar `syncFailed` para "verifique o login": a extensão já informa se há login (`ml.status`); culpar o
  login em erro de servidor faz o usuário refazer um login que está certo.

## Smoke (T8, executado em 2026-10-22, banco local)

Feito com a API compilada (`node --env-file=.env.dev dist/app/server.js`). **Hoje não repetir**: `api/.env.dev`
tem `DATABASE_URL` de produção; usar env sintético apontando para `api/scripts/postgres-descartavel.sh`. O `pnpm dev` não subiu
por causa de um problema que já existia no `tsx` com `whatsapp-rust-bridge`, dependência do Baileys.

1. `GET /` devolveu `items: []`.
2. `PUT /SHOPEE` sem secret: 422 com `field: secret`. Com secret: 200, mascarado `••••4567`.
3. `PUT /SHOPEE` com `secret: ""`: o ID foi atualizado, `hasSecret` continuou `true` e o
   ciphertext ficou intacto.
4. `PUT /AMAZON` e depois `PATCH status INACTIVE`: 200.
5. Dois `PUT /MERCADO_LIVRE/session` com o mesmo token: a tag preencheu o ID e houve **uma** auditoria.
6. `PUT /SHOPEE/session`: 422. `PUT /FOO`: 400.
7. `DELETE /AMAZON`: 204. Repetido: 404.
8. No banco, o ciphertext não contém o valor em claro. `audit_logs` registrou 5 ações, todas sem
   valor de chave.
9. Com `CREDENTIALS_ENCRYPTION_KEY=short`: o boot loga o erro, o GET responde 200 e o PUT com
   secret e o PUT de sessão respondem 503.
