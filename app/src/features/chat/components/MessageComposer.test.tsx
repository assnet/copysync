import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CssBaseline, ThemeProvider, type PaletteMode } from '@mui/material';
import { renderWithTheme } from '@/test/renderWithTheme';
import { buildTheme } from '@/theme/theme';
import { chatStrings } from '@/features/chat/strings';
import { MessageComposer } from './MessageComposer';
import { VoiceRecorderProvider } from '../media/VoiceRecorderProvider';
import type { QuotedMessagePreview } from '../types';

const citada: QuotedMessagePreview = { id: 'msg-1', type: 'text', body: 'pergunta', direction: 'in' };
const campo = () => screen.getByPlaceholderText(/Digite uma mensagem/);

describe('MessageComposer — responder', () => {
  it('escolher uma mensagem para responder leva o foco ao campo', async () => {
    const { rerender } = renderWithTheme(<MessageComposer onSend={vi.fn()} replyTo={null} />);
    expect(campo()).not.toHaveFocus();

    rerender(<MessageComposer onSend={vi.fn()} replyTo={citada} />);

    await waitFor(() => expect(campo()).toHaveFocus());
  });

  it('trocar a mensagem respondida devolve o foco ao campo', async () => {
    const { rerender } = renderWithTheme(<MessageComposer onSend={vi.fn()} replyTo={citada} />);
    await waitFor(() => expect(campo()).toHaveFocus());
    campo().blur();

    rerender(<MessageComposer onSend={vi.fn()} replyTo={{ ...citada, id: 'msg-2' }} />);

    await waitFor(() => expect(campo()).toHaveFocus());
  });

  it('conversa encerrada não recebe foco ao responder', async () => {
    renderWithTheme(<MessageComposer onSend={vi.fn()} replyTo={citada} disabled />);
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));

    expect(campo()).not.toHaveFocus();
  });

  it('mostra o banner da resposta também no tema escuro', () => {
    renderWithTheme(<MessageComposer onSend={vi.fn()} replyTo={citada} />, 'dark');

    expect(screen.getByText('pergunta')).toBeInTheDocument();
  });
});

/** Área de transferência mínima do `paste`: itens `file` e/ou `string`, como o navegador expõe. */
function clipboard(files: File[], text = '') {
  const items = [
    ...files.map((file) => ({ kind: 'file', type: file.type, getAsFile: () => file })),
    ...(text ? [{ kind: 'string', type: 'text/plain', getAsFile: () => null }] : []),
  ];
  return {
    types: [...(files.length ? ['Files'] : []), ...(text ? ['text/plain'] : [])],
    items,
    files,
    getData: (type: string) => (type === 'text/plain' ? text : ''),
  };
}

const clipe = () => screen.getByRole('button', { name: chatStrings.composer.attach });
const print = () => new File(['png'], 'print.png', { type: 'image/png' });

