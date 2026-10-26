import { Box, Stack, Switch, Tooltip, Typography } from '@mui/material';
import { SectionCard } from '@/components';
import type { AiPlatformSettings } from '@/types/api.types';
import { aiStrings } from '../strings';

const t = aiStrings.admin;

interface Props {
  settings: AiPlatformSettings;
  saving: boolean;
  onChange: (next: AiPlatformSettings) => void;
}

interface RowProps {
  label: string;
  help: string;
  checked: boolean;
  /** É a única opção ligada: desligar quebraria a regra "pelo menos uma". */
  locked: boolean;
  disabled: boolean;
  onToggle: (value: boolean) => void;
}

function ModeRow({ label, help, checked, locked, disabled, onToggle }: RowProps) {
  const control = (
    <Switch
      checked={checked}
      disabled={disabled || locked}
      onChange={(_, v) => onToggle(v)}
      inputProps={{ 'aria-label': label }}
    />
  );
  return (
    <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2 }}>
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="body2" fontWeight={600}>{label}</Typography>
        <Typography variant="caption" color="text.secondary">{help}</Typography>
      </Box>
      {locked ? (
        <Tooltip title={t.lastModeLocked} placement="left">
          {/* span: Tooltip precisa de filho que receba eventos com o Switch desabilitado */}
          <span>{control}</span>
        </Tooltip>
      ) : (
        control
      )}
    </Box>
  );
}

/** Dois modos de IA para os clientes; a UI impede desligar o último ligado. */
export function AiModeSwitches({ settings, saving, onChange }: Props) {
  const { platformEnabled, tenantKeysEnabled } = settings;
  return (
    <SectionCard title={t.modesTitle} subtitle={t.modesSubtitle} sx={{ mb: 3 }}>
      <Stack spacing={2.5}>
        <ModeRow
          label={t.platformSwitch}
          help={t.platformSwitchHelp}
          checked={platformEnabled}
          locked={platformEnabled && !tenantKeysEnabled}
          disabled={saving}
          onToggle={(v) => onChange({ ...settings, platformEnabled: v })}
        />
        <ModeRow
          label={t.tenantKeysSwitch}
          help={t.tenantKeysSwitchHelp}
          checked={tenantKeysEnabled}
          locked={tenantKeysEnabled && !platformEnabled}
          disabled={saving}
          onToggle={(v) => onChange({ ...settings, tenantKeysEnabled: v })}
        />
      </Stack>
    </SectionCard>
  );
}
