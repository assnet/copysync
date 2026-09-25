// Extração de arquivos de arrastar (DragEvent.dataTransfer) e colar (ClipboardEvent.clipboardData).
// Tipos mínimos locais: o `DataTransfer` real é compatível com eles, e os testes usam objetos falsos.

/** Item de `DataTransfer.items` — só o que a extração usa. */
export interface DataTransferItemLike {
  readonly kind: string;
  getAsFile(): File | null;
  /** Não padronizado; ausente em alguns navegadores. Única forma de distinguir pasta de arquivo. */
  webkitGetAsEntry?(): { readonly isDirectory: boolean } | null;
}

/** `DataTransfer` mínimo. `types` pode ser array ou `DOMStringList` (navegadores antigos). */
export interface DataTransferLike {
  readonly types?: ArrayLike<string> | null;
  readonly items?: ArrayLike<DataTransferItemLike> | null;
  readonly files?: ArrayLike<File> | null;
}

/**
 * Verdadeiro quando a transferência traz arquivos. Olha só `types`, que o navegador já expõe no
 * `dragenter`/`dragover` — ali `items`/`files` ainda estão protegidos e não dizem nada.
 */
export function hasFiles(dt: DataTransferLike | null | undefined): boolean {
  return dt?.types ? Array.from(dt.types).includes('Files') : false;
}

/**
 * Arquivos da transferência, na ordem recebida. Chame dentro do handler do `drop`/`paste`: depois
 * dele o navegador esvazia a lista. Pastas e itens de texto ficam de fora; colar só texto → `[]`.
 */
export function filesFrom(dt: DataTransferLike | null | undefined): File[] {
  if (!dt) return [];
  if (!dt.items) return dt.files ? Array.from(dt.files) : [];

  const files: File[] = [];
  for (const item of Array.from(dt.items)) {
    if (item.kind !== 'file') continue;
    // Pasta chega como item `file` e o `getAsFile()` devolve um File vazio — só a entrada revela.
    if (item.webkitGetAsEntry?.()?.isDirectory) continue;
    const file = item.getAsFile();
    if (file) files.push(file);
  }
  return files;
}
