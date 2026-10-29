import {
  Alert, Box, Chip, CircularProgress, IconButton, Slider, Stack, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography,
  type ChipProps,
} from '@mui/material';
import { ArrowDown, ArrowUp, Info, RefreshCw, X } from 'lucide-react';
import { AppIcon } from '@/components';
import { GroupAvatar } from '@/features/offers/components/GroupChip';
import { Blurred, useBlur } from '@/features/privacy';
import { linkRotationStrings } from '../strings';
import { ROTATION_RANGES, type RotationGroupStatus, type RotationLinkSource, type RotationStrategy } from '../types';

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

/** Um grupo escolhido: posição, situação, teto de membros, peso (só WEIGHTED) e origem do convite. */
export function RotationGroupItem({
  item, index, total, strategy, status, memberCount, clicksSinceSync, atCapacity, canRefresh, refreshing, error, refreshError, onChange, onMove, onRemove, onRefresh,
}: RotationGroupItemProps) {
  const blurName = useBlur('linkRotation.groupName');
  const blurInvite = useBlur('linkRotation.inviteLink');
  // Campo editável não usa <Blurred> (bloquearia o clique); borra só o texto digitado.
  const blurInviteSx = blurInvite ? { '& .MuiInputBase-input': { filter: 'blur(5px)', userSelect: 'none' } } : undefined;
  const limited = status === 'ACTIVE' && atCapacity;
  const estimated = memberCount !== null && clicksSinceSync > 0 ? memberCount + clicksSinceSync : null;
  const name = item.title?.trim() || t.untitled;
  const { capacity, weight } = ROTATION_RANGES;

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
          <HelpIcon title={t.capacityHelp} />
          <Box sx={{ flex: 1 }} />
          <Typography variant="body2" sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{t.capacityValue(item.capacity)}</Typography>
        </Stack>
        <Slider
          value={item.capacity}
          min={capacity.min}
          max={capacity.max}
          step={1}
          marks={[{ value: capacity.default }]}
          valueLabelDisplay="off"
          aria-labelledby={`cap-${item.groupJid}`}
          getAriaValueText={t.capacityValue}
          onChange={(_e, v) => typeof v === 'number' && onChange({ capacity: v })}
          sx={{ mx: 1, width: 'calc(100% - 16px)' }}
        />
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
          placeholder="https://chat.whatsapp.com/…"
          value={item.manualInviteUrl}
          onChange={(e) => onChange({ manualInviteUrl: e.target.value })}
          error={Boolean(error)}
          helperText={error ?? t.manualInviteHelp}
          inputProps={{ inputMode: 'url', autoComplete: 'off', spellCheck: false }}
        />
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
