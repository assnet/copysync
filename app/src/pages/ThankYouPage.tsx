import { useEffect } from 'react';
import { Link as RouterLink, useLocation, useNavigate } from 'react-router-dom';
import { Box, Button, Card, Chip, Divider, Link, Stack, Tooltip, Typography, alpha, useTheme } from '@mui/material';
import { CircleCheck, ExternalLink, Inbox, KeyRound, LifeBuoy, LogIn, Mail, UserCheck, type LucideIcon } from 'lucide-react';
import { AppIcon } from '@/components/AppIcon';
import { ThemeModeSelector } from '@/components/ThemeModeSelector';
import { APP_NAME } from '@/shared/branding/brand';
import { BrandLogo } from '@/shared/branding/BrandLogo';
import {
  THANK_YOU_SENDER_EMAIL, THANK_YOU_SUPPORT_URL, thankYouStrings as t,
} from '@/features/thankYou/strings';

/** Garante `noindex` mesmo se o `index.html` mudar; remove só o que criou. */
function useNoIndex(): void {
  useEffect(() => {
    if (document.head.querySelector('meta[name="robots"]')) return undefined;
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex, nofollow';
    document.head.appendChild(meta);
    return () => { meta.remove(); };
  }, []);
}

interface StepProps {
  icon: LucideIcon;
  title: string;
  last?: boolean;
  children: React.ReactNode;
}

function Step({ icon, title, last, children }: StepProps) {
  const theme = useTheme();
  return (
    <Box component="li" sx={{ display: 'grid', gridTemplateColumns: '40px 1fr', columnGap: 1.75 }}>
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <Box
          aria-hidden
          sx={{
            width: 40, height: 40, borderRadius: '50%', display: 'grid', placeItems: 'center', flexShrink: 0,
            color: 'primary.main', bgcolor: alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.18 : 0.1),
            border: `1px solid ${alpha(theme.palette.primary.main, 0.3)}`,
          }}
        >
          <AppIcon icon={icon} size="md" />
        </Box>
        {!last && <Box aria-hidden sx={{ flex: 1, width: 2, my: 0.75, borderRadius: 1, bgcolor: 'divider', minHeight: 16 }} />}
      </Box>
      <Box sx={{ pb: last ? 0 : 2.5, pt: 0.75, minWidth: 0 }}>
        <Typography component="h3" sx={{ fontWeight: 700, fontSize: '1rem', lineHeight: 1.35 }}>
          {title}
        </Typography>
        <Box sx={{ mt: 0.5, color: 'text.secondary', fontSize: '0.9375rem', lineHeight: 1.55 }}>{children}</Box>
      </Box>
    </Box>
  );
}

/**
 * Página pública `/obrigado` (fora do login e do layout): página de obrigado das ofertas do
 * checkout. Estática: não chama a API, não lê nem exibe a query string (o checkout pode anexar
 * dados do comprador) e tira a query da barra de endereço. Doc: docs/pagina-obrigado.md.
 */
