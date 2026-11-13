import { Alert, AlertTitle, Box, Button, LinearProgress, Paper, Stack, Tooltip, Typography, alpha } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { CircleCheck, CircleDashed, Info, KeyRound, Lock, ShieldAlert, Users, type LucideIcon } from 'lucide-react';
import { AppIcon } from '@/components';
import { AFFILIATE_CREDENTIALS_PATH, AFFILIATE_PLANS_PATH } from '@/features/navigation/model';
import { offerHunterStrings, type HunterRiskProvider } from '../../strings';
import { HUNT_BLOCKING_GATES } from '../../hooks';
import type { HuntGateKey, HuntOptions } from '../../types';

const t = offerHunterStrings;

const GATE_ICONS: Record<HuntGateKey, LucideIcon> = {
  plan: Lock,
  hunterEntitlement: Lock,
  credential: KeyRound,
  riskAccepted: ShieldAlert,
  aiAvailable: Info,
  destination: Users,
};

export interface HunterGatesPanelProps {
  options: HuntOptions;
  blockedBy: HuntGateKey | null;
  /** Marca dos portões exibidos (padrão SHEIN): o aviso de risco aberto é o dela. */
  provider?: HunterRiskProvider;
  onOpenRisk: (provider: HunterRiskProvider) => void;
  onFocusDestination: () => void;
}

/**
 * Estados travados (`options.gates`) na ordem da execução. Plano fechado mostra só o upgrade (as demais
 * etapas não valem sem ele); senão, lista de etapas com a ação de cada pendente. IA indisponível é só aviso.
 */
export function HunterGatesPanel({ options, blockedBy, provider = 'SHEIN', onOpenRisk, onFocusDestination }: HunterGatesPanelProps) {
  const navigate = useNavigate();
  const { gates, sourceStatus } = options;

  const act = (key: HuntGateKey) => {
    if (key === 'plan' || key === 'hunterEntitlement') navigate(AFFILIATE_PLANS_PATH);
    else if (key === 'credential') navigate(AFFILIATE_CREDENTIALS_PATH);
    else if (key === 'riskAccepted') onOpenRisk(provider);
    else if (key === 'destination') onFocusDestination();
  };

  const planClosed = !gates.plan || !gates.hunterEntitlement;
  // `sourceStatus` só acrescenta quando a credencial existe mas a fonte falha (rejeitada/fora do ar).
  const sourceNote = gates.credential && (sourceStatus === 'CREDENTIAL_REJECTED' || sourceStatus === 'UNAVAILABLE')
    ? t.sourceStatus[sourceStatus]
    : null;

  const steps = HUNT_BLOCKING_GATES.filter((k) => k !== 'hunterEntitlement' || gates.plan);
  const done = steps.filter((k) => gates[k]).length;

  return (
    <Stack spacing={1.5} sx={{ mb: 3 }}>
      {blockedBy && planClosed && (
        <Paper
          variant="outlined"
          role="region"
          aria-label={t.gatesPanel.title}
          sx={{ p: { xs: 2, sm: 2.5 }, borderColor: 'primary.main', bgcolor: (th) => alpha(th.palette.primary.main, 0.04) }}
        >
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ xs: 'flex-start', sm: 'center' }}>
            <Box sx={{ color: 'primary.main', display: 'inline-flex' }}><AppIcon icon={Lock} size="lg" /></Box>
            <Box sx={{ flexGrow: 1, minWidth: 0 }}>
              <Typography variant="subtitle1" fontWeight={700}>{t.gates[blockedBy].title}</Typography>
              <Typography variant="body2" color="text.secondary">{t.gates[blockedBy].text}</Typography>
            </Box>
            <Button variant="contained" onClick={() => act(blockedBy)} sx={{ flexShrink: 0 }}>
              {t.gates[blockedBy].action}
            </Button>
          </Stack>
        </Paper>
      )}

      {blockedBy && !planClosed && (
        <Paper variant="outlined" role="region" aria-label={t.gatesPanel.title} sx={{ p: { xs: 2, sm: 2.5 }, borderColor: 'warning.main' }}>
          <Stack direction="row" alignItems="baseline" justifyContent="space-between" spacing={1} flexWrap="wrap" useFlexGap>
            <Typography variant="subtitle1" fontWeight={700} component="h2">{t.gatesPanel.title}</Typography>
            <Typography variant="caption" color="text.secondary">{t.gatesPanel.progress(done, steps.length)}</Typography>
          </Stack>
          <LinearProgress
            variant="determinate"
            value={(done / steps.length) * 100}
            color="warning"
            aria-label={t.gatesPanel.progress(done, steps.length)}
            sx={{ mt: 1, mb: 1.5, height: 6, borderRadius: 3 }}
          />
          <Stack component="ol" spacing={1} sx={{ listStyle: 'none', p: 0, m: 0 }}>
            {steps.map((key) => {
              const ok = gates[key];
              const current = key === blockedBy;
              return (
                <Box
                  component="li"
                  key={key}
                  sx={{
                    display: 'flex', gap: 1.5, alignItems: { xs: 'flex-start', sm: 'center' }, flexWrap: { xs: 'wrap', sm: 'nowrap' },
                    p: 1.25, borderRadius: 1.5,
                    bgcolor: current ? (th) => alpha(th.palette.warning.main, 0.08) : 'transparent',
                  }}
                >
                  <Box sx={{ display: 'inline-flex', pt: { xs: 0.25, sm: 0 }, color: ok ? 'success.main' : current ? 'warning.main' : 'text.disabled' }}>
                    <AppIcon icon={ok ? CircleCheck : current ? GATE_ICONS[key] : CircleDashed} size="md" label={ok ? t.gatesPanel.done : t.gatesPanel.pending} />
                  </Box>
                  <Box sx={{ flex: '1 1 200px', minWidth: 0 }}>
                    <Typography variant="body2" fontWeight={600} color={ok ? 'text.secondary' : 'text.primary'}>{ok ? t.gates[key].doneTitle : t.gates[key].title}</Typography>
                    {!ok && <Typography variant="caption" color="text.secondary" display="block">{t.gates[key].text}</Typography>}
                  </Box>
                  {!ok && (
                    <Button
                      size="small"
                      variant={current ? 'contained' : 'outlined'}
                      color={current ? 'warning' : 'inherit'}
                      disableElevation
                      onClick={() => act(key)}
                      sx={{ flexShrink: 0, ml: { xs: 4.5, sm: 0 } }}
                    >
                      {t.gates[key].action}
                    </Button>
                  )}
                </Box>
              );
            })}
          </Stack>
        </Paper>
      )}

      {sourceNote && <Alert severity="warning" variant="outlined">{sourceNote}</Alert>}

      {!gates.aiAvailable && !planClosed && (
        <Alert severity="info" variant="outlined" icon={<AppIcon icon={Info} size="md" />}>
          <AlertTitle sx={{ fontWeight: 600 }}>{t.gates.aiAvailable.title}</AlertTitle>
          <Tooltip title={t.gatesPanel.aiInfo} describeChild placement="bottom-start">
            <Typography variant="body2" component="span">{t.gates.aiAvailable.text}</Typography>
          </Tooltip>
        </Alert>
      )}
    </Stack>
  );
}
