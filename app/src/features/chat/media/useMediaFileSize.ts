/**
 * Tamanho de um arquivo de mídia sem baixá-lo: `HEAD` na URL pública (servida por `@fastify/static`,
 * que responde `Content-Length`) só quando a bolha entra no viewport, com cache em memória por URL.
 *
 * Falha (rede, 4xx, sem cabeçalho) vira `null` em silêncio — o cartão mostra só a extensão. Não passa
 * pelo Axios de propósito: a URL é pública e a base do cliente HTTP não se aplica.
 */
import { useCallback, useEffect, useState } from 'react';

type CacheEntry = number | null | Promise<number | null>;

const sizeCache = new Map<string, CacheEntry>();

/** `Content-Length` → bytes. Qualquer coisa que não seja inteiro ≥ 0 vira `null`. */
export function parseContentLength(header: string | null | undefined): number | null {
  if (header == null) return null;
  const trimmed = header.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isSafeInteger(value) ? value : null;
}

type FetchLike = (input: string, init: { method: 'HEAD' }) => Promise<{ ok: boolean; headers: { get(name: string): string | null } }>;

/**
 * Consulta o tamanho com cache: a mesma URL só gera um `HEAD`, mesmo com várias bolhas ao mesmo
 * tempo (a promessa em voo é compartilhada). Sem `fetch` no ambiente devolve `null`.
 */
export function fetchMediaFileSize(url: string, fetchImpl: FetchLike | undefined = globalThis.fetch): Promise<number | null> {
  const cached = sizeCache.get(url);
  if (cached !== undefined) return Promise.resolve(cached);
  if (!fetchImpl) return Promise.resolve(null);

  const pending = Promise.resolve()
    .then(() => fetchImpl(url, { method: 'HEAD' }))
    .then((response) => (response.ok ? parseContentLength(response.headers.get('content-length')) : null))
    .catch(() => null)
    .then((size) => {
      sizeCache.set(url, size);
      return size;
    });
  sizeCache.set(url, pending);
  return pending;
}

/** Só para testes: esquece tudo que foi consultado. */
export function resetMediaFileSizeCache(): void {
  sizeCache.clear();
}

export interface MediaFileSize {
  /** Passe para o elemento da bolha; a consulta começa quando ele aparece na tela. */
  ref: (element: Element | null) => void;
  /** `null` enquanto não consultou ou quando o servidor não informou. */
  sizeBytes: number | null;
}

export function useMediaFileSize(url: string | null | undefined): MediaFileSize {
  const [sizeBytes, setSizeBytes] = useState<number | null>(() => {
    const cached = url ? sizeCache.get(url) : undefined;
    return typeof cached === 'number' ? cached : null;
  });
  const [element, setElement] = useState<Element | null>(null);

  const ref = useCallback((node: Element | null) => setElement(node), []);

  useEffect(() => {
    if (!url || !element) return;

    let cancelled = false;
    // Trocar de elemento com a mesma URL repete a chamada, mas o cache responde sem novo HEAD.
    const request = () => {
      void fetchMediaFileSize(url).then((size) => {
        if (!cancelled) setSizeBytes(size);
      });
    };

    // Sem IntersectionObserver (navegador antigo, testes) consulta na hora.
    if (typeof IntersectionObserver === 'undefined') {
      request();
      return () => {
        cancelled = true;
      };
    }

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect();
        request();
      }
    });
    observer.observe(element);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [url, element]);

  return { ref, sizeBytes };
}
