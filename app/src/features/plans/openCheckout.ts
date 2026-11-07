/**
 * Abre o link de pagamento em nova aba a partir do clique, sem `href` no botão (o navegador não
 * mostra a URL do gateway na barra de status). Chamar SÍNCRONO no handler do clique: fora dele o
 * bloqueador de pop-up barra a aba.
 *
 * Não passa `noopener`/`noreferrer` em `window.open`: com eles o navegador devolve `null` sempre
 * (especificação HTML) e não haveria como saber se a aba foi bloqueada. O isolamento vem de
 * `opener = null` logo após abrir; o referrer fica limitado à origem pela meta
 * `strict-origin-when-cross-origin` do `index.html`. Bloqueado (`null`) → navega na própria aba.
 */
export function openCheckout(url: string): void {
  const tab = window.open(url, '_blank');
  if (!tab) {
    window.location.assign(url);
    return;
  }
  try {
    tab.opener = null;
  } catch {
    // aba de outra origem já navegando: nada a fazer
  }
}
