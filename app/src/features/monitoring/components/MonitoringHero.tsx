import { useId, type ReactNode } from 'react';
import { Box, Button, ButtonBase, Tooltip, Typography, alpha, useTheme } from '@mui/material';
import { AlertTriangle, Check, Power } from 'lucide-react';
import { AppIcon } from '@/components';
import { MODULE_ICONS } from '@/pages/modules';
import type { GroupMonitorConfigResponse, SessionItem } from '@/types/api.types';
import {
  CARD_RADIUS, REDUCED_MOTION, VISUALLY_HIDDEN, focusRingScopeSx, glassPillSx, livePulse, radarGradient, radarWash, toneMain, type MonitorTone,
} from '../monitoringStyle';
import { monitoringStrings } from '../strings';

const t = monitoringStrings.hero;

export type MonitoringHeroStep = 'session' | 'monitored' | 'broadcast' | 'credentials';
type StepState = 'done' | 'pending' | 'problem';
export type MonitoringStatus = 'active' | 'off' | 'incomplete';

interface Props {
  session: SessionItem | null;
  config: GroupMonitorConfigResponse | null;
  onAction: (step: MonitoringHeroStep) => void;
  /** Status "Desligado": leva o usuário à chave "Monitoramento ativo". Sem ela, não há botão. */
  onEnable?: () => void;
  /** Seletor de sessão + "Conectar nova sessão". */
  actions: ReactNode;
}

interface StepView { key: MonitoringHeroStep; label: string; state: StepState }

function buildSteps(session: SessionItem, config: GroupMonitorConfigResponse): StepView[] {
  const connected = session.status === 'CONNECTED';
  const problems = config.credentialAlerts?.length ?? 0;
  return [
    { key: 'session', label: t.steps.session(connected), state: connected ? 'done' : 'pending' },
    { key: 'monitored', label: t.steps.monitored(config.monitoredGroups.length), state: config.monitoredGroups.length > 0 ? 'done' : 'pending' },
    { key: 'broadcast', label: t.steps.broadcast(config.broadcastGroups.length), state: config.broadcastGroups.length > 0 ? 'done' : 'pending' },
    { key: 'credentials', label: t.steps.credentials(problems), state: problems === 0 ? 'done' : 'problem' },
  ];
}

/** Status a partir do que está SALVO (não do rascunho): falta etapa obrigatória → "Falta configurar". */
export function monitoringStatus(session: SessionItem, config: GroupMonitorConfigResponse): MonitoringStatus {
  const ready = session.status === 'CONNECTED' && config.monitoredGroups.length > 0 && config.broadcastGroups.length > 0;
  if (!ready) return 'incomplete';
  return config.settings.enabled ? 'active' : 'off';
}

const STATUS_TONE: Record<MonitoringStatus, MonitorTone> = { active: 'success', off: 'neutral', incomplete: 'warning' };

