import { useState } from 'react';
import {
  Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Slider, Stack, TextField,
  Typography,
} from '@mui/material';
import { ToggleOption } from '@/components';
import { usePersistedState } from '@/hooks/usePersistedState';
import { redirectLinkErrorMessage } from '../errors';
import { isHttpsUrl, isValidSlug, normalizeSlug, NOTE_MAX, publicRedirectUrl, SLUG_MAX, URL_MAX } from '../rules';
import { redirectLinksStrings } from '../strings';
import type { CreateRedirectLinkRequest, RedirectLink, UpdateRedirectLinkRequest } from '../types';

const t = redirectLinksStrings.form;

interface Draft {
  slug: string;
  urlA: string;
  urlB: string;
  percentA: number;
  isActive: boolean;
  note: string;
}

interface Props {
  /** Ausente = link novo. */
  link?: RedirectLink;
  onCreate: (body: CreateRedirectLinkRequest) => Promise<unknown>;
  onUpdate: (id: string, body: UpdateRedirectLinkRequest) => Promise<unknown>;
  onClose: () => void;
}

/**
 * Formulário do link. Montado só quando aberto; o rascunho sobrevive a reload
 * (`usePersistedState`, escopo `tab`, uma chave por link) e é limpo ao salvar ou cancelar.
 */
export function RedirectLinkDialog({ link, onCreate, onUpdate, onClose }: Props) {
  const [draft, setDraft, clearDraft] = usePersistedState<Draft>(
    `redirectLinks.form.${link?.id ?? 'new'}`,
    () => ({
      slug: link?.slug ?? '',
      urlA: link?.urlA ?? '',
      urlB: link?.urlB ?? '',
      percentA: link?.urlB ? link.percentA : 50,
      isActive: link?.isActive ?? true,
      note: link?.note ?? '',
    }),
  );
  const [touched, setTouched] = useState({ slug: false, urlA: false, urlB: false });
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const hasB = draft.urlB.trim() !== '';
  const slugInvalid = !isValidSlug(draft.slug);
  const urlAInvalid = !isHttpsUrl(draft.urlA);
  const urlBInvalid = hasB && !isHttpsUrl(draft.urlB);
  const slugChanged = Boolean(link) && normalizeSlug(draft.slug) !== link?.slug;
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  const close = () => {
    clearDraft();
    onClose();
  };

  const submit = async () => {
    setTouched({ slug: true, urlA: true, urlB: true });
    if (slugInvalid || urlAInvalid || urlBInvalid) return;
    const body = {
      slug: normalizeSlug(draft.slug),
      urlA: draft.urlA.trim(),
      urlB: hasB ? draft.urlB.trim() : null,
      ...(hasB ? { percentA: draft.percentA } : {}),
      isActive: draft.isActive,
      note: draft.note.trim() || null,
    };
    setSaving(true);
    setSubmitError(null);
    try {
      if (link) await onUpdate(link.id, body);
      else await onCreate(body);
      clearDraft();
      onClose();
    } catch (err) {
      setSubmitError(redirectLinkErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const urlField = (key: 'urlA' | 'urlB', label: string, help: string, invalid: boolean) => (
    <TextField
      label={label}
      value={draft[key]}
      placeholder="https://"
      type="url"
      required={key === 'urlA'}
      fullWidth
      autoComplete="off"
      inputProps={{ spellCheck: false, autoCapitalize: 'none', maxLength: URL_MAX }}
      onChange={(e) => set(key, e.target.value)}
      onBlur={() => setTouched((v) => ({ ...v, [key]: true }))}
      error={touched[key] && invalid}
      helperText={touched[key] && invalid ? t.urlInvalid : help}
    />
  );

  return (
    <Dialog open onClose={saving ? undefined : close} maxWidth="sm" fullWidth aria-labelledby="redirect-link-dialog-title">
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <DialogTitle id="redirect-link-dialog-title" sx={{ fontWeight: 700 }}>
          {link ? t.editTitle(link.slug) : t.createTitle}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2.5} sx={{ pt: 1 }}>
            {submitError && <Alert severity="error" role="alert">{submitError}</Alert>}
            <TextField
              label={t.slug}
              value={draft.slug}
              placeholder="suporte"
              required
              autoFocus
              fullWidth
              autoComplete="off"
              inputProps={{ spellCheck: false, autoCapitalize: 'none', maxLength: SLUG_MAX }}
              onChange={(e) => set('slug', e.target.value.toLowerCase())}
              onBlur={() => {
                setTouched((v) => ({ ...v, slug: true }));
                set('slug', normalizeSlug(draft.slug));
              }}
              error={touched.slug && slugInvalid}
              helperText={
                touched.slug && slugInvalid
                  ? t.slugInvalid
                  : isValidSlug(draft.slug) ? t.slugPreview(publicRedirectUrl(normalizeSlug(draft.slug))) : t.slugHelp
              }
            />
            {slugChanged && <Alert severity="warning">{t.slugChangeWarning}</Alert>}
            {urlField('urlA', t.urlA, t.urlHelp, urlAInvalid)}
            {urlField('urlB', t.urlB, t.urlBHelp, urlBInvalid)}
            {hasB && (
              <Box>
                <Typography variant="subtitle2" id="redirect-split-label">{t.split}</Typography>
                <Stack direction="row" spacing={2} alignItems="center" sx={{ px: 1 }}>
                  <Slider
                    value={draft.percentA}
                    min={0}
                    max={100}
                    step={5}
                    valueLabelDisplay="auto"
                    valueLabelFormat={(v) => `${v}%`}
                    aria-labelledby="redirect-split-label"
                    getAriaValueText={(v) => redirectLinksStrings.splitLabel(v)}
                    onChange={(_, v) => set('percentA', v as number)}
                  />
                  <Typography variant="body2" sx={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', minWidth: 112 }}>
                    {redirectLinksStrings.splitLabel(draft.percentA)}
                  </Typography>
                </Stack>
                <Typography variant="caption" color="text.secondary">{t.splitHelp}</Typography>
              </Box>
            )}
            <TextField
              label={t.note}
              value={draft.note}
              fullWidth
              multiline
              minRows={1}
              maxRows={4}
              inputProps={{ maxLength: NOTE_MAX }}
              onChange={(e) => set('note', e.target.value)}
              helperText={t.noteHelp}
            />
            <ToggleOption checked={draft.isActive} onChange={(v) => set('isActive', v)} title={t.active} description={t.activeHelp} />
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
            {link ? t.save : t.create}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
