import { useState } from 'react';
import {
  Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Divider, FormControlLabel,
  Stack, Switch, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography,
} from '@mui/material';
import { Contact, Download, FileSpreadsheet, Info } from 'lucide-react';
import { AppIcon } from '@/components';
import { usePersistedState } from '@/hooks/usePersistedState';
import { saverService } from '@/services/saver.service';
import { describeSaverError } from '../../errors';
import { saverStrings } from '../../strings';
import type { SaverConfig, SaverExportFormat, SaverGroup } from '../../types';
import { downloadBlob } from './downloadFile';

const t = saverStrings.exportDialog;
/** Teto do prefixo (API: `SAVER_PREFIX_MAX`). */
export const SAVER_PREFIX_MAX = 40;
export const SAVER_EXPORT_OPTIONS_KEY = 'saver.export.options';

export interface ExportDraft {
  format: SaverExportFormat;
  prefix: string;
  excludeAdmins: boolean;
  onlyActive: boolean;
  onlyWithPhone: boolean;
  onePerGroup: boolean;
}

interface Props {
  open: boolean;
  /** Grupos que entram no arquivo (marcados ou todos). */
  groups: SaverGroup[];
  /** `true` = "todos os grupos salvos" (manda `'all'` para a API). */
  all: boolean;
  defaults: SaverConfig;
  onClose: () => void;
  onDone: (filename: string) => void;
}

/** Estimativa pelas contagens dos grupos (teto: contato em vários grupos e filtros reduzem). */
export function exportEstimate(groups: SaverGroup[], draft: Pick<ExportDraft, 'format' | 'onlyWithPhone'>) {
  const sum = (k: 'memberCount' | 'phoneCount' | 'lidOnlyCount') => groups.reduce((n, g) => n + g[k], 0);
  if (draft.format === 'VCARD') return { included: sum('phoneCount'), skipped: sum('lidOnlyCount') };
  return { included: draft.onlyWithPhone ? sum('phoneCount') : sum('memberCount'), skipped: 0 };
}

function Option({ label, hint, checked, onChange, disabled }: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
      <FormControlLabel
        control={<Switch checked={checked} onChange={(e) => onChange(e.target.checked)} disabled={disabled} />}
        label={label}
        sx={{ mr: 0 }}
      />
      <Tooltip title={hint} arrow>
        <Box component="span" tabIndex={0} aria-label={hint} sx={{ display: 'inline-flex', color: 'text.secondary', cursor: 'help' }}>
          <AppIcon icon={Info} size="sm" />
        </Box>
      </Tooltip>
    </Box>
  );
}

/** Exportar contatos dos grupos salvos em CSV ou vCard; o arquivo baixa por `Blob`. */
export function ExportDialog({ open, groups, all, defaults, onClose, onDone }: Props) {
  const [draft, setDraft, clearDraft] = usePersistedState<ExportDraft>(SAVER_EXPORT_OPTIONS_KEY, () => ({
    format: defaults.defaultFormat,
    prefix: defaults.namePrefix ?? '',
    excludeAdmins: defaults.excludeAdminsByDefault,
    onlyActive: false,
    onlyWithPhone: false,
    onePerGroup: false,
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof ExportDraft>(k: K, v: ExportDraft[K]) => {
    setDraft((d) => ({ ...d, [k]: v }));
    setError(null);
  };
  const csv = draft.format === 'CSV';
  const estimate = exportEstimate(groups, draft);

  const download = async () => {
    setBusy(true);
    setError(null);
    try {
      const file = await saverService.exportContacts({
        format: draft.format,
        groupIds: all ? 'all' : groups.map((g) => g.id),
        options: {
          prefix: draft.prefix.trim() || null,
          excludeAdmins: draft.excludeAdmins,
          onlyActive: draft.onlyActive,
          ...(csv && { onlyWithPhone: draft.onlyWithPhone, onePerGroup: draft.onePerGroup }),
        },
      });
      downloadBlob(file.blob, file.filename);
      clearDraft();
      onDone(file.filename);
    } catch (err) {
      const e = describeSaverError(err);
      setError(e.kind === 'forbidden' ? t.forbidden : e.kind === 'exportEmpty' ? t.empty : e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth aria-labelledby="saver-export-title">
      <DialogTitle id="saver-export-title">{t.title}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <Typography variant="body2" color="text.secondary">{all ? t.scopeAll(groups.length) : t.scopeSelected(groups.length)}</Typography>

          <Box>
            <Typography variant="subtitle2" id="saver-export-format" sx={{ mb: 1 }}>{t.format}</Typography>
            <ToggleButtonGroup
              exclusive
              fullWidth
              size="small"
              value={draft.format}
              onChange={(_, v: SaverExportFormat | null) => v && set('format', v)}
              aria-labelledby="saver-export-format"
            >
              <ToggleButton value="CSV" sx={{ gap: 1 }}><AppIcon icon={FileSpreadsheet} size="sm" />{t.formats.CSV}</ToggleButton>
              <ToggleButton value="VCARD" sx={{ gap: 1 }}><AppIcon icon={Contact} size="sm" />{t.formats.VCARD}</ToggleButton>
            </ToggleButtonGroup>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>{t.formatHints[draft.format]}</Typography>
          </Box>

          <TextField
            size="small"
            label={t.prefix}
            placeholder={t.prefixPlaceholder}
            value={draft.prefix}
            onChange={(e) => set('prefix', e.target.value.slice(0, SAVER_PREFIX_MAX))}
            helperText={`${t.prefixHelp(SAVER_PREFIX_MAX)} ${draft.prefix.length}/${SAVER_PREFIX_MAX}`}
            slotProps={{ htmlInput: { maxLength: SAVER_PREFIX_MAX } }}
          />

          <Stack spacing={0.5}>
            <Option label={t.excludeAdmins} hint={t.excludeAdminsHint} checked={draft.excludeAdmins} onChange={(v) => set('excludeAdmins', v)} disabled={busy} />
            <Option label={t.onlyActive} hint={t.onlyActiveHint} checked={draft.onlyActive} onChange={(v) => set('onlyActive', v)} disabled={busy} />
            {csv && (
              <>
                <Option label={t.onlyWithPhone} hint={t.onlyWithPhoneHint} checked={draft.onlyWithPhone} onChange={(v) => set('onlyWithPhone', v)} disabled={busy} />
                <Option label={t.onePerGroup} hint={t.onePerGroupHint} checked={draft.onePerGroup} onChange={(v) => set('onePerGroup', v)} disabled={busy} />
              </>
            )}
          </Stack>

          <Divider />
          <Box aria-live="polite">
            <Typography variant="subtitle2">{t.summaryTitle}</Typography>
            <Typography variant="body1" sx={{ fontWeight: 700 }}>{t.summaryIncluded(estimate.included)}</Typography>
            <Typography variant="caption" color="text.secondary">{t.summaryHint}</Typography>
            {estimate.skipped > 0 && <Alert severity="warning" sx={{ mt: 1 }}>{t.summaryVcardSkipped(estimate.skipped)}</Alert>}
          </Box>
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>{t.cancel}</Button>
        <Button
          variant="contained"
          onClick={() => void download()}
          disabled={busy || groups.length === 0}
          startIcon={busy ? <CircularProgress size={16} color="inherit" /> : <AppIcon icon={Download} size="sm" />}
        >
          {busy ? t.downloading : t.download}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
