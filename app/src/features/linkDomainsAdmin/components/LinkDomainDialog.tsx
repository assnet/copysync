import { useState } from 'react';
import {
  Alert, Autocomplete, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  Stack, TextField,
} from '@mui/material';
import { usePersistedState } from '@/hooks/usePersistedState';
import { linkDomainErrorMessage } from '../errors';
import {
  isValidHostname, isValidLandingUrl, mergeReservedNames, normalizeHostname,
} from '../rules';
import { linkDomainsAdminStrings } from '../strings';
import type { CreateLinkDomainRequest, LinkDomain, UpdateLinkDomainRequest } from '../types';

const t = linkDomainsAdminStrings.form;

interface Draft {
  hostname: string;
  landingUrl: string;
  reservedNames: string[];
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
    }),
  );
  const [reservedInput, setReservedInput] = useState('');
  const [reservedError, setReservedError] = useState<string | null>(null);
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

  /** Converte o texto digitado em chips; devolve a lista nova ou `null` se algo for inválido. */
  const addReserved = (raw: string): string[] | null => {
    const r = mergeReservedNames(draft.reservedNames, raw);
    if (!r.ok) {
      setReservedError('invalid' in r ? t.reservedInvalid(r.invalid) : t.reservedTooMany);
      return null;
    }
    setReservedError(null);
    setDraft((d) => ({ ...d, reservedNames: r.names }));
    setReservedInput('');
    return r.names;
  };

  const submit = async () => {
    setTouched({ hostname: true, landingUrl: true });
    if (hostnameInvalid || landingInvalid) return;
    const reservedNames = reservedInput.trim() ? addReserved(reservedInput) : draft.reservedNames;
    if (!reservedNames) return;
    const landing = draft.landingUrl.trim();
    setSaving(true);
    setSubmitError(null);
    try {
      if (domain) {
        await onUpdate(domain.id, { landingUrl: landing || null, reservedNames });
      } else {
        await onCreate({
          hostname: normalizeHostname(draft.hostname),
          ...(landing ? { landingUrl: landing } : {}),
          reservedNames,
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
            <Autocomplete<string, true, false, true>
              multiple
              freeSolo
              options={[]}
              value={draft.reservedNames}
              inputValue={reservedInput}
              onInputChange={(_, v, reason) => {
                if (reason === 'reset') return;
                if (/[\s,;]$/.test(v)) addReserved(v);
                else setReservedInput(v);
              }}
              onChange={(_, value, reason) => {
                if (reason === 'createOption') {
                  addReserved(String(value[value.length - 1] ?? ''));
                  return;
                }
                setReservedError(null);
                setDraft((d) => ({ ...d, reservedNames: value.map(String) }));
              }}
              renderTags={(value, getTagProps) =>
                value.map((name, index) => {
                  const { key, ...tagProps } = getTagProps({ index });
                  return <Chip key={key} label={name} size="small" {...tagProps} />;
                })
              }
              renderInput={(params) => (
                <TextField
                  {...params}
                  label={t.reservedNames}
                  placeholder={draft.reservedNames.length ? undefined : t.reservedPlaceholder}
                  error={Boolean(reservedError)}
                  helperText={reservedError ?? t.reservedHelp}
                  onBlur={() => {
                    if (reservedInput.trim()) addReserved(reservedInput);
                  }}
                />
              )}
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
