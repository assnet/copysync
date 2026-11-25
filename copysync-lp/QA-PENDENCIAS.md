# CopySync — nova página de vendas · QA e pendências

Brief: v5 (Sessões 007–011, 16/11/2026). Projeto: `copysync-lp/` (Vite + React + TS + Tailwind + Motion, HTML pré-renderizado no build).

- `npm run dev` → mostra os avisos ⚠️ PENDENTE em amarelo (só em desenvolvimento).
- `npm run build` → versão de publicação em `dist/` (sem avisos).
- `npm run shot -- <url> <saida.png> <largura> [--full|--selector=#id] [--reduce]` → capturas de QA.

## ⚠️ Pendências

O zip não tem nenhuma marcação amarela (varredura feita em 18/11/2026). O que ainda vale resolver:

| # | Item | Onde mudar |
|---|------|-----------|
| 1 | **Prazos reais com o desenvolvedor**: o que a ferramenta guarda das mensagens dos grupos, por quanto tempo, e o prazo de exclusão após o cancelamento. Até lá, a política diz só "apagados ou anonimizados após o fim do contrato" (decisão do Israel, 17/11/2026: não usar os exemplos de 30 dias) | `public/privacidade/index.html` (seções 3 e 7) |
| 2 | **Razão social e e-mail do canal de privacidade** (o Israel manda depois). Por enquanto, o canal é só o WhatsApp | `public/privacidade/index.html` (topo) |
| 3 | **Revisão jurídica** dos Termos e da Política de privacidade (recomendada) | `public/termos/`, `public/privacidade/` |

Política de privacidade (17/11/2026): sem razão social (pedido do Israel), controladora "CopySync · CNPJ 37.309.645/0001-10"; canal de privacidade só pelo WhatsApp (o e-mail não foi informado); "nenhum recurso usa dados de um cliente para atender outros" (confirmado como verdadeiro pelo Israel em 17/11/2026).
Aviso de cookies (17/11/2026): aplicado. Consent Mode com tudo negado por padrão no `<head>`; a escolha fica salva no navegador (`cs-consent`) e o aviso não volta.

Resolvidas em 16/11/2026 (respostas do Israel):
- Tempo real de 3 s: headline com "Segundos" e cronômetro da animação terminando em 3 s.
- Funciona com o computador desligado: FAQ 1 escrito com isso (a sessão do WhatsApp/Telegram precisa estar conectada).
- Os preços riscados do mensal foram cobrados de verdade, então ficam.
- Reembolso dos 7 dias pelo WhatsApp +55 51 99778-1476 (FAQ 5, Termos e rodapé).
- O vídeo é apresentação de vendas: título "Veja a CopySync em vídeo".
- As 3 etapas da demonstração batem com o painel.
- Plano anual: cancela quando quiser, a renovação é interrompida e, depois dos 7 dias de garantia, há reembolso proporcional ao período não usado (FAQ 5 e Termos, seção 6).
- Rodapé: CNPJ 37.309.645/0001-10, contato no WhatsApp com o número à mostra, Termos e Privacidade criados (`/termos/` e `/privacidade/`).
- Tooltips do Bloco 5: copiados do código do app.

Decidido: sem razão social no rodapé (só na Política de privacidade). Tags de medição ficam para depois.

Shein (17/11/2026): logo com etiqueta MAX no hero e na demonstração (etapa 2); o cabeçalho dos planos já tinha. Nos cartões LITE e PRO, não. No FAQ e no fechamento não havia logos de marketplaces (só texto, que já cita a Shein), então não foram criadas logos novas ali.

## Prova real (18/11/2026)

