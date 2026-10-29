import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithTheme } from '@/test/renderWithTheme';
import { DnsSetupGuide } from './components/DnsSetupGuide';
import { linkDomainsAdminStrings as t } from './strings';

describe('DnsSetupGuide', () => {
  beforeEach(() => { sessionStorage.clear(); localStorage.clear(); });

  it('o botão do passo a passo usa o título visível e informa aberto/fechado', () => {
    renderWithTheme(<DnsSetupGuide />);
    const toggle = screen.getByRole('button', { name: new RegExp(t.dns.title) });
    expect(toggle).not.toHaveAttribute('aria-label');
    expect(toggle).toHaveAttribute('aria-controls', 'dns-guide-content');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
  });

  it('aviso de propagação diz o prazo de até 1 minuto', () => {
    expect(t.propagationNote).toMatch(/até 1 minuto/);
  });
});
