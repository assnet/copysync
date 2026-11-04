import { useEffect, useState } from 'react';
import {
  Alert, Box, Chip, CircularProgress, IconButton, Slider, Stack, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography,
  type ChipProps,
} from '@mui/material';
import { ArrowDown, ArrowUp, Info, RefreshCw, X } from 'lucide-react';
import { AppIcon } from '@/components';
import { GroupAvatar } from '@/features/offers/components/GroupChip';
import { Blurred, useBlur } from '@/features/privacy';
import { linkRotationStrings } from '../strings';
import { INVITE_URL_EXAMPLE } from '../inviteUrl';
import {
  ROTATION_CAPACITY, ROTATION_RANGES,
  type RotationChannel, type RotationGroupStatus, type RotationLinkSource, type RotationStrategy,
} from '../types';

const t = linkRotationStrings.groups;

/** Ajustes de um grupo escolhido, ainda não salvos (estado de trabalho do diálogo). */
export interface RotationGroupDraft {
  groupJid: string;
  conversationId: string | null;
  title: string | null;
  avatarUrl: string | null;
  capacity: number;
  weight: number;
  linkSource: RotationLinkSource;
  manualInviteUrl: string;
}

const STATUS_COLOR: Record<RotationGroupStatus, ChipProps['color']> = {
  ACTIVE: 'success',
  PAUSED: 'default',
  FULL: 'warning',
  NEEDS_LINK: 'error',
  PAUSED_BY_PLAN: 'default',
};

/** Mostra o campo de link quando é manual ou quando a sessão não conseguiu gerar o convite. */
export function needsInviteField(item: RotationGroupDraft, status: RotationGroupStatus | null): boolean {
  return item.linkSource === 'MANUAL' || status === 'NEEDS_LINK';
}

export interface RotationGroupItemProps {
  item: RotationGroupDraft;
  index: number;
  total: number;
  strategy: RotationStrategy;
  /** Canal da sessão do rodízio: formato do convite e faixa do teto. */
  channel: RotationChannel;
  /** Convite salvo (montado pela API no formato do canal); null = sem link ainda. */
  inviteUrl: string | null;
  /** `null` = grupo novo, ainda não salvo. */
  status: RotationGroupStatus | null;
  memberCount: number | null;
  /** Cliques desde a última leitura de membros (estimativa de entradas). */
  clicksSinceSync: number;
  /** Estimado (membros + cliques desde a leitura) já no teto salvo: o redirect não escolhe o grupo. */
  atCapacity: boolean;
  canRefresh: boolean;
  refreshing: boolean;
  /** Erro de validação do link de convite (pinta o campo). */
  error: string | null;
  /** Falha de "Atualizar agora": aviso próprio do item, não marca o campo de convite. */
  refreshError: string | null;
  onChange: (patch: Partial<RotationGroupDraft>) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
  onRefresh: () => void;
}

function HelpIcon({ title }: { title: string }) {
  return (
    <Tooltip title={title} arrow describeChild>
      <Box component="span" tabIndex={0} aria-label={title} sx={{ display: 'inline-flex', color: 'text.secondary', cursor: 'help', borderRadius: 1 }}>
        <AppIcon icon={Info} />
      </Box>
    </Tooltip>
  );
}

/**
 * Teto de membros: controle deslizante + número digitável (na faixa larga do Telegram o deslizante
 * sozinho não acerta um valor). O número só é aplicado quando cabe na faixa; ao sair do campo volta
 * ao valor válido.
 */
function CapacityControl({ value, channel, labelId, onChange }: {
  value: number;
  channel: RotationChannel;
  labelId: string;
  onChange: (n: number) => void;
}) {
  const range = ROTATION_CAPACITY[channel];
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const apply = (raw: string) => {
    setText(raw);
    const n = Number(raw);
    if (Number.isInteger(n) && n >= range.min && n <= range.max) onChange(n);
  };
  return (
    <Stack direction="row" spacing={1.5} alignItems="center">
      <Slider
        value={Math.min(Math.max(value, range.min), range.max)}
        min={range.min}
        max={range.max}
        step={range.step}
        marks={[{ value: range.default }]}
        valueLabelDisplay="off"
        aria-labelledby={labelId}
        getAriaValueText={t.capacityValue}
        onChange={(_e, v) => typeof v === 'number' && onChange(v)}
        sx={{ mx: 1, flex: 1 }}
      />
      <TextField
        size="small"
        type="number"
        value={text}
        onChange={(e) => apply(e.target.value)}
        onBlur={() => setText(String(value))}
        inputProps={{ min: range.min, max: range.max, step: 1, inputMode: 'numeric', 'aria-label': t.capacityInput }}
        sx={{ width: 112, '& input': { fontVariantNumeric: 'tabular-nums' } }}
      />
    </Stack>
  );
}

