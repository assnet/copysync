// Só testes: fixtures do contrato (`contracts/feature-usage/`) lidas por caminho de arquivo (`?raw`), sem import
// entre pacotes. O painel não tem `@types/node`, então o `fs` do Node não tipa aqui; o `?raw` do Vite lê o mesmo
// arquivo como texto. Nenhum código de produção importa este arquivo.
import catalogRaw from '../../../../contracts/feature-usage/catalog.json?raw';
import summaryRaw from '../../../../contracts/feature-usage/summary.response.json?raw';
import detailRaw from '../../../../contracts/feature-usage/feature-detail.response.json?raw';
import summaryDailyRaw from '../../../../contracts/feature-usage/summary.daily.response.json?raw';
import detailDailyRaw from '../../../../contracts/feature-usage/feature-detail.daily.response.json?raw';
import screensRaw from '../../../../contracts/feature-usage/screens.response.json?raw';
import type { UsageFeatureDetail, UsageScreensResponse, UsageSummary } from './types';

export const summaryFixtureRaw: string = summaryRaw;
export const catalogFixture = JSON.parse(catalogRaw) as { featureKeys: string[]; coverageReasonCodes: string[]; screenKeys: string[] };

/** Cópia nova a cada chamada: um teste não altera o dado do outro. */
export const summaryFixture = (): UsageSummary => JSON.parse(summaryRaw) as UsageSummary;
export const detailFixture = (): UsageFeatureDetail => JSON.parse(detailRaw) as UsageFeatureDetail;
/** Os mesmos exemplos lidos do agregado diário (`source: "daily"`, `freshAt` do último tick do job). */
export const summaryDailyFixture = (): UsageSummary => JSON.parse(summaryDailyRaw) as UsageSummary;
export const detailDailyFixture = (): UsageFeatureDetail => JSON.parse(detailDailyRaw) as UsageFeatureDetail;
export const screensFixture = (): UsageScreensResponse => JSON.parse(screensRaw) as UsageScreensResponse;
