import { describe, it, expect, expectTypeOf } from 'vitest';
import {
  filesFrom,
  hasFiles,
  pastedFiles,
  type DataTransferItemLike,
  type DataTransferLike,
} from './dataTransferFiles';

const foto = new File(['a'], 'foto.png', { type: 'image/png' });
const nota = new File(['b'], 'nota.pdf', { type: 'application/pdf' });

// Item de arquivo; `entrada` simula o `webkitGetAsEntry()` (ausente = navegador sem a API).
const itemArquivo = (file: File | null, entrada?: { isDirectory: boolean } | null): DataTransferItemLike => ({
  kind: 'file',
  getAsFile: () => file,
  ...(entrada === undefined ? {} : { webkitGetAsEntry: () => entrada }),
});
const itemTexto = (): DataTransferItemLike => ({ kind: 'string', getAsFile: () => null });

// DOMStringList falso: indexável, com `contains`, mas sem `includes` de array.
const listaDeTipos = (...tipos: string[]) =>
  Object.assign(Object.create(null) as object, { ...tipos }, {
    length: tipos.length,
    item: (i: number) => tipos[i] ?? null,
    contains: (t: string) => tipos.includes(t),
  }) as ArrayLike<string>;

describe('hasFiles', () => {
  it('reconhece arrasto com arquivos pelo tipo "Files"', () => {
    expect(hasFiles({ types: ['text/uri-list', 'Files'] })).toBe(true);
  });

  it('aceita a lista de tipos no formato DOMStringList', () => {
    expect(hasFiles({ types: listaDeTipos('Files') })).toBe(true);
    expect(hasFiles({ types: listaDeTipos('text/plain') })).toBe(false);
  });

  it('ignora arrasto de texto ou link', () => {
    expect(hasFiles({ types: ['text/plain', 'text/html', 'text/uri-list'] })).toBe(false);
  });

  it('decide sem ler os arquivos, como exige o dragenter', () => {
    const dt = {
      types: ['Files'],
      get items(): never {
        throw new Error('items lido no dragenter');
      },
      get files(): never {
        throw new Error('files lido no dragenter');
      },
    };
    expect(hasFiles(dt)).toBe(true);
  });

  it('responde falso sem transferência ou sem tipos', () => {
    expect(hasFiles(null)).toBe(false);
    expect(hasFiles(undefined)).toBe(false);
    expect(hasFiles({})).toBe(false);
  });
});

describe('filesFrom', () => {
  it('aceita o DataTransfer real de arrastar e colar', () => {
    expectTypeOf<DataTransfer>().toExtend<DataTransferLike>();
  });


  it('devolve os arquivos soltos na ordem em que chegaram', () => {
    const dt: DataTransferLike = { items: [itemArquivo(foto), itemArquivo(nota)] };
    expect(filesFrom(dt)).toEqual([foto, nota]);
  });

  it('ignora pastas arrastadas junto com arquivos', () => {
    const pasta = new File([], 'Fotos');
    const dt: DataTransferLike = {
      items: [itemArquivo(pasta, { isDirectory: true }), itemArquivo(foto, { isDirectory: false })],
    };
    expect(filesFrom(dt)).toEqual([foto]);
  });

  it('aceita o arquivo quando o navegador não informa se é pasta', () => {
    const dt: DataTransferLike = { items: [itemArquivo(foto), itemArquivo(nota, null)] };
    expect(filesFrom(dt)).toEqual([foto, nota]);
  });

  it('ignora itens que não são arquivo e arquivos ilegíveis', () => {
    const dt: DataTransferLike = { items: [itemTexto(), itemArquivo(null), itemArquivo(foto)] };
    expect(filesFrom(dt)).toEqual([foto]);
  });

  it('colar só texto não gera anexo', () => {
    const dt: DataTransferLike = { types: ['text/plain'], items: [itemTexto()], files: [] };
    expect(filesFrom(dt)).toEqual([]);
  });

  it('usa a lista de arquivos quando o navegador não expõe itens', () => {
    expect(filesFrom({ files: [foto, nota] })).toEqual([foto, nota]);
  });

  it('prefere os itens à lista de arquivos, sem duplicar', () => {
    const dt: DataTransferLike = { items: [itemArquivo(foto)], files: [foto] };
    expect(filesFrom(dt)).toEqual([foto]);
  });

  it('sem transferência não há arquivos', () => {
    expect(filesFrom(null)).toEqual([]);
    expect(filesFrom(undefined)).toEqual([]);
    expect(filesFrom({})).toEqual([]);
  });
});

describe('pastedFiles', () => {
  /** Área de transferência do colar: arquivos como itens e, opcionalmente, `text/plain`. */
  const colado = (files: File[], texto?: string): DataTransferLike => ({
    types: [...(files.length ? ['Files'] : []), ...(texto === undefined ? [] : ['text/plain'])],
    items: files.map((file) => itemArquivo(file)),
    getData: (formato: string) => (formato === 'text/plain' ? (texto ?? '') : ''),
  });

  it('print de tela (só a imagem) vira anexo', () => {
    expect(pastedFiles(colado([foto]))).toEqual([foto]);
  });

  it('texto copiado do Office, que chega com a imagem renderizada dele, cola como texto', () => {
    expect(pastedFiles(colado([foto], 'Total do trimestre\t1.234'))).toEqual([]);
  });

  it('texto só com espaços não conta: a imagem continua sendo anexo', () => {
    expect(pastedFiles(colado([foto], ' \r\n'))).toEqual([foto]);
  });

  it('com texto, só a imagem única cede: outro arquivo ou vários seguem como anexo', () => {
    expect(pastedFiles(colado([nota], 'nota.pdf'))).toEqual([nota]);
    expect(pastedFiles(colado([foto, nota], 'foto.png nota.pdf'))).toEqual([foto, nota]);
  });

  it('navegador sem leitura do texto trata como colar só arquivo', () => {
    expect(pastedFiles({ items: [itemArquivo(foto)] })).toEqual([foto]);
  });

  it('colar só texto não gera anexo', () => {
    expect(pastedFiles(colado([], 'bom dia'))).toEqual([]);
    expect(pastedFiles(null)).toEqual([]);
  });
});
