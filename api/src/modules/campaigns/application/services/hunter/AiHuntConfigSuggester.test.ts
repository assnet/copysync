import { describe, expect, it, vi } from 'vitest';
import type { AiTextRequest } from '../../../../assistants/domain/contracts/IAiTextGenerator';
import { AppError } from '../../../../../shared/errors/AppError';
import type { HuntCapabilities } from '../../../domain/hunter/HuntProvider';
import { huntCandidate } from '../../../domain/services/hunter/huntTestFixtures';
import { HUNT_CONFIG_AI_PURPOSE } from '../../../domain/services/hunter/huntConfigPrompt';
import { AiHuntConfigSuggester } from './AiHuntConfigSuggester';

const CAPS: HuntCapabilities = {
  provider: 'SHEIN', sorts: ['RECOMMENDED'], defaultSort: 'RECOMMENDED', sourceFilters: ['keyword', 'category'],
  localFilters: ['maxPriceCents', 'minCommissionPct'], commissionModel: 'NEW_RETURNING', imageHosts: ['ltwebstatic.com'],
  productIdPattern: /^\d+$/,
};

function setup(text: string | Error) {
  const generate = vi.fn(async (_req: AiTextRequest) => {
    if (text instanceof Error) throw text;
    return { text };
  });
  const logger = { warn: vi.fn() };
  return { generate, logger, s: new AiHuntConfigSuggester({ generate }, logger) };
}
const input = {
  tenantId: 't1', capabilities: CAPS, categories: [{ categoryId: '10', name: 'Vestidos' }], intent: 'vestido barato',
  sample: { items: [huntCandidate({ title: 'SEGREDO-TITULO' })], pool: [] },
};

describe('AiHuntConfigSuggester', () => {
  it('1 chamada com purpose/tokens; devolve rascunho validado', async () => {
    const { s, generate } = setup('{"name":"Vestidos","category":"10","localFilters":{"maxPrice":50},"reasons":{"category":"Pedido"}}');
    const out = await s.suggest(input);
    expect(out?.draft).toMatchObject({ name: 'Vestidos', categoryId: '10', filters: { maxPriceCents: 5000 } });
    expect(out?.reasons).toEqual({ categoryId: 'Pedido' });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate.mock.calls[0][0]).toMatchObject({ tenantId: 't1', purpose: HUNT_CONFIG_AI_PURPOSE, maxOutputTokens: 700 });
  });

  it('saída inválida → null; log sem prompt, intenção nem resposta', async () => {
    const { s, logger } = setup('resposta SEGREDO-RESPOSTA');
    expect(await s.suggest(input)).toBeNull();
    const logged = JSON.stringify(logger.warn.mock.calls);
    expect(logged).toContain('AI_RESPONSE_INVALID');
    expect(logged).not.toMatch(/SEGREDO|vestido barato/);
  });

  it('erro inesperado → null; AppError do gerador sobe com o código', async () => {
    expect(await setup(new Error('boom SEGREDO')).s.suggest(input)).toBeNull();
    const err = new AppError('AI_DAILY_LIMIT_REACHED', 'x', 429);
    const { s, logger } = setup(err);
    await expect(s.suggest(input)).rejects.toBe(err);
    expect(logger.warn.mock.calls[0][0]).toMatchObject({ code: 'AI_DAILY_LIMIT_REACHED' });
  });
});
