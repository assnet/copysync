import {
  Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Table, TableBody, TableCell, TableHead,
  TableRow, Typography, useMediaQuery, useTheme,
} from '@mui/material';
import { aiProviderName } from '@/features/ai/aiProviders';
import type { AiProviderKind } from '@/types/api.types';
import { infraCostsStrings as S } from '../strings';
import type { InfraCostSettings, InfraCostSettingsChange } from '../types';

const p = S.prices;
type Leaf = InfraCostSettingsChange['from'];

const FIELD_LABELS: Record<string, string> = {
  'fx.auto': p.fx.auto,
  'fx.closingMethod': p.fx.closingMethod,
  'fx.override.rate': `${p.fx.override} · ${p.fx.rate}`,
  'fx.override.date': `${p.fx.override} · ${p.fx.date}`,
  'fx.override': p.fx.override,
  label: p.items.fields.label,
  key: p.items.fields.key,
  category: p.items.fields.category,
  billing: p.items.fields.billing,
  monthlyUsd: p.items.fields.monthlyUsd,
  quantity: p.items.fields.quantity,
  renderKey: p.items.fields.renderKey,
  planLabel: p.items.fields.planLabel,
  note: p.items.fields.note,
  allocation: p.items.fields.allocationShort,
  storage: p.items.fields.storageShort,
  'storage.gb': p.items.fields.storageGb,
  'storage.usdPerGb': p.items.fields.storageUsdPerGb,
  resourceType: p.renderPlans.resourceType,
  plan: p.renderPlans.plan,
  kind: p.aiModels.kind,
  model: p.aiModels.model,
  inputPerMTokUsd: p.aiModels.input,
  outputPerMTokUsd: p.aiModels.output,
};

const SECTION_TITLES: Record<string, string> = {
  items: p.items.title,
  renderPlanPrices: p.renderPlans.title,
  aiModelPrices: p.aiModels.title,
};

/** Rótulo legível do caminho do diff (`items[api].monthlyUsd` → "API · Preço (US$/mês)"). */
export function changeLabel(path: string, before: InfraCostSettings, after: InfraCostSettings): string {
  if (FIELD_LABELS[path]) return FIELD_LABELS[path];
  if (path.startsWith('workspace.')) {
    const f = path.slice('workspace.'.length) as keyof typeof p.workspace;
    return `${p.workspace.title} · ${p.workspace[f] ?? f}`;
  }
  const m = path.match(/^(items|renderPlanPrices|aiModelPrices)\[([^\]]+)\](?:\.(.+))?$/);
  if (!m) return path;
  const [, list, id, field] = m;
  let name = id;
  if (list === 'items') {
    name = after.items.find((i) => i.key === id)?.label ?? before.items.find((i) => i.key === id)?.label ?? id;
  } else if (list === 'renderPlanPrices') {
    const [type, ...plan] = id.split(':');
    name = `${S.resourceType[type as keyof typeof S.resourceType] ?? type} ${plan.join(':')}`;
  } else {
    const [kind, ...model] = id.split(':');
    name = `${aiProviderName(kind as AiProviderKind)} ${model.join(':')}`;
  }
  if (!field) return `${SECTION_TITLES[list]} · ${name}`;
  return `${name} · ${FIELD_LABELS[field] ?? field}`;
}

/** Valor exibido: opções pelo rótulo, números em pt-BR, vazio = "—". */
export function changeValue(path: string, value: Leaf): string {
  if (value === null || value === '') return S.noValue;
  if (typeof value === 'boolean') return value ? p.yes : p.no;
  if (typeof value === 'number') return value.toLocaleString('pt-BR', { maximumFractionDigits: 4 });
  const field = path.split('.').pop() ?? '';
  const maps: Record<string, Record<string, string>> = {
    category: S.category, billing: S.billing, renderKey: S.renderKey, allocation: S.allocation,
    closingMethod: S.closingMethod, resourceType: S.resourceType,
  };
  if (field === 'kind') return aiProviderName(value as AiProviderKind);
  return maps[field]?.[value] ?? value;
}

interface Props {
  open: boolean;
  changes: InfraCostSettingsChange[];
  before: InfraCostSettings;
  after: InfraCostSettings | null;
  saving: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

/** Confirmação da aba Preços: o que muda, antes × depois (COST-08). */
export function PricesConfirmDialog({ open, changes, before, after, saving, onConfirm, onClose }: Props) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'), { noSsr: true });
  const next = after ?? before;
  return (
    <Dialog
      open={open}
      onClose={saving ? undefined : onClose}
      maxWidth="md"
      fullWidth
      fullScreen={fullScreen}
      aria-labelledby="cost-prices-confirm-title"
    >
      <DialogTitle id="cost-prices-confirm-title" sx={{ fontWeight: 700 }}>{p.confirm.title}</DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          <Typography variant="body2" color="text.secondary">{p.confirm.intro}</Typography>
          {changes.length === 0 ? (
            <Typography variant="body2">{S.diff.empty}</Typography>
          ) : (
            <Table size="small" aria-label={p.confirm.title} sx={{ '& td, & th': { px: { xs: 1, sm: 2 } } }}>
              <TableHead>
                <TableRow>
                  <TableCell>{p.confirm.field}</TableCell>
                  <TableCell align="right">{p.confirm.before}</TableCell>
                  <TableCell align="right">{p.confirm.after}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {changes.map((c) => (
                  <TableRow key={`${c.kind}:${c.path}`}>
                    <TableCell sx={{ wordBreak: 'break-word' }}>
                      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                        <span>{changeLabel(c.path, before, next)}</span>
                        {c.kind !== 'changed' && (
                          <Chip size="small" variant="outlined" color={c.kind === 'added' ? 'success' : 'error'} label={S.diff[c.kind]} />
                        )}
                      </Stack>
                    </TableCell>
                    <TableCell align="right" sx={{ color: 'text.secondary', fontVariantNumeric: 'tabular-nums', wordBreak: 'break-word' }}>
                      {c.kind === 'added' ? S.noValue : changeValue(c.path, c.from)}
                    </TableCell>
                    <TableCell align="right" sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums', wordBreak: 'break-word' }}>
                      {c.kind === 'removed' ? S.noValue : changeValue(c.path, c.to)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={saving}>{p.confirm.cancel}</Button>
        <Button variant="contained" onClick={onConfirm} disabled={saving || changes.length === 0 || !after}>
          {saving ? p.confirm.saving : p.confirm.save}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
