import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import type { PaletteMode } from '@mui/material';
import { renderWithTheme } from '@/test/renderWithTheme';
import { chatStrings } from '@/features/chat/strings';
import { resetMediaFileSizeCache } from '@/features/chat/media/useMediaFileSize';
import { DocumentMessage, getDocumentExtension, getDocumentKind } from './DocumentMessage';

const texts = chatStrings.documentCard;

const headResponse = (contentLength: string | null) =>
  Promise.resolve({ ok: true, headers: { get: () => contentLength } });

function renderCard(props: Partial<Parameters<typeof DocumentMessage>[0]> = {}, mode: PaletteMode = 'light') {
  return renderWithTheme(
    <DocumentMessage mediaUrl="/api/storage/media/t/relatorio.zip" fileName="relatorio.zip" textColor="#111" {...props} />,
    mode,
  );
}

describe('DocumentMessage — cartão de documento', () => {
  beforeEach(() => {
    resetMediaFileSizeCache();
    // jsdom não tem IntersectionObserver: o hook consulta na hora.
    vi.stubGlobal('fetch', vi.fn(() => headResponse(null)));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('mostra o nome em uma linha com reticências e o título completo', () => {
    const longo = 'relatorio-financeiro-consolidado-do-trimestre-2026.zip';
    renderCard({ fileName: longo });
    const nome = screen.getByTitle(longo);
    expect(nome).toHaveTextContent(longo);
    expect(nome).toHaveStyle({ whiteSpace: 'nowrap', textOverflow: 'ellipsis' });
  });

  it('subtítulo só com a extensão enquanto não há tamanho', () => {
    renderCard();
    expect(screen.getByText('ZIP', { selector: 'span' })).toBeInTheDocument();
    expect(screen.queryByText(/•/)).not.toBeInTheDocument();
  });

  it('subtítulo com tamanho quando o HEAD informa Content-Length', async () => {
    vi.stubGlobal('fetch', vi.fn(() => headResponse('2000000')));
    renderCard();
    await waitFor(() => expect(screen.getByText('ZIP • 2 MB')).toBeInTheDocument());
    expect(fetch).toHaveBeenCalledWith('/api/storage/media/t/relatorio.zip', { method: 'HEAD' });
    expect(screen.getByRole('link', { name: texts.label('relatorio.zip', '2 MB') })).toBeInTheDocument();
  });

  it('rótulo curto da extensão dentro do ícone', () => {
    renderCard({ fileName: 'planilha.xlsx' });
    const rotulo = screen.getByText('XLSX', { selector: 'text' });
    expect(rotulo.closest('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('botão de baixar leva o nome do arquivo no atributo download', () => {
    renderCard();
    const baixar = screen.getByRole('link', { name: texts.download });
    expect(baixar).toHaveAttribute('href', '/api/storage/media/t/relatorio.zip');
    expect(baixar).toHaveAttribute('download', 'relatorio.zip');
  });

  it('corpo do cartão baixa arquivos que o navegador não exibe', () => {
    renderCard();
    const corpo = screen.getByRole('link', { name: texts.label('relatorio.zip', null) });
    expect(corpo).toHaveAttribute('download', 'relatorio.zip');
    expect(corpo).not.toHaveAttribute('target');
  });

  it('corpo do cartão abre PDF em nova aba', () => {
    renderCard({ fileName: 'contrato.pdf', mimeType: 'application/pdf' });
    const corpo = screen.getByRole('link', { name: texts.label('contrato.pdf', null) });
    expect(corpo).toHaveAttribute('target', '_blank');
    expect(corpo).toHaveAttribute('rel', 'noopener');
    expect(corpo).not.toHaveAttribute('download');
  });

  it('legenda aparece abaixo do cartão', () => {
    renderCard({ body: 'Segue o relatório' });
    expect(screen.getByText('Segue o relatório')).toBeInTheDocument();
  });

  it('sem URL não há links nem botão de baixar', () => {
    renderCard({ mediaUrl: null });
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByRole('group', { name: texts.label('relatorio.zip', null) })).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('renderiza no modo escuro com a cor de texto da bolha', () => {
    renderCard({}, 'dark');
    const corpo = screen.getByRole('link', { name: texts.label('relatorio.zip', null) });
    expect(corpo).toHaveStyle({ color: 'rgb(17, 17, 17)' });
    expect(screen.getByRole('link', { name: texts.download })).toBeInTheDocument();
  });
});

describe('tipo do documento pela extensão e MIME', () => {
  it.each([
    ['a.pdf', null, 'pdf', 'pdf'],
    ['a.zip', null, 'zip', 'archive'],
    ['a.docx', null, 'docx', 'doc'],
    ['a.xlsx', null, 'xlsx', 'sheet'],
    ['a.pptx', null, 'pptx', 'slides'],
    ['a.txt', null, 'txt', 'text'],
    ['a.png', null, 'png', 'image'],
    ['a.bin', null, 'bin', 'generic'],
    ['semext', 'application/pdf', 'pdf', 'pdf'],
    ['semext', 'application/octet-stream', '', 'generic'],
    ['.env', null, '', 'generic'],
  ] as const)('%s (%s) → %s / %s', (name, mime, ext, kind) => {
    expect(getDocumentExtension(name, mime)).toBe(ext);
    expect(getDocumentKind(ext, mime)).toBe(kind);
  });
});
