# Link de afiliado sempre do tenant — Especificação

**Status**: Rascunho. D4 (etiquetas por plano) decidida pelo dono em 2026-11-11; D1–D3 aguardando.
**Versões-alvo**: base em 2026-11-11 = api 0.79.0 · app 0.98.0 (recuperação de senha, ainda em `[Unreleased]`). FH → api 0.79.1; FE (etiquetas) → api 0.80.0 · app 0.99.0; F1–F4 → api 0.81.0 · app 0.100.0. Conferir a próxima versão livre na hora do commit. Extensão não muda (nenhum arquivo dela é tocado; manifest fica em 3.4.0, como nos commits recentes só de API/painel).
**Roadmap**: item 8 (Gerador de ofertas), com reflexo nos itens 3 (Credenciais), 11 (Story) e 12 (Página de Ofertas) de `docs/produto-roadmap.md`.
**Substitui**: GEN-02 (`offer-generator-v2/spec.md:61-62,82`), STORE-09 (`storefront/spec.md:76`, ID em `:137`), SHEIN-10 (`shein-affiliate/spec.md:140`), decisão #4 do story (`offer-story/context.md:35`), `STATE.md:114-116`.

## Problema

O usuário colou `meli.la/…` de outro afiliado no gerador e recebeu "Este link é de outro afiliado. Gere o link na
sua conta e cole aqui." O produto promete trocar o link pelo do cliente, mas só o monitoramento faz isso. Gerador,
Página de Ofertas e Story usam `ResolveAffiliateProductUseCase`, que ou recusa o link, ou — pior — deixa passar o
link de outra pessoa sem avisar.

## O que foi verificado (código, 2026-11-11)

| # | Furo | Onde | Efeito |
| --- | --- | --- | --- |
| **F0** | **ML: link do próprio tenant é recusado como "de outro afiliado"** | `verifyAffiliateLink.ts:44-45,73` | `/social/<apelido>` é tratado como identificador junto com `matt_word`. Quando o apelido do perfil ≠ etiqueta, são 2 valores distintos → `not_owned`, mesmo o `matt_word` sendo o do tenant. Ver "Causa do link próprio recusado" |
| F1 | Shopee nunca é conferida nem recriada | `verifyAffiliateLink.ts:69` → `ResolveAffiliateProductUseCase.ts:91` | Todo link Shopee colado (de outro ou limpo) vai como está. A credencial existe e não é usada |
| F2 | Sem credencial + identificador alheio passa como "não verificado" | `verifyAffiliateLink.ts:74`; Shein `Resolve…:122-124` | Amazon, ML e Shein: link do outro vai para a oferta |
| F3 | Com credencial + identificador alheio é recusado | `Resolve…:84` | Caso da foto: usuário travado em vez de atendido |
| F4 | Vitrine Shopee: builder falhou → grava o link colado | `ExtractStorefrontOfferUseCase.ts:71-80` | Item publicado com comissão alheia |
| F5 | Story devolve o `affiliateUrl` do Resolve sem troca | `RenderOfferStoryUseCase.ts:103` | Herda F1 e F2 |
| F6 | URL nunca é reescrita quando o identificador é do tenant | `Resolve…:91` | `ascsubtag`, `linkId`, `matt_tool`, `ref`, `af_*` de terceiro sobrevivem (efeito na comissão **não confirmado**) |
| F7 | Amazon limpa com credencial dá erro em vez de receber `?tag=` | `Resolve…:94-98` | Assimetria com o monitoramento |
| F8 | Falha do ML (sessão expirada, 429, fora do ar) vira "link sem afiliação" | `Resolve…:171-174` | Mensagem enganosa |
| F9 | Credencial recusada só é respeitada na Shein | `Resolve…:152-157` | Amazon/ML/Shopee chamam a loja mesmo recusadas |
| F10 | Texto da oferta é livre na edição | `UpdateOfferUseCase.ts:85-87`; `pickPreviewUrl.ts:17-21` | Usuário cola outro link no texto; a prévia pode apontar para ele |
| F11 | Publicar item da vitrine não olha `attributionVerified` | `SetStorefrontOfferStatusUseCase.ts:32-38` | Só um selo no painel |

O monitoramento (`BuildTenantAffiliateLinkUseCase` + rede de segurança em
`ProcessPendingCapturedOffersUseCase.ts:172-176`) já recria todo link e aborta se sobrar link que não é do tenant.

