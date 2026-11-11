import { Box, LinearProgress, Typography } from '@mui/material';

/** Força da senha: 0 = fraca, 1 = média, 2 = forte. Só indicador visual; quem valida é a API. */
export function passwordStrength(pw: string): 0 | 1 | 2 {
  if (pw.length < 8) return 0;
  let score = 0;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^a-zA-Z0-9]/.test(pw)) score++;
  if (pw.length >= 12) score++;
  return score <= 1 ? 0 : score <= 2 ? 1 : 2;
}

const STRENGTH_COLORS = ['error', 'warning', 'success'] as const;

export interface PasswordStrengthMeterProps {
  password: string;
  /** Rótulos na ordem fraca, média, forte (vêm do `strings.ts` da feature). */
  labels: readonly [string, string, string];
  /** Nome acessível da barra. */
  ariaLabel?: string;
}

/** Barra + rótulo da força da senha. Não renderiza nada com o campo vazio. */
export function PasswordStrengthMeter({ password, labels, ariaLabel }: PasswordStrengthMeterProps) {
  if (password.length === 0) return null;
  const strength = passwordStrength(password);
  return (
    <Box>
      <LinearProgress
        variant="determinate"
        value={(strength + 1) * 33.3}
        color={STRENGTH_COLORS[strength]}
        aria-label={ariaLabel}
        aria-valuetext={labels[strength]}
        sx={{ height: 4, borderRadius: 2, mb: 0.5 }}
      />
      <Typography variant="caption" color={`${STRENGTH_COLORS[strength]}.main`}>
        {labels[strength]}
      </Typography>
    </Box>
  );
}
