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
  /** Texto da transferência; ausente = navegador que não expõe (tratado como vazio). */
  getData?(format: string): string;
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

/**
 * Arquivos a anexar ao colar. Office e editores ricos copiam o texto junto com uma imagem dele
 * renderizada: com `text/plain` não vazio e uma única imagem, vale o texto (colar padrão) → `[]`.
 * Print de tela (só a imagem) segue como anexo.
 */
export function pastedFiles(dt: DataTransferLike | null | undefined): File[] {
  const files = filesFrom(dt);
  const singleImage = files.length === 1 && !!files[0]?.type.startsWith('image/');
  if (singleImage && dt?.getData?.('text/plain').trim()) return [];
  return files;
}
