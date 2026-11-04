import { Box, FormControlLabel, IconButton, Switch, Tooltip, Typography } from '@mui/material';
import { Info } from 'lucide-react';
import { AppIcon } from './AppIcon';

export interface HideUnavailableSwitchProps {
  checked: boolean;
  onChange: (value: boolean) => void;
  /** Ex.: "Ocultar grupos onde não posso postar" (texto vem do `strings.ts` da feature). */
  label: string;
  tooltip: string;
  /** Itens escondidos agora, já considerando a busca atual. */
  hiddenCount: number;
  hiddenCountLabel: (n: number) => string;
}

/**
 * Filtro de lista "ocultar itens indisponíveis" (grupos onde a sessão não posta / não convida).
 * Liga/desliga = `Switch` (docs/padrao-ui-painel.md). Contador "N ocultos" só com o filtro ligado.
 * Estado fica na tela que usa (`usePersistedState`, padrão ligado).
 */
export function HideUnavailableSwitch({ checked, onChange, label, tooltip, hiddenCount, hiddenCountLabel }: HideUnavailableSwitchProps) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', columnGap: 1, rowGap: 0.25, minWidth: 0 }}>
      {/* Switch + rótulo + info juntos: com rótulo longo o texto quebra, mas o "i" não cai sozinho */}
      <Box sx={{ display: 'flex', alignItems: 'center', flex: '1 1 auto', minWidth: 0 }}>
        <FormControlLabel
          control={<Switch size="small" checked={checked} onChange={(e) => onChange(e.target.checked)} />}
          label={<Typography variant="body2">{label}</Typography>}
          sx={{ mr: 0, ml: 0, gap: 1, minWidth: 0 }}
        />
        <Tooltip title={tooltip} arrow describeChild enterTouchDelay={0} leaveTouchDelay={4000}>
          <IconButton size="small" aria-label={label} sx={{ color: 'text.disabled', flexShrink: 0 }}>
            <AppIcon icon={Info} size="sm" />
          </IconButton>
        </Tooltip>
      </Box>
      {checked && hiddenCount > 0 && (
        <Typography variant="caption" color="text.secondary" aria-live="polite" sx={{ ml: 'auto' }}>
          {hiddenCountLabel(hiddenCount)}
        </Typography>
      )}
    </Box>
  );
}