Dados de produção (leitura, 2026-11-11): 12.019 ofertas, 2 com `attributionVerified=false`; 21 itens de vitrine,
todos verificados; credenciais ativas: ML 6, Amazon 3, Shein 2, Shopee 1. Legado a corrigir é desprezível; o risco
é o que entra daqui para frente.

### Causa do link próprio recusado (relato com vídeo, 2026-11-11)

Usuário copiou o link da própria área de afiliado do ML e recebeu "link de outro afiliado". Confirmado:

- O `meli.la` expande para `…/social/<apelido>?matt_word=<etiqueta>&matt_tool=…&ref=…`.
- `affiliateIdentifiersOf` devolve **os dois** (`matt_word` e o trecho de `/social/`); `verifyAffiliateLink` recusa
  quando há mais de um valor distinto (`found.size > 1`).
- Em produção, de 86 URLs sociais do ML guardadas (ofertas + capturas), **84 têm apelido ≠ etiqueta**
  (ex.: `/social/sevenclub?matt_word=sevenclub2025`); só 2 são iguais.
- Só funciona para quem tem apelido = etiqueta (etiqueta automática, ex.: `da20250325163608`). Tenants com
  etiqueta `artsemdrywalls` e `idaywis` (vindas da própria sessão do ML, sem digitação — auditoria sem
  `AFFILIATE_CREDENTIAL_UPSERTED` de ML) têm **zero** link colado aceito.
- O teste atual só cobre apelido = etiqueta, por isso passou.

Não foi possível expandir o link exato do vídeo/foto daqui (a expansão manual do `meli.la` foi bloqueada no meu
ambiente); a conclusão vem do código + dados de produção. Correção: `matt_word` é o identificador; `/social/<x>` só
conta quando não há `matt_word`. É correção isolada, sai antes do resto (fase FH das tasks).

### Causa confirmada pelo dono: várias etiquetas na mesma conta (2026-11-11)

O usuário do vídeo tem **mais de uma etiqueta** na conta do ML. A CopySync guarda uma só
(`affiliate_credentials.publicIdentifier`, `schema.prisma:725`) e ele colou link com outra etiqueta da mesma conta →
`not_owned`. A FH **não** cobre isso (ela corrige apelido ≠ etiqueta, que é outro defeito real).

- O ML lista as etiquetas da conta em `/affiliate-program/api/v2/stripe/user/tags`; a API já chama esse endpoint a
  cada sincronização (`extension.routes.ts:242` → `getActiveTag`) e aproveita só a `in_use`
  (`MercadoLivreAffiliateClient.ts:254-257`).
- **Não verificado**: formato da resposta com várias etiquetas (a doc só tem conta de uma,
  `docs/extensao-ml-endpoints.md:117-121`) e se `createLink` aceita etiqueta da conta que não é a `in_use`
  (só há teste com etiqueta inventada → 400, `:215`). Viram portão da fase FE.

Não há justificativa registrada para a regra antiga ("Decisão do owner", sem ToS nem custo). O v1 gerava link.

## Alternativas avaliadas

| Alternativa | Veredito | Por quê |
| --- | --- | --- |
| A. Só trocar o texto do erro e orientar o usuário | ❌ | Não fecha F1, F2, F4, F5; usuário continua travado |
| B. No `not_owned`, chamar o builder; resto igual | ❌ | Fecha só F3. Shopee e "sem credencial" seguem vazando |
| C. Gerador/vitrine/story chamam o builder direto, sem o Resolve | ❌ | Duplica gates, expansão e dados do produto em 3 módulos; builder pausa a loja (`markRejected`) com o usuário na frente |
| **D. Resolve passa a recriar pelo mesmo código do builder; nunca devolve link que não seja provadamente do tenant** | ✅ | Uma regra, um ponto, cobre os 3 recursos e os 4 marketplaces; reaproveita URL canônica e clientes já testados no monitoramento |
| E. Recriar sempre, inclusive link já do tenant | ❌ (parcial) | Chamada à loja sem necessidade; limite do ML nunca medido; Shein cria `onelink` novo a cada chamada. Ver D2 |

## Regra única

> Toda oferta, item de vitrine ou story sai com link **criado ou provado** com a credencial do tenant.
> Se não der para criar nem provar, **nada é gerado** e o usuário é levado a conectar a loja.
> "Não verificado" deixa de existir como resultado.

