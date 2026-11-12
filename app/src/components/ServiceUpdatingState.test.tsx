import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import { useState } from 'react';
import { renderWithTheme } from '@/test/renderWithTheme';
import { autoRetryDelay } from '@/hooks/useAutoRetry';
import { ServiceUpdatingState } from './ServiceUpdatingState';
import { serviceUpdatingStrings as t } from './serviceUpdatingStrings';

const status = () => screen.getByTestId('service-updating-status').textContent;

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

function stubReducedMotion(reduce: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduce && query.includes('reduced-motion'),
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => true,
  }));
}

/** Avança o relógio e deixa as promessas da tentativa assentarem. */
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  setVisibility('visible');
});

afterEach(() => {
  vi.unstubAllGlobals();
  setVisibility('visible');
  vi.useRealTimers();
});

describe('autoRetryDelay', () => {
  it('5 s → 10 s → 20 s → teto 30 s', () => {
    expect([0, 1, 2, 3, 9].map(autoRetryDelay)).toEqual([5_000, 10_000, 20_000, 30_000, 30_000]);
  });
});

describe('ServiceUpdatingState', () => {
  it('mostra título, texto e a contagem regressiva até a 1ª tentativa', async () => {
    const onRetry = vi.fn().mockResolvedValue(undefined);
    renderWithTheme(<ServiceUpdatingState onRetry={onRetry} />);
    expect(screen.getByText(t.title)).toBeInTheDocument();
    expect(screen.getByText(t.description)).toBeInTheDocument();
    expect(status()).toBe(t.nextAttempt(5));
    await advance(1_000);
    expect(status()).toBe(t.nextAttempt(4));
    await advance(3_000);
    expect(status()).toBe(t.nextAttempt(1));
    expect(onRetry).not.toHaveBeenCalled();
    await advance(1_000);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('falhando de novo, a espera segue a escada 10 s → 20 s → 30 s', async () => {
    const onRetry = vi.fn().mockRejectedValue(new Error('fora'));
    renderWithTheme(<ServiceUpdatingState onRetry={onRetry} />);
    await advance(5_000);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(status()).toBe(t.nextAttempt(10));
    await advance(9_999);
    expect(onRetry).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(status()).toBe(t.nextAttempt(20));
    await advance(20_000);
    expect(onRetry).toHaveBeenCalledTimes(3);
    expect(status()).toBe(t.nextAttempt(30));
    await advance(30_000);
    expect(onRetry).toHaveBeenCalledTimes(4);
    expect(status()).toBe(t.nextAttempt(30));
  });

  it('mostra "Tentando de novo…" enquanto a tentativa está em voo', async () => {
    let resolve!: () => void;
    const onRetry = vi.fn(() => new Promise<void>((r) => { resolve = r; }));
    renderWithTheme(<ServiceUpdatingState onRetry={onRetry} />);
    await advance(5_000);
    expect(status()).toBe(t.retrying);
    expect(screen.getByRole('button', { name: t.retryNow })).toBeDisabled();
    await act(async () => { resolve(); });
    expect(status()).toBe(t.nextAttempt(10));
  });

  it('"Tentar agora" tenta na hora e reinicia o degrau atual, sem avançar a escada', async () => {
    const onRetry = vi.fn().mockResolvedValue(undefined);
    renderWithTheme(<ServiceUpdatingState onRetry={onRetry} />);
    await advance(2_000);
    fireEvent.click(screen.getByRole('button', { name: t.retryNow }));
    await advance(0);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(status()).toBe(t.nextAttempt(5));
    await advance(5_000);
    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(status()).toBe(t.nextAttempt(10));
    fireEvent.click(screen.getByRole('button', { name: t.retryNow }));
    await advance(0);
    expect(onRetry).toHaveBeenCalledTimes(3);
    expect(status()).toBe(t.nextAttempt(10));
  });

  it('desmontar no meio da contagem não deixa timer pendente', async () => {
    const onRetry = vi.fn();
    const { unmount } = renderWithTheme(<ServiceUpdatingState onRetry={onRetry} />);
    await advance(2_500);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    await advance(60_000);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('depois de 3 min tentando avisa que está demorando, sem desistir', async () => {
    const onRetry = vi.fn().mockRejectedValue(new Error('fora'));
    renderWithTheme(<ServiceUpdatingState onRetry={onRetry} />);
    await advance(170_000);
    expect(screen.queryByText(t.slow)).not.toBeInTheDocument();
    await advance(15_000);
    expect(screen.getByText(t.slow)).toBeInTheDocument();
    const calls = onRetry.mock.calls.length;
    await advance(30_000);
    expect(onRetry.mock.calls.length).toBe(calls + 1);
  });

  it('aba oculta pausa a contagem e retoma do mesmo ponto ao voltar', async () => {
    const onRetry = vi.fn().mockResolvedValue(undefined);
    renderWithTheme(<ServiceUpdatingState onRetry={onRetry} />);
    await advance(2_000);
    setVisibility('hidden');
    expect(status()).toBe(t.paused);
    await advance(60_000);
    expect(onRetry).not.toHaveBeenCalled();
    setVisibility('visible');
    expect(status()).toBe(t.nextAttempt(3));
    await advance(3_000);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('tentativa com sucesso esconde o estado (quem chama deixa de renderizar)', async () => {
    function Screen() {
      const [up, setUp] = useState(false);
      return up ? <p>dados</p> : <ServiceUpdatingState onRetry={async () => setUp(true)} />;
    }
    renderWithTheme(<Screen />);
    await advance(5_000);
    expect(screen.queryByText(t.title)).not.toBeInTheDocument();
    expect(screen.getByText('dados')).toBeInTheDocument();
    // Desmontado: nenhum timer pendente volta a chamar nada.
    expect(vi.getTimerCount()).toBe(0);
  });

  it('anuncia por aria-live só o título/texto e o "ainda atualizando", não cada segundo', async () => {
    const onRetry = vi.fn().mockRejectedValue(new Error('fora'));
    renderWithTheme(<ServiceUpdatingState onRetry={onRetry} />);
    const live = screen.getByText(t.title).closest('[aria-live="polite"]');
    expect(live).not.toBeNull();
    expect(live).not.toContainElement(screen.getByTestId('service-updating-status'));
    await advance(5_000);
    expect(live).toHaveTextContent(t.stillUpdating(1));
    await advance(10_000);
    expect(live).toHaveTextContent(t.stillUpdating(2));
    expect(live).not.toHaveTextContent(t.stillUpdating(1));
  });

  it('anima a ilustração por padrão e fica parada com prefers-reduced-motion', () => {
    stubReducedMotion(false);
    const { unmount } = renderWithTheme(<ServiceUpdatingState onRetry={vi.fn()} />);
    expect(screen.getByRole('img', { name: t.illustrationLabel })).toHaveAttribute('data-motion', 'on');
    unmount();
    stubReducedMotion(true);
    renderWithTheme(<ServiceUpdatingState onRetry={vi.fn()} />);
    expect(screen.getByRole('img', { name: t.illustrationLabel })).toHaveAttribute('data-motion', 'off');
  });
});
