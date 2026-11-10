import { Box, Card, Typography } from '@mui/material';
import { CirclePause } from 'lucide-react';
import { AppIcon } from '@/components';
import { opsMetricsStrings as t } from '../strings';

/** Destaca nomes de variável (MAIÚSCULAS_COM_SUBLINHADO=valor) em `<code>`. */
function withCode(text: string) {
  return text.split(/([A-Z][A-Z0-9_]{3,}(?:=\w+)?)/g).map((part, i) =>
    (i % 2 === 1
      ? <Box key={part} component="code" sx={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: '0.9em', bgcolor: 'action.hover', px: 0.5, borderRadius: 0.5 }}>{part}</Box>
      : part));
}

/** Coleta desligada e nenhuma amostra no período: instruções em vez de gráficos vazios. */
export function CollectionOffState() {
  return (
    <Card sx={{ mt: 3 }}>
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', px: { xs: 2, sm: 4 }, py: 6 }}>
        <Box sx={{ color: 'text.secondary', mb: 2 }}><AppIcon icon={CirclePause} size="lg" aria-hidden /></Box>
        <Typography variant="h6" component="h2">{t.off.title}</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>{t.off.description}</Typography>
        <Box component="ol" sx={{ textAlign: 'left', maxWidth: 560, mt: 2, mb: 0, pl: 3, '& li': { mb: 1 } }}>
          {t.off.steps.map((step) => (
            <Typography key={step} component="li" variant="body2">{withCode(step)}</Typography>
          ))}
        </Box>
      </Box>
    </Card>
  );
}
