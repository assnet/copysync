import { describe, it, expect } from 'vitest';
import { checkCustomBaseUrl } from './customBaseUrl';

describe('checkCustomBaseUrl', () => {
  it.each([
    ['https://api.example.com/v1', 'https://api.example.com/v1'],
    ['https://API.example.com/v1/', 'https://api.example.com/v1'],
    ['https://api.example.com:443/v1', 'https://api.example.com/v1'],
    ['https://api.example.com', 'https://api.example.com'],
  ])('aceita %s', (raw, url) => {
    expect(checkCustomBaseUrl(raw)).toEqual({ ok: true, url });
  });

  it.each([
    ['', 'required'],
    ['nota url', 'malformed'],
    ['http://api.example.com', 'scheme'],
    ['https://u:p@api.example.com', 'userinfo'],
    ['https://api.example.com:8443', 'port'],
    ['https://api.example.com/v1?k=1', 'query'],
    ['https://api.example.com/v1#x', 'query'],
    ['https://127.0.0.1', 'ip_literal'],
    ['https://0x7f.1', 'ip_literal'],
    ['https://2130706433', 'ip_literal'],
    ['https://[::1]', 'ip_literal'],
    ['https://[::ffff:10.0.0.1]', 'ip_literal'],
    ['https://localhost', 'private_host'],
    ['https://intranet', 'private_host'],
    ['https://nas.local', 'private_host'],
    ['https://db.internal', 'private_host'],
    ['https://x.localhost.', 'private_host'],
    [`https://a.com/${'a'.repeat(300)}`, 'too_long'],
  ])('recusa %s (%s)', (raw, reason) => {
    expect(checkCustomBaseUrl(raw)).toEqual({ ok: false, reason });
  });
});
