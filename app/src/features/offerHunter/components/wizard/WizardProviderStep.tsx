import { useId } from 'react';
import { Alert, Box, Button, ButtonBase, CircularProgress, Skeleton, Typography } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import { useNavigate } from 'react-router-dom';
import { Check, CircleCheck, KeyRound, Lock, ShieldAlert, type LucideIcon } from 'lucide-react';
import { AppIcon } from '@/components';
import { AFFILIATE_CREDENTIALS_PATH, AFFILIATE_PLANS_PATH } from '@/features/navigation/model';
import { MarketplaceLogo } from '@/features/settings/components/MarketplaceLogo';
import type { HuntProvider, HuntProviderState } from '../../types';
import { huntBrandName, offerHunterStrings as t } from '../../strings';
import { HUNT_PROVIDERS, huntProviderBrand, huntProviderStatus, type HuntProviderStatus } from '../../providers';

const p = t.wizard.provider;

const STATUS_ICON: Record<HuntProviderStatus, LucideIcon> = {
  READY: CircleCheck,
  NO_PLAN: Lock,
  NO_ACCOUNT: KeyRound,
  ACCOUNT_REJECTED: KeyRound,
  NO_RISK: ShieldAlert,
};

interface Props {
  /** Loja escolhida (null = nenhuma). */
  provider: HuntProvider | null;
  /** Edição: loja fixa, sem grade. */
  editing: boolean;
  providers: HuntProviderState[] | null;
  providersLoading: boolean;
  providersFailed: boolean;
  onRetryProviders: () => void;
  onSelect: (provider: HuntProvider) => void;
  onOpenRisk?: (provider: HuntProvider) => void;
  error?: string;
}

/** Logo + nome da loja fixa (edição e cabeçalho). */
export function HuntProviderMark({ provider, size = 28 }: { provider: HuntProvider; size?: number }) {
  const brand = huntProviderBrand(provider);
  return (
    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
      <MarketplaceLogo src={brand.logo} size={size} />
      <Typography variant="body2" component="span" sx={{ fontWeight: 600 }}>{huntBrandName(provider)}</Typography>
    </Box>
  );
}

/**
 * Passo 0, parte 1: grade com as logos das lojas do caçador e o estado de cada uma (pronta, sem plano, sem conta,
 * sem aceite) com a ação que resolve. Loja fora do plano não é escolhível; as demais sim (dá para montar e ligar
 * depois). Na edição a loja é fixa e aparece só a logo.
 */
