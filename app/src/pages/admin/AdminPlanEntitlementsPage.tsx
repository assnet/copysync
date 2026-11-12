import { useState } from 'react';
import {
  Alert, Box, Button, CircularProgress, IconButton, Snackbar, Stack, Switch, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, TextField, Tooltip, Typography,
} from '@mui/material';
import { Check, Info, SlidersHorizontal } from 'lucide-react';
import { AppIcon, ConfirmDialog, EmptyState, PageHeader, SectionCard } from '@/components';
import { usePersistedState } from '@/hooks/usePersistedState';
import { usePlanEntitlementsAdmin } from '@/features/planEntitlementsAdmin/usePlanEntitlementsAdmin';
import {
  featureLabel, planEntitlementsAdminStrings as t, planName,
} from '@/features/planEntitlementsAdmin/strings';
import type { EditablePlanEntitlementValue, PlanEntitlementValue } from '@/features/planEntitlementsAdmin/types';

interface PendingChange { planSlug: string; key: string; value: EditablePlanEntitlementValue; from: PlanEntitlementValue }

const cellId = (key: string, planSlug: string) => `${key}:${planSlug}`;

/** Texto digitado → inteiro na faixa, ou `null` se inválido (vazio, decimal, sinal, fora da faixa). */
function parseDraft(draft: string, min: number, max: number): number | null {
  const v = draft.trim();
  if (!/^\d+$/.test(v)) return null;
  const n = Number(v);
  return n >= min && n <= max ? n : null;
}

/**
 * Super admin: recursos da allowlist por plano. Booleano: Switch, cada troca confirma e grava.
 * Numérico: campo com salvar explícito + confirmação; o texto digitado e não salvo fica em
 * `usePersistedState` (aba) e some ao gravar.
 */
