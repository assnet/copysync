import { useEffect, useState } from 'react';
import { Badge, Box, Card, LinearProgress, Stack, Tooltip, Typography, alpha } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import AddLinkIcon from '@mui/icons-material/AddLink';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import PaymentsOutlinedIcon from '@mui/icons-material/PaymentsOutlined';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import type { AffiliateCredentialEntry } from '../hooks/useAffiliateCredentials';
import { settingsStrings } from '../strings';
import { MarketplaceLogo } from './MarketplaceLogo';

const t = settingsStrings.affiliate;
const STEP_ICONS = [AddLinkIcon, SwapHorizIcon, PaymentsOutlinedIcon];

/** Conectado = credencial salva e ativa; inativa não troca links, então não conta. */
export function isConnected(entry: AffiliateCredentialEntry): boolean {
  return entry.item?.status === 'ACTIVE';
}

function headline(connected: number, total: number): { title: string; hint: string } {
  if (connected === 0) return { title: t.summaryNone, hint: t.summaryNoneHint };
  if (connected === total) return { title: t.summaryAll, hint: t.summaryAllHint };
  return { title: t.summarySome(connected, total), hint: t.summarySomeHint };
}

/**
 * Topo da tela de credenciais: progresso de conexão (logos com selo) e os 3 passos de como
 * a troca de links funciona. A barra anima de 0 ao valor real uma vez, ao montar.
 */
export function AffiliateConnectionSummary({ entries }: { entries: AffiliateCredentialEntry[] }) {
  const total = entries.length;
  const connected = entries.filter(isConnected).length;
  const percent = total ? Math.round((connected / total) * 100) : 0;
  const { title, hint } = headline(connected, total);
  const [shown, setShown] = useState(0);

  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(percent));
    return () => cancelAnimationFrame(id);
  }, [percent]);

  return (
    <Card
      component="section"
      aria-label={t.summaryProgressLabel}
      sx={(theme) => ({
        mb: 3, overflow: 'hidden',
        backgroundImage: `linear-gradient(120deg, ${alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.16 : 0.08)} 0%, transparent 60%)`,
      })}
    >
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'minmax(280px, 5fr) 7fr' } }}>
        <Stack spacing={2} sx={{ p: { xs: 2.5, md: 3 } }}>
          <Stack direction="row" spacing={1}>
            {entries.map((entry) => {
              const ok = isConnected(entry);
              const label = ok ? t.marketplaceConnected(entry.spec.name) : t.marketplacePending(entry.spec.name);
              return (
                <Tooltip key={entry.spec.provider} title={label}>
                  {/* Tooltip põe o título como aria-label deste wrapper focável. */}
                  <Box role="img" tabIndex={0} sx={{ borderRadius: '50%', display: 'inline-flex', outlineOffset: 2 }}>
                    <Badge
                      overlap="circular"
                      anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                      badgeContent={ok ? (
                        <CheckCircleIcon
                          sx={{ fontSize: 18, color: 'success.main', bgcolor: 'background.paper', borderRadius: '50%' }}
                        />
                      ) : null}
                    >
                      <MarketplaceLogo
                        src={entry.spec.logo}
                        size={40}
                        round
                        sx={{ opacity: ok ? 1 : 0.55, filter: ok ? 'none' : 'grayscale(0.6)', transition: 'opacity .3s, filter .3s' }}
                      />
                    </Badge>
                  </Box>
                </Tooltip>
              );
            })}
          </Stack>

          <Box>
            <Typography variant="h6" component="p" sx={{ lineHeight: 1.3 }}>{title}</Typography>
            <Typography variant="body2" color="text.secondary">{hint}</Typography>
          </Box>

          <LinearProgress
            variant="determinate"
            value={shown}
            color={connected === total && total > 0 ? 'success' : 'primary'}
            aria-label={t.summaryProgressLabel}
            sx={{
              height: 8, borderRadius: 4,
              '& .MuiLinearProgress-bar': { borderRadius: 4, transition: 'transform .9s cubic-bezier(.2,.8,.2,1)' },
              '@media (prefers-reduced-motion: reduce)': { '& .MuiLinearProgress-bar': { transition: 'none' } },
            }}
          />
        </Stack>

        <Box
          sx={(theme) => ({
            p: { xs: 2.5, md: 3 },
            // Cor explícita: `borderLeft: 1` em media query cai em currentColor (linha branca no escuro).
            borderTop: { xs: `1px solid ${theme.palette.divider}`, md: 'none' },
            borderLeft: { xs: 'none', md: `1px solid ${theme.palette.divider}` },
          })}
        >
          <Typography variant="subtitle2" component="h2" sx={{ mb: 2 }}>{t.howItWorks}</Typography>
          <Box
            component="ol"
            sx={{
              listStyle: 'none', m: 0, p: 0, display: 'grid', gap: 2,
              gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' },
            }}
          >
            {t.steps.map((step, i) => {
              const Icon = STEP_ICONS[i];
              return (
                <Stack component="li" key={step.title} spacing={1.25} direction={{ xs: 'row', sm: 'column' }} aria-label={t.stepLabel(i + 1)}>
                  <Box
                    aria-hidden
                    sx={(theme) => ({
                      width: 40, height: 40, borderRadius: 1, flexShrink: 0, position: 'relative',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: 'primary.main', bgcolor: alpha(theme.palette.primary.main, 0.12),
                    })}
                  >
                    <Icon fontSize="small" />
                    <Box
                      component="span"
                      sx={{
                        position: 'absolute', top: -6, right: -6, width: 18, height: 18, borderRadius: '50%',
                        bgcolor: 'primary.main', color: 'primary.contrastText', fontSize: 11, fontWeight: 700,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}
                    >
                      {i + 1}
                    </Box>
                  </Box>
                  <Box>
                    <Typography variant="body2" fontWeight={600}>{step.title}</Typography>
                    <Typography variant="caption" color="text.secondary" component="p">{step.text}</Typography>
                  </Box>
                </Stack>
              );
            })}
          </Box>
        </Box>
      </Box>
      <Stack
        direction="row"
        spacing={1}
        alignItems="flex-start"
        sx={{ px: { xs: 2.5, md: 3 }, py: 1.5, borderTop: 1, borderColor: 'divider', bgcolor: 'action.hover' }}
      >
        <LockOutlinedIcon aria-hidden sx={{ fontSize: 16, mt: '2px', color: 'text.secondary' }} />
        <Typography variant="caption" color="text.secondary">{t.pageNotice}</Typography>
      </Stack>
    </Card>
  );
}
