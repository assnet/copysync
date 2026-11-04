# Extensão — build de produção, CRX e publicação na Chrome Web Store

Pasta: `extension/` · Arquitetura e contrato: [`extensao-navegador.md`](extensao-navegador.md) ·
CHANGELOG: [`extension/CHANGELOG.md`](../extension/CHANGELOG.md)

Este documento é o passo a passo operacional: chaves, ID, build, `.crx`, zip de loja e os textos
da listagem. Nada aqui muda arquitetura; se o contrato com a API mudar, a doc é a outra.

## 1. Conceitos que não podem ser confundidos

| Termo | O que é | Onde vive |
|---|---|---|
| **Chave privada** (`.pem`) | RSA 2048 PKCS#8. Assina o `.crx` e define o ID | `extension/.keys/extension-private.pem` (fora do git) |
| **`key` do manifest** | Chave pública em base64 (SPKI DER) | `extension/public/manifest.json` |
| **ID da extensão** | 32 letras `a–p`: SHA-256 da chave pública, 32 primeiros hex, dígito→letra | `pnpm keys:id` |
| **`.crx`** | Pacote assinado (CRX3). Instalação fora da loja (política de empresa / teste) | `extension/release/*.crx` |
| **Zip de loja** | Conteúdo de `dist-store/` **sem** `key`. É o que a Web Store recebe | `extension/release/*-store.zip` |

Regra: **o ID vem da chave.** Trocar a chave troca o ID e quebra `EXTENSION_ORIGINS` (API),
`VITE_EXTENSION_IDS` (painel) e toda instalação existente. A `.pem` é o ativo mais importante
da pasta; perdê-la obriga a publicar uma extensão nova.

ID atual (derivado da `.pem` em uso e igual ao `key` do manifest): `nokcbnoicaebghagbhlfcbepheohdgnd`.

## 2. Chaves do CRX

### 2.1 Projeto já tem chave (caso atual)

Nada a gerar. Conferir:

```bash
cd extension
pnpm keys:id      # imprime o ID e falha se manifest.key ≠ chave privada
```

Fazer **backup** da `.keys/extension-private.pem` em cofre (1Password/Keychain/Bitwarden).
Nunca em git, Slack, e-mail ou disco compartilhado.

### 2.2 Gerar chave nova (só projeto novo ou troca deliberada)

```bash
cd extension
pnpm keys:generate
```

O script recusa sobrescrever uma `.pem` existente. Ele grava `.keys/extension-private.pem`
(modo 600) e `.keys/public-key.b64`, e imprime o ID. Depois:

1. Colar o conteúdo de `.keys/public-key.b64` em `public/manifest.json` → `"key"`.
2. API (Render): `EXTENSION_ORIGINS=chrome-extension://<id>`.
3. Painel: `VITE_EXTENSION_IDS=<id>` (`app/.env`, `app/.env.dev` e variáveis da Render).
4. Backup da `.pem`.

Equivalente manual com OpenSSL (mesmo formato do Chrome):

```bash
openssl genrsa 2048 | openssl pkcs8 -topk8 -nocrypt -out .keys/extension-private.pem
openssl rsa -in .keys/extension-private.pem -pubout -outform DER | base64 | tr -d '\n' > .keys/public-key.b64
```

## 3. Build de produção

Pré-requisito: `extension/.env` com os valores de produção (`API_URL=https://api.copysync.app/api`,
`PANEL_URL=https://app.copysync.app`, `DEV="false"`). `.env` é a **única** fonte de URL do bundle.

```bash
cd extension
pnpm i
pnpm type-check   # tsc + check-cookie-scope + check-i18n + check-contract-sync
pnpm test         # vitest
pnpm build        # webpack produção + check-dist (com key → carregar em chrome://extensions / CRX)
pnpm build:store  # idem, sem key, em dist-store/ (zip da loja). dist/ nunca fica sem key
```

