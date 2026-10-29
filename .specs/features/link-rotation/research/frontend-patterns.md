# Padrões do painel para Rodízio de links (frontend)

Base: `app/`. Leitura apenas. Caminhos relativos a `app/src/`.

## 1. Estrutura `features/monitoring` + service

Arquivos:
- `features/monitoring/strings.ts` (314 l) — `monitoringStrings` (objeto por tela: `page` 22, `session` 37, `groups` 47, `picker` 75, `form` 105, `credentialAlerts` 177, `errors` 189, `captured` 228). Função pura `formatDuration` 13.
- `features/monitoring/components/`: BroadcastGroupsCard, CapturedOffersList, CredentialAlerts, FieldLabel, GroupPickerDialog, GroupUsageChip, MonitoredGroupsCard, MonitoringSessionSelect, MonitoringSettingsForm, OperatingWindowField, SessionSummaryCard (+ 2 testes).
- `features/monitoring/hooks/`: useCapturedOffers, useMonitoringConfig, useMonitoringSessions (+ teste).
- `features/monitoring/utils/`: apiErrors.ts (erro → frase), operatingWindow.ts, settingsDraft.ts (+ testes).

Formato i18n: NÃO há lib (sem i18next/react-intl). Regra no cabeçalho de `strings.ts`: chaves semânticas, frase com variável = função tipada, componente nunca concatena, sem nome de marca. Mesmo padrão em `features/offers/strings.ts`.

Service `services/monitoring.service.ts` (50 l):
- `import { apiClient } from './apiClient'`; tipos de `@/types/api.types`.
- `const BASE = '/automation/group-monitoring'` (l.12).
- Métodos `async` (l.16, 21, 27, 33, 39, 46): `res = await apiClient.get|put|post<ApiSuccess<T>>(url, body|{params})`; retorna `res.data.data`. Envelope `ApiSuccess<T>`.
- Erro: `apiClient` rejeita com `Error` + `status`, `code`, `field`, `meta` (ver §8).
- Comentário de doc por método (`/** ... */`) com código de erro esperado (l.26).

## 2. GroupPickerDialog.tsx (`features/monitoring/components/`, 316 l)

Props (interface l.36-52):
- `mode: 'monitored' | 'broadcast'`, `sessionId`, `initial: PickedGroup[]`, `max: number | null` (cota da sessão, null = sem limite), `excludeJids: readonly string[]`, `sessions?`, `crossSession?: boolean`, `onClose()`, `onSave(groups): Promise<void>` (lança → erro no diálogo).
- `PickedGroup` (l.21): `{ groupJid, sessionId, title, avatarUrl, keywords }`.

Lista de grupos:
- `useSessionGroups(sessionIds, search)` (l.113) — hook em `features/offers/hooks/useSessionGroups.ts`. Chama `offerService.listSessionGroups(sessionId, search)` por sessão, em paralelo (`Promise.allSettled`), debounce 300 ms na busca (l.5, 26-45). Retorna `{ items, partial, loading, failed, retry }`.
- Busca: `TextField` com ícone `Search` (l.252-258), filtro no servidor.
- Lista disponível: `List`/`ListItemButton` (l.270-298); `Tooltip` com motivo (l.278); `disabled = usedElsewhere || full` (l.273).
- `full = max !== null && selected.length >= max` (l.119). Não existe variável `limitReached`; o motivo é `t.limitReached` (l.276) = "Limite do plano atingido" (strings l.87).
- Estados: `Alert` partial (l.262), erro + `retry` (l.263-264), `Skeleton` (l.266), `t.noResults` (l.268).
- Botão salvar desabilitado se `selected.length > max` (l.308).

Alerta com link /plans (l.170-176, cópia literal):
```tsx
{error && <Alert severity="error">{error}</Alert>}
{crossLocked && (
  <Alert severity="info" action={<Button color="inherit" size="small" component={RouterLink} to="/plans">{t.crossLockedLink}</Button>}>
    {t.crossLocked}
  </Alert>
)}
{multi && <Alert severity="info">{t.crossHelp}</Alert>}
```
- `RouterLink` = `Link as RouterLink` de `react-router-dom` (l.8).
- Textos: `crossLocked` (strings l.90), `crossLockedLink: 'Ver planos'` (l.91). `crossLocked` = `crossSession` falso + 2+ sessões (l.112).
- Único alerta de upgrade com link na feature; o alerta de limite (`full`) só aparece como tooltip, sem link.