/** Um grupo escolhido: posição, situação, teto de membros, peso (só WEIGHTED) e origem do convite. */
export function RotationGroupItem({
  item, index, total, strategy, channel, inviteUrl, status, memberCount, clicksSinceSync, atCapacity, canRefresh, refreshing, error, refreshError, onChange, onMove, onRemove, onRefresh,
}: RotationGroupItemProps) {
  const blurName = useBlur('linkRotation.groupName');
  const blurInvite = useBlur('linkRotation.inviteLink');
  // Campo editável não usa <Blurred> (bloquearia o clique); borra só o texto digitado.
  const blurInviteSx = blurInvite ? { '& .MuiInputBase-input': { filter: 'blur(5px)', userSelect: 'none' } } : undefined;
  const limited = status === 'ACTIVE' && atCapacity;
  const estimated = memberCount !== null && clicksSinceSync > 0 ? memberCount + clicksSinceSync : null;
  const name = item.title?.trim() || t.untitled;
  const { weight } = ROTATION_RANGES;

  return (
    <Box
      data-testid={`rotation-group-${item.groupJid}`}
      sx={{ border: 1, borderColor: error ? 'error.main' : 'divider', borderRadius: 2, p: 1.5 }}
    >
      <Stack direction="row" spacing={1} alignItems="center">
        <Typography variant="caption" sx={{ fontWeight: 700, minWidth: 18, textAlign: 'center', color: 'text.secondary' }}>{index + 1}</Typography>
        <GroupAvatar title={item.title} avatarUrl={item.avatarUrl} size={32} blurFlag="linkRotation.groupAvatar" />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>
            <Blurred when={blurName} inline>{name}</Blurred>
          </Typography>
          {status && (estimated !== null ? (
            <Tooltip title={t.membersEstimatedHelp(memberCount ?? 0, clicksSinceSync)} arrow describeChild>
              <Typography variant="caption" color="text.secondary" tabIndex={0} sx={{ cursor: 'help' }}>{t.membersEstimated(estimated, item.capacity)}</Typography>
            </Tooltip>
          ) : (
            <Typography variant="caption" color="text.secondary">{t.members(memberCount, item.capacity)}</Typography>
          ))}
        </Box>
        <Tooltip title={limited ? t.atCapacityHelp : status ? linkRotationStrings.groupStatusHelp[status] : t.statusNewHelp} arrow describeChild>
          <Chip
            size="small"
            variant="outlined"
            color={limited ? 'warning' : status ? STATUS_COLOR[status] : 'info'}
            label={limited ? t.atCapacity : status ? linkRotationStrings.groupStatus[status] : t.statusNew}
            tabIndex={0}
          />
        </Tooltip>
      </Stack>

      <Stack direction="row" spacing={0.5} justifyContent="flex-end" sx={{ mt: 0.5 }}>
        <Tooltip title={t.moveUp} arrow>
          <span>
            <IconButton size="small" aria-label={t.moveUpAria(name)} disabled={index === 0} onClick={() => onMove(-1)}><AppIcon icon={ArrowUp} size="sm" /></IconButton>
          </span>
        </Tooltip>
        <Tooltip title={t.moveDown} arrow>
          <span>
            <IconButton size="small" aria-label={t.moveDownAria(name)} disabled={index === total - 1} onClick={() => onMove(1)}><AppIcon icon={ArrowDown} size="sm" /></IconButton>
          </span>
        </Tooltip>
        {canRefresh && (
          <Tooltip title={t.refreshTooltip} arrow>
            <span>
              <IconButton size="small" aria-label={t.refreshAria(name)} disabled={refreshing} onClick={onRefresh}>
                {refreshing ? <CircularProgress size={16} aria-hidden /> : <AppIcon icon={RefreshCw} size="sm" />}
              </IconButton>
            </span>
          </Tooltip>
        )}
        <Tooltip title={t.remove} arrow>
          <IconButton size="small" aria-label={t.removeAria(name)} onClick={onRemove}><AppIcon icon={X} size="sm" /></IconButton>
        </Tooltip>
      </Stack>

      <Box sx={{ mt: 1 }}>
        <Stack direction="row" spacing={0.75} alignItems="center">
          <Typography variant="caption" color="text.secondary" id={`cap-${item.groupJid}`}>{t.capacity}</Typography>
          <HelpIcon title={t.capacityHelp[channel]} />
          <Box sx={{ flex: 1 }} />
          <Typography variant="body2" sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{t.capacityValue(item.capacity)}</Typography>
        </Stack>
        <CapacityControl value={item.capacity} channel={channel} labelId={`cap-${item.groupJid}`} onChange={(capacity) => onChange({ capacity })} />
      </Box>

      {strategy === 'WEIGHTED' && (
        <Box data-testid="rotation-group-weight">
          <Stack direction="row" spacing={0.75} alignItems="center">
            <Typography variant="caption" color="text.secondary" id={`w-${item.groupJid}`}>{t.weight}</Typography>
            <HelpIcon title={t.weightHelp} />
            <Box sx={{ flex: 1 }} />
            <Typography variant="body2" sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{t.weightValue(item.weight)}</Typography>
          </Stack>
          <Slider
            value={item.weight}
            min={weight.min}
            max={weight.max}
            step={1}
            valueLabelDisplay="off"
            aria-labelledby={`w-${item.groupJid}`}
            getAriaValueText={t.weightValue}
            onChange={(_e, v) => typeof v === 'number' && onChange({ weight: v })}
            sx={{ mx: 1, width: 'calc(100% - 16px)' }}
          />
        </Box>
      )}

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'flex-start', sm: 'center' }} sx={{ mt: 0.5 }}>
        <Typography variant="caption" color="text.secondary">{t.linkSource}</Typography>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={item.linkSource}
          aria-label={t.linkSource}
          onChange={(_e, v: RotationLinkSource | null) => v && onChange({ linkSource: v })}
        >
          <Tooltip title={t.linkAutoHelp} arrow describeChild>
            <ToggleButton value="AUTO">{t.linkAuto}</ToggleButton>
          </Tooltip>
          <Tooltip title={t.linkManualHelp} arrow describeChild>
            <ToggleButton value="MANUAL">{t.linkManual}</ToggleButton>
          </Tooltip>
        </ToggleButtonGroup>
      </Stack>

      {needsInviteField(item, status) && (
        <TextField
          fullWidth
          size="small"
          sx={{ mt: 1.5, ...blurInviteSx }}
          label={t.manualInviteUrl}
          placeholder={INVITE_URL_EXAMPLE[channel]}
          value={item.manualInviteUrl}
          onChange={(e) => onChange({ manualInviteUrl: e.target.value })}
          error={Boolean(error)}
          helperText={error ?? t.manualInviteHelp[channel]}
          inputProps={{ inputMode: 'url', autoComplete: 'off', spellCheck: false }}
        />
      )}
      {inviteUrl && item.linkSource === 'AUTO' && !needsInviteField(item, status) && (
        <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1, display: 'flex', gap: 0.75, minWidth: 0 }}>
          <span>{t.currentInvite}</span>
          <Blurred when={blurInvite} inline radius={4}>
            <Box component="span" data-testid="rotation-group-invite" sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>{inviteUrl}</Box>
          </Blurred>
        </Typography>
      )}
      {error && !needsInviteField(item, status) && (
        <Typography variant="caption" color="error" component="p" sx={{ mt: 1 }}>{error}</Typography>
      )}
      {refreshError && (
        <Alert severity="error" variant="outlined" role="alert" sx={{ mt: 1, py: 0 }}>{refreshError}</Alert>
      )}
    </Box>
  );
}
