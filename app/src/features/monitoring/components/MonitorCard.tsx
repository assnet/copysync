import { useId, type ReactNode } from 'react';
import { Box, Typography, useTheme, type SxProps, type Theme } from '@mui/material';
import type { LucideIcon } from 'lucide-react';
import { AppIcon } from '@/components';
import { focusRingScopeSx, iconTileSx, surfaceSx, type MonitorTone } from '../monitoringStyle';

export interface MonitorCardProps {
  icon: LucideIcon;
  tone?: MonitorTone;
  title: string;
  subtitle?: string;
  /** Canto direito do cabeçalho (ex.: GroupUsageChip). */
  action?: ReactNode;
  /** Rodapé alinhado à esquerda (botão principal). */
  footer?: ReactNode;
  children: ReactNode;
  sx?: SxProps<Theme>;
  id?: string;
  'aria-labelledby'?: string;
}

/** Card padrão do Monitoramento: `<section>` sem borda, ícone tintado, `h2` e rodapé opcional. */
export function MonitorCard({ icon, tone = 'primary', title, subtitle, action, footer, children, sx, id, 'aria-labelledby': labelledBy }: MonitorCardProps) {
  const theme = useTheme();
  const titleId = useId();
  return (
    <Box
      component="section"
      id={id}
      aria-labelledby={labelledBy ?? titleId}
      sx={[
        surfaceSx(theme),
        focusRingScopeSx(theme),
        { height: '100%', display: 'flex', flexDirection: 'column', p: { xs: 2, sm: 2.5 }, gap: 2, minWidth: 0 },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5, minWidth: 0 }}>
        <Box sx={iconTileSx(theme, tone)}>
          <AppIcon icon={icon} size="md" />
        </Box>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography id={titleId} variant="subtitle1" component="h2" sx={{ fontWeight: 700, lineHeight: 1.3 }}>
            {title}
          </Typography>
          {subtitle && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
              {subtitle}
            </Typography>
          )}
        </Box>
        {action && <Box sx={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>{action}</Box>}
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>{children}</Box>
      {footer && <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>{footer}</Box>}
    </Box>
  );
}
