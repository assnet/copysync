import { Box, Button, Chip, Divider, Paper, Tooltip, Typography, alpha, useTheme } from '@mui/material';
import { ArrowLeftRight, Check, Crown, Info } from 'lucide-react';
import { AppIcon, TelegramIcon, WhatsAppIcon, brandColor } from '@/components';
import { priceFor, savingsFor, type BillingPeriod, type PlanBenefit, type PlanCatalogItem } from '../catalog';
import { formatPrice, plansStrings as t } from '../strings';
import { ctaGradient } from './PlansHero';
import { ChannelLimitsTable } from './ChannelLimitsTable';

interface Props {
  plan: PlanCatalogItem;
  period: BillingPeriod;
  /** Destino do botão. Enquanto o checkout não existe, `#`. */
  /** Link de pagamento do gateway (abre em nova aba). */
  checkoutHref: string;
}

const CHANNEL_LOGO = { whatsapp: WhatsAppIcon, telegram: TelegramIcon } as const;

/**
 * Recurso com nome próprio (ex.: Cross Session): bloco com moldura em gradiente, ícone do recurso,
 * nome em destaque e a descrição embaixo. Sem brilhos: o destaque vem da moldura e do peso.
 */
function FeatureRow({ benefit }: { benefit: PlanBenefit }) {
  const theme = useTheme();
  const gradient = ctaGradient(theme);
  // No escuro, primary/secondary .main ficam abaixo de 4.5:1 sobre o papel; o nome usa os tons claros.
  const { primary, secondary } = theme.palette;
  const nameGradient = theme.palette.mode === 'dark'
    ? `linear-gradient(135deg, ${primary.light} 0%, ${secondary.light} 100%)`
    : gradient;
  const row = (
    <Box
      component="li"
      sx={{
        position: 'relative', borderRadius: '10px', p: '1.5px', background: gradient, cursor: benefit.hint ? 'help' : 'default',
        mx: -1, my: 0.25,
      }}
    >
      <Box
        sx={{
          display: 'flex', alignItems: 'flex-start', gap: 1.25, borderRadius: '8.5px', px: 1.25, py: 1,
          bgcolor: 'background.paper',
          backgroundImage: `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.1)} 0%, ${alpha(theme.palette.secondary.main, 0.1)} 100%)`,
        }}
      >
        <Box
          aria-hidden
          sx={{
            width: 32, height: 32, borderRadius: '9px', flexShrink: 0, display: 'grid', placeItems: 'center',
            background: gradient, color: theme.palette.getContrastText(theme.palette.primary.main),
          }}
        >
          {benefit.featureIcon === 'channels' ? (
            // Dois logos sobrepostos: o recurso é a ponte entre os canais
            <Box sx={{ display: 'flex', alignItems: 'center' }}>
              <AppIcon icon={WhatsAppIcon} size="sm" />
              <Box sx={{ ml: '-5px', display: 'flex', borderRadius: '50%', boxShadow: `0 0 0 1.5px ${theme.palette.primary.main}` }}>
                <AppIcon icon={TelegramIcon} size="sm" />
              </Box>
            </Box>
          ) : (
            <AppIcon icon={ArrowLeftRight} size="sm" strokeWidth={2.5} />
          )}
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
            <Typography
              component="span"
              sx={{
                fontWeight: 800, fontSize: theme.typography.pxToRem(15), letterSpacing: '-0.01em', lineHeight: 1.3,
                background: nameGradient, WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent',
              }}
            >
              {benefit.featureName}
            </Typography>
            {benefit.exclusive && (
              <Chip label={t.card.exclusive} size="small" color="secondary" variant="outlined" sx={{ height: 18, fontSize: 10, fontWeight: 700 }} />
            )}
          </Box>
          <Typography variant="body2" sx={{ color: 'text.secondary', lineHeight: 1.4, mt: 0.25 }}>
            {benefit.label}
          </Typography>
        </Box>
        {benefit.hint && (
          <Box sx={{ color: 'text.disabled', display: 'flex', mt: '3px' }}>
            <AppIcon icon={Info} size="sm" />
          </Box>
        )}
      </Box>
    </Box>
  );
  return benefit.hint ? (
    <Tooltip title={benefit.hint} enterTouchDelay={0} arrow placement="top">
      {row}
    </Tooltip>
  ) : row;
}

