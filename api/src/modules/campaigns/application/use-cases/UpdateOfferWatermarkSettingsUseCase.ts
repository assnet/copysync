import type { OfferWatermarkPatch } from '../../domain/contracts/IOfferWatermarkRepository';
import {
  isWatermarkKind,
  isWatermarkPosition,
  isWatermarkSize,
  validateWatermarkOpacity,
  validateWatermarkText,
} from '../../domain/services/offerWatermarkRules';
import { OfferWatermarkInvalidInputError } from '../../../../shared/errors/internal/OfferWatermarkErrors';
import {
  requireOfferWatermarkEditor,
  requireOfferWatermarkPlan,
  toOfferWatermarkView,
  type OfferWatermarkActor,
  type OfferWatermarkUseCaseDeps,
  type OfferWatermarkView,
} from './offerWatermarkUseCaseDeps';

type Deps = Pick<OfferWatermarkUseCaseDeps, 'watermarks' | 'entitlements' | 'logos'>;

/** Corpo do PUT: campo ausente não muda; `text: null` apaga o texto (o logo segue guardado). */
export interface UpdateOfferWatermarkSettingsInput {
  enabled?: unknown;
  kind?: unknown;
  text?: unknown;
  position?: unknown;
  size?: unknown;
  opacity?: unknown;
}

/**
 * Ajustes da marca (spec IMG-07/14). O schema HTTP só checa tipo; a regra é do domínio e a recusa
 * sai como 422 `OFFER_WATERMARK_INVALID_INPUT` com `meta.field`. Trocar `kind` não apaga o outro dado.
 */
export class UpdateOfferWatermarkSettingsUseCase {
  constructor(private readonly deps: Deps) {}

  async execute(actor: OfferWatermarkActor, input: UpdateOfferWatermarkSettingsInput): Promise<OfferWatermarkView> {
    await requireOfferWatermarkPlan(this.deps.entitlements, actor.tenantId);
    requireOfferWatermarkEditor(actor);
    const patch = toPatch(input);
    const saved = await this.deps.watermarks.save(actor.tenantId, patch);
    return toOfferWatermarkView(saved, this.deps.logos, actor);
  }
}

function toPatch(input: UpdateOfferWatermarkSettingsInput): OfferWatermarkPatch {
  const patch: OfferWatermarkPatch = {};
  if (input.enabled !== undefined) {
    if (typeof input.enabled !== 'boolean') throw new OfferWatermarkInvalidInputError('enabled');
    patch.enabled = input.enabled;
  }
  if (input.kind !== undefined) {
    if (!isWatermarkKind(input.kind)) throw new OfferWatermarkInvalidInputError('kind');
    patch.kind = input.kind;
  }
  if (input.text !== undefined) {
    if (input.text === null) patch.text = null;
    else {
      const text = typeof input.text === 'string' ? validateWatermarkText(input.text) : { kind: 'invalid' as const };
      if (text.kind !== 'ok') throw new OfferWatermarkInvalidInputError('text');
      patch.text = text.value;
    }
  }
  if (input.position !== undefined) {
    if (!isWatermarkPosition(input.position)) throw new OfferWatermarkInvalidInputError('position');
    patch.position = input.position;
  }
  if (input.size !== undefined) {
    if (!isWatermarkSize(input.size)) throw new OfferWatermarkInvalidInputError('size');
    patch.size = input.size;
  }
  if (input.opacity !== undefined) {
    const opacity = typeof input.opacity === 'number' ? validateWatermarkOpacity(input.opacity) : { kind: 'invalid' as const };
    if (opacity.kind !== 'ok') throw new OfferWatermarkInvalidInputError('opacity');
    patch.opacity = opacity.value;
  }
  return patch;
}
