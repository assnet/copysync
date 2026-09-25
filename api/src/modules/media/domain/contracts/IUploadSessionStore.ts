/** Finalidade declarada na criação — define o limite de tamanho aplicado. */
export type UploadPurpose = 'media' | 'document' | 'voice';

/** `OPEN` recebe partes; `CONSUMING` está virando mensagem; `CONSUMED` já virou. */
export type UploadSessionState = 'OPEN' | 'CONSUMING' | 'CONSUMED';

/** Lateral `<uploadId>.json` de um upload em partes. */
export interface UploadSessionRecord {
  /** UUID v4 gerado pelo store. */
  uploadId: string;
  tenantId: string;
  userId: string;
  purpose: UploadPurpose;
  /** Já sanitizado por quem cria. */
  fileName: string;
  declaredMimeType: string | null;
  sizeBytes: number;
  chunkSizeBytes: number;
  totalParts: number;
  /** Ordenado, sem repetição. */
  receivedParts: number[];
  state: UploadSessionState;
  /** Gravado logo após o `beginConsume`: permite reconciliar uma queda no meio do consumo. */
  externalMessageId: string | null;
  /** Gravado no `finishConsume`: confirmação repetida devolve a mesma mensagem. */
  messageId: string | null;
  /**
   * Cancelamento pedido durante o `CONSUMING`: se o consumo for liberado, o upload é descartado
   * em vez de voltar a `OPEN`. Ausente nos laterais que nunca receberam o pedido.
   */
  cancelRequested?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateUploadSessionInput {
  tenantId: string;
  userId: string;
  purpose: UploadPurpose;
  fileName: string;
  declaredMimeType: string | null;
  sizeBytes: number;
  chunkSizeBytes: number;
}

export type WriteUploadPartResult =
  | { status: 'written'; record: UploadSessionRecord }
  /** Upload saiu de `OPEN` (consumo começou): a parte não foi escrita. */
  | { status: 'not_open'; record: UploadSessionRecord }
  | { status: 'not_found' };

/** Estado encontrado no `beginConsume` — só `started` muda o upload (para `CONSUMING`). */
export type BeginConsumeResult =
  | { outcome: 'started'; record: UploadSessionRecord }
  | { outcome: 'consumed'; messageId: string; record: UploadSessionRecord }
  | { outcome: 'in_progress'; record: UploadSessionRecord }
  | { outcome: 'incomplete'; record: UploadSessionRecord }
  /** Inexistente ou de outro tenant/usuário. */
  | { outcome: 'not_found' };

export interface UploadDiskStats {
  totalBytes: number;
  freeBytes: number;
}

/**
 * Sessões de upload em partes, persistidas fora do banco.
 *
 * `uploadId` fora do formato gerado pelo store é tratado como inexistente em todo método.
 * Operações sem dono (`setExternalId` em diante) servem a quem já passou pelo `get` ou
 * `beginConsume` com dono — ou à reconciliação/limpeza, que não têm usuário.
 */
export interface IUploadSessionStore {
  create(input: CreateUploadSessionInput): Promise<UploadSessionRecord>;
  /** Dono diferente → `null`, como inexistente. */
  get(uploadId: string, tenantId: string, userId: string): Promise<UploadSessionRecord | null>;
  /** Parte já validada por `validatePart`; parte repetida sobrescreve com o mesmo conteúdo. */
  writePart(uploadId: string, index: number, data: Uint8Array): Promise<WriteUploadPartResult>;
  /** `OPEN` completo → `CONSUMING`; qualquer outro estado volta como estava. */
  beginConsume(uploadId: string, tenantId: string, userId: string): Promise<BeginConsumeResult>;
  /** Só em `CONSUMING`. */
  setExternalId(uploadId: string, externalMessageId: string): Promise<UploadSessionRecord | null>;
  /**
   * `CONSUMING` → `OPEN`, limpando o id externo. Com cancelamento pedido, descarta o upload
   * (como `discard`) e devolve `null`.
   */
  releaseConsume(uploadId: string): Promise<UploadSessionRecord | null>;
  /** `CONSUMING` → `CONSUMED` com a mensagem gravada (vale mesmo com cancelamento pedido). */
  finishConsume(uploadId: string, messageId: string): Promise<UploadSessionRecord | null>;
  /**
   * Marca `cancelRequested` só em `CONSUMING`, sob o mutex do consumo: se ele for liberado, o
   * upload é descartado; se terminar, a mensagem sai. `true` = marcou.
   */
  requestCancel(uploadId: string): Promise<boolean>;
  /**
   * Só em `CONSUMED`: apaga o `.bin` e mantém o lateral (confirmação repetida). Serve à voz, cuja
   * promoção leva o arquivo transcodificado e deixa o original para trás. Idempotente.
   */
  dropBinary(uploadId: string): Promise<void>;
  /** Apaga arquivo e lateral. Idempotente. */
  discard(uploadId: string): Promise<void>;
  /**
   * Apaga só se o upload ainda está `OPEN`, conferindo o estado sob o mesmo mutex da escrita:
   * um cancelamento concorrente nunca apaga o `.bin` de um consumo em curso. `true` = apagou.
   */
  discardIfOpen(uploadId: string): Promise<boolean>;
  listByState(state: UploadSessionState): Promise<UploadSessionRecord[]>;
  /**
   * Ids com `updatedAt` além do TTL — ou além de um TTL curto quando o upload `OPEN` não recebeu
   * nenhuma parte. `CONSUMING` nunca entra: quem resolve consumo interrompido é a reconciliação
   * do boot. Arquivo sem lateral legível entra pelo horário de modificação — cobre a queda entre
   * criar o `.bin` e gravar o lateral. Só candidatos: quem apaga é `discardIfExpired`.
   */
  listExpired(now: Date, ttlMs: number): Promise<string[]>;
  /**
   * Apaga como `discard` se o upload **ainda** está expirado pela regra do `listExpired`,
   * reconferida sob o mutex: parte recebida ou consumo iniciado depois da listagem salva o
   * upload. Nunca apaga `CONSUMING`. `true` = apagou.
   */
  discardIfExpired(uploadId: string, now: Date, ttlMs: number): Promise<boolean>;
  /** Uploads ainda não consumidos (`OPEN`/`CONSUMING`) do usuário no tenant. */
  countOpenByUser(tenantId: string, userId: string): Promise<number>;
  /** Soma de `sizeBytes` de `OPEN`/`CONSUMING`: o `.bin` esparso ainda não ocupa esses blocos. */
  openReservedBytes(): Promise<number>;
  /** Total e livre do disco da pasta de uploads, lidos a cada chamada. */
  diskStats(): Promise<UploadDiskStats>;
  /** Primeiros `bytes` do arquivo (menos, se ele for menor). */
  readHead(uploadId: string, bytes: number): Promise<Uint8Array | null>;
  /** Caminho do `.bin` para promoção/processamento; `null` para id inválido. */
  binPath(uploadId: string): string | null;
  /** Boot: cria a pasta, confere escrita e diz se a mídia está no mesmo dispositivo. */
  ensureReady(mediaDir: string): Promise<{ sameDevice: boolean }>;
}
