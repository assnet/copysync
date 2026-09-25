# Anexos e Mensagem de Voz no Chat — Especificação

**Módulos**: `media` (novo, api/) + `chat` + `messaging` (api/) + feature `chat` (app/)
**Escopo**: Complex (upload grande, processamento com ffmpeg, envio assíncrono, gravação no navegador, UI nova)
**Status**: Aprovado em 2026-09-25 — em execução
**Branch**: `feature/chat-media-attachments`
**Pré-requisito**: `fix/chat-reply-quote` em `develop` (`.specs/quick/001-restaurar-citacao-no-envio/TASK.md`)

---

## Problem Statement

O operador só envia texto pelo painel. Os botões de anexo e microfone existem, mas estão
desabilitados com "(em breve)" (`MessageComposer.tsx:137-143`, `:194-200`). Para mandar um
comprovante, uma foto, um vídeo ou um áudio, ele precisa pegar o celular — e o que é enviado
por lá não aparece para os outros operadores com o mesmo contexto. A porta
`sendMediaMessage` já existe no adapter, mas ninguém a chama, ela manda áudio com `ptt: false`
e documento sem nome nem MIME (`BaileysMessagingEngineAdapter.ts:203-220`), e a API não aceita
corpo acima de 1 MiB.

## Goals

- [ ] Operador envia documento, foto e vídeo (até **180 MB**) pelo painel e o contato recebe
      igual ao envio pelo WhatsApp Web (nome, legenda, miniatura, duração)
- [ ] Operador grava mensagem de voz no navegador (Chrome, Edge, Firefox, Safari) e o contato
      recebe como **nota de voz** tocável em Android, iOS, Web e Desktop, com duração e ondas
- [ ] Upload de 180 MB conclui em rede instável: retoma de onde parou, com progresso visível
- [ ] Nenhuma regressão no envio de texto, na mídia recebida, nas reações e nos ticks de status
- [ ] Memória da API estável durante envio de 180 MB (nada do arquivo inteiro em Buffer)

## Out of Scope

| Item | Motivo |
| --- | --- |
| Object storage (S3/R2) e URL assinada | Decisão do usuário (`context.md` D1). Fica no plano `docs/superpowers/plans/2026-05-09-chat-media-storage-architecture.md`; esta feature entrega a porta de storage que ele vai trocar |
| Transcodificar vídeo (MOV/WEBM/MKV → MP4) e GIF → MP4 animado | CPU e tempo altos na instância da API; esses arquivos vão como documento |
| Figurinha, localização, contato, enquete, "ver uma vez", câmera/webcam | Tipos distintos, sem pedido |
| Editor de imagem (recorte, desenho, texto) | Sem pedido |
| Presença "gravando áudio…" para o contato | Saída extra ao WhatsApp; ver decisão de volume em `STATE.md` (2026-09-21) |
| Cancelar envio depois que a API aceitou (fila do WhatsApp) | Cancelamento cobre só o upload ao servidor |
| Mensagem enviada pelo painel aparecer em tempo real para **outros** operadores | Pré-existente também no texto (a API não publica `chat.message.created` no envio). Dívida registrada |
| Player de voz com ondas no painel | O player nativo atual (`AudioMessage.tsx`) continua |
| Download em stream da mídia **recebida** (hoje `'buffer'`) | Pré-existente; dívida registrada |
| Encaminhar o mesmo arquivo para várias conversas | Sem pedido |

---

## User Stories

### P1: Enviar documento ⭐ MVP

**User Story**: Como operador, quero anexar um arquivo (PDF, planilha, zip, etc.) e enviá-lo ao
contato para não depender do celular.

**Why P1**: Caso mais frequente de atendimento (comprovante, contrato, boleto).

**Acceptance Criteria**:

1. WHEN o operador clica no clipe THEN o sistema SHALL abrir um menu com "Documento" e
   "Fotos e vídeos"
2. WHEN escolhe "Documento" e seleciona um arquivo de qualquer tipo com até o limite de
   documento (padrão 180 MB) THEN o sistema SHALL abrir a prévia com nome, tipo e tamanho
3. WHEN confirma o envio THEN o sistema SHALL mostrar a bolha na conversa na hora, com
   progresso do upload, e enviar ao WhatsApp como **documento** com o nome original, o MIME
   verificado e a legenda (se houver)
4. WHEN o WhatsApp aceita THEN o sistema SHALL trocar o relógio pelo tick de enviado e seguir
   com entregue/lido como no texto
5. WHEN o arquivo passa do limite ou está vazio THEN o sistema SHALL bloquear na prévia com o
   motivo, sem iniciar upload (e a API SHALL rejeitar de novo, com 413/422)

