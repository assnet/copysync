/**
 * Catálogo fechado dos recursos medidos em "Uso dos recursos" (docs: .specs/features/usage-metrics).
 * Rótulo e texto ficam no painel (D10): aqui só chave, classificação e regras de fonte. Puro.
 * Contrato: `contracts/feature-usage/catalog.json` (o teste compara as chaves e os códigos).
 */

/** Produto dono do recurso (filtro "Produto"). `SESSION` = sessão do tenant; `ACCESS` = entrada no painel. */
export type FeatureUsageProduct = 'AFFILIATES' | 'CHAT' | 'SAVER' | 'SESSION' | 'ACCESS';

/** Tipo do evento (D11): o tipo vem da linha, o catálogo lista os tipos que o recurso pode ter. */
export type FeatureUsageKind = 'ACTION' | 'AUTOMATIC' | 'AUDIENCE' | 'ACCESS';

/** Família de planos usada no recorte por plano (`design.md` §4.2). */
export type FeatureUsagePlanFamily = 'AFFILIATES' | 'SAVER';

/** `LIVE` = lida sob demanda das tabelas do produto; `RECORDED` = contador/agregado próprio (P2). */
export type FeatureUsageSource = 'LIVE' | 'RECORDED';

/** Início do contador de um recurso (ver `FeatureUsageDefinition.recordedFrom`). */
export type FeatureUsageCounterStart = 'CUTOVER' | 'FIRST_WRITE';

/** Cortes gravados pelo contador: chave do recurso → primeiro dia (Brasília) do contador. Ausente = sem corte. */
export type FeatureUsageCutovers = Readonly<Record<string, string>>;

/** Motivo de cobertura parcial; o texto é do painel. */
export type FeatureUsageCoverageReason =
  | 'EXISTING_ONLY'
  | 'RETENTION'
  | 'AI_HEADLINE_ONLY'
  | 'MIXED_EVENTS'
  | 'MIXED_TRIGGERS'
  | 'TOKEN_CHANGE_ONLY';

export const FEATURE_USAGE_COVERAGE_REASONS: readonly FeatureUsageCoverageReason[] = [
  'EXISTING_ONLY',
  'RETENTION',
  'AI_HEADLINE_ONLY',
  'MIXED_EVENTS',
  'MIXED_TRIGGERS',
  'TOKEN_CHANGE_ONLY',
];

export const FEATURE_USAGE_KINDS: readonly FeatureUsageKind[] = ['ACTION', 'AUTOMATIC', 'AUDIENCE', 'ACCESS'];

export const FEATURE_USAGE_PRODUCTS: readonly FeatureUsageProduct[] = ['AFFILIATES', 'CHAT', 'SAVER', 'SESSION', 'ACCESS'];

export type FeatureUsageKey =
  | 'offer_generator'
  | 'group_monitoring'
  | 'offer_hunter'
  | 'offer_dispatch'
  | 'ai_rewrite'
  | 'link_rotation'
  | 'link_rotation_click'
  | 'storefront'
  | 'offer_story'
  | 'affiliate_credentials'
  | 'extension_sync'
  | 'whatsapp_session'
  | 'telegram_session'
  | 'saver_extraction'
  | 'saver_export'
  | 'panel_login'
  | 'chat_send';

export interface FeatureUsageDefinition {
  key: FeatureUsageKey;
  product: FeatureUsageProduct;
  planFamily: FeatureUsagePlanFamily;
  /** Tipos que o recurso pode ter (um ou mais). */
  kinds: readonly FeatureUsageKind[];
  source: FeatureUsageSource;
  /**
   * Onde o contador começa (nunca uma data fixa no código). `CUTOVER`: recurso com fonte viva anterior; o contador
   * grava o corte (dia seguinte, em Brasília, à sua primeira escrita) uma única vez em `platform_settings` e só conta
   * dali em diante; antes do corte, e sem corte gravado, a fonte é a viva. `FIRST_WRITE`: recurso sem fonte anterior
   * (`RECORDED`); conta desde a primeira escrita e o primeiro dado é o `MIN(day)` do agregado. Obrigatório em todo
   * `RECORDED` (`FIRST_WRITE`); em `LIVE` só `CUTOVER`.
   */
  recordedFrom?: FeatureUsageCounterStart;
  /** Motivos que **podem** valer; os do período saem do agregador. Vazia = sempre total. */
  possibleCoverageReasons: readonly FeatureUsageCoverageReason[];
  /** Retenção da fonte em dias (a tabela é podada). */
  retentionDays?: number;
  phase: 1 | 2 | 3;
}

type Def = Omit<FeatureUsageDefinition, 'source' | 'phase' | 'possibleCoverageReasons'> &
  Partial<Pick<FeatureUsageDefinition, 'possibleCoverageReasons'>>;

/** Recurso da P1, lido sob demanda. */
function live(def: Def): FeatureUsageDefinition {
  return { possibleCoverageReasons: [], ...def, source: 'LIVE', phase: 1 };
}

/** Recurso só do contador (P2): sem fonte anterior, conta desde a primeira escrita. */
function recorded(def: Omit<Def, 'recordedFrom'>): FeatureUsageDefinition {
  return { possibleCoverageReasons: [], ...def, source: 'RECORDED', recordedFrom: 'FIRST_WRITE', phase: 2 };
}

