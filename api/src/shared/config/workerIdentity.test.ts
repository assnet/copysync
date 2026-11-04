import { describe, expect, it } from 'vitest';
import { currentWorkerId, resolveWorkerId } from './workerIdentity';

const fixed = (hex: string) => () => Buffer.from(hex, 'hex');

describe('resolveWorkerId', () => {
  it('env vazia: host, pid e nonce de 8 caracteres', () => {
    const id = resolveWorkerId({}, 'srv-a', 42, fixed('a1b2c3d4'));
    expect(id).toBe('srv-a-42-a1b2c3d4');
  });

  it('HOSTNAME tem prioridade sobre o hostname do SO', () => {
    expect(resolveWorkerId({ HOSTNAME: 'pod-7' }, 'srv-a', 1, fixed('00000000'))).toBe('pod-7-1-00000000');
  });

  it('dois boots no mesmo host/pid geram ids diferentes', () => {
    const a = resolveWorkerId({}, 'srv-a', 1);
    const b = resolveWorkerId({}, 'srv-a', 1);
    expect(a).toMatch(/^srv-a-1-[0-9a-f]{8}$/);
    expect(b).toMatch(/^srv-a-1-[0-9a-f]{8}$/);
    expect(a).not.toBe(b);
  });

  it('WORKER_ID definido é usado como veio, com trim', () => {
    expect(resolveWorkerId({ WORKER_ID: '  worker-1 ', HOSTNAME: 'pod-7' }, 'srv-a', 1)).toBe('worker-1');
  });

  it('WORKER_ID só com espaços gera o id', () => {
    expect(resolveWorkerId({ WORKER_ID: '   ' }, 'srv-a', 9, fixed('deadbeef'))).toBe('srv-a-9-deadbeef');
  });
});

describe('currentWorkerId', () => {
  it('é estável dentro do mesmo boot', () => {
    expect(currentWorkerId()).toBe(currentWorkerId());
  });
});