- Palco dos recursos (18/11/2026): fundo índigo-violeta com chão em perspectiva (só CSS), contador 0→156 ("156 enviados hoje" no Achei Presente), cartões com cor própria (Story rosa/laranja, Gerador verde, Página azul, Intercalar violeta/turquesa), textos "Antes / Com a CopySync", inclinação 3D ao rolar (e com o mouse no desktop) e CTA "Ver planos". Regra: o gradiente índigo dos botões de compra não entra em nenhum elemento decorativo.
- Hero: 3 cartões de oferta atrás do celular (sapatilha e notebook dos prints; fone como ilustração), com parallax. Com "reduzir movimento", tudo parado e o contador já em 156.
- Recortes dos clipes refeitos para não cortar palavra: no 16:9, painel inteiro; no 4:5, trecho a 0,65x (Monitoramento) ou uma coluna (Tutorial).
- Planos: a página abre com o **Anual** selecionado (pedido do Israel, 18/11/2026); a chave troca para o mensal.

- Clipes: `python3 scripts/clips.py [id …]` gera, a partir de `material-real/`, as versões 16:9 (desktop) e 4:5 (celular) em MP4 (H.264) e WebM, sem áudio, mais o poster. Saída em `src/assets/media/` (o build põe hash no nome). Os trechos, recortes e borrões estão no próprio script.
- Borrões: fotos de perfil das sessões, nomes dos grupos concorrentes monitorados, "Tenant: …" e o aviso "Shopee sem credencial" no Intercalar. O e-mail e o nome do usuário (canto inferior esquerdo) ficam fora de todos os recortes (o menu lateral foi cortado). Nomes de sessão, telefones e textos das ofertas já vinham borrados pelo modo Privacidade do painel.
- Monitoramento: trecho de 14,5 s a 20,8 s da gravação, antes da tela de credenciais (aviso da Shein) e longe do aviso da Shopee.
- Prints: só o da sapatilha e o do notebook (o do relógio não é usado). Os nomes dos membros no topo foram borrados.
- `material-real/` não entra no zip.
- O Achei Presente é grupo da CopySync (confirmado pelo Israel em 18/11/2026): o nome aparece na legenda da seção "Direto do Nosso Grupo", nos prints e no clipe do Gerador.

## Medição (seção 7)

- Instalada em 19/11/2026: tag do Google (gtag.js) no `<head>` do `index.html`, logo depois do Consent Mode: GA4 `G-C0DJZKPX9S` e Google Ads `AW-18410182876` (só a tag base, sem conversão de compra: a compra é medida pela Cakto). Linker do Google para `pay.cakto.com.br`.
- `clique_assinar` (parâmetros `plano` e `periodo`) vai só para o GA4 em qualquer clique num link para pay.cakto.com.br, inclusive clique do meio (`src/lib/checkoutClicks.ts`).
- Os links da Cakto recebem `gclid`, `gbraid`, `wbraid` e `utm_*` da URL da página (`withCampaignParams`).
- As páginas `/termos` e `/privacidade` não têm a tag (só a página de vendas).
- Testes: `node scripts/tag-test.mjs` (consentimento, evento, links, linker) e `node scripts/tag-reload-test.mjs` (visita com aceite/recusa salvos).
- Continuam no `dataLayer` (para um GTM no futuro): `cta_click`, `video_play`, `plan_select`, `checkout_start`.
- `video_50`: não implementado. A fachada leve usa o embed simples, sem a API do YouTube; medir 50% exige carregar a IFrame API após o clique.
- `purchase` e a conversão sem duplicidade acontecem no checkout (Cakto): configurar lá (ou via postback).
- UTMs e gclid/gbraid/wbraid da URL são repassados para os links de checkout (testado).

## Resultados (build de produção, servidor local)

- Lighthouse mobile: **Performance 96–97**, Acessibilidade 96, Boas práticas 100, SEO 100.
- FCP 1,1–1,2 s · **LCP 2,6 s** (meta do brief: < 2,5 s, ainda não atingida) · TBT 20–90 ms · **CLS 0** · 313 KiB no total (meta < 1 MB ✓).
- O LCP foi medido em `vite preview` (sem CDN). Contraste: só o preço riscado do Bloco 5 fica em 4,47:1 (cor do app; o mínimo é 4,5:1).
- `prefers-reduced-motion`: todas as animações mostram o estado final parado (conferido).
- Sem rolagem horizontal em 390 px; hidratação sem erros.

