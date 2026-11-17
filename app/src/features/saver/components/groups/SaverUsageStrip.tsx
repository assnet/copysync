import { Box, Paper, Tooltip, Typography } from '@mui/material';
import { Info } from 'lucide-react';
import { AppIcon } from '@/components';
import { saverStrings } from '../../strings';
import type { SaverOverview, SaverUsage } from '../../types';

const t = saverStrings.groups.usage;

function UsageItem({ label, usage, hint }: { label: string; usage: SaverUsage; hint?: string }) {
  // Limite 0 = fora do plano: texto neutro, nunca "0 de 0" nem destaque de esgotado.
  const notIncluded = usage.limit === 0;
  const full = !notIncluded && usage.remaining !== null && usage.remaining <= 0;
  return (
    <Paper variant="outlined" sx={{ flex: '1 1 180px', p: 1.5, borderRadius: 2, borderColor: full ? 'warning.main' : 'divider' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
        <Typography variant="caption" color="text.secondary">{label}</Typography>
        {hint && (
          <Tooltip title={hint} arrow>
            <Box component="span" tabIndex={0} aria-label={hint} sx={{ display: 'inline-flex', color: 'text.secondary', cursor: 'help' }}>
              <AppIcon icon={Info} size="inline" />
            </Box>
          </Tooltip>
        )}
      </Box>
      {notIncluded ? (
        <Typography variant="subtitle1" color="text.secondary">{saverStrings.limits.notIncluded}</Typography>
      ) : (
        <Typography variant="subtitle1" sx={{ fontWeight: 700, color: full ? 'warning.main' : 'text.primary' }}>
          {saverStrings.limits.usage(usage.used, usage.limit)}
        </Typography>
      )}
    </Paper>
  );
}

/** Uso × limite do plano (grupos, contatos, leituras em 24 h); limite 0 aparece como "não incluso". */
export function SaverUsageStrip({ overview }: { overview: SaverOverview }) {
  return (
    <Box component="section" aria-label={t.title} sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5 }}>
      <UsageItem label={t.groups} usage={overview.groups} />
      <UsageItem label={t.contacts} usage={overview.contacts} />
      <UsageItem label={t.scans} usage={overview.groupScansPerDay} hint={t.scansHint} />
    </Box>
  );
}
