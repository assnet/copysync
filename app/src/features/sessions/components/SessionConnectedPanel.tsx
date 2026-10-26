import { Box, Typography, Alert, alpha } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircleRounded';
import type { SessionItem } from '@/types/api.types';
import { sessionStrings } from '../strings';
import { formatBrazilPhone } from '../utils';

const t = sessionStrings.done;

/** Passo final: confirma a conexão e avisa quando o número conectado não é o informado. */
export function SessionConnectedPanel({ session }: { session: SessionItem | null }) {
  const phone = session?.phone ? formatBrazilPhone(session.phone) : null;

  return (
    <Box sx={{ display: 'grid', justifyItems: 'center', textAlign: 'center', gap: 2, py: 2 }}>
      <Box
        sx={{
          width: 72, height: 72, borderRadius: '50%', display: 'grid', placeItems: 'center',
          bgcolor: (th) => alpha(th.palette.success.main, 0.12), color: 'success.main',
        }}
      >
        <CheckCircleIcon sx={{ fontSize: 44 }} aria-hidden />
      </Box>
      <Box>
        <Typography variant="h6" component="h2" fontWeight={700}>{t.title}</Typography>
        <Typography variant="body2" color="text.secondary" mt={0.5}>{t.body}</Typography>
      </Box>

      {phone && (
        <Box sx={{ px: 2, py: 1, borderRadius: 2, bgcolor: 'action.hover' }}>
          <Typography variant="caption" color="text.secondary" display="block">{t.connectedAs}</Typography>
          <Typography variant="subtitle1" fontWeight={700}>{phone}</Typography>
        </Box>
      )}

      {session?.phoneMismatch && (
        <Alert severity="warning" sx={{ textAlign: 'left', width: '100%' }}>
          {t.mismatch(phone ?? '')}
        </Alert>
      )}
    </Box>
  );
}
