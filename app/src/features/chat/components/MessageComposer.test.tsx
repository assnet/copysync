import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithTheme } from '@/test/renderWithTheme';
import { MessageComposer } from './MessageComposer';
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
