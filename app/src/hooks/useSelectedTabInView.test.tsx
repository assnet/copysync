import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { Tab, Tabs } from '@mui/material';
import { useSelectedTabInView } from './useSelectedTabInView';

type Rect = { left: number; right: number };
const rect = ({ left, right }: Rect) => ({ left, right, top: 0, bottom: 20, width: right - left, height: 20, x: left, y: 0, toJSON: () => ({}) }) as DOMRect;

let resize: (() => void) | null = null;
class FakeResizeObserver {
  constructor(cb: () => void) { resize = cb; }
  observe() {}
  unobserve() {}
  disconnect() { resize = null; }
}

function Bar({ value }: { value: string }) {
  const ref = useSelectedTabInView(value);
  return (
    <Tabs ref={ref} value={value} variant="scrollable" aria-label="abas">
      <Tab value="a" label="A" />
      <Tab value="b" label="B" />
      <Tab value="c" label="C" />
    </Tabs>
  );
}

afterEach(() => { vi.unstubAllGlobals(); resize = null; });

describe('useSelectedTabInView', () => {
  it('ao estreitar a janela, rola o trilho até a aba selecionada aparecer inteira', () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    const { container, getByRole } = render(<Bar value="c" />);
    const scroller = container.querySelector<HTMLElement>('.MuiTabs-scroller')!;
    const selected = getByRole('tab', { selected: true });
    // Trilho de 0 a 300 px; a aba C (de 280 a 380) ficou cortada depois do resize
    scroller.getBoundingClientRect = () => rect({ left: 0, right: 300 });
    selected.getBoundingClientRect = () => rect({ left: 280, right: 380 });
    scroller.scrollLeft = 0;
    resize!();
    expect(scroller.scrollLeft).toBe(80);
    // Cortada à esquerda: volta o necessário
    selected.getBoundingClientRect = () => rect({ left: -40, right: 60 });
    scroller.scrollLeft = 200;
    resize!();
    expect(scroller.scrollLeft).toBe(160);
    // Inteira na vista: não mexe
    selected.getBoundingClientRect = () => rect({ left: 100, right: 200 });
    resize!();
    expect(scroller.scrollLeft).toBe(160);
  });

  it('sem ResizeObserver não quebra', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    expect(() => render(<Bar value="a" />)).not.toThrow();
  });
});
