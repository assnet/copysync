# Chat Media Storage Offload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrar o chat de mídia persistida em disco local da API para uma arquitetura de media assets em object storage, com acesso sob demanda, URLs curtas e lifecycle controlado, sem quebrar o fluxo atual de conversas, multi-tenancy ou o isolamento do adapter Baileys.

**Architecture:** A API deixa de salvar binários em `api/storage/media` como fonte principal e passa a persistir apenas metadados + referência opaca da mídia em um novo módulo `media`. Quando a UI precisar abrir uma mídia, a API resolve acesso autenticado, gera URL assinada curta ou promove o arquivo sob demanda para object storage. O `app/` deixa de depender de `mediaUrl` persistido e passa a buscar acesso lazy por mensagem visível ou por clique.

**Tech Stack:** Fastify, TypeScript, Prisma, PostgreSQL, Baileys, storage S3-compatible (MinIO/R2/S3), React, Vite, Material UI, Axios.

---

## Diagnóstico consolidado

- Projeto atual:
  - `api/src/shared/storage/MediaStorage.ts` grava buffer em disco local.
  - `api/src/app/app.ts` expõe `GET /api/storage/*` via `@fastify/static`.
  - `api/src/modules/messaging/infrastructure/engines/baileys/BaileysMessagingEngineAdapter.ts` baixa binário no recebimento e no history sync recente, preenchendo `mediaUrl` persistido em `ChatMessage`.
  - `app/src/features/chat/components/messages/*.tsx` consome `mediaUrl` diretamente.
  - `api/prisma/schema.prisma` ainda persiste `ChatMessage.mediaUrl` e `ChatConversation.autoDownloadMedia`.

- Legado 1:
  - Grava binário em `backend/public/` e expõe URL pública montada pelo model `Message.mediaUrl`.
  - O cliente só consome a URL; não existe camada dedicada de storage.
  - É simples, mas cresce disco local e acopla aplicação + mídia no mesmo runtime.

- Legado 2:
  - Sobe mídia para S3/MinIO.
  - Persiste registro `Media` no banco com `fileName`, `type`, `mimetype`, `messageId`, `instanceId`.
  - Resolve `mediaUrl` via `presignedGetObject`, mantendo binário fora da API.
  - O cliente continua simples, mas a persistência do binário sai do servidor principal.

- Medição rápida do projeto atual:
  - `api/storage` ocupa aproximadamente `481M`.
  - Existem aproximadamente `1512` arquivos em `api/storage/media`.

## Diretriz arquitetural recomendada

**Não usar o cliente como storage principal.**

O browser pode ajudar com cache HTTP e cache local efêmero, mas não deve ser a fonte de verdade. Motivos:

- não suporta multiatendimento entre operadores;
- não suporta reabertura da conversa em outro dispositivo;
- não é observável nem auditável;
- é frágil para histórico, retenção e compliance;
- dificulta reprocessamento, IA e integrações futuras.

**Manter a mídia no lado servidor, mas fora do disco local da API.**

O melhor encaixe para a arquitetura atual é:

- binário em storage S3-compatible;
- metadados em banco;
- acesso lazy e autenticado;
- fallback local apenas para desenvolvimento;
- lifecycle e retenção no bucket, não em `api/storage/media`.

## Arquitetura alvo

### Backend

1. Criar um módulo `media` na API.
2. Persistir um `MediaAsset` por mensagem com mídia.
3. Substituir `mediaUrl` persistido por um descritor de mídia resolvido em runtime.
4. Armazenar no banco apenas:
   - metadados (`mimeType`, `fileName`, `sizeBytes`, `checksum` quando houver)
   - status (`DEFERRED`, `READY`, `FAILED`, `EXPIRED`)
   - storage key/bucket/provider
   - referência opaca para re-hidratar a mídia via engine quando ainda não houver objeto salvo.
5. Expor um endpoint autenticado para obter acesso à mídia:
   - gerar URL assinada curta quando o asset já estiver pronto;
   - ou promover a mídia sob demanda para object storage e então responder com acesso.
6. Remover o papel do `@fastify/static` como entrega principal de mídia.

### Frontend

