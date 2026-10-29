import { useState, type FormEvent } from 'react';
import { Alert, Box, Button, CircularProgress, MenuItem, Stack, TextField } from '@mui/material';
import { Info, Link2, PackagePlus, Sparkles } from 'lucide-react';
import { AppIcon, SectionCard } from '@/components';
import { storefrontStrings } from '../strings';
import type { StorefrontCategory } from '../types';
import { pageCategoryOptions } from '../offerForm';

const t = storefrontStrings.addOffer;
/** Valor do select para "Sem categoria" (o MUI não aceita null). */
const NONE = '';

export interface AddOfferDraft {
  url: string;
  category: string | null;
}

export interface AddOfferCardProps {
  /** Controlado: a página persiste URL colada + categoria (`usePersistedState`). */
  value: AddOfferDraft;
  onChange: (next: AddOfferDraft) => void;
  /** Catálogo completo (do overview) e as chaves selecionadas na página. */
  categories: readonly StorefrontCategory[];
  selectedCategories: readonly string[];
  /** Cria o rascunho; quem chama trata erro e limpa o campo ao concluir. */
  onExtract: (url: string, category: string | null) => Promise<void>;
  /** Erro da última extração (texto já traduzido), mostrado junto ao campo. */
  error?: string | null;
  disabled?: boolean;
}

/** "Adicionar Oferta": link do produto + categoria → Extrair (vira rascunho). */
export function AddOfferCard({ value, onChange, categories, selectedCategories, onExtract, error, disabled }: AddOfferCardProps) {
  const [busy, setBusy] = useState(false);
  const options = pageCategoryOptions(categories, selectedCategories);
  const url = value.url.trim();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!url || busy) return;
    setBusy(true);
    try {
      await onExtract(url, value.category);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SectionCard
      title={t.title}
      action={<AppIcon icon={PackagePlus} size="md" style={{ opacity: 0.7 }} />}
    >
      <Box component="form" onSubmit={(e) => void submit(e)} noValidate>
        <Stack spacing={2}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'flex-start' }}>
            <TextField
              label={t.urlLabel}
              placeholder={t.urlPlaceholder}
              value={value.url}
              onChange={(e) => onChange({ ...value, url: e.target.value })}
              disabled={disabled || busy}
              error={Boolean(error)}
              helperText={error || undefined}
              type="url"
              inputMode="url"
              fullWidth
              size="small"
              slotProps={{ input: { startAdornment: <AppIcon icon={Link2} size="sm" style={{ marginRight: 8, opacity: 0.6 }} /> } }}
            />
            <TextField
              select
              label={t.categoryLabel}
              value={value.category ?? NONE}
              onChange={(e) => onChange({ ...value, category: e.target.value === NONE ? null : e.target.value })}
              disabled={disabled || busy}
              size="small"
              sx={{ minWidth: { sm: 200 } }}
            >
              <MenuItem value={NONE}>{t.noCategory}</MenuItem>
              {options.map((c) => <MenuItem key={c.key} value={c.key}>{c.label}</MenuItem>)}
            </TextField>
            <Button
              type="submit"
              variant="contained"
              disableElevation
              disabled={disabled || busy || !url}
              startIcon={busy ? <CircularProgress size={16} color="inherit" /> : <AppIcon icon={Sparkles} size="sm" />}
              sx={{ flexShrink: 0, minHeight: 40, minWidth: 120 }}
            >
              <span aria-live="polite">{busy ? t.extracting : t.extract}</span>
            </Button>
          </Stack>
          <Alert severity="info" variant="outlined" icon={<AppIcon icon={Info} size="sm" />} sx={{ py: 0 }}>
            {t.productLinkHint}
          </Alert>
        </Stack>
      </Box>
    </SectionCard>
  );
}
