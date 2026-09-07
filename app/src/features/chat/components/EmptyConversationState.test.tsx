import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithTheme } from '@/test/renderWithTheme';
import { EmptyConversationState } from './EmptyConversationState';

describe('EmptyConversationState', () => {
  it('orienta o operador quando nenhuma conversa está aberta', () => {
    renderWithTheme(<EmptyConversationState />);
    expect(screen.getByText('Nenhuma conversa selecionada')).toBeInTheDocument();
  });

  it('renderiza igual no tema escuro', () => {
    renderWithTheme(<EmptyConversationState />, 'dark');
    expect(screen.getByText('Nenhuma conversa selecionada')).toBeInTheDocument();
  });
});
