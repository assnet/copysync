import { Box, Button, Paper, Stack, Tooltip, Typography, alpha } from '@mui/material';
import { Trash2, TriangleAlert } from 'lucide-react';
import { AppIcon } from '@/components';
import { storefrontStrings } from '../strings';

const t = storefrontStrings.dangerZone;

export interface StorefrontDangerZoneProps {
  /** Abre o diálogo que pede a senha; nada é apagado aqui. */
  onDelete: () => void;
}

/** Fim da tela da Página de Ofertas: ação de excluir a página. Só renderize para quem pode excluir. */
export function StorefrontDangerZone({ onDelete }: StorefrontDangerZoneProps) {
  return (
    <Paper
      component="section"
      variant="outlined"
      aria-labelledby="storefront-danger-zone-title"
      sx={(theme) => ({
        p: { xs: 2, sm: 2.5 },
        borderRadius: 3,
        borderColor: alpha(theme.palette.error.main, theme.palette.mode === 'dark' ? 0.5 : 0.35),
        bgcolor: alpha(theme.palette.error.main, theme.palette.mode === 'dark' ? 0.08 : 0.03),
      })}
    >
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }} justifyContent="space-between">
        <Box sx={{ minWidth: 0 }}>
          <Typography
            id="storefront-danger-zone-title" variant="subtitle1" component="h2" color="error"
            sx={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 1 }}
          >
            <AppIcon icon={TriangleAlert} size="inline" />
            {t.title}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, maxWidth: 640 }}>{t.description}</Typography>
        </Box>
        <Tooltip title={t.buttonTooltip} arrow describeChild>
          <Button
            variant="outlined" color="error" onClick={onDelete}
            startIcon={<AppIcon icon={Trash2} size="sm" />}
            sx={{ flexShrink: 0, minHeight: 44, alignSelf: { xs: 'stretch', sm: 'center' } }}
          >
            {t.button}
          </Button>
        </Tooltip>
      </Stack>
    </Paper>
  );
}
