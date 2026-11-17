/** `<a download>` com object URL, revogado logo após o clique (padrão `offerStory/shareImage.ts`). */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    // o clique já iniciou o download; revogar no próximo tick libera a memória
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
