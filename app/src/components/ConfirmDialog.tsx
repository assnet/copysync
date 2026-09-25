import { Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions, Button } from '@mui/material';

interface Props {
  open: boolean;
  title: string;
  /** Explica a consequência da ação; vira o `aria-describedby` do diálogo. */
  description: string;
  confirmLabel: string;
  cancelLabel: string;
  /** `error` para ações destrutivas (excluir, remover). */
  confirmColor?: 'primary' | 'error';
  onConfirm: () => void;
  onClose: () => void;
}

/**
 * Confirmação de duas ações, sem estado próprio: quem abre decide o que acontece ao
 * confirmar e ao cancelar. Esc e clique fora contam como cancelar.
 */
export function ConfirmDialog({
  open, title, description, confirmLabel, cancelLabel, confirmColor = 'primary', onConfirm, onClose,
}: Props) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="xs"
      fullWidth
      aria-labelledby="confirm-dialog-title"
      aria-describedby="confirm-dialog-description"
    >
      <DialogTitle id="confirm-dialog-title" sx={{ fontWeight: 700, pb: 1 }}>{title}</DialogTitle>
      <DialogContent>
        <DialogContentText id="confirm-dialog-description">{description}</DialogContentText>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} color="inherit">{cancelLabel}</Button>
        <Button variant="contained" disableElevation color={confirmColor} onClick={onConfirm} autoFocus>
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