describe('MessageComposer — anexos', () => {
  it('colar um arquivo abre a prévia com classificação automática, sem colar no campo', () => {
    const onAttachFiles = vi.fn();
    renderWithTheme(<MessageComposer onSend={vi.fn()} onAttachFiles={onAttachFiles} />);
    const arquivo = print();

    const naoCancelado = fireEvent.paste(campo(), { clipboardData: clipboard([arquivo]) });

    expect(naoCancelado).toBe(false);
    expect(onAttachFiles).toHaveBeenCalledWith([arquivo], 'auto');
  });

  it('colar só texto segue o comportamento normal do campo', async () => {
    const onAttachFiles = vi.fn();
    const onSend = vi.fn();
    renderWithTheme(<MessageComposer onSend={onSend} onAttachFiles={onAttachFiles} />);

    const naoCancelado = fireEvent.paste(campo(), { clipboardData: clipboard([], 'bom dia') });
    expect(naoCancelado).toBe(true);
    expect(onAttachFiles).not.toHaveBeenCalled();

    await userEvent.click(campo());
    await userEvent.paste('bom dia');
    await userEvent.keyboard('{Enter}');
    expect(onSend).toHaveBeenCalledWith('bom dia');
    expect(onAttachFiles).not.toHaveBeenCalled();
  });

  it('texto copiado do Office (texto + imagem renderizada dele) cola como texto, sem abrir a prévia', () => {
    const onAttachFiles = vi.fn();
    renderWithTheme(<MessageComposer onSend={vi.fn()} onAttachFiles={onAttachFiles} />);

    const naoCancelado = fireEvent.paste(campo(), { clipboardData: clipboard([print()], 'Total do trimestre') });

    expect(naoCancelado).toBe(true);
    expect(onAttachFiles).not.toHaveBeenCalled();
  });

  it('conversa encerrada desabilita o clipe com o motivo e ignora arquivo colado', async () => {
    const onAttachFiles = vi.fn();
    renderWithTheme(
      <MessageComposer
        onSend={vi.fn()}
        disabled
        onAttachFiles={onAttachFiles}
        attachDisabledReason={chatStrings.attachments.conversationClosed}
      />,
    );
    expect(clipe()).toHaveAttribute('aria-disabled', 'true');

    await userEvent.click(clipe());
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    await userEvent.hover(clipe());
    expect(await screen.findByRole('tooltip')).toHaveTextContent(chatStrings.attachments.conversationClosed);

    fireEvent.paste(campo(), { clipboardData: clipboard([print()]) });
    expect(onAttachFiles).not.toHaveBeenCalled();
  });

  it('sem os limites de upload o clipe fica desabilitado com o aviso de indisponível', async () => {
    renderWithTheme(<MessageComposer onSend={vi.fn()} />, 'dark');
    expect(clipe()).toHaveAttribute('aria-disabled', 'true');

    await userEvent.hover(clipe());
    expect(await screen.findByRole('tooltip')).toHaveTextContent(chatStrings.attachments.unavailable);
  });

  it('o clipe habilitado abre o menu de anexo', async () => {
    renderWithTheme(<MessageComposer onSend={vi.fn()} onAttachFiles={vi.fn()} />);

    await userEvent.click(clipe());

    expect(screen.getByRole('menu', { name: chatStrings.attachments.menuLabel })).toBeInTheDocument();
  });
});

// ── Mensagem de voz (composer + VoiceRecorderProvider) ─────────────────────────

const voz = chatStrings.voice;
const microfone = () => screen.getByRole('button', { name: chatStrings.composer.recordVoice });

/** `MediaRecorder` mínimo: eventos assíncronos como no navegador, uma fatia por `stop`. */
class GravadorFalso extends EventTarget {
  static isTypeSupported = (type: string) => type === 'audio/webm;codecs=opus';
  state: RecordingState = 'inactive';
  mimeType: string;

  constructor(_stream: MediaStream, options?: MediaRecorderOptions) {
    super();
    this.mimeType = options?.mimeType ?? '';
  }

  start() {
    this.state = 'recording';
  }
  pause() {
    this.state = 'paused';
  }
  resume() {
    this.state = 'recording';
  }
  requestData() {
    setTimeout(() => this.emitirFatia(), 0);
  }
  stop() {
    this.state = 'inactive';
    setTimeout(() => {
      this.emitirFatia();
      this.dispatchEvent(new Event('stop'));
    }, 0);
  }
  private emitirFatia() {
    const evento = new Event('dataavailable');
    Object.defineProperty(evento, 'data', { value: new Blob(['opus'], { type: this.mimeType }) });
    this.dispatchEvent(evento);
  }
}

interface Cenario {
  conversa: string;
  available?: boolean;
  disabled?: boolean;
  replyTo?: QuotedMessagePreview | null;
}

let agora = 0;
let trilha: { stop: Mock<() => void> };
let getUserMedia: Mock<(constraints: MediaStreamConstraints) => Promise<MediaStream>>;