Outros pontos:
- `useMediaQuery(theme.breakpoints.down('sm'))` → `fullScreen` (l.89).
- Título via `Dialog aria-labelledby` (l.159), `IconButton` fechar com `Tooltip` (l.162-166).
- Mapeia erro com `uiErrorMessage(err, { scope: 'groups' })` (l.152).

## 3. Rota e navegação

`routes/AppRoutes.tsx` (67 l):
- Imports de páginas no topo (l.1-20): `import { MonitoringPage } from '@/pages/monitoring/MonitoringPage';` (l.19), `PlansPage` (l.20).
- Privadas dentro de `<Route element={<PrivateRoute />}><Route element={<AppLayout />}>` (l.35-36). Rota simples: `<Route path="/monitoring" element={<MonitoringPage />} />` (l.43).
- Sub-rotas de Configurações aninhadas (l.48-56).
- Super admin: `import { SuperAdminRoute } from '@/features/ai/components/SuperAdminRoute';` (l.16). Uso l.57-59:
  `<Route element={<SuperAdminRoute />}><Route path="/admin/ai" element={<AdminAiPage />} /></Route>`.
- Fallback `*` → `/dashboard` (l.64).

`app/AppLayout.tsx`:
- Imports `lucide-react` (l.11-14), `AppIcon` de `@/components` (l.15), `MODULE_ICONS` de `@/pages/modules` (l.16), `plansStrings` (l.27), `aiStrings` (l.26).
- `NAV_ITEMS` (l.49-61). Formato: `{ label: string, path: string, icon: <AppIcon icon={X} size="md" /> }`; `matchPrefix: true` opcional (Configurações l.60); item de ação `{ action: 'privacy' }` (l.59).
  Ordem atual: Dashboard (50), Chat (51), Gerador de ofertas (52), Monitoramento (53), Espelhamento (54), Gestor de membros (55), Página de ofertas (56), Planos (57), Privacidade (59), Configurações (60).
- Super admin: `NAV_ADMIN_ITEMS` (l.64-66), concatenado só se `user?.isSuperAdmin` (l.186).
- Ponto de inserção sugerido "Rodízio de links": após `Gerador de ofertas` (l.52) ou `Monitoramento` (l.53). Ícone: `lucide-react` novo, `size="md"`, importar no bloco l.11-14.
- `NAV_FUTURE` comentado (l.70-76) — sem efeito.
- Título da página no header: `NAV_ITEMS.find(...)` (l.395-397).

## 4. Privacidade

`features/privacy/privacyFlags.ts` (48 l):
- `PRIVACY_SCREENS = [ { id, label, flags: [ { id, label } ] } ] as const` (l.8-39).
- Id da flag = `<tela>.<dado>` (cabeçalho l.6). Tela = chave de agrupamento no diálogo.
- Exemplo existente: `monitoring` (l.28-38): `monitoring.sessionName`, `monitoring.groupAvatars`, `monitoring.groupNames`, `monitoring.capturedText`, `monitoring.capturedImages`.
- Derivados: `PrivacyScreenId` (l.41), `PrivacyFlag` (l.42), `ALL_PRIVACY_FLAGS` (l.44), `isPrivacyFlag` (l.46).
- Registrar nova: adicionar objeto `{ id: 'linkRotation', label: '...', flags: [...] }` antes do `] as const;` (l.39). O diálogo monta sozinho. Export público em `features/privacy/index.ts` l.4 (`PRIVACY_SCREENS`, `PrivacyFlag`) — não precisa mudar.
- Teste `privacy.test.tsx` l.23 compara contagem de flags só da tela `offers`; registrar nova tela não quebra.

