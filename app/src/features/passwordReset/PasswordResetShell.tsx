import type { ReactNode } from 'react';
import { Box, Card, CardContent, Typography, alpha, useTheme } from '@mui/material';
import type { LucideIcon } from 'lucide-react';
import { AppIcon } from '@/components/AppIcon';
import { ThemeModeSelector } from '@/components/ThemeModeSelector';
import { APP_NAME } from '@/shared/branding/brand';
import { BrandLogo } from '@/shared/branding/BrandLogo';
import { GOLDEN_SPACE, GOLDEN_TYPE } from '@/pages/login/goldenRatio';
import { passwordResetStrings as S } from './strings';

/** Moldura das telas de redefinição: mesmo fundo, logo, card de vidro e rodapé do convite/login. */
export function PasswordResetShell({ children }: { children: ReactNode }) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  return (
    <Box
      component="main"
      sx={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: 'background.default',
        px: { xs: `${GOLDEN_SPACE.s3}px`, sm: `${GOLDEN_SPACE.s5}px` },
        pt: `${GOLDEN_SPACE.s5}px`,
        // xs: folga para o botão flutuante de suporte não cobrir o rodapé no fim da rolagem.
        pb: { xs: 'calc(88px + env(safe-area-inset-bottom))', sm: `${GOLDEN_SPACE.s5}px` },
        backgroundImage: `radial-gradient(60% 50% at 50% 38.2%, ${alpha(theme.palette.primary.main, isDark ? 0.16 : 0.1)} 0%, transparent 100%)`,
      }}
    >
      <Box sx={{ position: 'fixed', top: `${GOLDEN_SPACE.s3}px`, right: `${GOLDEN_SPACE.s3}px`, zIndex: 10 }}>
        <ThemeModeSelector />
      </Box>

      <Box sx={{ width: '100%', maxWidth: 440 }}>
        <Box sx={{ display: 'flex', justifyContent: 'center', mb: `${GOLDEN_SPACE.s4}px` }}>
          <BrandLogo size={56} />
        </Box>

        {children}

        <Typography sx={{ fontSize: GOLDEN_TYPE.caption, color: 'text.disabled', textAlign: 'center', mt: `${GOLDEN_SPACE.s3}px` }}>
          {S.footer(new Date().getFullYear())} {APP_NAME}
        </Typography>
      </Box>
    </Box>
  );
}

/** Título e subtítulo acima do card (mesma tipografia do login). */
export function PasswordResetHeading({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <>
      <Typography
        component="h1"
        sx={{ fontSize: GOLDEN_TYPE.lead, fontWeight: 800, letterSpacing: -0.6, lineHeight: 1.15, mb: `${GOLDEN_SPACE.s1}px`, textAlign: 'center' }}
      >
        {title}
      </Typography>
      <Typography sx={{ fontSize: GOLDEN_TYPE.base, color: 'text.secondary', mb: `${GOLDEN_SPACE.s4}px`, textAlign: 'center' }}>
        {subtitle}
      </Typography>
    </>
  );
}

export function PasswordResetCard({ children }: { children: ReactNode }) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  return (
    <Card
      elevation={0}
      sx={{
        borderRadius: `${GOLDEN_SPACE.s3}px`,
        bgcolor: alpha(theme.palette.background.paper, isDark ? 0.72 : 0.8),
        backdropFilter: 'blur(14px)',
        border: `1px solid ${alpha(isDark ? '#fff' : theme.palette.primary.main, isDark ? 0.1 : 0.14)}`,
        boxShadow: isDark
          ? `0 ${GOLDEN_SPACE.s3}px ${GOLDEN_SPACE.s5}px ${alpha('#000', 0.45)}`
          : `0 ${GOLDEN_SPACE.s3}px ${GOLDEN_SPACE.s5}px ${alpha(theme.palette.primary.dark, 0.12)}`,
      }}
    >
      <CardContent sx={{ p: `${GOLDEN_SPACE.s4}px !important` }}>{children}</CardContent>
    </Card>
  );
}

export interface PasswordResetStatusProps {
  icon: LucideIcon;
  tone: 'success' | 'error' | 'primary';
  title: string;
  message: ReactNode;
  children?: ReactNode;
}

/** Card de estado (enviado, inválido, concluído): ícone em selo, título, texto e ações. */
export function PasswordResetStatus({ icon, tone, title, message, children }: PasswordResetStatusProps) {
  const theme = useTheme();
  const color = theme.palette[tone].main;
  return (
    <PasswordResetCard>
      <Box sx={{ textAlign: 'center', py: `${GOLDEN_SPACE.s1}px` }}>
        <Box
          sx={{
            width: 56, height: 56, mx: 'auto', mb: 2, borderRadius: '50%',
            display: 'grid', placeItems: 'center', color,
            bgcolor: alpha(color, theme.palette.mode === 'dark' ? 0.18 : 0.1),
          }}
        >
          <AppIcon icon={icon} size="lg" />
        </Box>
        <Typography component="h1" variant="h6" fontWeight={700} gutterBottom>{title}</Typography>
        <Typography component="div" color="text.secondary" sx={{ mb: 3 }}>{message}</Typography>
        {children}
      </Box>
    </PasswordResetCard>
  );
}
