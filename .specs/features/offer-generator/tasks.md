# Gerador de ofertas — Tasks

**Design**: `design.md` · Gate padrão: `pnpm exec tsc --noEmit` + `pnpm exec vitest run <arquivos>` na pasta tocada.

| ID | O quê | Onde | Depende | Reqs | Testes | [P] |
| --- | --- | --- | --- | --- | --- | --- |
| T1 | Funções puras: `detectMarketplace`, `parseProductRef`, `buildAffiliateUrl`, `renderOfferText`, `scheduleDispatches`, `startOfDayInZone` + enums | `api/src/modules/campaigns/domain/` | — | OFFER-01,03,04,06,08,09 | unit (casos da spec) | P |
| T2 | Schema Prisma + migration `create_offers_and_dispatches` (só criar; **não** aplicar em produção) + erros `OfferErrors.ts`/`PlanErrors.ts` | `api/prisma/`, `api/src/shared/errors/internal/` | — | OFFER-05,08,09 | tsc | P |
| T3 | `ShopeeAffiliateClient`, `HttpShortLinkExpander`, `HttpOfferImageFetcher` | `campaigns/infrastructure/http/` | T1 | OFFER-01,02 | unit com `fetch` mockado (assinatura, mapeamento de erro, allowlist por salto) | P |
| T4 | Contratos + repos Prisma + mappers + `PrismaEntitlementReader` | `campaigns/domain/contracts`, `campaigns/infrastructure/` | T2 | OFFER-05,07,08,09 | tsc | |
| T5 | `SendStoredMediaMessageUseCase` no chat + `isGroup` em `GET /chat/conversations` | `chat/application`, `chat/presentation` | — | OFFER-08 | unit (fakes do chat) | P |
| T6 | Use cases: Generate, Update, Destinations, Send, ProcessDue, Usage | `campaigns/application/` | T1,T4 | OFFER-02..09 | unit com fakes | |
| T7 | Adapter `ChatOfferMessageSender`, `OfferDispatchWorker` (flag `OFFER_DISPATCH_WORKER_ENABLED` em `env.ts`, start/stop em `server.ts`), rotas + schemas + presenter, registro em `routes.ts` | `campaigns/infrastructure`, `campaigns/presentation`, `app/` da api | T3,T5,T6 | OFFER-01..09 | tsc + teste de rota (inject) | |
| T8 | Painel: serviço, tipos, strings, página, componentes, rota, menu | `app/src/` | T7 (contrato) | OFFER-10 | `tsc --noEmit` + verificação no browser | |
| T9 | Doc `docs/gerador-de-ofertas.md`, AGENTS.md (link), roadmap status, CHANGELOG `[Unreleased]`, versão 0.21.0 em `api/` e `app/` | docs | T7,T8 | — | — | |
| T10 | Smoke local (banco local, AppID Shopee real se houver) + revisão | — | T9 | todos | manual | |

P2 (OFFER-11..13) fica para depois do MVP.
