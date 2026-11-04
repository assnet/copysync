# Grupos de disparo + Horário de postagem — Tasks

**Spec:** `spec.md` · **Status:** Draft · Gates (`.specs/codebase/TESTING.md`): `quick` = `pnpm test` no app tocado;
`full` = typecheck + test em api e app; `int` = `pnpm test:int` contra **Postgres descartável** (nunca `api/.env`/`.env.dev`).
Prefixo `api/src/modules/` = `m/`. Uma task = um subagente = um commit. Todas ⏳.

## Plano de execução

```
Onda 1: T1[P] T2 T8[P] T9[P] T11[P] T12[P] T15[P]
Onda 2: T3[P](T1,T2) T4[P](T1,T2) T10[P](T9) T13(T12) T16[P](T8)
Onda 3: T5[P](T2,T3) T14[P](T10,T12) T18[P](T3,T9,T12)
Onda 4: T6(T5) T17[P](T14) T19[P](T11,T18)
Onda 5: T7[P](T6) T21[P](T15,T19)
Onda 6: T20[P](T7,T14,T15) T22[P](T7,T8)
Onda 7: T23(T22) → T24 → T25
```
[P] = pode rodar junto com as outras [P] da mesma onda (arquivos disjuntos, sem banco). T2/T6/T13 usam banco descartável: um por vez.

## Grupos de disparo (BG)

### T1: Regra pura da união de grupos [P] ⏳
- **What:** `countDistinctBroadcastGroups(rows, engineOf)` → `Record<LimitChannel, number>`, chave `sessionId+groupJid`.
- **Where:** `m/campaigns/domain/services/broadcastGroupUnion.ts` (+ `.test.ts`)
- **Depends on:** — · **Reqs:** BG-01
- **Done when:** duplicata entre gerador e monitor conta 1; canais separados.
- **Tests:** unit · **Gate:** quick

### T2: Leitor da união (porta + Prisma) ⏳
- **What:** `IBroadcastGroupUsageReader.listRows(tenantId, { exceptGenerator?, exceptMonitorSessionId? })` e `listCatalog(tenantId)`;
  impl lê `offer_destinations` ⋃ `broadcast_groups` (join `chat_conversations`, sessão não apagada, `tenantId` em tudo), sem Prisma fora da infra.
- **Where:** `m/campaigns/domain/contracts/IBroadcastGroupUsageReader.ts`, `m/campaigns/infrastructure/repositories/PrismaBroadcastGroupUsageReader.ts` (+ `.int.test.ts`)
- **Depends on:** — · **Reqs:** BG-01, BG-04
- **Done when:** int cobre 2 tenants (sem vazamento) e grupo nos dois usos.
- **Tests:** int (não paralelo: banco) · **Gate:** int + quick

### T3: Limite pela união no gerador [P] ⏳
- **What:** `SaveOfferGeneratorConfigUseCase` conta `outros(monitor) ⋃ pedidos`; `GetOfferGeneratorConfigUseCase` devolve `usage` da união; envio intocado (BG-02).
- **Where:** `m/campaigns/application/use-cases/OfferGeneratorConfigUseCases.ts` (+ `.test.ts`), `m/campaigns/infrastructure/offersContainer.ts`
- **Depends on:** T1, T2 · **Reqs:** BG-01..03
- **Done when:** LITE com 5 no monitor e 1 novo no gerador → `PLAN_LIMIT_REACHED`; mesmo grupo nos dois não soma.
- **Tests:** unit · **Gate:** quick

### T4: Limite pela união no monitoramento [P] ⏳
- **What:** papel `broadcast` soma destinos do gerador ao `used`; `usage` do GET = união (regra D4).
- **Where:** `m/automation/application/use-cases/GroupMonitorConfigUseCases.ts` (+ `.test.ts`, `monitorTestFakes.ts`), `m/automation/infrastructure/automationContainer.ts`
- **Depends on:** T1, T2 · **Reqs:** BG-01, BG-03
- **Done when:** teste espelho do T3; erro de conflito/`taken` inalterado.
- **Tests:** unit · **Gate:** quick

