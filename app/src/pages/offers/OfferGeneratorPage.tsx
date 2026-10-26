import { useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Alert, Box, Button, CircularProgress, Snackbar, Stack, Tooltip, Typography } from '@mui/material';
import GroupsOutlinedIcon from '@mui/icons-material/GroupsOutlined';
import SendOutlinedIcon from '@mui/icons-material/SendOutlined';
import AddIcon from '@mui/icons-material/Add';
import LocalOfferOutlinedIcon from '@mui/icons-material/LocalOfferOutlined';
import { ConfirmDialog, EmptyState, PageHeader, SectionCard } from '@/components';
import { useOfferGenerator } from '@/features/offers/hooks/useOfferGenerator';
import { useOfferDraft } from '@/features/offers/hooks/useOfferDraft';
import { OfferLinkInput } from '@/features/offers/components/OfferLinkInput';
import { OfferUsageChip } from '@/features/offers/components/OfferUsageChip';
import { OfferPreviewCard } from '@/features/offers/components/OfferPreviewCard';
import { OfferEditor } from '@/features/offers/components/OfferEditor';
import { OfferDestinationsDialog } from '@/features/offers/components/OfferDestinationsDialog';
import { OfferDispatchProgress } from '@/features/offers/components/OfferDispatchProgress';
import { offerStrings } from '@/features/offers/strings';
import type { OfferErrorView } from '@/features/offers/utils/offerErrors';

const t = offerStrings;
const CREDENTIALS_PATH = '/settings/affiliate-credentials';

