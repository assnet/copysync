import { useEffect, useState, type FormEvent } from 'react';
import {
  Alert, Box, Button, CircularProgress, IconButton, InputAdornment, Link, MenuItem, Stack, TextField,
  Tooltip, Typography,
} from '@mui/material';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined';
import VisibilityOffOutlinedIcon from '@mui/icons-material/VisibilityOffOutlined';
import { ConfirmDialog, SectionCard } from '@/components';
import type {
  AiProviderKind, AiProviderTestResult, TenantAiCredential, UpsertTenantAiCredentialRequest,
} from '@/types/api.types';
import { AI_PROVIDERS, aiProviderSpec, isSuggestedModel } from '../aiProviders';
import { aiErrorCodeMessage, aiErrorMessage, aiStrings } from '../strings';

const t = aiStrings.tenant;

interface Props {
  credential: TenantAiCredential | null;
  testing: boolean;
  testResult: AiProviderTestResult | null;
  onSave: (body: UpsertTenantAiCredentialRequest) => Promise<void>;
  onTest: () => void;
  onRemove: () => Promise<void>;
}

/** Chave própria do cliente: explica onde conseguir, salva cifrada no servidor e testa. */
export function TenantAiKeyForm({ credential, testing, testResult, onSave, onTest, onRemove }: Props) {
  const [kind, setKind] = useState<AiProviderKind>('ANTHROPIC');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const hasKey = Boolean(credential && (credential.hasKey ?? Boolean(credential.masked)));

  useEffect(() => {
    const k = credential?.kind ?? 'ANTHROPIC';
    setKind(k);
    setModel(credential?.model ?? aiProviderSpec(k).defaultModel);
    setApiKey('');
  }, [credential]);

  const dirty = apiKey.trim() !== '' || kind !== credential?.kind || model.trim() !== credential?.model;
  const errors = {
    model: !model.trim() ? t.required : null,
    apiKey: !hasKey && !apiKey.trim() ? t.required : null,
  };
  const show = (e: string | null) => (submitted ? e : null);

  const handleKind = (k: AiProviderKind) => {
    setKind(k);
    if (isSuggestedModel(model)) setModel(aiProviderSpec(k).defaultModel);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (errors.model || errors.apiKey || saving) return;
    const body: UpsertTenantAiCredentialRequest = { kind, model: model.trim() };
    if (apiKey.trim()) body.apiKey = apiKey.trim();
    setSaving(true);
    setError(null);
    try {
      await onSave(body);
      setSubmitted(false);
    } catch (err) {
      setError(aiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    setConfirmRemove(false);
    setError(null);
    try {
      await onRemove();
    } catch (err) {
      setError(aiErrorMessage(err));
    }
  };

  const testDisabled = !hasKey || dirty || testing;

  return (
    <SectionCard title={t.ownKeyTitle}>
      <Typography variant="body2" color="text.secondary" mb={2}>{t.ownKeyIntro}</Typography>

      <Box sx={{ p: 2, mb: 3, borderRadius: 2, bgcolor: 'action.hover' }}>
        <Typography variant="subtitle2" mb={1}>{t.howToTitle}</Typography>
        <Box component="ol" sx={{ m: 0, pl: 2.5, '& li': { mb: 0.5 } }}>
          {t.howToSteps.map((step) => (
            <Typography component="li" variant="body2" key={step}>{step}</Typography>
          ))}
        </Box>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={{ xs: 1, sm: 3 }} mt={1.5}>
          {AI_PROVIDERS.map((p) => (
            <Link
              key={p.kind}
              href={p.consoleUrl}
              target="_blank"
              rel="noopener noreferrer"
              variant="body2"
              sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}
            >
              {p.kind === 'ANTHROPIC' ? t.anthropicLink : t.openAiLink}
              <OpenInNewIcon sx={{ fontSize: 14 }} aria-hidden />
            </Link>
          ))}
        </Stack>
      </Box>

      <form onSubmit={handleSubmit} noValidate>
        <Stack spacing={2.5}>
          {error && <Alert severity="error">{error}</Alert>}
          {testResult && !dirty && (
            <Alert severity={testResult.ok ? 'success' : 'error'} role="status">
              {testResult.ok ? t.testOk : aiErrorCodeMessage(testResult.errorCode)}
            </Alert>
          )}
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              select
              label={t.provider}
              value={kind}
              onChange={(e) => handleKind(e.target.value as AiProviderKind)}
              sx={{ minWidth: { sm: 220 } }}
            >
              {AI_PROVIDERS.map((p) => (
                <MenuItem key={p.kind} value={p.kind}>{aiStrings.providers[p.kind]}</MenuItem>
              ))}
            </TextField>
            <TextField
              label={t.model}
              value={model}
              onChange={(e) => setModel(e.target.value)}
              error={Boolean(show(errors.model))}
              helperText={show(errors.model) ?? t.modelHelp(aiProviderSpec(kind).defaultModel)}
              inputProps={{ spellCheck: false, autoCapitalize: 'off' }}
              fullWidth
            />
          </Stack>
          <TextField
            label={t.apiKey}
            type={showKey ? 'text' : 'password'}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            error={Boolean(show(errors.apiKey))}
            helperText={
              show(errors.apiKey)
              ?? (hasKey ? (credential?.masked ? t.savedKeyKeep(credential.masked) : t.apiKeyKeepHelp) : t.apiKeyNewHelp)
            }
            required={!hasKey}
            autoComplete="new-password"
            inputProps={{ spellCheck: false, autoCapitalize: 'off' }}
            InputProps={{
              endAdornment: (
                <InputAdornment position="end">
                  <Tooltip title={showKey ? t.hideKey : t.showKey}>
                    <IconButton onClick={() => setShowKey((v) => !v)} aria-label={showKey ? t.hideKey : t.showKey} edge="end">
                      {showKey ? <VisibilityOffOutlinedIcon fontSize="small" /> : <VisibilityOutlinedIcon fontSize="small" />}
                    </IconButton>
                  </Tooltip>
                </InputAdornment>
              ),
            }}
          />
          <Stack direction={{ xs: 'column-reverse', sm: 'row' }} spacing={1.5} justifyContent="flex-end">
            {hasKey && (
              <Button color="error" onClick={() => setConfirmRemove(true)} disabled={saving} sx={{ mr: { sm: 'auto' } }}>
                {t.remove}
              </Button>
            )}
            <Tooltip title={!hasKey || dirty ? t.testNeedsSave : ''}>
              <span>
                <Button
                  variant="outlined"
                  onClick={onTest}
                  disabled={testDisabled}
                  startIcon={testing ? <CircularProgress size={14} /> : undefined}
                  fullWidth
                >
                  {testing ? t.testing : t.test}
                </Button>
              </span>
            </Tooltip>
            <Button type="submit" variant="contained" disableElevation disabled={saving || (hasKey && !dirty)}>
              {saving ? t.saving : t.save}
            </Button>
          </Stack>
        </Stack>
      </form>

      <ConfirmDialog
        open={confirmRemove}
        title={t.removeTitle}
        description={t.removeDescription}
        confirmLabel={t.removeConfirm}
        cancelLabel={t.cancel}
        confirmColor="error"
        onConfirm={() => void handleRemove()}
        onClose={() => setConfirmRemove(false)}
      />
    </SectionCard>
  );
}
