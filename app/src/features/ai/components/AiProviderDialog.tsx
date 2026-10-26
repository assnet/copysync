import { useEffect, useState, type FormEvent } from 'react';
import {
  Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, IconButton,
  InputAdornment, MenuItem, Stack, Switch, TextField, Tooltip,
} from '@mui/material';
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined';
import VisibilityOffOutlinedIcon from '@mui/icons-material/VisibilityOffOutlined';
import type {
  AiCatalogItem, AiPlatformProvider, AiProviderKind, CreateAiPlatformProviderRequest,
} from '@/types/api.types';
import { aiProviderName, catalogEntry, isSuggestedModel, suggestedModel } from '../aiProviders';
import { aiErrorField, aiErrorMessage, aiStrings } from '../strings';

const t = aiStrings.admin.dialog;

interface Props {
  open: boolean;
  /** Ausente = criar. */
  provider?: AiPlatformProvider;
  /** Prioridade sugerida para um novo provedor (vai para o fim da fila). */
  nextPriority: number;
  /** Tipos vindos de `/admin/ai/catalog`. */
  catalog: readonly AiCatalogItem[];
  onSubmit: (body: CreateAiPlatformProviderRequest) => Promise<void>;
  onClose: () => void;
}

const isNonNegativeInt = (v: string) => /^\d+$/.test(v.trim());

/** Criar/editar provedor da plataforma. Não é otimista: fica aberto até a API responder 2xx. */
const looksHttps = (v: string) => /^https:\/\/[^\s/]+\.[^\s]+$/i.test(v.trim());