export const FEATURE_USAGE_CATALOG: readonly FeatureUsageDefinition[] = [
  live({ key: 'offer_generator', product: 'AFFILIATES', planFamily: 'AFFILIATES', kinds: ['ACTION'] }),
  live({ key: 'group_monitoring', product: 'AFFILIATES', planFamily: 'AFFILIATES', kinds: ['AUTOMATIC'] }),
  live({ key: 'offer_hunter', product: 'AFFILIATES', planFamily: 'AFFILIATES', kinds: ['ACTION', 'AUTOMATIC'] }),
  // D11: a fonte não separa o disparo manual; tipo fixo automático.
  live({ key: 'offer_dispatch', product: 'AFFILIATES', planFamily: 'AFFILIATES', kinds: ['AUTOMATIC'], possibleCoverageReasons: ['MIXED_TRIGGERS'] }),
  live({ key: 'ai_rewrite', product: 'AFFILIATES', planFamily: 'AFFILIATES', kinds: ['AUTOMATIC'], possibleCoverageReasons: ['MIXED_TRIGGERS'] }),
  live({ key: 'link_rotation', product: 'AFFILIATES', planFamily: 'AFFILIATES', kinds: ['ACTION'], possibleCoverageReasons: ['EXISTING_ONLY'] }),
  live({
    key: 'link_rotation_click',
    product: 'AFFILIATES',
    planFamily: 'AFFILIATES',
    kinds: ['AUDIENCE'],
    possibleCoverageReasons: ['EXISTING_ONLY', 'RETENTION'],
    retentionDays: 90,
  }),
  live({ key: 'storefront', product: 'AFFILIATES', planFamily: 'AFFILIATES', kinds: ['ACTION'], possibleCoverageReasons: ['EXISTING_ONLY'] }),
  // `LIVE` com corte gravado: antes do corte o título da IA (`ai_usage_logs`), a partir dele o contador.
  live({
    key: 'offer_story',
    product: 'AFFILIATES',
    planFamily: 'AFFILIATES',
    kinds: ['ACTION'],
    possibleCoverageReasons: ['AI_HEADLINE_ONLY'],
    recordedFrom: 'CUTOVER',
  }),
  live({ key: 'affiliate_credentials', product: 'AFFILIATES', planFamily: 'AFFILIATES', kinds: ['ACTION'], possibleCoverageReasons: ['MIXED_EVENTS'] }),
  live({ key: 'extension_sync', product: 'AFFILIATES', planFamily: 'AFFILIATES', kinds: ['ACTION'], possibleCoverageReasons: ['TOKEN_CHANGE_ONLY'] }),
  live({ key: 'whatsapp_session', product: 'SESSION', planFamily: 'AFFILIATES', kinds: ['ACTION'] }),
  live({ key: 'telegram_session', product: 'SESSION', planFamily: 'AFFILIATES', kinds: ['ACTION'] }),
  live({ key: 'saver_extraction', product: 'SAVER', planFamily: 'SAVER', kinds: ['ACTION'] }),
  live({ key: 'saver_export', product: 'SAVER', planFamily: 'SAVER', kinds: ['ACTION'] }),
  live({ key: 'panel_login', product: 'ACCESS', planFamily: 'AFFILIATES', kinds: ['ACCESS'], possibleCoverageReasons: ['RETENTION'], retentionDays: 30 }),
  // Só envio feito no painel (`origin = PANEL`); oferta automática fica em `offer_dispatch`.
  recorded({ key: 'chat_send', product: 'CHAT', planFamily: 'AFFILIATES', kinds: ['ACTION'] }),
];

export function findFeature(
  key: string,
  catalog: readonly FeatureUsageDefinition[] = FEATURE_USAGE_CATALOG,
): FeatureUsageDefinition | undefined {
  return catalog.find((f) => f.key === key);
}

/** Recursos do produto (opcional) cujos `kinds` cruzam o filtro (opcional; vazio/ausente = todos). */
export function featuresFor(
  filter: { product?: FeatureUsageProduct; kinds?: readonly FeatureUsageKind[] },
  catalog: readonly FeatureUsageDefinition[] = FEATURE_USAGE_CATALOG,
): FeatureUsageDefinition[] {
  const kinds = filter.kinds && filter.kinds.length > 0 ? filter.kinds : null;
  return catalog.filter(
    (f) => (!filter.product || f.product === filter.product) && (!kinds || f.kinds.some((k) => kinds.includes(k))),
  );
}

/**
 * Fonte do recurso no dia `YYYY-MM-DD` (Brasília). `CUTOVER`: `LIVE` antes do corte gravado e `RECORDED` a partir
 * dele; sem corte gravado, `LIVE` em todo dia. Sem `CUTOVER`, a fonte do catálogo.
 */
export function sourceOn(feature: FeatureUsageDefinition, day: string, cutovers: FeatureUsageCutovers = {}): FeatureUsageSource {
  if (feature.recordedFrom !== 'CUTOVER') return feature.source;
  const cut = cutovers[feature.key];
  return cut !== undefined && day >= cut ? 'RECORDED' : 'LIVE';
}

/** O contador grava este recurso (algum dia): `RECORDED` ou `LIVE` com corte. */
export function isCounted(feature: FeatureUsageDefinition): boolean {
  return feature.recordedFrom !== undefined;
}
