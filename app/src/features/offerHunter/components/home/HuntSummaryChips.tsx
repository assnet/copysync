import { Box, Chip, Tooltip } from '@mui/material';
import { offerHunterStrings as t } from '../../strings';
import type { Hunt, HuntOptions } from '../../types';
import { huntSummaryChips } from './huntSummary';

/** Lista de chips com todo filtro ligado (quebra linha no celular); Tooltip explica cada um. */
export function HuntSummaryChips({ hunt, options }: { hunt: Hunt; options: HuntOptions | null }) {
  const chips = huntSummaryChips(hunt, options);
  return (
    <Box component="ul" aria-label={t.home.filtersLabel} sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, p: 0, m: 0, listStyle: 'none' }}>
      {chips.length === 0 ? (
        <Box component="li"><Chip size="small" variant="outlined" label={t.home.noFilters} /></Box>
      ) : chips.map((c) => (
        <Box component="li" key={c.key} sx={{ maxWidth: '100%' }} data-testid={`hunt-chip-${c.key}`}>
          <Tooltip title={c.tooltip} arrow describeChild enterTouchDelay={0} leaveTouchDelay={4000}>
            <Chip size="small" variant="outlined" label={c.label} sx={{ maxWidth: '100%' }} />
          </Tooltip>
        </Box>
      ))}
    </Box>
  );
}
