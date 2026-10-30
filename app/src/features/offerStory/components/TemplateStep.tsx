import { Alert, Box, Button, Skeleton, Tab, Tabs, Tooltip } from '@mui/material';
import { ArrowRight, RotateCw, Star } from 'lucide-react';
import { AppIcon, EmptyState } from '@/components';
import { usePersistedState } from '@/hooks/usePersistedState';
import { offerStoryStrings } from '../strings';
import type { OfferStoryTemplate } from '../types';
import { TemplateCard } from './TemplateCard';

const t = offerStoryStrings.template;
type TemplateTab = 'all' | 'favorites';

const GRID = { display: 'grid', gap: 2, gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', sm: 'repeat(auto-fill, minmax(150px, 1fr))' } } as const;

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

/** Passo 1: grade de templates com abas Todos/Favoritos. */
export function TemplateStep({ templates, loading, failed, onRetry, selectedId, onSelect, isFavorite, favoritesCount, onToggleFavorite, onContinue }: Props) {
  const [tab, setTab] = usePersistedState<TemplateTab>('offerStory.templateTab', 'all');
  const all = templates ?? [];
  const visible = tab === 'favorites' ? all.filter((tpl) => isFavorite(tpl.id)) : all;
  const canContinue = all.some((tpl) => tpl.id === selectedId);

  if (failed) {
    return (
      <Alert severity="error" action={<Button color="inherit" size="small" startIcon={<AppIcon icon={RotateCw} size="sm" />} onClick={onRetry}>{t.retry}</Button>}>
        {t.loadError}
      </Alert>
    );
  }

  return (
    <Box>
      <Tabs value={tab} onChange={(_, v: TemplateTab) => setTab(v)} aria-label={t.tabsLabel} sx={{ mb: 2.5, borderBottom: 1, borderColor: 'divider' }}>
        <Tab value="all" label={t.tabAll(all.length)} />
        <Tab value="favorites" label={t.tabFavorites(favoritesCount)} />
      </Tabs>

      {loading && !templates ? (
        <Box sx={GRID}>
          {Array.from({ length: 8 }, (_, i) => <Skeleton key={i} variant="rounded" sx={{ aspectRatio: '9 / 16', height: 'auto', borderRadius: 3 }} />)}
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

      <Box
        sx={{
          display: 'flex', justifyContent: 'flex-end', mt: 3,
          // xs: ação fixa no rodapé enquanto a grade rola.
          position: { xs: 'sticky', sm: 'static' }, bottom: 0, zIndex: 2,
          mx: { xs: -2, sm: 0 }, px: { xs: 2, sm: 0 }, pt: { xs: 1.5, sm: 0 },
          pb: { xs: 'calc(12px + env(safe-area-inset-bottom))', sm: 0 },
          bgcolor: { xs: 'background.paper', sm: 'transparent' },
          borderTop: { xs: 1, sm: 0 }, borderColor: 'divider',
        }}
      >
        <Tooltip title={canContinue ? '' : t.continueHint} arrow describeChild>
          <span>
            <Button variant="contained" disableElevation endIcon={<AppIcon icon={ArrowRight} size="sm" />} disabled={!canContinue} onClick={onContinue}>
              {t.continue}
            </Button>
          </span>
        </Tooltip>
      </Box>
    </Box>
  );
}
