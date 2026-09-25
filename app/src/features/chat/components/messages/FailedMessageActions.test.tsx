import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithTheme } from '@/test/renderWithTheme';
import { buildTheme } from '@/theme/theme';
import { FailedMessageActions } from './FailedMessageActions';
import { chatStrings } from '../../strings';

const t = chatStrings.upload;
const botao = (nome: string) => screen.queryByRole('button', { name: nome });

describe('FailedMessageActions — falha local', () => {
  it('rede: explica a causa e oferece tentar de novo e descartar', async () => {
    const onRetry = vi.fn();
    const onDiscard = vi.fn();
    renderWithTheme(<FailedMessageActions kind="network" onRetry={onRetry} onDiscard={onDiscard} />);

    expect(screen.getByText(t.errors.network)).toBeInTheDocument();
    await userEvent.click(botao(t.retry)!);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onDiscard).not.toHaveBeenCalled();

    await userEvent.click(botao(t.discard)!);
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });

  it('sessão desconectada: explica a causa e oferece as duas ações', () => {
    renderWithTheme(<FailedMessageActions kind="session" onRetry={vi.fn()} onDiscard={vi.fn()} />);

    expect(screen.getByText(t.errors.sessionDisconnected)).toBeInTheDocument();
    expect(botao(t.retry)).toBeInTheDocument();
    expect(botao(t.discard)).toBeInTheDocument();
  });

  it('arquivo recusado: só descartar, com o motivo', async () => {
    const onDiscard = vi.fn();
    renderWithTheme(<FailedMessageActions kind="rejected" onRetry={vi.fn()} onDiscard={onDiscard} />);

    expect(screen.getByText(t.errors.rejected)).toBeInTheDocument();
    expect(botao(t.retry)).not.toBeInTheDocument();
    await userEvent.click(botao(t.discard)!);
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });
});

describe('FailedMessageActions — falha do servidor', () => {
  it('só tentar de novo: não há descarte local de mensagem gravada', async () => {
    const onRetry = vi.fn();
    renderWithTheme(<FailedMessageActions kind="server" onRetry={onRetry} onDiscard={vi.fn()} />);

    expect(screen.getByText(t.errors.generic)).toBeInTheDocument();
    expect(botao(t.discard)).not.toBeInTheDocument();
    await userEvent.click(botao(t.retry)!);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe('FailedMessageActions — acessibilidade', () => {
  it('agrupa as ações sob "Não enviada" e sem callback não renderiza o botão', () => {
    renderWithTheme(<FailedMessageActions kind="network" onDiscard={vi.fn()} />);

    expect(screen.getByRole('group', { name: t.failed })).toBeInTheDocument();
    expect(botao(t.retry)).not.toBeInTheDocument();
    expect(botao(t.discard)).toBeInTheDocument();
  });

  it('botões com alvo de ao menos 40 px', () => {
    renderWithTheme(<FailedMessageActions kind="network" onRetry={vi.fn()} onDiscard={vi.fn()} />);

    expect(botao(t.retry)).toHaveStyle({ minHeight: '40px' });
    expect(botao(t.discard)).toHaveStyle({ minHeight: '40px' });
  });
});

describe('FailedMessageActions — tema escuro', () => {
  it('usa a superfície do tema escuro e mantém as ações', () => {
    renderWithTheme(<FailedMessageActions kind="session" onRetry={vi.fn()} onDiscard={vi.fn()} />, 'dark');

    const tema = buildTheme('dark').palette;
    expect(screen.getByRole('group', { name: t.failed })).toHaveStyle({ backgroundColor: tema.background.paper });
    expect(screen.getByText(t.errors.sessionDisconnected)).toHaveStyle({ color: tema.text.primary });
    expect(botao(t.retry)).toBeInTheDocument();
  });
});
