import { describe, expect, it } from 'vitest';
import {
  createPlatformSaverContactCursor,
  platformSaverContactScope,
  readPlatformSaverContactCursor,
} from './platformSaverContactCursor';

const filter = { search: 'ana', tenantId: null, from: null, to: null, ddi: null, ddd: null };
const key = { lastSeenAt: new Date('2026-11-17T03:00:00.000Z'), id: 'c1' };

describe('platformSaverContactCursor', () => {
  it('ida e volta com o mesmo filtro', () => {
    const scope = platformSaverContactScope(filter);
    expect(readPlatformSaverContactCursor(createPlatformSaverContactCursor(scope, key), scope)).toEqual(key);
  });

  it('outro filtro, chave adulterada ou lixo = null', () => {
    const scope = platformSaverContactScope(filter);
    const cursor = createPlatformSaverContactCursor(scope, key);
    expect(readPlatformSaverContactCursor(cursor, platformSaverContactScope({ ...filter, tenantId: 't2' }))).toBeNull();
    expect(readPlatformSaverContactCursor(cursor, platformSaverContactScope({ ...filter, ddi: '55' }))).toBeNull();
    const br = platformSaverContactScope({ ...filter, ddi: '55' });
    expect(readPlatformSaverContactCursor(createPlatformSaverContactCursor(br, key), platformSaverContactScope({ ...filter, ddi: '55', ddd: '11' }))).toBeNull();
    const forged = Buffer.from(JSON.stringify({ s: key.lastSeenAt.toISOString(), i: 'c0' })).toString('base64url');
    expect(readPlatformSaverContactCursor(`${forged}${cursor.slice(cursor.indexOf('~'))}`, scope)).toBeNull();
    expect(readPlatformSaverContactCursor('lixo', scope)).toBeNull();
  });

  it('busca com espaços nas pontas não muda o escopo', () => {
    expect(platformSaverContactScope({ ...filter, search: '  ana ' })).toBe(platformSaverContactScope(filter));
  });
});