1. `listMessages` deixa de depender de `mediaUrl` persistido como contrato forte.
2. Cada mensagem com mídia recebe um descritor leve:
   - `hasMedia`
   - `mediaAssetId`
   - `mediaStatus`
   - `previewUrl` opcional para thumbnails no futuro.
3. O componente visual resolve a mídia sob demanda:
   - imagem: ao entrar no viewport;
   - áudio/vídeo: ao usuário abrir o player;
   - documento: ao clicar em baixar.
4. O browser continua sendo cache secundário via `Cache-Control`, `ETag` e URL assinada curta.

### Storage

1. Produção: provider S3-compatible.
2. Desenvolvimento local: adapter local compatível com a mesma interface.
3. Prefixo por tenant/sessão/data para facilitar lifecycle e auditoria:

```txt
tenants/{tenantId}/sessions/{sessionId}/chat/{yyyy}/{mm}/{dd}/{messageId}/original
```

4. Lifecycle por classe:
   - hot: 0-30 dias
   - warm: 31-90 dias
   - cold/delete: conforme política do tenant

---

## Mapa de arquivos

### Criar na API

- `api/src/modules/media/domain/entities/MediaAsset.ts`
- `api/src/modules/media/domain/contracts/IMediaAssetRepository.ts`
- `api/src/modules/media/domain/contracts/IObjectStorage.ts`
- `api/src/modules/media/domain/contracts/IMediaSourceResolver.ts`
- `api/src/modules/media/application/use-cases/RegisterDeferredMediaUseCase.ts`
- `api/src/modules/media/application/use-cases/GetMessageMediaAccessUseCase.ts`
- `api/src/modules/media/application/use-cases/PromoteDeferredMediaUseCase.ts`
- `api/src/modules/media/application/use-cases/RecordMediaAccessUseCase.ts`
- `api/src/modules/media/infrastructure/repositories/PrismaMediaAssetRepository.ts`
- `api/src/modules/media/infrastructure/storage/LocalObjectStorageAdapter.ts`
- `api/src/modules/media/infrastructure/storage/S3ObjectStorageAdapter.ts`
- `api/src/modules/media/infrastructure/storage/ObjectStorageFactory.ts`
- `api/src/modules/media/infrastructure/source-resolvers/BaileysMediaSourceResolver.ts`
- `api/src/modules/media/presentation/routes/media.routes.ts`
- `api/src/modules/media/presentation/presenters/MediaPresenter.ts`

### Modificar na API

- `api/prisma/schema.prisma`
- `api/src/shared/config/env.ts`
- `api/src/app/app.ts`
- `api/src/shared/events/InternalMessagingEvent.ts`
- `api/src/modules/messaging/domain/contracts/IMessagingEngine.ts`
- `api/src/modules/messaging/infrastructure/engines/baileys/BaileysMessagingEngineAdapter.ts`
- `api/src/modules/chat/application/use-cases/IngestIncomingMessageUseCase.ts`
- `api/src/modules/chat/application/use-cases/IngestHistorySyncUseCase.ts`
- `api/src/modules/chat/application/use-cases/ListMessagesUseCase.ts`
- `api/src/modules/chat/presentation/presenters/ChatPresenter.ts`
- `api/src/modules/chat/presentation/routes/chat.routes.ts`
- `api/src/modules/chat/domain/entities/ChatMessage.ts`
- `api/src/modules/chat/infrastructure/mappers/PrismaChatMessageMapper.ts`
- `api/src/modules/chat/infrastructure/repositories/PrismaChatMessageRepository.ts`
- `api/src/shared/storage/MediaStorage.ts`

### Criar no app

- `app/src/hooks/useMessageMediaAccess.ts`
- `app/src/features/chat/types/media.ts`

### Modificar no app

- `app/src/services/chat.service.ts`
- `app/src/types/chat.api.types.ts`
- `app/src/pages/ChatPage.tsx`
- `app/src/features/chat/components/messages/ImageMessage.tsx`
- `app/src/features/chat/components/messages/AudioMessage.tsx`
- `app/src/features/chat/components/messages/VideoMessage.tsx`
- `app/src/features/chat/components/messages/DocumentMessage.tsx`
- `app/src/features/chat/components/messages/StickerMessage.tsx`
- `app/src/features/chat/components/MessageBubble.tsx`

