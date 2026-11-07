/**
 * Anexa pares à query de uma URL sem re-serializar a query existente: os parâmetros que o
 * gateway já traz (utm, sck, códigos de oferta) saem byte a byte iguais. `dropKeys` remove os
 * segmentos dessas chaves (comparação sem diferenciar maiúsculas) antes de anexar. Função pura.
 */
export function appendQuery(url: string, additions: URLSearchParams, dropKeys: ReadonlySet<string> = new Set()): string {
  if ([...additions.keys()].length === 0) return url;
  const hashAt = url.indexOf('#');
  const beforeHash = hashAt < 0 ? url : url.slice(0, hashAt);
  const hash = hashAt < 0 ? '' : url.slice(hashAt);
  const queryAt = beforeHash.indexOf('?');
  const base = queryAt < 0 ? beforeHash : beforeHash.slice(0, queryAt);
  const segments = queryAt < 0 ? [] : beforeHash.slice(queryAt + 1).split('&');
  const kept = segments.filter((segment) => {
    if (!segment) return false;
    const [key = ''] = [...new URLSearchParams(segment).keys()];
    return !dropKeys.has(key.toLowerCase());
  });
  return `${base}?${[...kept, additions.toString()].join('&')}${hash}`;
}
