import { Alert, Box, Chip, IconButton, LinearProgress, Stack, Tooltip, Typography } from '@mui/material';
import { X } from 'lucide-react';
import { AppIcon } from '@/components';
import type { HuntProvider, HuntRunResult } from '../types';
import { offerHunterErrorMessage, offerHunterStrings as t, pauseReasonText } from '../strings';
import { RankingTable } from './RankingTable';
import { RejectionNote } from './RejectionNote';

interface Props {
  title: string;
  running: boolean;
  result: HuntRunResult | null;
  /** Erro rejeitado pelo `apiClient` ao rodar (teto do dia, limite de buscas…). */
  error: unknown;
  /** Loja da caçada (textos de pausa e de recusa). Padrão SHEIN. */
  provider?: HuntProvider;
  onClose?: () => void;
}

const test = t.wizard.test;

/** Resultado de "Testar agora"/"Rodar agora": resumo, IA usada/indisponível, pausa automática e ranking. */
export function RunResultPanel({ title, running, result, error, provider = 'SHEIN', onClose }: Props) {
  if (!running && !result && !error) return null;
  const failedMsg = result && result.status !== 'SUCCEEDED' && result.errorCode
    ? (t.errors[result.errorCode] ?? test.failed)
    : null;

  return (
    <Box component="section" aria-label={title} aria-busy={running} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, p: { xs: 1.5, sm: 2 } }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
        <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 700, flex: 1 }}>{title}</Typography>
        {onClose && !running && (
          <Tooltip title={t.detail.closeResult} arrow>
            <IconButton size="small" aria-label={t.detail.closeResult} onClick={onClose}><AppIcon icon={X} size="sm" /></IconButton>
          </Tooltip>
        )}
      </Box>

      {running && (
        <Box role="status" aria-live="polite">
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>{test.running}</Typography>
          <LinearProgress />
        </Box>
      )}

      {!running && error != null && <Alert severity="error" role="alert">{offerHunterErrorMessage(error)}</Alert>}

      {!running && result && (
        <Stack spacing={1.5}>
          {result.pausedReason && (
            <Alert severity="warning">
              <strong>{t.autoPausedTitle}.</strong> {pauseReasonText(result.pausedReason, provider)}
            </Alert>
          )}
          {failedMsg && !result.pausedReason && <Alert severity="error">{failedMsg}</Alert>}
          <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1 }} role="status" aria-live="polite">
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {test.summary(result.seenCount, result.matchedCount, result.chosenCount)}
            </Typography>
            {result.sentCount > 0 && <Chip size="small" color="success" variant="outlined" label={test.sent(result.sentCount)} />}
            <Chip size="small" variant="outlined" label={test.remainingToday(result.remainingToday)} />
            {result.aiUsed && !result.aiFallback && <Chip size="small" variant="outlined" color="primary" label={test.aiUsed} />}
          </Box>
          <RejectionNote rejectedBy={result.rejectedBy} matchedCount={result.matchedCount} provider={provider} />
          {result.aiFallback && <Alert severity="info">{test.aiFallback}</Alert>}
          <RankingTable items={result.ranking} />
        </Stack>
      )}
    </Box>
  );
}
