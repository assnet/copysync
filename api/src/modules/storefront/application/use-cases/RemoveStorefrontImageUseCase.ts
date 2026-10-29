import { requireStorefront, requireStorefrontEnabled, type StorefrontUseCaseDeps } from './storefrontUseCaseDeps';
import type { StorefrontPageImageKind } from './SetStorefrontImageUseCase';

type Deps = Pick<StorefrontUseCaseDeps, 'storefronts' | 'media' | 'entitlements'>;

export interface RemoveStorefrontImageInput {
  tenantId: string;
  kind: StorefrontPageImageKind;
}

const FIELD = { avatar: 'avatarUrl', cover: 'coverUrl' } as const;

/** Tira a foto/capa da página e apaga o arquivo. Sem gate: limpar continua valendo sem o plano. */
export class RemoveStorefrontImageUseCase {
  constructor(private readonly deps: Deps) {}

  async execute(input: RemoveStorefrontImageInput): Promise<void> {
    await requireStorefrontEnabled(this.deps.entitlements, input.tenantId);
    const { storefronts, media } = this.deps;
    const page = await requireStorefront(storefronts, input.tenantId);
    const field = FIELD[input.kind];
    const previous = page[field];
    if (!previous) return;
    await storefronts.update(input.tenantId, { [field]: null });
    await media.remove(previous);
  }
}