**Independent Test**: enviar um PDF de 5 MB e abrir no celular do contato com o nome original.

---

### P1: Enviar fotos e vídeos ⭐ MVP

**User Story**: Como operador, quero enviar fotos e vídeos (até 180 MB) para que o contato
veja a mídia inline, como no WhatsApp Web.

**Why P1**: Pedido explícito; vídeo grande é o caso mais exigente da feature.

**Acceptance Criteria**:

1. WHEN escolhe "Fotos e vídeos" THEN o seletor SHALL filtrar `image/*,video/*`
2. WHEN a imagem é JPEG, PNG ou WebP com até o limite de imagem (padrão 16 MB) THEN o
   sistema SHALL enviar como **imagem** com legenda e miniatura
3. WHEN o vídeo é MP4/3GP, H.264 8 bits (`yuv420p`) e até o limite de vídeo inline (padrão
   180 MB, confirmado pelo usuário no WhatsApp Web — `context.md` D5) THEN o sistema
   SHALL enviar como **vídeo** com legenda, duração, largura/altura e miniatura
4. WHEN o arquivo é HEIC, GIF, SVG, imagem acima do limite de imagem, vídeo em outro
   formato/codec ou acima do limite inline THEN o sistema SHALL enviar como documento
   (respeitando o limite de documento); a prévia SHALL avisar quando souber pelo tipo/tamanho,
   e a bolha SHALL refletir o tipo final decidido pela API (o codec só a API conhece)
5. WHEN a mídia é enviada THEN a bolha SHALL exibir a cópia guardada no servidor — a API
   SHALL NOT baixar de volta do WhatsApp o arquivo que ela mesma enviou

**Independent Test**: enviar um vídeo MP4 de ~180 MB e assisti-lo no celular do contato com
duração e miniatura corretas; memória da API sem pico proporcional ao arquivo.

---

### P1: Gravar e enviar mensagem de voz ⭐ MVP

**User Story**: Como operador, quero gravar um áudio pelo microfone do computador e enviá-lo
como nota de voz, igual ao WhatsApp Web.

**Why P1**: Pedido explícito; áudio é o formato de resposta mais rápido no WhatsApp.

**Acceptance Criteria**:

1. WHEN o campo de texto está vazio THEN o composer SHALL mostrar o microfone habilitado
2. WHEN o operador clica no microfone pela primeira vez THEN o navegador SHALL pedir permissão
   e, concedida, o composer SHALL virar a barra de gravação: descartar, indicador gravando,
   cronômetro, ondas ao vivo, pausar e enviar
3. WHEN clica em enviar THEN o sistema SHALL encerrar a gravação, liberar o microfone e enviar
   como **nota de voz** (`ptt`) em Ogg/Opus mono, com duração e forma de onda
4. WHEN clica em descartar THEN o sistema SHALL encerrar, liberar o microfone e não enviar nada
5. WHEN a gravação atinge o máximo (padrão 15 min) THEN o sistema SHALL parar sozinho e ficar
   no estado pausado com pré-escuta, sem enviar automaticamente
6. WHEN a gravação tem menos de 1 s THEN o sistema SHALL descartar e avisar "Gravação muito curta"
7. WHEN há resposta selecionada THEN a nota de voz SHALL chegar citada no WhatsApp

**Independent Test**: gravar 10 s no Chrome e no Safari e ouvir no Android e no iPhone do
contato como nota de voz, com ondas e duração 0:10.

---

### P2: Pausar e ouvir antes de enviar

**User Story**: Como operador, quero pausar, ouvir o que gravei e continuar ou enviar.

**Why P2**: Parte do "estilo WhatsApp Web completo" (`context.md` D2); o P1 já é útil sem ela.

**Acceptance Criteria**:

1. WHEN clica em pausar THEN o cronômetro SHALL parar e a barra SHALL oferecer tocar/pausar
   a pré-escuta do trecho gravado, retomar e enviar
2. WHEN clica em retomar THEN a gravação SHALL continuar no mesmo áudio
3. WHEN a pré-escuta não é suportada pelo navegador THEN o botão tocar SHALL ficar desabilitado
   com tooltip explicando, sem impedir retomar ou enviar

**Independent Test**: gravar, pausar, ouvir, retomar, enviar; o contato recebe um áudio só.

---

### P2: Lote com prévia, legenda por arquivo, arrastar e colar

**User Story**: Como operador, quero selecionar vários arquivos, revisar e legendar cada um
antes de enviar, arrastando ou colando também.

**Why P2**: Decisão do usuário (`context.md` D3); acelera o envio de várias fotos.

**Acceptance Criteria**:

