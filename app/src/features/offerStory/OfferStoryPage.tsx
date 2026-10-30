import { useEffect, useMemo } from 'react';
import { Alert, Box, Card, CardContent, Typography } from '@mui/material';
import { OfferStoryHero } from './components/OfferStoryHero';
import { GeneratingOverlay } from './components/GeneratingOverlay';
import { ProductStep } from './components/ProductStep';
import { ResultStep } from './components/ResultStep';
import { TemplateStep } from './components/TemplateStep';
import { useOfferStoryFavorites } from './hooks/useOfferStoryFavorites';
import { useOfferStoryTemplates } from './hooks/useOfferStoryTemplates';
import { useOfferStoryWizard } from './hooks/useOfferStoryWizard';
import { offerStoryStrings } from './strings';

const t = offerStoryStrings;

/** Story de Oferta (exclusivo Business): template → produto → compartilhar. Estado em hooks. */
export function OfferStoryPage() {
  const catalog = useOfferStoryTemplates();
  const ids = useMemo(() => catalog.templates?.map((tpl) => tpl.id) ?? null, [catalog.templates]);
  const favorites = useOfferStoryFavorites(ids);
  const w = useOfferStoryWizard();
  const { selectTemplate, goTo, dropStaleResult } = w;

  // Template salvo (rascunho ou arte) que saiu do catálogo: descarta e volta a escolher.
  useEffect(() => {
    if (ids) dropStaleResult(ids);
    if (ids && w.templateId && !ids.includes(w.templateId)) {
      selectTemplate('');
      goTo(0);
    }
  }, [ids, w.templateId, selectTemplate, goTo, dropStaleResult]);

  const heading = w.step === 0 ? t.template : w.step === 1 ? t.product : null;
  const picked = catalog.templates?.find((tpl) => tpl.id === w.templateId) ?? null;
  // Leque do hero: o escolhido no centro, quando houver.
  const showcase = useMemo(() => {
    const list = ids ?? [];
    if (!w.templateId || !list.includes(w.templateId)) return list.slice(0, 3);
    const rest = list.filter((id) => id !== w.templateId);
    return [rest[0], w.templateId, rest[1]].filter(Boolean) as string[];
  }, [ids, w.templateId]);

  return (
    <Box>
      <OfferStoryHero step={w.step} showcaseIds={showcase} />

      {/* overflow visível: senão o Card vira contêiner de rolagem e quebra o `sticky` do passo 1. */}
      <Card sx={{ overflow: 'visible', borderRadius: '20px' }}>
        <CardContent sx={{ p: { xs: 2, sm: 3.5 } }}>
          {heading && (
            <Box sx={{ mb: 3 }}>
              <Typography variant="h6" component="h2" sx={{ fontWeight: 800, letterSpacing: '-0.01em' }}>{heading.title}</Typography>
              <Typography variant="body2" color="text.secondary">{heading.subtitle}</Typography>
            </Box>
          )}

          {w.step === 0 && w.generalError && <Alert severity="error" onClose={w.dismissError} sx={{ mb: 2 }}>{w.generalError}</Alert>}
          {w.step === 0 && (
            <TemplateStep
              templates={catalog.templates}
              loading={catalog.loading}
              failed={catalog.failed}
              onRetry={() => void catalog.reload()}
              selectedId={w.templateId}
              onSelect={w.selectTemplate}
              isFavorite={favorites.isFavorite}
              favoritesCount={favorites.favorites.length}
              onToggleFavorite={favorites.toggle}
              onContinue={() => w.goTo(1)}
            />
          )}
          {w.step === 1 && (
            <ProductStep
              form={w.form}
              errors={w.errors}
              generalError={w.generalError}
              onDismissError={w.dismissError}
              generating={w.generating}
              template={picked}
              onChange={w.setField}
              onBack={() => w.goTo(0)}
              onGenerate={() => void w.generate()}
            />
          )}
          {w.step === 2 && w.result && <ResultStep result={w.result} onEdit={w.edit} onNew={w.reset} />}
        </CardContent>
      </Card>

      <GeneratingOverlay open={w.generating} />
    </Box>
  );
}
