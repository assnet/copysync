import { beforeEach, describe, expect, it } from 'vitest';
import { writePersisted } from '@/hooks/usePersistedState';
import { RESULT_KEY, TEMPLATE_TAB_KEY, WIZARD_KEY, clearOfferStoryState } from './sessionState';

describe('clearOfferStoryState', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  it('apaga rascunho, arte e aba de templates, mas mantém favoritos e outras telas', () => {
    for (const key of [WIZARD_KEY, RESULT_KEY, TEMPLATE_TAB_KEY, 'other.screen']) writePersisted(key, { x: 1 });
    writePersisted('offerStory.favorites', ['a'], { scope: 'browser' });

    clearOfferStoryState();

    for (const key of [WIZARD_KEY, RESULT_KEY, TEMPLATE_TAB_KEY]) expect(sessionStorage.getItem(`ui.${key}`)).toBeNull();
    expect(sessionStorage.getItem('ui.other.screen')).not.toBeNull();
    expect(localStorage.getItem('ui.offerStory.favorites')).not.toBeNull();
  });
});