## Decisões tomadas fora do texto do brief (revisar)

1. O arquivo `brief-pagina-copysync (1).md` não existia; usei `~/Downloads/brief-pagina-copysync.md`, que já estava na v5.
2. Aviso do rodapé ampliado para "WhatsApp, Telegram, Shopee, Mercado Livre, Amazon ou Shein", porque Telegram e Shein aparecem na página.
3. Ícones de WhatsApp e Telegram aparecem só na tabela de canais do Bloco 5 (o brief pede, e é igual ao app). A interface de chat do restante da página é genérica.
4. Legenda do hero: "Ilustração do funcionamento." (sem "gravação real", pela regra da v3).
5. Bloco 5: alguns cinzas ficaram um tom mais escuros que no app para passar no contraste mínimo, e as notas legais (renovação e taxa) ficaram mais legíveis.
6. Barra fixa do celular: "Quero automatizar" em telas com menos de 400 px, por falta de espaço.
7. Fonte do texto corrido com `font-display: optional` (sem troca tardia de fonte); títulos com `swap`.
8. O JS carrega depois do primeiro paint (o HTML já vem pronto); em aba de fundo, depois de 1,2 s.

## Critério de pronto (seção 8)

- [ ] Teste do borrão (3 pessoas) · [ ] Teste dos 5 segundos — precisam de pessoas
- [x] Lighthouse mobile ≥ 85 em Performance
- [x] Todos os ⚠️ PENDENTE resolvidos (falta só a revisão jurídica dos textos legais, recomendada)
- [x] CTAs levam ao checkout/planos corretos (links do brief, com UTM)
- [ ] Eventos de conversão disparando no Tag Assistant (depende das tags)
- [x] `prefers-reduced-motion` respeitado
- [x] Página atual (copysync.top) intacta (nada foi publicado)

## Teste do borrão

Abra a página com `?borrao=1` no fim do endereço (ex.: `https://afiliados.copysync.top/?borrao=1`). Todo o texto vira mancha; logos, ícones e animações continuam nítidos. Sem o parâmetro, nada muda.

## Hostinger (afiliados.copysync.top)

