import { Chip, Stack, Tooltip } from '@mui/material';
import { PLAN_CATALOG, type PlanSlug } from '../catalog';
import { plansStrings } from '../strings';

const t = plansStrings.availability;

/** Planos do catálogo a partir de `from` (inclusive), na ordem da vitrine. */
export function plansFrom(from: PlanSlug): string[] {
  const i = PLAN_CATALOG.findIndex((p) => p.slug === from);
  return i < 0 ? [] : PLAN_CATALOG.slice(i).map((p) => p.name);
}

/**
 * Selos dos planos que incluem um recurso (ex.: "PRO" "MAX"), ao lado do título da opção.
 * Sempre visíveis: mostram onde o recurso existe, travado ou não. Mesmo visual do selo do menu.
 */
export function PlanAvailabilityBadges({ from }: { from: PlanSlug }) {
  const names = plansFrom(from);
  if (names.length === 0) return null;
  return (
    <Tooltip title={t.tooltip(names)} arrow describeChild>
      <Stack component="span" direction="row" spacing={0.5} aria-label={t.tooltip(names)} sx={{ display: 'inline-flex', verticalAlign: 'middle' }}>
        {names.map((name) => (
          <Chip
            key={name}
            label={name}
            size="small"
            color="primary"
            variant="outlined"
            aria-hidden
            sx={{ height: 18, fontSize: 10, fontWeight: 600, '& .MuiChip-label': { px: 0.75 } }}
          />
        ))}
      </Stack>
    </Tooltip>
  );
}
