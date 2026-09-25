import type { Prisma } from '@prisma/client';

type SqlClient = Pick<Prisma.TransactionClient, '$executeRaw'>;

/**
 * Cascata do catálogo de listas em `chat_conversations.tags`.
 *
 * Compartilhado pelo repositório de conversas (`replaceTag`/`removeTag`) e pelo de listas,
 * que chama com o `tx` da transação para a mudança no catálogo e nas conversas irem juntas.
 * `tags @> ARRAY[...]` usa o GIN de `tags`; `::text` fixa o tipo dos binds, que chegariam
 * sem tipo às funções polimórficas de array.
 */
export const chatConversationTagsSql = {
  /** Troca o nome preservando a ordem e sem duplicar quando a conversa já tinha o novo. */
  replace(db: SqlClient, tenantId: string, oldName: string, newName: string): Promise<number> {
    return db.$executeRaw`
      UPDATE "chat_conversations"
      SET "tags" = (
        SELECT COALESCE(array_agg(u.name ORDER BY u.ord), '{}')
        FROM (
          SELECT DISTINCT ON (name) name, ord
          FROM unnest(array_replace("tags", ${oldName}::text, ${newName}::text)) WITH ORDINALITY AS t(name, ord)
          ORDER BY name, ord
        ) AS u
      ),
      "updatedAt" = now()
      WHERE "tenantId" = ${tenantId} AND "tags" @> ARRAY[${oldName}::text]
    `;
  },

  remove(db: SqlClient, tenantId: string, name: string): Promise<number> {
    return db.$executeRaw`
      UPDATE "chat_conversations"
      SET "tags" = array_remove("tags", ${name}::text), "updatedAt" = now()
      WHERE "tenantId" = ${tenantId} AND "tags" @> ARRAY[${name}::text]
    `;
  },
};