1. WHEN seleciona vários arquivos (até o máximo, padrão 30) THEN a prévia SHALL mostrar o item
   atual grande, miniaturas de todos, legenda por item, remover item e adicionar mais
2. WHEN confirma THEN o sistema SHALL enviar na ordem das miniaturas, uma bolha por arquivo
3. WHEN arrasta arquivos sobre a conversa THEN o sistema SHALL mostrar a área "Solte para
   enviar" e, ao soltar, abrir a prévia com a classificação automática por arquivo
4. WHEN cola (Ctrl/Cmd+V) arquivo ou imagem no campo de texto THEN o sistema SHALL abrir a
   prévia; WHEN cola texto THEN o comportamento SHALL ser o de hoje
5. WHEN há resposta selecionada THEN a citação SHALL ir no primeiro arquivo do lote e o
   WhatsApp do contato SHALL exibi-la
6. WHEN há item bloqueado (limite, vazio) THEN "Enviar" SHALL ficar desabilitado até removê-lo

**Independent Test**: arrastar 5 fotos, legendar a 2ª, enviar; chegam 5 fotos na ordem.

---

### P2: Progresso, cancelamento e reenvio

**User Story**: Como operador, quero ver o progresso, cancelar um upload e reenviar o que falhou
sem subir o arquivo de novo.

**Why P2**: Com 180 MB, falha e espera são prováveis; sem isso a feature frustra.

**Acceptance Criteria**:

1. WHEN o upload está em andamento THEN a bolha SHALL mostrar o percentual e um botão cancelar
2. WHEN cancela THEN o upload SHALL parar, a bolha SHALL sumir e a API SHALL apagar o parcial
3. WHEN a rede cai THEN o sistema SHALL tentar de novo cada parte e retomar da última parte
   recebida; esgotadas as tentativas, a bolha SHALL ficar "falhou" com "Tentar de novo"
4. WHEN o envio ao WhatsApp falha THEN a bolha SHALL ficar "falhou" e "Tentar de novo" SHALL
   reenviar o arquivo já guardado no servidor, sem novo upload
5. WHEN fecha a aba com upload em andamento THEN o navegador SHALL pedir confirmação

**Independent Test**: desligar a rede no meio de um vídeo de 100 MB, religar, ver retomar.

---

## Edge Cases

- WHEN a sessão WhatsApp da conversa está desconectada THEN a API SHALL recusar o envio com
  `SESSION_NOT_CONNECTED` antes de gravar a mensagem, e o upload SHALL continuar reaproveitável
  para "Tentar de novo"
- WHEN a conversa está encerrada THEN anexo, microfone, arrastar e colar SHALL ficar desabilitados
- WHEN o ffmpeg não existe no servidor THEN o microfone SHALL ficar desabilitado com tooltip
  ("Mensagem de voz indisponível") e vídeo SHALL seguir sem miniatura/duração
- WHEN o microfone é negado, inexistente, está em uso ou a página não é HTTPS THEN o sistema
  SHALL mostrar a causa específica e voltar ao composer normal
- WHEN o operador troca ou perde a seleção da conversa gravando (inclusive arquivamento vindo
  de outro aparelho) THEN o sistema SHALL encerrar a gravação, liberar o microfone e guardar o
  áudio como rascunho da conversa, com enviar/descartar ao voltar
- WHEN o operador troca de conversa com upload em andamento THEN o upload SHALL continuar e a
  bolha SHALL estar lá ao voltar
- WHEN o MIME declarado pelo navegador diverge do conteúdo THEN vale o conteúdo (magic bytes)
- WHEN o disco do servidor não comporta o upload THEN a API SHALL recusar na criação (507)
- WHEN a API reinicia (deploy) com envio na fila THEN a API SHALL esperar até 25 s os envios
  em andamento e, no boot da Render, marcar os que sobraram como "falhou" com "Tentar de novo";
  uploads incompletos SHALL poder retomar
- WHEN a API sobe em desenvolvimento THEN nenhuma mensagem SHALL ser alterada no banco pelo boot
  (recuperação atrás de flag, desligada por padrão)
- WHEN o operador tenta reagir a uma mídia ainda em envio ou com falha THEN o sistema SHALL
  não oferecer a reação (e a API SHALL recusar)
- WHEN o painel recarrega, busca ou pagina a conversa durante um upload THEN a bolha em envio
  SHALL continuar visível
- WHEN a mesma confirmação de envio chega duas vezes (retry de rede) THEN a API SHALL devolver
  a mesma mensagem, sem duplicar
