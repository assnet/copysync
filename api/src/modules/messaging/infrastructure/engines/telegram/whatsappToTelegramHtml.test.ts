import { describe, expect, it } from 'vitest';
import { whatsappToTelegramHtml as html } from './whatsappToTelegramHtml';

describe('whatsappToTelegramHtml', () => {
  it('negrito, itálico, riscado e combinados', () => {
    expect(html('*Oferta* _hoje_ ~R$ 199~')).toBe('<b>Oferta</b> <i>hoje</i> <s>R$ 199</s>');
    expect(html('*_tudo_*')).toBe('<b><i>tudo</i></b>');
    expect(html('Preço: ~R$ 199,90~ *R$ 99,90*!')).toBe('Preço: <s>R$ 199,90</s> <b>R$ 99,90</b>!');
  });

  it('escapa &, < e >', () => {
    expect(html('a < b & c > d')).toBe('a &lt; b &amp; c &gt; d');
    expect(html('*<script>*')).toBe('<b>&lt;script&gt;</b>');
  });

  it('não quebra link de afiliado com _ e * dentro', () => {
    const url = 'https://amzn.to/abc_def*ghi?tag=loja_20&x=1';
    expect(html(`*Compre:* ${url}`)).toBe('<b>Compre:</b> https://amzn.to/abc_def*ghi?tag=loja_20&amp;x=1');
    expect(html(`_Link_ https://mercadolivre.com/sec/a_b_c _fim_`))
      .toBe('<i>Link</i> https://mercadolivre.com/sec/a_b_c <i>fim</i>');
    expect(html('Veja shopee.com.br/produto_x_y agora')).toBe('Veja shopee.com.br/produto_x_y agora');
  });

  it('link inteiro em negrito e pontuação final fora do link', () => {
    expect(html('*https://x.com/a_b*')).toBe('<b>https://x.com/a_b</b>');
    expect(html('Acesse https://x.com/p_1.')).toBe('Acesse https://x.com/p_1.');
  });

  it('marca dentro de palavra fica literal', () => {
    expect(html('snake_case_name e 2*3*4')).toBe('snake_case_name e 2*3*4');
    expect(html('* solto * e _ solto _')).toBe('* solto * e _ solto _');
  });

  it('não atravessa linhas', () => {
    expect(html('*a\nb*')).toBe('*a\nb*');
    expect(html('*Título*\n_sub_')).toBe('<b>Título</b>\n<i>sub</i>');
  });

  it('código não recebe outra formatação', () => {
    expect(html('use `*CUPOM_10*` já')).toBe('use <code>*CUPOM_10*</code> já');
    expect(html('```\na < b *x*\n```')).toBe('<pre>\na &lt; b *x*\n</pre>');
    expect(html('```CUPOM```')).toBe('<code>CUPOM</code>');
  });

  it('link colado em código não engole o placeholder', () => {
    const out = html('https://x.com/a`CUPOM`');
    expect(out).toBe('https://x.com/a<code>CUPOM</code>');
    expect(out).not.toContain('\u0001');
    expect(html('```X```shopee.com.br/p_1')).toBe('<code>X</code>shopee.com.br/p_1');
  });

  it('texto sem marcação sai igual', () => {
    expect(html('Olá, tudo bem?')).toBe('Olá, tudo bem?');
  });
});
