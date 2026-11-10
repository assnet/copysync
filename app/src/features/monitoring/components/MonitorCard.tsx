import { useId, type ReactNode } from 'react';
import { Box, ButtonBase, Collapse, Typography, useTheme, type SxProps, type Theme } from '@mui/material';
import { ChevronDown, type LucideIcon } from 'lucide-react';
import { AppIcon } from '@/components';
import { usePersistedState } from '@/hooks/usePersistedState';
import { REDUCED_MOTION, focusRingScopeSx, iconTileSx, surfaceSx, type MonitorTone } from '../monitoringStyle';

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
  /**
   * Card recolhível: nasce fechado e lembra aberto/fechado por navegador (`ui.monitoring.card.<chave>`).
   * Preferência de tela, não estado de trabalho: escopo `browser`, igual para todas as sessões.
   */
  collapseKey?: string;
}

/** Card padrão do Monitoramento: `<section>` sem borda, ícone tintado, `h2` e rodapé opcional. */
export function MonitorCard({ collapseKey, ...props }: MonitorCardProps) {
  return collapseKey ? <CollapsibleMonitorCard collapseKey={collapseKey} {...props} /> : <MonitorCardFrame open {...props} />;
}

function CollapsibleMonitorCard({ collapseKey, ...props }: MonitorCardProps & { collapseKey: string }) {
  const [open, setOpen] = usePersistedState<boolean>(`monitoring.card.${collapseKey}`, false, { scope: 'browser' });
  return <MonitorCardFrame {...props} open={open === true} onToggle={() => setOpen(!open)} />;
}

function MonitorCardFrame({
  icon, tone = 'primary', title, subtitle, action, footer, children, sx, id, 'aria-labelledby': labelledBy, open, onToggle,
}: Omit<MonitorCardProps, 'collapseKey'> & { open: boolean; onToggle?: () => void }) {
  const theme = useTheme();
  const titleId = useId();
  const bodyId = useId();

  const heading = (
    <>
      <Box sx={iconTileSx(theme, tone)}>
        <AppIcon icon={icon} size="md" />
      </Box>
      <Box sx={{ minWidth: 0, flex: 1, textAlign: 'left' }}>
        <Typography id={titleId} variant="subtitle1" component="h2" sx={{ fontWeight: 700, lineHeight: 1.3 }}>
          {title}
        </Typography>
        {subtitle && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
            {subtitle}
          </Typography>
        )}
      </Box>
    </>
  );

  const body = (
    <>
      <Box sx={{ flex: 1, minWidth: 0 }}>{children}</Box>
      {footer && <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>{footer}</Box>}
    </>
  );

  return (
    <Box
      component="section"
      id={id}
      aria-labelledby={labelledBy ?? titleId}
      sx={[
        surfaceSx(theme),
        focusRingScopeSx(theme),
        { height: onToggle && !open ? 'auto' : '100%', display: 'flex', flexDirection: 'column', p: { xs: 2, sm: 2.5 }, gap: onToggle && !open ? 0 : 2, minWidth: 0 },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5, minWidth: 0 }}>
        {onToggle ? (
          // Cabeçalho inteiro é o botão (alvo grande); o h2 continua dentro para a navegação por títulos
          <ButtonBase
            onClick={onToggle}
            aria-expanded={open}
            aria-controls={bodyId}
            sx={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'flex-start', gap: 1.5, borderRadius: 2, m: -0.5, p: 0.5 }}
          >
            {heading}
            <Box
              component="span"
              aria-hidden
              sx={{
                display: 'inline-flex', alignSelf: 'center', color: 'text.secondary', flexShrink: 0,
                transition: 'transform 200ms', transform: open ? 'rotate(180deg)' : 'none',
                [REDUCED_MOTION]: { transition: 'none' },
              }}
            >
              <AppIcon icon={ChevronDown} size="sm" />
            </Box>
          </ButtonBase>
        ) : heading}
        {action && <Box sx={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>{action}</Box>}
      </Box>
      {onToggle ? (
        <Collapse in={open} id={bodyId} unmountOnExit={false} sx={{ [REDUCED_MOTION]: { transition: 'none !important' } }}>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 2 }}>{body}</Box>
        </Collapse>
      ) : body}
    </Box>
  );
}
