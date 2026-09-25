import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithTheme } from '@/test/renderWithTheme';
import { buildTheme } from '@/theme/theme';
import { AudioMessage, formatDuration, formatRate } from './AudioMessage';
import { chatStrings } from '../../strings';
import { resetWaveformCache } from '../../media/audioWaveform';

const t = chatStrings.audioPlayer;
const URL_OGG = 'https://cdn.example/voice.ogg';

let playSpy: Mock<(this: HTMLMediaElement) => Promise<void>>;
let pauseSpy: Mock<(this: HTMLMediaElement) => void>;
let currentTimeSetter: Mock<(value: number) => void>;

beforeEach(() => {
  // jsdom não implementa reprodução: o play/pause viram dublês que disparam os eventos reais.
  playSpy = vi.fn(function (this: HTMLMediaElement) {
    this.dispatchEvent(new Event('play'));
    return Promise.resolve();
  });
  pauseSpy = vi.fn(function (this: HTMLMediaElement) {
    this.dispatchEvent(new Event('pause'));
  });
  currentTimeSetter = vi.fn<(value: number) => void>();
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(playSpy);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(pauseSpy);
  Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', {
    configurable: true,
    get: () => 0,
    set: currentTimeSetter,
  });
  // A onda real nunca chega no teste: a bolha fica com a onda provisória.
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetWaveformCache();
});

const audioEl = () => document.querySelector('audio') as HTMLAudioElement;
const playButton = () => screen.getByRole('button', { name: t.play });

describe('AudioMessage — formatação', () => {
  it('mostra minutos:segundos e velocidade com vírgula', () => {
    expect(formatDuration(7)).toBe('0:07');
    expect(formatDuration(75)).toBe('1:15');
    expect(formatDuration(NaN)).toBe('0:00');
    expect(formatRate(1.5)).toBe('1,5×');
    expect(formatRate(2)).toBe('2×');
  });
});

