import { useRef, useState } from 'react';
import {
  Alert, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField,
} from '@mui/material';
import { usePersistedState } from '@/hooks/usePersistedState';
import { linkDomainErrorMessage } from '../errors';
import { isValidHostname, isValidLandingUrl, normalizeHostname } from '../rules';
import { linkDomainsAdminStrings } from '../strings';
import { NamesField } from './NamesField';
import type { CreateLinkDomainRequest, LinkDomain, UpdateLinkDomainRequest } from '../types';

const t = linkDomainsAdminStrings.form;

interface Draft {
  hostname: string;
  landingUrl: string;
  reservedNames: string[];
  /** Ausente em rascunho salvo antes do campo existir. */
  premiumNames?: string[];
}

interface Props {
  /** Ausente = cadastro novo. */
  domain?: LinkDomain;
  onCreate: (body: CreateLinkDomainRequest) => Promise<unknown>;
  onUpdate: (id: string, body: UpdateLinkDomainRequest) => Promise<unknown>;
  onClose: () => void;
}

/**
 * Formulário de domínio. Montado só quando aberto; o rascunho sobrevive a reload
 * (`usePersistedState`, escopo `tab`, uma chave por domínio) e é limpo ao salvar ou cancelar.
 */
export function LinkDomainDialog({ domain, onCreate, onUpdate, onClose }: Props) {
  const isEdit = Boolean(domain);
  const [draft, setDraft, clearDraft] = usePersistedState<Draft>(
    `linkDomainsAdmin.form.${domain?.id ?? 'new'}`,
    () => ({
      hostname: domain?.hostname ?? '',
      landingUrl: domain?.landingUrl ?? '',
      reservedNames: domain?.reservedNames ?? [],
      premiumNames: domain?.premiumNames ?? [],
    }),
  );
  const flushReserved = useRef<(() => string[] | null) | null>(null);
  const flushPremium = useRef<(() => string[] | null) | null>(null);
  const [touched, setTouched] = useState({ hostname: false, landingUrl: false });
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const hostnameInvalid = !isEdit && !isValidHostname(draft.hostname);
  const landingInvalid = !isValidLandingUrl(draft.landingUrl);
  const showHostnameError = touched.hostname && hostnameInvalid;
  const showLandingError = touched.landingUrl && landingInvalid;

  const close = () => {
    clearDraft();
    onClose();
  };

  const submit = async () => {
    setTouched({ hostname: true, landingUrl: true });
    if (hostnameInvalid || landingInvalid) return;
    const reservedNames = flushReserved.current?.() ?? null;
    const premiumNames = flushPremium.current?.() ?? null;
    if (!reservedNames || !premiumNames) return;
    const landing = draft.landingUrl.trim();
    setSaving(true);
    setSubmitError(null);
    try {
      if (domain) {
        await onUpdate(domain.id, { landingUrl: landing || null, reservedNames, premiumNames });
      } else {
        await onCreate({
          hostname: normalizeHostname(draft.hostname),
          ...(landing ? { landingUrl: landing } : {}),
          reservedNames,
          premiumNames,
        });
      }
      clearDraft();
      onClose();
    } catch (err) {
      setSubmitError(linkDomainErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onClose={saving ? undefined : close} maxWidth="sm" fullWidth aria-labelledby="link-domain-dialog-title">
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <DialogTitle id="link-domain-dialog-title" sx={{ fontWeight: 700 }}>
          {domain ? t.editTitle(domain.hostname) : t.createTitle}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2.5} sx={{ pt: 1 }}>
            {submitError && <Alert severity="error" role="alert">{submitError}</Alert>}
            <TextField
              label={t.hostname}
              value={draft.hostname}
              placeholder={t.hostnamePlaceholder}
              disabled={isEdit}
              required={!isEdit}
              autoFocus={!isEdit}
              fullWidth
              autoComplete="off"
              inputProps={{ spellCheck: false, autoCapitalize: 'none' }}
              onChange={(e) => setDraft((d) => ({ ...d, hostname: e.target.value }))}
              onBlur={() => {
                setTouched((v) => ({ ...v, hostname: true }));
                if (!isEdit && isValidHostname(draft.hostname)) {
                  setDraft((d) => ({ ...d, hostname: normalizeHostname(d.hostname) }));
                }
              }}
              error={showHostnameError}
              helperText={isEdit ? t.hostnameLocked : showHostnameError ? t.hostnameInvalid : t.hostnameHelp}
            />
            <TextField
              label={t.landingUrl}
              value={draft.landingUrl}
              placeholder={t.landingPlaceholder}
              type="url"
              fullWidth
              autoFocus={isEdit}
              autoComplete="off"
              inputProps={{ spellCheck: false, autoCapitalize: 'none' }}
              onChange={(e) => setDraft((d) => ({ ...d, landingUrl: e.target.value }))}
              onBlur={() => setTouched((v) => ({ ...v, landingUrl: true }))}
              error={showLandingError}
              helperText={showLandingError ? t.landingInvalid : t.landingHelp}
            />
            <NamesField
              label={t.reservedNames}
              helper={t.reservedHelp}
              tooManyMessage={t.reservedTooMany}
              value={draft.reservedNames}
              onChange={(reservedNames) => setDraft((d) => ({ ...d, reservedNames }))}
              flushRef={flushReserved}
            />
            <NamesField
              label={t.premiumNames}
              helper={t.premiumHelp}
              tooManyMessage={t.premiumTooMany}
              value={draft.premiumNames ?? []}
              onChange={(premiumNames) => setDraft((d) => ({ ...d, premiumNames }))}
              flushRef={flushPremium}
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={close} color="inherit" disabled={saving}>{t.cancel}</Button>
          <Button
            type="submit"
            variant="contained"
            disableElevation
            disabled={saving}
            startIcon={saving ? <CircularProgress size={16} color="inherit" /> : undefined}
          >
            {isEdit ? t.save : t.create}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
