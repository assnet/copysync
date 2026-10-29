import { useEffect, useRef, useState } from 'react';
import {
  Box, Button, Chip, IconButton, ListItemIcon, ListItemText, Menu, MenuItem, Stack, Switch, Tooltip, Typography, alpha, type ChipProps,
} from '@mui/material';
import { Check, Copy, ExternalLink, Link2, MoreVertical, Settings2, Smartphone, Trash2, UsersRound } from 'lucide-react';
import { AppIcon, ConfirmDialog, SectionCard } from '@/components';
import { Blurred, useBlur } from '@/features/privacy';
import { sessionStrings } from '@/features/sessions/strings';
import { linkRotationStrings } from '../strings';
import type { Rotation, RotationSessionOption, RotationStatus } from '../types';
import { RotationStatsCard } from './RotationStatsCard';

const t = linkRotationStrings.card;
const COPIED_MS = 2000;

const STATUS_COLOR: Record<RotationStatus, ChipProps['color']> = {
  ACTIVE: 'success',
  PAUSED: 'default',
  PAUSED_BY_PLAN: 'warning',
};

export interface RotationCardProps {
  rotation: Rotation;
  /** Sessão do rodízio (do overview); `null` se não existir mais. */
  session: RotationSessionOption | null;
  /** Limite de grupos por rodízio no plano; `null` = ilimitado. */
  groupLimit: number | null;
  /** Troca ACTIVE ↔ PAUSED; o card mostra o Switch ocupado até resolver. */
  onToggleStatus: (next: 'ACTIVE' | 'PAUSED') => Promise<void>;
  onConfigure: () => void;
  onManageGroups: () => void;
  /** Exclui o link (após a confirmação do card); quem chama trata erro e atualiza a lista. */
  onRemove: () => Promise<void>;
  /** Falha ao copiar (clipboard bloqueado): quem chama mostra o aviso. */
  onCopyFailed?: () => void;
}

