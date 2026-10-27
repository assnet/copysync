import { useId, type ReactNode } from 'react';
import { Box, Collapse, Switch, Typography, useMediaQuery } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';

export interface ToggleOptionProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  title: string;
  /** Texto auxiliar abaixo do título. */
  description?: ReactNode;
  /** Controles que só fazem sentido com a opção ligada; aparecem com revelação progressiva. */
  children?: ReactNode;
  disabled?: boolean;
  /** Mostra os filhos mesmo desligado (padrão: só ligado). */
  alwaysShowChildren?: boolean;
}

/**
 * Linha de configuração com toggle: a linha inteira é o rótulo do switch (toque ≥ 44 px),
 * título + texto auxiliar alinhados com o conteúdo do card, realce sutil quando ligada e
 * controles filhos revelados abaixo, alinhados com o título. Padrão para "ligar/desligar com
 * detalhes" (docs/padrao-ui-painel.md).
 */
export function ToggleOption({ checked, onChange, title, description, children, disabled, alwaysShowChildren }: ToggleOptionProps) {
  const theme = useTheme();
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const titleId = useId();
  const descId = useId();
  const showChildren = children !== undefined && (checked || alwaysShowChildren);
  const accent = theme.palette.primary.main;

  return (
    <Box
      sx={{
        borderRadius: 2,
        border: '1px solid',
        borderColor: checked ? alpha(accent, 0.45) : 'divider',
        backgroundColor: checked ? alpha(accent, theme.palette.mode === 'dark' ? 0.1 : 0.06) : 'transparent',
        transition: reduceMotion ? 'none' : 'border-color 200ms, background-color 200ms',
        opacity: disabled ? 0.55 : 1,
        overflow: 'hidden',
      }}
    >
      <Box
        component="label"
        sx={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 1.5,
          px: 1.5,
          py: 1.25,
          minHeight: 44,
          cursor: disabled ? 'default' : 'pointer',
          '&:hover': disabled ? undefined : { backgroundColor: alpha(accent, 0.04) },
        }}
      >
        <Switch
          checked={checked}
          disabled={disabled}
          onChange={(_e, v) => onChange(v)}
          slotProps={{ input: { 'aria-labelledby': titleId, 'aria-describedby': description ? descId : undefined } }}
          sx={{ mt: 0.25, flexShrink: 0 }}
        />
        <Box sx={{ minWidth: 0 }}>
          <Typography id={titleId} variant="subtitle2" sx={{ fontWeight: 600, lineHeight: 1.3 }}>{title}</Typography>
          {description && (
            <Typography id={descId} variant="caption" color="text.secondary" component="p" sx={{ mt: 0.25, lineHeight: 1.4 }}>
              {description}
            </Typography>
          )}
        </Box>
      </Box>

      {children !== undefined && (
        <Collapse in={Boolean(showChildren)} timeout={reduceMotion ? 0 : 200} unmountOnExit>
          {/* Fora do <label>: clique nos controles filhos não alterna o toggle */}
          <Box sx={{ px: 1.5, pb: 1.25, pl: 'calc(36px + 12px + 12px)', borderTop: '1px solid', borderColor: alpha(accent, 0.2), pt: 1 }}>
            {children}
          </Box>
        </Collapse>
      )}
    </Box>
  );
}
