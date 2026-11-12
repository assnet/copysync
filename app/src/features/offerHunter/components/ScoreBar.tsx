import { Box, ButtonBase, LinearProgress, Stack, Tooltip, Typography } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import type { HuntScoreFactor } from '../types';
import { offerHunterStrings as t } from '../strings';

/** Conteúdo do Tooltip: cada fator com pontos e explicação curta. */
export function ScoreFactorsList({ factors }: { factors: HuntScoreFactor[] }) {
  return (
    <Box sx={{ py: 0.5, maxWidth: 280 }}>
      <Typography variant="subtitle2" component="p" sx={{ fontWeight: 700, mb: 0.75 }}>{t.wizard.test.factorsTitle}</Typography>
      <Stack component="ul" spacing={0.75} sx={{ m: 0, p: 0, listStyle: 'none' }}>
        {factors.map((f) => (
          <Box component="li" key={f.key}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1.5 }}>
              <Typography variant="caption" sx={{ fontWeight: 600 }}>{t.factors[f.key].label}</Typography>
              <Typography variant="caption" sx={{ fontVariantNumeric: 'tabular-nums' }}>{t.factorPoints(f.points, f.max)}</Typography>
            </Box>
            <Typography variant="caption" component="p" sx={{ opacity: 0.8, lineHeight: 1.35 }}>{t.factors[f.key].hint}</Typography>
          </Box>
        ))}
      </Stack>
    </Box>
  );
}

interface Props {
  score: number;
  factors: HuntScoreFactor[];
  /** Destaca a barra (oferta escolhida). */
  emphasis?: boolean;
}

/**
 * Pontuação 0–100 com barra; o botão abre os fatores num Tooltip (toque também abre no celular).
 */
export function ScoreBar({ score, factors, emphasis }: Props) {
  const theme = useTheme();
  const value = Math.max(0, Math.min(100, score));
  return (
    <Tooltip title={<ScoreFactorsList factors={factors} />} arrow describeChild enterTouchDelay={0} leaveTouchDelay={6000}>
      <ButtonBase
        aria-label={`${t.ranking.scoreAria(score)}. ${t.ranking.factorsAria}`}
        sx={{
          display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 0.5, width: '100%', minWidth: 96,
          borderRadius: 1, p: 0.5, textAlign: 'left',
          '&.Mui-focusVisible': { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: 2 },
        }}
      >
        <Typography component="span" variant="caption" sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: emphasis ? 'primary.main' : 'text.secondary' }}>
          {t.wizard.test.score(score)}
        </Typography>
        <LinearProgress
          variant="determinate"
          value={value}
          aria-hidden
          sx={{
            height: 6, borderRadius: 999,
            backgroundColor: alpha(theme.palette.text.primary, theme.palette.mode === 'dark' ? 0.16 : 0.08),
            '& .MuiLinearProgress-bar': { borderRadius: 999, backgroundColor: emphasis ? 'primary.main' : 'text.disabled' },
          }}
        />
      </ButtonBase>
    </Tooltip>
  );
}
