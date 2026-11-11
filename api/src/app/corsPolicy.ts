/**
 * Headers de resposta que o painel (outra origem) pode ler. `X-Server-Time` alimenta o
 * `serverNow()`; `Retry-After` vem do `errorHandler` nos 429 com `meta.retryAt`. Header novo lido
 * pelo painel entra aqui, senão o navegador o esconde.
 */
export const CORS_EXPOSED_HEADERS = ['X-Server-Time', 'Retry-After'] as const;
