import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithTheme } from '@/test/renderWithTheme';
import { PrivacyProvider } from '@/features/privacy';
import { featureUsageStrings as S } from '../strings';
import { detailFixture } from '../testFixtures';
import { BlurredAccountName } from './BlurredAccountName';
import { FeatureDetail } from './FeatureDetail';

vi.mock('@mui/x-charts/LineChart', () => ({ LineChart: () => <div data-testid="line-chart" /> }));

/** Número 1 em `width`/`height` no `sx` vira 100% e o bloco oculto ocupa a tela (área em branco no fim da rolagem). */
function expectOnePixel(el: HTMLElement) {
  const style = getComputedStyle(el);
  expect(style.width).toBe('1px');
  expect(style.height).toBe('1px');
}

describe('textos só para leitor de tela', () => {
  it('nome borrado da conta: rótulo oculto com 1px', () => {
    renderWithTheme(<BlurredAccountName blur tenantId="1a2b3c4d-0000" name="Loja Alfa" />);
    expectOnePixel(screen.getByText(S.filters.accountShort('1a2b3c4d-0000')));
  });

  it('tabela da série escondida atrás do gráfico: 1px', () => {
    renderWithTheme(<PrivacyProvider><FeatureDetail detail={detailFixture()} /></PrivacyProvider>);
    const table = screen.getByRole('table', { name: S.trend.tableAria, hidden: true });
    expectOnePixel(table.parentElement as HTMLElement);
  });
});