export function WizardProviderStep({
  provider, editing, providers, providersLoading, providersFailed, onRetryProviders, onSelect, onOpenRisk, error,
}: Props) {
  const theme = useTheme();
  const navigate = useNavigate();
  const labelId = useId();

  if (editing && provider) {
    return (
      <Box role="group" aria-label={p.fixedLabel} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
        <HuntProviderMark provider={provider} size={40} />
      </Box>
    );
  }

  if (providersLoading && !providers) {
    return (
      <Box role="status" aria-label={p.loading} sx={gridSx}>
        <Skeleton variant="rounded" height={128} /><Skeleton variant="rounded" height={128} />
      </Box>
    );
  }
  if (providersFailed && !providers) {
    return (
      <Alert severity="error" action={<Button color="inherit" size="small" onClick={onRetryProviders}>{t.page.retry}</Button>}>
        {p.loadError}
      </Alert>
    );
  }

  const act = (status: HuntProviderStatus, target: HuntProvider) => {
    if (status === 'NO_PLAN') navigate(AFFILIATE_PLANS_PATH);
    else if (status === 'NO_ACCOUNT' || status === 'ACCOUNT_REJECTED') navigate(AFFILIATE_CREDENTIALS_PATH);
    else if (status === 'NO_RISK') onOpenRisk?.(target);
  };

  return (
    <Box>
      <Typography id={labelId} variant="subtitle2" component="p" sx={{ fontWeight: 600, mb: 0.75 }}>{p.gridLabel}</Typography>
      <Box role="radiogroup" aria-labelledby={labelId} aria-invalid={Boolean(error) || undefined} sx={gridSx}>
        {HUNT_PROVIDERS.map((key) => {
          const state = providers?.find((s) => s.provider === key) ?? null;
          const status = huntProviderStatus(state);
          const brand = huntProviderBrand(key);
          const name = huntBrandName(key);
          const selected = provider === key;
          const blocked = status === 'NO_PLAN';
          const ready = status === 'READY';
          const action = status === 'READY' ? null : p.actions[status];
          return (
            <Box
              key={key}
              data-testid={`hunt-provider-${key}`}
              sx={{
                display: 'flex', flexDirection: 'column', borderRadius: 2, border: '1px solid', overflow: 'hidden',
                borderColor: selected ? 'primary.main' : 'divider',
                boxShadow: selected ? `0 0 0 1px ${theme.palette.primary.main}` : 'none',
                backgroundColor: selected ? alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.12 : 0.05) : 'background.paper',
                opacity: blocked ? 0.75 : 1,
                transition: 'border-color 150ms, background-color 150ms',
                '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
              }}
            >
              <Box aria-hidden sx={{ height: 4, bgcolor: brand.brandColor, borderBottom: '1px solid', borderColor: 'divider' }} />
              <ButtonBase
                role="radio"
                aria-checked={selected}
                aria-disabled={blocked || undefined}
                aria-label={`${name}: ${p.states[status]}`}
                disabled={blocked}
                onClick={() => onSelect(key)}
                sx={{
                  display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-start', textAlign: 'left', gap: 1.5,
                  p: 1.5, minHeight: 72, width: '100%',
                  '&:hover': { backgroundColor: blocked ? undefined : alpha(theme.palette.primary.main, 0.04) },
                  '&.Mui-focusVisible': { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: -2 },
                }}
              >
                <MarketplaceLogo src={brand.logo} size={44} />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Typography variant="subtitle1" component="span" sx={{ fontWeight: 700, flex: 1 }}>{name}</Typography>
                    {selected && <Box component="span" sx={{ color: 'primary.main', display: 'inline-flex' }}><AppIcon icon={Check} size="sm" label={p.selected} /></Box>}
                  </Box>
                  <Box
                    component="span"
                    sx={{
                      display: 'inline-flex', alignItems: 'center', gap: 0.5, mt: 0.25, typography: 'caption', fontWeight: 600,
                      color: ready ? 'success.main' : blocked ? 'text.secondary' : theme.palette.mode === 'dark' ? 'warning.main' : 'warning.dark',
                    }}
                  >
                    <AppIcon icon={STATUS_ICON[status]} size="inline" />
                    {p.states[status]}
                  </Box>
                  <Typography variant="caption" color="text.secondary" component="span" sx={{ display: 'block', lineHeight: 1.35 }}>
                    {p.stateHints[status]}
                  </Typography>
                </Box>
              </ButtonBase>
              {action && (
                <Box sx={{ px: 1.5, pb: 1.25, mt: -0.5 }}>
                  <Button
                    size="small"
                    variant={blocked ? 'contained' : 'outlined'}
                    color={blocked ? 'primary' : 'inherit'}
                    disableElevation
                    onClick={() => act(status, key)}
                    aria-label={p.actionTooltip(action, name)}
                    disabled={status === 'NO_RISK' && !onOpenRisk}
                  >
                    {action}
                  </Button>
                </Box>
              )}
            </Box>
          );
        })}
      </Box>
      {error && <Typography variant="caption" color="error" component="p" role="alert" sx={{ mt: 0.75 }}>{error}</Typography>}
      {providersLoading && providers && <CircularProgress size={14} sx={{ mt: 1 }} aria-label={p.loading} />}
    </Box>
  );
}

const gridSx = {
  display: 'grid',
  gap: 1.25,
  gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' },
} as const;

