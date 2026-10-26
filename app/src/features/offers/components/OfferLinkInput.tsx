import { useState, type FormEvent } from 'react';
import { Box, Button, CircularProgress, IconButton, InputAdornment, TextField, Tooltip } from '@mui/material';
import LinkIcon from '@mui/icons-material/Link';
import CloseIcon from '@mui/icons-material/Close';
import AutoAwesomeOutlinedIcon from '@mui/icons-material/AutoAwesomeOutlined';
import { offerStrings } from '../strings';

const t = offerStrings.link;

interface Props {
  generating: boolean;
  /** Erro do servidor para o campo (ex.: link não suportado). */
  serverError: string | null;
  disabled?: boolean;
  onGenerate: (url: string) => Promise<void>;
  onChange?: () => void;
}

/** Validação mínima no cliente; a API decide o marketplace e a allowlist. */
function localError(url: string): string | null {
  const value = url.trim();
  if (!value) return t.required;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' ? null : t.invalid;
  } catch {
    return t.invalid;
  }
}

export function OfferLinkInput({ generating, serverError, disabled, onGenerate, onChange }: Props) {
  const [url, setUrl] = useState('');
  const [touchedError, setTouchedError] = useState<string | null>(null);
  const error = touchedError ?? serverError;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const err = localError(url);
    setTouchedError(err);
    if (err) return;
    try {
      await onGenerate(url.trim());
      setUrl('');
    } catch {
      // A mensagem vem do hook (`serverError` ou alerta da página).
    }
  };

  return (
    <Box
      component="form"
      noValidate
      onSubmit={(e) => void submit(e)}
      sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start', flexDirection: { xs: 'column', sm: 'row' } }}
    >
      <TextField
        fullWidth
        label={t.label}
        placeholder={t.placeholder}
        value={url}
        disabled={disabled || generating}
        onChange={(e) => {
          setUrl(e.target.value);
          setTouchedError(null);
          onChange?.();
        }}
        error={Boolean(error)}
        helperText={error ?? t.helper}
        inputMode="url"
        autoComplete="off"
        slotProps={{
          input: {
            startAdornment: (
              <InputAdornment position="start">
                <LinkIcon fontSize="small" sx={{ color: 'text.secondary' }} />
              </InputAdornment>
            ),
            endAdornment: url ? (
              <InputAdornment position="end">
                <Tooltip title={t.clear}>
                  <IconButton
                    size="small"
                    aria-label={t.clear}
                    onClick={() => { setUrl(''); setTouchedError(null); onChange?.(); }}
                    edge="end"
                  >
                    <CloseIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </InputAdornment>
            ) : undefined,
          },
        }}
      />
      <Button
        type="submit"
        variant="contained"
        disableElevation
        disabled={disabled || generating}
        startIcon={generating ? <CircularProgress size={18} color="inherit" /> : <AutoAwesomeOutlinedIcon />}
        sx={{ height: 40, px: 3, flexShrink: 0, width: { xs: '100%', sm: 'auto' }, whiteSpace: 'nowrap' }}
      >
        {generating ? t.generating : t.submit}
      </Button>
    </Box>
  );
}
