# Rebranding → CopySync

Este repositório nasceu como cópia do projeto **WaioPrime** e está sendo rebatizado como
**CopySync**. Este documento é a fonte de verdade sobre o que já mudou, o que falta e o que
**não** deve ser renomeado. Atualize-o a cada fase concluída.

## Identidade

| Item | Valor |
|------|-------|
| Nome do produto | **CopySync** |
| Painel (app) | https://copysync.app |
| API | https://api.copysync.app |
| Repositório | git@github.com:assnet/copysync.git |
| Logo (fonte) | `app/public/assets/brand/logo-source.png` (128×128, fundo transparente — **pedir fonte ≥ 512 px** para apple-touch/192/512 sem ampliação) |
| Derivados | `app/public/assets/brand/`: `logo-512.png`, `icon-192.png`, `icon-512.png`, `apple-touch-icon.png`, `favicon-32.png`, `favicon-16.png`, `favicon.ico` |
| Manifest PWA | `app/public/site.webmanifest` |
| Constante de nome | `APP_NAME` em `app/src/shared/branding/brand.ts` |
| Componente de logo | `BrandLogo` em `app/src/shared/branding/BrandLogo.tsx` (tile branco arredondado, funciona em claro/escuro) |

Regra white label (AGENTS.md): nomes de funções, chaves, eventos e componentes descrevem o
**recurso**, nunca a marca. A marca aparece só em texto exibido ao usuário, metadados HTTP
(OpenAPI), `<title>` e assets.

## Fase 1 — Documentação ✅ (2026-10-12, v0.13.1)

Prosa, domínios e caminhos de clone rebatizados em: `README.md`, `api/README.md`,
`AGENTS.md` (seção *Marca e domínios*), `.cursor/MCP_SETUP.md`, `.github/MCP_SETUP.md`,
`.cursor/plans/rules_skills_mcps_copysync_c5f11ded.plan.md` (renomeado),
`.specs/features/service-desk/integracao-api-central.md`, `api/db.instructions.md`,
comentário de cabeçalho em `render.yaml`. Logo adicionado em `app/public/assets/` (movido para `assets/brand/` na fase 2).

Único ajuste de tooling: o alias `cw` em `.cursor/scripts/mcp/waioprime-mcp.zsh` passou a abrir
`~/www/copysync` (o caminho antigo não existe mais). Rode `.cursor/scripts/mcp/install-mcp-scripts.sh`
para atualizar a cópia em `~/.cursor/`.

Histórico do `CHANGELOG.md` **não** foi reescrito: entradas antigas citam `waioprime.com` porque
descrevem o estado da época.

## Fase 2 — Painel (`app/`) ✅ (2026-10-12, v0.14.0)

Logo trocado em 2026-10-12 pela versão com fundo transparente (128 px). Feito: `index.html` (título, favicon/apple-touch/manifest, `data-app="copysync"` junto com o comentário do `DomGuardian`), `LoginPage` (3 pontos), `AppLayout` (logo, nome, tooltip de versão, chave `localStorage` → `sidebar-collapsed`), mocks de chat, comentários de `resolveMediaUrl`, `app/package.json` → `copysync-app`. Assets antigos `logo_waiochat.png` e `waio*.png` removidos; `iProtect`/`iSaver` mantidos (não pertencem à marca, sem referência).

**Regenerar ícones** (a partir de `logo-source.png`, requer Pillow):

```bash
cd app/public/assets/brand && python3 -c "
from PIL import Image; s=Image.open('logo-source.png').convert('RGBA')
for n,z in [('logo-512',512),('icon-192',192),('icon-512',512),('apple-touch-icon',180),('favicon-32',32),('favicon-16',16)]: s.resize((z,z),Image.LANCZOS).save(n+'.png',optimize=True)
s.resize((64,64),Image.LANCZOS).save('favicon.ico',sizes=[(16,16),(32,32),(48,48),(64,64)])"
```

Pendente da fase 2, depende do DNS: `app/.env.dev` e `app/.env` ainda apontam para `api.waioprime.com` (marcado com TODO); trocar na fase 3.

Não há biblioteca i18n no `app/` hoje: strings seguem em pt-BR no código. Quando i18n entrar, `APP_NAME` continua sendo a única fonte do nome.

Tabela original da fase (referência do que foi tocado):

