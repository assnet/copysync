import { useState } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, MenuItem,
  Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Tooltip, Typography,
} from '@mui/material';
import { Trash2 } from 'lucide-react';
import { AppIcon, ConfirmDialog } from '@/components';
import { usePersistedState } from '@/hooks/usePersistedState';
import { serverNow } from '@/services/serverClock';
import { grantErrorMessage } from '../errors';
import { usePremiumGrants } from '../hooks/usePremiumGrants';
import { grantExpiryToIso } from '../rules';
import { linkDomainsAdminStrings } from '../strings';
import type { LinkDomain, PremiumSlugGrant } from '../types';

const t = linkDomainsAdminStrings.grants;

interface Draft {
  slug: string;
  tenantId: string;
  /** AAAA-MM-DD do `<input type="date">`; vazio = sem validade. */
  expiresAt: string;
}

const EMPTY: Draft = { slug: '', tenantId: '', expiresAt: '' };

interface Props {
  domain: LinkDomain;
  onClose: () => void;
  onNotice: (message: string) => void;
}

/**
 * Liberações de nomes especiais do domínio: lista com revogar (ConfirmDialog) e formulário de
 * nova liberação. Rascunho do formulário sobrevive a reload (`usePersistedState`, escopo `tab`)
 * e é limpo ao liberar ou fechar.
 */
