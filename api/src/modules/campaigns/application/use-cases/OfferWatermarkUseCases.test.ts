import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OfferWatermark } from '../../domain/entities/OfferWatermark';
import type { OfferWatermarkPatch } from '../../domain/contracts/IOfferWatermarkRepository';
import type { BeginConsumeResult } from '../../../media/domain/contracts/IUploadSessionStore';
import { MediaProcessingFailedError } from '../../../../shared/errors/internal/MediaErrors';
import type { OfferWatermarkActor, OfferWatermarkUseCaseDeps } from './offerWatermarkUseCaseDeps';
import { GetOfferWatermarkUseCase } from './GetOfferWatermarkUseCase';
import { UpdateOfferWatermarkSettingsUseCase } from './UpdateOfferWatermarkSettingsUseCase';
import { SetOfferWatermarkImageUseCase } from './SetOfferWatermarkImageUseCase';
import { RemoveOfferWatermarkImageUseCase } from './RemoveOfferWatermarkImageUseCase';

const T0 = new Date('2026-11-25T12:00:00.000Z');
const OLD = 'offer-watermark-00000000-0000-4000-8000-000000000001.png';
const NEW = 'offer-watermark-00000000-0000-4000-8000-000000000002.png';
const UPLOAD = '11111111-1111-4111-8111-111111111111';
const ADMIN: OfferWatermarkActor = { tenantId: 't1', userId: 'u1', role: 'ADMIN', isSuperAdmin: false };
const OPERATOR: OfferWatermarkActor = { ...ADMIN, role: 'OPERATOR' };

let plan: boolean | null;
let record: OfferWatermark | null;
let begun: BeginConsumeResult['outcome'];
let deps: OfferWatermarkUseCaseDeps;

const base = (over: Partial<OfferWatermark> = {}): OfferWatermark => ({
  id: 'w1', tenantId: 't1', kind: 'IMAGE', imageKey: null, text: null, enabled: false, position: 'BOTTOM_RIGHT',
  size: 'MEDIUM', opacity: 80, createdAt: T0, updatedAt: T0, ...over,
});

beforeEach(() => {
  plan = true;
  record = null;
  begun = 'started';
  deps = {
    entitlements: { getBoolean: vi.fn(async () => plan) },
    watermarks: {
      findByTenant: vi.fn(async () => record),
      save: vi.fn(async (_t: string, patch: OfferWatermarkPatch) => (record = { ...base(), ...record, ...patch } as OfferWatermark)),
    },
    logos: {
      read: vi.fn(async () => null),
      save: vi.fn(async () => NEW),
      remove: vi.fn(async () => true),
      publicUrl: vi.fn((k: string) => `/api/storage/media/${k}`),
    },
    processor: { normalize: vi.fn(async () => ({ buffer: Buffer.from('png'), width: 300, height: 200 })) },
    uploads: {
      beginConsume: vi.fn(async () => ({ outcome: begun, record: { sizeBytes: 3 } }) as unknown as BeginConsumeResult),
      releaseConsume: vi.fn(async () => undefined),
      discard: vi.fn(async () => undefined),
      binPath: vi.fn(() => '/up/x.bin'),
    } as unknown as OfferWatermarkUseCaseDeps['uploads'],
    readFile: vi.fn(async () => Buffer.from('raw')),
  };
});

describe('GetOfferWatermarkUseCase', () => {
  it('sem registro: padrões, sem logo; operador lê com canEdit false', async () => {
    const view = await new GetOfferWatermarkUseCase(deps).execute(OPERATOR);
    expect(view).toMatchObject({ enabled: false, kind: 'IMAGE', position: 'BOTTOM_RIGHT', opacity: 80, imageUrl: null, canEdit: false, updatedAt: null });
  });

  it('com logo: URL, nunca a chave crua como campo', async () => {
    record = base({ imageKey: OLD });
    const view = await new GetOfferWatermarkUseCase(deps).execute(ADMIN);
    expect(view.imageUrl).toBe(`/api/storage/media/${OLD}`);
    expect(view).not.toHaveProperty('imageKey');
  });

  it('plano sem a chave → PLAN_FEATURE_UNAVAILABLE', async () => {
    plan = false;
    await expect(new GetOfferWatermarkUseCase(deps).execute(ADMIN)).rejects.toMatchObject({ code: 'PLAN_FEATURE_UNAVAILABLE', statusCode: 403 });
  });
});

