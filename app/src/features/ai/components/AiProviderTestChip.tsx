import { Chip, Tooltip } from '@mui/material';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import type { AiProviderTestResult } from '@/types/api.types';
import { aiErrorCodeMessage, aiStrings } from '../strings';

/** Resultado do último teste; em falha, o motivo amigável fica no tooltip. */
export function AiProviderTestChip({ result }: { result: AiProviderTestResult }) {
  if (result.ok) {
    return (
      <Chip
        size="small"
        color="success"
        variant="outlined"
        icon={<CheckCircleOutlineIcon />}
        label={aiStrings.admin.testOk}
        role="status"
      />
    );
  }
  const reason = aiErrorCodeMessage(result.errorCode);
  return (
    <Tooltip title={reason}>
      <Chip
        size="small"
        color="error"
        variant="outlined"
        icon={<ErrorOutlineIcon />}
        label={aiStrings.admin.testFailed}
        role="status"
        aria-label={`${aiStrings.admin.testFailed}: ${reason}`}
      />
    </Tooltip>
  );
}