/** Cabeçalho da tela: anel de radar, título, status ao vivo, ações e etapas do que falta configurar. */
export function MonitoringHero({ session, config, onAction, onEnable, actions }: Props) {
  const theme = useTheme();
  const steps = session && config ? buildSteps(session, config) : null;
  const status = session && config ? monitoringStatus(session, config) : null;
  const currentKey = steps?.find((s) => s.state !== 'done')?.key ?? null;
  const allDone = steps !== null && currentKey === null;
  const statusTextId = useId();

  return (
    <Box
      component="header"
      sx={{
        position: 'relative', overflow: 'hidden', mb: { xs: 2, sm: 3 }, borderRadius: CARD_RADIUS,
        px: { xs: 2, sm: 3.5 }, py: { xs: 2, sm: 3 },
        border: '1px solid', borderColor: 'divider',
        bgcolor: 'background.paper', backgroundImage: radarWash(theme),
        ...focusRingScopeSx(theme),
      }}
    >
      <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, alignItems: { xs: 'stretch', md: 'center' }, gap: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, minWidth: 0, flex: 1 }}>
          {/* Ícone do módulo dentro do anel de radar: o elemento de marca da tela. */}
          <Box aria-hidden sx={{ p: '3px', borderRadius: '50%', backgroundImage: radarGradient(theme), flexShrink: 0 }}>
            <Box
              sx={{
                width: { xs: 44, sm: 52 }, height: { xs: 44, sm: 52 }, borderRadius: '50%', display: 'grid', placeItems: 'center',
                bgcolor: 'background.paper', color: 'text.primary', border: '2px solid', borderColor: 'background.paper',
              }}
            >
              <AppIcon icon={MODULE_ICONS.monitoring} size="md" />
            </Box>
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, flexWrap: 'wrap' }}>
              <Typography variant="h5" component="h1" sx={{ fontWeight: 800, letterSpacing: '-0.02em', fontSize: { xs: '1.35rem', sm: '1.6rem' } }}>
                {t.title}
              </Typography>
              {status && (
                <Box role="status" aria-labelledby={statusTextId} sx={glassPillSx(theme)}>
                  {/* Um só marcador: alerta quando falta configurar, ponto nos demais */}
                  {status === 'incomplete' ? (
                    <AppIcon icon={AlertTriangle} size="inline" color={toneMain(theme, 'warning')} />
                  ) : (
                    <Box
                      component="span"
                      aria-hidden
                      sx={{
                        width: 8, height: 8, borderRadius: '50%', bgcolor: toneMain(theme, STATUS_TONE[status]),
                        ...(status === 'active' && { animation: `${livePulse} 2s ease-in-out infinite`, [REDUCED_MOTION]: { animation: 'none' } }),
                      }}
                    />
                  )}
                  <Box component="span" id={statusTextId}>
                    <Box component="span" sx={VISUALLY_HIDDEN}>{t.statusPrefix}</Box>
                    {t.status[status]}
                  </Box>
                </Box>
              )}
              {status === 'off' && onEnable && (
                <Tooltip title={t.enableTooltip} arrow describeChild>
                  <Button
                    size="small"
                    variant="outlined"
                    color="success"
                    startIcon={<AppIcon icon={Power} size="sm" />}
                    onClick={onEnable}
                    sx={{ minHeight: 32, borderRadius: 999, py: 0.25 }}
                  >
                    {t.enableAction}
                  </Button>
                </Tooltip>
              )}
            </Box>
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ mt: 0.25, maxWidth: 560, display: { xs: allDone ? 'none' : 'block', sm: 'block' } }}
            >
              {t.subtitle}
            </Typography>
          </Box>
        </Box>
        {actions && <Box sx={{ flexShrink: 0, width: { xs: '100%', md: 'auto' } }}>{actions}</Box>}
      </Box>

      {steps && (
        <Box
          component="ol"
          aria-label={t.stepsLabel}
          sx={{ listStyle: 'none', p: 0, m: 0, mt: { xs: 2, sm: 2.5 }, display: 'flex', alignItems: 'center', gap: { xs: 0.75, sm: 1 }, flexWrap: 'wrap' }}
        >
          {steps.map((step, i) => {
            const done = step.state === 'done';
            const problem = step.state === 'problem';
            const current = step.key === currentKey;
            const stateText = done ? t.stepDone : problem ? t.stepProblem : t.stepPending;
            const pillSx = {
              display: 'inline-flex', alignItems: 'center', gap: 0.75, pl: 0.5, pr: current ? 1.25 : { xs: 0.5, sm: 1.25 }, py: 0.5,
              minHeight: 32, borderRadius: 999, typography: 'body2', fontWeight: 700, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums',
              color: done ? 'text.primary' : 'text.secondary',
              bgcolor: done ? alpha(theme.palette.primary.main, 0.12) : alpha(theme.palette.background.paper, 0.72),
              border: '1px solid',
              borderColor: done ? 'transparent' : problem ? alpha(theme.palette.warning.main, 0.5) : current ? 'primary.main' : 'divider',
            } as const;
            const content = (
              <>
                <Box
                  component="span"
                  aria-hidden
                  sx={{
                    width: 22, height: 22, borderRadius: '50%', display: 'grid', placeItems: 'center', typography: 'caption', fontWeight: 700,
                    bgcolor: done ? 'primary.main' : 'transparent',
                    color: done ? 'primary.contrastText' : problem ? toneMain(theme, 'warning') : 'inherit',
                    border: done || problem ? 'none' : '1.5px solid', borderColor: 'divider',
                  }}
                >
                  {done ? <AppIcon icon={Check} size="sm" strokeWidth={3} /> : problem ? <AppIcon icon={AlertTriangle} size="sm" /> : i + 1}
                </Box>
                {/* xs: só a etapa atual mostra o nome; as outras viram número/check (nome fica para leitor de tela). */}
                <Box component="span" sx={current ? undefined : (th) => ({ [th.breakpoints.down('sm')]: VISUALLY_HIDDEN })}>
                  {step.label}
                </Box>
                <Box component="span" sx={VISUALLY_HIDDEN}>{` (${stateText})`}</Box>
              </>
            );
            return (
              <Box component="li" key={step.key} aria-current={current ? 'step' : undefined} sx={{ display: 'flex', alignItems: 'center', gap: { xs: 0.75, sm: 1 } }}>
                {/* xs: etapas quebram linha; sem conector para não sobrar um "–" solto no início da linha */}
                {i > 0 && <Box aria-hidden sx={{ display: { xs: 'none', sm: 'block' }, width: 20, height: 2, borderRadius: 1, bgcolor: done ? 'primary.main' : 'divider' }} />}
                {done ? (
                  <Box component="span" sx={pillSx}>{content}</Box>
                ) : (
                  <ButtonBase
                    onClick={() => onAction(step.key)}
                    sx={{
                      ...pillSx,
                      transition: theme.transitions.create(['background-color', 'border-color'], { duration: 200 }),
                      '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.08) },
                      [REDUCED_MOTION]: { transition: 'none' },
                    }}
                  >
                    {content}
                  </ButtonBase>
                )}
              </Box>
            );
          })}
        </Box>
      )}
    </Box>
  );
}
