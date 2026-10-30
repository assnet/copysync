import { Alert, Box, Button, Skeleton, Tab, Tabs, Tooltip, Typography, alpha, useTheme } from '@mui/material';
import { ArrowRight, RotateCw, Star } from 'lucide-react';
import { AppIcon, EmptyState } from '@/components';
import { usePersistedState } from '@/hooks/usePersistedState';
import { offerStoryStrings } from '../strings';
import { templateThumbnail, type OfferStoryTemplate } from '../types';
import { TemplateCard } from './TemplateCard';
import { TEMPLATE_TAB_KEY } from '../sessionState';

const t = offerStoryStrings.template;
type TemplateTab = 'all' | 'favorites';

const GRID = {
  display: 'grid', columnGap: { xs: 1.5, sm: 2.5 }, rowGap: { xs: 2, sm: 3 },
  gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', sm: 'repeat(3, minmax(0, 1fr))', md: 'repeat(4, minmax(0, 1fr))', lg: 'repeat(6, minmax(0, 1fr))' },
} as const;

interface Props {
  templates: OfferStoryTemplate[] | null;
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
  selectedId: string;
  onSelect: (id: string) => void;
  isFavorite: (id: string) => boolean;
  favoritesCount: number;
  onToggleFavorite: (id: string) => void;
  onContinue: () => void;
}

function TabLabel({ text, count, active }: { text: string; count: number; active: boolean }) {
  return (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
      {text}
      <Box
        component="span"
        sx={(th) => ({
          minWidth: 22, height: 20, px: 0.75, borderRadius: 999, display: 'inline-grid', placeItems: 'center',
          fontSize: '0.75rem', fontWeight: 700,
          bgcolor: active ? alpha(th.palette.primary.main, 0.16) : alpha(th.palette.text.primary, 0.07),
          color: active ? 'primary.main' : 'text.secondary',
        })}
      >
        {count}
      </Box>
    </Box>
  );
}

/** Passo 1: galeria de templates com abas Todos/Favoritos e barra de ação (fixa no xs). */
export function TemplateStep({ templates, loading, failed, onRetry, selectedId, onSelect, isFavorite, favoritesCount, onToggleFavorite, onContinue }: Props) {
  const theme = useTheme();
  const [tab, setTab] = usePersistedState<TemplateTab>(TEMPLATE_TAB_KEY, 'all');
  const all = templates ?? [];
  const visible = tab === 'favorites' ? all.filter((tpl) => isFavorite(tpl.id)) : all;
  const picked = all.find((tpl) => tpl.id === selectedId) ?? null;

  if (failed) {
    return (
      <Alert severity="error" action={<Button color="inherit" size="small" startIcon={<AppIcon icon={RotateCw} size="sm" />} onClick={onRetry}>{t.retry}</Button>}>
        {t.loadError}
      </Alert>
    );
  }

  return (
    <Box>
      <Tabs
        value={tab}
        onChange={(_, v: TemplateTab) => setTab(v)}
        aria-label={t.tabsLabel}
        sx={{
          mb: 3, minHeight: 0, display: 'inline-flex', p: 0.5, borderRadius: 999,
          bgcolor: alpha(theme.palette.text.primary, theme.palette.mode === 'dark' ? 0.06 : 0.04),
          '& .MuiTabs-indicator': { height: '100%', borderRadius: 999, bgcolor: 'background.paper', boxShadow: 1, zIndex: 0 },
          '& .MuiTab-root': { minHeight: 36, py: 0.5, px: 2, zIndex: 1, textTransform: 'none', fontWeight: 600, borderRadius: 999, color: 'text.secondary' },
          '& .MuiTab-root.Mui-selected': { color: 'text.primary' },
          '& .MuiTab-root.Mui-focusVisible': { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: -2 },
        }}
      >
        <Tab value="all" disableRipple label={<TabLabel text={t.tabAll} count={all.length} active={tab === 'all'} />} />
        <Tab
          value="favorites"
          disableRipple
          icon={<AppIcon icon={Star} size="sm" />}
          iconPosition="start"
          label={<TabLabel text={t.tabFavorites} count={favoritesCount} active={tab === 'favorites'} />}
          sx={{ gap: 0.75, '& svg': { color: 'warning.main' } }}
        />
      </Tabs>

      {loading && !templates ? (
        <Box sx={GRID}>
          {Array.from({ length: 10 }, (_, i) => <Skeleton key={i} variant="rounded" sx={{ aspectRatio: '9 / 16', height: 'auto', borderRadius: '16px', m: '6px' }} />)}
        </Box>
      ) : visible.length === 0 && tab === 'favorites' ? (
        <EmptyState icon={<AppIcon icon={Star} size="lg" />} title={t.emptyTitle} description={t.emptyHint} sx={{ py: 6 }} />
      ) : (
        <Box sx={GRID}>
          {visible.map((tpl) => (
            <TemplateCard
              key={tpl.id}
              template={tpl}
              selected={tpl.id === selectedId}
              favorite={isFavorite(tpl.id)}
              onSelect={() => onSelect(tpl.id)}
              onToggleFavorite={() => onToggleFavorite(tpl.id)}
            />
          ))}
        </Box>
      )}

      {/* Barra de ação: mostra o escolhido; no xs fica fixa no rodapé enquanto a grade rola. */}
      <Box
        sx={{
          display: 'flex', alignItems: 'center', gap: 1.5, mt: 3,
          position: { xs: 'sticky', sm: 'static' }, bottom: 0, zIndex: 2,
          mx: { xs: -2, sm: 0 }, px: { xs: 2, sm: 0 }, pt: { xs: 1.5, sm: 2.5 },
          pb: { xs: 'calc(12px + env(safe-area-inset-bottom))', sm: 0 },
          bgcolor: { xs: alpha(theme.palette.background.paper, 0.92), sm: 'transparent' },
          backdropFilter: { xs: 'blur(10px)', sm: 'none' },
          borderTop: 1, borderColor: 'divider',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, minWidth: 0, flex: 1 }} aria-live="polite">
          {picked && (
            <Box
              aria-hidden
              component="img"
              src={templateThumbnail(picked.id)}
              alt=""
              sx={{ width: 27, height: 48, objectFit: 'cover', borderRadius: '6px', flexShrink: 0, boxShadow: 1 }}
            />
          )}
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.2 }}>
              {picked ? t.pickedLabel : t.nonePicked}
            </Typography>
            {picked && <Typography variant="body2" noWrap sx={{ fontWeight: 700 }}>{picked.name}</Typography>}
          </Box>
        </Box>
        <Tooltip title={picked ? '' : t.continueHint} arrow describeChild>
          <span>
            <Button variant="contained" size="large" disableElevation endIcon={<AppIcon icon={ArrowRight} size="sm" />} disabled={!picked} onClick={onContinue} sx={{ px: 3, borderRadius: 999 }}>
              {t.continue}
            </Button>
          </span>
        </Tooltip>
      </Box>
    </Box>
  );
}
