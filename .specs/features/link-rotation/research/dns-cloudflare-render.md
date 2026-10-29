# Pesquisa: wildcard de tenants (`*.copysync.app`, `*.copysync.pro`) na API Render atrás da Cloudflare

Data: 2026-10-28. Pesquisa web, read-only. Legenda: **[OK]** confirmado em fonte oficial · **[~]** inferido / fonte secundária · **[?]** não confirmado.

## 1. Render — wildcard custom domain

- **[OK]** Wildcard é adicionado como qualquer custom domain (Settings → Custom Domains, ex. `*.example.org`). Só web services e static sites aceitam custom domain.
- **[OK]** Regra dura: "To use a wildcard domain, your root domain must *also* point to Render." Se o apex apontar para outro lugar, "your wildcard configuration will fail". Redirecionar o apex para o site de marketing → fazer no código da app (ou via Worker, item 3).
- **[OK]** DNS exigido (3 CNAMEs):
  - `*` → `<servico>.onrender.com`
  - `_acme-challenge` → `<servico>.verify.renderdns.com` (Let's Encrypt emite/renova o cert wildcard — na prática é DNS-01 delegado por CNAME; o doc não nomeia o challenge **[~]**)
  - `_cf-custom-hostname` → `<servico>.hostname.renderdns.com` (Cloudflare, provedor de DDoS da Render, valida o hostname → Render usa Cloudflare for SaaS por baixo **[~]**)
- **[OK]** "Render automatically creates and renews TLS certificates for all custom domains, including wildcard domains." CAs: Let's Encrypt e Google Trust Services. Se o domínio tiver CAA, incluir `issuewild` para `letsencrypt.org` e `pki.goog`.
- **[OK]** Não há opção documentada de upload de certificado próprio (Origin CA da Cloudflare não se aplica). HTTP→HTTPS forçado.
- **[OK]** Cota: Hobby 2, Pro 15, Scale 25 domínios por workspace; extra US$ 0,25/mês cada. Um wildcard conta como 1 domínio (não há limite separado para wildcard).
- **[OK]** Verificação: botão *Verify* no dashboard; falha → aguardar propagação/limpar cache público.
- **[~]** Roteamento por `Host`: staff da Render em community.render.com/t/wildcard-subdomains/14014 afirma que, após verificar `*.mydomain.com` e emitir o cert, qualquer nome sob o domínio chega ao serviço; um domínio de cliente apontando por CNAME para um subdomínio seu **não** chega (Render não conhece o hostname) e precisa ser cadastrado como custom domain. Thread não pôde ser aberta hoje (redirect para `render.discourse.group` sem DNS); citação vem do resumo de busca. A app deve ler o `Host` para identificar o tenant **[~]**. Não há doc oficial dizendo que Render repassa `Host` inalterado **[?]**.

Fontes: https://render.com/docs/custom-domains · https://render.com/docs/tls · https://community.render.com/t/wildcard-subdomains/14014 · https://community.render.com/t/custom-client-domains/2562

## 2. Cloudflare — wildcard proxied, Universal SSL, Host

- **[OK]** "Customers on all plans can create and proxy wildcard DNS records." Liberado para Free em **maio/2022** (blog "Wildcard proxy for everyone", 2022-05-03), antes era Enterprise. (O enunciado dizia 2021: errado.)
- **[OK]** Registro `*` casa **multinível** por padrão (`123.abc.example.com` também), salvo registro mais específico. Só aplica quando não existe registro exato no nome.
- **[OK]** Universal SSL (zona full setup) cobre **apenas apex + 1 nível** (`example.com`, `*.example.com`). `a.b.example.com` proxied → sem cert válido. Alternativas: Advanced Certificate Manager (+Total TLS) ou cert custom (planos altos). Para nosso caso (`tenant.copysync.app`) o Universal basta.
- **[OK]** Emissão Universal: 15 min a 24 h após ativação da zona.
- **[OK]** Render exige que a verificação/emissão aconteça com o registro em **DNS only** (nuvem cinza); só depois "você pode opcionalmente" ligar Proxied. Doc da Render recomenda modo **Full** (não cita Full strict). Full (strict) exige cert do origin de CA pública, não expirado, CN/SAN casando o hostname — a Render serve cert LE/GTS válido para `*.dominio`, então **Full (strict) funciona [~]** (não testado nem documentado explicitamente por nenhum dos dois).
- **[OK]** Remover todo `AAAA` da zona (Render não tem IPv6; "AAAA records can interfere").
- **[OK]** Cloudflare "passa todos os headers da requisição ao origin" e adiciona `CF-Connecting-IP`, `X-Forwarded-For`, `X-Forwarded-Proto`, `CF-Ray`, `CF-Visitor`. `Host` não é citado como alterado → repassa o original **[~]**. Reescrever `Host` só com Origin Rules **Enterprise** (Free/Pro/Business: "No").
- **[OK]** Caso orange-to-orange (apex proxied **sem** estar no mesmo serviço Render): tráfego do apex cai no origin do wildcard. Render diz: ou apex em nuvem cinza, ou Worker de origin override (abaixo).

Fontes: https://developers.cloudflare.com/dns/manage-dns-records/reference/wildcard-dns-records/ · https://blog.cloudflare.com/wildcard-proxy-for-everyone/ · https://developers.cloudflare.com/ssl/edge-certificates/universal-ssl/limitations/ · https://developers.cloudflare.com/ssl/edge-certificates/universal-ssl/enable-universal-ssl/ · https://developers.cloudflare.com/ssl/origin-configuration/ssl-modes/full-strict/ · https://developers.cloudflare.com/fundamentals/reference/http-headers/ · https://developers.cloudflare.com/rules/origin-rules/features/ · https://render.com/docs/configure-cloudflare-dns

## 3. Alternativa: Worker/Origin Rule reescrevendo Host → `api.copysync.app`

- **[OK]** Origin Rules "Override Host header" + "Override DNS record" = **Enterprise only**. Descartado.
- **[OK]** Transform Rules (request header modification) disponível em todos os planos: Free 10 regras, Pro 25, Business 50, sem regex no Free/Pro. Pode **adicionar** `X-Forwarded-Host` (não está na lista proibida: só `cf-*`, `x-cf-*`, `x-forwarded-for`, `x-forwarded-proto`, `true-client-ip`, `x-real-ip`, `cookie`, forbidden names). Mas não reescreve `Host`, e sozinho não resolve roteamento.
- **[OK]** Worker: `fetch('https://api.copysync.app' + path, {headers: {'X-Forwarded-Host': host}})` funciona em qualquer plano; `Host` de saída deriva da URL; `cf.resolveOverride` só dentro da mesma zona. Free: 100k req/dia, 10 ms CPU; excedeu → rota *fail open* (bypassa Worker) ou *fail closed* (erro 1027). Render documenta Worker apenas para o caso "apex para outro origin".
- **Veredito**: **mais simples e robusto é o wildcard nativo na Render** (item 1): sem Worker, sem cota diária, sem header spoofável, cert gerenciado. Worker só se o apex precisar ir para outro host (site de marketing) com nuvem laranja. Se usar Worker, a API deve confiar em `X-Forwarded-Host` **só** quando `Host === api.copysync.app` e a requisição vier de IP Cloudflare (`CF-Connecting-IP` presente) **[~]**.
- **Bots/crawlers**:
  - **[OK]** Bot Fight Mode (Free): não é configurável, **não pode ser pulado por WAF custom rule** ("cannot skip Bot Fight Mode"), protege o domínio inteiro, "may challenge API or mobile app traffic", JS Detections sempre on. Só exceção: IP Access Rules (e desliga sozinho se existirem). Risco alto para webviews do Instagram/TikTok → **não ligar** no domínio dos links.
  - **[OK]** Super Bot Fight Mode (Pro/Business): três grupos (Definitely/Likely automated, Verified bots) com Allow/Challenge/Block; "Custom rules are executed before Super Bot Fight Mode" → regra Skip para webviews.
  - **[OK]** Cloudflare: in-app browsers têm "restricted JavaScript capabilities"; webviews "may have limited functionality"; challenge falhando só em WebView → revisar settings do WebView. Ou seja, Managed Challenge em UA de Instagram/TikTok **pode** quebrar o redirect.
  - **[~]** Recomendação: WAF custom rule (Free tem 5) com ação **Skip** antes de qualquer challenge para `http.user_agent contains "Instagram" or http.user_agent contains "musical_ly" or http.user_agent contains "BytedanceWebview" or http.user_agent contains "FBAN" or http.user_agent contains "FBAV"` (strings de UA conhecidas; não há lista oficial Cloudflare **[?]**). Bloquear/desafiar só `cf.client.bot` não-verificado e UAs de scraper (`python-requests`, `curl`, `Go-http-client`, vazio) e rate limit por IP na rota de redirect. Não há documento Cloudflare específico sobre falso positivo em Instagram/TikTok **[?]**.

Fontes: https://developers.cloudflare.com/rules/transform/ · https://developers.cloudflare.com/rules/transform/request-header-modification/ · https://developers.cloudflare.com/workers/runtime-apis/request/ · https://developers.cloudflare.com/workers/platform/limits/ · https://developers.cloudflare.com/bots/get-started/bot-fight-mode/ · https://developers.cloudflare.com/bots/get-started/super-bot-fight-mode/ · https://developers.cloudflare.com/waf/custom-rules/skip/ · https://developers.cloudflare.com/cloudflare-challenges/reference/supported-browsers/ · https://developers.cloudflare.com/bots/troubleshooting/false-positives/

## 4. Verificar DNS programaticamente a partir da API

Opções (Node):

| Método | Prós | Contras |
|---|---|---|
| `dns.promises.Resolver` + `setServers(['1.1.1.1'])` → `resolveCname('_probe.<dominio>')` / `resolve4` | Sem cache do SO, resolver fixo, `resolve*` "always perform a DNS query on the network", roda fora do threadpool | Com proxy laranja o CNAME **desaparece** (Cloudflare achata para A/AAAA da borda) → `resolveCname` dá `ENODATA`; só `resolve4` retorna IPs Cloudflare, não prova que aponta para Render. Fallback entre servers só em timeout, não em NOTFOUND. Usar `dns.NODATA`/`dns.NOTFOUND` constantes, não strings. |
| DoH JSON `GET https://cloudflare-dns.com/dns-query?name=_probe.x&type=CNAME` com `Accept: application/dns-json` | HTTP puro, funciona em ambiente sem UDP 53, resposta com `Status`, `Answer[].data/TTL` | Mesma limitação do flattening; sem rate limit documentado **[?]** |
| HTTP probe: `GET https://_probe-<rand>.<dominio>/.well-known/<app>/domain-check` esperando token assinado da própria API | Prova fim a fim: DNS + proxy + TLS + Render roteou ao serviço certo + Host chegou. Independe de laranja/cinza | Underscore em hostname pode ser recusado por TLS/HTTP; usar label sem `_` (ex. `probe-<rand>.<dominio>`). Exige a rota já existir na API; precisa anti-SSRF (só hostnames sob domínios cadastrados, resolver e recusar IP privado) |
| Checar registros Render: `resolveCname('_acme-challenge.<dominio>')` deve ser `<svc>.verify.renderdns.com` e `_cf-custom-hostname` → `*.hostname.renderdns.com` | Esses registros ficam **DNS only** (não proxiáveis) → CNAME visível; confirma que o admin fez o passo da Render | Não prova que o wildcard `*` está certo |

Recomendação: **HTTP probe** como veredito ("domínio ativo") + checagem dos 2 CNAMEs `_acme-challenge`/`_cf-custom-hostname` via Resolver 1.1.1.1 como diagnóstico ("falta registro X"). Sem Puppeteer/curl: uso de `undici`/`fetch` nativo com timeout 5 s.

Fontes: https://nodejs.org/api/dns.html · https://developers.cloudflare.com/1.1.1.1/encryption/dns-over-https/make-api-requests/dns-json/

## 5. Recomendação final — passos por domínio novo (ex. `copysync.pro`)

1. Cloudflare: zona em full setup; **SSL/TLS = Full (strict)** (ou Full, como a Render documenta); remover qualquer `AAAA`; Bot Fight Mode **desligado** nesta zona.
2. Cloudflare DNS, tudo **DNS only (cinza)** por enquanto: `CNAME * → <svc>.onrender.com`, `CNAME @ → <svc>.onrender.com` (apex obrigatório), `CNAME _acme-challenge → <svc>.verify.renderdns.com`, `CNAME _cf-custom-hostname → <svc>.hostname.renderdns.com`. (CNAME no apex é flattening automático da Cloudflare.)
3. Render → serviço `api` → Custom Domains: adicionar `*.copysync.pro` **e** `copysync.pro`; clicar *Verify*; aguardar "Certificate issued" nos dois.
4. Cloudflare: trocar `*` e `@` para **Proxied (laranja)**; `_acme-challenge` e `_cf-custom-hostname` ficam cinza para sempre.
5. Cloudflare WAF: regra Skip para UAs de webview (Instagram/FB/TikTok) acima de qualquer challenge; Rate Limiting (Free: 1 regra) na rota de redirect; opcional challenge para `not cf.client.bot and UA de scraper`.
6. API: `LINK_DOMAINS=copysync.app,copysync.pro` (allowlist de sufixos; roteamento por `Host`; recusar Host fora da lista com 404). Apex responde redirect para o site de marketing (Render exige apex no serviço).
7. API: rodar o probe `GET https://probe-<rand>.copysync.pro/.well-known/...` e checar os 2 CNAMEs `renderdns.com`; marcar domínio como ativo só se o probe devolver o token.
8. Confirmar que o wildcard conta 1 na cota de domínios do plano Render (Pro 15).
9. Nunca: Origin Rule de Host (Enterprise), Worker de reescrita (cota 100k/dia, header spoofável), domínio de tenant em 2 níveis (`a.b.copysync.pro` fica sem cert no Universal SSL).
10. Testar com aparelho real abrindo o link dentro do Instagram/TikTok (emulação desktop não reproduz webview, segundo a Cloudflare).

## Não confirmado
- Doc oficial Render afirmando que repassa `Host` inalterado e que faz match de wildcard no roteamento (só evidência de staff no fórum, thread inacessível hoje).
- Compatibilidade explícita Render ↔ Cloudflare **Full (strict)** (Render só documenta "Full"; inferido pelo cert LE/GTS válido).
- Tipo exato de ACME challenge da Render (DNS-01 inferido pelo CNAME `_acme-challenge`).
- Lista oficial Cloudflare de UAs de in-app browsers e relatos oficiais de falso positivo Instagram/TikTok.
- Rate limit da API DoH JSON do 1.1.1.1.
- Se Transform Rule pode setar `X-Forwarded-Host` especificamente (não está na lista proibida; não testado).
