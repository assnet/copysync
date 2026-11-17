/** Contato que o PRÓPRIO tenant já conhece (agenda/conversas dele). Nunca dado de outro tenant. */
export interface SaverKnownContact {
  /** Telefone em dígitos. */
  phone: string;
  /** LID em dígitos, quando o tenant já viu o par LID↔telefone. */
  lid: string | null;
  name: string | null;
}

export interface SaverKnownContactKeys {
  lids: readonly string[];
  phones: readonly string[];
}

/**
 * Leitura dos contatos conhecidos do tenant para completar membro com número oculto. Só leitura local
 * (banco), sempre por `tenantId`; nunca consulta o canal.
 */
export interface ISaverKnownContactReader {
  findByKeys(tenantId: string, keys: SaverKnownContactKeys): Promise<SaverKnownContact[]>;
}
