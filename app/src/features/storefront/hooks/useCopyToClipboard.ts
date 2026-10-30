import { useCallback, useEffect, useRef, useState } from 'react';

const COPIED_MS = 2000;

/**
 * Copia texto para a área de transferência: `copied` fica true por 2 s (feedback no ícone/tooltip).
 * Clipboard bloqueado chama `onFailed` (quem usa mostra o aviso).
 */
export function useCopyToClipboard(onFailed: () => void) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), COPIED_MS);
    } catch {
      onFailed();
    }
  }, [onFailed]);

  return { copied, copy };
}