export function AdminPlanEntitlementsPage() {
  const pe = usePlanEntitlementsAdmin();
  const [pending, setPending] = useState<PendingChange | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [drafts, setDrafts] = usePersistedState<Record<string, string>>('admin.planEntitlements.numberDrafts', {});

  const dropDraft = (id: string) => setDrafts((prev) => {
    if (!(id in prev)) return prev;
    const { [id]: _removed, ...rest } = prev;
    return rest;
  });

  const confirm = async () => {
    if (!pending) return;
    const change = pending;
    setPending(null);
    const out = await pe.set(change.planSlug, change.key, change.value);
    if (!out) return;
    const feature = featureLabel(out.key);
    const plan = planName(out.planSlug);
    if (typeof out.value === 'number') {
      dropDraft(cellId(out.key, out.planSlug));
      setNotice(t.savedNumber(feature, plan, out.value, out.tenantsUpdated));
    } else {
      setNotice(t.saved(feature, plan, out.value, out.tenantsUpdated));
    }
  };

  const plans = pe.data?.plans ?? [];
  const rows = pe.data?.entitlements ?? [];
  const pendingFeature = pending ? featureLabel(pending.key) : '';
  const pendingPlan = pending ? planName(pending.planSlug) : '';

  return (
    <Box>
      <PageHeader title={t.pageTitle} subtitle={t.pageSubtitle} />

      {pe.loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress aria-label={t.pageTitle} />
        </Box>
      ) : pe.loadError ? (
        <Alert severity="error" action={<Button color="inherit" size="small" onClick={() => void pe.reload()}>{t.retry}</Button>}>
          {pe.loadError}
        </Alert>
      ) : (
        <SectionCard title={t.listTitle} noPadding={rows.length > 0}>
          {rows.length === 0 ? (
            <EmptyState icon={<AppIcon icon={SlidersHorizontal} size="lg" />} title={t.empty} description={t.emptyHint} sx={{ py: 5 }} />
          ) : (
            <TableContainer>
              {/* 360 px: padding padrão (16 px) das 4 colunas estourava a largura; no celular encolhe. */}
              <Table
                size="small"
                aria-label={t.listTitle}
                sx={{
                  '& .MuiTableCell-root': { px: { xs: 0.75, sm: 2 } },
                  '& .MuiTableCell-root:first-of-type': { overflowWrap: 'anywhere' },
                }}
              >
                <TableHead>
                  <TableRow>
                    <TableCell>{t.columns.feature}</TableCell>
                    {plans.map((p) => <TableCell key={p} align="center">{planName(p)}</TableCell>)}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.map((row) => {
                    const label = featureLabel(row.key);
                    return (
                      <TableRow key={row.key}>
                        <TableCell>
                          <Typography variant="body2" fontWeight={600}>{label}</Typography>
                          {t.features[row.key] && (
                            <Typography variant="caption" color="text.secondary">{t.features[row.key].description}</Typography>
                          )}
                        </TableCell>
                        {plans.map((p) => {
                          const raw = row.plans[p];
                          const plan = planName(p);
                          const missing = raw === null || raw === undefined;
                          const type = row.type;
                          if (type?.kind === 'integer') {
                            const id = cellId(row.key, p);
                            const current = typeof raw === 'number' ? raw : null;
                            const draft = drafts[id] ?? (current === null ? '' : String(current));
                            const parsed = parseDraft(draft, type.min, type.max);
                            const invalid = draft.trim() !== '' && parsed === null;
                            const canSave = parsed !== null && parsed !== current && pe.busy === null;
                            const save = () => {
                              if (canSave) setPending({ planSlug: p, key: row.key, value: parsed, from: current });
                            };
                            return (
                              <TableCell key={p} align="center">
                                <Stack direction="row" spacing={0.25} alignItems="flex-start" justifyContent="center">
                                  <TextField
                                    size="small"
                                    value={draft}
                                    error={invalid}
                                    disabled={pe.busy !== null}
                                    placeholder={t.number.placeholder}
                                    onChange={(e) => setDrafts((prev) => ({ ...prev, [id]: e.target.value }))}
                                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } }}
                                    helperText={invalid ? t.number.invalid(type.min, type.max) : undefined}
                                    inputProps={{
                                      inputMode: 'numeric',
                                      pattern: '[0-9]*',
                                      'aria-label': t.number.aria(label, plan),
                                      title: t.number.range(type.min, type.max),
                                    }}
                                    sx={{ width: { xs: 64, sm: 84 }, '& .MuiFormHelperText-root': { mx: 0, textAlign: 'center' } }}
                                  />
                                  <Tooltip title={t.number.saveTooltip} arrow describeChild enterTouchDelay={0}>
                                    <span>{/* span: Tooltip segue funcionando com o botão desabilitado */}
                                    <IconButton size="small" color="primary" disabled={!canSave} onClick={save} aria-label={t.number.save(label, plan)}>
                                      <AppIcon icon={Check} size="sm" />
                                    </IconButton>
                                    </span>
                                  </Tooltip>
                                  {missing ? (
                                    <Tooltip title={t.notPresetHintNumber} arrow describeChild enterTouchDelay={0}>
                                      <Box component="span" tabIndex={0} aria-label={t.notPresetHintNumber} sx={{ display: 'inline-flex', color: 'text.disabled', pt: 1 }}>
                                        <AppIcon icon={Info} size="sm" />
                                      </Box>
                                    </Tooltip>
                                  ) : null}
                                </Stack>
                              </TableCell>
                            );
                          }
                          // Booleano: só `true` liga (número nunca cai aqui)
                          const on = raw === true;
                          return (
                            <TableCell key={p} align="center">
                              <Stack direction="row" spacing={0.25} alignItems="center" justifyContent="center">
                                <Tooltip title={t.switchTooltip(label, plan, on)} arrow describeChild enterTouchDelay={0}>
                                  <span>{/* span: Tooltip segue funcionando com o Switch desabilitado */}
                                  <Switch
                                    checked={on}
                                    disabled={pe.busy !== null}
                                    onChange={(e) => setPending({ planSlug: p, key: row.key, value: e.target.checked, from: raw ?? null })}
                                    inputProps={{ 'aria-label': t.switchAria(label, plan) }}
                                  />
                                  </span>
                                </Tooltip>
                                {missing ? (
                                  <Tooltip title={t.notPresetHint} arrow describeChild enterTouchDelay={0}>
                                    <Box component="span" tabIndex={0} aria-label={t.notPresetHint} sx={{ display: 'inline-flex', color: 'text.disabled' }}>
                                      <AppIcon icon={Info} size="sm" />
                                    </Box>
                                  </Tooltip>
                                ) : null}
                              </Stack>
                            </TableCell>
                          );
                        })}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </SectionCard>
      )}

      <ConfirmDialog
        open={pending !== null}
        title={typeof pending?.value === 'number'
          ? t.confirm.titleNumber(pendingFeature, pendingPlan)
          : pending?.value ? t.confirm.titleOn(pendingFeature, pendingPlan) : t.confirm.titleOff(pendingFeature, pendingPlan)}
        description={typeof pending?.value === 'number'
          ? t.confirm.descriptionNumber(typeof pending.from === 'number' ? pending.from : null, pending.value, pendingPlan)
          : t.confirm.description(pendingPlan)}
        confirmLabel={typeof pending?.value === 'number'
          ? t.confirm.confirmNumber
          : pending?.value ? t.confirm.confirmOn : t.confirm.confirmOff}
        cancelLabel={t.confirm.cancel}
        confirmColor={pending?.value === false ? 'error' : 'primary'}
        onConfirm={() => void confirm()}
        onClose={() => setPending(null)}
      />

      <Snackbar open={Boolean(pe.actionError)} autoHideDuration={6000} onClose={pe.clearActionError} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        <Alert severity="error" variant="filled" onClose={pe.clearActionError}>{pe.actionError}</Alert>
      </Snackbar>
      <Snackbar open={Boolean(notice)} autoHideDuration={4000} onClose={() => setNotice(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        <Alert severity="success" variant="filled" onClose={() => setNotice(null)}>{notice}</Alert>
      </Snackbar>
    </Box>
  );
}
