/**
 * URL do Prisma com `socket_timeout` (F14). Sem prazo (`undefined`) devolve `undefined`: o
 * `PrismaClient` segue lendo `DATABASE_URL` do schema, idêntico a antes. Com prazo, acrescenta
 * `socket_timeout=<n>` (segundos) sem duplicar se a URL já tiver o parâmetro. Manipulação por
 * texto: reserializar com `URL` poderia mudar o encoding da senha.
 */
export function buildDatasourceUrl(databaseUrl: string, socketTimeoutS: number | undefined): string | undefined {
  if (socketTimeoutS === undefined) return undefined;
  if (/[?&]socket_timeout=/.test(databaseUrl)) return databaseUrl;
  const separator = databaseUrl.includes('?') ? '&' : '?';
  return `${databaseUrl}${separator}socket_timeout=${socketTimeoutS}`;
}
