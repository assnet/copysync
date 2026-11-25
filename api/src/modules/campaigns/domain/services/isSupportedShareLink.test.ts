import { describe, it, expect } from 'vitest';
import { isSupportedShareLink } from './isSupportedShareLink';

const KABUM = 'https://www.kabum.com.br/produto/123456/x';
const awin = (mid: string) =>
  `https://www.awin1.com/cread.php?awinmid=${mid}&awinaffid=1234567&ued=${encodeURIComponent(KABUM)}`;

describe('isSupportedShareLink — Kabum, Magalu e AliExpress', () => {
  it.each([
    [awin('17729'), true],
    [KABUM, true],
    ['https://www.magazinevoce.com.br/minhaloja/x/p/240552500/', true],
    ['https://s.click.aliexpress.com/e/_abc', true],
    ['https://pt.aliexpress.com/item/1005001234567890.html', true],
    [awin('99999'), false],
    ['https://tidd.ly/3abcXYZ', false],
    ['https://www.aliexpress.us/item/1.html', false],
    ['https://aliexpress.ru/item/1.html', false],
    ['http://s.click.aliexpress.com/e/_abc', false],
    ['https://evilkabum.com.br/produto/1', false],
    ['nao é url', false],
  ] as const)('%s → %s', (raw, expected) => {
    expect(isSupportedShareLink(raw)).toBe(expected);
  });
});
