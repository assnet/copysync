import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithTheme } from '@/test/renderWithTheme';
import { buildTheme } from '@/theme/theme';
import { UploadProgressOverlay } from './UploadProgressOverlay';
import { chatStrings } from '../../strings';

const t = chatStrings.upload;

describe('UploadProgressOverlay — upload em andamento', () => {
  it('mostra o percentual e o progresso determinado', () => {
    renderWithTheme(<UploadProgressOverlay progress={42} onCancel={vi.fn()} />);

    const barra = screen.getByRole('progressbar', { name: t.sending });
    expect(barra).toHaveAttribute('aria-valuenow', '42');
    expect(screen.getByText(t.progress(42))).toBeInTheDocument();
  });

  it('arredonda o percentual e o mantém entre 0 e 100', () => {
    const { rerender } = renderWithTheme(<UploadProgressOverlay progress={42.6} />);
    expect(screen.getByText(t.progress(43))).toBeInTheDocument();

    rerender(<UploadProgressOverlay progress={130} />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
  });

  it('cancelar chama a callback e tem tooltip', async () => {
    const onCancel = vi.fn();
    renderWithTheme(<UploadProgressOverlay progress={10} onCancel={onCancel} />);

    const cancelar = screen.getByRole('button', { name: t.cancel });
    await userEvent.hover(cancelar);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(t.cancel);

    await userEvent.click(cancelar);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('botão cancelar tem alvo de ao menos 40 px', () => {
    renderWithTheme(<UploadProgressOverlay progress={10} onCancel={vi.fn()} />);

    expect(screen.getByRole('button', { name: t.cancel })).toHaveStyle({ width: '40px', height: '40px' });
  });

  it('sem onCancel não oferece cancelar', () => {
    renderWithTheme(<UploadProgressOverlay progress={10} />);

    expect(screen.queryByRole('button', { name: t.cancel })).not.toBeInTheDocument();
  });
});

describe('UploadProgressOverlay — confirmação ou PENDING do servidor', () => {
  it('fica indeterminado, sem percentual e sem cancelar', () => {
    renderWithTheme(<UploadProgressOverlay onCancel={vi.fn()} />);

    const barra = screen.getByRole('progressbar', { name: t.sending });
    expect(barra).not.toHaveAttribute('aria-valuenow');
    expect(screen.getByText(t.sending)).toBeInTheDocument();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t.cancel })).not.toBeInTheDocument();
  });

  it('não captura cliques: a mídia por baixo continua tocável (PENDING do servidor)', async () => {
    renderWithTheme(<UploadProgressOverlay />);

    // O user-event recusa clicar em elemento com `pointer-events: none` — o clique vai para a mídia.
    await expect(userEvent.click(screen.getByText(t.sending))).rejects.toThrow(/pointer-events/);
  });

  it('com upload em andamento o véu segue bloqueando a mídia', async () => {
    renderWithTheme(<UploadProgressOverlay progress={10} onCancel={vi.fn()} />);

    await expect(userEvent.click(screen.getByText(t.progress(10)))).resolves.toBeUndefined();
  });
});

describe('UploadProgressOverlay — tema escuro', () => {
  it('usa as cores do tema e mantém progresso e cancelar', () => {
    renderWithTheme(<UploadProgressOverlay progress={60} onCancel={vi.fn()} />, 'dark');

    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '60');
    expect(screen.getByText(t.progress(60))).toHaveStyle({ color: buildTheme('dark').palette.common.white });
    expect(screen.getByRole('button', { name: t.cancel })).toBeInTheDocument();
  });
});