Uso de `Blurred`/`useBlur` (GroupPickerDialog l.90, 194-196):
```tsx
const blurNames = useBlur('monitoring.groupNames');
...
<Blurred when={blurNames} inline radius={5}>
  <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>{g.title || monitoringStrings.groups.untitled}</Typography>
</Blurred>
```
- `useBlur(flag: PrivacyFlag): boolean` (`PrivacyContext.tsx` l.79). `Blurred` (`features/privacy/components/Blurred.tsx` l.20): props `when`, `radius` (6 default), `inline` (span), `sx`. Texto raio 5–6; imagem 10+.
- Avatar: `GroupAvatar` com `blurFlag` (`features/offers/components/GroupChip.tsx` l.21; `GroupChip` l.52 com `nameFlag`/`avatarFlag`). Usado em MonitoredGroupsCard l.34-41.

## 5. usePersistedState

`hooks/usePersistedState.ts` (l.66-70):
```ts
export function usePersistedState<T>(key: string, initial: T | (() => T), opts: PersistOptions<T> = {}): [T, Dispatch<SetStateAction<T>>, () => void]
```
- `PersistOptions<T>` (l.10-16): `scope?: 'tab' | 'browser'` (padrão `tab` = sessionStorage), `version?: number` (muda = descarta salvo), `serialize?`, `deserialize?` (Map/Set).
- `clear()` volta ao inicial e apaga o salvo; efeito pula a próxima escrita (l.74-75, 83-89).
- Prefixo `ui.` na chave (l.18).

Exemplo real `features/monitoring/components/GroupPickerDialog.tsx`:
- l.91-95: `usePersistedState<DraftGroup[]>(\`monitoring.picker.${mode}.${sessionId}\`, () => initial.map(...), { version: PICKER_DRAFT_VERSION })` (PICKER_DRAFT_VERSION = 3, l.66). Rascunho sem dado do servidor (nome/foto ficam em memória, l.98-101).
- Clear ao cancelar `close()` (l.123-126) e ao salvar (l.149).
Exemplo página `pages/monitoring/MonitoringPage.tsx`: l.39 `usePersistedState<string | null>('monitoring.sessionId', null)`; l.40 `usePersistedState<GroupPickerMode | null>('monitoring.picker', null)`. Padrão `tab` implícito.
Exemplo oferta: `pages/offers/OfferGeneratorPage.tsx` (início do componente, l.27-40) `usePersistedState('offers.wizardOpen', false)`.

## 6. Padrão de página (`pages/monitoring/MonitoringPage.tsx`, 196 l)

- Imports: `Alert, Box, Button, Skeleton, Stack, Tooltip` de `@mui/material` (l.2); `AppIcon, EmptyState, PageHeader` de `@/components` (l.5); `Plus` lucide (l.3); features `@/features/monitoring/...`; `MODULE_ICONS` (l.18).
- Header: `<PageHeader title subtitle action={...} />` (l.101-112). `action` = `Stack` com select de sessão + botão (l.104-111).
- Botão com Tooltip: l.66-71 — `<Tooltip title={...} arrow describeChild>` envolvendo `<Button variant="contained" startIcon={<AppIcon icon={Plus} size="sm" />}>`.
- Loading: `Skeleton variant="rounded"` em grid (`CARDS_GRID` l.34: `gap 2.5`, `repeat(3, minmax(0,1fr))` md+). Uso l.115.
- Erro: `Alert severity="error" action={<Button color="inherit" size="small" onClick={reload}>{t.retry}</Button>}` (l.117-119).
- Vazio: `EmptyState icon title description action` (l.121-126).
- Cards: `SectionCard` (`@/components`) com `title`, `subtitle`, `action`, `sx` (MonitoredGroupsCard l.21-26). Botão "Configurar" com Tooltip `describeChild` (l.54-58).
- Modais: `{picker === 'x' && <GroupPickerDialog .../>}` no fim do `Stack` (fim do arquivo, após l.140).

Tooltip lib: MUI `Tooltip` de `@mui/material` (usado em 55 arquivos `.tsx`). Não há lib externa de tooltip. Padrão: `arrow`, `describeChild` quando envolve botão com texto.

