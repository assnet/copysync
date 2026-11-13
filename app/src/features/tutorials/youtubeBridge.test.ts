import { describe, expect, it } from 'vitest';
import { buildEmbedUrl, parsePlayerMessage } from './youtubeBridge';

describe('youtubeBridge', () => {
  it('monta embed sem cookies com retomada', () => {
    const url = new URL(buildEmbedUrl('abc', 61.8, 'https://app.x.app'));
    expect(url.origin).toBe('https://www.youtube-nocookie.com');
    expect(url.searchParams.get('start')).toBe('61');
    expect(url.searchParams.get('enablejsapi')).toBe('1');
    expect(new URL(buildEmbedUrl('abc', 0, 'https://x')).searchParams.has('start')).toBe(false);
  });

  it('lê infoDelivery e onStateChange', () => {
    expect(parsePlayerMessage(JSON.stringify({ event: 'infoDelivery', info: { currentTime: 10, duration: 100, playerState: 1 } })))
      .toEqual({ currentTime: 10, duration: 100, state: 1 });
    expect(parsePlayerMessage(JSON.stringify({ event: 'onStateChange', info: 0 }))).toEqual({ state: 0 });
  });

  it('ignora lixo', () => {
    expect(parsePlayerMessage('nao json')).toBeNull();
    expect(parsePlayerMessage({ a: 1 })).toBeNull();
    expect(parsePlayerMessage(JSON.stringify({ event: 'infoDelivery', info: {} }))).toBeNull();
  });
});
