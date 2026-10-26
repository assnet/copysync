import { useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Alert, Box, Button, Skeleton, Snackbar, Stack } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import ChatOutlinedIcon from '@mui/icons-material/ChatOutlined';
import { ConfirmDialog, EmptyState, PageHeader } from '@/components';
import { useOfferConfig } from '@/features/offers/hooks/useOfferConfig';
import { useOfferGenerator } from '@/features/offers/hooks/useOfferGenerator';
import { useOfferDraft } from '@/features/offers/hooks/useOfferDraft';
import { OfferConfigWizard } from '@/features/offers/components/config/OfferConfigWizard';
import { OfferConfigSummary } from '@/features/offers/components/OfferConfigSummary';
import { OfferGeneratorForm } from '@/features/offers/components/OfferGeneratorForm';
import { OfferResultPanel } from '@/features/offers/components/OfferResultPanel';
import { OfferUsageChip } from '@/features/offers/components/OfferUsageChip';
import { OfferDispatchProgress } from '@/features/offers/components/OfferDispatchProgress';
import { offerStrings } from '@/features/offers/strings';
import { DEFAULT_INTERVAL } from '@/features/offers/utils/offerConfig';
import type { OfferErrorView } from '@/features/offers/utils/offerErrors';

const t = offerStrings;
const CREDENTIALS_PATH = '/settings/affiliate-credentials';
const ignore = () => undefined;

