import { useEffect, useMemo } from 'react';
import { Alert, Box, Card, CardContent, Step, StepLabel, Stepper, Typography, alpha, useTheme } from '@mui/material';
import { AppIcon } from '@/components';
import { MODULE_ICONS } from '@/pages/modules';
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
  const theme = useTheme();
  const catalog = useOfferStoryTemplates();
  const ids = useMemo(() => catalog.templates?.map((tpl) => tpl.id) ?? null, [catalog.templates]);
  const favorites = useOfferStoryFavorites(ids);
  const w = useOfferStoryWizard();
  const { selectTemplate, goTo } = w;

  // Template salvo que saiu do catálogo: volta a escolher.
  useEffect(() => {
    if (ids && w.templateId && !ids.includes(w.templateId)) {
      selectTemplate('');
      goTo(0);
    }
  }, [ids, w.templateId, selectTemplate, goTo]);

  const heading = w.step === 0 ? t.template : w.step === 1 ? t.product : null;
  const { primary, secondary } = theme.palette;

  return (
    <Box>
      <Box component="header" sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
        <Box
          aria-hidden
          sx={{
            width: 48, height: 48, borderRadius: 2.5, display: 'grid', placeItems: 'center', flexShrink: 0,
            color: primary.contrastText, backgroundImage: `linear-gradient(135deg, ${primary.main}, ${secondary.main})`,
            boxShadow: `0 8px 20px -8px ${alpha(primary.main, 0.6)}`,
          }}
        >
          <AppIcon icon={MODULE_ICONS.offerStory} size="lg" />
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="h5" component="h1" sx={{ fontWeight: 800 }}>{t.page.title}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, maxWidth: 620 }}>{t.page.subtitle}</Typography>
        </Box>
      </Box>

      {/* overflow visível: senão o Card vira contêiner de rolagem e quebra o `sticky` do passo 1. */}
      <Card sx={{ overflow: 'visible' }}>
        <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
          <Stepper activeStep={w.step} alternativeLabel sx={{ mb: 4 }}>
            {t.page.steps.map((label) => (
              <Step key={label}><StepLabel>{label}</StepLabel></Step>
            ))}
          </Stepper>

          {heading && (
            <Box sx={{ mb: 2.5 }}>
              <Typography variant="h6" component="h2" sx={{ fontWeight: 700 }}>{heading.title}</Typography>
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
