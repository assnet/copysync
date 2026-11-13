# Tutoriais (central de videoaulas)

Aba **Tutoriais** do produto Afiliados: `/affiliates/tutorials` (app 0.120.0). Vitrine de aulas em vídeo
com memória do que o usuário já assistiu e do ponto em que parou. Modelo: central de tutoriais da Pulso,
com cores e logo da marca (hero em azul profundo, `BrandLogo`).

## Onde fica cada coisa (`app/src/features/tutorials/`)

| Peça | Arquivo | Nota |
|---|---|---|
| Acervo | `catalog.ts` | `id`, `number`, `group`, `youtubeId` (`null` = "Em breve") |
| Textos | `strings.ts` | título/descrição por `lessons[id]`; padrão i18n do painel |
| Progresso (puro) | `progress.ts` | status, retomada, próxima aula, estatísticas, `sanitize` |
| Persistência | `useTutorialProgress.ts` | `usePersistedState('tutorials.progress.<userId>', escopo 'browser')` |
| Player ↔ página | `youtubeBridge.ts`, `components/useLessonPlayer.ts` | `postMessage` do iframe |
| Busca | `search.ts` | sem acento/caixa, todos os termos; tecla `/` foca |
| Visual | `style.ts` | só tokens do tema (claro/escuro); `THUMB_*` fixos escuros p/ texto sobre capa |
| Telas | `TutorialsPage.tsx`, `components/{TrailHero,TrailPanel,LessonCard,LessonPlayerDialog}.tsx` | |

## Tela

Inspirada na central da Pulso (só visual), com tokens e componentes do painel: hero com pílulas e aula em destaque
("Comece por aqui" / "Continue de onde parou"), painel "Trilha guiada" (anel + barra), busca, filtros por estado e por
trilha, cards com ações (assistir/retomar, concluir, copiar link). Link `?aula=<id>` abre a aula e sai da URL.
Filtros, busca e aula aberta persistem em `usePersistedState` (escopo `tab`). A tela é remontada ao trocar de conta (`key`).

## Como publicar uma aula

1. Aula existente sem vídeo: preencha `youtubeId` no `catalog.ts`. Nada mais muda.
2. Aula nova: linha no `catalog.ts` (`id` kebab-case estável) + título e descrição em `strings.ts`.
3. Nunca renomear `id`: é a chave do progresso salvo.

## Progresso

- Só no navegador (sem API, sem dado pessoal). Chave por usuário: contas no mesmo navegador não misturam.
  Escopo `browser` (não `device`): é lembrança de estudo, sobrevive a sair/logout. Outro aparelho começa do zero (avisado na tela).
- Por aula: `position`, `duration`, `ratio` (maior fração vista), `done`, `views`, `lastAt`.
- Conclui com `ratio >= 0.9`, fim do vídeo ou botão. Reassistir um trecho de aula concluída não perde ponto nem conclusão.
- Retomada só se `position >= 15 s` e aula não concluída (`start=` no embed).
- "Continuar de onde parei": a em andamento mais recente; senão a 1ª pendente. Ordem é sugestão, nada é bloqueado.
- Estatística conta só aulas com vídeo.

## Leitura do player (sem script externo)

O CSP (`render.yaml`) libera só `frame-src` do `youtube-nocookie.com`. Por isso **não** se carrega
`https://www.youtube.com/iframe_api`. Com `enablejsapi=1`, a página envia `{"event":"listening"}` ao iframe
(repetido a cada 500 ms até a 1ª resposta) e recebe `infoDelivery`/`onStateChange`. Só se aceita mensagem
com `origin` do embed e `source === iframe.contentWindow`. Grava a cada 5 s tocando, ao pausar, ao fim e ao fechar.

## O que não fazer

- Carregar script do YouTube nem afrouxar o CSP para isso.
- Enviar progresso a servidor ou guardar dado pessoal.
- Bloquear aula por ordem.
- Nome da marca em texto de aula ou rótulo (white label).

## Pendências

- Aulas 7 (Gerador de ofertas), 9 (Página de Ofertas) e 10 (Story de Oferta) sem vídeo.
- Descrições curtas dos cards foram redigidas a partir do título: revisar com o conteúdo real das aulas.
- Aceito: desmarcar conclusão com o vídeo parado em ≥ 90% pode reconcluir no próximo tick do player.
- Leitura de progresso em reprodução real só validável em navegador com YouTube liberado (testes cobrem a lógica).
