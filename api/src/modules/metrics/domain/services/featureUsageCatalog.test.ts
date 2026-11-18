import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FEATURE_USAGE_CATALOG,
  FEATURE_USAGE_COVERAGE_REASONS,
  type FeatureUsageDefinition,
  featuresFor,
  findFeature,
  sourceOn,
} from './featureUsageCatalog';

const contract = JSON.parse(
  readFileSync(resolve(__dirname, '../../../../../../contracts/feature-usage/catalog.json'), 'utf8'),
) as { featureKeys: string[]; coverageReasonCodes: string[] };

const keys = (list: readonly FeatureUsageDefinition[]) => list.map((f) => f.key);

describe('catálogo de recursos medidos', () => {
  it('tem as mesmas chaves e os mesmos códigos de motivo do contrato compartilhado', () => {
    expect([...keys(FEATURE_USAGE_CATALOG)].sort()).toEqual([...contract.featureKeys].sort());
    expect([...FEATURE_USAGE_COVERAGE_REASONS].sort()).toEqual([...contract.coverageReasonCodes].sort());
    const used = new Set(FEATURE_USAGE_CATALOG.flatMap((f) => f.possibleCoverageReasons));
    for (const r of used) expect(contract.coverageReasonCodes).toContain(r);
  });

  it('tem 17 chaves únicas em snake_case e sem a marca', () => {
    const list = keys(FEATURE_USAGE_CATALOG);
    expect(list).toHaveLength(17);
    expect(new Set(list).size).toBe(17);
    for (const k of list) expect(k).toMatch(/^[a-z]+(_[a-z]+)*$/);
    const text = JSON.stringify(FEATURE_USAGE_CATALOG).toLowerCase();
    expect(text).not.toMatch(/copysync|waioprime/);
  });

  it('mantém o mapa recurso → motivos possíveis', () => {
    const map = Object.fromEntries(FEATURE_USAGE_CATALOG.map((f) => [f.key, [...f.possibleCoverageReasons]]));
    expect(map).toEqual({
      offer_generator: [],
      group_monitoring: [],
      offer_hunter: [],
      offer_dispatch: ['MIXED_TRIGGERS'],
      ai_rewrite: ['MIXED_TRIGGERS'],
      link_rotation: ['EXISTING_ONLY'],
      link_rotation_click: ['EXISTING_ONLY', 'RETENTION'],
      storefront: ['EXISTING_ONLY'],
      offer_story: ['AI_HEADLINE_ONLY', 'DROPPED'],
      affiliate_credentials: ['MIXED_EVENTS'],
      extension_sync: ['TOKEN_CHANGE_ONLY'],
      whatsapp_session: [],
      telegram_session: [],
      saver_extraction: [],
      saver_export: [],
      panel_login: ['RETENTION'],
      chat_send: ['DROPPED'],
    });
  });

  it('dá tipo fixo automático ao reescrita por IA e ao envio, e dois tipos ao Caçador', () => {
    expect(findFeature('ai_rewrite')?.kinds).toEqual(['AUTOMATIC']);
    expect(findFeature('offer_dispatch')?.kinds).toEqual(['AUTOMATIC']);
    expect(findFeature('offer_hunter')?.kinds).toEqual(['ACTION', 'AUTOMATIC']);
  });

  it('guarda a retenção das fontes podadas', () => {
    expect(findFeature('panel_login')?.retentionDays).toBe(30);
    expect(findFeature('link_rotation_click')?.retentionDays).toBe(90);
    const others = FEATURE_USAGE_CATALOG.filter((f) => !['panel_login', 'link_rotation_click'].includes(f.key));
    for (const f of others) expect(f.retentionDays).toBeUndefined();
  });

  it('põe só os recursos do Saver na família de planos do Saver', () => {
    const saver = FEATURE_USAGE_CATALOG.filter((f) => f.planFamily === 'SAVER');
    expect(keys(saver).sort()).toEqual(['saver_export', 'saver_extraction']);
    for (const f of saver) expect(f.product).toBe('SAVER');
  });

  it('início do contador coerente com a fonte: RECORDED = FIRST_WRITE, LIVE só CUTOVER; nunca data fixa', () => {
    for (const f of FEATURE_USAGE_CATALOG) {
      if (f.source === 'RECORDED') expect(f.recordedFrom, f.key).toBe('FIRST_WRITE');
      else expect([undefined, 'CUTOVER'], f.key).toContain(f.recordedFrom);
    }
    // P2: só o Story ganha corte (fonte viva antes dele) e o chat nasce só do contador
    const withCut = FEATURE_USAGE_CATALOG.filter((f) => f.recordedFrom !== undefined).map((f) => [f.key, f.source, f.phase]);
    expect(withCut).toEqual([
      ['offer_story', 'LIVE', 1],
      ['chat_send', 'RECORDED', 2],
    ]);
    expect(FEATURE_USAGE_CATALOG.filter((f) => f.key !== 'chat_send').every((f) => f.phase === 1)).toBe(true);
  });

  it('devolve undefined para chave fora do catálogo', () => {
    expect(findFeature('nao_existe')).toBeUndefined();
  });

  it('filtra por tipo cruzando os tipos do recurso', () => {
    const action = keys(featuresFor({ kinds: ['ACTION'] }));
    expect(action).toContain('offer_hunter');
    expect(action).not.toContain('ai_rewrite');
    expect(action).not.toContain('offer_dispatch');
    expect(action).not.toContain('panel_login');

    const standard = keys(featuresFor({ kinds: ['ACTION', 'AUTOMATIC'] }));
    expect(standard).not.toContain('panel_login');
    expect(standard).not.toContain('link_rotation_click');
    expect(standard).toHaveLength(15);

    expect(keys(featuresFor({ kinds: ['ACCESS'] }))).toEqual(['panel_login']);
    expect(keys(featuresFor({ kinds: ['AUDIENCE'] }))).toEqual(['link_rotation_click']);
    expect(featuresFor({})).toHaveLength(17);
    expect(featuresFor({ kinds: [] })).toHaveLength(17);
  });

  it('filtra por produto e combina com o tipo', () => {
    expect(keys(featuresFor({ product: 'SAVER' })).sort()).toEqual(['saver_export', 'saver_extraction']);
    expect(keys(featuresFor({ product: 'SESSION' })).sort()).toEqual(['telegram_session', 'whatsapp_session']);
    expect(keys(featuresFor({ product: 'AFFILIATES', kinds: ['AUTOMATIC'] })).sort()).toEqual([
      'ai_rewrite',
      'group_monitoring',
      'offer_dispatch',
      'offer_hunter',
    ]);
    expect(featuresFor({ product: 'ACCESS', kinds: ['ACTION'] })).toEqual([]);
    expect(keys(featuresFor({ product: 'CHAT' }))).toEqual(['chat_send']);
  });

  it('escolhe a fonte pelo corte gravado', () => {
    const story = findFeature('offer_story')!;
    // Sem corte gravado: o Story é inteiro da fonte viva
    expect(sourceOn(story, '2030-01-01')).toBe('LIVE');
    const cut = { offer_story: '2026-11-19' };
    expect(sourceOn(story, '2026-11-18', cut)).toBe('LIVE');
    expect(sourceOn(story, '2026-11-19', cut)).toBe('RECORDED');
    expect(sourceOn(story, '2027-01-10', cut)).toBe('RECORDED');
    // Só do contador: sempre RECORDED, com ou sem corte
    expect(sourceOn(findFeature('chat_send')!, '2020-01-01')).toBe('RECORDED');
    expect(sourceOn(findFeature('chat_send')!, '2020-01-01', { chat_send: '2030-01-01' })).toBe('RECORDED');
    const base: FeatureUsageDefinition = { ...story, recordedFrom: undefined };
    expect(sourceOn(base, '2026-11-30', cut)).toBe('LIVE');
  });

  it('não depende de Prisma nem de Fastify', () => {
    const src = readFileSync(resolve(__dirname, 'featureUsageCatalog.ts'), 'utf8');
    expect(src).not.toMatch(/@prisma|fastify/i);
  });
});
