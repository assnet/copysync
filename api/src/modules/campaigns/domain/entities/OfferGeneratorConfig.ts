/** Configuração do gerador por tenant: sessão que envia e intervalo entre grupos (segundos). */
export interface OfferGeneratorConfig {
  tenantId: string;
  /** null = sessão apagada (SetNull) ou nunca escolhida. */
  sessionId: string | null;
  intervalMinSeconds: number;
  intervalMaxSeconds: number;
  updatedAt: Date;
}

/** Sessão vista pelo gerador: só o que a validação e o envio precisam. */
export interface OfferSessionRef {
  id: string;
  status: string;
}