function BenefitRow({ benefit, accent }: { benefit: PlanBenefit; accent: string }) {
  const theme = useTheme();
  if (benefit.featureName) return <FeatureRow benefit={benefit} />;
  const channelColor = benefit.channel ? brandColor(benefit.channel, theme.palette.mode) : null;
  const row = (
    <Box
      component="li"
      sx={{
        display: 'flex', alignItems: 'flex-start', gap: 1, cursor: benefit.hint ? 'help' : 'default',
        // Recurso de canal: faixa leve na cor da marca destaca a linha sem competir com o preço
        ...(channelColor && {
          mx: -1, px: 1, py: 0.75, borderRadius: 1.5,
          bgcolor: alpha(channelColor, theme.palette.mode === 'dark' ? 0.14 : 0.08),
          border: 1, borderColor: alpha(channelColor, 0.3),
        }),
      }}
    >
      <Box sx={{ color: channelColor ?? accent, mt: '3px', display: 'flex' }}>
        <AppIcon icon={benefit.channel ? CHANNEL_LOGO[benefit.channel] : Check} size="sm" strokeWidth={3} />
      </Box>
      <Typography component="div" variant="body2" sx={{ fontWeight: benefit.strong || benefit.channel ? 700 : 400, color: benefit.strong || benefit.channel ? 'text.primary' : 'text.secondary', lineHeight: 1.45, flex: 1 }}>
        {benefit.label}
        {benefit.exclusive && (
          <Chip label={t.card.exclusive} size="small" color="secondary" variant="outlined" sx={{ ml: 1, height: 18, fontSize: 10, fontWeight: 700, verticalAlign: 'middle' }} />
        )}
        {benefit.detail && (
          <Box component="span" sx={{ display: 'block', fontWeight: 600, color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>
            {benefit.detail}
          </Box>
        )}
      </Typography>
      {benefit.hint && (
        <Box sx={{ color: 'text.disabled', display: 'flex', mt: '3px' }}>
          <AppIcon icon={Info} size="sm" />
        </Box>
      )}
    </Box>
  );
  return benefit.hint ? (
    <Tooltip title={benefit.hint} enterTouchDelay={0} arrow placement="top">
      {row}
    </Tooltip>
  ) : row;
}

/** Card de plano. O recomendado ganha moldura em gradiente e selo "Mais escolhido". */
export function PlanCard({ plan, period, checkoutHref }: Props) {
  const theme = useTheme();
  const accent = theme.palette.primary.main;
  const recommended = !!plan.recommended;
  const gradient = ctaGradient(theme);
  const price = priceFor(plan, period);
  const savings = savingsFor(plan, period);
  const savingsLabel = savings.per === 'year' ? t.card.savingsPerYear(formatPrice(savings.value)) : t.card.savingsPerMonth(formatPrice(savings.value));

  const body = (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, height: '100%' }}>
      <Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {recommended && <Box sx={{ color: accent, display: 'flex' }}><AppIcon icon={Crown} size="sm" /></Box>}
          <Typography variant="h6">{plan.name}</Typography>
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
          {plan.tagline}
        </Typography>
      </Box>

      <Box>
        <Typography variant="caption" sx={{ color: 'text.disabled', textDecoration: 'line-through', fontWeight: 600 }}>
          {t.card.from(formatPrice(period === 'annual' ? plan.price : plan.priceFrom))}
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1 }}>
          <Typography key={price} component="span" sx={{ fontSize: 34, fontWeight: 800, lineHeight: 1, letterSpacing: -1, fontVariantNumeric: 'tabular-nums' }}>
            {formatPrice(price)}
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column' }}>
            <Typography variant="body2" sx={{ fontWeight: 600, color: 'text.secondary', lineHeight: 1.2 }}>{t.card.perMonth}</Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary', lineHeight: 1.2 }}>{period === 'annual' ? t.card.billedAnnually : t.card.billedMonthly}</Typography>
          </Box>
        </Box>
        <Chip
          label={savingsLabel}
          size="small"
          sx={{ mt: 1, height: 22, fontWeight: 800, fontSize: 11, bgcolor: alpha(theme.palette.success.main, 0.14), color: 'success.main' }}
        />
      </Box>

      <Box>
        <Button
          fullWidth
          size="large"
          variant={recommended ? 'contained' : 'outlined'}
          href={checkoutHref}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={t.card.ctaNewTab(plan.name)}
          sx={recommended ? { backgroundImage: gradient, boxShadow: 'none', '&:hover': { backgroundImage: gradient, filter: 'brightness(1.06)', boxShadow: 'none' } } : undefined}
        >
          {t.card.cta(plan.name)}
        </Button>
        <Typography variant="caption" display="block" textAlign="center" color="text.secondary" sx={{ mt: 0.75 }}>
          {t.card.ctaHint}
        </Typography>
      </Box>

      <Divider />

      {/* Contém o texto só-leitor-de-tela da tabela: sem isso ele estoura a largura no celular */}
      <Box sx={{ position: 'relative', overflow: 'hidden' }}>
        <ChannelLimitsTable plan={plan} />
      </Box>

      <Box component="ul" sx={{ m: 0, p: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 1.25 }}>
        {plan.benefits.map((b) => <BenefitRow key={b.label} benefit={b} accent={accent} />)}
      </Box>

      <Typography variant="caption" sx={{ mt: 'auto', pt: 2, color: 'text.secondary', borderTop: '1px dashed', borderColor: 'divider' }}>
        <Box component="b" sx={{ color: 'text.primary' }}>{t.card.fit}</Box> {plan.fit}
      </Typography>
    </Box>
  );

  if (recommended) {
    return (
      <Box
        sx={{
          position: 'relative', height: '100%', p: '1.5px', borderRadius: '18px', backgroundImage: gradient,
          boxShadow: `0 12px 40px -14px ${alpha(accent, 0.7)}`,
          transition: 'transform .2s', '&:hover': { transform: 'translateY(-4px)' },
          '@media (prefers-reduced-motion: reduce)': { transition: 'none', '&:hover': { transform: 'none' } },
        }}
      >
        <Chip
          label={t.card.recommended}
          size="small"
          sx={{
            position: 'absolute', top: -11, left: '50%', transform: 'translateX(-50%)', zIndex: 1,
            backgroundImage: gradient, color: '#fff', fontWeight: 800, fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', height: 22,
          }}
        />
        <Paper elevation={0} sx={{ height: '100%', p: 2.5, borderRadius: '16.5px' }}>
          {body}
        </Paper>
      </Box>
    );
  }

  return (
    <Paper
      variant="outlined"
      sx={{
        height: '100%', p: 2.5, borderRadius: '18px',
        transition: 'transform .2s', '&:hover': { transform: 'translateY(-4px)' },
        '@media (prefers-reduced-motion: reduce)': { transition: 'none', '&:hover': { transform: 'none' } },
      }}
    >
      {body}
    </Paper>
  );
}
