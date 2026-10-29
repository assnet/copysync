import { Button, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from '@mui/material';
import { linkRotationStrings } from '../strings';
import type { Rotation, RotationGroup } from '../types';

const t = linkRotationStrings.groups;

export interface RotationGroupsDialogProps {
  /** Diálogo visível. */
  open: boolean;
  /** Fechar sem salvar. */
  onClose: () => void;
  /** Rodízio cujos grupos são editados (usa `sessionId`, `strategy` e `groups`). */
  rotation: Rotation;
  /** Máximo de grupos por rodízio no plano (`limits.linkRotationGroups`); `null` = ilimitado. */
  limit: number | null;
  /** Chamado com a lista salva (resposta do PUT `/:id/groups`). */
  onSaved: (groups: RotationGroup[]) => void;
}

/**
 * Seleção e ajuste dos grupos do rodízio (busca, ordem, peso, teto, link AUTO/MANUAL).
 * PLACEHOLDER da T16 — implementação completa na T18 (`design.md` §5).
 */
export function RotationGroupsDialog({ open, onClose }: RotationGroupsDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{t.title}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary">{t.subtitle}</Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t.close}</Button>
      </DialogActions>
    </Dialog>
  );
}
