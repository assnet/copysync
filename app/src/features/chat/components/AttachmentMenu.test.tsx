import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PaletteMode } from '@mui/material';
import { renderWithTheme } from '@/test/renderWithTheme';
import { chatStrings } from '@/features/chat/strings';
import { AttachmentMenu } from './AttachmentMenu';

const texts = chatStrings.attachments;

function renderMenu(props: { disabled?: boolean; disabledReason?: string } = {}, mode: PaletteMode = 'light') {
  const onFiles = vi.fn();
  renderWithTheme(<AttachmentMenu onFiles={onFiles} {...props} />, mode);
  return { onFiles };
}

// Com o menu aberto o modal esconde o resto da página (`aria-hidden`); `hidden` acha o clipe mesmo assim.
const clipButton = () => screen.getByRole('button', { name: chatStrings.composer.attach, hidden: true });
// Inputs ocultos ficam fora da árvore de acessibilidade; o rótulo só serve para achá-los.
const documentInput = () => screen.getByLabelText<HTMLInputElement>(texts.document, { selector: 'input' });
const mediaInput = () => screen.getByLabelText<HTMLInputElement>(texts.photosAndVideos, { selector: 'input' });

const pdf = () => new File(['%PDF-1.7'], 'contrato.pdf', { type: 'application/pdf' });
const foto = () => new File(['foto'], 'praia.jpg', { type: 'image/jpeg' });
const video = () => new File(['video'], 'festa.mp4', { type: 'video/mp4' });

describe('AttachmentMenu', () => {
  it('abre o menu com Documento e Fotos e vídeos', async () => {
    renderMenu();
    expect(clipButton()).toHaveAttribute('aria-haspopup', 'menu');
    expect(clipButton()).toHaveAttribute('aria-expanded', 'false');

    await userEvent.click(clipButton());

    expect(screen.getByRole('menu', { name: texts.menuLabel })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: texts.document })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: texts.photosAndVideos })).toBeInTheDocument();
    expect(clipButton()).toHaveAttribute('aria-expanded', 'true');
  });

  it('escolher uma opção fecha o menu e abre o seletor da origem certa', async () => {
    renderMenu();
    const cliqueDocumento = vi.fn();
    const cliqueMidia = vi.fn();
    documentInput().addEventListener('click', cliqueDocumento);
    mediaInput().addEventListener('click', cliqueMidia);

    await userEvent.click(clipButton());
    await userEvent.click(screen.getByRole('menuitem', { name: texts.photosAndVideos }));

    expect(cliqueMidia).toHaveBeenCalledTimes(1);
    expect(cliqueDocumento).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());

    await userEvent.click(clipButton());
    await userEvent.click(screen.getByRole('menuitem', { name: texts.document }));
    expect(cliqueDocumento).toHaveBeenCalledTimes(1);
  });

  it('filtra fotos e vídeos no seletor de mídia e aceita qualquer tipo no de documento', () => {
    renderMenu();
    expect(mediaInput()).toHaveAttribute('accept', 'image/*,video/*');
    expect(mediaInput().multiple).toBe(true);
    expect(documentInput()).not.toHaveAttribute('accept');
    expect(documentInput().multiple).toBe(true);
  });

  it('entrega os documentos escolhidos com a origem document', async () => {
    const { onFiles } = renderMenu();
    const arquivos = [pdf(), foto()];

    await userEvent.upload(documentInput(), arquivos);

    expect(onFiles).toHaveBeenCalledTimes(1);
    expect(onFiles).toHaveBeenCalledWith(arquivos, 'document');
  });

  it('entrega fotos e vídeos com a origem media', async () => {
    const { onFiles } = renderMenu();
    const arquivos = [foto(), video()];

    await userEvent.upload(mediaInput(), arquivos);

    expect(onFiles).toHaveBeenCalledWith(arquivos, 'media');
  });

  it('limpa o seletor depois da escolha para aceitar o mesmo arquivo de novo', async () => {
    const { onFiles } = renderMenu();
    const arquivo = pdf();

    await userEvent.upload(documentInput(), arquivo);
    expect(documentInput().value).toBe('');
    await userEvent.upload(documentInput(), arquivo);

    expect(onFiles).toHaveBeenCalledTimes(2);
    expect(onFiles).toHaveBeenLastCalledWith([arquivo], 'document');
  });

  it('não entrega nada quando o seletor fecha sem arquivo', () => {
    const { onFiles } = renderMenu();
    fireEvent.change(mediaInput(), { target: { files: [] } });
    expect(onFiles).not.toHaveBeenCalled();
  });

  it('desabilitado não abre o menu e mostra o motivo no tooltip', async () => {
    const { onFiles } = renderMenu({ disabled: true, disabledReason: 'Conversa encerrada' });
    expect(clipButton()).toHaveAttribute('aria-disabled', 'true');

    await userEvent.click(clipButton());
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    await userEvent.hover(clipButton());
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Conversa encerrada');

    await userEvent.upload(documentInput(), pdf());
    expect(onFiles).not.toHaveBeenCalled();
  });

  it('desabilitado sem motivo informado usa o aviso padrão', async () => {
    renderMenu({ disabled: true });
    await userEvent.hover(clipButton());
    expect(await screen.findByRole('tooltip')).toHaveTextContent(texts.unavailable);
  });

  it('funciona no tema escuro', async () => {
    const { onFiles } = renderMenu({}, 'dark');
    await userEvent.hover(clipButton());
    expect(await screen.findByRole('tooltip')).toHaveTextContent(chatStrings.composer.attach);

    await userEvent.click(clipButton());
    expect(screen.getByRole('menuitem', { name: texts.photosAndVideos })).toBeVisible();

    const arquivos = [video()];
    await userEvent.upload(mediaInput(), arquivos);
    expect(onFiles).toHaveBeenCalledWith(arquivos, 'media');
  });
});
