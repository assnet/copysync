import { Button, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from '@mui/material';
import { linkRotationStrings } from '../strings';
import type { Rotation, RotationOverview } from '../types';

const t = linkRotationStrings.config;

export interface RotationConfigDialogProps {
  /** Diálogo visível. */
  open: boolean;
  /** Fechar sem salvar (cancelar, ESC, clique fora). Quem chama limpa o estado persistido do diálogo. */
  onClose: () => void;
  /** Rodízio a editar; ausente = criação. */
  rotation?: Rotation;
  /** Overview atual: domínios ativos, sessões e limites do plano (para selects e regras). */
  overview: RotationOverview;
  /** Chamado com o rodízio devolvido pela API após criar/editar/renomear. */
  onSaved: (rotation: Rotation) => void;
}

/**
 * Configuração do rodízio (sessão, domínio, nome com preview, estratégia, apelido).
 * PLACEHOLDER da T16 — implementação completa na T17 (`design.md` §5).
 */
export function RotationConfigDialog({ open, onClose, rotation }: RotationConfigDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{rotation ? t.editTitle : t.createTitle}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary">{t.slugHelp}</Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t.close}</Button>
      </DialogActions>
    </Dialog>
  );
}