### Criar para operação

- `scripts/maintenance/backfill_chat_media_assets.py`
- `scripts/maintenance/audit_chat_media_storage.py`

### Documentação

- `api/CHANGELOG.md`
- `CHANGELOG.md`

---

## Contratos alvo

### Storage provider

```ts
export interface IObjectStorage {
  putObject(input: {
    key: string;
    body: Buffer | NodeJS.ReadableStream;
    contentType: string;
    contentLength?: number;
    metadata?: Record<string, string>;
  }): Promise<void>;

  getSignedUrl(input: {
    key: string;
    expiresInSeconds: number;
    downloadFileName?: string | null;
    contentType?: string | null;
  }): Promise<string>;

  headObject(key: string): Promise<{
    exists: boolean;
    contentLength?: number;
    etag?: string | null;
  }>;

  deleteObject(key: string): Promise<void>;
}
```

### Media asset

```ts
export type MediaAssetStatus = 'DEFERRED' | 'PROCESSING' | 'READY' | 'FAILED' | 'EXPIRED';

export interface MediaAssetProps {
  id: string;
  tenantId: string;
  messageId: string;
  sessionId: string | null;
  mimeType: string | null;
  fileName: string | null;
  storageProvider: 'LOCAL' | 'S3';
  storageKey: string | null;
  sourceType: 'WHATSAPP_DEFERRED' | 'UPLOADED' | 'EXTERNAL_URL';
  sourceRef: string | null;
  status: MediaAssetStatus;
  sizeBytes: number | null;
  checksumSha256: string | null;
  lastAccessedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
```

### DTO de mensagem para o app

```ts
export interface ChatMessageMediaDto {
  assetId: string;
  status: 'DEFERRED' | 'READY' | 'FAILED' | 'EXPIRED';
  mimeType: string | null;
  fileName: string | null;
  previewUrl?: string | null;
}
```

O campo `mediaUrl` pode sobreviver apenas como compatibilidade temporária, preenchido pelo presenter quando houver URL assinada recém-gerada. O contrato final deve privilegiar `media` como objeto, não `mediaUrl` como coluna persistida.

---

## Task 1: Introduzir abstração de storage e configuração

**Files:**
- Create: `api/src/modules/media/domain/contracts/IObjectStorage.ts`
- Create: `api/src/modules/media/infrastructure/storage/LocalObjectStorageAdapter.ts`
- Create: `api/src/modules/media/infrastructure/storage/S3ObjectStorageAdapter.ts`
- Create: `api/src/modules/media/infrastructure/storage/ObjectStorageFactory.ts`
- Modify: `api/src/shared/config/env.ts`
- Modify: `api/src/shared/storage/MediaStorage.ts`

- [ ] **Step 1: Adicionar variáveis de ambiente para storage provider**

Adicionar em `api/src/shared/config/env.ts` suporte a:

```ts
MEDIA_STORAGE_PROVIDER: z.enum(['local', 's3']).default('local')
MEDIA_STORAGE_BUCKET: z.string().optional()
MEDIA_STORAGE_REGION: z.string().optional()
MEDIA_STORAGE_ENDPOINT: z.string().optional()
MEDIA_STORAGE_ACCESS_KEY: z.string().optional()
MEDIA_STORAGE_SECRET_KEY: z.string().optional()
MEDIA_SIGNED_URL_TTL_SECONDS: z.coerce.number().int().positive().default(300)
MEDIA_PUBLIC_BASE_URL: z.string().optional()
```

- [ ] **Step 2: Definir contrato único de object storage**

Criar `IObjectStorage` com `putObject`, `getSignedUrl`, `headObject`, `deleteObject`.

- [ ] **Step 3: Implementar adapter local compatível**

`LocalObjectStorageAdapter` deve continuar atendendo dev local sem mudar o restante da aplicação. O adapter local deve expor a mesma assinatura do provider S3-compatible.

- [ ] **Step 4: Implementar adapter S3-compatible**

Usar SDK S3-compatible e não acoplar ao restante do domínio. O bucket/prefix deve aceitar MinIO local e R2/S3 em produção.

