import { useEffect, useState, type FormEvent } from 'react';
import {
  Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, IconButton,
  InputAdornment, Link, Stack, TextField, Tooltip, Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { Check, CircleCheck, Eye, EyeOff, ExternalLink, Info, Link2, Lock, X } from 'lucide-react';
import { AppIcon } from '@/components/AppIcon';
import type { AffiliateCredentialItem, UpsertAffiliateCredentialRequest } from '@/types/api.types';
import { validateAffiliateField, type AffiliateProviderSpec } from '../affiliateProviders';
import { affiliateErrorMessage, settingsStrings } from '../strings';
import { MarketplaceLogo } from './MarketplaceLogo';

const t = settingsStrings.affiliate;

interface Props {
  open: boolean;
  spec: AffiliateProviderSpec;
  /** Credencial já salva (edição) ou `undefined` (criação). */
  item?: AffiliateCredentialItem;
  /** Resolve em 2xx; rejeita com o erro do `apiClient`. O diálogo só fecha via `onClose`. */
  onSubmit: (body: UpsertAffiliateCredentialRequest) => Promise<void>;
  onClose: () => void;
}

/**
 * Formulário de credencial de um marketplace. Não é otimista: fica aberto até a API
 * responder 2xx e, em erro, mantém o que o usuário digitou.
 *
 * Sem `usePersistedState` de propósito: o diálogo tem o Secret, que nunca vai para o storage,
 * e o identificador é curto e volta da API na edição.
 */
export function AffiliateCredentialDialog({ open, spec, item, onSubmit, onClose }: Props) {
  const [publicValue, setPublicValue] = useState('');
  const [secretValue, setSecretValue] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  // Campo que a API recusou (422 com `field`) — marcado até o operador editar.
  const [apiField, setApiField] = useState<string | null>(null);

  // Reabre limpo; o identificador público vem em claro para edição.
  useEffect(() => {
    if (!open) return;
    setPublicValue(item?.publicIdentifier ?? '');
    setSecretValue('');
    setShowSecret(false);
    setSubmitted(false);
    setApiError(null);
    setApiField(null);
  }, [open, item?.publicIdentifier]);

  const secretField = spec.secretField;
  const secretRequired = Boolean(secretField) && !item?.hasSecret;
  const publicError = validateAffiliateField(spec.publicField, publicValue, true);
  const secretError = secretField ? validateAffiliateField(secretField, secretValue, secretRequired) : null;
  const publicValid = !publicError && apiField !== 'publicIdentifier';
  const steps = t.guideSteps[spec.provider];
  const help = t.guideHelp[spec.provider];
  const brand = spec.brandColor;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (publicError || secretError || saving) return;

    const body: UpsertAffiliateCredentialRequest = { publicIdentifier: publicValue.trim() };
    const secret = secretValue.trim();
    if (secretField && secret) body.secret = secret;

    setSaving(true);
    setApiError(null);
    setApiField(null);
    try {
      await onSubmit(body);
    } catch (err) {
      setApiError(affiliateErrorMessage(err));
      const field = (err as { field?: unknown } | null)?.field;
      setApiField(typeof field === 'string' ? field : null);
    } finally {
      setSaving(false);
    }
  };

  const title = item ? t.dialogEditTitle(spec.name) : t.dialogCreateTitle(spec.name);

  return (
    <Dialog
      open={open}
      onClose={saving ? undefined : onClose}
      maxWidth="sm"
      fullWidth
      aria-labelledby="affiliate-credential-dialog-title"
      aria-describedby="affiliate-credential-dialog-subtitle"
      PaperProps={{
        sx: {
          // Mesma linguagem do card: faixa da marca no topo e fundo translúcido que some no escuro
          borderTop: `3px solid ${brand}`,
          backgroundImage: `linear-gradient(180deg, ${alpha(brand, 0.08)} 0%, transparent 140px)`,
        },
      }}
    >
      <Box component="form" onSubmit={handleSubmit} noValidate>
        <Stack direction="row" spacing={1.75} alignItems="flex-start" sx={{ px: 3, pt: 2.75, pb: 1.5 }}>
          <MarketplaceLogo src={spec.logo} size={48} />
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography id="affiliate-credential-dialog-title" variant="h6" component="h2" sx={{ fontWeight: 700, lineHeight: 1.3 }}>
              {title}
            </Typography>
            <Typography id="affiliate-credential-dialog-subtitle" variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
              {t.dialogSubtitle[spec.provider] ?? spec.description}
            </Typography>
          </Box>
          <Tooltip title={t.closeDialog}>
            <span>
              <IconButton onClick={onClose} size="small" aria-label={t.closeDialog} disabled={saving} sx={{ mt: -0.5, mr: -1 }}>
                <AppIcon icon={X} size="md" />
              </IconButton>
            </span>
          </Tooltip>
        </Stack>

        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2.25, pt: '8px !important' }}>
          {apiError && <Alert severity="error">{apiError}</Alert>}

          {steps && spec.setup && (
            <Box
              component="section"
              aria-labelledby="affiliate-credential-guide-title"
              sx={{
                p: 2, borderRadius: 2, border: 1, borderColor: 'divider',
                borderLeft: `3px solid ${brand}`, bgcolor: alpha(brand, 0.06),
              }}
            >
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
                <AppIcon icon={Info} size="sm" style={{ color: brand }} />
                <Typography id="affiliate-credential-guide-title" variant="subtitle2" component="h3" sx={{ fontWeight: 700 }}>
                  {t.guideTitle(spec.name)}
                </Typography>
              </Stack>
              <Box component="ol" sx={{ m: 0, pl: 0, listStyle: 'none', display: 'grid', gap: 0.75 }}>
                {steps.map((step, i) => (
                  <Box component="li" key={step} sx={{ display: 'flex', gap: 1.25, alignItems: 'flex-start' }}>
                    <Box
                      aria-hidden
                      sx={{
                        flexShrink: 0, width: 22, height: 22, borderRadius: '50%', display: 'grid', placeItems: 'center',
                        fontSize: 12, fontWeight: 700, bgcolor: alpha(brand, 0.18), color: 'text.primary',
                      }}
                    >
                      {i + 1}
                    </Box>
                    <Typography variant="body2" color="text.secondary" sx={{ pt: '1px' }}>{step}</Typography>
                  </Box>
                ))}
              </Box>
              <Stack direction="row" flexWrap="wrap" alignItems="center" columnGap={2} rowGap={1} sx={{ mt: 1.75 }}>
                <Tooltip title={t.guideOpenTooltip} describeChild>
                  <Button
                    href={spec.setup.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    size="small"
                    variant="outlined"
                    color="inherit"
                    endIcon={<AppIcon icon={ExternalLink} size="sm" />}
                    sx={{ borderColor: 'divider' }}
                  >
                    {t.guideOpen(spec.setup.program)}
                  </Button>
                </Tooltip>
                {help && spec.setup.helpUrl && (
                  <Typography variant="caption" color="text.secondary">
                    {help}{' '}
                    <Link href={spec.setup.helpUrl} target="_blank" rel="noopener noreferrer" underline="hover">
                      {t.guideHelpLink}
                    </Link>
                  </Typography>
                )}
              </Stack>
            </Box>
          )}

          <TextField
            label={spec.publicField.label}
            value={publicValue}
            onChange={(e) => { setPublicValue(e.target.value); setApiField(null); }}
            placeholder={spec.publicField.placeholder}
            required
            fullWidth
            autoFocus
            autoComplete="off"
            spellCheck={false}
            error={(submitted && Boolean(publicError)) || apiField === 'publicIdentifier'}
            helperText={(submitted && publicError) || spec.publicField.helper}
            InputProps={publicValid ? {
              endAdornment: (
                <InputAdornment position="end">
                  <Tooltip title={t.fieldValid}>
                    <Box component="span" sx={{ display: 'inline-flex', color: 'success.main' }}>
                      <AppIcon icon={CircleCheck} size="md" label={t.fieldValid} />
                    </Box>
                  </Tooltip>
                </InputAdornment>
              ),
            } : undefined}
          />

          {spec.linkPreview && publicValid && (
            <Box
              aria-live="polite"
              sx={{ display: 'flex', gap: 1, alignItems: 'center', px: 1.5, py: 1, borderRadius: 1.5, bgcolor: 'action.hover', mt: -1 }}
            >
              <AppIcon icon={Link2} size="sm" style={{ opacity: 0.7 }} />
              <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>{t.linkPreviewLabel}</Typography>
              <Typography variant="caption" sx={{ fontFamily: 'monospace', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {spec.linkPreview(publicValue.trim())}
              </Typography>
            </Box>
          )}

          {secretField && (
            <TextField
              label={secretField.label}
              type={showSecret ? 'text' : 'password'}
              value={secretValue}
              onChange={(e) => { setSecretValue(e.target.value); setApiField(null); }}
              placeholder={secretRequired ? undefined : t.secretKeepPlaceholder}
              required={secretRequired}
              fullWidth
              autoComplete="new-password"
              spellCheck={false}
              error={(submitted && Boolean(secretError)) || apiField === 'secret'}
              helperText={(submitted && secretError) || secretField.helper}
              InputLabelProps={secretRequired ? undefined : { shrink: true }}
              InputProps={{
                endAdornment: (
                  <InputAdornment position="end">
                    <Tooltip title={showSecret ? t.hideSecret : t.showSecret}>
                      <IconButton
                        onClick={() => setShowSecret((v) => !v)}
                        edge="end"
                        size="small"
                        aria-label={showSecret ? t.hideSecret : t.showSecret}
                      >
                        <AppIcon icon={showSecret ? EyeOff : Eye} size="md" />
                      </IconButton>
                    </Tooltip>
                  </InputAdornment>
                ),
              }}
            />
          )}

          {t.dialogNote[spec.provider] && (
            <Stack direction="row" spacing={1} alignItems="flex-start">
              <AppIcon icon={Lock} size="sm" style={{ marginTop: 2, opacity: 0.7 }} />
              <Typography variant="caption" color="text.secondary">{t.dialogNote[spec.provider]}</Typography>
            </Stack>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5, pt: 1, gap: 1 }}>
          <Button onClick={onClose} color="inherit" disabled={saving}>{t.cancel}</Button>
          <Button
            type="submit"
            variant="contained"
            disableElevation
            disabled={saving}
            startIcon={saving ? undefined : <AppIcon icon={Check} size="sm" />}
            sx={{ minWidth: 112 }}
          >
            {saving ? <CircularProgress size={20} color="inherit" aria-label={t.save} /> : t.save}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}
