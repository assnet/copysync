import { useId, useMemo, useState } from 'react';
import {
  Alert, Box, Button, Checkbox, Chip, Radio, RadioGroup, Stack, Tooltip, Typography,
} from '@mui/material';
import { Crown, Save } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { AppIcon, HideUnavailableSwitch, OverflowTooltipText, UnavailableReason } from '@/components';
import { usePersistedState } from '@/hooks/usePersistedState';
import { Blurred, useBlur } from '@/features/privacy';
import { AFFILIATE_PLANS_PATH } from '@/features/navigation/model';
import type { AffiliateCredentialItem, SetAffiliateIdentifiersRequest } from '@/types/api.types';
import { identifiersErrorOf, settingsStrings } from '../strings';
import {
  choosePrimary, isFull, sameSelection, sanitizeSelection, toggleLinked, usedOf, type IdentifierSelection,
} from '../utils/identifierSelection';

const t = settingsStrings.affiliate.identifiers;
const PLANS_HREF = `${AFFILIATE_PLANS_PATH}?feature=mercadoLivreTags`;

interface Props {
  item: AffiliateCredentialItem;
  onSave: (body: SetAffiliateIdentifiersRequest) => Promise<void>;
}

/**
 * Etiquetas da conta do ML (fonte única: API). Escolha da principal (rádio) e das vinculadas
 * (caixa) até o limite do plano; o que não cabe fica indisponível com motivo e caminho para os
 * planos. Rascunho em `usePersistedState` (aba), limpo ao salvar ou descartar.
 */