## Objetivos

- [ ] Link de outro afiliado ou link limpo, em qualquer marketplace suportado, vira link do tenant nos três recursos.
- [ ] Zero caminho em que o link colado de terceiro vira o link da oferta (`affiliateUrl`), é enviado ou publicado.
      O colado fica só em `sourceUrl`, como registro interno de auditoria (nunca vai para mensagem, vitrine pública ou arte).
- [ ] Quando não dá para recriar, erro específico com botão para a tela certa (credenciais, aceite de risco, plano).
- [ ] Usuário é avisado quando o link foi recriado.
- [ ] Monitoramento sem mudança de comportamento.

## Fora de escopo

| Item | Motivo |
| --- | --- |
| Chat manual | Conversa livre do operador; não é oferta |
| Link/QR desenhado na foto capturada; domínio sem `/` no monitoramento | Limites conhecidos do `extractUrls`; exigem OCR/heurística própria |
| Cache de link gerado | AGENTS.md proíbe estado operacional novo em memória; ML é idempotente |
| Novo marketplace ou novo encurtador | Só os de `detectMarketplace.ts` |
| Backfill de legado | 2 ofertas antigas, já enviadas; 0 itens de vitrine |
| Medir limite de chamadas do ML | Pendência antiga (`docs/extensao-ml-endpoints.md:291`); risco declarado no design |
| Lib de i18n | Projeto usa `strings.ts` por feature, só pt-BR |
| Várias etiquetas em Amazon/Shopee/Shein | Pedido é do ML; os campos novos são genéricos, mas só o ML preenche |
| Editar limite numérico em `/admin/plan-entitlements` | A tela só aceita booleano (`planEntitlementAdmin.routes.ts:47-52`) |
| Atualizar a lista de etiquetas na hora da geração | Custaria bootstrap + chamada ao ML em todo link de terceiro; fica na sincronização |

## Decisões que dependem do dono

| # | Pergunta | Recomendação | Consequência da recomendação |
| --- | --- | --- | --- |
| D1 | Loja **sem credencial utilizável** (ex.: Shopee sem AppID/secret da API de afiliados): bloquear ou deixar passar com o link colado? | **Bloquear** | Hoje só 1 tenant tem credencial Shopee. Quem não tem a API da Shopee aprovada deixa de gerar oferta Shopee no gerador/vitrine/story até conectar. É o único jeito de garantir que a comissão não vai para outro: link Shopee não mostra o dono |
| D2 | Link que **já é do tenant**: manter ou recriar? | **Manter só se for o link curto oficial da loja com identificador do tenant** (`meli.la`, `onelink`); o resto recria. Amazon sempre reescrita (sem rede) | Fecha F6 sem chamada extra no caso comum |
| D4 ✅ | Quantas etiquetas do ML por plano e o que fazer com link de etiqueta da conta que não está vinculada? | **Decidido**: LITE 1, PRO 2, MAX 10. Etiqueta da conta não vinculada → bloqueia e oferece PRO/MAX. Destaque no banner de planos | LITE com várias etiquetas no ML só usa a vinculada; não há recriação silenciosa para a etiqueta principal |
| D3 | Link de marketplace **acrescentado na edição do texto** (não estava no texto salvo e não é o da oferta): bloquear ao salvar? | **Bloquear**, com a mensagem apontando o link. Links que já estavam no texto ficam (oferta do monitoramento sai com até 8 links do tenant e só o 1º é o `affiliateUrl`). Vale para qualquer caminho nos hosts suportados (`meli.la/…`, `amzn.to/…`): link de cupom/lista do próprio tenant colado à mão também é barrado, porque não dá para provar o dono sem rede | Fecha F10; link de convite de grupo e outros sites continuam livres |

---

## Histórias

### P0: Link próprio do ML é aceito (correção imediata)

**História**: como afiliado do ML, colo o link gerado na minha área de afiliado e ele é reconhecido como meu.

- **TLINK-25** QUANDO a URL do ML tem `matt_word` ENTÃO só ele DEVE contar como identificador; o trecho
  `/social/<x>` DEVE contar apenas quando não houver `matt_word` em nenhuma das URLs (colada e final).
- **TLINK-26** QUANDO `matt_word` = etiqueta do tenant e `/social/<x>` é diferente ENTÃO o resultado DEVE ser
  `verified`. Dois `matt_word` distintos continuam `not_owned`.
