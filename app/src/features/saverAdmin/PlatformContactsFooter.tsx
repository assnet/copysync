import { Box, Button, CircularProgress, Typography, useTheme } from '@mui/material';
import { formatCount } from './format';
import { NUMERIC, REDUCED_MOTION, toneFill, trackColor } from './platformContactsStyle';
import { saverAdminStrings as s } from './strings';

interface Props {
  shown: number;
  /** Total que casa com os filtros (dos indicadores); null = indicadores indisponíveis. */
  total: number | null;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
}

/**
 * Rodapé da lista: "Mostrando X de Y" com barra fina de quanto já foi carregado e o "Carregar mais".
 * Sem o total (indicadores fora), cai no texto só com a quantidade exibida.
 */
export function PlatformContactsFooter({ shown, total, hasMore, loadingMore, onLoadMore }: Props) {
  const theme = useTheme();
  // A lista pode ter crescido depois da contagem: nunca "60 de 50".
  const known = total !== null ? Math.max(total, shown) : null;
  const pct = known ? Math.min((shown / known) * 100, 100) : null;

  return (
    <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, alignItems: { xs: 'stretch', sm: 'center' }, justifyContent: 'space-between', gap: 1.5 }}>
      <Box sx={{ minWidth: 0, flex: 1, maxWidth: { sm: 360 } }}>
        <Typography variant="body2" color="text.secondary" aria-live="polite" sx={NUMERIC}>
          {known !== null ? s.table.showing(formatCount(shown), formatCount(known)) : s.table.shown(shown)}
          {hasMore ? '' : ` · ${s.table.end}`}
        </Typography>
        {pct !== null && (
          <Box
            role="progressbar" aria-label={s.table.progress} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}
            sx={{ mt: 0.75, height: 4, borderRadius: 2, bgcolor: trackColor(theme), overflow: 'hidden' }}
          >
            <Box sx={{ width: `${pct}%`, height: '100%', borderRadius: 2, bgcolor: toneFill(theme, 'primary', true), transition: 'width 240ms ease-out', [REDUCED_MOTION]: { transition: 'none' } }} />
          </Box>
        )}
      </Box>
      {hasMore && (
        <Button
          variant="outlined"
          onClick={onLoadMore}
          disabled={loadingMore}
          startIcon={loadingMore ? <CircularProgress size={16} color="inherit" /> : undefined}
          sx={{ minHeight: 40 }}
        >
          {loadingMore ? s.table.loadingMore : s.table.loadMore}
        </Button>
      )}
    </Box>
  );
}