export function PremiumGrantsDialog({ domain, onClose, onNotice }: Props) {
  const pg = usePremiumGrants(domain.id);
  const [draft, setDraft, clearDraft] = usePersistedState<Draft>(`linkDomainsAdmin.grants.${domain.id}`, EMPTY);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<PremiumSlugGrant | null>(null);

  const granted = new Set(pg.grants.map((g) => g.slug));
  const available = domain.premiumNames.filter((n) => !granted.has(n));
  const expiry = grantExpiryToIso(draft.expiresAt, serverNow());
  const tenantMissing = !draft.tenantId.trim();
  const slug = available.includes(draft.slug) ? draft.slug : '';

  const close = () => {
    clearDraft();
    onClose();
  };

  const submit = async () => {
    setTouched(true);
    if (!slug || tenantMissing || expiry === 'invalid') return;
    setSaving(true);
    setError(null);
    try {
      await pg.grant({ slug, tenantId: draft.tenantId.trim(), expiresAt: expiry });
      clearDraft();
      setTouched(false);
      onNotice(t.grantedToast(slug));
    } catch (err) {
      setError(grantErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const confirmRevoke = async (g: PremiumSlugGrant) => {
    setRevoking(null);
    setError(null);
    try {
      await pg.revoke(g.id);
      onNotice(t.revokedToast(g.slug));
    } catch (err) {
      setError(grantErrorMessage(err));
    }
  };

  return (
    <Dialog open onClose={saving ? undefined : close} maxWidth="md" fullWidth aria-labelledby="premium-grants-title">
      <DialogTitle id="premium-grants-title" sx={{ fontWeight: 700 }}>{t.title(domain.hostname)}</DialogTitle>
      <DialogContent>
        <Stack spacing={2.5} sx={{ pt: 1 }}>
          <Typography variant="body2" color="text.secondary">{t.intro}</Typography>
          {error && <Alert severity="error" role="alert" onClose={() => setError(null)}>{error}</Alert>}

          {domain.premiumNames.length === 0 ? (
            <Alert severity="info">{t.noPremiumNames}</Alert>
          ) : (
            <Box
              component="form"
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
            >
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5 }}>{t.form.title}</Typography>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'flex-start' }}>
                <TextField
                  select
                  label={t.form.slug}
                  value={slug}
                  onChange={(e) => setDraft((d) => ({ ...d, slug: e.target.value }))}
                  disabled={available.length === 0}
                  error={touched && !slug}
                  helperText={available.length === 0 ? t.form.slugAllGranted : ' '}
                  sx={{ minWidth: 180 }}
                >
                  {available.map((n) => <MenuItem key={n} value={n} sx={{ fontFamily: 'monospace' }}>{n}</MenuItem>)}
                </TextField>
                <TextField
                  label={t.form.tenantId}
                  value={draft.tenantId}
                  onChange={(e) => setDraft((d) => ({ ...d, tenantId: e.target.value }))}
                  error={touched && tenantMissing}
                  helperText={touched && tenantMissing ? t.form.tenantRequired : t.form.tenantHelp}
                  autoComplete="off"
                  inputProps={{ spellCheck: false, autoCapitalize: 'none', maxLength: 64 }}
                  sx={{ flex: 1 }}
                />
                <TextField
                  type="date"
                  label={t.form.expiresAt}
                  value={draft.expiresAt}
                  onChange={(e) => setDraft((d) => ({ ...d, expiresAt: e.target.value }))}
                  error={expiry === 'invalid'}
                  helperText={expiry === 'invalid' ? t.form.expiresInvalid : t.form.expiresHelp}
                  InputLabelProps={{ shrink: true }}
                  sx={{ minWidth: 180 }}
                />
              </Stack>
              <Button
                type="submit"
                variant="contained"
                disableElevation
                disabled={saving || available.length === 0}
                startIcon={saving ? <CircularProgress size={16} color="inherit" /> : undefined}
                sx={{ mt: 1 }}
              >
                {t.form.submit}
              </Button>
            </Box>
          )}

          <Box>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>{t.listTitle}</Typography>
            {pg.loading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
                <CircularProgress size={24} aria-label={t.listTitle} />
              </Box>
            ) : pg.loadError ? (
              <Alert
                severity="error"
                action={<Button color="inherit" size="small" onClick={() => void pg.reload()}>{t.retry}</Button>}
              >
                {pg.loadError}
              </Alert>
            ) : pg.grants.length === 0 ? (
              <Typography variant="body2" color="text.secondary">{t.empty}</Typography>
            ) : (
              <Box sx={{ overflowX: 'auto' }}>
                <Table size="small" sx={{ minWidth: 520 }}>
                  <TableHead>
                    <TableRow>
                      <TableCell>{t.columns.slug}</TableCell>
                      <TableCell>{t.columns.tenant}</TableCell>
                      <TableCell>{t.columns.expires}</TableCell>
                      <TableCell align="right">{t.columns.actions}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {pg.grants.map((g) => (
                      <TableRow key={g.id} hover>
                        <TableCell sx={{ fontFamily: 'monospace', fontWeight: 600 }}>
                          {g.slug}
                          {g.source === 'BILLING' && <Chip size="small" variant="outlined" label={t.sourceBilling} sx={{ ml: 1 }} />}
                        </TableCell>
                        <TableCell sx={{ fontFamily: 'monospace' }}>{g.tenantId}</TableCell>
                        <TableCell>
                          {g.expiresAt ? (
                            <time dateTime={g.expiresAt}>{new Date(g.expiresAt).toLocaleDateString('pt-BR')}</time>
                          ) : (
                            <Typography variant="body2" color="text.secondary" component="span">{t.noExpiry}</Typography>
                          )}
                        </TableCell>
                        <TableCell align="right">
                          <Tooltip title={t.revoke}>
                            <IconButton aria-label={t.revokeLabel(g.slug)} color="error" onClick={() => setRevoking(g)}>
                              <AppIcon icon={Trash2} size="sm" />
                            </IconButton>
                          </Tooltip>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Box>
            )}
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={close} color="inherit" disabled={saving}>{t.close}</Button>
      </DialogActions>

      <ConfirmDialog
        open={revoking !== null}
        title={t.revokeDialog.title}
        description={revoking ? t.revokeDialog.description(revoking.slug) : ''}
        confirmLabel={t.revokeDialog.confirm}
        cancelLabel={t.revokeDialog.cancel}
        confirmColor="error"
        onConfirm={() => {
          if (revoking) void confirmRevoke(revoking);
        }}
        onClose={() => setRevoking(null)}
      />
    </Dialog>
  );
}
