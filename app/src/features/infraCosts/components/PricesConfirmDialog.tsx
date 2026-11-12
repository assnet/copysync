import { useEffect, useState } from 'react';
import {
  Alert, Button, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, Stack, Table, TableBody,
  TableCell, TableHead, TableRow, Tooltip, Typography, useMediaQuery, useTheme,
} from '@mui/material';
import { toneChipSx } from './costParts';
import { changeLabel, changeValue, isConflictPath } from '../rules';
import { infraCostsStrings as S } from '../strings';
import type { InfraCostSettings, InfraCostSettingsChange } from '../types';

const p = S.prices;
const r = S.pricesReview;

interface Props {
  open: boolean;
  changes: InfraCostSettingsChange[];
  before: InfraCostSettings;
  after: InfraCostSettings | null;
  /** Caminhos em conflito do merge do 409: linha marcada e salvar só depois de "Revisei". */
  conflicts?: readonly string[];
  saving: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

/** Confirmação da aba Preços: o que muda, antes × depois (COST-08). */
export function PricesConfirmDialog({ open, changes, before, after, conflicts = [], saving, onConfirm, onClose }: Props) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'), { noSsr: true });
  const next = after ?? before;
  const conflicted = (path: string) => isConflictPath(path, conflicts);
  const conflictCount = changes.filter((ch) => conflicted(ch.path)).length;
  const [reviewed, setReviewed] = useState(false);
  // Cada abertura pede a revisão de novo.
  useEffect(() => { if (open) setReviewed(false); }, [open]);
  const blocked = conflictCount > 0 && !reviewed;
  return (
    <Dialog
      open={open}
      onClose={saving ? undefined : onClose}
      maxWidth="md"
      fullWidth
      fullScreen={fullScreen}
      aria-labelledby="cost-prices-confirm-title"
    >
      <DialogTitle id="cost-prices-confirm-title" sx={{ fontWeight: 700 }}>{p.confirm.title}</DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          <Typography variant="body2" color="text.secondary">{p.confirm.intro}</Typography>
          {conflictCount > 0 && <Alert severity="warning">{r.conflictIntro(conflictCount)}</Alert>}
          {changes.length === 0 ? (
            <Typography variant="body2">{S.diff.empty}</Typography>
          ) : (
            <Table size="small" aria-label={p.confirm.title} sx={{ '& td, & th': { px: { xs: 1, sm: 2 } } }}>
              <TableHead>
                <TableRow>
                  <TableCell>{p.confirm.field}</TableCell>
                  <TableCell align="right">{p.confirm.before}</TableCell>
                  <TableCell align="right">{p.confirm.after}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {changes.map((c) => (
                  <TableRow key={`${c.kind}:${c.path}`} selected={conflicted(c.path)}>
                    <TableCell sx={{ wordBreak: 'break-word' }}>
                      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                        <span>{changeLabel(c.path, before, next)}</span>
                        {c.kind !== 'changed' && (
                          <Chip size="small" variant="outlined" label={S.diff[c.kind]} sx={toneChipSx(c.kind === 'added' ? 'success' : 'error')} />
                        )}
                        {conflicted(c.path) && (
                          <Tooltip title={r.conflictTip} describeChild>
                            <Chip
                              size="small"
                              color="warning"
                              label={r.conflictChip}
                              tabIndex={0}
                              sx={{ '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 } }}
                            />
                          </Tooltip>
                        )}
                      </Stack>
                    </TableCell>
                    <TableCell align="right" sx={{ color: 'text.secondary', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                      {c.kind === 'added' ? S.noValue : changeValue(c.path, c.from)}
                    </TableCell>
                    <TableCell align="right" sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                      {c.kind === 'removed' ? S.noValue : changeValue(c.path, c.to)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {conflictCount > 0 && (
            <FormControlLabel
              control={<Checkbox checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} />}
              label={r.conflictAck}
            />
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={saving}>{p.confirm.cancel}</Button>
        <Button variant="contained" onClick={onConfirm} disabled={saving || changes.length === 0 || !after || blocked}>
          {saving ? p.confirm.saving : p.confirm.save}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
