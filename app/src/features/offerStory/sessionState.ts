import { clearPersisted } from '@/hooks/usePersistedState';

/** Chaves de trabalho da tela (aba). Favoritos (`offerStory.favorites`, navegador) ficam: preferência sem dado sensível. */
export const WIZARD_KEY = 'offerStory.wizard';
export const RESULT_KEY = 'offerStory.result';
export const TEMPLATE_TAB_KEY = 'offerStory.templateTab';

/** Chamado no logout: a arte e o link de afiliado da conta anterior não podem reaparecer na mesma aba. */
export function clearOfferStoryState(): void {
  for (const key of [WIZARD_KEY, RESULT_KEY, TEMPLATE_TAB_KEY]) clearPersisted(key, 'tab');
}
