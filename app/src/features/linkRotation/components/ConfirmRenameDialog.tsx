import { Box, Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, Stack, Typography } from '@mui/material';
import { ArrowDown } from 'lucide-react';
import { AppIcon } from '@/components';
import { Blurred, useBlur } from '@/features/privacy';
import { linkRotationStrings } from '../strings';

const t = linkRotationStrings.config;

interface Props {
  open: boolean;
  oldUrl: string;
  newUrl: string;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

/**
 * Confirma a troca do nome do link: mostra o link atual e o novo e avisa que o antigo para de
 * funcionar (reservado ao tenant por 30 dias). Variante do `ConfirmDialog` com os links borrados
 * pela flag `linkRotation.rotationLink`.
 */
export function ConfirmRenameDialog({ open, oldUrl, newUrl, busy = false, onConfirm, onClose }: Props) {
  const blur = useBlur('linkRotation.rotationLink');
  const url = (label: string, value: string, strike: boolean) => (
    <Box>
      <Typography variant="caption" color="text.secondary">{label}</Typography>
      <Typography variant="body2" sx={{ fontFamily: 'monospace', wordBreak: 'break-all', textDecoration: strike ? 'line-through' : 'none', color: strike ? 'text.secondary' : 'text.primary', fontWeight: strike ? 400 : 600 }}>
        <Blurred when={blur} inline radius={5}>{value}</Blurred>
      </Typography>
    </Box>
  );

  return (
    <Dialog
      open={open}
      onClose={busy ? undefined : onClose}
      maxWidth="xs"
      fullWidth
      aria-labelledby="rename-dialog-title"
      aria-describedby="rename-dialog-description"
    >
      <DialogTitle id="rename-dialog-title" sx={{ fontWeight: 700, pb: 1 }}>{t.renameConfirmTitle}</DialogTitle>
      <DialogContent>
        <Stack spacing={0.75} sx={{ mb: 2, p: 1.5, borderRadius: 2, bgcolor: 'action.hover' }}>
          {url(t.renameOld, oldUrl, true)}
          <Box sx={{ color: 'text.secondary', display: 'flex' }} aria-hidden><AppIcon icon={ArrowDown} size="sm" /></Box>
          {url(t.renameNew, newUrl, false)}
        </Stack>
        <DialogContentText id="rename-dialog-description" variant="body2">
          {t.renameConfirmBody}
        </DialogContentText>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} color="inherit" disabled={busy}>{t.cancel}</Button>
        <Button variant="contained" disableElevation color="warning" onClick={onConfirm} disabled={busy} autoFocus>
          {busy ? t.saving : t.renameConfirm}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
