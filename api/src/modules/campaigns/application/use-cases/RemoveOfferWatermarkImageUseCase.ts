import {
  requireOfferWatermarkEditor,
  requireOfferWatermarkPlan,
  toOfferWatermarkView,
  type OfferWatermarkActor,
  type OfferWatermarkUseCaseDeps,
  type OfferWatermarkView,
} from './offerWatermarkUseCaseDeps';

type Deps = Pick<OfferWatermarkUseCaseDeps, 'watermarks' | 'entitlements' | 'logos'>;

/**
 * Remove o logo (spec IMG-06): zera `imageKey` e depois apaga do storage (registro nunca aponta para
 * arquivo sumido). Sem logo: devolve o estado atual (idempotente). Texto e ajustes seguem guardados.
 */
export class RemoveOfferWatermarkImageUseCase {
  constructor(private readonly deps: Deps) {}

  async execute(actor: OfferWatermarkActor): Promise<OfferWatermarkView> {
    const { watermarks, entitlements, logos } = this.deps;
    await requireOfferWatermarkPlan(entitlements, actor.tenantId);
    requireOfferWatermarkEditor(actor);
    const current = await watermarks.findByTenant(actor.tenantId);
    if (!current?.imageKey) return toOfferWatermarkView(current, logos, actor);
    const saved = await watermarks.save(actor.tenantId, { imageKey: null });
    await logos.remove(current.imageKey);
    return toOfferWatermarkView(saved, logos, actor);
  }
}
