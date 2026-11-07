import { useEffect, useState } from 'react';
import { Box, IconButton, Tooltip, Typography, alpha, useTheme } from '@mui/material';
import { Puzzle, X } from 'lucide-react';
import { AppIcon } from '@/components/AppIcon';
import { usePersistedState } from '@/hooks/usePersistedState';
import { useAuth } from '@/contexts/AuthContext';
import { detectExtension, hasConfiguredExtensionIds } from '../channel/client';
import { isChromiumDesktop } from '../config';
import { extensionStrings } from '../strings';
import { ExtensionInstallPanel } from './ExtensionInstallPanel';

const t = extensionStrings.banner;

/** Chave da dispensa (localStorage, por usuário): outro login no mesmo navegador ainda vê o aviso. */
export const installBannerDismissKey = (userId: string) => `extension.installBanner.dismissed.${userId}`;

type Presence = 'checking' | 'missing' | 'present';

/**
 * Aviso de primeiro acesso no Dashboard: só para navegador compatível em que a extensão não
 * respondeu. Some ao detectar; "Dispensar" vale para sempre para este usuário neste navegador.
 */
export function ExtensionInstallBanner() {
  const { user } = useAuth();
  if (!user?.id || !isChromiumDesktop() || !hasConfiguredExtensionIds()) return null;
  return <InstallBannerForUser userId={user.id} />;
}

function InstallBannerForUser({ userId }: { userId: string }) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const [dismissed, setDismissed] = usePersistedState<boolean>(installBannerDismissKey(userId), false, { scope: 'browser' });
  const [presence, setPresence] = useState<Presence>('checking');

  useEffect(() => {
    if (dismissed) return undefined;
    let cancelled = false;
    detectExtension()
      .then((found) => { if (!cancelled) setPresence(found ? 'present' : 'missing'); })
      .catch(() => { if (!cancelled) setPresence('missing'); });
    return () => { cancelled = true; };
  }, [dismissed]);

  if (dismissed || presence !== 'missing') return null;

  return (
    <Box
      component="section"
      aria-labelledby="extension-install-banner-title"
      sx={{
        mb: 4,
        p: { xs: 2, sm: 2.5 },
        borderRadius: 3,
        border: `1px solid ${alpha(theme.palette.primary.main, isDark ? 0.35 : 0.22)}`,
        bgcolor: 'background.paper',
        backgroundImage: `linear-gradient(135deg, ${alpha(theme.palette.primary.main, isDark ? 0.12 : 0.06)} 0%, transparent 70%)`,
      }}
    >
      <Box sx={{ display: 'flex', gap: 1.75, alignItems: 'flex-start', mb: 2 }}>
        <Box
          aria-hidden
          sx={{
            width: 40, height: 40, borderRadius: '50%', display: 'grid', placeItems: 'center', flexShrink: 0,
            color: 'primary.main', bgcolor: alpha(theme.palette.primary.main, isDark ? 0.2 : 0.12),
          }}
        >
          <AppIcon icon={Puzzle} size="md" />
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography id="extension-install-banner-title" component="h2" sx={{ fontWeight: 700, fontSize: '1rem', lineHeight: 1.35 }}>
            {t.title}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>{t.hint}</Typography>
        </Box>
        <Tooltip title={t.dismissTooltip}>
          <IconButton size="small" aria-label={t.dismiss} onClick={() => setDismissed(true)} sx={{ mt: -0.5, mr: -0.5 }}>
            <AppIcon icon={X} size="sm" />
          </IconButton>
        </Tooltip>
      </Box>
      <ExtensionInstallPanel source="onboarding" showIntro={false} onDetected={() => setPresence('present')} />
    </Box>
  );
}