/** Composer dentro do provider, como no `ChatPage`; `trocar` re-renderiza sem remontar. */
function renderComVoz(inicial: Cenario, mode: PaletteMode = 'light') {
  const enqueue = vi.fn();
  const onNotice = vi.fn();
  const onCancelReply = vi.fn();
  let atual = inicial;
  const arvore = () => (
    <VoiceRecorderProvider
      activeConversationId={atual.conversa}
      available={atual.available ?? true}
      maxSeconds={900}
      enqueue={enqueue}
      onNotice={onNotice}
    >
      <MessageComposer onSend={vi.fn()} disabled={atual.disabled} replyTo={atual.replyTo} onCancelReply={onCancelReply} />
    </VoiceRecorderProvider>
  );
  const view = renderWithTheme(arvore(), mode);
  const trocar = (mudanca: Partial<Cenario>) => {
    atual = { ...atual, ...mudanca };
    // Mesma raiz do `renderWithTheme`: o React reconcilia e o estado do provider sobrevive.
    view.rerender(
      <ThemeProvider theme={buildTheme(mode)}>
        <CssBaseline />
        {arvore()}
      </ThemeProvider>,
    );
  };
  return { enqueue, onNotice, onCancelReply, trocar };
}

const barraGravando = () => screen.findByRole('group', { name: voz.record });

