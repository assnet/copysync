import { Button, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { linkRotationStrings } from '../strings';

const t = linkRotationStrings.upgrade;

export interface PlanLimitBannerProps {
  /** Aviso visível. */
  open: boolean;
  /** Dispensar ("Agora não"). */
  onClose: () => void;
  /** Qual limite foi atingido: rodízios do tenant ou grupos por rodízio. */
  kind: 'rotations' | 'groups';
  /** Limite atual do plano para o `kind` (número, nunca ilimitado: sem limite não há aviso). */
  limit: number;
}

/**
 * Aviso de upgrade quando o plano não comporta mais rodízios/grupos, com CTA para `/plans`.
 * PLACEHOLDER da T16 — versão animada (gradiente, `Sparkles`, reduced-motion) na T18.
 */
export function PlanLimitBanner({ open, onClose, kind, limit }: PlanLimitBannerProps) {
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>{kind === 'rotations' ? t.rotationsTitle : t.groupsTitle}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary">
          {kind === 'rotations' ? t.rotationsBody(limit) : t.groupsBody(limit)}
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t.dismiss}</Button>
        <Button variant="contained" component={RouterLink} to="/plans" onClick={onClose}>{t.cta}</Button>
      </DialogActions>
    </Dialog>
  );
}
