import { useState } from 'react';
import {
  Alert, Box, Button, CircularProgress, Snackbar, Stack, Switch, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Tooltip, Typography,
} from '@mui/material';
import { Info, SlidersHorizontal } from 'lucide-react';
import { AppIcon, ConfirmDialog, EmptyState, PageHeader, SectionCard } from '@/components';
import { usePlanEntitlementsAdmin } from '@/features/planEntitlementsAdmin/usePlanEntitlementsAdmin';
import {
  featureLabel, planEntitlementsAdminStrings as t, planName,
} from '@/features/planEntitlementsAdmin/strings';

interface PendingChange { planSlug: string; key: string; value: boolean }

/** Super admin: liga/desliga recursos da allowlist por plano. Sem rascunho: cada troca confirma e grava. */
export function AdminPlanEntitlementsPage() {
  const pe = usePlanEntitlementsAdmin();
  const [pending, setPending] = useState<PendingChange | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const confirm = async () => {
    if (!pending) return;
    const change = pending;
    setPending(null);
    const out = await pe.set(change.planSlug, change.key, change.value);
    if (out) setNotice(t.saved(featureLabel(out.key), planName(out.planSlug), out.value, out.tenantsUpdated));
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
              <Table size="small" aria-label={t.listTitle}>
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
                          const on = raw === true;
                          const plan = planName(p);
                          return (
                            <TableCell key={p} align="center">
                              <Stack direction="row" spacing={0.25} alignItems="center" justifyContent="center">
                                <Tooltip title={t.switchTooltip(label, plan, on)} arrow describeChild enterTouchDelay={0}>
                                  <span>{/* span: Tooltip segue funcionando com o Switch desabilitado */}
                                  <Switch
                                    checked={on}
                                    disabled={pe.busy !== null}
                                    onChange={(e) => setPending({ planSlug: p, key: row.key, value: e.target.checked })}
                                    inputProps={{ 'aria-label': t.switchAria(label, plan) }}
                                  />
                                  </span>
                                </Tooltip>
                                {raw === null || raw === undefined ? (
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
        title={pending?.value ? t.confirm.titleOn(pendingFeature, pendingPlan) : t.confirm.titleOff(pendingFeature, pendingPlan)}
        description={t.confirm.description(pendingPlan)}
        confirmLabel={pending?.value ? t.confirm.confirmOn : t.confirm.confirmOff}
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
