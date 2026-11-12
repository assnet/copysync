import { useMemo, useState, type ReactNode } from 'react';
import {
  Accordion, AccordionDetails, AccordionSummary, Alert, Box, Button, Chip, CircularProgress, Grid, IconButton, InputAdornment,
  MenuItem, Snackbar, Stack, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography,
} from '@mui/material';
import { ChevronDown, Plus, Trash2 } from 'lucide-react';
import { AppIcon, SectionCard, ServiceUpdatingState, ToggleOption } from '@/components';
import { aiProviderName } from '@/features/ai/aiProviders';
import { usePersistedState } from '@/hooks/usePersistedState';
import type { AiProviderKind } from '@/types/api.types';
import { INFRA_COST_LIMITS, diffSettings, draftToSettings, formatUsd, parseDraftNumber, validateSettingsDraft } from '../rules';
import { infraCostsStrings as S } from '../strings';
import type {
  InfraCostBilling, InfraCostCategory, InfraCostSettingsDraft, InfraFxClosingMethod, InfraRenderKey, InfraRenderResourceType,
} from '../types';
import { useCostSettings } from '../useCostSettings';
import { HelpTip } from '@/features/opsMetrics/components/HelpTip';
import { PricesConfirmDialog } from './PricesConfirmDialog';

const p = S.prices;
const f = p.items.fields;

const CATEGORIES = Object.keys(S.category) as InfraCostCategory[];
const BILLINGS = Object.keys(S.billing) as InfraCostBilling[];
const RENDER_KEYS = Object.keys(S.renderKey) as InfraRenderKey[];
const RESOURCE_TYPES = Object.keys(S.resourceType) as InfraRenderResourceType[];
const CLOSING_METHODS = Object.keys(S.closingMethod) as InfraFxClosingMethod[];
const AI_KINDS: AiProviderKind[] = ['ANTHROPIC', 'OPENAI', 'GEMINI', 'XAI', 'DEEPSEEK', 'GROQ', 'MISTRAL', 'OPENROUTER', 'OPENAI_COMPATIBLE'];

/** Itens abertos na aba (índice), por aba do navegador. */
export const COST_PRICES_OPEN_ITEMS_KEY = 'costs.prices.openItems';

type Draft = InfraCostSettingsDraft;
type DraftItem = Draft['items'][number];

const asText = (v: number | string | null | undefined) => (v === null || v === undefined ? '' : String(v));
const today = () => new Date().toISOString().slice(0, 10);

function newItem(): DraftItem {
  return {
    key: '', label: '', category: 'other', billing: 'fixed', monthlyUsd: '', quantity: 1, storage: null,
    renderKey: null, planLabel: null, allocation: 'shared', note: null,
  };
}

function countErrors(errors: Record<string, string>, prefix: string): number {
  return Object.keys(errors).filter((k) => k === prefix || k.startsWith(`${prefix}.`) || k.startsWith(`${prefix}[`)).length;
}

