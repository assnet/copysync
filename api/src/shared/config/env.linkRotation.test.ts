import { describe, expect, it } from 'vitest';
import { env, isLinkRotationConfigured, resolveLinkRotationSecret } from './env';

const LONG = 'x'.repeat(32);

describe('resolveLinkRotationSecret', () => {
  it('produção sem valor ou curto → undefined (recurso desligado, boot segue)', () => {
    expect(resolveLinkRotationSecret(undefined, 'production', 'dev')).toBeUndefined();
    expect(resolveLinkRotationSecret('curto', 'production', 'dev')).toBeUndefined();
    expect(resolveLinkRotationSecret(LONG, 'production', 'dev')).toBe(LONG);
  });

  it('dev/test usa o padrão sintético quando ausente ou curto', () => {
    expect(resolveLinkRotationSecret(undefined, 'development', 'dev')).toBe('dev');
    expect(resolveLinkRotationSecret('curto', 'test', 'dev')).toBe('dev');
    expect(resolveLinkRotationSecret(LONG, 'test', 'dev')).toBe(LONG);
  });

  it('em test o recurso fica configurado e o job desligado por padrão', () => {
    expect(isLinkRotationConfigured()).toBe(true);
    expect(env.LINK_ROTATION_MEMBER_SYNC_ENABLED).toBe(false);
  });
});