Componentes de `docs/padrao-ui-painel.md` no uso real:
- `Switch`: `@mui/material` direto. Ex.: `MonitoringSettingsForm.tsx` l.64 (`<Switch checked disabled inputProps={{'aria-label': title}} />`). Regra: `FormControlLabel` ou `aria-label`.
- `ToggleOption`: `@/components` (`MonitoringSettingsForm.tsx` l.5).
- `RangeSlider`: `@/components` — `OperatingWindowField.tsx` l.4, 68; `MonitoringSettingsForm.tsx` l.143. Exporta `RangeSlider`, `clampRange`, `RangeValue`.
- `CooldownBar`: `@/components` — `CapturedOffersList.tsx` l.7, 58. Usa `serverNow()` (`services/serverClock.ts`).
- `AppIcon`: `import { AppIcon } from '@/components';` (`components/AppIcon.tsx`). Tamanhos `APP_ICON_SIZES` (l.8-13): `inline` 1.25em, `sm` 16, `md` 20, `lg` 24. Lucide puro, nunca emoji.
- Componentes exportados de `components/index.ts`: PageHeader, StatCard, EmptyState, SectionCard, ConfirmDialog, CooldownBar, AppIcon, RangeSlider, ToggleOption.

## 7. Catálogo de planos

`features/plans/catalog.ts` (125 l):
- `PlanSlug = 'starter' | 'profissional' | 'business'` (l.9).
- `PlanBenefit` (l.15-23): `{ label; strong?; hint?; exclusive? }`.
- `PlanCatalogItem` (l.25-39): `slug, name, tagline, priceFrom, price, priceAnnualMonthly, recommended?, limits, benefits: PlanBenefit[], fit`.
- `limits` (l.37): `{ whatsappSessions; telegramSessions; monitoredGroups; broadcastGroups }` — tipo FECHADO: incluir "grupos por rodízio" exige alterar o tipo.
- `HINTS` (l.32-45) textos de tooltip. `HINTS.linkRotation` já existe (l.45): "Cada envio sai com o seu link de afiliado refeito, alternando entre as credenciais cadastradas."
- **Já existe benefício de rodízio**: Starter l.66 `{ label: 'Rodízio de links inteligentes', hint: HINTS.linkRotation }`. Não há linha "Rodízios de links" nem "Grupos por rodízio". Ver conflito abaixo.
- Profissional benefits l.82-99 (herda "Tudo do Starter" l.84), Business l.101-115.
- `PLAN_CATALOG` l.52. `priceFor` l.116, `savingsFor` l.121.
- Consumidor: `features/plans/components/PlanCard.tsx` l.101: `plan.benefits.map((b) => <BenefitRow key={b.label} .../>)`.

Testes:
- `features/plans/catalog.test.ts` (38 l): 3 planos/1 recomendado (l.6-10); preço "por" < "de" (l.12-14); limites crescem Starter→Business (l.16-22, só `monitoredGroups` e `broadcastGroups`); anual ≈ 20% (l.29-37). Não valida `benefits`.
- `api/src/modules/tenants/domain/planPresets.test.ts` (30 l): `CATALOG_LIMITS` (l.6-10) = `whatsappSessions, monitoredGroups, broadcastGroups, mentionAll, crossSession`; `it.each` com `toMatchObject` (l.13-22) — chaves novas não quebram, mas não são travadas; `cross_session` só Business (l.24-29).
- `api/src/modules/tenants/domain/planPresets.ts`: `PLAN_PRESETS` (l.11-39), chaves via `ENTITLEMENT_KEYS`. Sem chave de rodízio hoje.
- `api/src/modules/tenants/domain/entitlementKeys.ts` (l.7-18): sem `LINK_ROTATION`/grupos-por-rodízio. Chaves novas devem entrar aqui e em `PLAN_PRESETS` (sem literal solto).
- Para travar no teste: adicionar campo em `CATALOG_LIMITS` (api) e `limits` (app) com o mesmo número; `catalog.test.ts` não compara com API.

## 8. apiClient × erros de plano

`services/apiClient.ts`:
- Interceptor de resposta; 401 → `clearSessionAndRedirect` (l.165-167); 403 de tenant → idem (l.170-177). Não trata `PLAN_*` (apenas repassa).
- Rejeição (l.181-189): `Object.assign(new Error(message), { status, code: data.error.code, field: data.error.meta.field, meta: data.error.meta })`. `meta.limit`, `meta.key` vêm daqui. Comentário l.179-180, 186.
- Não há `PLAN_LIMIT_REACHED` / `PLAN_FEATURE_UNAVAILABLE` no `apiClient`: quem trata é a feature.

