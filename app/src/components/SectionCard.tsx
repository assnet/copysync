import { Card, CardContent, Box, ButtonBase, Collapse, Typography, Divider, type SxProps, type Theme } from '@mui/material';
import { useId, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { AppIcon } from './AppIcon';
import { usePersistedState } from '@/hooks/usePersistedState';

interface Props {
  title?: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  noPadding?: boolean;
  sx?: SxProps<Theme>;
  /** Ajustes do cabeçalho (título + ação), ex.: empilhar no celular. */
  headerSx?: SxProps<Theme>;
  /**
   * Card recolhível: nasce fechado, o título vira botão e o aberto/fechado fica salvo por navegador
   * (`ui.<chave>`, `usePersistedState` escopo `browser`). A `action` continua clicável recolhido.
   */
  collapseKey?: string;
}

export function SectionCard({ collapseKey, ...props }: Props) {
  return collapseKey ? <CollapsibleSectionCard collapseKey={collapseKey} {...props} /> : <SectionCardFrame open {...props} />;
}

function CollapsibleSectionCard({ collapseKey, ...props }: Props & { collapseKey: string }) {
  const [open, setOpen] = usePersistedState<boolean>(collapseKey, false, { scope: 'browser' });
  return <SectionCardFrame {...props} open={open === true} onToggle={() => setOpen(!open)} />;
}

function SectionCardFrame({
  title, subtitle, action, children, noPadding, sx, headerSx, open, onToggle,
}: Omit<Props, 'collapseKey'> & { open: boolean; onToggle?: () => void }) {
  const bodyId = useId();
  const heading = (
    <Box sx={{ minWidth: 0, flex: onToggle ? 1 : undefined, textAlign: 'left' }}>
      {title && <Typography variant="subtitle1">{title}</Typography>}
      {subtitle && (
        <Typography variant="caption" color="text.secondary">
          {subtitle}
        </Typography>
      )}
    </Box>
  );
  const body = (
    <CardContent sx={noPadding ? { p: '0 !important' } : undefined}>
      {children}
    </CardContent>
  );

  return (
    <Card sx={sx}>
      {(title || action) && (
        <>
          <Box
            sx={[
              {
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                px: 2.5,
                py: 2,
                gap: 2,
              },
              ...(Array.isArray(headerSx) ? headerSx : [headerSx]),
            ]}
          >
            {onToggle ? (
              // Só título/descrição viram o botão: a ação ao lado segue independente
              <ButtonBase
                onClick={onToggle}
                aria-expanded={open}
                aria-controls={bodyId}
                sx={{
                  flex: 1, minWidth: 0, justifyContent: 'flex-start', gap: 1, borderRadius: 1, m: -0.5, p: 0.5, color: 'text.primary',
                  '&.Mui-focusVisible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 },
                }}
              >
                {heading}
                <Box
                  component="span"
                  aria-hidden
                  sx={{
                    display: 'inline-flex', color: 'text.secondary', flexShrink: 0,
                    transition: 'transform 200ms', transform: open ? 'rotate(180deg)' : 'none',
                    '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
                  }}
                >
                  <AppIcon icon={ChevronDown} size="sm" />
                </Box>
              </ButtonBase>
            ) : heading}
            {action}
          </Box>
          {(!onToggle || open) && <Divider />}
        </>
      )}
      {onToggle ? (
        <Collapse in={open} id={bodyId} sx={{ '@media (prefers-reduced-motion: reduce)': { transition: 'none !important' } }}>
          {body}
        </Collapse>
      ) : body}
    </Card>
  );
}
