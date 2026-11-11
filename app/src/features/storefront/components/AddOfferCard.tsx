import { useState, type FormEvent } from 'react';
import { Alert, Box, Button, CircularProgress, MenuItem, Stack, TextField } from '@mui/material';
import { ArrowRight, Info, KeyRound, Link2, PackagePlus, ScanSearch } from 'lucide-react';
import { Link as RouterLink, useLocation } from 'react-router-dom';
import { AppIcon, SectionCard } from '@/components';
import { upgradePathFor } from '@/features/linkRotation/planUpsell';
import { isAffiliateLinkErrorCode } from '@/features/affiliateLinks/linkErrors';
import { ConnectStoreAction, credentialsPathFor } from '@/features/affiliateLinks/components/ConnectStoreAction';
import { LinkRebuiltNotice } from '@/features/affiliateLinks/components/LinkRebuiltNotice';
import type { StorefrontErrorAction } from '../storefrontForm';
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
  /** Correção do erro em outra tela: botão sob o campo (credenciais ou planos). */
  errorAction?: StorefrontErrorAction | null;
  /** Código e `meta` do erro: escolhem o rótulo do botão de credenciais ("Conectar Shopee"…). */
  errorCode?: string | null;
  errorMeta?: unknown;
  /** Loja do último item adicionado com link recriado com a conta do usuário (mostra o aviso). */
  rebuiltProvider?: string | null;
  disabled?: boolean;
}

interface ErrorActionButtonProps {
  action: StorefrontErrorAction;
  code?: string | null;
  meta?: unknown;
}

/**
 * Botão sob o campo. Credencial/aceite de risco → `ConnectStoreAction` (rótulo por código); etiqueta
 * do ML → credenciais; sem vaga → planos. Credenciais voltam para esta tela (`returnTo`).
 */
function ErrorActionButton({ action, code, meta }: ErrorActionButtonProps) {
  const { pathname, search } = useLocation();
  if (action === 'credentials' && isAffiliateLinkErrorCode(code)) {
    return <ConnectStoreAction code={code} meta={meta} variant="outlined" />;
  }
  const plans = action === 'plans';
  return (
    <Button
      component={RouterLink}
      to={plans ? upgradePathFor('mercadoLivreTags') : credentialsPathFor(pathname, search)}
      size="small"
      variant="outlined"
      color={plans ? 'primary' : 'inherit'}
      {...(plans
        ? { endIcon: <AppIcon icon={ArrowRight} size="sm" /> }
        : { startIcon: <AppIcon icon={KeyRound} size="sm" /> })}
      sx={{ minHeight: 36 }}
    >
      {t.actions[action]}
    </Button>
  );
}

/** "Adicionar Oferta": link do produto + categoria → Extrair (vira rascunho). */
export function AddOfferCard({
  value, onChange, categories, selectedCategories, onExtract, error, errorAction, errorCode, errorMeta, rebuiltProvider, disabled,
}: AddOfferCardProps) {
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
              startIcon={busy ? <CircularProgress size={16} color="inherit" /> : <AppIcon icon={ScanSearch} size="sm" />}
              sx={{ flexShrink: 0, minHeight: 40, minWidth: 120 }}
            >
              <span aria-live="polite">{busy ? t.extracting : t.extract}</span>
            </Button>
          </Stack>
          {error && errorAction && (
            <Box>
              <ErrorActionButton action={errorAction} code={errorCode} meta={errorMeta} />
            </Box>
          )}
          {!error && rebuiltProvider && (
            <Box>
              <LinkRebuiltNotice provider={rebuiltProvider} />
            </Box>
          )}
          <Alert severity="info" variant="outlined" icon={<AppIcon icon={Info} size="sm" />} sx={{ py: 0 }}>
            {t.productLinkHint}
          </Alert>
        </Stack>
      </Box>
    </SectionCard>
  );
}
