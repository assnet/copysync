import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithTheme } from '@/test/renderWithTheme';
import { PrivacyProvider } from '@/features/privacy';
import { storefrontStrings } from '../strings';

const upload = vi.hoisted(() => ({ uploadInParts: vi.fn() }));
vi.mock('@/features/chat/media/chunkedUpload', async (orig) => ({
  ...(await orig<typeof import('@/features/chat/media/chunkedUpload')>()),
  uploadInParts: upload.uploadInParts,
}));

import { ImagePicker, type ImagePickerProps } from './ImagePicker';

const tp = storefrontStrings.fields.photo;
const te = storefrontStrings.errors;
const MB = 1024 * 1024;

const fileOf = (size: number, type: string, name = 'foto') => {
  const f = new File(['x'], name, { type });
  Object.defineProperty(f, 'size', { value: size });
  return f;
};

const setup = (props: Partial<ImagePickerProps> = {}, mode: 'light' | 'dark' = 'light') => {
  const handlers = { onUploaded: vi.fn(), onRemove: vi.fn() };
  renderWithTheme(
    <PrivacyProvider><ImagePicker kind="avatar" imageUrl={null} {...handlers} {...props} /></PrivacyProvider>,
    mode,
  );
  const choose = (file: File) => fireEvent.change(screen.getByTestId(`image-input-${props.kind ?? 'avatar'}`), { target: { files: [file] } });
  return { ...handlers, choose };
};

describe('ImagePicker', () => {
  beforeEach(() => {
    upload.uploadInParts.mockReset();
  });

  it('mostra a regra de formato, tamanho e dimensão', () => {
    setup();
    expect(screen.getByText(tp.rule)).toBeInTheDocument();
  });

  it('recusa arquivo grande no cliente, sem subir', () => {
    const { choose, onUploaded } = setup();
    choose(fileOf(2 * MB + 1, 'image/png'));
    expect(screen.getByRole('alert')).toHaveTextContent(te.MEDIA_TOO_LARGE);
    expect(upload.uploadInParts).not.toHaveBeenCalled();
    expect(onUploaded).not.toHaveBeenCalled();
  });

  it('recusa tipo errado no cliente, sem subir (modo escuro)', () => {
    const { choose } = setup({}, 'dark');
    choose(fileOf(1000, 'image/gif'));
    expect(screen.getByRole('alert')).toHaveTextContent(te.UNSUPPORTED_MEDIA_TYPE);
    expect(upload.uploadInParts).not.toHaveBeenCalled();
  });

  it('capa aceita até 4 MB', async () => {
    upload.uploadInParts.mockResolvedValue({ uploadId: 'up-9' });
    const { choose, onUploaded } = setup({ kind: 'cover' });
    choose(fileOf(4 * MB, 'image/webp'));
    await waitFor(() => expect(onUploaded).toHaveBeenCalledWith('up-9'));
  });

  it('arquivo válido sobe por partes com purpose media e entrega o uploadId', async () => {
    upload.uploadInParts.mockResolvedValue({ uploadId: 'up-1' });
    const { choose, onUploaded } = setup();
    choose(fileOf(1000, 'image/jpeg'));
    await waitFor(() => expect(onUploaded).toHaveBeenCalledWith('up-1'));
    expect(upload.uploadInParts).toHaveBeenCalledWith(expect.objectContaining({ purpose: 'media', declaredMimeType: 'image/jpeg' }));
  });

  it('falha no envio mostra o texto do código, nunca a mensagem crua', async () => {
    upload.uploadInParts.mockRejectedValue(Object.assign(new Error('raw'), { status: 404, code: 'UPLOAD_NOT_FOUND' }));
    const { choose, onUploaded } = setup();
    choose(fileOf(1000, 'image/png'));
    expect(await screen.findByRole('alert')).toHaveTextContent(te.UPLOAD_NOT_FOUND);
    expect(onUploaded).not.toHaveBeenCalled();
  });

  it('remover pede confirmação', () => {
    const { onRemove } = setup({ imageUrl: 'https://img/x.webp' });
    fireEvent.click(screen.getByRole('button', { name: tp.remove }));
    expect(onRemove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: tp.confirmRemove.confirm }));
    expect(onRemove).toHaveBeenCalled();
  });
});