- [ ] **Step 5: Introduzir factory centralizada**

`ObjectStorageFactory` devolve o provider concreto conforme env, para que `chat/` e `messaging/` dependam apenas do contrato.

- [ ] **Step 6: Validação**

Run: `pnpm --dir api typecheck`

Expected: sem erros TypeScript na API.

---

## Task 2: Persistir `MediaAsset` em vez de depender de `ChatMessage.mediaUrl`

**Files:**
- Modify: `api/prisma/schema.prisma`
- Create: `api/src/modules/media/domain/entities/MediaAsset.ts`
- Create: `api/src/modules/media/domain/contracts/IMediaAssetRepository.ts`
- Create: `api/src/modules/media/infrastructure/repositories/PrismaMediaAssetRepository.ts`
- Modify: `api/src/modules/chat/domain/entities/ChatMessage.ts`
- Modify: `api/src/modules/chat/infrastructure/mappers/PrismaChatMessageMapper.ts`
- Modify: `api/src/modules/chat/infrastructure/repositories/PrismaChatMessageRepository.ts`

- [ ] **Step 1: Criar tabela `media_assets` no Prisma**

Adicionar ao schema:

```prisma
enum MediaAssetStatus {
  DEFERRED
  PROCESSING
  READY
  FAILED
  EXPIRED
}

enum MediaStorageProvider {
  LOCAL
  S3
}

model MediaAsset {
  id             String               @id @default(cuid())
  tenantId       String
  messageId      String               @unique
  sessionId      String?
  mimeType       String?
  fileName       String?
  storageProvider MediaStorageProvider
  storageKey     String?
  sourceType     String
  sourceRef      String?
  status         MediaAssetStatus     @default(DEFERRED)
  sizeBytes      Int?
  checksumSha256 String?
  lastAccessedAt DateTime?
  expiresAt      DateTime?
  createdAt      DateTime             @default(now())
  updatedAt      DateTime             @updatedAt
}
```

- [ ] **Step 2: Relacionar `ChatMessage` com `MediaAsset`**

Adicionar `mediaAssetId` opcional ou relação 1:1 por `messageId`. Preferir relação 1:1 por `messageId` para manter o message aggregate simples.

- [ ] **Step 3: Manter `mediaUrl` apenas como compatibilidade temporária**

Durante a transição, `mediaUrl` pode seguir no banco se isso reduzir risco de rollout. O alvo final é removê-lo da persistência obrigatória e montá-lo apenas no presenter.

- [ ] **Step 4: Criar repository de `MediaAsset`**

O repository deve aceitar criação, atualização de status, marcação de acesso e busca por `messageId`, `tenantId`.

- [ ] **Step 5: Validação**

Run: `pnpm --dir api prisma migrate dev --name create-media-assets`

Expected: migration criada sem editar migrations antigas.

Run: `pnpm --dir api typecheck`

Expected: sem erros TypeScript na API.

---

## Task 3: Refatorar ingestão para mídia diferida e referência opaca

**Files:**
- Modify: `api/src/shared/events/InternalMessagingEvent.ts`
- Modify: `api/src/modules/messaging/domain/contracts/IMessagingEngine.ts`
- Modify: `api/src/modules/messaging/infrastructure/engines/baileys/BaileysMessagingEngineAdapter.ts`
- Create: `api/src/modules/media/domain/contracts/IMediaSourceResolver.ts`
- Create: `api/src/modules/media/infrastructure/source-resolvers/BaileysMediaSourceResolver.ts`
- Modify: `api/src/modules/chat/application/use-cases/IngestIncomingMessageUseCase.ts`
- Modify: `api/src/modules/chat/application/use-cases/IngestHistorySyncUseCase.ts`

- [ ] **Step 1: Definir um handle opaco de mídia no contrato interno**

Adicionar ao evento interno um descritor estável, sem tipos crus do Baileys:

```ts
media?: {
  sourceType: 'WHATSAPP_DEFERRED';
  sourceRef: string;
  mimeType?: string | null;
  fileName?: string | null;
  durationSeconds?: number | null;
}
```

- [ ] **Step 2: Fazer o adapter Baileys emitir referência diferida**