describe('UpdateOfferWatermarkSettingsUseCase', () => {
  const run = (input: Record<string, unknown>, actor = ADMIN) => new UpdateOfferWatermarkSettingsUseCase(deps).execute(actor, input);

  it('grava só os campos enviados, texto com trim', async () => {
    const view = await run({ enabled: true, kind: 'TEXT', text: '  Loja da Ana ', opacity: 40 });
    expect(deps.watermarks.save).toHaveBeenCalledWith('t1', { enabled: true, kind: 'TEXT', text: 'Loja da Ana', opacity: 40 });
    expect(view).toMatchObject({ enabled: true, kind: 'TEXT', text: 'Loja da Ana', opacity: 40 });
  });

  it('text null apaga só o texto', async () => {
    await run({ text: null });
    expect(deps.watermarks.save).toHaveBeenCalledWith('t1', { text: null });
  });

  it.each([
    [{ opacity: 10 }, 'opacity'], [{ opacity: 101 }, 'opacity'], [{ opacity: 50.5 }, 'opacity'],
    [{ text: '' }, 'text'], [{ text: 'x'.repeat(33) }, 'text'], [{ text: 'a\nb' }, 'text'],
    [{ kind: 'BOTH' }, 'kind'], [{ position: 'TOP' }, 'position'], [{ size: 'HUGE' }, 'size'],
  ])('%o → 422 com field %s, nada gravado', async (input, field) => {
    await expect(run(input)).rejects.toMatchObject({ code: 'OFFER_WATERMARK_INVALID_INPUT', statusCode: 422, meta: { field } });
    expect(deps.watermarks.save).not.toHaveBeenCalled();
  });

  it('operador → FORBIDDEN', async () => {
    await expect(run({ enabled: true }, OPERATOR)).rejects.toMatchObject({ code: 'FORBIDDEN', statusCode: 403 });
  });

  it('super admin grava mesmo sem papel ADMIN no tenant', async () => {
    await expect(run({ enabled: true }, { ...OPERATOR, isSuperAdmin: true })).resolves.toMatchObject({ enabled: true, canEdit: true });
  });

  it('plano desligado → 403 de plano antes de validar', async () => {
    plan = false;
    await expect(run({ opacity: 1 })).rejects.toMatchObject({ code: 'PLAN_FEATURE_UNAVAILABLE' });
  });
});

describe('SetOfferWatermarkImageUseCase', () => {
  const run = (actor = ADMIN) => new SetOfferWatermarkImageUseCase(deps).execute(actor, UPLOAD);

  it('grava o PNG normalizado, descarta o upload e devolve a URL', async () => {
    const view = await run();
    expect(deps.readFile).toHaveBeenCalledWith('/up/x.bin');
    expect(deps.logos.save).toHaveBeenCalledWith(Buffer.from('png'));
    expect(deps.uploads.discard).toHaveBeenCalledWith(UPLOAD);
    expect(deps.watermarks.save).toHaveBeenCalledWith('t1', { imageKey: NEW });
    expect(view.imageUrl).toBe(`/api/storage/media/${NEW}`);
    expect(deps.logos.remove).not.toHaveBeenCalled();
  });

  it('troca: apaga o logo anterior do storage depois de gravar', async () => {
    record = base({ imageKey: OLD });
    await run();
    expect(deps.logos.remove).toHaveBeenCalledWith(OLD);
    expect(deps.logos.remove).not.toHaveBeenCalledWith(NEW);
  });

  it('upload > 1 MiB → MEDIA_TOO_LARGE e libera o upload', async () => {
    deps.uploads.beginConsume = vi.fn(async () => ({ outcome: 'started', record: { sizeBytes: 1024 * 1024 + 1 } }) as unknown as BeginConsumeResult);
    await expect(run()).rejects.toMatchObject({ code: 'MEDIA_TOO_LARGE' });
    expect(deps.uploads.releaseConsume).toHaveBeenCalledWith(UPLOAD);
    expect(deps.readFile).not.toHaveBeenCalled();
  });

  it('logo recusado pelo processador: libera o upload, nada gravado, anterior intacto', async () => {
    record = base({ imageKey: OLD });
    deps.processor.normalize = vi.fn(async () => { throw new MediaProcessingFailedError(); });
    await expect(run()).rejects.toMatchObject({ code: 'MEDIA_PROCESSING_FAILED' });
    expect(deps.uploads.releaseConsume).toHaveBeenCalled();
    expect(deps.logos.save).not.toHaveBeenCalled();
    expect(deps.logos.remove).not.toHaveBeenCalled();
  });

  it('registro falha: apaga o logo novo', async () => {
    deps.watermarks.save = vi.fn(async () => { throw new Error('db'); });
    await expect(run()).rejects.toThrow('db');
    expect(deps.logos.remove).toHaveBeenCalledWith(NEW);
  });

  it.each([
    ['not_found', 'UPLOAD_NOT_FOUND'], ['consumed', 'UPLOAD_NOT_FOUND'], ['in_progress', 'UPLOAD_IN_PROGRESS'], ['incomplete', 'UPLOAD_INCOMPLETE'],
  ] as const)('upload %s → %s', async (outcome, code) => {
    begun = outcome;
    await expect(run()).rejects.toMatchObject({ code });
  });

  it('operador → FORBIDDEN sem consumir o upload', async () => {
    await expect(run(OPERATOR)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(deps.uploads.beginConsume).not.toHaveBeenCalled();
  });
});

describe('RemoveOfferWatermarkImageUseCase', () => {
  const run = (actor = ADMIN) => new RemoveOfferWatermarkImageUseCase(deps).execute(actor);

  it('zera imageKey e apaga do storage; texto segue', async () => {
    record = base({ imageKey: OLD, text: 'Ana' });
    const view = await run();
    expect(deps.watermarks.save).toHaveBeenCalledWith('t1', { imageKey: null });
    expect(deps.logos.remove).toHaveBeenCalledWith(OLD);
    expect(view).toMatchObject({ imageUrl: null, text: 'Ana' });
  });

  it('sem logo: nada muda', async () => {
    await run();
    expect(deps.watermarks.save).not.toHaveBeenCalled();
    expect(deps.logos.remove).not.toHaveBeenCalled();
  });

  it('operador → FORBIDDEN', async () => {
    record = base({ imageKey: OLD });
    await expect(run(OPERATOR)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(deps.logos.remove).not.toHaveBeenCalled();
  });
});