### T5: API — listar catálogo [P] ⏳
- **What:** `ListBroadcastGroupsUseCase` + rota `GET /campaigns/broadcast-groups` (schema de resposta, presenter inline fino, auth/tenant hook).
- **Where:** `m/campaigns/application/use-cases/ListBroadcastGroupsUseCase.ts` (+ `.test.ts`), `m/campaigns/presentation/routes/broadcastGroups.routes.ts`, `api/src/app/routes.ts` (+ wiring em `offersContainer.ts`)
- **Depends on:** T2, T3 (`offersContainer.ts`) · **Reqs:** BG-04
- **Done when:** resposta `{ items:[{conversationId,sessionId,channel,title,avatarUrl,usedBy[]}], limits, usage }`; sem dado de outro tenant.
- **Tests:** unit (use case) · **Gate:** quick

### T6: API — remover de todos os usos ⏳
- **What:** `RemoveBroadcastGroupUseCase` + `DELETE /campaigns/broadcast-groups/:conversationId`; remove em transação de `offer_destinations` e `broadcast_groups` do tenant.
- **Where:** `ListBroadcastGroupsUseCase.ts` → arquivo irmão `RemoveBroadcastGroupUseCase.ts` (+ `.test.ts`), `PrismaBroadcastGroupUsageReader.ts` (método `removeEverywhere`; renomear porta para `IBroadcastGroupStore` se fizer sentido), `broadcastGroups.routes.ts`
- **Depends on:** T5 · **Reqs:** BG-05
- **Done when:** 404 para conversa de outro tenant; idempotente.
- **Tests:** unit + int do método · **Gate:** int + quick

### T7: Painel — serviço, tipos e hook [P] ⏳
- **What:** `broadcastGroups.service.ts` (Axios central), tipos em `api.types.ts`, `useBroadcastGroups` (lista, remover, recarga por id).
- **Where:** `app/src/services/broadcastGroups.service.ts`, `app/src/types/api.types.ts`, `app/src/features/broadcastGroups/hooks/useBroadcastGroups.ts` (+ `.test.ts`)
- **Depends on:** T6 · **Reqs:** BG-04, BG-05
- **Tests:** unit (hook) · **Gate:** quick

### T8: Painel — strings e flags de privacidade [P] ⏳
- **What:** `strings.ts` da feature (pt-BR, rótulos/tooltip/erros); tela `broadcastGroups` em `PRIVACY_SCREENS` (`groupNames`, `groupAvatars`, `sessionName`).
- **Where:** `app/src/features/broadcastGroups/strings.ts`, `app/src/features/privacy/privacyFlags.ts` (+ teste existente)
- **Depends on:** — · **Reqs:** BG-06
- **Tests:** unit (flags no `ALL_PRIVACY_FLAGS`) · **Gate:** quick

### T22: Painel — tabela de grupos [P] ⏳
- **What:** `BroadcastGroupsTable` (filtro canal/busca via `usePersistedState` escopo `tab`, chips `n/limite` reaproveitando `ChannelCounterChips`, uso por item, remover com confirmação, `Blurred`, `AppIcon`, Tooltip).
- **Where:** `app/src/features/broadcastGroups/components/BroadcastGroupsTable.tsx` (+ `.test.tsx` com `renderWithTheme` claro e escuro)
- **Depends on:** T7, T8 · **Reqs:** BG-06
- **Tests:** unit Testing Library · **Gate:** quick

### T23: Painel — página, rota e menu ⏳
- **What:** `BroadcastGroupsPage`; rota `/broadcast-groups`; item `broadcast-groups` em `buildNavigation` com rótulo em `navigation/strings.ts`.
- **Where:** `app/src/pages/broadcast-groups/BroadcastGroupsPage.tsx`, `app/src/routes/AppRoutes.tsx`, `app/src/features/navigation/model.ts` (+ `strings.ts`, `model.test.ts`)
- **Depends on:** T22 · **Reqs:** BG-06, BG-07
- **Done when:** agent-browser confere sistema/claro/escuro e 375 px; desfoque ligado esconde nomes.
- **Tests:** unit (modelo do menu) · **Gate:** full

### T16: Painel — dica "conta junto" nos assistentes [P] ⏳
- **What:** tooltip nos chips de grupos do gerador e do monitoramento: "o limite soma gerador e monitoramento" + link para `/broadcast-groups`.
- **Where:** `app/src/features/offers/components/config/ChannelCounterChips.tsx`, `app/src/features/monitoring/components/GroupUsageChip.tsx`, strings das duas features
- **Depends on:** T8 · **Reqs:** BG-03
- **Tests:** unit (tooltip presente) · **Gate:** quick

## Horário de postagem (PS)