No lugar de baixar para disco em todo recebimento, o adapter deve:

- extrair `mimeType`, `fileName`, `durationSeconds`;
- serializar um `sourceRef` opaco suficiente para reidratar a mídia depois;
- só baixar imediatamente quando a política exigir cache antecipado.

- [ ] **Step 3: Redefinir `autoDownloadMedia`**

Em vez de significar “gravar no disco local”, o campo passa a significar “promover automaticamente para object storage”. O rótulo no domínio pode continuar por compatibilidade inicial, mas o comportamento deve mudar.

- [ ] **Step 4: Registrar `MediaAsset` no ingest**

`IngestIncomingMessageUseCase` e `IngestHistorySyncUseCase` devem criar o `ChatMessage` e, se houver mídia, registrar um `MediaAsset` com `status=DEFERRED` ou `READY`.

- [ ] **Step 5: Validação**

Run: `pnpm --dir api typecheck`

Expected: adapter, use cases e eventos compilando sem dependência circular.

---

## Task 4: Expor acesso autenticado e lazy à mídia

**Files:**
- Create: `api/src/modules/media/application/use-cases/GetMessageMediaAccessUseCase.ts`
- Create: `api/src/modules/media/application/use-cases/PromoteDeferredMediaUseCase.ts`
- Create: `api/src/modules/media/application/use-cases/RecordMediaAccessUseCase.ts`
- Create: `api/src/modules/media/presentation/routes/media.routes.ts`
- Create: `api/src/modules/media/presentation/presenters/MediaPresenter.ts`
- Modify: `api/src/app/routes.ts`
- Modify: `api/src/app/app.ts`

- [ ] **Step 1: Criar endpoint autenticado de acesso**

Adicionar rota como:

```txt
GET /api/chat/messages/:messageId/media/access
```

Resposta esperada:

```json
{
  "success": true,
  "data": {
    "assetId": "...",
    "status": "READY",
    "url": "https://...signed...",
    "expiresAt": "2026-05-09T12:00:00.000Z"
  }
}
```

- [ ] **Step 2: Quando o asset estiver `READY`, responder com signed URL curta**

TTL recomendada inicial: `300` segundos.

- [ ] **Step 3: Quando o asset estiver `DEFERRED`, promover sob demanda**

O use case deve:

- adquirir lock por `assetId` para evitar download duplicado;
- reidratar a mídia via `IMediaSourceResolver`;
- streamar direto para object storage;
- atualizar `status=READY`;
- gerar a URL assinada.

- [ ] **Step 4: Parar de depender de `@fastify/static` como entrega principal**

O static local deve ficar restrito a fallback de desenvolvimento, não à produção.

- [ ] **Step 5: Validação**

Run: `pnpm --dir api typecheck`

Expected: rotas e presenters compilando.

Smoke test manual esperado:

1. Receber mensagem com imagem.
2. Mensagem aparecer no chat sem `mediaUrl` persistido obrigatório.
3. Ao abrir a imagem, a API resolver acesso e a imagem carregar.

---

## Task 5: Ajustar DTOs do chat e o app para lazy media access

**Files:**
- Modify: `api/src/modules/chat/application/use-cases/ListMessagesUseCase.ts`
- Modify: `api/src/modules/chat/presentation/presenters/ChatPresenter.ts`
- Modify: `app/src/types/chat.api.types.ts`
- Modify: `app/src/services/chat.service.ts`
- Create: `app/src/hooks/useMessageMediaAccess.ts`
- Create: `app/src/features/chat/types/media.ts`
- Modify: `app/src/pages/ChatPage.tsx`
- Modify: `app/src/features/chat/components/MessageBubble.tsx`
- Modify: `app/src/features/chat/components/messages/ImageMessage.tsx`
- Modify: `app/src/features/chat/components/messages/AudioMessage.tsx`
- Modify: `app/src/features/chat/components/messages/VideoMessage.tsx`
- Modify: `app/src/features/chat/components/messages/DocumentMessage.tsx`
- Modify: `app/src/features/chat/components/messages/StickerMessage.tsx`

- [ ] **Step 1: Mudar o DTO do backend para descritor de mídia**

