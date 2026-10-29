import { describe, it, expect, beforeEach } from 'vitest';
import { SetStorefrontImageUseCase } from './SetStorefrontImageUseCase';
import { RemoveStorefrontImageUseCase } from './RemoveStorefrontImageUseCase';
import { makeStorefrontDeps, makeUploadRecord, MEDIA_URL, TENANT, USER, type StorefrontFakes } from './storefrontTestFakes';
import { ENTITLEMENT_KEYS } from '../../../tenants/domain/entitlementKeys';
import { MediaProcessingFailedError, UnsupportedMediaTypeError } from '../../../../shared/errors/internal/MediaErrors';

const MIB = 1024 * 1024;

describe('SetStorefrontImageUseCase', () => {
  let fakes: StorefrontFakes;
  let useCase: SetStorefrontImageUseCase;
  const input = { tenantId: TENANT, userId: USER, kind: 'avatar' as const, uploadId: 'up-1' };

  beforeEach(() => {
    const made = makeStorefrontDeps();
    fakes = made.fakes;
    useCase = new SetStorefrontImageUseCase(made.deps);
    fakes.storefronts.seed();
  });

  it('processa a foto, grava no storage, atualiza a página e descarta o upload', async () => {
    const out = await useCase.execute(input);
    expect(out.url).toBe(`${MEDIA_URL}1.webp`);
    expect(fakes.images.calls).toEqual(['avatar']);
    expect(fakes.media.saved[0]!.toString()).toBe('webp:png');
    expect((await fakes.storefronts.findByTenant(TENANT))!.avatarUrl).toBe(out.url);
    expect(fakes.uploads.discarded).toEqual(['up-1']);
    expect(fakes.uploads.released).toEqual([]);
  });

  it('capa grava em coverUrl e apaga a capa anterior do storage', async () => {
    fakes.storefronts.pages[0]!.coverUrl = 'https://media.example/storefront-old.webp';
    const out = await useCase.execute({ ...input, kind: 'cover' });
    const page = (await fakes.storefronts.findByTenant(TENANT))!;
    expect(page.coverUrl).toBe(out.url);
    expect(page.avatarUrl).toBeNull();
    expect(fakes.media.removed).toEqual(['https://media.example/storefront-old.webp']);
  });

  it('sem o plano responde PLAN_FEATURE_UNAVAILABLE sem tocar no upload', async () => {
    fakes.entitlements.values[ENTITLEMENT_KEYS.STOREFRONT_ENABLED] = false;
    await expect(useCase.execute(input)).rejects.toMatchObject({ code: 'PLAN_FEATURE_UNAVAILABLE' });
    expect(fakes.uploads.discarded).toEqual([]);
  });

  it('sem página responde STOREFRONT_NOT_FOUND antes de consumir o upload', async () => {
    fakes.storefronts.pages = [];
    await expect(useCase.execute(input)).rejects.toMatchObject({ code: 'STOREFRONT_NOT_FOUND' });
    expect(fakes.uploads.released).toEqual([]);
  });

  it.each([
    [{ outcome: 'in_progress', record: makeUploadRecord() }, 'UPLOAD_IN_PROGRESS'],
    [{ outcome: 'incomplete', record: makeUploadRecord() }, 'UPLOAD_INCOMPLETE'],
    [{ outcome: 'consumed', messageId: 'm', record: makeUploadRecord() }, 'UPLOAD_NOT_FOUND'],
    [{ outcome: 'not_found' }, 'UPLOAD_NOT_FOUND'],
  ] as const)('upload %o responde %s sem liberar nem descartar', async (begin, code) => {
    fakes.uploads.begin = begin;
    await expect(useCase.execute(input)).rejects.toMatchObject({ code });
    expect(fakes.uploads.released).toEqual([]);
    expect(fakes.uploads.discarded).toEqual([]);
  });

  it('foto acima de 2 MiB responde MEDIA_TOO_LARGE antes de ler e libera o upload', async () => {
    fakes.uploads.begin = { outcome: 'started', record: makeUploadRecord({ sizeBytes: 2 * MIB + 1 }) };
    fakes.files.clear();
    await expect(useCase.execute(input)).rejects.toMatchObject({ code: 'MEDIA_TOO_LARGE' });
    expect(fakes.uploads.released).toEqual(['up-1']);
    expect(fakes.images.calls).toEqual([]);
  });

  it('capa aceita até 4 MiB', async () => {
    fakes.uploads.begin = { outcome: 'started', record: makeUploadRecord({ sizeBytes: 4 * MIB }) };
    await expect(useCase.execute({ ...input, kind: 'cover' })).resolves.toMatchObject({ url: expect.any(String) });
  });

  it('erro do processador libera o upload e não grava nada', async () => {
    fakes.images.error = new UnsupportedMediaTypeError();
    await expect(useCase.execute(input)).rejects.toBeInstanceOf(UnsupportedMediaTypeError);
    expect(fakes.uploads.released).toEqual(['up-1']);
    expect(fakes.media.saved).toEqual([]);
    expect((await fakes.storefronts.findByTenant(TENANT))!.avatarUrl).toBeNull();
  });

  it('falha ao gravar no storage libera o upload', async () => {
    fakes.media.error = new MediaProcessingFailedError();
    await expect(useCase.execute(input)).rejects.toMatchObject({ code: 'MEDIA_PROCESSING_FAILED' });
    expect(fakes.uploads.released).toEqual(['up-1']);
  });

  it('falha ao atualizar a página apaga o arquivo novo e mantém o anterior', async () => {
    fakes.storefronts.pages[0]!.avatarUrl = 'https://media.example/storefront-old.webp';
    fakes.storefronts.failUpdateOnce = true;
    await expect(useCase.execute(input)).rejects.toThrow('db down');
    expect(fakes.media.removed).toEqual([`${MEDIA_URL}1.webp`]);
  });

  it('upload sem arquivo em disco responde UPLOAD_NOT_FOUND e libera', async () => {
    fakes.uploads.path = null;
    await expect(useCase.execute(input)).rejects.toMatchObject({ code: 'UPLOAD_NOT_FOUND' });
    expect(fakes.uploads.released).toEqual(['up-1']);
  });
});

describe('RemoveStorefrontImageUseCase', () => {
  it('limpa a foto da página e apaga o arquivo', async () => {
    const { deps, fakes } = makeStorefrontDeps();
    fakes.storefronts.seed({ avatarUrl: 'https://media.example/storefront-a.webp', coverUrl: 'https://media.example/storefront-c.webp' });
    await new RemoveStorefrontImageUseCase(deps).execute({ tenantId: TENANT, kind: 'avatar' });
    const page = (await fakes.storefronts.findByTenant(TENANT))!;
    expect(page.avatarUrl).toBeNull();
    expect(page.coverUrl).toBe('https://media.example/storefront-c.webp');
    expect(fakes.media.removed).toEqual(['https://media.example/storefront-a.webp']);
  });

  it('sem imagem não chama o storage', async () => {
    const { deps, fakes } = makeStorefrontDeps();
    fakes.storefronts.seed();
    await new RemoveStorefrontImageUseCase(deps).execute({ tenantId: TENANT, kind: 'cover' });
    expect(fakes.media.removed).toEqual([]);
  });

  it('sem página responde STOREFRONT_NOT_FOUND', async () => {
    const { deps } = makeStorefrontDeps();
    await expect(new RemoveStorefrontImageUseCase(deps).execute({ tenantId: TENANT, kind: 'avatar' }))
      .rejects.toMatchObject({ code: 'STOREFRONT_NOT_FOUND' });
  });
});