- WHEN o WhatsApp devolve o eco da mídia enviada THEN a API SHALL ignorá-lo sem baixar o arquivo
- WHEN o nome do arquivo tem caminho, caracteres de controle ou é enorme THEN a API SHALL
  sanitizar antes de usar como nome do documento

---

## Requirement Traceability

| ID | Story | Requisito | Status |
| --- | --- | --- | --- |
| MEDIA-01 | P1 Documento | Menu de anexo "Documento" / "Fotos e vídeos" | Pending |
| MEDIA-02 | P1 Documento | Documento com nome original, MIME verificado e legenda | Pending |
| MEDIA-03 | P1 Fotos/vídeos | Imagem JPEG/PNG/WebP ≤ limite como imagem com miniatura | Pending |
| MEDIA-04 | P1 Fotos/vídeos | Vídeo MP4/3GP H.264 `yuv420p` ≤ limite inline (180 MB) com duração, dimensões, miniatura | Pending |
| MEDIA-05 | P1 Fotos/vídeos | Fora da regra → documento, avisado na prévia | Pending |
| MEDIA-06 | P1 Documento | Limites e vazio bloqueados no painel e na API | Pending |
| MEDIA-07 | P2 Progresso | Upload em partes, retomável, com progresso | Pending |
| MEDIA-08 | P1 (todas) | Bolha otimista com prévia local, trocada sem piscar nem duplicar | Pending |
| MEDIA-09 | P1 (todas) | Envio assíncrono: PENDING → SENT/FAILED por WS; ticks seguem | Pending |
| MEDIA-10 | P1 Fotos/vídeos | Exibe a cópia local; eco do WhatsApp nunca baixado | Pending |
| MEDIA-11 | P1 Voz | Barra de gravação: timer, ondas, descartar, enviar, máximo, mínimo | Pending |
| MEDIA-12 | P1 Voz | Nota de voz Ogg/Opus mono com duração e forma de onda | Pending |
| MEDIA-13 | P2 Pausar | Pausar, retomar e pré-escutar | Pending |
| MEDIA-14 | P1 Voz | Erros de microfone específicos; microfone sempre liberado | Pending |
| MEDIA-15 | P2 Lote | Lote ≤ 30, miniaturas, legenda por item, remover/adicionar, ordem | Pending |
| MEDIA-16 | P2 Lote | Arrastar e soltar | Pending |
| MEDIA-17 | P2 Lote | Colar arquivo/imagem | Pending |
| MEDIA-18 | P2 Progresso | Cancelar upload (bolha some, parcial apagado) | Pending |
| MEDIA-19 | P2 Progresso | Reenviar falha sem novo upload | Pending |
| MEDIA-20 | Edge | Sessão desconectada / conversa encerrada bloqueiam envio | Pending |
| MEDIA-21 | Edge | Sem ffmpeg: microfone desabilitado, vídeo degradado | Pending |
| MEDIA-22 | Transversal | Segurança: auth, tenant, sniff, sanitização, sem shell, estática só `media/` | Pending |
| MEDIA-23 | Transversal | Tema sistema/claro/escuro, textos centralizados, tooltips | Pending |
| MEDIA-24 | P2 Lote / P1 Voz | Resposta com anexo (1º item) ou voz chega citada no WhatsApp | Pending |
| MEDIA-25 | P1 (todas) | Prévia da última mensagem na lista de conversas | Pending |
| MEDIA-26 | P2 Progresso | Confirmação ao fechar aba com upload ativo | Pending |
| MEDIA-27 | Edge | Limpeza de uploads; PENDING órfão vira FAILED (flag); drain no shutdown; reconciliação de upload interrompido | Pending |
| MEDIA-28 | Edge | Disco insuficiente → 507 antes do upload | Pending |
| MEDIA-29 | Transversal | Idempotência da confirmação de envio por `uploadId` | Pending |
| MEDIA-30 | Edge | Reação indisponível em mídia `PENDING`/`FAILED` (painel e API) | Pending |
| MEDIA-31 | P1 Voz | Gravação vira rascunho da conversa ao trocar/perder seleção | Pending |

**Coverage:** 31 total, 31 mapeados em `tasks.md`, 0 sem task.

---

## Success Criteria

- [ ] Vídeo MP4 de 180 MB enviado e reproduzido inline no Android e no iOS do contato
- [ ] Nota de voz gravada em Chrome, Firefox e Safari toca como nota de voz no Android, iOS,
      WhatsApp Web e Desktop, com ondas e duração
- [ ] RSS da API durante o envio de 180 MB não cresce mais que ~50 MB acima do repouso
- [ ] Upload interrompido retoma sem reenviar partes já recebidas
- [ ] Suítes `api` e `app` verdes; smoke de texto, reação e mídia recebida sem regressão