/** Aba Preços (COST-08): edição da configuração, rascunho persistido, confirmação com diff. */
export default function PricesTab() {
  const c = useCostSettings();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [openItems, setOpenItems] = usePersistedState<number[]>(COST_PRICES_OPEN_ITEMS_KEY, [], { scope: 'tab' });

  const errors = useMemo(
    () => (c.values ? { ...validateSettingsDraft(c.values), ...c.serverErrors } : {}),
    [c.values, c.serverErrors],
  );
  const valid = Object.keys(errors).length === 0;
  const next = c.values && valid ? draftToSettings(c.values) : null;
  const changes = next && c.view ? diffSettings(c.view.settings, next) : [];

  if (c.loadUnavailable && !c.view) return <ServiceUpdatingState onRetry={() => void c.reload()} />;
  if (c.loading && !c.view) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <CircularProgress aria-label={p.loading} />
      </Box>
    );
  }
  if (c.loadError || !c.view || !c.values) {
    return (
      <Alert severity="error" action={<Button color="inherit" size="small" onClick={() => void c.reload()}>{p.actions.retry}</Button>}>
        {c.loadError ?? S.errors.loadFailed}
      </Alert>
    );
  }

  const { view, values } = c;

  /** Campo de texto/número ligado a um caminho do rascunho, com o erro do caminho. */
  const field = (
    path: string,
    label: string,
    value: number | string | null | undefined,
    opts: { hint?: string; numeric?: 'decimal' | 'numeric'; nullable?: boolean; prefix?: string; type?: string; help?: string } = {},
  ) => {
    const err = errors[path];
    return (
      <TextField
        label={label}
        value={asText(value)}
        type={opts.type}
        onChange={(e) => {
          const raw = e.target.value;
          c.change(path, opts.nullable && raw.trim() === '' ? null : raw);
        }}
        error={Boolean(err)}
        helperText={err ?? opts.hint}
        fullWidth
        size="small"
        InputLabelProps={opts.type === 'date' ? { shrink: true } : undefined}
        inputProps={opts.numeric ? { inputMode: opts.numeric } : undefined}
        InputProps={{
          startAdornment: opts.prefix ? <InputAdornment position="start">{opts.prefix}</InputAdornment> : undefined,
          endAdornment: opts.help ? <InputAdornment position="end"><HelpTip label={label} text={opts.help} /></InputAdornment> : undefined,
        }}
      />
    );
  };

  const select = <T extends string>(path: string, label: string, value: T | null, options: readonly T[], labelOf: (v: T) => string, noneLabel?: string) => {
    const err = errors[path];
    return (
      <TextField
        select
        label={label}
        value={value ?? ''}
        onChange={(e) => c.change(path, e.target.value === '' ? null : e.target.value)}
        error={Boolean(err)}
        helperText={err}
        fullWidth
        size="small"
      >
        {noneLabel !== undefined && <MenuItem value="">{noneLabel}</MenuItem>}
        {options.map((o) => <MenuItem key={o} value={o}>{labelOf(o)}</MenuItem>)}
      </TextField>
    );
  };

  const removeButton = (name: string, onClick: () => void) => (
    <Tooltip title={p.actions.remove}>
      <IconButton aria-label={p.actions.removeAria(name)} onClick={onClick} sx={{ color: 'text.secondary' }}>
        <AppIcon icon={Trash2} size="sm" />
      </IconButton>
    </Tooltip>
  );

  const addButton = (label: string, onClick: () => void, disabled: boolean) => (
    <Button startIcon={<AppIcon icon={Plus} size="sm" />} onClick={onClick} disabled={disabled} size="small">
      {label}
    </Button>
  );

  const sectionErrors = (prefix: string) => {
    const n = countErrors(errors, prefix);
    return n > 0 ? <Chip size="small" color="error" variant="outlined" label={p.errorsInSection(n)} /> : undefined;
  };

  /* ── Cotação ─────────────────────────────────────────────────────── */
  const fx = values.fx;
  const fxCard = (
    <SectionCard title={p.fx.title} subtitle={p.fx.subtitle} action={sectionErrors('fx')}>
      <Stack spacing={2.5}>
        <ToggleOption
          checked={fx.auto}
          onChange={() => undefined}
          disabled
          title={p.fx.auto}
          description={p.fx.autoHint}
          badge={<Chip size="small" variant="outlined" label={p.fx.autoBadge} />}
        />

        <Box>
          <Stack direction="row" alignItems="center" spacing={0.5} sx={{ mb: 1 }}>
            <Typography variant="subtitle2" id="cost-fx-closing-label">{p.fx.closingMethod}</Typography>
            <HelpTip label={p.fx.closingMethod} text={p.fx.closingMethodHint} />
          </Stack>
          <ToggleButtonGroup
            exclusive
            size="small"
            color="primary"
            value={fx.closingMethod}
            onChange={(_, v: InfraFxClosingMethod | null) => { if (v) c.change('fx.closingMethod', v); }}
            aria-labelledby="cost-fx-closing-label"
            sx={{ flexWrap: 'wrap' }}
          >
            {CLOSING_METHODS.map((m) => <ToggleButton key={m} value={m} sx={{ px: 2 }}>{S.closingMethod[m]}</ToggleButton>)}
          </ToggleButtonGroup>
          {errors['fx.closingMethod'] && <Typography variant="caption" color="error">{errors['fx.closingMethod']}</Typography>}
        </Box>

        <Box>
          <Stack direction="row" alignItems="center" spacing={0.5} sx={{ mb: 1 }}>
            <Typography variant="subtitle2">{p.fx.override}</Typography>
            <HelpTip label={p.fx.override} text={p.fx.overrideHint} />
          </Stack>
          {fx.override ? (
            <Grid container spacing={2} alignItems="flex-start">
              <Grid item xs={12} sm={5}>
                {field('fx.override.rate', p.fx.rate, fx.override.rate, { numeric: 'decimal', hint: p.fx.rateRange, prefix: 'R$' })}
              </Grid>
              <Grid item xs={12} sm={4}>
                {field('fx.override.date', p.fx.date, fx.override.date, { type: 'date' })}
              </Grid>
              <Grid item xs={12} sm={3}>
                <Button color="error" variant="outlined" fullWidth onClick={() => c.change('fx.override', null)} sx={{ minHeight: 40 }}>
                  {p.fx.removeOverride}
                </Button>
              </Grid>
            </Grid>
          ) : (
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ xs: 'stretch', sm: 'center' }}>
              <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>{p.fx.overrideEmpty}</Typography>
              <Button variant="outlined" startIcon={<AppIcon icon={Plus} size="sm" />} onClick={() => c.change('fx.override', { rate: '', date: today() })}>
                {p.fx.addOverride}
              </Button>
            </Stack>
          )}
        </Box>
      </Stack>
    </SectionCard>
  );

  /* ── Serviços ────────────────────────────────────────────────────── */
  const toggleItem = (i: number, open: boolean) =>
    setOpenItems((prev) => (open ? [...new Set([...prev, i])] : prev.filter((x) => x !== i)));
  const addItem = () => {
    const index = values.items.length;
    c.replace((d) => ({ ...d, items: [...d.items, newItem()] }));
    setOpenItems((prev) => [...prev, index]);
  };
  const removeItem = (i: number) => {
    c.replace((d) => ({ ...d, items: d.items.filter((_, x) => x !== i) }));
    setOpenItems((prev) => prev.filter((x) => x !== i).map((x) => (x > i ? x - 1 : x)));
  };

  const itemCard = (it: DraftItem, i: number) => {
    const base = `items[${i}]`;
    const name = asText(it.label).trim() || p.items.newLabel;
    const price = parseDraftNumber(it.monthlyUsd);
    const nErr = countErrors(errors, base);
    const summaryId = `cost-item-${i}-summary`;
    return (
      <Accordion
        key={i}
        disableGutters
        variant="outlined"
        expanded={openItems.includes(i)}
        onChange={(_, open) => toggleItem(i, open)}
        // Fechado não monta os campos: 40 serviços abertos de uma vez pesariam no celular.
        slotProps={{ transition: { unmountOnExit: true } }}
        sx={{ '&:before': { display: 'none' }, borderRadius: 1.5, overflow: 'hidden' }}
      >
        <AccordionSummary
          expandIcon={<AppIcon icon={ChevronDown} size="sm" />}
          id={summaryId}
          aria-controls={`cost-item-${i}-details`}
          aria-label={p.items.expandAria(name)}
          sx={{ '& .MuiAccordionSummary-content': { minWidth: 0, my: 1.25 } }}
        >
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ minWidth: 0, flex: 1 }}>
            <Typography variant="subtitle2" noWrap sx={{ minWidth: 0, maxWidth: '100%' }}>{name}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
              {p.items.perMonth(formatUsd(price))}
            </Typography>
            <Chip size="small" variant="outlined" label={S.billing[it.billing as InfraCostBilling] ?? it.billing} />
            {it.allocation === 'excluded' && <Chip size="small" variant="outlined" label={S.allocation.excluded} />}
            {nErr > 0 && <Chip size="small" color="error" label={p.errorsInSection(nErr)} />}
          </Stack>
        </AccordionSummary>
        <AccordionDetails id={`cost-item-${i}-details`} sx={{ pt: 0 }}>
          <Grid container spacing={2}>
            <Grid item xs={12} sm={6}>{field(`${base}.label`, f.label, it.label)}</Grid>
            <Grid item xs={12} sm={6}>{field(`${base}.key`, f.key, it.key, { help: f.keyHint })}</Grid>
            <Grid item xs={12} sm={6}>{select(`${base}.category`, f.category, it.category as InfraCostCategory, CATEGORIES, (v) => S.category[v])}</Grid>
            <Grid item xs={12} sm={6}>{select(`${base}.billing`, f.billing, it.billing as InfraCostBilling, BILLINGS, (v) => S.billing[v])}</Grid>
            <Grid item xs={12} sm={6}>
              {field(`${base}.monthlyUsd`, it.billing === 'usage' ? f.monthlyUsdUsage : f.monthlyUsd, it.monthlyUsd, { numeric: 'decimal', prefix: 'US$' })}
            </Grid>
            <Grid item xs={12} sm={6}>{field(`${base}.quantity`, f.quantity, it.quantity, { numeric: 'numeric', hint: f.quantityHint })}</Grid>
            <Grid item xs={12} sm={6}>
              {select(`${base}.renderKey`, f.renderKey, it.renderKey as InfraRenderKey | null, RENDER_KEYS, (v) => S.renderKey[v], p.none)}
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5, mx: 1.75 }}>{f.renderKeyHint}</Typography>
            </Grid>
            <Grid item xs={12} sm={6}>{field(`${base}.planLabel`, f.planLabel, it.planLabel, { nullable: true })}</Grid>
            <Grid item xs={12}>{field(`${base}.note`, f.note, it.note, { nullable: true })}</Grid>
            <Grid item xs={12}>
              <ToggleOption
                checked={it.allocation === 'shared'}
                onChange={(on) => c.change(`${base}.allocation`, on ? 'shared' : 'excluded')}
                title={f.allocation}
                description={f.allocationHint}
              />
            </Grid>
            <Grid item xs={12}>
              <ToggleOption
                checked={it.storage !== null}
                onChange={(on) => c.change(`${base}.storage`, on ? { gb: null, usdPerGb: null } : null)}
                title={f.storage}
                description={f.storageHint}
              >
                {it.storage && (
                  <Grid container spacing={2} sx={{ pt: 1 }}>
                    <Grid item xs={12} sm={6}>{field(`${base}.storage.gb`, f.storageGb, it.storage.gb, { numeric: 'decimal', nullable: true })}</Grid>
                    <Grid item xs={12} sm={6}>
                      {field(`${base}.storage.usdPerGb`, f.storageUsdPerGb, it.storage.usdPerGb, { numeric: 'decimal', nullable: true, prefix: 'US$' })}
                    </Grid>
                  </Grid>
                )}
              </ToggleOption>
            </Grid>
            <Grid item xs={12} sx={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button color="error" startIcon={<AppIcon icon={Trash2} size="sm" />} onClick={() => removeItem(i)} aria-label={p.actions.removeAria(name)}>
                {p.actions.remove}
              </Button>
            </Grid>
          </Grid>
        </AccordionDetails>
      </Accordion>
    );
  };

  const itemsCard = (
    <SectionCard
      title={p.items.title}
      subtitle={p.items.subtitle}
      action={sectionErrors('items')}
    >
      <Stack spacing={1.5}>
        {values.items.length === 0 && <Typography variant="body2" color="text.secondary">{p.items.empty}</Typography>}
        {values.items.map(itemCard)}
        {errors.items && <Typography variant="caption" color="error">{errors.items}</Typography>}
        <Box>{addButton(p.items.add, addItem, values.items.length >= INFRA_COST_LIMITS.maxItems)}</Box>
      </Stack>
    </SectionCard>
  );

  /* ── Linhas de tabela editável (planos e modelos) ────────────────── */
  const rowFrame = (key: string | number, children: ReactNode) => (
    <Box
      key={key}
      sx={{ py: 1.5, borderBottom: 1, borderColor: 'divider', '&:last-of-type': { borderBottom: 0 } }}
    >
      {children}
    </Box>
  );

  const renderPlansCard = (
    <SectionCard title={p.renderPlans.title} subtitle={p.renderPlans.subtitle} action={sectionErrors('renderPlanPrices')}>
      {values.renderPlanPrices.length === 0 && <Typography variant="body2" color="text.secondary">{p.renderPlans.empty}</Typography>}
      <Box>
        {values.renderPlanPrices.map((r, i) => {
          const base = `renderPlanPrices[${i}]`;
          const name = asText(r.plan) || p.renderPlans.plan;
          return rowFrame(i, (
            <Grid container spacing={1.5} alignItems="flex-start">
              <Grid item xs={12} sm={3}>
                {select(`${base}.resourceType`, p.renderPlans.resourceType, r.resourceType as InfraRenderResourceType, RESOURCE_TYPES, (v) => S.resourceType[v])}
              </Grid>
              <Grid item xs={12} sm={5}>{field(`${base}.plan`, p.renderPlans.plan, r.plan, { help: p.renderPlans.planHint })}</Grid>
              <Grid item xs={9} sm={3}>{field(`${base}.monthlyUsd`, p.renderPlans.monthlyUsd, r.monthlyUsd, { numeric: 'decimal', prefix: 'US$' })}</Grid>
              <Grid item xs={3} sm={1} sx={{ display: 'flex', justifyContent: 'flex-end' }}>
                {removeButton(name, () => c.replace((d) => ({ ...d, renderPlanPrices: d.renderPlanPrices.filter((_, x) => x !== i) })))}
              </Grid>
            </Grid>
          ));
        })}
      </Box>
      {errors.renderPlanPrices && <Typography variant="caption" color="error">{errors.renderPlanPrices}</Typography>}
      <Box sx={{ mt: 1 }}>
        {addButton(
          p.renderPlans.add,
          () => c.replace((d) => ({ ...d, renderPlanPrices: [...d.renderPlanPrices, { resourceType: 'service', plan: '', monthlyUsd: '' }] })),
          values.renderPlanPrices.length >= INFRA_COST_LIMITS.maxRenderPlanPrices,
        )}
      </Box>
    </SectionCard>
  );

  const aiModelsCard = (
    <SectionCard title={p.aiModels.title} subtitle={p.aiModels.subtitle} action={sectionErrors('aiModelPrices')}>
      {values.aiModelPrices.length === 0 && <Typography variant="body2" color="text.secondary">{p.aiModels.empty}</Typography>}
      <Box>
        {values.aiModelPrices.map((m, i) => {
          const base = `aiModelPrices[${i}]`;
          const name = asText(m.model) || p.aiModels.model;
          return rowFrame(i, (
            <Grid container spacing={1.5} alignItems="flex-start">
              <Grid item xs={12} sm={3}>
                {select(`${base}.kind`, p.aiModels.kind, m.kind as AiProviderKind, AI_KINDS, (v) => aiProviderName(v))}
              </Grid>
              <Grid item xs={12} sm={3}>{field(`${base}.model`, p.aiModels.model, m.model)}</Grid>
              <Grid item xs={6} sm={2.5}>{field(`${base}.inputPerMTokUsd`, p.aiModels.input, m.inputPerMTokUsd, { numeric: 'decimal' })}</Grid>
              <Grid item xs={6} sm={2.5}>{field(`${base}.outputPerMTokUsd`, p.aiModels.output, m.outputPerMTokUsd, { numeric: 'decimal' })}</Grid>
              <Grid item xs={12} sm={1} sx={{ display: 'flex', justifyContent: 'flex-end' }}>
                {removeButton(name, () => c.replace((d) => ({ ...d, aiModelPrices: d.aiModelPrices.filter((_, x) => x !== i) })))}
              </Grid>
            </Grid>
          ));
        })}
      </Box>
      {errors.aiModelPrices && <Typography variant="caption" color="error">{errors.aiModelPrices}</Typography>}
      <Box sx={{ mt: 1 }}>
        {addButton(
          p.aiModels.add,
          () => c.replace((d) => ({
            ...d, aiModelPrices: [...d.aiModelPrices, { kind: 'OPENAI', model: '', inputPerMTokUsd: '', outputPerMTokUsd: '' }],
          })),
          values.aiModelPrices.length >= INFRA_COST_LIMITS.maxAiModelPrices,
        )}
      </Box>
    </SectionCard>
  );

  /* ── Workspace ───────────────────────────────────────────────────── */
  const w = values.workspace;
  const ws = p.workspace;
  const workspaceCard = (
    <SectionCard title={ws.title} subtitle={ws.subtitle} action={sectionErrors('workspace')}>
      <Grid container spacing={2}>
        <Grid item xs={12} sm={6}>{field('workspace.planLabel', ws.planLabel, w.planLabel)}</Grid>
        <Grid item xs={12} sm={6}>{field('workspace.cycleStartDay', ws.cycleStartDay, w.cycleStartDay, { numeric: 'numeric', hint: ws.cycleStartDayHint })}</Grid>
        <Grid item xs={12} sm={6}>{field('workspace.includedBandwidthGb', ws.includedBandwidthGb, w.includedBandwidthGb, { numeric: 'decimal' })}</Grid>
        <Grid item xs={12} sm={6}>{field('workspace.includedBuildMinutes', ws.includedBuildMinutes, w.includedBuildMinutes, { numeric: 'numeric' })}</Grid>
        <Grid item xs={12} sm={6}>{field('workspace.bandwidthUsdPerGb', ws.bandwidthUsdPerGb, w.bandwidthUsdPerGb, { numeric: 'decimal', prefix: 'US$' })}</Grid>
        <Grid item xs={12} sm={6}>{field('workspace.buildUsdPer1000Min', ws.buildUsdPer1000Min, w.buildUsdPer1000Min, { numeric: 'decimal', prefix: 'US$' })}</Grid>
        <Grid item xs={12}>
          <Stack direction="row" alignItems="center" spacing={0.5}>
            <Typography variant="subtitle2">{ws.manualTitle}</Typography>
            <HelpTip label={ws.manualTitle} text={ws.manualHint} />
          </Stack>
        </Grid>
        <Grid item xs={12} sm={6}>
          {field('workspace.manualBandwidthGb', ws.manualBandwidthGb, w.manualBandwidthGb, { numeric: 'decimal', nullable: true })}
        </Grid>
        <Grid item xs={12} sm={6}>
          {field('workspace.manualBuildMinutes', ws.manualBuildMinutes, w.manualBuildMinutes, { numeric: 'numeric', nullable: true })}
        </Grid>
      </Grid>
    </SectionCard>
  );

  const rejected = Object.keys(c.serverErrors);
  const onConfirm = async () => {
    if (!next) return;
    // Fecha em qualquer desfecho: 400 marca o campo, 409 recarrega mantendo o rascunho; o resultado vai no Snackbar.
    await c.save(next);
    setConfirmOpen(false);
  };

  return (
    <Stack spacing={2}>
      {view.origin === 'default' && <Alert severity="info">{S.origin.default}</Alert>}
      {rejected.length > 0 && <Alert severity="error">{S.errors.rejectedFields(rejected.join(', '))}</Alert>}

      {fxCard}
      {itemsCard}
      {renderPlansCard}
      {aiModelsCard}
      {workspaceCard}

      <Stack
        direction={{ xs: 'column-reverse', sm: 'row' }}
        spacing={1.5}
        alignItems={{ xs: 'stretch', sm: 'center' }}
        justifyContent="space-between"
      >
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          <Typography variant="body2" color="text.secondary">
            {view.updatedAt ? p.lastSaved(new Date(view.updatedAt).toLocaleString('pt-BR')) : p.neverSaved}
          </Typography>
          {c.restored && <Chip size="small" label={p.draftRestored} variant="outlined" />}
          {c.dirty && !c.restored && <Chip size="small" label={p.unsaved} variant="outlined" color="warning" />}
        </Stack>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
          {c.dirty && <Button onClick={c.discard} disabled={c.saving}>{p.actions.discard}</Button>}
          <Button variant="contained" onClick={() => setConfirmOpen(true)} disabled={!valid || changes.length === 0 || c.saving}>
            {p.actions.review}
          </Button>
        </Stack>
      </Stack>

      <PricesConfirmDialog
        open={confirmOpen}
        changes={changes}
        before={view.settings}
        after={next}
        saving={c.saving}
        onConfirm={() => void onConfirm()}
        onClose={() => setConfirmOpen(false)}
      />

      <Snackbar open={Boolean(c.notice)} autoHideDuration={6000} onClose={c.clearNotice} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        {c.notice ? <Alert severity={c.notice.severity} variant="filled" onClose={c.clearNotice}>{c.notice.text}</Alert> : <span />}
      </Snackbar>
    </Stack>
  );
}
