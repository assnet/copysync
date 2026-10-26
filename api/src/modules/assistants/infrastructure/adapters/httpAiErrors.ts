import {
  AiProviderRateLimitedError,
  AiProviderRejectedError,
  AiProviderUnavailableError,
} from '../../../../shared/errors/internal/AiErrors';

export const AI_HTTP_TIMEOUT_MS = 30_000;

export type FetchFn = typeof fetch;

/** Status HTTP do provedor → erro interno. O corpo da resposta nunca entra no erro. */
export function errorForStatus(status: number): Error {
  if (status === 401 || status === 403) return new AiProviderRejectedError(status);
  if (status === 429) return new AiProviderRateLimitedError();
  if (status >= 500) return new AiProviderUnavailableError(`status_${status}`);
  // 400/404/422: modelo inexistente, parâmetro recusado etc. — corrigível no cadastro.
  return new AiProviderRejectedError(status);
}

/** POST JSON com timeout. Falha de rede ou timeout = 503; status ≠ 2xx = erro traduzido. */
export async function postJson(
  fetchFn: FetchFn,
  url: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchFn(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(AI_HTTP_TIMEOUT_MS),
      // API de IA não redireciona; seguir redirect abriria SSRF via endpoint próprio.
      redirect: 'error',
    });
  } catch (err) {
    const name = (err as { name?: string } | null)?.name;
    throw new AiProviderUnavailableError(name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network');
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => undefined);
    throw errorForStatus(res.status);
  }
  try {
    return await res.json();
  } catch {
    throw new AiProviderUnavailableError('invalid_json');
  }
}

export function tokenCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