### T9: Regra pura com dias da semana [P] ⏳
- **What:** `postingWindow.ts` (`weekdaysMask`, `weekdayInZone`, `isWithinPostingWindow(at,w)`, `resolveStartWithinPostingWindow` até 7 dias, madrugada = dia do início, mask 0 inválido); `operatingWindow.ts` passa a delegar (API atual preservada, mask padrão 127).
- **Where:** `m/campaigns/domain/services/postingWindow.ts` (+ `.test.ts`), `m/automation/domain/services/operatingWindow.ts` (+ testes atuais verdes)
- **Depends on:** — · **Reqs:** PS-01
- **Done when:** casos 23:59/00:00, sexta 22–02 cobre sábado 01:00, só fim de semana pula para sábado.
- **Tests:** unit · **Gate:** quick

### T12: Migration aditiva [P] ⏳
- **What:** campos do PS-02 no `schema.prisma` + `migrations/<ts>_add_posting_schedule_weekdays/migration.sql` gerada com `prisma migrate diff` contra Postgres descartável.
- **Where:** `api/prisma/schema.prisma`, `api/prisma/migrations/…/migration.sql`
- **Depends on:** — · **Reqs:** PS-02, CM-02
- **Done when:** SQL só `ADD COLUMN … DEFAULT`, sem backfill; `prisma generate` ok. **Proibido** `migrate dev`/`deploy`/`start:migrate` local.
- **Tests:** none · **Gate:** typecheck api

### T13: Claim respeita dia da semana e janela do gerador ⏳
- **What:** parâmetros `zoneWeekday`/`prevWeekday`; cláusula do monitor usa mask (hoje p/ trecho após o início, ontem p/ trecho após meia-noite); cláusula nova `origin=GENERATOR AND scheduledAt IS NULL` com `offer_generator_configs` do tenant.
- **Where:** `m/campaigns/infrastructure/repositories/PrismaOfferDispatchRepository.ts` (+ `.int.test.ts`)
- **Depends on:** T12 (regra espelha T9) · **Reqs:** PS-03
- **Done when:** int: dia fora do mask não reivindica; gerador padrão (0–1440/127) sai igual hoje; `scheduledAt` ignora janela (D3).
- **Tests:** int (não paralelo) · **Gate:** int + full

### T10: Monitoramento — contrato com dias [P] ⏳
- **What:** `weekdays: number[]` (0–6, ≥1) em schema HTTP, DTO e validação `monitorSettings`.
- **Where:** `m/automation/presentation/schemas/groupMonitoring.schema.ts`, `m/automation/application/dtos/GroupMonitorDTO.ts`, `m/automation/domain/services/monitorSettings.ts` (+ teste)
- **Depends on:** T9 · **Reqs:** PS-04
- **Tests:** unit · **Gate:** quick

### T14: Monitoramento — persistência do mask [P] ⏳
- **What:** entidade + contrato + repo leem/gravam `weekdaysMask` (mask ↔ lista no mapper).
- **Where:** `m/automation/domain/entities/GroupMonitor.ts`, `m/automation/domain/contracts/IGroupMonitorRepository.ts`, `m/automation/infrastructure/repositories/PrismaGroupMonitorRepository.ts`
- **Depends on:** T10, T12 · **Reqs:** PS-04
- **Tests:** unit no mapper se extraído; senão none · **Gate:** quick + typecheck

### T17: Monitoramento — captura e enfileiramento usam o dia [P] ⏳
- **What:** `outside_window` e `fitSlot` passam o mask.
- **Where:** `m/automation/application/use-cases/RegisterCapturedMessageUseCase.ts`, `m/automation/application/use-cases/ProcessPendingCapturedOffersUseCase.ts` (+ testes)
- **Depends on:** T14 · **Reqs:** PS-04
- **Done when:** captura no domingo com mask seg–sex vai para segunda na abertura; validade continua contando da captura.
- **Tests:** unit · **Gate:** quick

### T11: Extrair `fitSlots` para o domínio [P] ⏳
- **What:** mover a função local de `EnqueueOfferUseCase` para `domain/services` sem mudar comportamento.
- **Where:** `m/campaigns/domain/services/fitSlots.ts` (+ `.test.ts`), `m/campaigns/application/use-cases/EnqueueOfferUseCase.ts`
- **Depends on:** — · **Reqs:** PS-05
- **Tests:** unit · **Gate:** quick