export function AccountIdentifiersSection({ item, onSave }: Props) {
  const blur = useBlur('affiliateCredentials.accountIdentifiers');
  const navigate = useNavigate();
  const baseId = useId();
  const account = useMemo(() => item.accountIdentifiers ?? [], [item.accountIdentifiers]);
  const limit = Math.max(1, item.identifierLimit ?? 1);
  const server = useMemo(
    () => sanitizeSelection({ primary: item.publicIdentifier, linked: item.linkedIdentifiers ?? [] }, account, limit),
    [item.publicIdentifier, item.linkedIdentifiers, account, limit],
  );

  const [draft, setDraft, clearDraft] = usePersistedState<IdentifierSelection | null>(
    `affiliateCredentials.identifiers.${item.provider}`, null, { version: 1 },
  );
  const [hideUnavailable, setHideUnavailable] = usePersistedState('affiliateCredentials.identifiers.hideUnavailable', true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<ReturnType<typeof identifiersErrorOf> | null>(null);

  const sel = draft ? sanitizeSelection(draft, account, limit) : server;
  const dirty = !sameSelection(sel, server);
  const full = isFull(sel, limit);
  const used = usedOf(sel);
  // Indisponível = não cabe vincular. Sem principal, todas seguem escolhíveis como principal.
  const unavailableOf = (tag: string) => !!sel.primary && tag !== sel.primary && !sel.linked.includes(tag) && full;
  const unavailableCount = account.filter(unavailableOf).length;
  const visible = hideUnavailable ? account.filter((tag) => !unavailableOf(tag)) : account;

  const change = (next: IdentifierSelection) => {
    setSaved(false);
    setError(null);
    // Voltou ao que está salvo: sem rascunho (não sobrevive ao reload como "alterado").
    if (sameSelection(next, server)) clearDraft();
    else setDraft(next);
  };

  const save = async () => {
    if (!sel.primary) return;
    setSaving(true);
    setError(null);
    try {
      await onSave({ primary: sel.primary, linked: sel.linked });
      clearDraft();
      setSaved(true);
    } catch (err) {
      setError(identifiersErrorOf(err));
    } finally {
      setSaving(false);
    }
  };

  const showPlans = unavailableCount > 0 || !!error?.showPlans;

  return (
    <Box
      component="section"
      aria-labelledby={`${baseId}-title`}
      sx={{ p: 2, borderRadius: 1, border: 1, borderColor: 'divider', display: 'flex', flexDirection: 'column', gap: 1.5 }}
    >
      <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
        <Typography id={`${baseId}-title`} variant="subtitle2" component="h3" fontWeight={600}>{t.title}</Typography>
        <Chip
          size="small"
          variant="outlined"
          color={used >= limit ? 'warning' : 'default'}
          label={t.counter(used, limit)}
          aria-label={t.counterAria(used, limit)}
        />
      </Stack>
      <Typography variant="caption" color="text.secondary">{t.subtitle}</Typography>

      {account.length === 0 ? (
        <Alert severity="info" variant="outlined" sx={{ py: 0 }}>{t.empty}</Alert>
      ) : (
        <>
          {!sel.primary && <Alert severity="warning" variant="outlined" sx={{ py: 0 }}>{t.choosePrimary}</Alert>}
          {unavailableCount > 0 && (
            <HideUnavailableSwitch
              checked={hideUnavailable}
              onChange={setHideUnavailable}
              label={t.hideUnavailable}
              tooltip={t.hideUnavailableTooltip}
              hiddenCount={unavailableCount}
              hiddenCountLabel={t.hiddenCount}
            />
          )}
          <RadioGroup
            aria-labelledby={`${baseId}-title`}
            value={sel.primary ?? ''}
            onChange={(_, tag) => change(choosePrimary(sel, tag, limit))}
            sx={{ gap: 0.5 }}
          >
            {visible.map((tag, idx) => {
              const isPrimary = tag === sel.primary;
              const unavailable = unavailableOf(tag);
              const reasonId = `${baseId}-reason-${idx}`;
              return (
                <Box
                  key={tag}
                  data-identifier-row
                  aria-describedby={unavailable ? reasonId : undefined}
                  sx={{
                    display: 'flex', alignItems: 'center', gap: 1, minHeight: 44, px: 0.5, borderRadius: 1,
                    bgcolor: isPrimary ? 'action.selected' : undefined,
                  }}
                >
                  <Radio value={tag} size="small" disabled={saving} inputProps={{ 'aria-label': t.primaryAria(tag) }} />
                  <Box sx={{ flex: 1, minWidth: 0, opacity: unavailable ? 0.7 : 1 }}>
                    <OverflowTooltipText
                      text={tag}
                      disabled={blur}
                      typographyProps={{ variant: 'body2', sx: { fontFamily: 'monospace' } }}
                    >
                      <Blurred when={blur} inline radius={5}>{tag}</Blurred>
                    </OverflowTooltipText>
                    {unavailable && <UnavailableReason id={reasonId} text={t.unavailable(limit)} />}
                  </Box>
                  {isPrimary ? (
                    <Tooltip title={t.primaryAlwaysLinked} arrow describeChild enterTouchDelay={0} leaveTouchDelay={4000}>
                      <Chip size="small" color="primary" label={t.primaryBadge} sx={{ flexShrink: 0 }} />
                    </Tooltip>
                  ) : (
                    <Box component="label" sx={{ display: 'inline-flex', alignItems: 'center', flexShrink: 0, cursor: 'pointer' }}>
                      <Typography variant="caption" color="text.secondary">{t.linkLabel}</Typography>
                      <Checkbox
                        size="small"
                        checked={sel.linked.includes(tag)}
                        disabled={saving || (!sel.linked.includes(tag) && full)}
                        onChange={() => change(toggleLinked(sel, tag, limit))}
                        inputProps={{ 'aria-label': t.linkAria(tag) }}
                      />
                    </Box>
                  )}
                </Box>
              );
            })}
          </RadioGroup>
        </>
      )}

      {error && <Alert severity="error" onClose={() => setError(null)}>{error.message}</Alert>}
      {saved && !dirty && <Alert severity="success" variant="outlined" sx={{ py: 0 }}>{t.saved}</Alert>}

      {(showPlans || account.length > 0) && (
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap justifyContent="space-between" alignItems="center">
          {showPlans ? (
            <Tooltip title={t.seePlansTooltip} arrow describeChild>
              <Button size="small" variant="text" startIcon={<AppIcon icon={Crown} size="sm" />} onClick={() => navigate(PLANS_HREF)}>
                {t.seePlans}
              </Button>
            </Tooltip>
          ) : <span />}
          {account.length > 0 && (
            <Stack direction="row" spacing={1}>
              {dirty && (
                <Button size="small" variant="outlined" disabled={saving} onClick={() => { clearDraft(); setError(null); }}>
                  {t.discard}
                </Button>
              )}
              <Button
                size="small"
                variant="contained"
                disableElevation
                startIcon={<AppIcon icon={Save} size="sm" />}
                disabled={!dirty || !sel.primary || saving}
                onClick={() => void save()}
              >
                {saving ? t.saving : t.save}
              </Button>
            </Stack>
          )}
        </Stack>
      )}
    </Box>
  );
}