`ListMessagesUseCase` e `ChatPresenter` devem retornar:

```ts
media?: {
  assetId: string;
  status: 'DEFERRED' | 'READY' | 'FAILED' | 'EXPIRED';
  mimeType: string | null;
  fileName: string | null;
}
```

- [ ] **Step 2: Adicionar método de resolução no service do app**

Em `app/src/services/chat.service.ts`:

```ts
async getMessageMediaAccess(messageId: string): Promise<{
  assetId: string;
  status: string;
  url: string | null;
  expiresAt: string | null;
}>
```

- [ ] **Step 3: Criar hook `useMessageMediaAccess`**

O hook deve:

- manter cache curto em memória por `messageId`;
- respeitar `expiresAt`;
- evitar requisições duplicadas;
- permitir modo `prefetch` para imagem no viewport e modo `manual` para documento/áudio/vídeo.

- [ ] **Step 4: Atualizar componentes de mensagem**

- `ImageMessage`: pedir acesso ao entrar no viewport.
- `AudioMessage`: pedir acesso ao renderizar o player.
- `VideoMessage`: pedir acesso ao abrir o player.
- `DocumentMessage`: pedir acesso apenas no clique do download.
- `StickerMessage`: seguir o mesmo fluxo de imagem, sem modal.

- [ ] **Step 5: Não resolver URLs para toda a página**

`ChatPage` não deve disparar batch de acesso para todas as mensagens carregadas. Resolver apenas o que o usuário efetivamente vê ou abre.

- [ ] **Step 6: Validação**

Run: `pnpm --dir app tsc --noEmit`

Expected: sem erros TypeScript no app.

Smoke test manual esperado:

1. Abrir conversa com mídias antigas e recentes.
2. Nenhuma requisição de mídia deve acontecer antes da interação/visibilidade definida.
3. Documento deve resolver URL apenas no clique.

---

## Task 6: Lifecycle, retenção e observabilidade

**Files:**
- Create: `api/src/modules/media/application/use-cases/DeleteExpiredMediaUseCase.ts`
- Create: `api/src/modules/media/application/use-cases/CollectMediaMetricsUseCase.ts`
- Create: `scripts/maintenance/audit_chat_media_storage.py`
- Modify: `api/src/shared/logger/logger.ts`

- [ ] **Step 1: Registrar métricas mínimas**

Métricas mínimas por tenant:

- `media_assets_total`
- `media_assets_bytes_total`
- `media_promotions_total`
- `media_promotion_failures_total`
- `media_signed_url_requests_total`
- `media_ready_hit_ratio`
- `media_promotion_latency_ms`

- [ ] **Step 2: Definir política de retenção**

Política inicial recomendada:

- mensagens comuns: remover original após 90 dias se não acessado;
- mensagens críticas/configuradas: manter por tenant policy;
- thumbs/previews: reter por 30 dias.

- [ ] **Step 3: Implementar auditoria de storage**

`audit_chat_media_storage.py` deve comparar banco x bucket x storage local residual e listar:

- assets órfãos no bucket;
- rows sem objeto;
- arquivos locais ainda não migrados;
- bytes totais por tenant.

- [ ] **Step 4: Validação**

Run: `pnpm --dir api typecheck`

Expected: sem erros TypeScript.

Run: `python3 scripts/maintenance/audit_chat_media_storage.py --help`

Expected: script responde com usage e não altera dados.

---

## Task 7: Backfill e cutover do storage local

