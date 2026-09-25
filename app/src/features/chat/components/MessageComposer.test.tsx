import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithTheme } from '@/test/renderWithTheme';
import { chatStrings } from '@/features/chat/strings';
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

/** Área de transferência mínima do `paste`: itens `file` e/ou `string`, como o navegador expõe. */
function clipboard(files: File[], text = '') {
  const items = [
    ...files.map((file) => ({ kind: 'file', type: file.type, getAsFile: () => file })),
    ...(text ? [{ kind: 'string', type: 'text/plain', getAsFile: () => null }] : []),
  ];
  return {
    types: [...(files.length ? ['Files'] : []), ...(text ? ['text/plain'] : [])],
    items,
    files,
    getData: (type: string) => (type === 'text/plain' ? text : ''),
  };
}

const clipe = () => screen.getByRole('button', { name: chatStrings.composer.attach });
const print = () => new File(['png'], 'print.png', { type: 'image/png' });

describe('MessageComposer — anexos', () => {
  it('colar um arquivo abre a prévia com classificação automática, sem colar no campo', () => {
    const onAttachFiles = vi.fn();
    renderWithTheme(<MessageComposer onSend={vi.fn()} onAttachFiles={onAttachFiles} />);
    const arquivo = print();

    const naoCancelado = fireEvent.paste(campo(), { clipboardData: clipboard([arquivo]) });

    expect(naoCancelado).toBe(false);
    expect(onAttachFiles).toHaveBeenCalledWith([arquivo], 'auto');
  });

  it('colar só texto segue o comportamento normal do campo', async () => {
    const onAttachFiles = vi.fn();
    const onSend = vi.fn();
    renderWithTheme(<MessageComposer onSend={onSend} onAttachFiles={onAttachFiles} />);

    const naoCancelado = fireEvent.paste(campo(), { clipboardData: clipboard([], 'bom dia') });
    expect(naoCancelado).toBe(true);
    expect(onAttachFiles).not.toHaveBeenCalled();

    await userEvent.click(campo());
    await userEvent.paste('bom dia');
    await userEvent.keyboard('{Enter}');
    expect(onSend).toHaveBeenCalledWith('bom dia');
    expect(onAttachFiles).not.toHaveBeenCalled();
  });

  it('conversa encerrada desabilita o clipe com o motivo e ignora arquivo colado', async () => {
    const onAttachFiles = vi.fn();
    renderWithTheme(
      <MessageComposer
        onSend={vi.fn()}
        disabled
        onAttachFiles={onAttachFiles}
        attachDisabledReason={chatStrings.attachments.conversationClosed}
      />,
    );
    expect(clipe()).toHaveAttribute('aria-disabled', 'true');

    await userEvent.click(clipe());
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    await userEvent.hover(clipe());
    expect(await screen.findByRole('tooltip')).toHaveTextContent(chatStrings.attachments.conversationClosed);

    fireEvent.paste(campo(), { clipboardData: clipboard([print()]) });
    expect(onAttachFiles).not.toHaveBeenCalled();
  });

  it('sem os limites de upload o clipe fica desabilitado com o aviso de indisponível', async () => {
    renderWithTheme(<MessageComposer onSend={vi.fn()} />, 'dark');
    expect(clipe()).toHaveAttribute('aria-disabled', 'true');

    await userEvent.hover(clipe());
    expect(await screen.findByRole('tooltip')).toHaveTextContent(chatStrings.attachments.unavailable);
  });

  it('o clipe habilitado abre o menu de anexo', async () => {
    renderWithTheme(<MessageComposer onSend={vi.fn()} onAttachFiles={vi.fn()} />);

    await userEvent.click(clipe());

    expect(screen.getByRole('menu', { name: chatStrings.attachments.menuLabel })).toBeInTheDocument();
  });
});
