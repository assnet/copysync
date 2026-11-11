import { useEffect } from 'react';
import { Link as RouterLink, useLocation, useNavigate } from 'react-router-dom';
import { Box, Button, Card, Chip, Divider, Link, Stack, Tooltip, Typography, alpha, keyframes, useTheme } from '@mui/material';
import { CircleCheck, ExternalLink, Inbox, LifeBuoy, LogIn, Mail, MailCheck } from 'lucide-react';
import { AppIcon } from '@/components/AppIcon';
import { ThemeModeSelector } from '@/components/ThemeModeSelector';
import { APP_NAME } from '@/shared/branding/brand';
import { BrandLogo } from '@/shared/branding/BrandLogo';
import {
  THANK_YOU_MAIL_SHORTCUTS, THANK_YOU_SENDER_EMAIL, THANK_YOU_SUPPORT_URL, thankYouStrings as t,
  type ThankYouVariant,
} from '@/features/thankYou/strings';

const riseIn = keyframes({ from: { opacity: 0, transform: 'translateY(8px)' }, to: { opacity: 1, transform: 'none' } });

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

/** Router state é dado externo (histórico do navegador): só `{ from: 'login' }` muda a variante. */
function resolveVariant(state: unknown): ThankYouVariant {
  const fromLogin = typeof state === 'object' && state !== null && (state as { from?: unknown }).from === 'login';
  return fromLogin ? 'firstAccess' : 'purchase';
}

interface StepProps {
  number: number;
  title: string;
  /** Passo em que a pessoa está agora: número preenchido. */
  current?: boolean;
  last?: boolean;
  children: React.ReactNode;
}

function Step({ number, title, current, last, children }: StepProps) {
  const theme = useTheme();
  const primary = theme.palette.primary.main;
  return (
    <Box component="li" sx={{ display: 'grid', gridTemplateColumns: '32px minmax(0, 1fr)', columnGap: 1.5 }}>
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <Box
          aria-hidden
          sx={{
            width: 32, height: 32, borderRadius: '50%', display: 'grid', placeItems: 'center', flexShrink: 0,
            fontWeight: 700, fontSize: '0.9375rem', fontVariantNumeric: 'tabular-nums',
            ...(current
              ? { color: 'primary.contrastText', bgcolor: 'primary.main' }
              : {
                  color: theme.palette.mode === 'dark' ? 'primary.light' : 'primary.dark',
                  bgcolor: alpha(primary, theme.palette.mode === 'dark' ? 0.16 : 0.08),
                  border: `1px solid ${alpha(primary, 0.3)}`,
                }),
          }}
        >
          {number}
        </Box>
        {!last && <Box aria-hidden sx={{ flex: 1, width: 2, my: 0.75, borderRadius: 1, bgcolor: 'divider', minHeight: 12 }} />}
      </Box>
      <Box sx={{ pb: last ? 0 : 2.5, pt: 0.5, minWidth: 0 }}>
        <Typography component="h3" sx={{ fontWeight: 700, fontSize: '1rem', lineHeight: 1.4 }}>
          <Box component="span" sx={visuallyHidden}>{t.stepLabel(number)}: </Box>
          {title}
        </Typography>
        <Box sx={{ mt: 0.5, color: 'text.secondary', fontSize: '0.9375rem', lineHeight: 1.55 }}>{children}</Box>
      </Box>
    </Box>
  );
}

const visuallyHidden = {
  position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap',
} as const;

/**
 * Página pública `/obrigado` (fora do login e do layout): página de obrigado das ofertas do
 * checkout e destino do link "Meu primeiro acesso" do login (router state `{ from: 'login' }`,
 * que só troca o cabeçalho). Estática: não chama a API, não lê nem exibe a query string (o
 * checkout pode anexar dados do comprador) e tira a query da barra de endereço.
 * Doc: docs/pagina-obrigado.md.
 */