O que o build garante (`scripts/check-dist.mjs`): versão de `dist/manifest.json` = `package.json`;
nenhum `localhost`/IP privado/`console.log`/`debugger`; host da API presente no bundle; sem
`content_scripts`, `scripting`, `tabs`, `.com.ar`/`.com.mx`, `update_url`, `_metadata`; e, no build
de loja, sem `key`.

Bump de versão **antes** de qualquer empacotamento: `extension/package.json` → `version` (SemVer) e
entrada em `extension/CHANGELOG.md` + `CHANGELOG.md` da raiz. O webpack copia a versão para o manifest.
A Web Store só aceita versão maior que a publicada.

## 4. Gerar o `.crx`

```bash
cd extension
pnpm pack:crx     # = pnpm build + chrome --pack-extension assinado com .keys/extension-private.pem
# → release/copysync-extension-<versão>.crx
```

O script localiza o Chrome (`CHROME_BIN` sobrescreve o caminho padrão do SO), recusa `dist/` de loja
(sem `key`), recusa `key` que não bata com a `.pem`, e apaga qualquer `dist.pem` que o Chrome crie.
Formato de saída: CRX3 (`Cr24`, versão 3), o único aceito pelo Chrome atual.

Manual pela interface: `chrome://extensions` → Modo do desenvolvedor → **Compactar extensão** →
diretório raiz = `extension/dist`, chave privada = `extension/.keys/extension-private.pem`.
Se o campo da chave ficar vazio, o Chrome gera **outra** chave (ID diferente): não fazer.

**Limites do `.crx`.** Chrome estável em Windows e macOS não instala `.crx` arrastado para
`chrome://extensions` fora da Web Store; só via política de empresa (`ExtensionInstallForcelist`
/ `ExtensionInstallSources`) ou em Linux/canais de desenvolvedor. Hospedagem própria com atualização
automática exigiria `update_url` + XML de updates, que o `check-dist` proíbe (resquício do legado).
Uso do `.crx` hoje: teste interno, auditoria do pacote, política de empresa. Distribuição ao
público é pela loja.

## 5. Zip para a Chrome Web Store

```bash
cd extension
pnpm pack:store         # = pnpm build:store + zip do conteúdo de dist/
# → release/copysync-extension-<versão>-store.zip
```

Zipa o **conteúdo** de `dist-store/` (manifest na raiz do zip, não dentro de pasta). Sem `.DS_Store`,
sem `key`, sem `_metadata`.

**Por que `dist-store/` separado.** `dist/` é a pasta carregada "sem compactação" no Chrome. Se o
manifest ali ficar sem `key` por um instante e alguém carregar/recarregar a extensão nesse momento,
o Chrome deriva o ID do **caminho** (`hhbecpmlkjghanilmeiockpcoljaffmk`) em vez da chave, e o painel
nunca encontra a extensão. Aconteceu em 2026-11-02 num perfil do Chrome. Agora o `check-dist` falha
se `dist/manifest.json` estiver sem `key`.

**Primeiro envio de uma listagem nova** e quer manter o mesmo ID do build local:

```bash
pnpm pack:store:first   # inclui key.pem na raiz do zip → a loja adota a mesma chave/ID
```

Só nesse primeiro upload. Depois do envio, apagar o zip `*-with-key.zip` (contém a chave privada)
e conferir no painel do desenvolvedor que o ID do item é `nokcbnoicaebghagbhlfcbepheohdgnd`.
Se vier outro ID, a loja ignorou a chave: atualizar `EXTENSION_ORIGINS` e `VITE_EXTENSION_IDS`
com o ID da loja e manter o `key` do manifest local igual ao da loja (copiar de
`chrome://extensions` → detalhes → ou do `manifest.json` instalado).

`pnpm release` faz tudo em sequência: `type-check` → `test` → `pack:crx` → `pack:store` → `pack:upload`.

### Uploads de CRX verificados (ativo desde 2026-11-04)

Com a opção ativa no painel (Pacote → "Uploads de CRX verificados"), a loja só aceita `.crx` assinado
com a chave de upload cadastrada; zip deixa de ser aceito.

