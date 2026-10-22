import { useState } from 'react';
import {
  Alert, Box, Button, Chip, IconButton, Stack, Switch, Tooltip, Typography, type ChipProps,
} from '@mui/material';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import AddLinkIcon from '@mui/icons-material/AddLink';
import { ConfirmDialog, SectionCard } from '@/components';
import type { AffiliateCredentialItem, AffiliateCredentialStatus } from '@/types/api.types';
import type { AffiliateProviderSpec } from '../affiliateProviders';
import { settingsStrings } from '../strings';

const t = settingsStrings.affiliate;
const SECRET_MASK = '••••••••';

interface Props {
  spec: AffiliateProviderSpec;
  item?: AffiliateCredentialItem;
  busy?: boolean;
  onConfigure: () => void;
  onRemove: () => void;
  onStatusChange: (status: AffiliateCredentialStatus) => void;
}

function stateChip(item?: AffiliateCredentialItem): { label: string; color: ChipProps['color'] } {
  if (!item) return { label: t.statusNotConfigured, color: 'default' };
  if (item.status === 'INACTIVE') return { label: t.statusInactive, color: 'warning' };
  return { label: t.statusConfigured, color: 'success' };
}

function ReadOnlyField({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" display="block">{label}</Typography>
      <Typography
        variant="body2"
        fontWeight={500}
        color={muted ? 'text.secondary' : 'text.primary'}
        sx={{ fontFamily: muted ? undefined : 'monospace', wordBreak: 'break-all' }}
      >
        {value}
      </Typography>
    </Box>
  );
}

/**
 * Estado de uma credencial de afiliado. Só exibe valores mascarados: o identificador em
 * claro existe apenas dentro do diálogo de edição.
 */
export function AffiliateCredentialCard({ spec, item, busy, onConfigure, onRemove, onStatusChange }: Props) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const chip = stateChip(item);
  const active = item?.status === 'ACTIVE';

  return (
    <SectionCard
      sx={{ height: '100%', display: 'flex', flexDirection: 'column', '& > .MuiCardContent-root': { flexGrow: 1 } }}
      title={spec.name}
    >
      <Stack spacing={2} sx={{ height: '100%' }}>
        {/* Status no corpo, não no cabeçalho: em 3 colunas o chip empurrava o nome para 2 linhas. */}
        <Stack direction="row" spacing={1.5} alignItems="center" justifyContent="space-between">
          {/* Fundo branco nos dois temas: logo de marca tem cores próprias e some no escuro. */}
          <Box
            aria-hidden
            sx={{
              width: 48, height: 48, p: 1, borderRadius: 2, flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              bgcolor: 'common.white', border: 1, borderColor: 'divider',
            }}
          >
            <Box component="img" src={spec.logo} alt="" sx={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
          </Box>
          <Chip size="small" label={chip.label} color={chip.color} variant={item ? 'filled' : 'outlined'} />
        </Stack>
        <Typography variant="body2" color="text.secondary">{spec.description}</Typography>

        {item && (
          <Stack spacing={1.5}>
            <ReadOnlyField
              label={spec.publicField.label}
              value={item.publicIdentifierMasked ?? t.idPending}
              muted={!item.publicIdentifierMasked}
            />
            {spec.secretField && (
              <ReadOnlyField
                label={spec.secretField.label}
                value={item.hasSecret ? SECRET_MASK : t.notInformed}
                muted={!item.hasSecret}
              />
            )}
          </Stack>
        )}

        {spec.usesBrowserSession && (
          item?.hasSession && item.sessionSyncedAt ? (
            <Alert severity="success" variant="outlined" sx={{ py: 0 }}>{t.sessionSynced(item.sessionSyncedAt)}</Alert>
          ) : (
            <Alert severity="info" variant="outlined" sx={{ py: 0 }}>{t.sessionMissing}</Alert>
          )
        )}

        <Box sx={{ flexGrow: 1 }} />

        <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
          <Button
            variant={item ? 'outlined' : 'contained'}
            disableElevation
            size="small"
            startIcon={item ? <EditOutlinedIcon /> : <AddLinkIcon />}
            onClick={onConfigure}
            disabled={busy}
          >
            {item ? t.edit : t.configure}
          </Button>

          {item && (
            <Stack direction="row" alignItems="center" spacing={0.5}>
              <Tooltip title={active ? t.deactivateTooltip : t.activateTooltip}>
                <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center' }}>
                  <Typography variant="caption" color="text.secondary" component="span">{t.activeLabel}</Typography>
                  <Switch
                    size="small"
                    checked={active}
                    disabled={busy}
                    onChange={(_, checked) => onStatusChange(checked ? 'ACTIVE' : 'INACTIVE')}
                    inputProps={{ 'aria-label': t.activeLabel }}
                  />
                </Box>
              </Tooltip>
              <Tooltip title={t.removeTooltip}>
                <span>
                  <IconButton
                    size="small"
                    color="error"
                    aria-label={t.remove}
                    onClick={() => setConfirmOpen(true)}
                    disabled={busy}
                  >
                    <DeleteOutlineIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
            </Stack>
          )}
        </Stack>
      </Stack>

      <ConfirmDialog
        open={confirmOpen}
        title={t.removeTitle(spec.name)}
        description={spec.usesBrowserSession ? t.removeBrowserSessionDescription : t.removeDescription}
        confirmLabel={t.removeConfirm}
        cancelLabel={t.cancel}
        confirmColor="error"
        onConfirm={() => {
          setConfirmOpen(false);
          onRemove();
        }}
        onClose={() => setConfirmOpen(false)}
      />
    </SectionCard>
  );
}