### T18: Gerador — configuração do horário [P] ⏳
- **What:** `windowStartMinute/EndMinute/weekdays` no save/get (validação via `postingWindow`), schema HTTP e repo.
- **Where:** `m/campaigns/application/use-cases/OfferGeneratorConfigUseCases.ts` (+ teste), `m/campaigns/presentation/schemas/offer.schema.ts`, `m/campaigns/infrastructure/repositories/PrismaOfferGeneratorConfigRepository.ts` (+ `IOfferGeneratorConfigRepository.ts`)
- **Depends on:** T3 (mesmo arquivo), T9, T12 · **Reqs:** PS-05
- **Tests:** unit · **Gate:** quick

### T19: Gerador — disparo encaixa na janela [P] ⏳
- **What:** sem `scheduledAt`, `SendOfferUseCase` e retomada (`OfferSendControlUseCases`) aplicam `fitSlots` com a janela do gerador.
- **Where:** `m/campaigns/application/use-cases/SendOfferUseCase.ts`, `m/campaigns/application/use-cases/OfferSendControlUseCases.ts` (+ testes)
- **Depends on:** T11, T18 · **Reqs:** PS-05
- **Done when:** disparo às 23:00 com janela 08–22 prevê 08:00 do dia seguinte; padrão = hoje.
- **Tests:** unit · **Gate:** quick

### T15: Painel — `PostingWindowField` compartilhado [P] ⏳
- **What:** evolui `OperatingWindowField` (slider existente) + chips de dias (`ToggleButtonGroup`), Tooltip, strings próprias, temas.
- **Where:** `app/src/components/PostingWindowField.tsx` (+ `.test.tsx` claro/escuro), `app/src/components/postingWindowStrings.ts`, `app/src/features/monitoring/utils/operatingWindow.ts` (mask helpers + teste)
- **Depends on:** — · **Reqs:** PS-06
- **Tests:** unit Testing Library · **Gate:** quick

### T20: Painel — monitoramento usa o campo novo [P] ⏳
- **What:** `MonitoringSettingsForm` troca `OperatingWindowField` por `PostingWindowField`; `settingsDraft` (persistido) e tipos com `weekdays`; apagar o campo antigo se ficar sem uso.
- **Where:** `app/src/features/monitoring/components/MonitoringSettingsForm.tsx`, `app/src/features/monitoring/utils/settingsDraft.ts`, `app/src/types/api.types.ts` (+ testes)
- **Depends on:** T7 (`api.types.ts`), T14, T15 · **Reqs:** PS-06
- **Tests:** unit · **Gate:** quick

### T21: Painel — passo "Horário" no assistente do gerador [P] ⏳
- **What:** `ConfigScheduleStep` no `OfferConfigWizard` (passo e escolhas em `usePersistedState`, limpo ao concluir); `useOfferConfig` envia os campos.
- **Where:** `app/src/features/offers/components/config/ConfigScheduleStep.tsx` (+ teste), `OfferConfigWizard.tsx`, `app/src/features/offers/hooks/useOfferConfig.ts` (+ `offers/strings.ts`)
- **Depends on:** T15, T19 · **Reqs:** PS-06
- **Done when:** agent-browser nos 3 temas + 375 px.
- **Tests:** unit · **Gate:** full

## Fechamento

### T24: Documentação ⏳
- **What:** `docs/grupos-de-disparo-e-horario.md` (o que fazer/não fazer: união, sem tabela de catálogo, mask, D3); linha no AGENTS.md; roadmap itens 5/6 ✅; `fila-de-envio.md` §2.6; `monitoramento-grupos.md` §2.2; `gerador-de-ofertas.md`.
- **Where:** os docs citados
- **Depends on:** T13, T17, T19, T21, T23 · **Reqs:** CM-01 · **Gate:** —

### T25: Versão e CHANGELOG ⏳
- **What:** minor em `api/package.json` e `app/package.json` (+ manifest se houver); seção `[Unreleased]` por módulo; breaking: nenhum; migration: sim.
- **Where:** `api/package.json`, `app/package.json`, `api/CHANGELOG.md`
- **Depends on:** T24 · **Reqs:** CM-01 · **Gate:** full + smoke (sessão real, LITE)

## Validação

| Task | Deps no diagrama = campo? | Testes conforme matriz |
| --- | --- | --- |
| T1, T9, T11, T15 | ✅ | unit (puras/componente) ✅ |
| T2, T6, T13 | ✅ | int (dívida do TESTING: Postgres descartável) ✅, sem [P] |
| T3, T4, T5, T10, T17, T18, T19 | ✅ | unit use case ✅ |
| T12, T14 | ✅ | none (schema/repo) ✅ |
| T7, T8, T16, T20, T21, T22, T23 | ✅ | unit app ✅; páginas sem teste + agent-browser |

