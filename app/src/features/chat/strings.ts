/**
 * Textos do chat, centralizados até o painel ter uma lib de i18n (context.md D3).
 *
 * Regras para continuar migrável para `t()` sem tocar em componente:
 * - chaves semânticas, nunca o texto como chave
 * - frase com variável é função tipada; plural resolvido aqui, não no JSX
 * - componente nunca concatena pedaços destas strings
 * - sem nome de marca do produto nem da engine de mensageria
 */

/** Junta nomes em lista natural: "Ana", "Ana e Bia", "Ana, Bia e Caio". */
function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}`;
}

export const chatStrings = {
  reactions: {
    react: 'Reagir',
    /** `aria-label` do botão de reagir no cluster de ações da bolha. */
    reactToMessage: 'Reagir à mensagem',
    remove: 'Remover reação',
    quickBar: 'Reações rápidas',
    openFullPicker: 'Mais emojis',
    participant: 'Participante',
    /** Autor da reação quando é a própria conta. */
    you: 'Você',

    /** Tooltip do chip: quem reagiu. Lista vazia vira texto neutro. */
    reactorsTooltip: (names: string[]): string =>
      names.length === 0 ? 'Reação' : `${joinNames(names)} reagiu${names.length > 1 ? 'ram' : ''}`,

    /** `aria-label` do chip. Plural resolvido aqui. */
    chipLabel: (emoji: string, count: number): string =>
      `${emoji} ${count} ${count === 1 ? 'reação' : 'reações'}`,

    errors: {
      sendFailed: 'Não foi possível reagir. Tente de novo.',
      sessionDisconnected: 'Sessão desconectada. Reconecte para reagir.',
      rateLimited: 'Muitas reações seguidas. Aguarde um instante.',
    },
  },

  /** Textos internos do seletor completo de emojis. */
  emojiPicker: {
    searchPlaceholder: 'Buscar emoji',
    searchClear: 'Limpar busca',
    categories: {
      suggested: 'Mais usados',
      smileysPeople: 'Carinhas e pessoas',
      animalsNature: 'Animais e natureza',
      foodDrink: 'Comidas e bebidas',
      travelPlaces: 'Viagens e lugares',
      activities: 'Atividades',
      objects: 'Objetos',
      symbols: 'Símbolos',
      flags: 'Bandeiras',
    },
  },
} as const;
