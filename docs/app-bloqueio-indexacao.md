# Painel (`app/`) invisível para buscadores

O painel administrativo roda em `app.copysync.app` e é área privada (login obrigatório).
Nenhum buscador, crawler ou arquivador deve rastrear, indexar ou exibir qualquer URL dele.

## Três camadas (todas obrigatórias)

| Camada | Arquivo | O que faz | Limite |
|---|---|---|---|
| `robots.txt` | `app/public/robots.txt` | `Disallow: /` para `User-agent: *` — crawlers educados nem baixam as páginas | Só é uma **sugestão**; não impede indexação de uma URL descoberta por link externo |
| `<meta name="robots">` | `app/index.html` | `noindex, nofollow, noarchive, nosnippet, noimageindex, notranslate` | Vale só para o HTML; assets (JS, CSS, imagens, manifest) ficam fora |
| `X-Robots-Tag` | `render.yaml` → `headers` | Mesmas diretivas como header HTTP em `/*` — cobre **toda** resposta do static site | Depende do deploy na Render (Blueprint) |

Por que as três: `robots.txt` bloqueia o rastreio; `noindex` (meta + header) garante que, se
um buscador chegar por link externo, a URL não entra no índice nem gera snippet/cache. O header
estende a regra a arquivos não-HTML. Juntas, o subdomínio fica invisível.

O SPA tem rewrite `/* → /index.html`, mas a Render serve arquivos existentes antes do rewrite,
então `/robots.txt` é entregue como arquivo real.

## Headers de segurança do static site (render.yaml → `headers`)

Além do `X-Robots-Tag`, o painel envia `Content-Security-Policy`, `X-Content-Type-Options: nosniff`
e `Referrer-Policy: strict-origin-when-cross-origin`. Valor atual do CSP:

```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; media-src 'self' blob: data: https://api.copysync.app https://pub-38f8c0e80d0e437f97881e64c0f408bb.r2.dev https://media.copysync.app; font-src 'self' data:; connect-src 'self' https://api.copysync.app wss://api.copysync.app https://pub-38f8c0e80d0e437f97881e64c0f408bb.r2.dev https://media.copysync.app; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests
```

| Diretiva | Por quê |
|---|---|
| `style-src 'unsafe-inline'` | MUI/Emotion injeta `<style>`; `index.html` tem `<style data-app>`. Sem isso o layout some |
| `connect-src https://api.copysync.app wss://api.copysync.app` | REST (Axios), SSE e WebSocket do chat. Sem isso nenhuma chamada sai, login falha com "Failed to fetch" |
| `media-src https://api.copysync.app` | áudio/vídeo do chat servidos pela API (`resolveMediaUrl`), mídia antiga em disco |
| `media-src` + `connect-src` do bucket R2 (`pub-…r2.dev`, `media.copysync.app`) | com `MEDIA_STORAGE_DRIVER=s3` a mídia nova toca direto do bucket; `fetch` faz `HEAD` do tamanho do documento e a forma de onda do áudio. Trocar `S3_PUBLIC_URL` = trocar aqui |
| `img-src https:` | fotos de perfil e mídias de CDN externas |
| `worker-src blob:` | workers de upload/mídia |
| `frame-ancestors 'none'` | painel não pode ser embutido em iframe (clickjacking) |

Incidente 2026-10-27: com o storage no R2, imagens apareciam (`img-src https:`) mas áudio, vídeo
e documento não, porque `media-src`/`connect-src` só liberavam a API. O bucket estava certo (206 com
Range, `Content-Type`, CORS para o painel).

Incidente 2026-10-12: CSP no dashboard apontava `connect-src`/`frame-src` para domínios de outro
projeto (`pulsosocial`) e `style-src 'self'` sem inline → login impossível e tela sem estilo.
**Ao trocar domínio da API ou do painel, atualizar este header primeiro.**

Serviço na Render chama-se `copysync_app`; `render.yaml` ainda declara `waioprime`. Se o Blueprint
não estiver vinculado, os headers precisam ser replicados à mão em **Settings → Headers**.

## Como verificar após deploy

```bash
curl -s https://app.copysync.app/robots.txt
curl -sI https://app.copysync.app/ | grep -i -E 'x-robots-tag|x-content-type|referrer|content-security'
curl -sI https://app.copysync.app/site.webmanifest | grep -i x-robots-tag
curl -s https://app.copysync.app/ | grep -i 'name="robots"'
```

Esperado: `Disallow: /`; header `X-Robots-Tag: noindex, nofollow, ...` em todas as respostas;
meta `robots` presente no HTML.

Se alguma URL já estiver indexada, usar remoção no Google Search Console / Bing Webmaster;
`noindex` remove no próximo rastreio.

## O que NÃO fazer

- Não remover nenhuma das camadas achando que outra basta (ver coluna "Limite").
- Não criar `sitemap.xml` para o painel.
- Não adicionar `<meta name="robots">` com `index` em nenhuma página do `app/` — nem na de login.
- Não aplicar estas regras à landing/site público (`copysync.app`), que **deve** ser indexado.
- `X-Robots-Tag` só na Render; se o host mudar, recriar o header no novo host.
