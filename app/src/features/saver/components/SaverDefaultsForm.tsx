import { useId } from 'react';
import { Box, Stack, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography } from '@mui/material';
import { FileSpreadsheet, Contact } from 'lucide-react';
import { AppIcon, ToggleOption, UnavailableReason } from '@/components';
import { saverStrings as s } from '../strings';
import { SAVER_PREFIX_MAX, type SaverConfig, type SaverExportFormat } from '../types';

interface Props {
  value: SaverConfig;
  onChange: (patch: Partial<SaverConfig>) => void;
  /** `OPERATOR`: tudo desabilitado. */
  readOnly: boolean;
  /** Plano inclui a atualização diária. */
  autoRefreshAvailable: boolean;
}

const FORMATS: { id: SaverExportFormat; icon: typeof FileSpreadsheet }[] = [
  { id: 'CSV', icon: FileSpreadsheet },
  { id: 'VCARD', icon: Contact },
];

/** Campos dos padrões da exportação (prefixo, administradores, formato, atualização diária). */
export function SaverDefaultsForm({ value, onChange, readOnly, autoRefreshAvailable }: Props) {
  const prefix = value.namePrefix ?? '';
  const tooLong = prefix.length > SAVER_PREFIX_MAX;
  const t = s.settings;
  const autoRefreshLocked = readOnly || !autoRefreshAvailable;
  const formatLabelId = useId();

  return (
    <Stack spacing={2.5}>
      <TextField
        label={t.prefix.label}
        placeholder={t.prefix.placeholder}
        value={prefix}
        disabled={readOnly}
        onChange={(e) => onChange({ namePrefix: e.target.value })}
        error={tooLong}
        helperText={
          <Box component="span" sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}>
            <span>{tooLong ? t.prefix.tooLong(SAVER_PREFIX_MAX) : prefix.trim() ? t.prefix.example(prefix.trim()) : t.prefix.help}</span>
            <span aria-hidden>{t.prefix.counter(prefix.length, SAVER_PREFIX_MAX)}</span>
          </Box>
        }
        slotProps={{ htmlInput: { maxLength: SAVER_PREFIX_MAX + 10, autoComplete: 'off' } }}
        fullWidth
      />

      <ToggleOption
        checked={value.excludeAdminsByDefault}
        onChange={(v) => onChange({ excludeAdminsByDefault: v })}
        title={t.excludeAdmins.title}
        description={t.excludeAdmins.description}
        disabled={readOnly}
      />

      <Box>
        <Typography id={formatLabelId} variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>{t.format.label}</Typography>
        <ToggleButtonGroup
          exclusive
          value={value.defaultFormat}
          onChange={(_e, v: SaverExportFormat | null) => { if (v) onChange({ defaultFormat: v }); }}
          disabled={readOnly}
          aria-labelledby={formatLabelId}
          size="small"
          sx={{ flexWrap: 'wrap' }}
        >
          {FORMATS.map((f) => {
            const button = (
              <ToggleButton key={f.id} value={f.id} sx={{ gap: 1, px: 2, textTransform: 'none' }}>
                <AppIcon icon={f.icon} size="inline" />
                {t.format[f.id]}
              </ToggleButton>
            );
            // Botão desabilitado não dispara a dica (e o MUI avisa): só leitura fica sem Tooltip
            return readOnly ? button : <Tooltip key={f.id} title={t.format.help[f.id]} arrow describeChild>{button}</Tooltip>;
          })}
        </ToggleButtonGroup>
        <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 0.75 }}>
          {t.format.help[value.defaultFormat]}
        </Typography>
      </Box>

      <Tooltip title={!readOnly && !autoRefreshAvailable ? t.autoRefresh.unavailable : ''} placement="top-start" arrow>
        {/* Elemento desabilitado não dispara eventos: o Box recebe o foco/hover da dica */}
        <Box tabIndex={!readOnly && !autoRefreshAvailable ? 0 : undefined} sx={{ borderRadius: 2 }}>
          <ToggleOption
            checked={autoRefreshAvailable && value.autoRefresh}
            onChange={(v) => onChange({ autoRefresh: v })}
            title={t.autoRefresh.title}
            description={t.autoRefresh.description}
            disabled={autoRefreshLocked}
          />
          {!autoRefreshAvailable && <UnavailableReason text={t.autoRefresh.unavailableShort} />}
        </Box>
      </Tooltip>
    </Stack>
  );
}