| Arquivo | Trocar |
|---------|--------|
| `app/index.html` | `<title>WaioPrime</title>` → `CopySync`; favicon → `/assets/copysync-logo-256x256.png` |
| `app/index.html` + `app/src/shared/dom-guardian/DomGuardian.ts` | marcador `data-app="waioprime"` → `data-app="copysync"` **nos dois ao mesmo tempo**, senão o DomGuardian remove os estilos globais |
| `app/src/app/AppLayout.tsx` | logo `src`, `alt`, texto "WaioPrime" (3×), tooltip de versão |
| `app/src/app/AppLayout.tsx` | chave `localStorage` `waioprime-sidebar-collapsed` → `sidebar-collapsed` (white label). Efeito: usuário perde só a preferência de sidebar recolhida |
| `app/src/pages/LoginPage.tsx` | logo, nome (2×) e rodapé "© … WaioPrime" |
| `app/src/features/chat/mock/conversations.mock.ts` | textos de mock citando WaioPrime |
| `app/.env.dev` | `VITE_DEV_PROXY_TARGET`/`VITE_API_URL` → `https://api.copysync.app`; comentário de origem |
| `app/src/utils/resolveMediaUrl.ts` | comentários com `api.waioprime.com` |
| `app/public/assets/` | remover `logo_waiochat.png`, `waio*.png`, `waiochat-pro*.png` **depois** que nada mais referenciar (`grep -rn "logo_waiochat\|waioLogo\|waioFavicon" app/src app/index.html`) |
| `app/package.json` | `"name": "waioprime-app"` → `"copysync-app"` |

Checar i18n: o nome do produto exibido deve vir de uma constante única (ex.: `APP_NAME` em
`app/src/config`), não ficar duplicado em cada tela. Validar modos sistema/claro/escuro com o logo novo
(fundo branco do PNG pode exigir versão com fundo transparente).

### Tela de login (2026-10-12)

`app/src/pages/LoginPage.tsx` foi redesenhada com proporção áurea (constantes em
`app/src/pages/login/goldenRatio.ts`: `PHI`, `GOLDEN_SPLIT` 61,8 % painel × 38,2 % formulário no
desktop, tipografia 16 → 26 → 42 px, espaçamentos 8 × φⁿ, headline na linha áurea de 38,2 % do
painel). Subcomponentes: `LoginShowcasePanel` (desktop), `LoginMobileBanner` (xs/sm) e
`loginContent.ts` (copy, provas com tooltip e caminhos das fotos).

Fotos reais em `app/public/assets/login/` (`team-hero.webp` ≈ 96 KB + 3 avatares ≈ 3 KB), WebP,
com overlay navy `#0b1a4a` para contraste. Autor, origem e licença (Unsplash License) em
`app/public/assets/login/CREDITS.md`. Para trocar: converter com Pillow (`quality=78`, ≤ 250 KB),
salvar na pasta, atualizar `LOGIN_IMAGES` em `loginContent.ts` e a tabela do `CREDITS.md`.
A marca aparece só via `APP_NAME`/`BrandLogo`; nenhum texto literal.

**Vídeo ambiente (2026-10-12).** No desktop o fundo do painel é `LoginAmbientVideo`
(`app/src/pages/login/LoginAmbientVideo.tsx`): poster `team-poster.webp` (1º frame) + `<video>`
em loop (`team-ambient.webm` / `.mp4`, 1280×720, 24 fps, 12 s, sem áudio, ≈ 0,9 MB cada), atrás
do mesmo overlay navy. O `<video>` só é montado após o primeiro paint (`requestIdleCallback`),
com fade de 600 ms no `canplay`; não é criado com `prefers-reduced-motion: reduce`, `Save-Data`
ou rede `2g`/`slow-2g` (hook `useAmbientVideoAllowed`), pausa com a aba oculta e `play()`
rejeitado deixa o poster. Mobile continua só com `team-hero.webp`. Origem/licença em `CREDITS.md`.

Para trocar pelo vídeo da equipe real (`source.mp4`, escolhendo `-ss` início do melhor trecho,
12 s úteis + 1 s extra para o crossfade de loop; alvo ≤ 2,5 MB mp4 / ≤ 2 MB webm — subir o
`crf` ou encurtar se passar). O filtro faz o último segundo do trecho desvanecer sobre o
primeiro, então o fim emenda no início sem salto:

```sh
FG='[0:v]scale=1280:-2,fps=24,split[s0][s1];[s0]trim=0:12,setpts=PTS-STARTPTS[c];[s1]trim=12:13,setpts=PTS-STARTPTS[e];[e][c]xfade=transition=fade:duration=1:offset=0[v]'
ffmpeg -ss 8 -i source.mp4 -t 13 -filter_complex "$FG" -map '[v]' -an \
  -c:v libx264 -crf 28 -preset slow -profile:v high -pix_fmt yuv420p -movflags +faststart team-ambient.mp4
ffmpeg -ss 8 -i source.mp4 -t 13 -filter_complex "$FG" -map '[v]' -an \
  -c:v libvpx-vp9 -crf 36 -b:v 0 -row-mt 1 -pix_fmt yuv420p team-ambient.webm
ffmpeg -i team-ambient.mp4 -frames:v 1 poster.png   # 1º frame do trecho = poster, sem salto
python3 -c "from PIL import Image; Image.open('poster.png').convert('RGB').save('team-poster.webp', quality=74, method=6)"
```

