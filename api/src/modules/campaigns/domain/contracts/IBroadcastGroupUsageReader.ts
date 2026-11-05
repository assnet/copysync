import type { BroadcastGroupRow } from '../services/broadcastGroupUnion';

/** Quem usa o grupo como destino: o gerador de ofertas ou o monitoramento da sessão `<sessionId>`. */
export type BroadcastGroupUse = 'generator' | `monitor:${string}`;

/** Um uso de grupo de disparo, com a engine da sessão do grupo (canal do limite). */
export interface BroadcastGroupUsageRow extends BroadcastGroupRow {
  conversationId: string;
  engine: string;
  use: BroadcastGroupUse;
}

export interface ListBroadcastGroupRowsOptions {
  /** Ignora os destinos do gerador (o save do gerador soma os pedidos no lugar). */
  exceptGenerator?: boolean;
  /** Ignora os destinos do monitoramento desta sessão (o save dele soma os pedidos no lugar). */
  exceptMonitorSessionId?: string;
}

/** Item do catálogo (BG-04): um grupo distinto (sessão + JID) e todos os seus usos. Sem texto de mensagem. */
export interface BroadcastGroupCatalogItem {
  conversationId: string;
  sessionId: string;
  sessionName: string;
  engine: string;
  groupJid: string;
  title: string | null;
  avatarUrl: string | null;
  usedBy: BroadcastGroupUse[];
}

/**
 * Leitura da união dos grupos de disparo do tenant: destinos do gerador (`offer_destinations`) ⋃
 * destinos dos monitoramentos (`broadcast_groups`). Ignora sessão apagada; toda consulta filtra `tenantId`.
 */
export interface IBroadcastGroupUsageReader {
  listRows(tenantId: string, options?: ListBroadcastGroupRowsOptions): Promise<BroadcastGroupUsageRow[]>;
  listCatalog(tenantId: string): Promise<BroadcastGroupCatalogItem[]>;
}
