const MIB = 1024 * 1024;

/** Piso da reserva: abaixo disso a mídia recebida fica sem folga mesmo em disco pequeno. */
const MIN_RESERVE_BYTES = 100 * MIB;
/** Teto absoluto dos uploads abertos, em decimal como os limites do WhatsApp. */
const MAX_OPEN_CEILING_BYTES = 2_000_000_000;

export interface DiskBudgetInput {
  totalBytes: number;
  /** Reserva configurada; quando definida, vence a calculada. */
  reserveBytes?: number;
  /** Teto configurado; quando definido, vence o calculado. */
  maxOpenBytes?: number;
}

export interface DiskBudget {
  /** Espaço que nenhum upload pode consumir. */
  reserveBytes: number;
  /** Soma máxima dos bytes declarados pelos uploads abertos. */
  maxOpenBytes: number;
}

/**
 * Reserva e teto de uploads abertos relativos ao tamanho do disco.
 *
 * O disco de produção já teve 974 MB: uma reserva fixa de 1 GiB recusaria todo upload.
 * A reserva existe para a mídia **recebida**, que grava no mesmo disco e perde o arquivo
 * em silêncio quando falta espaço — por isso o piso de 100 MiB mesmo em disco minúsculo.
 *
 * Sem override: reserva = `max(100 MiB, 10%)`; teto = `min(2 GB, 50%)`.
 * `totalBytes` vem do `statfs` a cada criação, então aumentar o disco basta.
 */
export function diskBudget({ totalBytes, reserveBytes, maxOpenBytes }: DiskBudgetInput): DiskBudget {
  return {
    reserveBytes: reserveBytes ?? Math.max(MIN_RESERVE_BYTES, Math.floor(totalBytes / 10)),
    maxOpenBytes: maxOpenBytes ?? Math.min(MAX_OPEN_CEILING_BYTES, Math.floor(totalBytes / 2)),
  };
}
