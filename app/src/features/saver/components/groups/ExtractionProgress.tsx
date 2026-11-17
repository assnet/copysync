import { Alert, Box, Button, LinearProgress, Paper, Tooltip, Typography } from '@mui/material';
import { CircleCheck, CircleX, Hourglass, LoaderCircle } from 'lucide-react';
import { AppIcon } from '@/components';
import { saverStrings } from '../../strings';
import { isExtractionActive, type SaverExtraction } from '../../types';

const t = saverStrings.groups.progress;

interface Props {
  extraction: SaverExtraction;
  onCancel: () => void;
  onClose: () => void;
  cancelling?: boolean;
}

const ICONS = { QUEUED: Hourglass, RUNNING: LoaderCircle, DONE: CircleCheck, PARTIAL: CircleCheck, FAILED: CircleX, CANCELLED: CircleX };
const TONE = { QUEUED: 'info', RUNNING: 'info', DONE: 'success', PARTIAL: 'warning', FAILED: 'error', CANCELLED: 'warning' } as const;

/** Progresso da leitura: só contagens (grupos feitos, membros, contatos novos). */
export function ExtractionProgress({ extraction: e, onCancel, onClose, cancelling }: Props) {
  const active = isExtractionActive(e.status);
  const finished = e.doneGroups + e.failedGroups;
  const pct = e.totalGroups > 0 ? Math.round((finished / e.totalGroups) * 100) : 0;
  const tone = TONE[e.status];

  return (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, borderColor: `${tone}.main` }} aria-live="polite" aria-busy={active}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        <Box component="span" sx={{ display: 'inline-flex', color: `${tone}.main` }}><AppIcon icon={ICONS[e.status]} size="md" /></Box>
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>{t.status[e.status]}</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ ml: 'auto' }}>{t.groups(finished, e.totalGroups)}</Typography>
      </Box>
      <LinearProgress
        variant={e.status === 'QUEUED' ? 'indeterminate' : 'determinate'}
        value={pct}
        color={tone}
        aria-label={t.title}
        sx={{ height: 8, borderRadius: 4, mb: 1.5 }}
      />
      <Box sx={{ display: 'flex', flexWrap: 'wrap', columnGap: 2, rowGap: 0.5 }}>
        <Typography variant="body2">{t.members(e.membersFound)}</Typography>
        <Typography variant="body2">{t.newContacts(e.newContacts)}</Typography>
        {e.failedGroups > 0 && <Typography variant="body2" color="error.main">{t.failed(e.failedGroups)}</Typography>}
      </Box>
      {active && <Alert severity="info" variant="outlined" sx={{ mt: 1.5, py: 0 }}>{t.paceHint}</Alert>}
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, mt: 1.5 }}>
        {active ? (
          <Tooltip title={t.cancelHint}>
            <span>
              <Button color="warning" onClick={onCancel} disabled={cancelling}>{t.cancel}</Button>
            </span>
          </Tooltip>
        ) : (
          <Button onClick={onClose}>{t.close}</Button>
        )}
      </Box>
    </Paper>
  );
}