export function AiProviderDialog({ open, provider, nextPriority, catalog, onSubmit, onClose }: Props) {
  const [kind, setKind] = useState<AiProviderKind>('ANTHROPIC');
  const [baseUrl, setBaseUrl] = useState('');
  const [baseUrlApiError, setBaseUrlApiError] = useState(false);
  const [label, setLabel] = useState('');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [priority, setPriority] = useState('0');
  const [dailyLimit, setDailyLimit] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const k = provider?.kind ?? catalog[0]?.kind ?? 'ANTHROPIC';
    setKind(k);
    setLabel(provider?.label ?? '');
    setModel(provider?.model ?? suggestedModel(catalog, k));
    setBaseUrl(provider?.baseUrl ?? '');
    setBaseUrlApiError(false);
    setApiKey('');
    setShowKey(false);
    setPriority(String(provider?.priority ?? nextPriority));
    setDailyLimit(provider?.dailyLimitPerTenant == null ? '' : String(provider.dailyLimitPerTenant));
    setEnabled(provider?.enabled ?? true);
    setSubmitted(false);
    setApiError(null);
  }, [open, provider, nextPriority, catalog]);

  const entry = catalogEntry(catalog, kind);
  const needsBaseUrl = Boolean(entry?.requiresBaseUrl);
  const suggested = entry?.defaultModel ?? null;
  const keyRequired = !provider?.hasKey;
  const errors = {
    label: !label.trim() ? t.required : null,
    model: !model.trim() ? t.required : null,
    apiKey: keyRequired && !apiKey.trim() ? t.required : null,
    priority: !isNonNegativeInt(priority) ? t.invalidNumber : null,
    dailyLimit: dailyLimit.trim() && !isNonNegativeInt(dailyLimit) ? t.invalidNumber : null,
    baseUrl: !needsBaseUrl ? null : !baseUrl.trim() ? t.required : !looksHttps(baseUrl) ? t.baseUrlInvalid : null,
  };
  const hasError = Object.values(errors).some(Boolean);
  const show = (e: string | null) => (submitted ? e : null);

  const handleKind = (k: AiProviderKind) => {
    setKind(k);
    if (isSuggestedModel(model, catalog)) setModel(suggestedModel(catalog, k));
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (hasError || saving) return;
    const body: CreateAiPlatformProviderRequest = {
      kind,
      label: label.trim(),
      model: model.trim(),
      apiKey: apiKey.trim(),
      enabled,
      priority: Number(priority),
      dailyLimitPerTenant: dailyLimit.trim() ? Number(dailyLimit) : null,
      ...(needsBaseUrl && { baseUrl: baseUrl.trim() }),
    };
    setSaving(true);
    setApiError(null);
    setBaseUrlApiError(false);
    try {
      await onSubmit(body);
    } catch (err) {
      if (aiErrorField(err) === 'baseUrl') setBaseUrlApiError(true);
      else setApiError(aiErrorMessage(err, 'admin'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} maxWidth="sm" fullWidth aria-labelledby="ai-provider-dialog-title">
      <form onSubmit={handleSubmit} noValidate>
        <DialogTitle id="ai-provider-dialog-title" sx={{ fontWeight: 700 }}>
          {provider ? t.editTitle : t.createTitle}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2.5} sx={{ pt: 1 }}>
            {apiError && <Alert severity="error">{apiError}</Alert>}
            <TextField
              select
              label={t.kind}
              value={kind}
              onChange={(e) => handleKind(e.target.value as AiProviderKind)}
              disabled={Boolean(provider)}
              helperText={provider ? t.kindLockedHelp : undefined}
            >
              {catalog.map((c) => (
                <MenuItem key={c.kind} value={c.kind}>{aiProviderName(c.kind, catalog)}</MenuItem>
              ))}
              {!catalogEntry(catalog, kind) && <MenuItem value={kind}>{aiProviderName(kind, catalog)}</MenuItem>}
            </TextField>
            <TextField
              label={t.label}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              error={Boolean(show(errors.label))}
              helperText={show(errors.label) ?? t.labelHelp}
              required
              autoFocus
            />
            <TextField
              label={t.model}
              value={model}
              onChange={(e) => setModel(e.target.value)}
              error={Boolean(show(errors.model))}
              helperText={show(errors.model) ?? (suggested ? t.modelHelp(suggested) : t.modelRequiredHelp)}
              required
              inputProps={{ spellCheck: false, autoCapitalize: 'off' }}
            />
            {needsBaseUrl && (
              <TextField
                label={t.baseUrl}
                type="url"
                value={baseUrl}
                onChange={(e) => {
                  setBaseUrl(e.target.value);
                  setBaseUrlApiError(false);
                }}
                error={baseUrlApiError || Boolean(show(errors.baseUrl))}
                helperText={baseUrlApiError ? t.baseUrlInvalid : show(errors.baseUrl) ?? t.baseUrlHelp}
                required
                placeholder="https://api.exemplo.com/v1"
                inputProps={{ spellCheck: false, autoCapitalize: 'off', maxLength: 300, inputMode: 'url' }}
              />
            )}
            <TextField
              label={t.apiKey}
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              error={Boolean(show(errors.apiKey))}
              helperText={show(errors.apiKey) ?? (keyRequired ? t.apiKeyNewHelp : t.apiKeyKeepHelp)}
              required={keyRequired}
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
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                label={t.priority}
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                error={Boolean(show(errors.priority))}
                helperText={show(errors.priority) ?? t.priorityHelp}
                inputProps={{ inputMode: 'numeric' }}
                fullWidth
              />
              <TextField
                label={t.dailyLimit}
                value={dailyLimit}
                onChange={(e) => setDailyLimit(e.target.value)}
                error={Boolean(show(errors.dailyLimit))}
                helperText={show(errors.dailyLimit) ?? t.dailyLimitHelp}
                inputProps={{ inputMode: 'numeric' }}
                fullWidth
              />
            </Stack>
            <FormControlLabel
              control={<Switch checked={enabled} onChange={(_, v) => setEnabled(v)} />}
              label={t.enabled}
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={onClose} color="inherit" disabled={saving}>{aiStrings.admin.cancel}</Button>
          <Button type="submit" variant="contained" disableElevation disabled={saving}>
            {saving ? t.saving : t.save}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
