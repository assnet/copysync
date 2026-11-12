import { Box, Button, Chip, Divider, Paper, Tooltip, Typography, alpha, darken, useTheme, type Theme } from '@mui/material';
import { ArrowLeftRight, Check, Crown, Info } from 'lucide-react';
import { AppIcon, TelegramIcon, WhatsAppIcon, brandColor } from '@/components';
import { priceFor, savingsFor, type BillingPeriod, type PlanBenefit, type PlanCatalogItem } from '../catalog';
import { formatPrice, plansStrings as t } from '../strings';
import { ctaGradient } from './PlansHero';
import { ChannelLimitsTable } from './ChannelLimitsTable';
import { openCheckout } from '../openCheckout';
import { AFFILIATE_PROVIDERS } from '@/features/settings/affiliateProviders';
import { MarketplaceLogo } from '@/features/settings/components/MarketplaceLogo';
import { REDUCED_MOTION, cardEnter, enterDelay, gradientFlow, haloPulse, priceSwap, sheenSweep } from './planMotion';

const ML_LOGO = AFFILIATE_PROVIDERS.find((p) => p.provider === 'MERCADO_LIVRE')?.logo;
const MARKETPLACE_LOGO = new Map(AFFILIATE_PROVIDERS.map((p) => [p.provider, p.logo]));

