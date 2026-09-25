import { describe, it, expect } from 'vitest';
import { InMemoryReactionSendThrottle } from './InMemoryReactionSendThrottle';

function makeThrottle(opts?: { minIntervalMs?: number; maxPerMinute?: number }) {
  const clock = { t: 1_000_000 };
  const throttle = new InMemoryReactionSendThrottle({
    minIntervalMs: opts?.minIntervalMs ?? 700,
    maxPerMinute: opts?.maxPerMinute ?? 3,
    now: () => clock.t,
  });
  return { throttle, clock };
}

describe('InMemoryReactionSendThrottle', () => {
  it('recusa nova reação na mesma mensagem antes do intervalo mínimo e libera depois', () => {
    const { throttle, clock } = makeThrottle();
    expect(throttle.tryAcquire('s1', 'm1')).not.toBeNull();

    clock.t += 699;
    expect(throttle.tryAcquire('s1', 'm1')).toBeNull();

    clock.t += 1;
    expect(throttle.tryAcquire('s1', 'm1')).not.toBeNull();
  });

  it('o intervalo é por mensagem: outra mensagem da mesma sessão passa na hora', () => {
    const { throttle } = makeThrottle();
    expect(throttle.tryAcquire('s1', 'm1')).not.toBeNull();
    expect(throttle.tryAcquire('s1', 'm2')).not.toBeNull();
  });

  it('recusa acima do teto por sessão no minuto', () => {
    const { throttle } = makeThrottle({ maxPerMinute: 3 });
    expect(throttle.tryAcquire('s1', 'm1')).not.toBeNull();
    expect(throttle.tryAcquire('s1', 'm2')).not.toBeNull();
    expect(throttle.tryAcquire('s1', 'm3')).not.toBeNull();
    expect(throttle.tryAcquire('s1', 'm4')).toBeNull();
  });

  it('janela deslizante: a vaga volta quando a reserva mais antiga sai do minuto', () => {
    const { throttle, clock } = makeThrottle({ maxPerMinute: 2 });
    throttle.tryAcquire('s1', 'm1');
    clock.t += 30_000;
    throttle.tryAcquire('s1', 'm2');
    expect(throttle.tryAcquire('s1', 'm3')).toBeNull();

    // m1 sai da janela; m2 ainda ocupa a sua vaga
    clock.t += 30_000;
    expect(throttle.tryAcquire('s1', 'm3')).not.toBeNull();
    expect(throttle.tryAcquire('s1', 'm4')).toBeNull();
  });

  it('sessões têm limites independentes', () => {
    const { throttle } = makeThrottle({ maxPerMinute: 1 });
    expect(throttle.tryAcquire('s1', 'm1')).not.toBeNull();
    expect(throttle.tryAcquire('s1', 'm2')).toBeNull();
    expect(throttle.tryAcquire('s2', 'm1')).not.toBeNull();
  });

  it('release devolve a vaga no intervalo da mensagem e no teto da sessão', () => {
    const { throttle } = makeThrottle({ maxPerMinute: 1 });
    const reservation = throttle.tryAcquire('s1', 'm1');
    expect(reservation).not.toBeNull();
    expect(throttle.tryAcquire('s1', 'm2')).toBeNull();

    throttle.release(reservation!);

    // Mesma mensagem logo em seguida (intervalo) e vaga da sessão (teto) disponíveis
    expect(throttle.tryAcquire('s1', 'm1')).not.toBeNull();
  });

  it('release é idempotente: chamar duas vezes não devolve vaga extra', () => {
    const { throttle } = makeThrottle({ maxPerMinute: 2 });
    const first = throttle.tryAcquire('s1', 'm1')!;
    throttle.release(first);
    throttle.release(first);

    expect(throttle.tryAcquire('s1', 'm2')).not.toBeNull();
    expect(throttle.tryAcquire('s1', 'm3')).not.toBeNull();
    expect(throttle.tryAcquire('s1', 'm4')).toBeNull();
  });

  it('duas aquisições seguidas sem await: a segunda é recusada', () => {
    const { throttle } = makeThrottle();
    const a = throttle.tryAcquire('s1', 'm1');
    const b = throttle.tryAcquire('s1', 'm1');
    expect(a).not.toBeNull();
    expect(b).toBeNull();
  });

  it('chaves vencidas são removidas, sem crescer sem limite', () => {
    const { throttle, clock } = makeThrottle({ maxPerMinute: 100 });
    for (let i = 0; i < 50; i++) throttle.tryAcquire(`s${i}`, `m${i}`);
    expect(throttle.trackedKeys).toBe(100);

    clock.t += 60_000;
    throttle.tryAcquire('outra', 'm');

    // Só sobra a reserva recém-feita (sessão + mensagem)
    expect(throttle.trackedKeys).toBe(2);
  });
});
