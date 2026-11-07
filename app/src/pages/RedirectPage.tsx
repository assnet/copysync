import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Box, Button, CircularProgress, Link, Stack, Typography } from '@mui/material';
import { Link2Off, WifiOff } from 'lucide-react';
import { AppIcon } from '@/components';
import { APP_NAME } from '@/shared/branding/brand';
import { BrandLogo } from '@/shared/branding/BrandLogo';
import { isHttpsUrl } from '@/features/redirectLinks/rules';
import { redirectLinksStrings } from '@/features/redirectLinks/strings';
import { publicRedirectService } from '@/services/publicRedirect.service';

const t = redirectLinksStrings.public;

type State = { kind: 'loading' } | { kind: 'going'; url: string } | { kind: 'unavailable' } | { kind: 'error' };

/** Navegação isolada para o teste trocar (jsdom não navega). */
export const redirectNavigator = { replace: (url: string) => window.location.replace(url) };

/**
 * Página pública `/redirect/:slug` (fora do login e do layout do painel). Pede o destino à API
 * (sorteio A/B e clique contados lá) e troca a página com `location.replace`, sem deixar esta
 * tela no histórico. Só segue para `https://`; 404 ou destino fora da regra = "link indisponível".
 */
export function RedirectPage() {
  const { slug = '' } = useParams<{ slug: string }>();
  const [state, setState] = useState<State>({ kind: 'loading' });
  // Uma resolução por slug: o StrictMode (dev) roda o efeito duas vezes e contaria 2 cliques.
  const resolvedFor = useRef<string | null>(null);

  const resolve = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      const url = await publicRedirectService.resolve(slug);
      if (!isHttpsUrl(url)) {
        setState({ kind: 'unavailable' });
        return;
      }
      setState({ kind: 'going', url });
      redirectNavigator.replace(url);
    } catch (err) {
      const status = (err as { status?: number } | null)?.status;
      setState({ kind: status === 404 || status === 400 ? 'unavailable' : 'error' });
    }
  }, [slug]);

  useEffect(() => {
    if (resolvedFor.current === slug) return;
    resolvedFor.current = slug;
    void resolve();
  }, [resolve, slug]);

  useEffect(() => {
    const previous = document.title;
    document.title = state.kind === 'unavailable' ? `${t.unavailableTitle} · ${APP_NAME}` : `${t.pageTitle} · ${APP_NAME}`;
    return () => { document.title = previous; };
  }, [state.kind]);

  const busy = state.kind === 'loading' || state.kind === 'going';

  return (
    <Box
      component="main"
      sx={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', px: 2, bgcolor: 'background.default', color: 'text.primary' }}
    >
      <Stack spacing={2.5} alignItems="center" sx={{ maxWidth: 380, textAlign: 'center' }} aria-live="polite" aria-busy={busy}>
        <BrandLogo size={56} />
        {busy && (
          <>
            <CircularProgress size={28} aria-label={t.redirecting} />
            <Box>
              <Typography component="h1" variant="h6" fontWeight={700}>{t.redirecting}</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{t.redirectingHint}</Typography>
            </Box>
            {state.kind === 'going' && (
              <Link href={state.url} rel="noopener noreferrer" variant="body2">{t.manualLink}</Link>
            )}
          </>
        )}
        {state.kind === 'unavailable' && (
          <>
            <Box sx={{ color: 'text.secondary' }}><AppIcon icon={Link2Off} size="lg" aria-hidden /></Box>
            <Box>
              <Typography component="h1" variant="h6" fontWeight={700}>{t.unavailableTitle}</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{t.unavailableHint}</Typography>
            </Box>
          </>
        )}
        {state.kind === 'error' && (
          <>
            <Box sx={{ color: 'text.secondary' }}><AppIcon icon={WifiOff} size="lg" aria-hidden /></Box>
            <Box>
              <Typography component="h1" variant="h6" fontWeight={700}>{t.errorTitle}</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{t.errorHint}</Typography>
            </Box>
            <Button variant="contained" disableElevation onClick={() => void resolve()}>{t.retry}</Button>
          </>
        )}
      </Stack>
    </Box>
  );
}
