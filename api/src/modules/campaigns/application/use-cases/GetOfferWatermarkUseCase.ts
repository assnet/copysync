import {
  requireOfferWatermarkPlan,
  toOfferWatermarkView,
  type OfferWatermarkActor,
  type OfferWatermarkUseCaseDeps,
  type OfferWatermarkView,
} from './offerWatermarkUseCaseDeps';

type Deps = Pick<OfferWatermarkUseCaseDeps, 'watermarks' | 'entitlements' | 'logos'>;

/** Marca d'água do tenant (qualquer membro lê; sem registro = padrões). Plano exigido. */
export class GetOfferWatermarkUseCase {
  constructor(private readonly deps: Deps) {}

  async execute(actor: OfferWatermarkActor): Promise<OfferWatermarkView> {
    await requireOfferWatermarkPlan(this.deps.entitlements, actor.tenantId);
    const mark = await this.deps.watermarks.findByTenant(actor.tenantId);
    return toOfferWatermarkView(mark, this.deps.logos, actor);
  }
}
