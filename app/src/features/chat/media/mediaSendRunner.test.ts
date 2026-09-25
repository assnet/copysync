import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessageApiDto } from '@/types/chat.api.types';
import type { UploadStatusDto } from '@/types/media.api.types';
import { chatService } from '@/services/chat.service';
import { mediaService } from '@/services/media.service';
import { uploadInParts, type UploadInPartsInput } from './chunkedUpload';
import { createMediaSendRunner } from './mediaSendRunner';
import { initialOutgoingMediaState, PROGRESS_MIN_INTERVAL_MS, type OutgoingMediaState } from './outgoingMediaState';

vi.mock('@/services/media.service', () => ({
  mediaService: { getUpload: vi.fn(), cancelUpload: vi.fn(), createUpload: vi.fn(), putPart: vi.fn() },
}));
vi.mock('@/services/chat.service', () => ({ chatService: { sendMediaMessage: vi.fn(), retryMessage: vi.fn() } }));
vi.mock('./chunkedUpload', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./chunkedUpload')>()),
  uploadInParts: vi.fn(),
}));

const upload = vi.mocked(uploadInParts);
const confirmar = vi.mocked(chatService.sendMediaMessage);
const consultar = vi.mocked(mediaService.getUpload);
const apagar = vi.mocked(mediaService.cancelUpload);

/** Erro como o interceptor do `apiClient` rejeita: sem `status` = rede. */
const erroApi = (status?: number, code?: string) => Object.assign(new Error('falha'), { status, code });

const dto = (id: string): ChatMessageApiDto => ({
  id,
  conversationId: 'c1',
  tenantId: 't1',
  direction: 'OUTBOUND',
  type: 'AUDIO',
  content: null,
  mediaUrl: `/media/${id}.ogg`,
  mimeType: 'audio/ogg',
  fileName: null,
  durationSeconds: 3,
  externalMessageId: null,
  status: 'PENDING',
  isDeleted: false,
  quotedMessageId: null,
  sentAt: '2026-09-25T10:00:00.000Z',
  createdAt: '2026-09-25T10:00:00.000Z',
});

const statusUpload = (state: UploadStatusDto['state'], messageId: string | null = null): UploadStatusDto => ({
  receivedParts: [0],
  complete: true,
  state,
  messageId,
});

/** Promessa que o teste resolve quando quiser (ou nunca). */
function adiada<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const esperar = () => vi.advanceTimersByTimeAsync(0);

function montar() {
  const estados: OutgoingMediaState[] = [];
  const onConfirmed = vi.fn();
  const runner = createMediaSendRunner({ commit: (s) => estados.push(s), onConfirmed });
  const parar = runner.start();
  const atual = () => estados[estados.length - 1] ?? initialOutgoingMediaState;
  const itens = () => atual().byConversation.c1 ?? [];
  const enviarVoz = () => {
    runner.enqueue('c1', [{ file: new File(['opus'], 'voz.webm', { type: 'audio/webm' }), classification: 'voice' }]);
    return itens()[0].tmpId;
  };
  const mostrouErro = () => estados.some((s) => s.byConversation.c1?.some((i) => i.error));
  return { runner, parar, onConfirmed, estados, atual, itens, enviarVoz, mostrouErro };
}