O loop é garantido no componente: atributo `loop`, retomada ao voltar de `document.hidden` e,
se `ended` disparar, `currentTime = 0` + `play()`.

**Reveal do texto (2026-10-12).** `app/src/pages/login/loginReveal.ts` define o keyframe
`loginRise` (14 px ↑, fade, blur 6 → 0, 520 ms, `cubic-bezier(.2,.7,.2,1)`) e `revealSx(delayMs)`.
No painel desktop: headline palavra a palavra (stagger 70 ms), subtítulo em 420 ms, índice e
prova social a partir de 600 ms (60 ms/item); logo não anima. Mobile: só a headline curta.
Regras: o `@keyframes` é registrado pelo `sx` do container (`REVEAL_KEYFRAMES`), o estado final
é o natural do elemento (nunca `opacity: 0` fora do keyframe — se a animação falhar o texto
aparece) e `prefers-reduced-motion: reduce` desliga tudo (`animation: none`). Para ajustar tempos,
mudar as constantes `REVEAL_*` nesse arquivo.

Salvar os três em `app/public/assets/login/`, ajustar `objectPosition` em `LoginShowcasePanel`
se o enquadramento mudar e atualizar a tabela do `CREDITS.md`.

## Fase 3 — API (`api/`) ⏳

| Arquivo | Trocar |
|---------|--------|
| `api/src/app/app.ts` | fallback de CORS: `https://copysync.app`, `https://www.copysync.app` (manter os antigos até o DNS antigo ser desligado) |
| `api/src/app/app.ts` | OpenAPI: `title: 'CopySync API'`, descrição, `contact` (`dev@copysync.app`), server de produção `https://api.copysync.app` |
| `api/prisma/seed.ts` | e-mail do usuário seed (`copysyncapp@gmail.com`) — decidir novo e-mail; **não** altera banco existente |
| `api/package.json` | `"name": "waioprime-api"` → `"copysync-api"` |

Deploy na Render: cadastrar domínios `copysync.app` (static) e `api.copysync.app` (web) e
atualizar `CORS_ORIGIN` e `VITE_API_URL` nas envs. Só depois remover os domínios antigos.

## Fase 4 — Tooling e infra ⏳ (opcional, baixo valor)

Identificadores abaixo funcionam e são locais ao dev. Renomear exige recadastrar secrets e
recriar volume Docker. Fazer só se houver motivo.

| Onde | Identificador | Custo de renomear |
|------|---------------|-------------------|
| `docker-compose.yml`, `api/db.instructions.md`, `.github/MCP_SETUP.md` | container `waioprime_postgres`, banco/usuário `waioprime` | recriar volume local (perde dados locais) |
| `.cursor/scripts/mcp/*`, `.cursor/MCP_SETUP.md`, `.github/MCP_SETUP.md` | Keychain `waioprime-mcp-*`, função `cursor-waioprime`, env `WAIOPRIME_ROOT` | recadastrar 4 secrets no Keychain + reinstalar scripts |
| `render.yaml` | `name: waioprime` (serviço static) | criar serviço novo na Render |
| `dbeaver.command` | workspace `WaioChat` | caminho local do DBeaver |

## Nunca renomear

- **Banco de produção na Render**: nome `waioprime` e usuário `waiochat_jesus` na `DATABASE_URL`
  (AGENTS.md). Renomear = migração de banco, fora do escopo do rebranding.
- **Chaves de evento interno, rotas HTTP, nomes de tabela/coluna Prisma**: já são white label; não
  contêm marca.
- **Histórico de CHANGELOG e migrations aplicadas**.

## Como verificar

```bash
# referências de marca fora de node_modules/legado (esperado: só Fase 4 + histórico)
grep -rniE 'waio' --exclude-dir=node_modules --exclude-dir=legado1 --exclude-dir=legado2 \
  --exclude-dir=.git --exclude-dir=dist . | grep -v CHANGELOG
```

Após cada fase: `pnpm tsc --noEmit` em `api/` e `app/`, bump de versão nos dois `package.json`
e entrada no `CHANGELOG.md`.