- **TLINK-27** O monitoramento não muda (não usa `verifyAffiliateLink`).

**Teste independente**: `…/social/sevenclub?matt_word=sevenclub2025` com credencial `sevenclub2025` → `verified`.

### P1: Várias etiquetas do Mercado Livre por plano (fase FE)

**História**: como afiliado com mais de uma etiqueta no ML, vinculo as que meu plano permite e a ferramenta
reconhece os links de todas elas como meus.

- **TLINK-28** A cada sincronização da sessão do ML o sistema DEVE guardar a lista de etiquetas da conta.
- **TLINK-29** Limite por plano na chave `mercado_livre_affiliate_tags`: LITE 1, PRO 2, MAX 10 (principal incluída).
  Tenant sem plano reconhecido (chave ausente) vale 1; nesta chave não existe "sem limite".
- **TLINK-30** O tenant DEVE poder escolher, entre as etiquetas da conta, a principal e as demais vinculadas, até o
  limite. Vincular acima do limite → `PLAN_LIMIT_REACHED` (`meta.key`, `meta.limit`). Etiqueta fora da lista da
  conta → recusada.
- **TLINK-31** QUANDO o link colado tem etiqueta **vinculada** ENTÃO DEVE ser aceito como do tenant, mantendo a
  etiqueta do link.
- **TLINK-32** QUANDO o link tem etiqueta **da conta, não vinculada** e ainda há vaga no plano ENTÃO o sistema DEVE
  falhar com `AFFILIATE_IDENTIFIER_NOT_LINKED` (`meta.provider`, `limit`, `used`) e o painel leva a vincular.
- **TLINK-33** QUANDO o link tem etiqueta da conta, não vinculada, e o limite está cheio (sempre o caso do LITE)
  ENTÃO o sistema DEVE falhar com `PLAN_LIMIT_REACHED` da mesma chave e o painel DEVE oferecer PRO e MAX.
  Nunca "link de outro afiliado".
- **TLINK-39** Desconectar a conta do ML DEVE limpar a lista da conta e as vinculadas; etiqueta que não está mais na
  conta na sincronização (inclusive por troca de conta) deixa de estar vinculada.
- **TLINK-34** Plano rebaixado: nada é apagado; valem a principal e as primeiras `limite − 1` vinculadas; as demais
  passam a ser tratadas como não vinculadas.
- **TLINK-35** Monitoramento, vitrine pública e links gerados pelo sistema continuam usando a etiqueta principal.
- **TLINK-36** A tela de credenciais DEVE mostrar as etiquetas da conta, quais estão vinculadas, o contador
  "x de y" e o caminho para os planos quando o limite impede; com flag de privacidade própria.
- **TLINK-37** O banner de planos DEVE destacar o recurso (selo no Mercado Livre, no padrão do selo da Shein), o
  catálogo e a tela de Assinatura DEVEM mostrar o limite por plano.
- **TLINK-38** A mesma regra vale no gerador, na Página de Ofertas e no Story (mesmo use case).

**Teste independente**: conta ML com 2 etiquetas, plano LITE, link da 2ª etiqueta → aviso de upgrade; no PRO,
vincular a 2ª → mesmo link gera oferta mantendo a etiqueta.

### P1: Recriar o link no gerador ⭐ MVP

**História**: como afiliado, colo qualquer link de produto (meu, de outro afiliado ou limpo) e a oferta sai com o
meu link, para a comissão ser minha.

**Critérios**

- **TLINK-01** QUANDO o link colado tem identificador de outro afiliado e o tenant tem credencial utilizável ENTÃO o
  sistema DEVE recriar o link a partir da URL canônica do produto com a credencial do tenant e gerar a oferta.
- **TLINK-02** QUANDO o link colado não tem afiliação ENTÃO idem TLINK-01, em todos os marketplaces (inclui Amazon,
  que hoje falha).
- **TLINK-03** QUANDO o marketplace é Shopee ENTÃO o link DEVE sempre ser recriado por `generateShortLink` com a
  credencial do tenant; o link colado nunca é reutilizado.
- **TLINK-04** QUANDO o link colado é o link curto oficial com identificador igual ao do tenant ENTÃO o sistema DEVE
  mantê-lo sem chamar a loja (D2). Amazon: sempre `…/dp/<ASIN>?tag=<tenant>`.
