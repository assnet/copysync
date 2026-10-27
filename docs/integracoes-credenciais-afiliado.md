# Credenciais de afiliado

Por tenant, guarda a credencial de cada marketplace (Shopee, Mercado Livre e Amazon) para o
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
| Painel | `app/src/features/settings/` (card, resumo de progresso `AffiliateConnectionSummary`, `MarketplaceLogo`, diálogo, hook, `strings.ts`, `affiliateProviders.ts`; logos em `app/public/assets/marketplaces/`, licenças no `LICENSE.md` da pasta) · `app/src/pages/settings/AffiliateCredentialsPage.tsx` · rota `/settings/affiliate-credentials` |
| Extensão | `extension/` sincroniza a sessão do Mercado Livre (`docs/extensao-navegador.md`) |

## Campos por marketplace

Nenhum programa publica um formato oficial. Por isso as regras de validação são permissivas: o
objetivo é não recusar um valor real. Foram verificadas em 2026-10-22. O domínio é a fonte de
verdade e o painel só repete as regras, para dar retorno ao operador.

| Marketplace | Campo público | Regex | Segredo |
| --- | --- | --- | --- |
| Shopee (Affiliate Open API) | AppID | `^\d{5,20}$` | Secret `^[A-Za-z0-9]{16,128}$` (assina `sha256(appId+timestamp+payload+secret)`) |
| Mercado Livre | Etiqueta de afiliado (`matt_word` no link) | `^[A-Za-z0-9._-]{2,64}$` | — (a sessão vem da extensão) |
| Amazon Associados | ID de rastreamento (`?tag=`) | `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}-\d{2}$` | — |

Assim que houver valores reais do cliente, confira as regras com eles antes de restringi-las.

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

### Geração automática de links (F4)

A sessão sincronizada pela extensão também é consumida por `MercadoLivreAffiliateClient`
(`campaigns/infrastructure/http/`) para gerar links de afiliado automaticamente quando o operador
cola uma URL de produto ML sem `matt_word`. Detalhes em
[`gerador-de-ofertas.md`](gerador-de-ofertas.md) (seção "Geração automática de link ML").

## O que não fazer

- Nunca devolver o segredo ou a sessão por HTTP, nem acrescentar esses campos ao schema
  `AffiliateCredentialItem`.
- Nunca logar o body dessas rotas, nem pôr valor de chave ou token em `meta` de auditoria ou de erro.
- Nunca gravar em claro como fallback quando a cifra estiver indisponível.
- Não cifrar o `publicIdentifier`. Ele aparece na URL gerada, e cifrá-lo impediria buscas.
- Não acessar Prisma fora de `infrastructure/`, e não criar consulta sem `tenantId`.

## Smoke (T8, executado em 2026-10-22, banco local)

Feito com a API compilada (`node --env-file=.env.dev dist/app/server.js`). O `pnpm dev` não subiu
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