/** Upload que cria a sessão `up-1` e termina na hora. */
const uploadConcluido = async (input: UploadInPartsInput) => {
  input.onUploadCreated?.({ uploadId: 'up-1', chunkSizeBytes: 8 });
  input.onProgress?.(100);
  return { uploadId: 'up-1' };
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-25T10:00:00.000Z'));
  [upload, confirmar, consultar, apagar].forEach((mock) => mock.mockReset());
  upload.mockImplementation(uploadConcluido);
  apagar.mockResolvedValue(undefined);
  URL.createObjectURL = vi.fn(() => 'blob:http://localhost/voz');
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('envio de mídia — caminho feliz', () => {
  it('sobe, confirma e entrega a mensagem real à página', async () => {
    const { enviarVoz, itens, onConfirmed } = montar();
    confirmar.mockResolvedValueOnce(dto('m-1'));

    enviarVoz();
    await esperar();

    expect(onConfirmed).toHaveBeenCalledWith('c1', expect.objectContaining({ id: 'm-1', status: 'sending' }));
    expect(itens()).toEqual([]);
    expect(consultar).not.toHaveBeenCalled();
  });
});

describe('resposta da confirmação perdida', () => {
  it('confirmação sem resposta que virou mensagem: consulta o upload e trata como confirmada', async () => {
    const { enviarVoz, itens, onConfirmed, mostrouErro } = montar();
    confirmar.mockRejectedValueOnce(erroApi()).mockResolvedValueOnce(dto('m-1'));
    consultar.mockResolvedValueOnce(statusUpload('CONSUMED', 'm-1'));

    enviarVoz();
    await esperar();

    expect(consultar).toHaveBeenCalledWith('up-1');
    expect(confirmar).toHaveBeenCalledTimes(2);
    expect(onConfirmed).toHaveBeenCalledWith('c1', expect.objectContaining({ id: 'm-1' }));
    expect(itens()).toEqual([]);
    expect(mostrouErro()).toBe(false);
  });

  it('upload sumido na confirmação mas já consumido: não sobe o arquivo de novo', async () => {
    const { enviarVoz, onConfirmed } = montar();
    confirmar.mockRejectedValueOnce(erroApi(404, 'UPLOAD_NOT_FOUND')).mockResolvedValueOnce(dto('m-1'));
    consultar.mockResolvedValueOnce(statusUpload('CONSUMED', 'm-1'));

    enviarVoz();
    await esperar();

    expect(upload).toHaveBeenCalledTimes(1);
    expect(onConfirmed).toHaveBeenCalledWith('c1', expect.objectContaining({ id: 'm-1' }));
  });

  it('sem rede nem para consultar: para em "Tentar de novo"', async () => {
    const { enviarVoz, itens, onConfirmed } = montar();
    confirmar.mockRejectedValueOnce(erroApi());
    consultar.mockRejectedValueOnce(erroApi());

    enviarVoz();
    await esperar();

    expect(itens()[0].error).toBe('network');
    expect(onConfirmed).not.toHaveBeenCalled();
  });

  it('descartar parado depois de confirmar: se já virou mensagem, mostra a mensagem real', async () => {
    const { runner, enviarVoz, itens, onConfirmed } = montar();
    confirmar.mockRejectedValueOnce(erroApi()).mockResolvedValueOnce(dto('m-1'));
    consultar.mockRejectedValueOnce(erroApi()).mockResolvedValueOnce(statusUpload('CONSUMED', 'm-1'));

    const tmpId = enviarVoz();
    await esperar();
    expect(itens()[0].error).toBe('network');

    runner.discard(tmpId);
    await esperar();

    expect(apagar).not.toHaveBeenCalled();
    expect(onConfirmed).toHaveBeenCalledWith('c1', expect.objectContaining({ id: 'm-1' }));
  });
});

describe('descartar e cancelar', () => {
  it('parado em rede durante o upload: apaga o upload no servidor', async () => {
    const { runner, enviarVoz, itens } = montar();
    upload.mockImplementationOnce(async (input) => {
      input.onUploadCreated?.({ uploadId: 'up-1', chunkSizeBytes: 8 });
      throw erroApi();
    });

    const tmpId = enviarVoz();
    await esperar();
    expect(itens()[0].error).toBe('network');

    runner.discard(tmpId);
    await esperar();

    expect(apagar).toHaveBeenCalledWith('up-1');
    expect(consultar).not.toHaveBeenCalled();
    expect(itens()).toEqual([]);
  });

  it('parado em sessão: consulta, apaga o upload aberto e não inventa mensagem', async () => {
    const { runner, enviarVoz, itens, onConfirmed } = montar();
    confirmar.mockRejectedValueOnce(erroApi(409, 'SESSION_NOT_CONNECTED'));
    consultar
      .mockResolvedValueOnce(statusUpload('OPEN'))
      .mockResolvedValueOnce(statusUpload('OPEN'))
      .mockRejectedValueOnce(erroApi(404, 'UPLOAD_NOT_FOUND'));

    const tmpId = enviarVoz();
    await esperar();
    expect(itens()[0].error).toBe('session');

    runner.discard(tmpId);
    await vi.advanceTimersByTimeAsync(5_000);

    expect(apagar).toHaveBeenCalledWith('up-1');
    expect(itens()).toEqual([]);
    expect(onConfirmed).not.toHaveBeenCalled();
  });

  it('cancelamento tardio (409 UPLOAD_IN_PROGRESS): espera o consumo e mostra a mensagem que saiu', async () => {
    const { runner, enviarVoz, itens, onConfirmed } = montar();
    confirmar.mockReturnValueOnce(adiada<ChatMessageApiDto>().promise).mockResolvedValueOnce(dto('m-1'));
    consultar.mockResolvedValueOnce(statusUpload('CONSUMING')).mockResolvedValueOnce(statusUpload('CONSUMED', 'm-1'));
    apagar.mockRejectedValueOnce(erroApi(409, 'UPLOAD_IN_PROGRESS'));

    const tmpId = enviarVoz();
    await esperar();
    runner.cancel(tmpId);
    await esperar();

    expect(itens()).toEqual([]);
    expect(onConfirmed).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(2_000);
    expect(onConfirmed).toHaveBeenCalledTimes(1);
    expect(onConfirmed).toHaveBeenCalledWith('c1', expect.objectContaining({ id: 'm-1' }));
  });

  it('cancelamento tardio em que o consumo falha: o upload some e nada é mostrado', async () => {
    const { runner, enviarVoz, onConfirmed } = montar();
    confirmar.mockReturnValueOnce(adiada<ChatMessageApiDto>().promise);
    consultar.mockResolvedValueOnce(statusUpload('CONSUMING')).mockRejectedValueOnce(erroApi(404, 'UPLOAD_NOT_FOUND'));
    apagar.mockRejectedValueOnce(erroApi(409, 'UPLOAD_IN_PROGRESS'));

    const tmpId = enviarVoz();
    await esperar();
    runner.cancel(tmpId);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(consultar).toHaveBeenCalledTimes(2);
    expect(onConfirmed).not.toHaveBeenCalled();
  });
});

describe('frequência do progresso', () => {
  it('no máximo ~4 atualizações por segundo por item, e o 100% sempre', async () => {
    const { enviarVoz, itens } = montar();
    let progresso: ((p: number) => void) | undefined;
    const fim = adiada<{ uploadId: string }>();
    upload.mockImplementationOnce((input) => {
      progresso = input.onProgress;
      return fim.promise;
    });

    enviarVoz();
    await esperar();
    for (let p = 0; p <= 40; p++) progresso?.(p);
    expect(itens()[0].progress).toBe(0);

    vi.advanceTimersByTime(PROGRESS_MIN_INTERVAL_MS);
    progresso?.(41);
    expect(itens()[0].progress).toBe(41);

    progresso?.(100);
    expect(itens()[0].progress).toBe(100);
  });
});

describe('status do WS de id desconhecido', () => {
  it('sem envio em andamento, é ignorado (nenhum commit)', () => {
    const { runner, estados } = montar();
    runner.onWsStatus('m-9', 'sent');
    expect(estados).toEqual([]);
  });

  it('com envio em andamento, fica guardado para o 202', async () => {
    const { runner, enviarVoz, atual } = montar();
    confirmar.mockReturnValueOnce(adiada<ChatMessageApiDto>().promise);
    enviarVoz();
    await esperar();

    runner.onWsStatus('m-9', 'sent');
    expect(atual().earlyStatusById['m-9']?.status).toBe('sent');
  });
});

describe('troca de conta (logout ou tenant)', () => {
  it('aborta tudo, apaga uploads parados, limpa as bolhas e não entrega confirmação tardia', async () => {
    const { runner, itens, onConfirmed, atual } = montar();
    const tardia = adiada<ChatMessageApiDto>();
    confirmar.mockRejectedValueOnce(erroApi(409, 'SESSION_NOT_CONNECTED')).mockReturnValueOnce(tardia.promise);
    consultar.mockResolvedValueOnce(statusUpload('OPEN'));
    upload.mockImplementationOnce(uploadConcluido).mockImplementationOnce(async (input) => {
      input.onUploadCreated?.({ uploadId: 'up-2', chunkSizeBytes: 8 });
      return { uploadId: 'up-2' };
    });

    runner.enqueue('c1', [{ file: new File(['a'], 'a.webm'), classification: 'voice' }]);
    runner.enqueue('c2', [{ file: new File(['b'], 'b.webm'), classification: 'voice' }]);
    await esperar();
    expect(itens()[0].error).toBe('session');

    runner.reset();
    expect(atual()).toEqual(initialOutgoingMediaState);
    expect(apagar).toHaveBeenCalledWith('up-1');

    tardia.resolve(dto('m-2'));
    await esperar();
    expect(onConfirmed).not.toHaveBeenCalled();
  });

  it('depois da troca, envios novos seguem normalmente', async () => {
    const { runner, enviarVoz, onConfirmed } = montar();
    runner.reset();
    confirmar.mockResolvedValueOnce(dto('m-3'));

    enviarVoz();
    await esperar();

    expect(onConfirmed).toHaveBeenCalledWith('c1', expect.objectContaining({ id: 'm-3' }));
  });
});