/** Logos sobrepostos (decorativos): o anel na cor do papel separa um do outro nos dois temas. */
function MarketplaceLogos({ providers }: { providers: NonNullable<PlanBenefit['marketplaces']> }) {
  return (
    <Box aria-hidden data-testid="plan-benefit-marketplaces" sx={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
      {providers.map((provider, i) => {
        const src = MARKETPLACE_LOGO.get(provider);
        return src ? (
          <MarketplaceLogo
            key={provider}
            src={src}
            size={26}
            round
            sx={{ ml: i ? '-7px' : 0, zIndex: providers.length - i, boxShadow: (theme) => `0 0 0 2px ${theme.palette.background.paper}` }}
          />
        ) : null;
      })}
    </Box>
  );
}

interface Props {
  plan: PlanCatalogItem;
  period: BillingPeriod;
  /**
   * Monta o link de pagamento no clique (UTM + autopreenchimento já em memória). O botão não tem
   * `href`: a URL do gateway não aparece na barra de status; abre em nova aba via `openCheckout`.
   */
  getCheckoutUrl: () => string;
  /** Posição na vitrine: escalona a animação de entrada. */
  index?: number;
}

/** Selo "Exclusivo": no escuro usa o tom claro (secondary.main fica abaixo de 4.5:1 sobre o papel). */
const exclusiveChipSx = {
  height: 20, fontSize: 11, fontWeight: 700,
  color: (theme: Theme) => (theme.palette.mode === 'dark' ? theme.palette.secondary.light : theme.palette.secondary.main),
  borderColor: (theme: Theme) => (theme.palette.mode === 'dark' ? theme.palette.secondary.light : undefined),
} as const;

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
              <Chip label={t.card.exclusive} size="small" color="secondary" variant="outlined" sx={exclusiveChipSx} />
            )}
          </Box>
          <Typography variant="body2" sx={{ color: 'text.secondary', lineHeight: 1.4, mt: 0.25 }}>
            {benefit.label}
          </Typography>
        </Box>
        {benefit.hint && (
          <Box sx={{ color: 'text.secondary', display: 'flex', mt: '3px' }}>
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

/**
 * Novidade do plano (ex.: Afiliado Shein no MAX): moldura em gradiente fluindo, faixa de luz que
 * atravessa o bloco a cada ~6 s e anel pulsando no logo. Sem movimento em reduced-motion.
 */
function SpotlightRow({ benefit }: { benefit: PlanBenefit }) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const { primary, secondary } = theme.palette;
  const frame = `linear-gradient(120deg, ${primary.main} 0%, ${secondary.main} 35%, ${isDark ? primary.light : secondary.light} 50%, ${secondary.main} 65%, ${primary.main} 100%)`;
  const logo = benefit.marketplaces?.[0] ? MARKETPLACE_LOGO.get(benefit.marketplaces[0]) : undefined;
  const row = (
    <Box
      component="li"
      data-testid="plan-benefit-spotlight"
      sx={{
        position: 'relative', borderRadius: '12px', p: '1.5px', mx: -1, my: 0.5, cursor: benefit.hint ? 'help' : 'default',
        backgroundImage: frame, backgroundSize: '220% 100%',
        animation: `${gradientFlow} 10s ease-in-out infinite`,
        boxShadow: `0 10px 28px -14px ${alpha(secondary.main, isDark ? 0.9 : 0.55)}`,
        transition: 'box-shadow .25s',
        '&:hover': { boxShadow: `0 16px 34px -14px ${alpha(secondary.main, isDark ? 1 : 0.7)}` },
        [REDUCED_MOTION]: { animation: 'none', transition: 'none' },
      }}
    >
      <Box
        sx={{
          position: 'relative', overflow: 'hidden', display: 'flex', alignItems: { xs: 'flex-start', sm: 'center' }, gap: 1.5,
          borderRadius: '10.5px', px: 1.25, py: 1.25, bgcolor: 'background.paper',
          backgroundImage: `linear-gradient(135deg, ${alpha(primary.main, isDark ? 0.18 : 0.1)} 0%, ${alpha(secondary.main, isDark ? 0.14 : 0.07)} 100%)`,
          // Faixa de luz: decorativa, não captura clique
          '&::after': {
            content: '""', position: 'absolute', top: 0, bottom: 0, left: 0, width: '35%', pointerEvents: 'none',
            background: `linear-gradient(90deg, transparent, ${isDark ? alpha(theme.palette.common.white, 0.14) : alpha(secondary.light, 0.35)}, transparent)`,
            animation: `${sheenSweep} 6s ease-in-out 1.2s infinite`, opacity: 0,
          },
          [REDUCED_MOTION]: { '&::after': { animation: 'none', display: 'none' } },
        }}
      >
        <Box aria-hidden sx={{ position: 'relative', flexShrink: 0, display: 'flex', mt: { xs: 0.5, sm: 0 } }}>
          <Box
            sx={{
              position: 'absolute', inset: 0, borderRadius: '50%', border: '2px solid', borderColor: secondary.main,
              animation: `${haloPulse} 2.8s cubic-bezier(.2,.7,.3,1) .8s 3`,
              [REDUCED_MOTION]: { animation: 'none', display: 'none' },
            }}
          />
          {logo && <MarketplaceLogo src={logo} size={34} round sx={{ position: 'relative', boxShadow: `0 0 0 2px ${alpha(secondary.main, 0.6)}` }} />}
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, rowGap: 0.5, flexWrap: 'wrap' }}>
            <Typography component="span" sx={{ fontWeight: 800, fontSize: theme.typography.pxToRem(15), letterSpacing: '-0.01em', lineHeight: 1.3, color: 'text.primary' }}>
              {benefit.label}
            </Typography>
            <Chip
              label={t.card.newBadge}
              size="small"
              sx={{ height: 20, fontSize: 11, fontWeight: 800, letterSpacing: 0.4, color: '#fff', backgroundImage: `linear-gradient(135deg, ${primary.dark} 0%, ${secondary.main} 100%)`, textTransform: 'uppercase' }}
            />
            {benefit.exclusive && (
              <Chip label={t.card.exclusive} size="small" color="secondary" variant="outlined" sx={exclusiveChipSx} />
            )}
          </Box>
          {benefit.detail && (
            <Typography variant="body2" sx={{ color: 'text.secondary', lineHeight: 1.4, mt: 0.25 }}>
              {benefit.detail}
            </Typography>
          )}
        </Box>
        {benefit.hint && (
          <Box sx={{ color: 'text.secondary', display: 'flex' }}>
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
  if (benefit.spotlight) return <SpotlightRow benefit={benefit} />;
  if (benefit.featureName) return <FeatureRow benefit={benefit} />;
  const channelColor = benefit.channel ? brandColor(benefit.channel, theme.palette.mode) : null;
  const marketplaces = benefit.marketplaces?.length ? benefit.marketplaces : null;
  const isDark = theme.palette.mode === 'dark';
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
        // Marketplaces: faixa neutra com os logos; as cores vêm das próprias marcas
        ...(marketplaces && {
          mx: -1, px: 1, py: 0.75, borderRadius: 1.5, alignItems: 'center', gap: 1.25,
          bgcolor: alpha(theme.palette.text.primary, isDark ? 0.06 : 0.035),
          border: 1, borderColor: 'divider',
        }),
      }}
    >
      {marketplaces ? (
        <MarketplaceLogos providers={marketplaces} />
      ) : (
        <Box sx={{ color: channelColor ?? accent, mt: '3px', display: 'flex' }}>
          <AppIcon icon={benefit.channel ? CHANNEL_LOGO[benefit.channel] : Check} size="sm" strokeWidth={3} />
        </Box>
      )}
      <Typography component="div" variant="body2" sx={{ fontWeight: benefit.strong || benefit.channel || marketplaces ? 700 : 400, color: benefit.strong || benefit.channel || marketplaces ? 'text.primary' : 'text.secondary', lineHeight: 1.45, flex: 1 }}>
        {benefit.label}
        {benefit.exclusive && (
          <Chip label={t.card.exclusive} size="small" color="secondary" variant="outlined" sx={{ ...exclusiveChipSx, ml: 1, verticalAlign: 'middle' }} />
        )}
        {benefit.detail && (
          <Box component="span" sx={{ display: 'block', fontWeight: 600, color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>
            {benefit.detail}
          </Box>
        )}
      </Typography>
      {benefit.hint && (
        <Box sx={{ color: 'text.secondary', display: 'flex', mt: marketplaces ? 0 : '3px' }}>
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

/** Limite de etiquetas do Mercado Livre (fora da tabela: não é por canal). Tooltip explica o número. */
function MercadoLivreTagsRow({ count }: { count: number }) {
  return (
    <Tooltip title={t.mercadoLivreTags.hint} enterTouchDelay={0} arrow describeChild placement="top">
      <Box
        tabIndex={0}
        data-testid="plan-ml-tags"
        sx={{
          display: 'flex', alignItems: 'center', gap: 1, cursor: 'help', mt: -1, px: 1, py: 0.75, mx: -1, borderRadius: 1.5,
          '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 1 },
        }}
      >
        {ML_LOGO && <MarketplaceLogo src={ML_LOGO} size={20} round />}
        {/* Rótulo e valor em linhas fixas (uma cada, sem quebra): mesma altura nos três cards, seja
            "1 etiqueta" ou "10 etiquetas". */}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="body2" noWrap sx={{ color: 'text.secondary' }}>{t.mercadoLivreTags.label}</Typography>
          <Typography variant="body2" noWrap sx={{ fontWeight: 700, color: 'text.primary', fontVariantNumeric: 'tabular-nums' }}>
            {t.mercadoLivreTags.value(count)}
          </Typography>
        </Box>
        <Box sx={{ color: 'text.secondary', display: 'flex' }}><AppIcon icon={Info} size="sm" /></Box>
      </Box>
    </Tooltip>
  );
}

/** Card de plano. O recomendado ganha moldura em gradiente e selo "Mais escolhido". */
export function PlanCard({ plan, period, getCheckoutUrl, index = 0 }: Props) {
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
        <Typography variant="caption" sx={{ color: 'text.secondary', textDecoration: 'line-through', fontWeight: 600 }}>
          {t.card.from(formatPrice(period === 'annual' ? plan.price : plan.priceFrom))}
        </Typography>
        {/* "/mês" e "cobrado …" centralizados na altura do número, os dois ao lado dele */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
          <Typography
            key={price}
            component="span"
            sx={{
              fontSize: 34, fontWeight: 800, lineHeight: 1, letterSpacing: -1, fontVariantNumeric: 'tabular-nums',
              animation: `${priceSwap} .35s cubic-bezier(.2,.8,.2,1)`, [REDUCED_MOTION]: { animation: 'none' },
            }}
          >
            {formatPrice(price)}
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <Typography variant="body2" sx={{ fontWeight: 600, color: 'text.secondary', lineHeight: 1.2 }}>{t.card.perMonth}</Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary', lineHeight: 1.2 }}>{period === 'annual' ? t.card.billedAnnually : t.card.billedMonthly}</Typography>
          </Box>
        </Box>
        <Chip
          label={savingsLabel}
          size="small"
          sx={{ mt: 1, height: 22, fontWeight: 800, fontSize: 11, bgcolor: alpha(theme.palette.success.main, 0.18), color: theme.palette.mode === 'dark' ? 'success.main' : darken(theme.palette.success.dark, 0.25) }}
        />
      </Box>

      <Box>
        <Button
          fullWidth
          size="large"
          variant={recommended ? 'contained' : 'outlined'}
          // Síncrono no clique (Enter/Espaço disparam o mesmo evento no <button>): sem pop-up bloqueado
          onClick={() => openCheckout(getCheckoutUrl())}
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

      <MercadoLivreTagsRow count={plan.limits.mercadoLivreTags} />

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
          backgroundSize: '200% 200%',
          animation: `${cardEnter} .55s cubic-bezier(.2,.8,.2,1) ${enterDelay(index)} backwards, ${gradientFlow} 8s ease-in-out 1s infinite`,
          transition: 'transform .3s cubic-bezier(.2,.8,.2,1), box-shadow .3s',
          '&:hover': { transform: 'translateY(-4px)', boxShadow: `0 22px 50px -16px ${alpha(accent, 0.85)}` },
          [REDUCED_MOTION]: { animation: 'none', transition: 'none', '&:hover': { transform: 'none' } },
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
        animation: `${cardEnter} .55s cubic-bezier(.2,.8,.2,1) ${enterDelay(index)} backwards`,
        transition: 'transform .3s cubic-bezier(.2,.8,.2,1), box-shadow .3s, border-color .3s',
        '&:hover': { transform: 'translateY(-4px)', borderColor: alpha(accent, 0.45), boxShadow: `0 18px 40px -20px ${alpha(accent, 0.6)}` },
        [REDUCED_MOTION]: { animation: 'none', transition: 'none', '&:hover': { transform: 'none' } },
      }}
    >
      {body}
    </Paper>
  );
}
