import { useRef } from 'react';
import { Alert, Box, Button, Chip, Divider, Stack, Tooltip, Typography } from '@mui/material';
import { Clock, Lock, Moon } from 'lucide-react';
import { AppIcon, RangeSlider, postingWindowSummary, type PostingWindowValue } from '@/components';
import { GroupChip } from '../GroupChip';
import { Blurred, useBlur } from '@/features/privacy';
import type { OfferDispatchOrder, SessionItem } from '@/types/api.types';
import { offerStrings } from '../../strings';
import { INTERVAL_MAX_SECONDS, INTERVAL_MIN_SECONDS, INTERVAL_STEP_SECONDS, intervalRisk, intervalValid } from '../../utils/offerConfig';
import { isUnpostable, postBlockedText } from '../../utils/postBlocked';
import type { SelectedGroup } from './ConfigGroupsStep';
import { DispatchOrderPicker, sessionColor } from './DispatchOrderPicker';

const t = offerStrings.wizard.confirm;
const pb = offerStrings.postBlocked;
const MAX_CHIPS = 12;

interface Props {
  /** Na ordem de envio. */
  sessions: SessionItem[];
  groups: (SelectedGroup & { id: string })[];
  /** Tira o grupo da seleção (usado nos grupos onde a sessão não posta). */
  onRemoveGroup: (id: string) => void;
  intervalMin: number;
  intervalMax: number;
  onInterval: (min: number, max: number) => void;
  dispatchOrder: OfferDispatchOrder;
  onDispatchOrder: (order: OfferDispatchOrder) => void;
  /** Horário escolhido no passo anterior: só revisão (faixa e dias, como no resumo do campo). */
  postingWindow: PostingWindowValue;
}

