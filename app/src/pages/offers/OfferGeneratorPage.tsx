import { useRef, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Alert, Box, Button, Skeleton, Snackbar, Stack } from '@mui/material';
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
import { OfferSendPanel } from '@/features/offers/components/OfferSendPanel';
import { SendQueuePanel } from '@/features/sendQueue/components/SendQueuePanel';
import { isPendingSchedule } from '@/features/offers/utils/offerSchedule';
import { offerStrings } from '@/features/offers/strings';
import { DEFAULT_INTERVAL } from '@/features/offers/utils/offerConfig';
import type { OfferErrorView } from '@/features/offers/utils/offerErrors';
import { usePersistedState } from '@/hooks/usePersistedState';

const t = offerStrings;
const CREDENTIALS_PATH = '/settings/affiliate-credentials';
const ignore = () => undefined;

export function OfferGeneratorPage() {
  const cfg = useOfferConfig();
  const gen = useOfferGenerator();
  const { offer } = gen;
  const form = useOfferDraft(offer);
  const [wizardOpen, setWizardOpen] = usePersistedState('offers.wizardOpen', false);
  // "+ Novo" com oferta aberta: o card de geração volta; a oferta atual só sai quando outra é gerada
  const [composing, setComposing] = usePersistedState('offers.composing', false);
  const [editing, setEditing] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [mentionUnavailable, setMentionUnavailable] = useState(false);
  // Quem rola é o <main> do layout, não a janela: sobe pelo elemento
  const topRef = useRef<HTMLDivElement>(null);

  const showWizard = !cfg.loading && !cfg.failed && (!cfg.configured || wizardOpen);
  const groupCount = cfg.groups.length;
  const sessionOffline = cfg.offlineSessions.length > 0 || cfg.missingSessions > 0;
  const limitReached = gen.usage?.limit != null && gen.usage.used >= gen.usage.limit;
  const offerSending = offer?.status === 'SENDING' || offer?.status === 'PAUSED';
  const linkFieldError = gen.error?.isLinkField ? gen.error.message : null;
  const pageError = gen.error && !gen.error.isLinkField ? gen.error : null;
  const intervalMin = cfg.config?.intervalMinSeconds ?? DEFAULT_INTERVAL.min;
  const intervalMax = cfg.config?.intervalMaxSeconds ?? DEFAULT_INTERVAL.max;
  const showForm = !offer || composing;
  const offerBusy = gen.saving || gen.regenerating || gen.sending || gen.imageProgress != null;
  // Lido na chegada do "Abrir oferta" (o clique já foi bloqueado se houvesse edição pendente)
  const busyRef = useRef(false);
  busyRef.current = form.dirty || offerBusy || editing;
  const scheduledWhen = offer && isPendingSchedule(offer.scheduledAt) ? t.send.formatWhen(offer.scheduledAt!) : null;

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
    <Box ref={topRef} sx={{ scrollMarginTop: 80 }}>
      {header}

      {showWizard ? (
        <OfferConfigWizard
          config={cfg.config}
          groups={cfg.groups}
          groupLimit={cfg.groupLimit}
          sessionLimit={cfg.sessionLimit}
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
          <OfferConfigSummary sessions={cfg.selectedSessions} missing={cfg.missingSessions} groups={cfg.groups} dispatchOrder={cfg.config?.dispatchOrder} onEdit={() => setWizardOpen(true)} />

          {showForm ? (
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
                    setComposing(false);
                  }}
                  onChange={() => { if (gen.error?.isLinkField) gen.clearError(); }}
                  onCancel={offer ? () => { gen.clearError(); setComposing(false); } : undefined}
                />
                {limitReached && gen.usage?.limit != null && <Alert severity="warning">{t.planLimit(gen.usage.limit)}</Alert>}
                {!offer && pageError && (
                  <Alert severity="error" onClose={gen.clearError} action={errorAction(pageError)}>{pageError.message}</Alert>
                )}
              </Stack>

              <EmptyState
                icon={<ChatOutlinedIcon />}
                title={t.preview.emptyTitle}
                description={t.preview.emptyDescription}
                sx={{ py: 8, position: { md: 'sticky' }, top: { md: 88 } }}
              />
            </Box>
          ) : offer && (
            // Prévia e envio lado a lado; em tela estreita, um abaixo do outro
            <Box
              sx={{
                display: 'grid',
                gap: 3,
                gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' },
                alignItems: 'start',
              }}
            >
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
                sending={gen.sending}
                imageProgress={gen.imageProgress}
                onSave={async () => {
                  await gen.update(form.patch);
                  setNotice(t.editor.saved);
                }}
                onDiscard={form.discard}
                onRegenerate={(audience) => { gen.regenerate(audience).catch(ignore); }}
                onReplaceImage={(file) => { gen.replaceImage(file).catch(ignore); }}
                onEditingChange={setEditing}
                onNew={() => { gen.clearError(); setComposing(true); }}
                newLockedReason={offerSending ? t.page.newOfferLocked : null}
              />

              <Box sx={{ minWidth: 0, position: { md: 'sticky' }, top: { md: 88 } }}>
                {offer.status === 'DRAFT' ? (
                  <OfferSendPanel
                    key={offer.id}
                    offer={offer}
                    groups={cfg.groups}
                    busy={offerBusy}
                    sending={gen.sending}
                    mentionSaving={gen.mentionSaving}
                    mentionUnavailable={mentionUnavailable}
                    sendBlocked={groupCount === 0 || sessionOffline}
                    textTooLong={form.textTooLong}
                    editing={editing}
                    onMentionAll={(value) => { gen.setMentionAll(value).catch(markPlanError); }}
                    onTyping={(patch) => { void gen.setTyping(patch); }}
                    onSchedule={async (scheduledAt) => { await gen.update({ scheduledAt }); }}
                    onSend={() => setConfirmOpen(true)}
                  />
                ) : (
                  <OfferDispatchProgress
                    status={offer.status}
                    dispatches={offer.dispatches ?? []}
                    scheduledAt={offer.scheduledAt}
                    updatedAt={offer.updatedAt}
                    destinations={cfg.groups}
                    sessions={cfg.selectedSessions}
                    onControl={(action) => { gen.control(action).catch(ignore); }}
                    controlling={gen.controlling}
                  />
                )}
              </Box>
            </Box>
          )}
        </>
      )}

      {/* Fila do servidor: visível em qualquer aba (também com o assistente aberto); abrir troca a
          oferta da tela e sobe até ela (bloqueado com edição pendente ou assistente aberto) */}
      <Box sx={{ mt: 3 }}>
        <SendQueuePanel
          currentOfferId={offer?.id ?? null}
          onOpenOffer={showWizard || form.dirty || offerBusy || editing ? undefined : (id) => {
            // Começou a editar enquanto carregava: a resposta é descartada (não apaga o que digitou)
            gen.open(id, () => !busyRef.current).then((applied) => {
              if (!applied) return;
              setComposing(false);
              topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }).catch(ignore);
          }}
        />
      </Box>

      <ConfirmDialog
        open={confirmOpen}
        title={scheduledWhen ? t.send.confirmScheduledTitle(groupCount) : t.send.confirmTitle(groupCount)}
        description={t.send.confirmDescription(groupCount, intervalMin, intervalMax, Boolean(offer?.mentionAll), form.missingLink, form.dirty, scheduledWhen)}
        confirmLabel={scheduledWhen ? t.send.confirmScheduled : t.send.confirm}
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