- **TLINK-05** QUANDO o link é recriado ENTÃO nada da URL de origem sobrevive além do produto (sem `tag`,
  `matt_word`, `matt_tool`, `ref`, `ascsubtag`, `linkId`, `af_*`, `utm_*`, `url_from`).
- **TLINK-06** QUANDO não há credencial utilizável do marketplace ENTÃO o sistema DEVE falhar com
  `AFFILIATE_CREDENTIAL_REQUIRED` (422, `meta.provider`), sem gravar nada (D1).
- **TLINK-07** QUANDO a credencial está recusada ENTÃO o sistema DEVE falhar com `AFFILIATE_CREDENTIAL_REJECTED`
  sem chamar a loja, nos 4 marketplaces; QUANDO a loja recusa na hora ENTÃO mesmo erro, **sem** `markRejected`.
- **TLINK-08** QUANDO a loja está fora do ar ou limita ENTÃO o erro DEVE ser `AFFILIATE_API_UNAVAILABLE` /
  `AFFILIATE_API_RATE_LIMITED`; QUANDO a loja recusa o produto (ex.: `ML_100`, `ML_1004`) ENTÃO
  `OFFER_LINK_REBUILD_FAILED` (`meta.provider`, `meta.reason`). Nunca "link sem afiliação".
- **TLINK-09** O link devolvido DEVE passar pela allowlist (`isSupportedShareLink`) antes de ser aceito, em todos os
  marketplaces.
- **TLINK-10** A ordem plano → credencial → aceite de risco → loja DEVE ser mantida; Shein continua exigindo plano
  MAX e aceite.
- **TLINK-11** `OFFER_LINK_NOT_OWNED` e `OFFER_LINK_NOT_AFFILIATE` deixam de ser emitidos; toda oferta nova sai com
  `attributionVerified=true`.
- **TLINK-12** A resposta da geração DEVE informar `linkRebuilt`, vindo do Resolve (não derivado dos campos
  gravados: oferta do monitoramento também tem `affiliateUrl ≠ sourceUrl`).

**Teste independente**: colar `meli.la` de outro afiliado com sessão ML conectada → oferta gerada com `meli.la` do
tenant e aviso "link recriado".

### P1: Mesma regra na Página de Ofertas e no Story ⭐ MVP

- **TLINK-13** A vitrine DEVE usar só o resultado do Resolve; some a troca própria da Shopee e o retorno ao link
  colado (F4). Recusa da loja na vitrine não pausa mais a loja.
- **TLINK-14** O story DEVE devolver só link recriado ou provado; os mesmos erros de TLINK-06..08.
- **TLINK-15** QUANDO um item de vitrine tem `attributionVerified=false` ENTÃO publicar DEVE falhar com
  `STOREFRONT_OFFER_LINK_UNVERIFIED` (defesa para legado; F11).

**Teste independente**: colar link Shopee de outro na vitrine, sem credencial → erro com botão "Conectar Shopee";
com credencial → item com link curto do tenant.

### P1: Painel explica e encaminha ⭐ MVP

- **TLINK-16** Rótulos e ajuda do campo deixam de exigir "o SEU link": aceitam qualquer link do produto e dizem que
  a comissão vai para a conta do usuário. Aviso fixo da Shopee sai.
- **TLINK-17** QUANDO `linkRebuilt` ENTÃO o painel DEVE mostrar aviso discreto "Link recriado com a sua conta
  <loja>" (gerador, vitrine, story), com `AppIcon` e `Tooltip`.
- **TLINK-18** Erros de credencial e de aceite de risco DEVEM ter botão para `/affiliates/credentials?returnTo=<tela>`
  nos três recursos (hoje só o gerador tem; a vitrine cai em texto genérico). Erro de plano (Shein fora do plano) fica como hoje em cada tela, sem botão novo.
- **TLINK-19** O mapeamento desses erros e seus textos DEVEM viver num único módulo compartilhado; os três
  `strings.ts` deixam de ter cópias divergentes.
- **TLINK-20** O aviso de link recriado NÃO exibe URL (só o nome da loja), então não cria flag de privacidade nova;
  onde o link já aparece seguem as flags existentes (`offerStory.link`, prévia do chat);
  rascunho continua em `usePersistedState`; claro/escuro/sistema conferidos.

### P2: Texto editado não carrega link de terceiro

