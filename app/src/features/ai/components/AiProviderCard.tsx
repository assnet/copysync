import {
  Box, Button, Card, CardContent, Chip, CircularProgress, IconButton, Stack, Switch, Tooltip, Typography,
} from '@mui/material';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import PlayArrowOutlinedIcon from '@mui/icons-material/PlayArrowOutlined';
import type { AiPlatformProvider, AiProviderTestResult } from '@/types/api.types';
import { aiStrings } from '../strings';
import { aiProviderName } from '../aiProviders';
import { AiProviderTestChip } from './AiProviderTestChip';

const t = aiStrings.admin;

interface Props {
  provider: AiPlatformProvider;
  busy?: boolean;
  testing?: boolean;
  testResult?: AiProviderTestResult;
  onToggle: (enabled: boolean) => void;
  onTest: () => void;
  onEdit: () => void;
  onRemove: () => void;
}

export function AiProviderCard({ provider, busy, testing, testResult, onToggle, onTest, onEdit, onRemove }: Props) {
  const p = provider;
  return (
    <Card variant="outlined" sx={{ opacity: p.enabled ? 1 : 0.75 }}>
      <CardContent sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, gap: 2, '&:last-child': { pb: 2 } }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <Typography variant="subtitle2" noWrap>{p.label}</Typography>
            <Chip size="small" label={aiProviderName(p.kind)} />
            {!p.hasKey && <Chip size="small" color="warning" variant="outlined" label={t.keyMissing} />}
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ fontFamily: 'monospace', mt: 0.5, wordBreak: 'break-all' }}>
            {p.model}
          </Typography>
          {p.baseUrl && (
            <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace', display: 'block', wordBreak: 'break-all' }}>
              {p.baseUrl}
            </Typography>
          )}
          <Stack direction="row" spacing={1} mt={1} flexWrap="wrap" useFlexGap>
            <Chip size="small" variant="outlined" label={t.priorityValue(p.priority)} />
            <Chip size="small" variant="outlined" label={t.dailyLimitValue(p.dailyLimitPerTenant)} />
            {testResult && <AiProviderTestChip result={testResult} />}
          </Stack>
        </Box>

        <Stack direction="row" spacing={0.5} alignItems="center" justifyContent={{ xs: 'space-between', sm: 'flex-end' }}>
          <Tooltip title={t.enabledToggle}>
            <Switch
              checked={p.enabled}
              disabled={busy}
              onChange={(_, v) => onToggle(v)}
              inputProps={{ 'aria-label': t.enableAria(p.label) }}
            />
          </Tooltip>
          <Button
            size="small"
            variant="outlined"
            onClick={onTest}
            disabled={testing || !p.hasKey}
            startIcon={testing ? <CircularProgress size={14} /> : <PlayArrowOutlinedIcon />}
          >
            {testing ? t.testing : t.test}
          </Button>
          <Tooltip title={t.edit}>
            <IconButton onClick={onEdit} aria-label={t.editAria(p.label)}><EditOutlinedIcon fontSize="small" /></IconButton>
          </Tooltip>
          <Tooltip title={t.remove}>
            <IconButton onClick={onRemove} aria-label={t.removeAria(p.label)} color="error">
              <DeleteOutlineIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>
      </CardContent>
    </Card>
  );
}