export function OfferGeneratorPage() {
  const gen = useOfferGenerator();
  const { offer } = gen;
  const form = useOfferDraft(offer);
  const [destinationsOpen, setDestinationsOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  const destinationCount = gen.destinations.length;
  const limitReached = gen.usage?.limit != null && gen.usage.used >= gen.usage.limit;
  const linkFieldError = gen.error?.isLinkField ? gen.error.message : null;
  const pageError = gen.error && !gen.error.isLinkField ? gen.error : null;
  /** Editável e enviável: rascunho ou envio que falhou por inteiro (mesma regra da API). */
  const isDraft = offer?.status === 'DRAFT';

  const ignore = () => undefined;

  const errorAction = (err: OfferErrorView) => {
    if (err.action === 'credentials') {
      return (
        <Button color="inherit" size="small" component={RouterLink} to={CREDENTIALS_PATH}>
          {err.code === 'AFFILIATE_CREDENTIAL_REJECTED' ? t.editCredentials : t.goToCredentials}
        </Button>
      );
    }
    if (err.action === 'destinations') {
      return (
        <Button color="inherit" size="small" onClick={() => setDestinationsOpen(true)}>
          {t.destinations.button(0)}
        </Button>
      );
    }
    return undefined;
  };

  const sendDisabled = !isDraft || destinationCount === 0 || form.textTooLong || gen.sending || gen.saving || gen.imageProgress != null;

  return (
    <Box>
      <PageHeader
        title={t.page.title}
        subtitle={t.page.subtitle}
        action={
          <Stack direction="row" spacing={1.5} alignItems="center">
            <OfferUsageChip usage={gen.usage} />
            <Tooltip title={t.destinations.buttonTooltip}>
              <Button variant="outlined" startIcon={<GroupsOutlinedIcon />} onClick={() => setDestinationsOpen(true)}>
                {t.destinations.button(destinationCount)}
              </Button>
            </Tooltip>
          </Stack>
        }
      />

      <SectionCard sx={{ mb: 3 }}>
        <OfferLinkInput
          generating={gen.generating}
          serverError={linkFieldError}
          disabled={limitReached}
          onGenerate={gen.generate}
          onChange={() => { if (gen.error?.isLinkField) gen.clearError(); }}
        />
        {limitReached && gen.usage?.limit != null && (
          <Alert severity="warning" sx={{ mt: 2 }}>{t.planLimit(gen.usage.limit)}</Alert>
        )}
        {!offer && pageError && (
          <Alert severity="error" sx={{ mt: 2 }} onClose={gen.clearError} action={errorAction(pageError)}>
            {pageError.message}
          </Alert>
        )}
      </SectionCard>

      {!offer ? (
        <EmptyState
          icon={<LocalOfferOutlinedIcon />}
          title={t.page.emptyTitle}
          description={t.page.emptyDescription}
        />
      ) : (
        <Box
          sx={{
            display: 'grid',
            gap: 3,
            gridTemplateColumns: { xs: '1fr', md: 'minmax(280px, 360px) 1fr' },
            alignItems: 'start',
          }}
        >
          <Box sx={{ position: { md: 'sticky' }, top: { md: 88 } }}>
            <Typography variant="overline" color="text.secondary" component="h2" sx={{ display: 'block', mb: 1 }}>
              {t.preview.title}
            </Typography>
            <OfferPreviewCard
              provider={offer.provider}
              imageUrl={offer.imageUrl}
              title={form.draft.title}
              priceCents={form.draft.priceCents}
              originalPriceCents={form.draft.originalPriceCents}
              affiliateUrl={offer.affiliateUrl}
            />
          </Box>

          <Stack spacing={3} sx={{ minWidth: 0 }}>
            <OfferEditor
              offer={offer}
              draft={form.draft}
              onField={form.setField}
              needsManualData={gen.needsManualData}
              dirty={form.dirty}
              saving={gen.saving}
              textTooLong={form.textTooLong}
              missingLink={form.missingLink}
              imageProgress={gen.imageProgress}
              onSave={() => {
                gen.update(form.patch).then(() => setSavedNotice(t.editor.saved), ignore);
              }}
              onReplaceImage={(file) => { gen.replaceImage(file).catch(ignore); }}
            />

            {isDraft ? (
              <Box
                sx={{
                  display: 'flex',
                  gap: 1.5,
                  alignItems: { xs: 'stretch', sm: 'center' },
                  justifyContent: 'space-between',
                  flexDirection: { xs: 'column', sm: 'row' },
                }}
              >
                <Typography variant="body2" color="text.secondary">
                  {destinationCount === 0 ? t.send.noDestinations : t.destinations.selectedCount(destinationCount)}
                </Typography>
                <Button
                  variant="contained"
                  size="large"
                  disableElevation
                  startIcon={gen.sending ? <CircularProgress size={18} color="inherit" /> : <SendOutlinedIcon />}
                  disabled={sendDisabled}
                  onClick={() => setConfirmOpen(true)}
                >
                  {gen.sending ? t.send.sending : t.send.button(destinationCount)}
                </Button>
              </Box>
            ) : (
              <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
                <Button variant="outlined" startIcon={<AddIcon />} onClick={gen.reset}>{t.page.newOffer}</Button>
              </Box>
            )}

            {offer.dispatches && offer.dispatches.length > 0 && (
              <OfferDispatchProgress status={offer.status} dispatches={offer.dispatches} destinations={gen.destinations} />
            )}
          </Stack>
        </Box>
      )}

      <OfferDestinationsDialog
        open={destinationsOpen}
        current={gen.destinations}
        onClose={() => setDestinationsOpen(false)}
        onSave={async (ids) => {
          await gen.saveDestinations(ids);
          setSavedNotice(t.destinations.saved);
        }}
      />

      <ConfirmDialog
        open={confirmOpen}
        title={t.send.confirmTitle(destinationCount)}
        description={t.send.confirmDescription(destinationCount, form.missingLink)}
        confirmLabel={t.send.confirm}
        cancelLabel={t.send.cancel}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false);
          gen.send(form.patch).catch(ignore);
        }}
      />

      <Snackbar
        open={Boolean(offer && pageError)}
        autoHideDuration={8000}
        onClose={(_, reason) => { if (reason !== 'clickaway') gen.clearError(); }}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          severity="error"
          variant="filled"
          onClose={gen.clearError}
          action={pageError ? errorAction(pageError) : undefined}
        >
          {pageError?.message}
        </Alert>
      </Snackbar>

      <Snackbar
        open={Boolean(savedNotice)}
        autoHideDuration={3000}
        onClose={() => setSavedNotice(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="success" variant="filled" onClose={() => setSavedNotice(null)}>{savedNotice}</Alert>
      </Snackbar>
    </Box>
  );
}