- **TLINK-21** QUANDO o texto novo contém link de host de marketplace suportado que **não estava no texto
  gravado** e não é o `affiliateUrl` ENTÃO `UpdateOfferUseCase` DEVE falhar com `OFFER_TEXT_FOREIGN_LINK` (D3).
  Links já presentes (inclusive os vários links do tenant de oferta vinda do monitoramento) e links de outros
  hosts seguem permitidos.
- **TLINK-22** A prévia de link da oferta DEVE usar só o `affiliateUrl`; sem ele no texto, sem prévia.

### P2: Monitoramento intacto

- **TLINK-23** A extração do núcleo do builder NÃO PODE mudar nenhum resultado do monitoramento (mesmos `kind`,
  mesma pausa por `markRejected`); os testes atuais do builder passam sem edição de expectativa.

### P3: Proteção de volume

- **TLINK-24** `POST /campaigns/offers` ganha limite de taxa por tenant no padrão de `rateLimitPresets.ts`
  (vitrine e story já têm 60/h).

---

## Casos de borda

- Etiqueta criada no ML depois da última sincronização → ainda não está na lista da conta; é tratada como de
  terceiro até a próxima sincronização (automática em até 60 min, ou botão de sincronizar na tela de credenciais).
- Principal deixou de existir na conta (apagada no ML) → a sincronização não troca sozinha; a tela de credenciais
  avisa e pede nova escolha.
- Redirect muda de marketplace → gate de plano de novo, como hoje.
- Link com dois identificadores divergentes → recria (antes: `not_owned`).
- Vitrine social do ML (`/social/<apelido>`), link a recriar → produto do 1º card; sem card → `OFFER_URL_UNSUPPORTED`.
  Link curto do próprio tenant mantido (TLINK-04) e sem card → oferta com produto vazio e preenchimento manual, como hoje.
- Link curto que cai em página sem produto → `OFFER_URL_UNSUPPORTED` (inalterado).
- Shein sem plano ou sem aceite → erro do respectivo gate. Shein sem `AT`: link de outro ou limpo → `AFFILIATE_CREDENTIAL_REQUIRED`; link curto do próprio tenant → mantido com produto vazio (como hoje). Nunca o link de outro.
- ML com etiqueta cadastrada mas sem sessão da extensão: link de outro ou limpo → `AFFILIATE_CREDENTIAL_REQUIRED` com texto
  "conecte pela extensão"; link curto do próprio tenant (`matt_word` = etiqueta) → mantido, é provado sem sessão.
- Shopee com AppID sem secret → idem.
- Loja devolve link fora da allowlist → `OFFER_LINK_REBUILD_FAILED`.

## Rastreio

| Requisito | História | Furo | Tasks | Status |
| --- | --- | --- | --- | --- |
| TLINK-25..27 | P0 link próprio ML | F0 | TH1 TH2 | Implementado |
| TLINK-28..39 | P1 etiquetas por plano | causa do vídeo | TE0..TE11 | Implementado |
| TLINK-01..05, 09 | P1 gerador | F1 F2 F3 F6 F7 | T2 T3 T4 | Implementado |
| TLINK-06..08, 10 | P1 gerador | F8 F9 | T1 T4 | Implementado |
| TLINK-11, 12 | P1 gerador | — | T4 T5 T10b | Implementado |
| TLINK-13, 15 | P1 vitrine | F4 F11 | T6 T7 | Implementado |
| TLINK-14 | P1 story | F5 | T8 | Implementado |
| TLINK-16..20 | P1 painel | — | T11..T15 | Implementado |
| TLINK-21, 22 | P2 texto | F10 | T9 T13 | Implementado |
| TLINK-23 | P2 monitoramento | — | T2 | Implementado |
| TLINK-24 | P3 | — | T10 | Implementado |

**Cobertura**: 39 requisitos, 39 mapeados.

## Critérios de pronto

- [ ] Matriz 4 marketplaces × {link de outro, link limpo, link do tenant} × {com credencial, sem, recusada} coberta
      por teste unitário do Resolve, sem nenhuma célula devolvendo link de terceiro.
- [ ] `grep -rn "unverified" api/src/modules/campaigns/application` não encontra caminho que devolva link colado.
- [ ] Smoke manual: o link da foto (`meli.la` de outro) gera oferta com link do tenant.
- [ ] `pnpm typecheck && pnpm test` em `api/` e `app/`.
- [ ] Docs, CHANGELOG e versões atualizados.
