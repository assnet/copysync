import { useEffect, useState, type FormEvent } from 'react';
import {
  Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  IconButton, InputAdornment, TextField, Tooltip,
} from '@mui/material';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import type { AffiliateCredentialItem, UpsertAffiliateCredentialRequest } from '@/types/api.types';
import { validateAffiliateField, type AffiliateProviderSpec } from '../affiliateProviders';
import { affiliateErrorMessage, settingsStrings } from '../strings';

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
      maxWidth="xs"
      fullWidth
      aria-labelledby="affiliate-credential-dialog-title"
    >
      <Box component="form" onSubmit={handleSubmit} noValidate>
        <DialogTitle id="affiliate-credential-dialog-title" sx={{ fontWeight: 700 }}>{title}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '8px !important' }}>
          {apiError && <Alert severity="error">{apiError}</Alert>}

          <TextField
            label={spec.publicField.label}
            value={publicValue}
            onChange={(e) => { setPublicValue(e.target.value); setApiField(null); }}
            placeholder={spec.publicField.placeholder}
            required
            fullWidth
            autoFocus
            autoComplete="off"
            error={(submitted && Boolean(publicError)) || apiField === 'publicIdentifier'}
            helperText={(submitted && publicError) || spec.publicField.helper}
          />

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
                        {showSecret ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
                      </IconButton>
                    </Tooltip>
                  </InputAdornment>
                ),
              }}
            />
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={onClose} color="inherit" disabled={saving}>{t.cancel}</Button>
          <Button type="submit" variant="contained" disableElevation disabled={saving} sx={{ minWidth: 96 }}>
            {saving ? <CircularProgress size={20} color="inherit" aria-label={t.save} /> : t.save}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}
