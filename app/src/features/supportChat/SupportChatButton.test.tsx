import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { getContrastRatio } from '@mui/material';
import { renderWithTheme } from '@/test/renderWithTheme';
import { SUPPORT_CHAT_PATH } from '@/features/platformLinks/links';
import { SUPPORT_CHAT_SURFACE, SupportChatButton } from './SupportChatButton';
import { SUPPORT_CHAT_HIDDEN_PATHS, isSupportChatHidden, isSupportChatRaised } from './routes';
import { supportChatStrings as t } from './strings';

const renderAt = (path: string, mode: 'light' | 'dark' = 'light') =>
  renderWithTheme(<MemoryRouter initialEntries={[path]}><SupportChatButton /></MemoryRouter>, mode);

const link = () => screen.queryByRole('link', { name: t.ariaLabel });

describe('SupportChatButton', () => {
  it.each(['light', 'dark'] as const)('é um link para o suporte em nova aba (%s)', (mode) => {
    renderAt('/login', mode);
    const a = link();
    expect(a).toBeInTheDocument();
    expect(a).toHaveAttribute('href', SUPPORT_CHAT_PATH);
    expect(a).toHaveAttribute('target', '_blank');
    expect(a).toHaveAttribute('rel', 'noopener noreferrer');
    expect(a).toHaveTextContent(t.label);
  });

  it.each(['/login', '/obrigado', '/suporte', '/privacidade', '/invite/abc', '/dashboard', '/monitoring', '/settings/sessions', '/chatbots'])(
    'aparece em %s',
    (path) => {
      renderAt(path);
      expect(link()).toBeInTheDocument();
    },
  );

  it.each(['/redirect/x', '/redirect/suporte', '/chat', '/chat/', '/chat/123', '/Chat', '/admin/workers/settings', '/admin/workers/capacity', '/admin/workers/scale'])('não aparece em %s', (path) => {
    renderAt(path);
    expect(link()).not.toBeInTheDocument();
  });

  it('lista de rotas ocultas e regra de prefixo', () => {
    expect(SUPPORT_CHAT_HIDDEN_PATHS).toEqual(['/redirect', '/chat', '/admin/workers/settings', '/admin/workers/capacity', '/admin/workers/scale', '/admin/costs/prices']);
    expect(isSupportChatHidden('/admin/workers')).toBe(false);
    expect(isSupportChatHidden('/redirect')).toBe(true);
    expect(isSupportChatHidden('/redirects')).toBe(false);
    expect(isSupportChatHidden('/')).toBe(false);
    expect(isSupportChatRaised('/monitoring')).toBe(true);
    expect(isSupportChatRaised('/offer-story')).toBe(true);
    expect(isSupportChatRaised('/offer-story/')).toBe(true);
    expect(isSupportChatRaised('/offers')).toBe(false);
  });

  it('branco sobre a superfície tem contraste de texto (≥ 4.5:1)', () => {
    expect(getContrastRatio('#fff', SUPPORT_CHAT_SURFACE)).toBeGreaterThanOrEqual(4.5);
  });
});
