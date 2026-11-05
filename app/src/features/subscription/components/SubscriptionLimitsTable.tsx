import {
  Box, Chip, LinearProgress, Stack, Tab, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Tabs, Tooltip, Typography, useTheme,
} from '@mui/material';
import { Info } from 'lucide-react';
import { AppIcon, SectionCard, TelegramIcon, WhatsAppIcon, brandColor } from '@/components';
import type { SubscriptionLimitItem } from '@/types/api.types';
import { minPlanFor, subscriptionStrings, SUBSCRIPTION_LIMIT_KEYS, type SubscriptionChannel, type SubscriptionLimitKey } from '../strings';
import { usageTone } from '../usageTone';

const t = subscriptionStrings;
const CHANNELS: SubscriptionChannel[] = ['whatsapp', 'telegram'];
const CHANNEL_ICON = { whatsapp: WhatsAppIcon, telegram: TelegramIcon } as const;
const PROGRESS_COLOR = { default: 'primary', warning: 'warning', error: 'error' } as const;

const isKnownKey = (key: string): key is SubscriptionLimitKey => (SUBSCRIPTION_LIMIT_KEYS as readonly string[]).includes(key);

/** "A partir do X" pelo menor plano que libera a chave; nenhum libera → "Não incluso". */
function lockedLabel(key: SubscriptionLimitKey): string {
  const plan = minPlanFor(key);
  return plan ? t.limits.availableFrom(plan.name) : t.limits.notIncluded;
}

function UsageCell({ item, label }: { item: SubscriptionLimitItem & { key: SubscriptionLimitKey }; label: string }) {
  const daily = item.kind === 'daily';
  const used = item.used ?? 0;
  if (item.kind === 'feature') {
    return item.enabled
      ? <Chip size="small" color="success" variant="outlined" label={t.limits.included} />
      : <Chip size="small" variant="outlined" label={lockedLabel(item.key)} />;
  }
  if (item.limit === 0) return <Chip size="small" variant="outlined" label={lockedLabel(item.key)} />;
  if (item.limit == null) {
    return <Typography variant="body2">{daily ? t.limits.usageUnlimitedToday(used) : t.limits.usageUnlimited(used)}</Typography>;
  }
  const tone = usageTone(used, item.limit);
  return (
    <Stack spacing={0.5} sx={{ minWidth: { xs: 88, sm: 140 } }}>
      <Typography variant="body2" color={tone === 'default' ? 'text.primary' : `${tone}.main`}>
        {daily ? t.limits.usageToday(used, item.limit) : t.limits.usage(used, item.limit)}
      </Typography>
      <LinearProgress
        variant="determinate"
        color={PROGRESS_COLOR[tone]}
        value={Math.min(100, (used / item.limit) * 100)}
        aria-label={t.limits.usageAria(label, used, item.limit)}
        sx={{ height: 6, borderRadius: 3 }}
      />
    </Stack>
  );
}

function limitText(item: SubscriptionLimitItem): string {
  if (item.kind === 'feature') return '—';
  if (item.limit == null) return t.limits.unlimited;
  if (item.limit === 0) return t.limits.notIncluded;
  const n = item.limit.toLocaleString('pt-BR');
  return item.kind === 'daily' ? `${n} ${t.limits.today}` : n;
}

function LimitsGrid({ items, caption }: { items: Array<SubscriptionLimitItem & { key: SubscriptionLimitKey }>; caption: string }) {
  return (
    <TableContainer>
      {/* Colunas fixas no desktop: as tabelas do canal e a geral alinham entre si e entre abas.
          No celular, padding menor para as três colunas caberem sem rolagem lateral. */}
      <Table size="small" aria-label={caption} sx={{ tableLayout: { sm: 'fixed' }, '& .MuiTableCell-root': { px: { xs: 1, sm: 2 } } }}>
        <TableHead>
          <TableRow>
            <TableCell scope="col" sx={{ width: { sm: '42%' } }}>{t.limits.column.resource}</TableCell>
            <TableCell scope="col" sx={{ width: { sm: '38%' } }}>{t.limits.column.usage}</TableCell>
            <TableCell scope="col" align="right">{t.limits.column.limit}</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {items.map((item) => {
            const { label, hint } = t.limit[item.key];
            return (
              <TableRow key={item.key} data-key={item.key}>
                <TableCell component="th" scope="row">
                  <Tooltip title={hint} arrow describeChild>
                    <Box component="span" tabIndex={0} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, cursor: 'help' }}>
                      {label}
                      <AppIcon icon={Info} style={{ opacity: 0.6 }} />
                    </Box>
                  </Tooltip>
                </TableCell>
                <TableCell><UsageCell item={item} label={label} /></TableCell>
                <TableCell align="right">{limitText(item)}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

export interface SubscriptionLimitsTableProps {
  limits: SubscriptionLimitItem[];
  /** Aba de canal (controlada: a página guarda em `usePersistedState`, escopo `tab`). */
  channel: SubscriptionChannel;
  onChannelChange: (channel: SubscriptionChannel) => void;
}

/**
 * Limites do plano (SUB-08): uma tabela por canal (aba) e outra com os recursos gerais
 * (`channel: null`). Barra de uso com a mesma cor do chip do gerador (`usageTone`); ilimitado
 * mostra só o uso; limite 0 ou recurso desligado mostra o menor plano que libera.
 */
export function SubscriptionLimitsTable({ limits, channel, onChannelChange }: SubscriptionLimitsTableProps) {
  const mode = useTheme().palette.mode;
  const known = limits.filter((l): l is SubscriptionLimitItem & { key: SubscriptionLimitKey } => isKnownKey(l.key));
  const channelItems = known.filter((l) => l.channel === channel);
  const generalItems = known.filter((l) => l.channel == null);

  return (
    <SectionCard title={t.limits.title}>
      <Stack spacing={2}>
        <Tabs
          value={channel}
          onChange={(_, v: SubscriptionChannel) => onChannelChange(v)}
          aria-label={t.limits.channelTabsLabel}
          variant="scrollable"
          allowScrollButtonsMobile
        >
          {CHANNELS.map((ch) => (
            <Tab
              key={ch}
              value={ch}
              label={t.channel[ch]}
              iconPosition="start"
              icon={<AppIcon icon={CHANNEL_ICON[ch]} style={{ color: brandColor(ch, mode) }} />}
              sx={{ minHeight: 48 }}
            />
          ))}
        </Tabs>
        {channelItems.length > 0 && <LimitsGrid items={channelItems} caption={`${t.limits.title}: ${t.channel[channel]}`} />}
        {generalItems.length > 0 && (
          <Box>
            <Typography variant="subtitle2" component="h3" sx={{ px: { xs: 1, sm: 2 }, pb: 1 }}>{t.limits.general}</Typography>
            <LimitsGrid items={generalItems} caption={t.limits.general} />
          </Box>
        )}
      </Stack>
    </SectionCard>
  );
}