export function ThankYouPage() {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const { pathname, search, hash } = useLocation();
  const navigate = useNavigate();

  useNoIndex();

  // Query/hash do checkout nunca ficam visíveis (nem em print ou link copiado).
  useEffect(() => {
    if (search || hash) navigate(pathname, { replace: true });
  }, [pathname, search, hash, navigate]);

  useEffect(() => {
    const previous = document.title;
    document.title = `${t.pageTitle} · ${APP_NAME}`;
    return () => { document.title = previous; };
  }, []);

  const success = theme.palette.success.main;

  return (
    <Box
      component="main"
      sx={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        bgcolor: 'background.default',
        color: 'text.primary',
        px: 2,
        pt: { xs: 9, sm: 10 },
        pb: { xs: 4, sm: 6 },
        backgroundImage: `radial-gradient(70% 45% at 50% 0%, ${alpha(success, isDark ? 0.16 : 0.12)} 0%, transparent 100%)`,
      }}
    >
      <Box sx={{ position: 'fixed', top: 12, right: 12, zIndex: 10 }}>
        <ThemeModeSelector />
      </Box>

      <Box sx={{ width: '100%', maxWidth: 480 }}>
        <Box sx={{ display: 'flex', justifyContent: 'center', mb: 3 }}>
          <BrandLogo size={48} />
        </Box>

        <Card
          elevation={0}
          sx={{
            borderRadius: 4,
            p: { xs: 2.5, sm: 4 },
            bgcolor: alpha(theme.palette.background.paper, isDark ? 0.82 : 0.92),
            backdropFilter: 'blur(12px)',
            border: `1px solid ${alpha(isDark ? '#fff' : theme.palette.text.primary, isDark ? 0.1 : 0.08)}`,
            boxShadow: isDark
              ? `0 24px 48px ${alpha('#000', 0.45)}`
              : `0 24px 48px ${alpha(theme.palette.text.primary, 0.08)}`,
          }}
        >
          <Stack alignItems="center" textAlign="center" spacing={1.5}>
            <Box
              aria-hidden
              sx={{
                width: 64, height: 64, borderRadius: '50%', display: 'grid', placeItems: 'center',
                color: 'success.main', bgcolor: alpha(success, isDark ? 0.2 : 0.12),
                boxShadow: `0 0 0 8px ${alpha(success, isDark ? 0.08 : 0.06)}`,
                '& svg': { width: 32, height: 32 },
              }}
            >
              <AppIcon icon={CircleCheck} size="lg" />
            </Box>
            <Chip label={t.badge} color="success" variant="outlined" size="small" sx={{ fontWeight: 600 }} />
            <Typography
              component="h1"
              sx={{ fontSize: { xs: '1.5rem', sm: '1.75rem' }, fontWeight: 800, lineHeight: 1.2, letterSpacing: -0.4 }}
            >
              {t.title}
            </Typography>
            <Typography color="text.secondary" sx={{ fontSize: '1rem', lineHeight: 1.55, maxWidth: 380 }}>
              {t.subtitle}
            </Typography>
          </Stack>

          <Box component="section" aria-labelledby="thank-you-steps" sx={{ mt: 3.5 }}>
            <Typography
              id="thank-you-steps"
              component="h2"
              sx={{ fontSize: '0.75rem', fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase', color: 'text.secondary', mb: 1.5 }}
            >
              {t.stepsTitle}
            </Typography>
            <Box component="ol" sx={{ listStyle: 'none', m: 0, p: 0 }}>
              <Step icon={Mail} title={t.steps.openEmail.title(APP_NAME)}>
                <Box component="span" sx={{ display: 'block', color: 'text.primary', fontWeight: 500, wordBreak: 'break-word' }}>
                  {t.steps.openEmail.senderLabel} {APP_NAME}{' '}
                  <Box component="span" sx={{ whiteSpace: 'nowrap' }}>{`<${THANK_YOU_SENDER_EMAIL}>`}</Box>
                </Box>
                {t.steps.openEmail.hint}
              </Step>
              <Step icon={KeyRound} title={t.steps.setPassword.title} last>
                {t.steps.setPassword.hint}
              </Step>
            </Box>

            <Box
              role="note"
              sx={{
                mt: 2.5, display: 'flex', alignItems: 'center', gap: 1.25, px: 1.75, py: 1.25, borderRadius: 2,
                bgcolor: alpha(theme.palette.info.main, isDark ? 0.14 : 0.08),
                color: isDark ? 'info.light' : 'info.dark',
                fontSize: '0.875rem', fontWeight: 500,
              }}
            >
              <AppIcon icon={Inbox} size="md" />
              <span>{t.spamTip}</span>
            </Box>
          </Box>

          <Button
            component={RouterLink}
            to="/login"
            variant="contained"
            size="large"
            fullWidth
            startIcon={<AppIcon icon={LogIn} size="md" />}
            sx={{ mt: 3, py: 1.4, fontSize: '1rem', fontWeight: 700 }}
          >
            {t.goToLogin}
          </Button>

          <Divider sx={{ my: 3 }} />

          <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start' }}>
            <Box sx={{ color: 'text.secondary', display: 'flex', pt: 0.25 }}>
              <AppIcon icon={UserCheck} size="md" />
            </Box>
            <Box>
              <Typography component="h2" sx={{ fontWeight: 700, fontSize: '0.9375rem' }}>{t.existingTitle(APP_NAME)}</Typography>
              <Typography color="text.secondary" sx={{ fontSize: '0.9375rem', lineHeight: 1.55, mt: 0.25 }}>
                {t.existingBody}
              </Typography>
            </Box>
          </Box>
        </Card>

        <Stack direction="row" spacing={0.75} justifyContent="center" alignItems="center" flexWrap="wrap" sx={{ mt: 3, fontSize: '0.9375rem' }}>
          <Typography component="span" color="text.secondary" sx={{ fontSize: 'inherit' }}>{t.supportPrompt}</Typography>
          <Tooltip title={t.supportTooltip} describeChild>
            <Link
              href={THANK_YOU_SUPPORT_URL}
              target="_blank"
              rel="noopener noreferrer"
              underline="hover"
              sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, fontWeight: 600 }}
            >
              <AppIcon icon={LifeBuoy} />
              {t.supportLink}
              <AppIcon icon={ExternalLink} style={{ width: '1em', height: '1em' }} />
            </Link>
          </Tooltip>
        </Stack>

        <Typography sx={{ mt: 2, fontSize: '0.75rem', color: 'text.disabled', textAlign: 'center' }}>
          {t.footer(new Date().getFullYear(), APP_NAME)}
        </Typography>
      </Box>
    </Box>
  );
}
