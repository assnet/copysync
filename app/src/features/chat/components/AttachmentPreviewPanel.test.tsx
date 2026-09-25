import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PaletteMode } from '@mui/material';
import { renderWithTheme } from '@/test/renderWithTheme';
import { buildTheme } from '@/theme/theme';
import type { MediaUploadConfigDto } from '@/types/media.api.types';
import type { AttachmentOrigin } from '../media/mediaPolicy';
import { AttachmentPreviewPanel } from './AttachmentPreviewPanel';

function configCom(parcial: Partial<MediaUploadConfigDto> = {}): MediaUploadConfigDto {
  return {
    chunkSizeBytes: 4_000_000,
    maxFilesPerBatch: 30,
    maxVoiceSeconds: 900,
    maxCaptionLength: 4096,
    limits: { imageBytes: 16_000_000, inlineVideoBytes: 180_000_000, documentBytes: 180_000_000, voiceBytes: 16_000_000 },
    capabilities: { voiceNotes: true, videoMetadata: true },
    ...parcial,
  };
}

/** `File` com tamanho declarado sem alocar o conteúdo. */
function arquivo(nome: string, tipo: string, tamanho = 2_000): File {
  const file = new File(['x'], nome, { type: tipo });
  Object.defineProperty(file, 'size', { value: tamanho });
  return file;
}

interface Opcoes {
  files: File[];
  origin?: AttachmentOrigin;
  config?: MediaUploadConfigDto;
  initialCaption?: string;
  mode?: PaletteMode;
}

function renderizar({ files, origin = 'media', config = configCom(), initialCaption, mode }: Opcoes) {
  const onSend = vi.fn();
  const onClose = vi.fn();
  const onAddMore = vi.fn();
  const user = userEvent.setup();
  const utils = renderWithTheme(
    <AttachmentPreviewPanel
      files={files}
      origin={origin}
      config={config}
      onSend={onSend}
      onClose={onClose}
      onAddMore={onAddMore}
      initialCaption={initialCaption}
    />,
    mode,
  );
  return { ...utils, onSend, onClose, onAddMore, user };
}

const legenda = () => screen.getByRole('textbox', { name: 'Legenda' });
const botaoEnviar = (quantidade: number) =>
  screen.getByRole('button', { name: quantidade === 1 ? 'Enviar 1 arquivo' : `Enviar ${quantidade} arquivos` });

let createObjectURL: Mock<(obj: Blob | MediaSource) => string>;
let revokeObjectURL: Mock<(url: string) => void>;
let createImageBitmapMock: Mock<(file: Blob) => Promise<ImageBitmap>>;
let drawImage: Mock<(...args: unknown[]) => void>;

beforeEach(() => {
  let sequencia = 0;
  createObjectURL = vi.fn(() => `blob:teste/${++sequencia}`);
  revokeObjectURL = vi.fn();
  // jsdom não tem `URL.createObjectURL`, `createImageBitmap` nem canvas 2D.
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: createObjectURL });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: revokeObjectURL });
  createImageBitmapMock = vi.fn(async () => ({ width: 400, height: 300, close: vi.fn() }) as unknown as ImageBitmap);
  vi.stubGlobal('createImageBitmap', createImageBitmapMock);
  drawImage = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    (() => ({ drawImage })) as unknown as HTMLCanvasElement['getContext'],
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback: BlobCallback) => {
    callback(new Blob(['miniatura'], { type: 'image/png' }));
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AttachmentPreviewPanel — abertura e foco', () => {
  it('abre como diálogo modal com o foco na legenda', async () => {
    renderizar({ files: [arquivo('foto.jpg', 'image/jpeg')] });

    const dialogo = screen.getByRole('dialog', { name: 'Revisar anexos' });
    expect(dialogo).toHaveAttribute('aria-modal', 'true');
    await waitFor(() => expect(legenda()).toHaveFocus());
  });

  it('devolve o foco a quem abriu a prévia ao fechar', async () => {
    const clipe = document.createElement('button');
    document.body.appendChild(clipe);
    clipe.focus();

    const { unmount } = renderizar({ files: [arquivo('foto.jpg', 'image/jpeg')] });
    await waitFor(() => expect(legenda()).toHaveFocus());
    unmount();

    expect(clipe).toHaveFocus();
    clipe.remove();
  });

  it('coloca o texto que já estava no campo na legenda do primeiro item', async () => {
    const { user } = renderizar({
      files: [arquivo('a.jpg', 'image/jpeg'), arquivo('b.jpg', 'image/jpeg')],
      initialCaption: 'olá',
    });

    expect(legenda()).toHaveValue('olá');
    await user.click(screen.getByRole('button', { name: 'Arquivo 2 de 2' }));
    expect(legenda()).toHaveValue('');
  });
});

