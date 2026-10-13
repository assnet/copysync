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

## Como verificar após deploy

```bash
curl -s https://app.copysync.app/robots.txt
curl -sI https://app.copysync.app/ | grep -i -E 'x-robots-tag|x-content-type|referrer'
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
