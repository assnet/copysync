import { describe, it, expect } from 'vitest';
import { classifyUserAgent } from './classifyUserAgent';

describe('classifyUserAgent', () => {
  it.each([
    ['WhatsApp/2.23.20.0 A', 'bot'],
    ['facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)', 'bot'],
    ['Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', 'bot'],
    ['TelegramBot (like TwitterBot)', 'bot'],
    ['curl/8.4.0', 'bot'],
    ['python-requests/2.31.0', 'bot'],
    ['Mozilla/5.0 (compatible; SomeCrawler/1.0)', 'bot'],
    ['', 'bot'],
    [null, 'bot'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 300.0.0', 'webview'],
    ['Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/118 Mobile [FBAN/EMA;FBAV/400.0]', 'webview'],
    ['Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 musical_ly_2023 BytedanceWebview/d8a21c6', 'webview'],
    ['Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Mobile Line/13.0.0', 'webview'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36', 'browser'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1', 'browser'],
  ])('%s → %s', (ua, expected) => {
    expect(classifyUserAgent(ua)).toBe(expected);
  });
});