describe('AttachmentPreviewPanel — item atual e miniaturas', () => {
  it('mostra só o item atual em tamanho cheio e usa vídeo apenas quando ele é o atual', async () => {
    const foto1 = arquivo('foto1.jpg', 'image/jpeg');
    const foto2 = arquivo('foto2.png', 'image/png');
    const clipe = arquivo('clipe.mp4', 'video/mp4');
    const { user } = renderizar({ files: [foto1, foto2, clipe] });

    const imagem = await screen.findByRole('img', { name: 'foto1.jpg' });
    expect(imagem).toHaveAttribute('src', expect.stringMatching(/^blob:/));
    // Identidade: `File` sem campos enumeráveis parece igual a outro na comparação profunda.
    const recebidos = createObjectURL.mock.calls.map(([objeto]) => objeto);
    expect(recebidos).toContain(foto1);
    expect(recebidos).not.toContain(foto2);
    expect(recebidos).not.toContain(clipe);
    expect(screen.queryByLabelText('clipe.mp4')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Arquivo 3 de 3' }));

    const video = await screen.findByLabelText('clipe.mp4');
    expect(video).toHaveAttribute('preload', 'metadata');
    expect(video).toHaveAttribute('controls');
    expect(screen.queryByRole('img', { name: 'foto1.jpg' })).not.toBeInTheDocument();
  });

  it('gera miniaturas de 96 px com createImageBitmap só para as imagens', async () => {
    const foto1 = arquivo('foto1.jpg', 'image/jpeg');
    const foto2 = arquivo('foto2.png', 'image/png');
    const clipe = arquivo('clipe.mp4', 'video/mp4');
    renderizar({ files: [foto1, foto2, clipe] });

    await waitFor(() => expect(drawImage).toHaveBeenCalledTimes(2));
    expect(createImageBitmapMock.mock.calls.map(([file]) => file)).toEqual([foto1, foto2]);
    // Recorte central de 300×300 da foto 400×300, desenhado em 96×96.
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 50, 0, 300, 300, 0, 0, 96, 96);
    const miniatura = within(screen.getByRole('button', { name: 'Arquivo 2 de 3' })).getByRole('presentation');
    await waitFor(() => expect(miniatura).toHaveAttribute('src', expect.stringMatching(/^blob:/)));
  });

  it('mostra documento como cartão com nome, tipo e tamanho', () => {
    renderizar({ files: [arquivo('contrato.pdf', 'application/pdf', 2_000)], origin: 'document' });

    const dialogo = screen.getByRole('dialog');
    expect(within(dialogo).getAllByText('contrato.pdf').length).toBeGreaterThan(0);
    expect(screen.getByText('PDF · 2 KB')).toBeInTheDocument();
    expect(createImageBitmapMock).not.toHaveBeenCalled();
  });
});

describe('AttachmentPreviewPanel — legendas', () => {
  it('preserva a legenda de cada item ao alternar as miniaturas', async () => {
    const { user } = renderizar({ files: [arquivo('a.jpg', 'image/jpeg'), arquivo('b.jpg', 'image/jpeg')] });

    await user.type(legenda(), 'primeira');
    await user.click(screen.getByRole('button', { name: 'Arquivo 2 de 2' }));
    expect(legenda()).toHaveValue('');
    await user.type(legenda(), 'segunda');
    await user.click(screen.getByRole('button', { name: 'Arquivo 1 de 2' }));

    expect(legenda()).toHaveValue('primeira');
  });

  it('limita a legenda ao tamanho máximo da configuração', () => {
    renderizar({ files: [arquivo('a.jpg', 'image/jpeg')], config: configCom({ maxCaptionLength: 10 }) });

    expect(legenda()).toHaveAttribute('maxlength', '10');
  });
});