/** Um rodízio: link público + copiar, status, sessão, estratégia, grupos e cliques. */
export function RotationCard({ rotation, session, groupLimit, onToggleStatus, onConfigure, onManageGroups, onRemove, onCopyFailed }: RotationCardProps) {
  const blurLink = useBlur('linkRotation.rotationLink');
  const blurSession = useBlur('linkRotation.sessionName');
  const [copied, setCopied] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(rotation.publicUrl);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), COPIED_MS);
    } catch {
      onCopyFailed?.();
    }
  };

  const toggle = async (checked: boolean) => {
    setToggling(true);
    try {
      await onToggleStatus(checked ? 'ACTIVE' : 'PAUSED');
    } finally {
      setToggling(false);
    }
  };

  const remove = async () => {
    setConfirmRemove(false);
    setRemoving(true);
    try {
      await onRemove();
    } finally {
      setRemoving(false);
    }
  };

  const byPlan = rotation.status === 'PAUSED_BY_PLAN';
  const active = rotation.status === 'ACTIVE';
  const switchTip = byPlan ? t.pausedByPlanTooltip : active ? t.statusOnTooltip : t.statusOffTooltip;
  const host = rotation.publicUrl.replace(/^https?:\/\//, '');

  return (
    <SectionCard sx={{ height: '100%' }}>
      <Stack spacing={2}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1.5 }}>
          <Box sx={{ minWidth: 0 }}>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
              <Chip size="small" color={STATUS_COLOR[rotation.status]} label={linkRotationStrings.status[rotation.status]} />
              <Typography variant="caption" color="text.secondary">{t.clicks(rotation.clickCount)}</Typography>
            </Stack>
            {rotation.title && (
              <Blurred when={blurLink} inline radius={5}>
                <Typography variant="subtitle1" noWrap sx={{ fontWeight: 700 }}>{rotation.title}</Typography>
              </Blurred>
            )}
          </Box>
          <Tooltip title={switchTip} arrow describeChild>
            {/* span: Tooltip precisa de filho habilitado para disparar com o Switch desabilitado */}
            <span>
              <Switch
                checked={active}
                disabled={byPlan || toggling}
                onChange={(_, checked) => void toggle(checked)}
                inputProps={{ 'aria-label': t.statusSwitchAria }}
              />
            </span>
          </Tooltip>
        </Box>

        <Box
          sx={(theme) => ({
            display: 'flex', alignItems: 'center', gap: 1, p: 1, pl: 1.5, borderRadius: 1.5, minWidth: 0,
            border: 1, borderColor: 'divider', bgcolor: alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.12 : 0.06),
          })}
        >
          <AppIcon icon={Link2} size="sm" style={{ flexShrink: 0 }} aria-hidden />
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Blurred when={blurLink} inline radius={6}>
              <Typography variant="body2" noWrap sx={{ fontWeight: 600, fontFamily: 'monospace' }} title={rotation.publicUrl}>{host}</Typography>
            </Blurred>
          </Box>
          <Tooltip title={t.openTooltip} arrow>
            <IconButton size="small" component="a" href={rotation.publicUrl} target="_blank" rel="noopener noreferrer" aria-label={t.openTooltip}>
              <AppIcon icon={ExternalLink} size="sm" />
            </IconButton>
          </Tooltip>
          <Tooltip title={copied ? t.copied : t.copyTooltip} arrow describeChild>
            <Button
              size="small"
              variant={copied ? 'outlined' : 'contained'}
              color={copied ? 'success' : 'primary'}
              startIcon={<AppIcon icon={copied ? Check : Copy} size="sm" />}
              onClick={() => void copy()}
              sx={{ flexShrink: 0, minWidth: 104 }}
            >
              <span aria-live="polite">{copied ? t.copied : t.copy}</span>
            </Button>
          </Tooltip>
        </Box>

        <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" alignItems="center">
          <Chip
            size="small"
            variant="outlined"
            icon={<AppIcon icon={Smartphone} size="sm" />}
            label={
              <Blurred when={blurSession} inline radius={5}>
                {session ? session.name || linkRotationStrings.page.untitledSession : linkRotationStrings.page.sessionRemoved}
              </Blurred>
            }
          />
          {session && session.status !== 'CONNECTED' && (
            <Chip size="small" color="warning" label={sessionStrings.status[session.status]} />
          )}
          <Tooltip title={linkRotationStrings.strategy.description[rotation.strategy]} arrow describeChild>
            <Chip size="small" variant="outlined" label={linkRotationStrings.strategy.label[rotation.strategy]} />
          </Tooltip>
          <Tooltip title={t.groupsTooltip} arrow describeChild>
            <Chip
              size="small"
              variant="outlined"
              color={groupLimit !== null && rotation.groups.length >= groupLimit ? 'warning' : 'default'}
              icon={<AppIcon icon={UsersRound} size="sm" />}
              label={t.groups(rotation.groups.length, groupLimit)}
            />
          </Tooltip>
        </Stack>

        <RotationStatsCard
          rotationId={rotation.id}
          refreshKey={`${rotation.status}|${rotation.groups.map((g) => `${g.id}:${g.status}:${g.capacity}:${g.memberCount}`).join(',')}`}
        />

        <Stack direction="row" spacing={1} justifyContent="flex-end" alignItems="center">
          <Tooltip title={t.configureTooltip} arrow describeChild>
            <Button size="small" startIcon={<AppIcon icon={Settings2} size="sm" />} onClick={onConfigure}>{t.configure}</Button>
          </Tooltip>
          <Tooltip title={t.manageGroupsTooltip} arrow describeChild>
            <Button size="small" variant="outlined" startIcon={<AppIcon icon={UsersRound} size="sm" />} onClick={onManageGroups}>
              {t.manageGroups}
            </Button>
          </Tooltip>
          <Tooltip title={t.moreActions} arrow>
            <span>
              <IconButton
                size="small"
                aria-label={t.moreActions}
                aria-haspopup="menu"
                aria-expanded={menuAnchor ? 'true' : undefined}
                disabled={removing}
                onClick={(e) => setMenuAnchor(e.currentTarget)}
              >
                <AppIcon icon={MoreVertical} size="sm" />
              </IconButton>
            </span>
          </Tooltip>
        </Stack>
      </Stack>
      <Menu
        anchorEl={menuAnchor}
        open={Boolean(menuAnchor)}
        onClose={() => setMenuAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <MenuItem
          onClick={() => { setMenuAnchor(null); setConfirmRemove(true); }}
          sx={{ color: 'error.main' }}
        >
          <ListItemIcon sx={{ color: 'inherit' }}><AppIcon icon={Trash2} size="sm" /></ListItemIcon>
          <ListItemText>{t.remove}</ListItemText>
        </MenuItem>
      </Menu>
      <ConfirmDialog
        open={confirmRemove}
        title={t.removeConfirmTitle}
        description={t.removeConfirmBody}
        confirmLabel={t.removeConfirm}
        cancelLabel={t.removeCancel}
        confirmColor="error"
        onConfirm={() => void remove()}
        onClose={() => setConfirmRemove(false)}
      />
    </SectionCard>
  );
}