**Files:**
- Create: `scripts/maintenance/backfill_chat_media_assets.py`
- Modify: `api/CHANGELOG.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Fazer inventário do estado atual**

Usar query para mapear `ChatMessage.mediaUrl` atual e presença física no diretório local.

- [ ] **Step 2: Subir arquivos existentes para object storage**

O script deve:

- ler mensagens com `mediaUrl` não nulo;
- localizar arquivo em `api/storage/media`;
- subir para o bucket com a nova convenção de chave;
- criar/atualizar `MediaAsset`;
- registrar checksum e tamanho quando possível.

- [ ] **Step 3: Marcar o cutover em modo dual-read**

Durante a migração:

- leitura tenta `MediaAsset` primeiro;
- se não encontrar, usa fallback local;
- após backfill completo, remover fallback gradualmente.

- [ ] **Step 4: Validar migração**

Run: `python3 scripts/maintenance/backfill_chat_media_assets.py --dry-run`

Expected: relatório com totais sem subir arquivos.

Run: `python3 scripts/maintenance/backfill_chat_media_assets.py --limit 100`

Expected: primeiros 100 assets migrados com log por lote.

---

## Task 8: Remover o disco local da API como dependência principal

**Files:**
- Modify: `api/src/app/app.ts`
- Modify: `api/src/shared/storage/MediaStorage.ts`
- Modify: `api/src/modules/messaging/infrastructure/engines/baileys/BaileysMessagingEngineAdapter.ts`

- [ ] **Step 1: Desligar gravação local em produção**

O adapter não deve mais chamar a escrita local como caminho padrão.

- [ ] **Step 2: Restringir static local a ambiente de desenvolvimento**

Em produção, a mídia deve sair por URL assinada ou redirect autenticado, não por prefixo estático permanente.

- [ ] **Step 3: Revalidar fluxo completo**

Run: `pnpm --dir api typecheck`

Expected: API sem erros.

Run: `pnpm --dir app tsc --noEmit`

Expected: app sem erros.

Smoke test manual esperado:

1. Receber mídia nova.
2. Abrir mídia no chat.
3. Reabrir a mesma mídia com cache hit no asset pronto.
4. Validar que o diretório local não cresce em produção.

---

## Estratégia de rollout

### Fase 1

- introduzir módulo `media`;
- criar object storage abstraction;
- manter fallback local.

### Fase 2

- persistir `MediaAsset`;
- emitir referências diferidas pelo adapter;
- dual-write opcional apenas para segurança de rollout.

### Fase 3

- app passa a usar endpoint de acesso lazy;
- signed URL curta vira caminho oficial.

### Fase 4

- executar backfill do legado local;
- medir hit ratio e bytes migrados.

### Fase 5

- desligar gravação e serving local em produção.

---

## Decisões explícitas

- **Escolha recomendada:** storage S3-compatible com URL assinada curta.
- **Não recomendado:** mover binário para IndexedDB/localStorage do cliente como solução principal.
- **Compatibilidade:** manter `mediaUrl` apenas como camada transitória, nunca como base final do modelo.
- **Performance:** lazy fetch + object storage + cache HTTP entrega melhor custo/performance do que continuar escrevendo tudo no disco da API.
- **Segurança:** URL assinada ou endpoint autenticado elimina o falso pressuposto de que `/api/storage/*` já é “temporário”.

---

## Riscos e mitigação

- Risco: URLs expirarem durante playback longo de áudio/vídeo.
  - Mitigação: TTL de 5 minutos inicialmente e renovação por hook no app.

- Risco: promoção sob demanda baixar duas vezes a mesma mídia.
  - Mitigação: lock por `assetId` no backend.

- Risco: mídia antiga não poder mais ser reidratada do WhatsApp.
  - Mitigação: backfill do storage local atual antes de desligar fallback e política de promoção antecipada para conversas prioritárias.

- Risco: explosão de custos por signed URL para toda lista.
  - Mitigação: resolver acesso só sob demanda, nunca no payload completo de `listMessages`.

---

## Critério de pronto

- Nenhuma mídia nova depende de `api/storage/media` em produção.
- O app abre mídias via acesso lazy.
- O banco armazena metadados e referência do asset, não o caminho local como fonte de verdade.
- Há política de retenção e auditoria por tenant.
- O crescimento do disco local da API deixa de acompanhar o volume de conversas.

---

## Sequência de commits sugerida

1. `feat(media): adiciona abstração de object storage`
2. `feat(media): cria media assets e migration`
3. `refactor(messaging): emite referência diferida de mídia`
4. `feat(chat): adiciona endpoint de acesso lazy a mídia`
5. `feat(app): consome mídia sob demanda no chat`
6. `chore(media): adiciona auditoria, retenção e backfill`
7. `refactor(api): remove dependência principal do storage local`

---

Plan complete and saved to `docs/superpowers/plans/2026-05-09-chat-media-storage-architecture.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**