export function OfferGeneratorPage() {
  const cfg = useOfferConfig();
  const gen = useOfferGenerator();
  const { offer } = gen;
  const form = useOfferDraft(offer);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [mentionUnavailable, setMentionUnavailable] = useState(false);

  const showWizard = !cfg.loading && !cfg.failed && (!cfg.configured || wizardOpen);
  const groupCount = cfg.groups.length;
  const sessionOffline = cfg.session != null && cfg.session.status !== 'CONNECTED';
  const limitReached = gen.usage?.limit != null && gen.usage.used >= gen.usage.limit;
  const offerSending = offer?.status === 'SENDING';
  const linkFieldError = gen.error?.isLinkField ? gen.error.message : null;
  const pageError = gen.error && !gen.error.isLinkField ? gen.error : null;
  const intervalMin = cfg.config?.intervalMinSeconds ?? DEFAULT_INTERVAL.min;
  const intervalMax = cfg.config?.intervalMaxSeconds ?? DEFAULT_INTERVAL.max;

  const markPlanError = (err: unknown) => {
    if ((err as OfferErrorView | null)?.code === 'PLAN_FEATURE_UNAVAILABLE') setMentionUnavailable(true);
  };

  const errorAction = (err: OfferErrorView) => {
    if (err.action === 'credentials') {
      return (
        <Button color="inherit" size="small" component={RouterLink} to={CREDENTIALS_PATH}>
          {err.code === 'AFFILIATE_CREDENTIAL_REJECTED' ? t.editCredentials : t.goToCredentials}
        </Button>
      );
    }
    if (err.action === 'config') {
      return <Button color="inherit" size="small" onClick={() => { gen.clearError(); setWizardOpen(true); }}>{t.openConfig}</Button>;
    }
    if (err.action === 'sessions') {
      return <Button color="inherit" size="small" component={RouterLink} to="/sessions">{t.goToSessions}</Button>;
    }
    return undefined;
  };

  const header = (
    <PageHeader title={t.page.title} subtitle={t.page.subtitle} action={<OfferUsageChip usage={gen.usage} />} />
  );

  if (cfg.loading) {
    return (
      <Box>
        {header}
        <Skeleton variant="rounded" height={56} sx={{ mb: 3 }} />
        <Skeleton variant="rounded" height={420} />
      </Box>
    );
  }

  if (cfg.failed) {
    return (
      <Box>
        {header}
        <Alert severity="error" action={<Button color="inherit" size="small" onClick={cfg.retry}>{t.page.retry}</Button>}>
          {t.page.loadError}
        </Alert>
      </Box>
    );
  }

  return (
    <Box>
      {header}

      {showWizard ? (
        <OfferConfigWizard
          config={cfg.config}
          groups={cfg.groups}
          groupLimit={cfg.groupLimit}
          sessions={cfg.sessions}
          sessionsLoading={cfg.sessionsLoading}
          sessionsFailed={cfg.sessionsFailed}
          onRetrySessions={() => void cfg.reloadSessions()}
          onSave={cfg.save}
          onSaved={() => { setWizardOpen(false); setNotice(t.wizard.saved); }}
          onCancel={cfg.configured ? () => setWizardOpen(false) : undefined}
        />
      ) : (
        <>
          <OfferConfigSummary session={cfg.session} groups={cfg.groups} onEdit={() => setWizardOpen(true)} />

          <Box
            sx={{
              display: 'grid',
              gap: 3,
              gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1fr) minmax(320px, 420px)' },
              alignItems: 'start',
            }}
          >
            <Stack spacing={2} sx={{ minWidth: 0 }}>
              <OfferGeneratorForm
                generating={gen.generating}
                serverError={linkFieldError}
                disabled={limitReached || offerSending}
                disabledReason={offerSending ? t.form.sendingLock : null}
                onGenerate={async (body) => {
                  setMentionUnavailable(false);
                  await gen.generate(body);
                }}
                onChange={() => { if (gen.error?.isLinkField) gen.clearError(); }}
              />
              {limitReached && gen.usage?.limit != null && <Alert severity="warning">{t.planLimit(gen.usage.limit)}</Alert>}
              {!offer && pageError && (
                <Alert severity="error" onClose={gen.clearError} action={errorAction(pageError)}>{pageError.message}</Alert>
              )}
            </Stack>

            <Stack spacing={2} sx={{ minWidth: 0, position: { md: 'sticky' }, top: { md: 88 } }}>
              {!offer ? (
                <EmptyState
                  icon={<ChatOutlinedIcon />}
                  title={t.preview.emptyTitle}
                  description={t.preview.emptyDescription}
                  sx={{ py: 8 }}
                />
              ) : (
                <>
                  <OfferResultPanel
                    key={offer.id}
                    offer={offer}
                    draft={form.draft}
                    onField={form.setField}
                    dirty={form.dirty}
                    textTooLong={form.textTooLong}
                    missingLink={form.missingLink}
                    needsManualData={gen.needsManualData}
                    aiFallback={gen.aiFallback}
                    groups={cfg.groups}
                    saving={gen.saving}
                    regenerating={gen.regenerating}
                    mentionSaving={gen.mentionSaving}
                    mentionUnavailable={mentionUnavailable}
                    sending={gen.sending}
                    imageProgress={gen.imageProgress}
                    sendBlocked={groupCount === 0 || sessionOffline}
                    onSave={async () => {
                      await gen.update(form.patch);
                      setNotice(t.editor.saved);
                    }}
                    onDiscard={form.discard}
                    onRegenerate={(audience) => { gen.regenerate(audience).catch(ignore); }}
                    onMentionAll={(value) => { gen.setMentionAll(value).catch(markPlanError); }}
                    onReplaceImage={(file) => { gen.replaceImage(file).catch(ignore); }}
                    onSend={() => setConfirmOpen(true)}
                  />

                  {offer.dispatches && offer.dispatches.length > 0 && (
                    <OfferDispatchProgress status={offer.status} dispatches={offer.dispatches} destinations={cfg.groups} />
                  )}

                  {(offer.status === 'SENT' || offer.status === 'FAILED') && (
                    <Button variant="outlined" startIcon={<AddIcon />} onClick={gen.reset} sx={{ alignSelf: 'flex-end' }}>
                      {t.page.newOffer}
                    </Button>
                  )}
                </>
              )}
            </Stack>
          </Box>
        </>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title={t.send.confirmTitle(groupCount)}
        description={t.send.confirmDescription(groupCount, intervalMin, intervalMax, Boolean(offer?.mentionAll), form.missingLink, form.dirty)}
        confirmLabel={t.send.confirm}
        cancelLabel={t.send.cancel}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false);
          gen.send(form.patch).catch(markPlanError);
        }}
      />

      <Snackbar
        open={Boolean(offer && pageError)}
        autoHideDuration={8000}
        onClose={(_, reason) => { if (reason !== 'clickaway') gen.clearError(); }}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="error" variant="filled" onClose={gen.clearError} action={pageError ? errorAction(pageError) : undefined}>
          {pageError?.message}
        </Alert>
      </Snackbar>

      <Snackbar
        open={Boolean(notice)}
        autoHideDuration={3500}
        onClose={() => setNotice(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="success" variant="filled" onClose={() => setNotice(null)}>{notice}</Alert>
      </Snackbar>
    </Box>
  );
}
