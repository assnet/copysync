import { OFFER_STORY_TEMPLATES } from '../../domain/offerStoryTemplates';
import { requireOfferStoryEnabled, type OfferStoryUseCaseDeps } from './offerStoryUseCaseDeps';

export interface OfferStoryTemplateSummary {
  id: string;
  name: string;
}

/** Catálogo de templates para o passo 1 do painel (ordem do catálogo). Gate do plano antes. */
export class ListOfferStoryTemplatesUseCase {
  constructor(private readonly deps: Pick<OfferStoryUseCaseDeps, 'entitlements'>) {}

  async execute(input: { tenantId: string }): Promise<{ templates: OfferStoryTemplateSummary[] }> {
    await requireOfferStoryEnabled(this.deps.entitlements, input.tenantId);
    return { templates: OFFER_STORY_TEMPLATES.map(({ id, name }) => ({ id, name })) };
  }
}