/** Passo 4: resumo (sessões na ordem, grupos por sessão, horário), intervalo entre envios e ordem com várias sessões. */
export function ConfigConfirmStep({
  sessions, groups, onRemoveGroup, intervalMin, intervalMax, onInterval, dispatchOrder, onDispatchOrder, postingWindow,
}: Props) {
  const schedule = postingWindowSummary(postingWindow);
  const invalid = !intervalValid(intervalMin, intervalMax);
  const risk = intervalRisk(intervalMin, intervalMax);
  const blurSession = useBlur('offers.sessionName');
  // Sem permissão de postar: sempre à vista (fora do corte), com motivo e "Remover"
  const unpostable = groups.filter(isUnpostable);
  const others = groups.filter((g) => !isUnpostable(g));
  const shown = others.slice(0, MAX_CHIPS);
  const rest = others.length - shown.length;
  const firstUnpostableRef = useRef<HTMLDivElement>(null);
  const reviewGroups = () => {
    const el = firstUnpostableRef.current;
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    // Foco no "Remover" do 1º afetado: ação seguinte óbvia, com anel de foco visível
    el?.querySelector('button')?.focus({ preventScroll: true });
  };
  const groupsPerSession = sessions.map((s) => groups.filter((g) => g.sessionId === s.id).length);

  return (
    <Stack spacing={2.5} divider={<Divider flexItem />}>
      {unpostable.length > 0 && (
        <Alert
          severity="warning"
          action={<Button color="inherit" size="small" onClick={reviewGroups}>{pb.reviewGroups}</Button>}
        >
          {pb.savedAlert(unpostable.length)}
        </Alert>
      )}
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: '2fr 1fr' } }}>
        <Box>
          <Typography variant="caption" color="text.secondary" component="p" sx={{ mb: 0.75 }}>
            {sessions.length > 1 ? t.sessions : t.session}
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
            {sessions.map((s, i) => (
              <Chip
                key={s.id}
                size="small"
                variant="outlined"
                avatar={<Box component="span" sx={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: sessionColor(i), ml: 1 }} />}
                label={<Blurred when={blurSession} inline radius={5}>{t.groupsOf(s.name, groupsPerSession[i] ?? 0)}</Blurred>}
                sx={{ fontWeight: 600, borderColor: sessionColor(i) }}
              />
            ))}
          </Box>
        </Box>
        <Box>
          <Typography variant="caption" color="text.secondary">{t.total}</Typography>
          <Typography variant="subtitle1" sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{groups.length}</Typography>
        </Box>
        <Box sx={{ gridColumn: '1 / -1' }}>
          <Typography variant="caption" color="text.secondary" component="p" sx={{ mb: 0.5 }}>{t.schedule}</Typography>
          <Box
            aria-label={`${schedule.rangeAria}. ${schedule.days}`}
            role="group"
            sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}
          >
            <Box component="span" aria-hidden sx={{ display: 'inline-flex', color: 'primary.main' }}>
              <AppIcon icon={postingWindow.window.overnight ? Moon : Clock} size="sm" />
            </Box>
            <Typography variant="subtitle1" sx={{ minWidth: 0, fontWeight: 600, lineHeight: 1.3, fontVariantNumeric: 'tabular-nums' }}>
              <Box component="span" sx={{ whiteSpace: 'nowrap' }}>{schedule.range}</Box>{' '}
              <Box component="span" sx={{ fontWeight: 500, color: 'text.secondary', whiteSpace: 'nowrap' }}>{`· ${schedule.days}`}</Box>
            </Typography>
          </Box>
        </Box>
      </Box>

      <Box>
        <Typography variant="caption" color="text.secondary" component="p" sx={{ mb: 1 }}>{t.groups}</Typography>
        {unpostable.length > 0 && (
          <Stack spacing={0.75} sx={{ mb: 1.25 }}>
            {unpostable.map((g, i) => {
              const reason = postBlockedText(g.postBlockedReason);
              return (
                <Box
                  key={g.id}
                  ref={i === 0 ? firstUnpostableRef : undefined}
                  sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}
                >
                  <GroupChip title={g.title} avatarUrl={g.avatarUrl} untitled={offerStrings.wizard.groups.untitled} sx={{ maxWidth: 240 }} />
                  {/* Selo + "Remover" juntos: no celular quebram para a linha de baixo lado a lado */}
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Tooltip title={`${reason.long} ${pb.savedHint}`} arrow describeChild enterTouchDelay={0} leaveTouchDelay={4000}>
                      <Chip
                        size="small"
                        color="warning"
                        variant="outlined"
                        icon={<AppIcon icon={Lock} size="sm" />}
                        label={pb.savedChip}
                        aria-label={`${pb.savedChip}: ${reason.short}`}
                        tabIndex={0}
                      />
                    </Tooltip>
                    <Button size="small" color="inherit" onClick={() => onRemoveGroup(g.id)} sx={{ minHeight: 44 }}>{t.removeGroup}</Button>
                  </Box>
                </Box>
              );
            })}
          </Stack>
        )}
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
          {shown.map((g, i) => <GroupChip key={`${g.title}-${i}`} title={g.title} avatarUrl={g.avatarUrl} untitled={offerStrings.wizard.groups.untitled} sx={{ maxWidth: 240 }} />)}
          {rest > 0 && <Chip size="small" variant="outlined" label={t.more(rest)} />}
        </Box>
      </Box>

      <Box>
        <Typography variant="subtitle2">{t.interval}</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>{t.intervalHelper}</Typography>
        <Box sx={{ maxWidth: 560 }}>
          <RangeSlider
            value={[intervalMin, intervalMax]}
            min={INTERVAL_MIN_SECONDS}
            max={INTERVAL_MAX_SECONDS}
            step={INTERVAL_STEP_SECONDS}
            minDistance={INTERVAL_STEP_SECONDS}
            ariaLabel={t.interval}
            minLabel={t.min}
            maxLabel={t.max}
            formatValue={t.minutes}
            status={{ score: risk.score, label: t.risk[risk.level], ariaLabel: t.riskAria }}
            error={invalid}
            onChange={([min, max]) => onInterval(min, max)}
          />
        </Box>
        {invalid && (
          <Typography variant="caption" color="error" component="p" role="alert" sx={{ mt: 0.75 }}>
            {t.intervalError(INTERVAL_MIN_SECONDS, INTERVAL_MAX_SECONDS)}
          </Typography>
        )}
      </Box>

      {sessions.length > 1 && (
        <DispatchOrderPicker
          value={dispatchOrder}
          onChange={onDispatchOrder}
          groupsPerSession={groupsPerSession}
          sessionNames={sessions.map((s) => s.name)}
        />
      )}
    </Stack>
  );
}
