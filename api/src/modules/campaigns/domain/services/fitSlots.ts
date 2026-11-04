/**
 * Reaplica `fit` em cadeia: cada horário parte do anterior já encaixado, mantendo o espaçamento
 * original entre eles. `fit` empurra um horário para dentro da janela de postagem (ex.: faixa e
 * dias do monitoramento ou do gerador). Função pura: não muda a entrada.
 */
export function fitSlots(slots: readonly Date[], fit: (at: Date) => Date): Date[] {
  const out: Date[] = [];
  for (let i = 0; i < slots.length; i++) {
    const gap = i === 0 ? 0 : slots[i]!.getTime() - slots[i - 1]!.getTime();
    out.push(fit(i === 0 ? slots[0]! : new Date(out[i - 1]!.getTime() + gap)));
  }
  return out;
}