describe('MessageComposer — mensagem de voz', () => {
  beforeEach(() => {
    agora = 0;
    // O cronômetro do gravador lê `performance.now()`: avançar `agora` = tempo gravado.
    vi.spyOn(performance, 'now').mockImplementation(() => agora);
    trilha = { stop: vi.fn() };
    getUserMedia = vi.fn(async () => ({ getTracks: () => [trilha] }) as unknown as MediaStream);
    // jsdom não tem microfone, gravador, URL de Blob nem reprodução de mídia.
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
    vi.stubGlobal('MediaRecorder', GravadorFalso);
    let sequencia = 0;
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: vi.fn(() => `blob:voz/${++sequencia}`) });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: vi.fn() });
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
  });

  afterEach(() => {
    Reflect.deleteProperty(navigator, 'mediaDevices');
    vi.unstubAllGlobals();
  });

  it('sem suporte a nota de voz no servidor o microfone fica desabilitado com o aviso', async () => {
    renderComVoz({ conversa: 'conv-a', available: false }, 'dark');
    expect(microfone()).toHaveAttribute('aria-disabled', 'true');

    await userEvent.click(microfone());
    expect(getUserMedia).not.toHaveBeenCalled();

    await userEvent.hover(microfone());
    expect(await screen.findByRole('tooltip')).toHaveTextContent(voz.unavailable);
  });

  it('conversa encerrada desabilita o microfone com o motivo', async () => {
    renderComVoz({ conversa: 'conv-a', disabled: true });
    expect(microfone()).toHaveAttribute('aria-disabled', 'true');

    await userEvent.click(microfone());
    expect(getUserMedia).not.toHaveBeenCalled();

    await userEvent.hover(microfone());
    expect(await screen.findByRole('tooltip')).toHaveTextContent(voz.conversationClosed);
  });

  it('o microfone só aparece com o campo vazio', async () => {
    renderComVoz({ conversa: 'conv-a' });

    await userEvent.type(campo(), 'oi');

    expect(screen.queryByRole('button', { name: chatStrings.composer.recordVoice })).not.toBeInTheDocument();
  });

  it('clicar no microfone troca a linha pela barra, mantém a resposta e foca o enviar', async () => {
    renderComVoz({ conversa: 'conv-a', replyTo: citada });

    await userEvent.click(microfone());

    expect(await barraGravando()).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/Digite uma mensagem/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: chatStrings.composer.attach })).not.toBeInTheDocument();
    expect(screen.getByText('pergunta')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: voz.send })).toHaveFocus());
  });

  it('Esc gravando não descarta a gravação', async () => {
    renderComVoz({ conversa: 'conv-a' });
    await userEvent.click(microfone());
    await barraGravando();

    await userEvent.keyboard('{Escape}');

    expect(screen.getByRole('group', { name: voz.record })).toBeInTheDocument();
    expect(trilha.stop).not.toHaveBeenCalled();
  });

  it('enviar grava a nota de voz citando a resposta ativa, libera o microfone e limpa a resposta', async () => {
    const { enqueue, onCancelReply } = renderComVoz({ conversa: 'conv-a', replyTo: citada });
    await userEvent.click(microfone());
    await barraGravando();

    agora = 2_500;
    await userEvent.click(screen.getByRole('button', { name: voz.send }));

    await waitFor(() => expect(enqueue).toHaveBeenCalledTimes(1));
    expect(enqueue).toHaveBeenCalledWith('conv-a', [
      { file: expect.any(File), classification: 'voice', quotedMessageId: citada.id },
    ]);
    expect(onCancelReply).toHaveBeenCalled();
    expect(trilha.stop).toHaveBeenCalled();
    expect(await screen.findByPlaceholderText(/Digite uma mensagem/)).toBeInTheDocument();
  });

  it('gravação curta demais avisa e não envia', async () => {
    const { enqueue, onNotice } = renderComVoz({ conversa: 'conv-a' });
    await userEvent.click(microfone());
    await barraGravando();

    agora = 400;
    await userEvent.click(screen.getByRole('button', { name: voz.send }));

    await waitFor(() => expect(onNotice).toHaveBeenCalledWith(voz.tooShort, 'warning'));
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('microfone bloqueado avisa a causa específica e volta ao campo', async () => {
    getUserMedia.mockRejectedValueOnce(new DOMException('negado', 'NotAllowedError'));
    const { onNotice } = renderComVoz({ conversa: 'conv-a' });

    await userEvent.click(microfone());

    await waitFor(() => expect(onNotice).toHaveBeenCalledWith(voz.errors.permissionDenied, 'error'));
    expect(campo()).toBeInTheDocument();
  });

  it('trocar de conversa gravando guarda rascunho e libera o microfone; ao voltar, abre o rascunho', async () => {
    const { enqueue, onNotice, trocar } = renderComVoz({ conversa: 'conv-a' });
    await userEvent.click(microfone());
    await barraGravando();
    agora = 3_200;

    trocar({ conversa: 'conv-b' });

    await waitFor(() => expect(onNotice).toHaveBeenCalledWith(voz.draftSaved, 'info'));
    expect(trilha.stop).toHaveBeenCalled();
    expect(campo()).toBeInTheDocument();
    expect(microfone()).not.toHaveAttribute('aria-disabled');

    trocar({ conversa: 'conv-a' });

    const rascunho = await screen.findByRole('group', { name: voz.draft });
    expect(rascunho).toHaveTextContent('00:03');
    expect(screen.getByRole('button', { name: voz.play })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: voz.pause })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: voz.resume })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: voz.send }));

    await waitFor(() =>
      expect(enqueue).toHaveBeenCalledWith('conv-a', [
        { file: expect.any(File), classification: 'voice', quotedMessageId: undefined },
      ]),
    );
    expect(await screen.findByPlaceholderText(/Digite uma mensagem/)).toBeInTheDocument();
  });

  it('conversa encerrada com rascunho: enviar desabilitado com o motivo, descartar continua possível', async () => {
    const { enqueue, trocar } = renderComVoz({ conversa: 'conv-a' });
    await userEvent.click(microfone());
    await barraGravando();
    agora = 3_200;
    trocar({ conversa: 'conv-b' });
    await waitFor(() => expect(trilha.stop).toHaveBeenCalled());

    trocar({ conversa: 'conv-a', disabled: true });

    await screen.findByRole('group', { name: voz.draft });
    expect(screen.getByRole('button', { name: voz.send })).toBeDisabled();
    await userEvent.hover(screen.getByLabelText(voz.conversationClosed));
    expect(await screen.findByRole('tooltip')).toHaveTextContent(voz.conversationClosed);

    await userEvent.click(screen.getByRole('button', { name: voz.discard }));
    await waitFor(() => expect(screen.queryByRole('group', { name: voz.draft })).not.toBeInTheDocument());
    expect(enqueue).not.toHaveBeenCalled();
  });
});