export function ThankYouPage() {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const { pathname, search, hash, state } = useLocation();
  const navigate = useNavigate();
  const variant = resolveVariant(state);
  const header = t.variants[variant];

  useNoIndex();

  // Query/hash do checkout nunca ficam visíveis (nem em print ou link copiado). O state é
  // repassado: sem isso a limpeza derrubaria a variante de primeiro acesso.
  useEffect(() => {
    if (search || hash) navigate(pathname, { replace: true, state });
  }, [pathname, search, hash, state, navigate]);

  useEffect(() => {
    const previous = document.title;
    document.title = `${header.pageTitle} · ${APP_NAME}`;
    return () => { document.title = previous; };
  }, [header.pageTitle]);

  const isPurchase = variant === 'purchase';
  const accentKey = isPurchase ? 'success' : 'primary';
  const accent = theme.palette[accentKey].main;
  const primary = theme.palette.primary.main;

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
        pt: { xs: 8, sm: 9 },
        // Folga no fim para o botão flutuante de suporte não cobrir o rodapé.
        pb: { xs: 11, sm: 8 },
        backgroundImage: `radial-gradient(70% 45% at 50% 0%, ${alpha(accent, isDark ? 0.16 : 0.12)} 0%, transparent 100%)`,
      }}
    >
      <Box sx={{ position: 'fixed', top: 12, right: 12, zIndex: 10 }}>
        <ThemeModeSelector />
      </Box>

      <Box sx={{ width: '100%', maxWidth: 480 }}>
        <Box sx={{ display: 'flex', justifyContent: 'center', mb: 2.5 }}>
          <BrandLogo size={44} />
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
            animation: `${riseIn} 240ms ease-out both`,
            '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
          }}
        >
          <Stack alignItems="center" textAlign="center" spacing={1.5}>
            <Box
              aria-hidden
              sx={{
                width: 56, height: 56, borderRadius: '50%', display: 'grid', placeItems: 'center',
                color: `${accentKey}.main`, bgcolor: alpha(accent, isDark ? 0.2 : 0.12),
                boxShadow: `0 0 0 6px ${alpha(accent, isDark ? 0.08 : 0.06)}`,
              }}
            >
              <AppIcon icon={isPurchase ? CircleCheck : MailCheck} size="lg" />
            </Box>
            <Chip label={header.badge} color={accentKey} variant="outlined" size="small" sx={{ fontWeight: 600 }} />
            <Typography
              component="h1"
              sx={{
                fontSize: { xs: '1.5rem', sm: '1.75rem' }, fontWeight: 800, lineHeight: 1.2, letterSpacing: -0.4,
                textWrap: 'balance',
              }}
            >
              {header.title}
            </Typography>
            <Typography color="text.secondary" sx={{ fontSize: '1rem', lineHeight: 1.55, maxWidth: 400, textWrap: 'pretty' }}>
              {header.subtitle}
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
              <Step number={1} current title={t.steps.openEmail.title(APP_NAME)}>
                {t.steps.openEmail.hint[variant]}

                <Box
                  data-testid="thank-you-sender"
                  sx={{
                    mt: 1.25, display: 'flex', alignItems: 'center', gap: 1.5, px: 1.5, py: 1.25, borderRadius: 2,
                    bgcolor: alpha(primary, isDark ? 0.14 : 0.06),
                    border: `1px solid ${alpha(primary, isDark ? 0.4 : 0.25)}`,
                  }}
                >
                  <Box sx={{ display: 'flex', color: isDark ? 'primary.light' : 'primary.main' }}>
                    <AppIcon icon={Mail} size="lg" />
                  </Box>
                  <Box sx={{ minWidth: 0 }}>
                    <Box sx={{ fontSize: '0.8125rem', lineHeight: 1.4 }}>{t.sender.label}</Box>
                    <Box sx={{ color: 'text.primary', fontWeight: 700, fontSize: '1rem', lineHeight: 1.35 }}>{APP_NAME}</Box>
                    <Box
                      translate="no"
                      sx={{
                        color: 'text.primary', fontWeight: 500, lineHeight: 1.4,
                        fontSize: { xs: '0.875rem', sm: '0.9375rem' }, overflowWrap: 'anywhere',
                      }}
                    >
                      {THANK_YOU_SENDER_EMAIL}
                    </Box>
                  </Box>
                </Box>

                <Stack
                  component="ul"
                  aria-label={t.shortcutsLabel}
                  direction="row"
                  useFlexGap
                  flexWrap="wrap"
                  spacing={1}
                  sx={{ listStyle: 'none', m: 0, mt: 1.25, p: 0 }}
                >
                  {THANK_YOU_MAIL_SHORTCUTS.map((shortcut) => (
                    <Box component="li" key={shortcut.id} sx={{ flex: { xs: '1 1 132px', sm: '0 0 auto' } }}>
                      <Tooltip title={shortcut.tooltip} describeChild>
                        <Button
                          component="a"
                          href={shortcut.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          variant="outlined"
                          size="small"
                          fullWidth
                          endIcon={<AppIcon icon={ExternalLink} size="sm" />}
                          sx={{ minHeight: { xs: 44, sm: 36 }, fontWeight: 600, whiteSpace: 'nowrap' }}
                        >
                          {shortcut.label}
                        </Button>
                      </Tooltip>
                    </Box>
                  ))}
                </Stack>
              </Step>
              <Step number={2} title={t.steps.setPassword.title}>
                {t.steps.setPassword.hint}
              </Step>
              <Step number={3} title={t.steps.signIn.title} last>
                {t.steps.signIn.hint}
              </Step>
            </Box>

            <Box
              role="note"
              sx={{
                mt: 2.5, display: 'flex', alignItems: 'center', gap: 1.25, px: 1.75, py: 1.25, borderRadius: 2,
                bgcolor: alpha(theme.palette.info.main, isDark ? 0.14 : 0.08),
                color: isDark ? 'info.light' : 'info.dark',
                fontSize: '0.875rem', fontWeight: 500, lineHeight: 1.45,
              }}
            >
              <AppIcon icon={Inbox} size="md" />
              <span>{t.spamTip}</span>
            </Box>
          </Box>

          <Divider sx={{ my: 3 }} />

          <Box
            sx={{
              display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, alignItems: { xs: 'stretch', sm: 'center' },
              gap: { xs: 1.5, sm: 2 },
            }}
          >
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography component="h2" sx={{ fontWeight: 700, fontSize: '0.9375rem' }}>
                {t.existingTitle[variant](APP_NAME)}
              </Typography>
              <Typography color="text.secondary" sx={{ fontSize: '0.875rem', lineHeight: 1.5, mt: 0.25 }}>
                {t.existingBody[variant]}
              </Typography>
            </Box>
            <Button
              component={RouterLink}
              to="/login"
              variant="outlined"
              startIcon={<AppIcon icon={LogIn} size="sm" />}
              sx={{ flexShrink: 0, minHeight: 44, fontWeight: 600, whiteSpace: 'nowrap' }}
            >
              {t.goToLogin[variant]}
            </Button>
          </Box>
        </Card>

        <Stack
          direction="row"
          useFlexGap
          spacing={0.75}
          justifyContent="center"
          alignItems="center"
          flexWrap="wrap"
          sx={{ mt: 3, fontSize: '0.9375rem' }}
        >
          <Typography component="span" color="text.secondary" sx={{ fontSize: 'inherit' }}>{t.supportPrompt}</Typography>
          <Tooltip title={t.supportTooltip} describeChild>
            <Link
              href={THANK_YOU_SUPPORT_URL}
              target="_blank"
              rel="noopener noreferrer"
              underline="hover"
              sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, fontWeight: 600, py: 0.5 }}
            >
              <AppIcon icon={LifeBuoy} />
              {t.supportLink}
            </Link>
          </Tooltip>
        </Stack>

        <Typography sx={{ mt: 1.5, fontSize: '0.75rem', color: 'text.disabled', textAlign: 'center' }}>
          {t.footer(new Date().getFullYear(), APP_NAME)}
        </Typography>
      </Box>
    </Box>
  );
}
