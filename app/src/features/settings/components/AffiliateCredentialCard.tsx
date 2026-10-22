import { useState } from 'react';
import {
  Alert, Box, Button, Card, Chip, Divider, IconButton, Stack, Switch, Tooltip, Typography, alpha,
  type ChipProps,
} from '@mui/material';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import AddLinkIcon from '@mui/icons-material/AddLink';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import PauseCircleOutlineIcon from '@mui/icons-material/PauseCircleOutline';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
import { ConfirmDialog } from '@/components';
import type { AffiliateCredentialItem, AffiliateCredentialStatus } from '@/types/api.types';
import type { AffiliateProviderSpec } from '../affiliateProviders';
import { settingsStrings } from '../strings';
import { MarketplaceLogo } from './MarketplaceLogo';

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

function stateChip(item?: AffiliateCredentialItem): ChipProps {
  if (!item) return { label: t.statusNotConfigured, color: 'default', variant: 'outlined', icon: <RadioButtonUncheckedIcon /> };
  if (item.status === 'INACTIVE') return { label: t.statusInactive, color: 'warning', icon: <PauseCircleOutlineIcon /> };
  return { label: t.statusConfigured, color: 'success', icon: <CheckCircleIcon /> };
}

function ReadOnlyField({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <Box sx={{ minWidth: 0 }}>
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
 *
 * Cabeçalho próprio (não `SectionCard`): logo à esquerda do nome e faixa com a cor da marca.
 */
export function AffiliateCredentialCard({ spec, item, busy, onConfigure, onRemove, onStatusChange }: Props) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const chip = stateChip(item);
  const active = item?.status === 'ACTIVE';
  const brand = spec.brandColor;

  return (
    <Card
      component="article"
      aria-label={spec.name}
      sx={{
        height: '100%', display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden',
        // Faixa da marca no topo; o fundo translúcido some no escuro sem virar mancha.
        borderTop: `3px solid ${brand}`,
        backgroundImage: `linear-gradient(180deg, ${alpha(brand, 0.07)} 0%, transparent 96px)`,
        transition: 'transform .2s ease, box-shadow .2s ease, border-color .2s ease',
        '&:hover': (theme) => ({
          transform: 'translateY(-2px)',
          boxShadow: theme.palette.mode === 'dark'
            ? `0 10px 28px ${alpha(theme.palette.common.black, 0.45)}`
            : `0 10px 28px ${alpha(theme.palette.text.primary, 0.08)}`,
        }),
        '@media (prefers-reduced-motion: reduce)': { transition: 'none', '&:hover': { transform: 'none' } },
      }}
    >
      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ px: 2.5, pt: 2.25, pb: 2 }}>
        <MarketplaceLogo src={spec.logo} size={44} />
        {/* Chip abaixo do nome: ao lado, em 3 colunas, espremia o nome até sobrepor. */}
        <Stack spacing={0.5} alignItems="flex-start" sx={{ minWidth: 0 }}>
          <Typography variant="subtitle1" component="h2" sx={{ fontSize: '1.0625rem', lineHeight: 1.25 }}>
            {spec.name}
          </Typography>
          <Chip
            size="small"
            {...chip}
            sx={item ? { fontWeight: 600, height: 22 } : { fontWeight: 600, height: 22, borderColor: 'divider', color: 'text.secondary' }}
          />
        </Stack>
      </Stack>

      <Stack spacing={2} sx={{ px: 2.5, pb: 2.5, flexGrow: 1 }}>
        <Typography variant="body2" color="text.secondary">{spec.description}</Typography>

        <Stack component="ul" spacing={1.25} sx={{ listStyle: 'none', m: 0, p: 0 }}>
          {spec.highlights.map(({ icon: Icon, text }) => (
            <Stack component="li" key={text} direction="row" spacing={1.25} alignItems="center">
              <Box
                aria-hidden
                sx={{
                  width: 30, height: 30, borderRadius: 1, flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  bgcolor: alpha(brand, 0.16), color: 'text.primary',
                }}
              >
                <Icon sx={{ fontSize: 17 }} />
              </Box>
              <Typography variant="body2">{text}</Typography>
            </Stack>
          ))}
        </Stack>

        {item && (
          <Stack
            spacing={1.25}
            sx={{ p: 1.5, borderRadius: 1, bgcolor: 'action.hover', border: 1, borderColor: 'divider' }}
          >
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
        <Divider />

        <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
          {item ? (
            <Button variant="outlined" size="small" startIcon={<EditOutlinedIcon />} onClick={onConfigure} disabled={busy}>
              {t.edit}
            </Button>
          ) : (
            <Button variant="contained" startIcon={<AddLinkIcon />} onClick={onConfigure} disabled={busy} fullWidth>
              {t.connect(spec.name)}
            </Button>
          )}

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
    </Card>
  );
}