describe('AudioMessage — player', () => {
  it('em repouso mostra a duração, o avatar e o selo de microfone da nota de voz', () => {
    renderWithTheme(
      <AudioMessage mediaUrl={URL_OGG} mimeType="audio/ogg; codecs=opus" durationSeconds={7} isOut={false} avatarUrl="https://cdn.example/foto.jpg" />,
    );
    expect(screen.getByText('0:07')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: t.senderAvatar })).toHaveAttribute('src', 'https://cdn.example/foto.jpg');
    expect(screen.getByRole('img', { name: t.voiceNote })).toBeInTheDocument();
    expect(audioEl()).toHaveAttribute('preload', 'metadata');
    expect(audioEl()).toHaveAttribute('src', URL_OGG);
  });

  it('arquivo de música não ganha selo de microfone', () => {
    renderWithTheme(<AudioMessage mediaUrl={URL_OGG} mimeType="audio/mpeg" durationSeconds={7} isOut={false} />);
    expect(screen.queryByRole('img', { name: t.voiceNote })).not.toBeInTheDocument();
  });

  it('play e pause acionam o <audio> e trocam o rótulo do botão', async () => {
    renderWithTheme(<AudioMessage mediaUrl={URL_OGG} mimeType="audio/ogg" durationSeconds={7} isOut={false} />);
    await userEvent.click(playButton());
    expect(playSpy).toHaveBeenCalledTimes(1);
    const pauseButton = screen.getByRole('button', { name: t.pause });
    await userEvent.click(pauseButton);
    expect(pauseSpy).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: t.play })).toBeInTheDocument();
  });

  it('só um áudio toca por vez: dar play no segundo pausa o primeiro', async () => {
    renderWithTheme(
      <>
        <AudioMessage mediaUrl={`${URL_OGG}?a`} mimeType="audio/ogg" durationSeconds={7} isOut={false} />
        <AudioMessage mediaUrl={`${URL_OGG}?b`} mimeType="audio/ogg" durationSeconds={9} isOut={false} />
      </>,
    );
    const [first, second] = screen.getAllByRole('button', { name: t.play });
    await userEvent.click(first);
    // O dublê do play não muda `paused`; simula o estado real para o registro pausar o anterior.
    const [audioA] = Array.from(document.querySelectorAll('audio'));
    Object.defineProperty(audioA, 'paused', { configurable: true, get: () => false });
    await userEvent.click(second);
    expect(pauseSpy).toHaveBeenCalledTimes(1);
    expect(playSpy).toHaveBeenCalledTimes(2);
  });

  it('clique na onda posiciona o áudio proporcionalmente e atualiza o tempo mostrado', () => {
    renderWithTheme(<AudioMessage mediaUrl={URL_OGG} mimeType="audio/ogg" durationSeconds={10} isOut={false} />);
    const slider = screen.getByRole('slider', { name: t.seek });
    vi.spyOn(slider, 'getBoundingClientRect').mockReturnValue({
      left: 0, width: 200, top: 0, height: 30, right: 200, bottom: 30, x: 0, y: 0, toJSON: () => ({}),
    });
    fireEvent.pointerDown(slider, { clientX: 100, pointerId: 1 });
    expect(currentTimeSetter).toHaveBeenLastCalledWith(5);
    expect(slider).toHaveAttribute('aria-valuenow', '5');
    expect(slider).toHaveAttribute('aria-valuemax', '10');
    expect(screen.getByText('0:05')).toBeInTheDocument();
  });

  it('setas do teclado deslocam 5 segundos sem passar dos limites', () => {
    renderWithTheme(<AudioMessage mediaUrl={URL_OGG} mimeType="audio/ogg" durationSeconds={7} isOut={false} />);
    const slider = screen.getByRole('slider', { name: t.seek });
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(currentTimeSetter).toHaveBeenLastCalledWith(5);
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(currentTimeSetter).toHaveBeenLastCalledWith(7);
    fireEvent.keyDown(slider, { key: 'Home' });
    expect(currentTimeSetter).toHaveBeenLastCalledWith(0);
  });

  it('timeupdate durante a reprodução mostra o tempo corrente', async () => {
    renderWithTheme(<AudioMessage mediaUrl={URL_OGG} mimeType="audio/ogg" durationSeconds={30} isOut={false} />);
    await userEvent.click(playButton());
    const audio = audioEl();
    Object.defineProperty(audio, 'currentTime', { configurable: true, get: () => 12, set: currentTimeSetter });
    fireEvent(audio, new Event('timeupdate'));
    expect(screen.getByText('0:12')).toBeInTheDocument();
    expect(screen.queryByText('0:30')).not.toBeInTheDocument();
  });

  it('clique na duração alterna a velocidade 1× → 1,5× → 2× → 1×', async () => {
    renderWithTheme(<AudioMessage mediaUrl={URL_OGG} mimeType="audio/ogg" durationSeconds={7} isOut={false} />);
    await userEvent.click(screen.getByRole('button', { name: t.speed('1×') }));
    expect(screen.getByText('1,5×')).toBeInTheDocument();
    expect(audioEl().playbackRate).toBe(1.5);
    await userEvent.click(screen.getByRole('button', { name: t.speed('1,5×') }));
    expect(screen.getByText('2×')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: t.speed('2×') }));
    expect(screen.getByRole('button', { name: t.speed('1×') })).toBeInTheDocument();
  });

  it('no escuro a parte tocada e o cursor usam a cor primária do tema (mensagem recebida)', () => {
    const dark = buildTheme('dark');
    renderWithTheme(<AudioMessage mediaUrl={URL_OGG} mimeType="audio/ogg" durationSeconds={10} isOut={false} />, 'dark');
    const slider = screen.getByRole('slider', { name: t.seek });
    const cursor = slider.lastElementChild as HTMLElement;
    expect(cursor).toHaveStyle({ backgroundColor: dark.palette.primary.main });
    expect(playButton()).toBeEnabled();
  });
});

describe('AudioMessage — sem mídia ou com erro', () => {
  it('sem URL mostra o placeholder de nota de voz com o play desabilitado', () => {
    renderWithTheme(<AudioMessage mediaUrl={null} mimeType="audio/ogg" durationSeconds={7} isOut={true} />);
    expect(screen.getByText(t.voiceNote)).toBeInTheDocument();
    expect(screen.getByText('0:07')).toBeInTheDocument();
    expect(playButton()).toBeDisabled();
    expect(screen.queryByRole('slider')).not.toBeInTheDocument();
  });

  it('sem URL e sem ser nota de voz mostra "Áudio"', () => {
    renderWithTheme(<AudioMessage mediaUrl={null} mimeType="audio/mpeg" isOut={false} />, 'dark');
    expect(screen.getByText(t.audio)).toBeInTheDocument();
    expect(playButton()).toBeDisabled();
  });

  it('erro de carga tenta uma vez com ?retry e depois cai no placeholder de indisponível', () => {
    vi.useFakeTimers();
    try {
      renderWithTheme(<AudioMessage mediaUrl={URL_OGG} mimeType="audio/ogg" durationSeconds={7} isOut={false} />);
      fireEvent.error(audioEl());
      act(() => { vi.advanceTimersByTime(800); });
      expect(audioEl()).toHaveAttribute('src', `${URL_OGG}?retry=1`);
      fireEvent.error(audioEl());
      expect(screen.getByText(t.unavailable)).toBeInTheDocument();
      expect(playButton()).toBeDisabled();
    } finally {
      vi.useRealTimers();
    }
  });
});