- **Par separado da chave do item.** A loja recusa a chave pública atual do item ("Não use a chave
  pública atual deste item"). Chave de upload: `.keys/verified-upload-private.pem` (fora do git);
  pública em `.keys/verified-upload-public.pem` (é a que foi colada no painel).
- **Pacote:** `pnpm pack:upload` = `build:store` + `pack-crx.mjs --upload` → assina `dist-store/`
  (sem `key`) → `release/copysync-extension-<versão>-upload.crx`. Esse é o arquivo do upload.
- **Backup obrigatório** da `verified-upload-private.pem` em gerenciador de senhas. Perdeu = sem
  atualização até o suporte da Chrome Web Store desativar. Nunca gerar outra por cima.
- A chave privada nunca é colada em site nem em nota sem senha; o painel só pede a **pública**.

## 6. Publicar — passo a passo no painel do desenvolvedor

Painel: https://chrome.google.com/webstore/devconsole

1. **Conta de desenvolvedor**: conta Google da empresa (não pessoal), taxa única de US$ 5, verificação
   em duas etapas obrigatória. Preencher e-mail de contato e verificá-lo.
2. **Novo item** → enviar `release/copysync-extension-<versão>-store.zip` (ou `-with-key` no primeiro).
3. **Página "Detalhes do app"**: colar os textos da seção 7; categoria **Produtividade → Fluxo de
   trabalho e planejamento** (o padrão "Ferramentas para desenvolvedores" está errado); idioma
   **Português (Brasil)**. Recursos gráficos: `pnpm store:assets` gera em `extension/store-assets/`
   o ícone 128×128 (arte 96 px + margem transparente, diretriz do Chrome), o bloco promocional
   pequeno 440×280 e o letreiro 1400×560 (24 bits, sem alfa). Capturas: 1 a 5 em 1280×800, JPEG/PNG
   24 bits — `screenshot-1-login-1280x800.png` já gerada; as demais (Configurações → Extensão com a
   extensão conectada, card do Mercado Livre, oferta com link gerado) são prints reais do painel.
   Campos extras: URL da página inicial `https://app.copysync.app`, URL do suporte
   `https://app.copysync.app/suporte`.
4. **Privacidade** (aba *Privacy practices*): finalidade única, justificativa de cada permissão, uso de
   dados e certificações da seção 8; URL da política de privacidade (ver pendência na seção 9).
5. **Distribuição**: visibilidade **Não listada** no primeiro envio (instala só pelo link; permite
   validar em produção sem expor). Depois **Pública**. Regiões: Brasil (ou todas). Preço: gratuita.
6. **Enviar para revisão**. Revisão leva de horas a alguns dias; permissão `cookies` + hosts amplos
   costumam cair em revisão manual. Resposta chega no e-mail de contato.
7. Depois de aprovado: testar instalação pela loja, conferir ID, `EXTENSION_ORIGINS` na API e o
   wizard do painel em `/settings/extension`. Criar tag no monorepo conforme §31 do `AGENTS.md`.

Atualizações seguintes: bump de versão → `pnpm pack:store` → *Package* → *Upload new package* →
revisar listagem → *Submit for review*. Mudança em `permissions`/`host_permissions` faz o Chrome
desativar a extensão até o usuário aceitar as permissões novas: evitar; quando inevitável, avisar no
painel.

## 7. Textos da listagem

Nome e descrição curta têm limite de 45 e 132 caracteres. A descrição longa aceita até 16 000;
sem HTML, parágrafos separados por linha em branco. A marca aparece só em texto exibido (white label):
nenhum identificador de código muda por causa disso.

### 7.1 Nome (≤ 45)

```
CopySync — Sessão de afiliado Mercado Livre
```

### 7.2 Descrição curta (≤ 132)

```
Conecta sua conta de afiliado do Mercado Livre ao painel CopySync para gerar links de afiliado automaticamente.
```

### 7.3 Descrição longa (pt-BR)

```
Gere links de afiliado do Mercado Livre sem colar cookies nem repetir login.

A extensão CopySync conecta a sessão de afiliado que você já tem aberta no Mercado Livre ao seu painel CopySync. Com isso, o painel passa a gerar os links de afiliado dos produtos que você divulga, de forma automática, usando a sua própria conta e a sua etiqueta.

COMO FUNCIONA
1. Instale a extensão e entre no painel CopySync.
2. No painel, abra Configurações → Extensão e siga o assistente de conexão.
3. Entre no Mercado Livre neste navegador, como faz normalmente.
4. Pronto. A extensão mantém a sessão sincronizada enquanto o navegador estiver aberto e renova sozinha quando ela muda.

O QUE A EXTENSÃO FAZ
• Lê apenas os cookies de identidade da sua sessão do Mercado Livre (ssid, orguseridp, orgnickp, orguserid) e os envia ao painel CopySync por conexão segura.
• Detecta quando a sessão muda e sincroniza de novo, com limite de frequência.
• Ao clicar no ícone, abre ou foca a aba do painel.

O QUE A EXTENSÃO NÃO FAZ
• Não lê sua senha do Mercado Livre nem de nenhum outro site.
• Não injeta código em páginas, não altera o que você vê, não acompanha sua navegação.
• Não coleta histórico, não exibe anúncios, não vende dados.
• Não funciona sozinha: ela só opera vinculada a uma conta do painel CopySync.

PRIVACIDADE E SEGURANÇA
A autenticação com o painel é feita por cookie HttpOnly emitido pelo próprio painel; a extensão não guarda senha nem token. A sessão do Mercado Livre é armazenada cifrada no servidor e pode ser desconectada a qualquer momento em Configurações → Extensão, o que apaga a sessão guardada. Política de privacidade completa no link da listagem.

PARA QUEM É
Afiliados do Mercado Livre e equipes que operam grupos de ofertas com o CopySync e querem gerar links sem trabalho manual.

REQUISITOS
• Conta ativa no painel CopySync com plano que inclua a integração de marketplace.
• Conta de afiliado do Mercado Livre (Brasil).

SUPORTE
Dúvidas e problemas: pelo painel CopySync ou pelo e-mail de suporte informado nesta listagem.
```

### 7.4 Versão em inglês (locale `en` da listagem, opcional)

```
Name: CopySync — Mercado Livre Affiliate Session
Short: Links your Mercado Livre affiliate account to the CopySync dashboard to generate affiliate links automatically.

Generate Mercado Livre affiliate links without pasting cookies or logging in twice.

The CopySync extension connects the affiliate session you already have open on Mercado Livre to your CopySync dashboard, so the dashboard can generate affiliate links for the products you share, using your own account and tag.

HOW IT WORKS
1. Install the extension and sign in to the CopySync dashboard.
2. In the dashboard, open Settings → Extension and follow the connection wizard.
3. Sign in to Mercado Livre in this browser as usual.
4. Done. The extension keeps the session in sync while the browser is open and renews it when it changes.

WHAT IT DOES
• Reads only the identity cookies of your Mercado Livre session (ssid, orguseridp, orgnickp, orguserid) and sends them to the CopySync dashboard over a secure connection.
• Detects session changes and re-syncs, rate limited.
• Clicking the icon opens or focuses the dashboard tab.

WHAT IT DOES NOT DO
• It does not read your Mercado Livre password or any other password.
• It does not inject code into pages, change what you see, or track your browsing.
• It does not collect history, show ads, or sell data.
• It does not work on its own: it only operates linked to a CopySync dashboard account.

PRIVACY AND SECURITY
Authentication with the dashboard uses an HttpOnly cookie issued by the dashboard itself; the extension stores no password or token. The Mercado Livre session is stored encrypted on the server and can be disconnected at any time in Settings → Extension, which deletes the stored session.
```

## 8. Aba "Práticas de privacidade" — respostas prontas

Cada campo do formulário aceita até 1.000 caracteres; os textos abaixo já cabem (contagem ao lado).

**Único propósito** (465)

```
Sincronizar a sessão de afiliado do Mercado Livre do usuário com o painel CopySync ao qual ele está autenticado, para que o painel gere links de afiliado em nome do usuário. A extensão lê apenas os cookies de identidade da sessão do Mercado Livre (ssid, orguseridp, orgnickp, orguserid), envia-os por HTTPS à API do painel e mantém essa sessão renovada. Não injeta código em páginas, não altera conteúdo, não coleta navegação e não funciona sem uma conta do painel.
```

**Justificativa de cookies** (431)

```
Ler os cookies de identidade da sessão do Mercado Livre (ssid, orguseridp, orgnickp, orguserid) em https://*.mercadolivre.com.br via chrome.cookies.getAll e detectar quando mudam via chrome.cookies.onChanged. Único uso: enviar a sessão ao painel CopySync ao qual o usuário está autenticado, para gerar links de afiliado. Nenhum cookie de outro domínio é lido e nenhum cookie é gravado. Sem essa permissão a extensão não tem função.
```

**Justificativa de storage** (289)

```
Guardar estado local da extensão em chrome.storage.local: identificador aleatório de instalação, estado da última sincronização (ok/erro/horário), hash SHA-256 da sessão para detectar mudança sem reenviar dados iguais, e preferência de tema. Não armazena senha, token nem os cookies em si.
```

**Justificativa de alarms** (336)

```
Agendar tarefas do service worker MV3, que não permanece ativo: renovação de reserva da sessão a cada 60 minutos, heartbeat com o painel a cada 30 minutos e debounce de 60 segundos após mudança de cookie para agrupar várias alterações em uma única sincronização. Sem alarms a sessão deixaria de ser renovada quando o worker é encerrado.
```

**Justificativa de Permissão do host** (564) — um único campo para os três hosts

```
https://*.mercadolivre.com.br/*: escopo dos cookies de sessão do Mercado Livre lidos via chrome.cookies. Nenhum script é injetado nessas páginas.

https://app.copysync.app/*: origem do painel. Permite ao clique no ícone localizar e focar a aba do painel já aberta (sem a permissão tabs) e é a única origem autorizada em externally_connectable a enviar mensagens à extensão.

https://api.copysync.app/*: API do painel. Chamadas autenticadas por cookie HttpOnly: perfil, heartbeat, envio da sessão e eventos de ciclo de vida (instalação, atualização, desinstalação).
```

**Você está usando código remoto?** Marcar **Não, não estou usando código remoto**. O painel vem com
"Sim" pré-selecionado: deixar assim exige justificativa e atrasa a revisão. Todo o código vai no
pacote; nenhum script externo é carregado ou avaliado.

**Uso de dados** (marcar):

- Informações de autenticação — cookies de sessão do Mercado Livre (enviados ao painel, cifrados no servidor).
- Informações de identificação pessoal — apelido e id de usuário do Mercado Livre contidos nos cookies `orgnickp`/`orguserid`; e-mail da conta do painel exibido pelo painel.
- Não marcar: saúde, financeiro, localização, histórico de navegação, atividade do usuário, conteúdo de sites, comunicações pessoais.

**Certificações** (marcar as três):

- Não vendo nem transfiro dados a terceiros fora dos casos de uso aprovados.
- Não uso nem transfiro dados para fins não relacionados à finalidade única do item.
- Não uso nem transfiro dados para avaliar crédito ou para fins de empréstimo.

**Política de privacidade**: URL pública obrigatória porque a extensão trata dados de autenticação.
URL oficial: `https://app.copysync.app/politicas-de-privacidade` (rota pública do painel, sem login).
Texto fonte da verdade: `app/src/features/privacy-policy/strings.ts` (seção 10).

## 9. Pendências antes do envio

| # | Item | Bloqueia envio |
|---|---|---|
| ~~1~~ | ~~Política de privacidade pública~~ ✅ `/politicas-de-privacidade` (app 0.57.0) — conferir 200 sem login após o deploy | — |
| ~~2~~ | ~~URL de suporte~~ ✅ `/suporte` (app 0.58.0, `pages/SupportPage.tsx`, `features/support/strings.ts`) — precisa do deploy do painel | — |
| ~~3~~ | ~~Ícone 128, tile 440×280, letreiro 1400×560~~ ✅ `pnpm store:assets` → `extension/store-assets/` | — |
| 4 | Capturas 1280×800 além do login: Configurações → Extensão conectada, card do Mercado Livre, oferta com link gerado. Print real com a extensão instalada; borrar dados de cliente (flags de privacidade do painel) | Não (1 captura já basta), recomendado |
| 5 | Conta de desenvolvedor da empresa com 2FA e e-mail de suporte verificado; declaração de comerciante (DSA) | Sim |
| 6 | `EXTENSION_ORIGINS=chrome-extension://nokcbnoicaebghagbhlfcbepheohdgnd` confirmado na Render | Sim (senão tudo 403) |
| 7 | Smoke test com o zip de loja carregado localmente: canal, sync, heartbeat, link ML | Sim |
| 8 | Revisão jurídica do texto da política e da listagem | Recomendado |

**Suporte e a API central (hub).** O plano de lançamento prevê marca e canal de suporte por
aplicação em `Application.brand` no hub, exposto ao front por `VITE_BRAND_*` — ainda não existe
nem no hub nem no painel, e nenhum redirect de suporte foi implementado. Por isso `/suporte` é uma
página pública estática do próprio painel, com canais em `features/support/strings.ts` (iguais à
seção Contato da política). Quando o hub entregar `Application.brand`, a página passa a ler de lá;
a URL declarada na loja não muda.

## 10. Política de privacidade (texto e publicação)

Página pública do painel: `app/src/pages/PrivacyPolicyPage.tsx`, rota `/politicas-de-privacidade`
fora do `PrivateRoute` (`AppRoutes.tsx`). Texto em **`app/src/features/privacy-policy/strings.ts`**
(seções, itens `**prefixo:** texto`, marca via `{{app}}` → `APP_NAME`). Cobre conta do painel, dados de
operação, extensão (cookies `ssid`/`orguseridp`/`orgnickp`/`orguserid`, permissões
`cookies`/`storage`/`alarms`, hosts), compartilhamento (infra, marketplaces, mensageria, IA, billing),
tratamento/segurança, direitos LGPD e contato (`suporte@copysync.app`). Link discreto no rodapé do login
(`target=_blank`).

Mudou o texto → editar `strings.ts`, atualizar `updatedAt`, deploy do painel. O painel inteiro leva
`X-Robots-Tag: noindex` (render.yaml); a página não precisa ser indexada, só responder 200 ao revisor.
Revisar com jurídico (razão social/CNPJ) antes do envio.

## 11. O que NÃO fazer

- **Commitar** `.keys/*.pem`, `release/`, `*.crx`, `*.zip`, `.env` (todos no `.gitignore`).
- **Gerar chave nova** por engano: `pnpm keys:generate` recusa sobrescrever; o Chrome GUI gera outra
  se o campo da chave ficar vazio. Confira o ID com `pnpm keys:id` antes de distribuir.
- **Enviar à loja** zip com `key` no manifest (recusado) ou com `_metadata`/`update_url`.
- **Carregar `dist-store/` sem compactação** no Chrome: sem `key`, o ID vira outro e o painel não acha.
  Se isso aconteceu: `chrome://extensions` → remover → "Carregar sem compactação" → `extension/dist`.
- **Reaproveitar a listagem do legado** ("Redirect Flow"): listagem nova.
- **Deixar `key.pem` no zip** depois do primeiro upload.
- **Editar `version`** em `public/manifest.json`: bump só em `package.json`.
- **Adicionar permissão** sem atualizar a tabela de justificativas (seção 8) e a listagem.
- **Divergir canais de contato** entre `features/support/strings.ts` e a seção Contato de
  `features/privacy-policy/strings.ts`: a loja compara listagem, política e suporte.
- **Build com `.env.dev`** para empacotar: `check-dist` barra `localhost`, mas a URL do painel errada
  passa; o `.env` de produção é o único válido para `pack:*`.