Monitoramento — `features/monitoring/utils/apiErrors.ts`:
- `monitoringErrorMessage(err, ctx)` (l.24-61). `PLAN_LIMIT_REACHED` (l.50-53): `limit = meta.limit ?? ctx.max` → `t.planLimit(limit)`. `PLAN_FEATURE_UNAVAILABLE` (l.54-55): `meta.key === 'cross_session_dispatch'` → `crossSessionUnavailable`, senão `planFeature`.
- `MonitoringUiError` (l.70) — erro já traduzido; `uiErrorMessage` (l.73-75).
- `sessionGroupCap` (l.64-67).
- Usado em `pages/monitoring/MonitoringPage.tsx` l.86, 95 (throw `MonitoringUiError` para o diálogo).

Ofertas — `features/offers/utils/offerErrors.ts`:
- `OfferErrorView` (l.6-11): `{ code, message, action: 'credentials'|'config'|'sessions'|'none', isLinkField }`.
- `toOfferError(err, fallbackLimit)` (l.28-45, aprox.): `PLAN_LIMIT_REACHED` (l.31-37): `meta.key === 'broadcast_groups'` → `t.groupLimit`; senão `t.planLimit(limit ?? fallbackLimit)`. `PLAN_FEATURE_UNAVAILABLE` + `cross_session_dispatch` (l.40-42) → `action: 'config'`.
- `pages/offers/OfferGeneratorPage.tsx`:
  - `limitReached` l.45 (`gen.usage.used >= gen.usage.limit`); desabilita form (l.140).
  - `markPlanError` l.58-60: só marca `mentionUnavailable` quando `PLAN_FEATURE_UNAVAILABLE`.
  - `errorAction` l.62-77: monta botão por `err.action` (credentials → `RouterLink` `CREDENTIALS_PATH`; config → abre wizard; sessions → `/settings/sessions`).
  - Aviso de limite: `<Alert severity="warning">{t.planLimit(gen.usage.limit)}</Alert>` (l.150).
  - Erro de página: `<Alert severity="error" onClose={gen.clearError} action={errorAction(pageError)}>{pageError.message}</Alert>` (l.151-153); `pageError` l.49.
  - Chamadas `.catch(markPlanError)` l.213, 261.

Padrão para "Rodízio de links": criar `toLinkRotationError` ou reusar `monitoringErrorMessage`-style com `PLAN_LIMIT_REACHED` (`meta.limit`) e `PLAN_FEATURE_UNAVAILABLE` (`meta.key`).

## 9. Copiar / arrastar

Copiar:
- Não existe componente `CopyButton`. Grep `CopyButton`: 0.
- `navigator.clipboard.writeText` ocorre em: `features/offers/components/OfferResultPanel.tsx` l.65 (padrão completo l.63-71: try/catch, `copied` por 2 s via `setTimeout`, Tooltip muda o texto em l.78); `features/sessions/components/SessionConnectPanel.tsx` l.54 (código de pareamento); `features/chat/components/MessageBubble.tsx` l.209.
- Sem fallback manual; falha silenciosa no catch.

Reordenar / arrastar:
- Grep `dnd`, `sortable`, `DragIndicator`, `GripVertical`, `draggable` (case-insensitive): 0 resultados. Não há drag-and-drop no painel.
- Reordenação atual = botões: `features/monitoring/components/BroadcastGroupsCard.tsx` — `move(index, delta)` l.46, `ArrowUp`/`ArrowDown` (import l.3), `IconButton` com `Tooltip` `t.moveUp`/`t.moveDown` (l.82-91), `disabled` nas pontas, salva na hora (`onChange`). Acessível por teclado; padrão a seguir.

## Conflitos / atenção

1. Catálogo já vende "Rodízio de links inteligentes" no Starter (`plans/catalog.ts` l.66) e `HINTS.linkRotation` (l.45). Sem chave em `entitlementKeys.ts` nem em `PLAN_PRESETS`. Benefício hoje é texto sem gate.
2. `GroupPickerDialog` não tem `limitReached` como variável: o flag é `full` (l.119); o alerta de upgrade com `/plans` é o de `crossLocked` (l.171-175).
3. `useSessionGroups` mora em `features/offers/hooks`, importado por monitoring (l.12). Reuso cross-feature já existe.
4. Sem lib i18n: strings em `strings.ts` por feature.
