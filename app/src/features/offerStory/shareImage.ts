/**
 * Compartilhar/baixar a arte gerada. Web Share com arquivo só quando `navigator.canShare({ files })`
 * diz que dá (Safari/Chrome no celular); "Baixar" funciona sempre. Sem React.
 */

/** `story-oferta-YYYY-MM-DD.jpg` na data local. */
export function storyFileName(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `story-oferta-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.jpg`;
}

/** `data:<mime>;base64,…` → `File`. Lança em data URL inválida. */
export function dataUrlToFile(dataUrl: string, fileName: string): File {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(dataUrl);
  if (!match) throw new Error('invalid data url');
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], fileName, { type: match[1] });
}

export function canShareImage(file: File): boolean {
  try {
    return typeof navigator !== 'undefined' && typeof navigator.share === 'function' && navigator.canShare?.({ files: [file] }) === true;
  } catch {
    return false;
  }
}

/** Resultado do Web Share: `cancelled` quando o usuário fecha a folha (não é erro). */
export type ShareOutcome = 'shared' | 'cancelled' | 'failed';

export async function shareImage(file: File): Promise<ShareOutcome> {
  try {
    await navigator.share({ files: [file] });
    return 'shared';
  } catch (err) {
    return (err as { name?: string } | null)?.name === 'AbortError' ? 'cancelled' : 'failed';
  }
}

/** `<a download>` com object URL, revogado logo após o clique. */
export function downloadImage(file: File): void {
  const url = URL.createObjectURL(file);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
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