- Pacote: `copysync-lp/copysync-lp.zip`, com o conteúdo do `dist` na raiz (index.html, .htaccess, assets/, termos/, privacidade/…).
- Subir: hPanel → Arquivos → Gerenciador de arquivos → pasta do subdomínio (`public_html` dele) → enviar o zip → Extrair. O `.htaccess` é um arquivo oculto: confira que ele está lá.
- O `.htaccess` (testado num Apache 2.4 local): força HTTPS; `/privacidade` e `/termos` ganham a barra final num único redirecionamento; rotas desconhecidas caem no index.html; gzip; cache de 1 ano só nos arquivos com hash; bloqueia o download do próprio `.htaccess`.
- Para gerar de novo: `npm run build` e, dentro de `dist/`, `zip -r ../copysync-lp.zip .`.
- Gerador (18/11/2026): clipe trocado pela gravação `gerador-156.mov..mov` (fila com "2 aguardando", "156 enviados hoje" e a aba "Concluídos hoje (156)"). É uma montagem com recortes da própria gravação: o aviso laranja "O próximo envio está atrasado..." e a linha da sessão ficaram de fora; no 4:5 a descrição de cada oferta quebra em 2 linhas, sempre entre palavras. E-mail/nome e sessões não aparecem em nenhum quadro.
- Monitoramento (18/11/2026): o 16:9 agora começa direto na lista "Ofertas capturadas" (sem "Formato da imagem" / "Em breve").
- Planos e custo (18/11/2026): no celular os cartões seguem a ordem LITE, PRO, MAX (igual ao desktop). Novo bloco "Quanto Custaria Fazer Isso Sem a CopySync?" entre o palco e os planos, com os valores de referência passados pelo dono (salário mínimo 2026 R$ 1.621; Canva Pro R$ 34,90; ChatGPT Plus R$ 99,90; consultados em nov/2026). Faixa do anual ("menos de 8 meses": à vista ÷ mensal = 7,69 LITE, 7,71 PRO, 7,72 MAX), garantia em destaque abaixo dos cartões e a frase de urgência acima de "Escolha seu plano" e no fechamento.
- Bloco de custo animado (18/11/2026): cartões entram um a um (escala 1.15 → 1 com tremor, 380 ms, 250 ms entre eles), total preso na base da tela somando R$ 0 → 810 → 844,90 → 944,80 e o selo "+ isso, que não tem preço" no 4º cartão; comparação "Por fora ≈ R$ 944/mês" × "Na CopySync a partir de R$ 77/mês". Sem JS, com pulo direto ou com "reduzir movimento": tudo visível e total final. Teste: `node scripts/cost-sequence.mjs`.
- Bloco de custo (ajuste): a barra do total não fica mais presa na tela (cobria os cartões no celular); ela entra depois do último cartão e soma R$ 0 → 810 → 844,90 → 944,80 + selo. Saiu o cartão cinza "Por fora"; ficou o cartão azul "Na CopySync" centralizado, com "vs". FAQ ganhou "O dono do grupo monitorado percebe?" e "Preciso saber de tecnologia?" (13 aulas em 3 trilhas).
- Oferta (18/11/2026): selo do Anual "até −36% à vista" (à vista ÷ 12 mensalidades: LITE −35,95%, PRO −35,7%, MAX −35,6%). Linha "Preço travado" abaixo da faixa do anual e no fechamento; FAQ "O preço pode aumentar depois que eu assinar?"; Termos ganharam a cláusula 6 "Manutenção de preço" (cláusulas seguintes renumeradas 7–11; item da cláusula 5 passou a dizer "Preços e planos podem mudar para novos clientes… (veja a cláusula 6)"; data de atualização 18/11/2026).
- Microsoft Clarity (20/11/2026), projeto `zgmja8fnyk`: só é baixado com consentimento (no "Aceitar" ou, para quem já aceitou, depois do "load" da página), com `clarity('consentv2', granted)`. Motivo: mesmo no "modo sem cookies", o download do script e os pixels do Clarity gravam cookies da Microsoft (CLID, MUID, MR, SM, ANONCHK), testado em 20/11/2026. Rodapé (telefone e CNPJ) com `data-clarity-mask`; a página não tem campos de formulário (o Clarity mascara campos sempre). Política de privacidade atualizada (seções 1, 4, 5 e 6). Teste: `node scripts/clarity-test.mjs`. Lighthouse mobile antes 88/93/94, depois 90/94/94.
- Hero novo (21/11/2026): título "Sua venda está caindo no link de outro afiliado.", subtítulo "A CopySync monitora grupos de ofertas e posta no seu com o SEU link. Sozinha.", botão "Quero meu grupo no automático" (→ #planos, evento `cta_click` cta=`quero_automatico`), linha "Planos a partir de R$ 77/mês no anual · 7 dias de garantia" (LITE anual = 12x de R$ 77, conferido em `plans/data.ts`) e link "Ver como funciona ↓" (→ #demonstracao, cta=`ver_como_funciona`). Visual: `src/sections/hero/SwapStage.tsx` + keyframes `swap-*` em `index.css` (só CSS, transform/opacity, loop de 6 s; JS só para parallax e pausa fora da tela; "reduzir movimento" = estado final parado). A versão anterior está em `src/sections/HeroLegacy.tsx` (como voltar: no topo do arquivo). A linha de preço do fechamento passou a ser a mesma do hero: "Planos a partir de R$ 77/mês no anual · 7 dias de garantia" (escudo dentro do texto, para quebrar bem no celular). A barra fixa do rodapé no celular agora mostra "R$ 77/mês no anual" numa linha (`PRICE_FROM` em `config.ts`); "a partir de R$ 77/mês no anual" caberia em 360px, mas deixava o botão sem folga. Com o preço mais largo, o rótulo longo do botão ("Quero automatizar meus grupos") passou a aparecer só a partir de 430px (antes 400px), senão quebrava em 2 linhas em 412px. Print: `qa/barra-fixa.png` (`node scripts/sticky-shot.mjs`).
  - Altura do hero (ajuste de 21/11/2026): no celular, a natural (sem vão antes do bloco 2); a partir de 640px, no mínimo 100svh (o bloco 2 escurece a página ao entrar na tela). A disputa de banda que piorava o LCP foi resolvida no bloco "Direto do Nosso Grupo": os dois prints (185 KB) só são pedidos quando a lista chega a 300px da tela (IntersectionObserver em `RealProof.tsx`), com `fetchpriority="low"`, e há `<noscript>` com o print normal. Teste: `node scripts/hero-transition.mjs` (0 prints ao abrir, 2 depois de rolar, sem escurecimento na abertura).
  - Primeira tela sem rolar (selo, título em 2 linhas, subtítulo, animação, botão e preço) conferida em 390×844, 390×740 (navegador do app do YouTube), 390×664, 390×640 e 360×640: `node scripts/hero-fold.mjs`. Quadros da animação: `node scripts/hero-frames.mjs`. Links, pausa e "reduzir movimento": `node scripts/hero-extra.mjs`.
  - Lighthouse mobile: antes 94/93/91 (LCP 3,0 s, 720 KB); depois 92/94/94 (LCP 3,0 s, 712 KB), já com o hero na altura natural. Peso: HTML −0,5 KB e JS +0,4 KB (gzip); a foto do notebook (9 KB) saiu da primeira tela.
- Funil anônimo sem cookies (21/11/2026), para todos os visitantes: `src/lib/funnelBeacon.ts` faz GET em `/b.gif?e=EVENTO&c=UTM_CONTENT&r=ALEATÓRIO` com `fetch` + `keepalive`, `credentials: 'omit'` (não leva nem os cookies do GA/Clarity de quem aceitou) e sem Referer (a URL pode ter gclid). Eventos, cada um no máximo 1× por carregamento: `load` (no evento load), `stay5` (5 s somando só o tempo com a aba visível), `scroll50` (passou de 50% da rolagem possível), `assinar` (clique, inclusive do meio, em link para pay.cakto.com.br; não segura a navegação). `public/b.gif` (GIF 1×1, 42 bytes) com `Cache-Control: no-store` no `.htaccess`, sem ETag/Last-Modified e sem Set-Cookie. Política de privacidade: item "Medição anônima, sem cookies" na seção 1 e menção na base "legítimo interesse" da seção 4 (data 21/11/2026).
  - Testado num Apache 2.4 local com o `.htaccess` real (`scripts/apache-local.conf.example`): 4 eventos 1× cada, `c=video_b` vindo do utm_content, `r` diferente a cada pedido, nenhum cookie enviado/criado, localStorage intocado, registro de acesso com os 4 pedidos (`node scripts/funnel-test.mjs`); aba escondida não conta para o stay5 (`node scripts/funnel-hidden-test.mjs`). GA4/Ads/Clarity iguais (`tag-test`, `tag-reload-test`, `clarity-test`). Lighthouse mobile 93/94/92, LCP 3,0 s.
  - Como contar no cPanel: Métricas → Acesso bruto (Raw Access) → baixar o .gz do domínio afiliados.copysync.top → `gzip -dc ARQUIVO.gz | grep -o 'b.gif?e=[a-z0-9]*' | sort | uniq -c` (por anúncio: `grep -o 'b.gif?e=[a-z0-9]*&c=[^&]*'`). Robôs que não executam JavaScript não geram esses pedidos.
