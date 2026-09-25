import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PaletteMode } from '@mui/material';
import { renderWithTheme } from '@/test/renderWithTheme';
import { buildTheme } from '@/theme/theme';
import { chatStrings } from '../strings';
import { initialVoiceRecorderState, type VoiceRecorderState } from '../media/voiceRecorderMachine';
import { VoiceRecorderBar } from './VoiceRecorderBar';

const voz = chatStrings.voice;

function renderizar(
  parcial: Partial<VoiceRecorderState> = {},
  extra: { previewUrl?: string | null; levels?: number[] } = {},
  mode: PaletteMode = 'light',
) {
  const callbacks = {
    onPause: vi.fn(),
    onResume: vi.fn(),
    onSend: vi.fn(),
    onDiscard: vi.fn(),
    onPreviewError: vi.fn(),
  };
  const state: VoiceRecorderState = { ...initialVoiceRecorderState, status: 'recording', elapsedMs: 5_000, ...parcial };
  const view = renderWithTheme(
    <VoiceRecorderBar
      state={state}
      levels={extra.levels ?? [0.2, 0.8, 0.5]}
      previewUrl={extra.previewUrl === undefined ? 'blob:gravacao' : extra.previewUrl}
      {...callbacks}
    />,
    mode,
  );
  return { ...callbacks, ...view };
}

const botao = (name: string) => screen.getByRole('button', { name });
const semBotao = (name: string) => expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();

beforeEach(() => {
  // O jsdom não reproduz mídia.
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
});

describe('VoiceRecorderBar — cronômetro', () => {
  it('mostra o tempo gravado em mm:ss com rótulo falado e anúncio educado', () => {
    renderizar({ elapsedMs: 65_400 });

    const cronometro = screen.getByRole('timer', { name: voz.timerLabel(65) });
    expect(cronometro).toHaveTextContent('01:05');
    expect(cronometro).not.toHaveAttribute('aria-live', 'polite');
  });
});

describe('VoiceRecorderBar — gravando', () => {
  it('mostra indicador de gravação, ondas ocultas do leitor e pausar, sem pré-escuta', () => {
    renderizar();

    expect(screen.getByRole('img', { name: voz.recording })).toBeInTheDocument();
    const ondas = screen.getByTestId('voice-recorder-waves');
    expect(ondas).toHaveAttribute('aria-hidden', 'true');
    expect(ondas.children).toHaveLength(3);
    expect(botao(voz.pause)).toBeEnabled();
    semBotao(voz.play);
    semBotao(voz.resume);
  });

  it('pausar, enviar e descartar chamam as ações certas', async () => {
    const user = userEvent.setup();
    const { onPause, onSend, onDiscard, onResume } = renderizar();

    await user.click(botao(voz.pause));
    await user.click(botao(voz.send));
    await user.click(botao(voz.discard));

    expect(onPause).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(onResume).not.toHaveBeenCalled();
  });
});

describe('VoiceRecorderBar — pausado', () => {
  it('troca pausar por retomar e oferece a pré-escuta', async () => {
    const user = userEvent.setup();
    const { onResume } = renderizar({ status: 'paused' });

    expect(screen.queryByRole('img', { name: voz.recording })).not.toBeInTheDocument();
    semBotao(voz.pause);
    expect(botao(voz.play)).toBeEnabled();

    await user.click(botao(voz.resume));
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it('tocar e parar a pré-escuta alterna o botão', async () => {
    const user = userEvent.setup();
    renderizar({ status: 'paused' });

    await user.click(botao(voz.play));
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);

    await user.click(botao(voz.stopPlaying));
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
    expect(botao(voz.play)).toBeInTheDocument();
  });

  it('falha ao tocar avisa a pré-escuta indisponível', async () => {
    const user = userEvent.setup();
    vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValueOnce(
      new DOMException('formato não suportado', 'NotSupportedError'),
    );
    const { onPreviewError } = renderizar({ status: 'paused' });

    await user.click(botao(voz.play));

    expect(onPreviewError).toHaveBeenCalledTimes(1);
    expect(botao(voz.play)).toBeInTheDocument();
  });

  it('interrupção do carregamento não é tratada como falha', async () => {
    const user = userEvent.setup();
    vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValueOnce(new DOMException('troca de áudio', 'AbortError'));
    const { onPreviewError } = renderizar({ status: 'paused' });

    await user.click(botao(voz.play));

    expect(onPreviewError).not.toHaveBeenCalled();
  });

  it('sem áudio pronto, ouvir fica desabilitado', () => {
    renderizar({ status: 'paused' }, { previewUrl: null });

    expect(botao(voz.play)).toBeDisabled();
  });
});

describe('VoiceRecorderBar — máximo atingido', () => {
  it('retomar fica desabilitado com o limite no tooltip; ouvir e enviar seguem', async () => {
    const user = userEvent.setup();
    renderizar({ status: 'paused', maxReached: true, elapsedMs: 900_000 });
    const aviso = voz.maxReached(15);

    expect(botao(voz.resume)).toBeDisabled();
    expect(botao(voz.play)).toBeEnabled();
    expect(botao(voz.send)).toBeEnabled();

    await user.hover(screen.getByLabelText(aviso));
    expect(await screen.findByRole('tooltip')).toHaveTextContent(aviso);
  });
});

describe('VoiceRecorderBar — rascunho', () => {
  it('sem retomar nem pausar, com pré-escuta, aviso de rascunho, enviar e descartar', async () => {
    const user = userEvent.setup();
    const { onSend, onDiscard } = renderizar({ status: 'draft' });

    expect(screen.getByText(voz.draft)).toBeInTheDocument();
    semBotao(voz.resume);
    semBotao(voz.pause);
    expect(botao(voz.play)).toBeEnabled();

    await user.click(botao(voz.send));
    await user.click(botao(voz.discard));
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });
});

describe('VoiceRecorderBar — pré-escuta indisponível', () => {
  it('ouvir desabilitado com explicação, sem impedir retomar e enviar', async () => {
    const user = userEvent.setup();
    renderizar({ status: 'paused', previewUnsupported: true });

    expect(botao(voz.play)).toBeDisabled();
    expect(botao(voz.resume)).toBeEnabled();
    expect(botao(voz.send)).toBeEnabled();

    await user.hover(screen.getByLabelText(voz.previewUnsupported));
    expect(await screen.findByRole('tooltip')).toHaveTextContent(voz.previewUnsupported);
  });
});

describe('VoiceRecorderBar — enviando', () => {
  it('desabilita os controles e mostra o indicador de envio', () => {
    renderizar({ status: 'sending' });

    expect(screen.getByRole('progressbar', { name: chatStrings.upload.sending })).toBeInTheDocument();
    expect(botao(voz.send)).toBeDisabled();
    expect(botao(voz.discard)).toBeDisabled();
    semBotao(voz.play);
    semBotao(voz.pause);
  });
});

describe('VoiceRecorderBar — sem gravação', () => {
  it('não renderiza nada fora dos estados com áudio', () => {
    const { container } = renderizar({ status: 'idle' });

    expect(container).toBeEmptyDOMElement();
  });
});

describe('VoiceRecorderBar — tema escuro', () => {
  it('usa as cores do tema escuro no cronômetro e mantém os controles', () => {
    renderizar({ elapsedMs: 3_000 }, {}, 'dark');

    const cronometro = screen.getByRole('timer', { name: voz.timerLabel(3) });
    expect(cronometro).toHaveTextContent('00:03');
    expect(cronometro).toHaveStyle({ color: buildTheme('dark').palette.text.primary });
    expect(botao(voz.send)).toBeEnabled();
  });
});
