/** Textos do `SwipeCards` (carrossel de cards no mobile). Só leitor de tela e rótulos de apoio. */
export const swipeCardsStrings = {
  /** `aria-roledescription` do trilho e de cada card. */
  carouselRole: 'carrossel',
  slideRole: 'card',
  /** Nome do card para leitor de tela: "Shopee, 2 de 3". */
  slideLabel: (label: string, index: number, total: number) => `${label}, ${index} de ${total}`,
  indicatorsLabel: 'Escolher card',
  statusDone: 'configurado',
  statusPaused: 'pausado',
  statusPending: 'pendente',
};