describe('AttachmentPreviewPanel — avisos e bloqueios', () => {
  it('avisa quando a foto ou o vídeo vai como documento', () => {
    renderizar({ files: [arquivo('filme.mov', 'video/quicktime')], origin: 'media' });

    expect(screen.getByText('Será enviado como documento')).toBeInTheDocument();
    expect(screen.getByText('MOV · 2 KB')).toBeInTheDocument();
    expect(botaoEnviar(1)).toBeEnabled();
  });

  it('bloqueia o envio com arquivo vazio e libera ao removê-lo', async () => {
    const { user } = renderizar({
      files: [arquivo('foto.jpg', 'image/jpeg'), arquivo('vazio.pdf', 'application/pdf', 0)],
      origin: 'auto',
    });

    expect(botaoEnviar(2)).toBeDisabled();
    expect(screen.getByText('Remova os arquivos com aviso para enviar')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Arquivo 2 de 2' }));
    expect(screen.getByText('Arquivo vazio')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Remover vazio.pdf' }));

    expect(botaoEnviar(1)).toBeEnabled();
    expect(screen.queryByText('Remova os arquivos com aviso para enviar')).not.toBeInTheDocument();
    expect(legenda()).toHaveFocus();
  });

  it('mostra o limite quando o arquivo é grande demais', () => {
    renderizar({ files: [arquivo('backup.zip', 'application/zip', 200_000_000)], origin: 'document' });

    expect(screen.getByText('Arquivo acima do limite de 180 MB')).toBeInTheDocument();
    expect(botaoEnviar(1)).toBeDisabled();
  });

  it('bloqueia lote acima do máximo e mostra o motivo', async () => {
    const { user } = renderizar({
      files: [arquivo('a.jpg', 'image/jpeg'), arquivo('b.jpg', 'image/jpeg'), arquivo('c.jpg', 'image/jpeg')],
      config: configCom({ maxFilesPerBatch: 2 }),
    });

    expect(botaoEnviar(3)).toBeDisabled();
    expect(screen.getByText('Envie até 2 arquivos por vez')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Remover c.jpg' }));

    expect(botaoEnviar(2)).toBeEnabled();
  });
});

describe('AttachmentPreviewPanel — teclado e ações', () => {
  it('envia com Enter todas as legendas, na ordem, com a classificação de cada arquivo', async () => {
    const foto = arquivo('foto.jpg', 'image/jpeg');
    const filme = arquivo('filme.mov', 'video/quicktime');
    const { user, onSend } = renderizar({ files: [foto, filme] });

    await user.type(legenda(), '  primeira  ');
    await user.click(screen.getByRole('button', { name: 'Arquivo 2 de 2' }));
    await user.type(legenda(), 'segunda{Enter}');

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith([
      { file: foto, caption: 'primeira', classification: expect.objectContaining({ kind: 'image', purpose: 'media' }) },
      {
        file: filme,
        caption: 'segunda',
        classification: expect.objectContaining({ kind: 'document', convertedToDocument: true }),
      },
    ]);
  });

  it('Shift+Enter quebra a linha sem enviar', async () => {
    const { user, onSend } = renderizar({ files: [arquivo('foto.jpg', 'image/jpeg')] });

    await user.type(legenda(), 'linha 1{Shift>}{Enter}{/Shift}linha 2');

    expect(onSend).not.toHaveBeenCalled();
    expect(legenda()).toHaveValue('linha 1\nlinha 2');
  });

  it('Enter não envia com item bloqueado', async () => {
    const { user, onSend } = renderizar({ files: [arquivo('vazio.pdf', 'application/pdf', 0)], origin: 'document' });

    await user.type(legenda(), 'oi{Enter}');

    expect(onSend).not.toHaveBeenCalled();
  });

  it('Esc e o botão fechar fecham a prévia', async () => {
    const { user, onClose } = renderizar({ files: [arquivo('foto.jpg', 'image/jpeg')] });

    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Fechar prévia' }));

    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('adiciona mais arquivos pela mesma origem e mostra o primeiro novo', async () => {
    const { user, onAddMore } = renderizar({ files: [arquivo('a.jpg', 'image/jpeg')] });
    const entrada = screen.getByLabelText('Adicionar arquivos', { selector: 'input' });
    expect(entrada).toHaveAttribute('accept', 'image/*,video/*');
    expect(screen.getByRole('button', { name: 'Adicionar arquivos' })).toBeInTheDocument();
    const novos = [arquivo('b.png', 'image/png'), arquivo('c.png', 'image/png')];

    await user.upload(entrada, novos);

    expect(onAddMore).toHaveBeenCalledWith(novos);
    expect(botaoEnviar(3)).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Arquivo 2 de 3' })).toHaveAttribute('aria-current', 'true');
    expect(await screen.findByRole('img', { name: 'b.png' })).toBeInTheDocument();
  });

  it('aceita qualquer arquivo ao adicionar mais em documento', () => {
    renderizar({ files: [arquivo('a.pdf', 'application/pdf')], origin: 'document' });

    expect(screen.getByLabelText('Adicionar arquivos', { selector: 'input' })).not.toHaveAttribute('accept');
  });

  it('fecha a prévia ao remover o último arquivo', async () => {
    const { user, onClose } = renderizar({ files: [arquivo('foto.jpg', 'image/jpeg')] });

    await user.click(screen.getByRole('button', { name: 'Remover foto.jpg' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('AttachmentPreviewPanel — limpeza', () => {
  it('revoga todos os blob: criados ao desmontar', async () => {
    const { user, unmount } = renderizar({
      files: [arquivo('a.jpg', 'image/jpeg'), arquivo('b.jpg', 'image/jpeg'), arquivo('c.mp4', 'video/mp4')],
    });
    await waitFor(() => expect(drawImage).toHaveBeenCalledTimes(2));
    await user.click(screen.getByRole('button', { name: 'Arquivo 3 de 3' }));
    await screen.findByLabelText('c.mp4');

    unmount();

    const criados = createObjectURL.mock.results.map((resultado) => resultado.value as string);
    expect(criados.length).toBeGreaterThanOrEqual(4);
    const revogados = revokeObjectURL.mock.calls.map(([url]) => url);
    expect(new Set(revogados)).toEqual(new Set(criados));
  });

  it('cancela a miniatura pendente ao desmontar', async () => {
    const close = vi.fn();
    let entregar: (bitmap: ImageBitmap) => void = () => undefined;
    createImageBitmapMock.mockImplementation(
      () =>
        new Promise<ImageBitmap>((resolve) => {
          entregar = resolve;
        }),
    );
    const { unmount } = renderizar({ files: [arquivo('a.jpg', 'image/jpeg')] });
    await waitFor(() => expect(createImageBitmapMock).toHaveBeenCalledTimes(1));
    const urlsAntes = createObjectURL.mock.calls.length;

    unmount();
    await act(async () => {
      entregar({ width: 10, height: 10, close } as unknown as ImageBitmap);
    });

    expect(close).toHaveBeenCalledTimes(1);
    expect(drawImage).not.toHaveBeenCalled();
    expect(createObjectURL).toHaveBeenCalledTimes(urlsAntes);
  });
});

describe('AttachmentPreviewPanel — tema escuro', () => {
  it('usa o fundo do tema escuro e mantém os avisos', () => {
    renderizar({ files: [arquivo('vazio.pdf', 'application/pdf', 0)], origin: 'document', mode: 'dark' });

    expect(screen.getByRole('dialog')).toHaveStyle({
      backgroundColor: buildTheme('dark').palette.background.default,
    });
    expect(screen.getByText('Arquivo vazio')).toBeInTheDocument();
    expect(botaoEnviar(1)).toBeDisabled();
  });
});
