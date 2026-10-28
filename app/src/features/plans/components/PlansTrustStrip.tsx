import { Box, Typography } from '@mui/material';
import { BadgeCheck, Headphones, Lock, RotateCcw, TrendingUp } from 'lucide-react';
import { AppIcon } from '@/components';
import { plansStrings as t } from '../strings';

const ITEMS = [
  { icon: Lock, label: t.trust.securePayment },
  { icon: RotateCcw, label: t.trust.cancelAnytime },
  { icon: TrendingUp, label: t.trust.upgradeAnytime },
  { icon: Headphones, label: t.trust.humanSupport },
  { icon: BadgeCheck, label: t.trust.guarantee },
];

/** Faixa de confiança abaixo dos cards. */
export function PlansTrustStrip() {
  return (
    <Box
      component="ul"
      sx={{
        m: 0, p: 0, pt: 2.5, listStyle: 'none', borderTop: '1px solid', borderColor: 'divider',
        display: 'flex', flexWrap: 'wrap', justifyContent: 'center', columnGap: 3, rowGap: 1,
      }}
    >
      {ITEMS.map(({ icon, label }) => (
        <Box component="li" key={label} sx={{ display: 'flex', alignItems: 'center', gap: 0.75, color: 'text.secondary' }}>
          <Box sx={{ color: 'success.main', display: 'flex' }}><AppIcon icon={icon} size="sm" /></Box>
          <Typography variant="caption">{label}</Typography>
        </Box>
      ))}
    </Box>
  );
}
