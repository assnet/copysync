import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithTheme } from '@/test/renderWithTheme';
import { EmptyConversationState } from './EmptyConversationState';

describe('EmptyConversationState', () => {
  it('orienta o operador quando nenhuma conversa está aberta', () => {
    renderWithTheme(<EmptyConversationState />);
    expect(screen.getByText('Nenhuma conversa selecionada')).toBeInTheDocument();
  });

  it('não quebra no tema escuro', () => {
    // O componente lê `theme.palette` para montar gradientes; sem ThemeProvider no modo
    // certo isso lança. Aqui a asserção é sobre não explodir e continuar exibindo o texto —
    // contraste e legibilidade são verificados no smoke visual, não aqui.
    renderWithTheme(<EmptyConversationState />, 'dark');
    expect(screen.getByText('Nenhuma conversa selecionada')).toBeInTheDocument();
  });
});
