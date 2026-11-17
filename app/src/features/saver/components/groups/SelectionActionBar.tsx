import { Box, Button, CircularProgress, IconButton, Tooltip, Typography, useMediaQuery, type Theme } from '@mui/material';
import { Save, X } from 'lucide-react';
import { AppIcon } from '@/components';
import { saverStrings } from '../../strings';
import { selectionBarSx } from '../../saverStyle';

const t = saverStrings.groups.table;

interface Props {
  count: number;
  max: number;
  tooMany: boolean;
  members: { total: number; partial: boolean } | null;
  scansLeft: number | null;
  requesting: boolean;
  submitDisabled: boolean;
  submitHint: string;
  onClear: () => void;
  onSubmit: () => void;
}

/**
 * Contagem dos marcados, membros, "Limpar seleção" e "Salvar contatos". Com algo marcado fica presa
 * ao rodapé da área visível (sticky), sem rolagem própria.
 */
export function SelectionActionBar({
  count, max, tooMany, members, scansLeft, requesting, submitDisabled, submitHint, onClear, onSubmit,
}: Props) {
  const sticky = count > 0;
  // Celular: "Limpar" vira ícone para a barra caber em duas linhas sem cobrir a lista.
  const compact = useMediaQuery((theme: Theme) => theme.breakpoints.down('sm'));
  return (
    <Box
      role="region"
      aria-label={t.selectionBar}
      data-sticky={sticky ? 'true' : 'false'}
      sx={(theme) => ({
        display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 1.5, rowGap: 1,
        ...selectionBarSx(theme, sticky),
      })}
    >
      <Box sx={{ mr: 'auto', minWidth: 0 }} aria-live="polite">
        <Typography variant="body2" sx={{ fontWeight: sticky ? 600 : 400 }} color={tooMany ? 'error.main' : sticky ? 'text.primary' : 'text.secondary'}>
          {t.selected(count, max)}
        </Typography>
        {members && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
            {t.selectedMembers(members.total, members.partial)}
          </Typography>
        )}
        {scansLeft !== null && (
          <Typography variant="caption" color="text.secondary" sx={{ display: { xs: sticky ? 'none' : 'block', sm: 'block' } }}>
            {t.scansLeft(scansLeft)}
          </Typography>
        )}
      </Box>
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', ml: { xs: 'auto', sm: 0 } }}>
        {count > 0 && (compact ? (
          <Tooltip title={t.clear}>
            <span>
              <IconButton aria-label={t.clear} onClick={onClear} disabled={requesting}>
                <AppIcon icon={X} size="sm" />
              </IconButton>
            </span>
          </Tooltip>
        ) : (
          <Button onClick={onClear} disabled={requesting}>{t.clear}</Button>
        ))}
        <Tooltip title={submitHint}>
          <span>
            <Button
              variant="contained"
              startIcon={requesting ? <CircularProgress size={16} color="inherit" /> : <AppIcon icon={Save} size="sm" />}
              disabled={submitDisabled}
              onClick={onSubmit}
            >
              {t.submit(count)}
            </Button>
          </span>
        </Tooltip>
      </Box>
    </Box>
  );
}
