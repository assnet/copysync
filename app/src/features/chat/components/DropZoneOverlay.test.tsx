import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { PaletteMode } from '@mui/material';
import { ThemeProvider } from '@mui/material';
import { fireEvent, render, screen } from '@testing-library/react';
import { renderWithTheme } from '@/test/renderWithTheme';
import { buildTheme } from '@/theme/theme';
import { chatStrings } from '../strings';
import type { DataTransferItemLike } from '../media/dataTransferFiles';
import { DropZoneOverlay } from './DropZoneOverlay';

const soltar = chatStrings.attachments.dropHere;

// `DataTransfer` falso: o jsdom não implementa o real e o Testing Library repassa o objeto como está.
interface TransferenciaFalsa {
  types: string[];
  items: DataTransferItemLike[];
  files: File[];
  dropEffect: string;
}

function comArquivos(...files: File[]): TransferenciaFalsa {
  return {
    types: ['Files'],
    items: files.map((file) => ({ kind: 'file', getAsFile: () => file })),
    files,
    dropEffect: 'none',
  };
}

function soTexto(): TransferenciaFalsa {
  return {
    types: ['text/plain'],
    items: [{ kind: 'string', getAsFile: () => null }],
    files: [],
    dropEffect: 'none',
  };
}

function renderArea(props: { disabled?: boolean; mode?: PaletteMode } = {}) {
  const onFiles = vi.fn();
  const view = renderWithTheme(
    <DropZoneOverlay disabled={props.disabled} onFiles={onFiles}>
      <section aria-label="mensagens">
        <p>olá, tudo bem?</p>
      </section>
    </DropZoneOverlay>,
    props.mode,
  );
  return {
    ...view,
    onFiles,
    area: screen.getByRole('region', { name: 'mensagens' }),
    filho: screen.getByText('olá, tudo bem?'),
  };
}

const foto = new File(['a'], 'foto.jpg', { type: 'image/jpeg' });
const contrato = new File(['b'], 'contrato.pdf', { type: 'application/pdf' });

describe('DropZoneOverlay', () => {
  it('mostra a área de soltar ao arrastar arquivos e aceita a cópia', () => {
    const { area } = renderArea();
    const dt = comArquivos(foto);

    fireEvent.dragEnter(area, { dataTransfer: dt });
    const naoCancelado = fireEvent.dragOver(area, { dataTransfer: dt });

    expect(screen.getByRole('status')).toHaveTextContent(soltar);
    expect(naoCancelado).toBe(false);
    expect(dt.dropEffect).toBe('copy');
  });

  it('continua visível ao passar pelos filhos e some ao sair da área', () => {
    const { area, filho } = renderArea();
    const dt = comArquivos(foto);

    fireEvent.dragEnter(area, { dataTransfer: dt });
    // Entrar num filho dispara enter nele e leave no pai — o contador segura o overlay.
    fireEvent.dragEnter(filho, { dataTransfer: dt });
    fireEvent.dragLeave(area, { dataTransfer: dt });
    expect(screen.getByText(soltar)).toBeInTheDocument();

    fireEvent.dragEnter(area, { dataTransfer: dt });
    fireEvent.dragLeave(filho, { dataTransfer: dt });
    expect(screen.getByText(soltar)).toBeInTheDocument();

    fireEvent.dragLeave(area, { dataTransfer: dt });
    expect(screen.queryByText(soltar)).not.toBeInTheDocument();
  });

  it('ignora arrasto só de texto e deixa o comportamento padrão', () => {
    const { area, onFiles } = renderArea();
    const dt = soTexto();

    fireEvent.dragEnter(area, { dataTransfer: dt });
    const naoCancelado = fireEvent.dragOver(area, { dataTransfer: dt });
    fireEvent.drop(area, { dataTransfer: dt });

    expect(screen.queryByText(soltar)).not.toBeInTheDocument();
    expect(naoCancelado).toBe(true);
    expect(onFiles).not.toHaveBeenCalled();
  });

  it('ao soltar entrega os arquivos na ordem e esconde a área', () => {
    const { area, filho, onFiles } = renderArea();
    const dt = comArquivos(foto, contrato);

    fireEvent.dragEnter(area, { dataTransfer: dt });
    fireEvent.dragEnter(filho, { dataTransfer: dt });
    fireEvent.dragOver(filho, { dataTransfer: dt });
    const naoCancelado = fireEvent.drop(filho, { dataTransfer: dt });

    expect(naoCancelado).toBe(false);
    expect(onFiles).toHaveBeenCalledTimes(1);
    expect(onFiles).toHaveBeenCalledWith([foto, contrato]);
    expect(screen.queryByText(soltar)).not.toBeInTheDocument();

    // Contador zerado no drop: o próximo arrasto começa limpo.
    fireEvent.dragEnter(area, { dataTransfer: dt });
    fireEvent.dragLeave(area, { dataTransfer: dt });
    expect(screen.queryByText(soltar)).not.toBeInTheDocument();
  });

  it('não chama onFiles quando o que se soltou era só pasta', () => {
    const { area, onFiles } = renderArea();
    const dt: TransferenciaFalsa = {
      types: ['Files'],
      items: [{ kind: 'file', getAsFile: () => new File([], 'fotos'), webkitGetAsEntry: () => ({ isDirectory: true }) }],
      files: [],
      dropEffect: 'none',
    };

    fireEvent.dragEnter(area, { dataTransfer: dt });
    fireEvent.drop(area, { dataTransfer: dt });

    expect(onFiles).not.toHaveBeenCalled();
    expect(screen.queryByText(soltar)).not.toBeInTheDocument();
  });

  it('com a conversa encerrada não mostra a área nem recebe arquivos', () => {
    const { area, onFiles } = renderArea({ disabled: true });
    const dt = comArquivos(foto);

    fireEvent.dragEnter(area, { dataTransfer: dt });
    const naoCancelado = fireEvent.dragOver(area, { dataTransfer: dt });
    const dropNaoCancelado = fireEvent.drop(area, { dataTransfer: dt });

    expect(screen.queryByText(soltar)).not.toBeInTheDocument();
    expect(naoCancelado).toBe(true);
    expect(dropNaoCancelado).toBe(true);
    expect(onFiles).not.toHaveBeenCalled();
  });

  it('esconde a área se a conversa for encerrada no meio do arrasto', () => {
    const onFiles = vi.fn();
    const conteudo = <section aria-label="mensagens">olá</section>;
    // `wrapper` mantém o tema no rerender; sem ele a árvore remontaria e o teste passaria à toa.
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ThemeProvider theme={buildTheme('light')}>{children}</ThemeProvider>
    );
    const { rerender } = render(<DropZoneOverlay onFiles={onFiles}>{conteudo}</DropZoneOverlay>, { wrapper });
    const area = screen.getByRole('region', { name: 'mensagens' });

    fireEvent.dragEnter(area, { dataTransfer: comArquivos(foto) });
    expect(screen.getByText(soltar)).toBeInTheDocument();

    rerender(
      <DropZoneOverlay onFiles={onFiles} disabled>
        {conteudo}
      </DropZoneOverlay>,
    );
    expect(screen.queryByText(soltar)).not.toBeInTheDocument();
  });

  it('funciona no tema escuro', () => {
    const { area, onFiles } = renderArea({ mode: 'dark' });
    const dt = comArquivos(foto);

    fireEvent.dragEnter(area, { dataTransfer: dt });
    expect(screen.getByRole('status')).toHaveTextContent(soltar);

    fireEvent.drop(area, { dataTransfer: dt });
    expect(onFiles).toHaveBeenCalledWith([foto]);
  });
});
