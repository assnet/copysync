/** Textos do estado "sistema atualizando" (API fora do ar por deploy/reinício). */
export const serviceUpdatingStrings = {
  title: 'Estamos atualizando o sistema',
  description: 'Volta em instantes — tentamos de novo sozinhos.',
  nextAttempt: (seconds: number) => `Nova tentativa em ${seconds} s`,
  retrying: 'Tentando de novo…',
  paused: 'Contagem pausada enquanto esta aba está em segundo plano.',
  retryNow: 'Tentar agora',
  retryNowHint: 'Busca de novo sem esperar a contagem',
  illustrationLabel: 'Ilustração de um servidor sendo ajustado',
  stillUpdating: 'O sistema ainda está sendo atualizado.',
} as const;
