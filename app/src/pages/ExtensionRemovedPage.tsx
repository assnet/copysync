import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Alert, Box, Button, Card, Chip, CircularProgress, Stack, TextField, Tooltip, Typography, alpha, useTheme,
} from '@mui/material';
import { Check, CircleCheck, ExternalLink, PackageX, RotateCcw, Send } from 'lucide-react';
import { AppIcon } from '@/components/AppIcon';
import { ThemeModeSelector } from '@/components/ThemeModeSelector';
import { usePersistedState } from '@/hooks/usePersistedState';
import { APP_NAME } from '@/shared/branding/brand';
import { BrandLogo } from '@/shared/branding/BrandLogo';
import { openExtensionStore } from '@/features/extension/config';
import {
  extensionApi, UNINSTALL_COMMENT_MAX, UNINSTALL_REASONS, type UninstallReason,
} from '@/features/extension/services/extensionApi';
import { extensionStrings } from '@/features/extension/strings';

const t = extensionStrings.removed;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHORT_PARAM_RE = /^[A-Za-z0-9._-]{1,64}$/;

/** Parâmetro curto e sem caracteres estranhos, senão não vai para a API. */
const safeParam = (value: string | null) => (value && SHORT_PARAM_RE.test(value) ? value : undefined);

interface FeedbackDraft {
  reasons: UninstallReason[];
  comment: string;
}

const EMPTY_DRAFT: FeedbackDraft = { reasons: [], comment: '' };

function useNoIndex(): void {
  useEffect(() => {
    if (document.head.querySelector('meta[name="robots"]')) return undefined;
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex, nofollow';
    document.head.appendChild(meta);
    return () => { meta.remove(); };
  }, []);
}

/**
 * Página pública aberta pela extensão ao ser desinstalada (`?i=<installationId>&e=&v=`).
 * Com `i` válido: registra a remoção uma vez e oferece uma pesquisa curta. Não exibe nenhum
 * dado da conta (nem nome, nem número) e não usa o login do painel.
 */
export function ExtensionRemovedPage() {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const [params] = useSearchParams();
  const rawId = params.get('i');
  const installationId = rawId && UUID_RE.test(rawId) ? rawId.toLowerCase() : null;
  const extensionId = safeParam(params.get('e'));
  const version = safeParam(params.get('v'));

  useNoIndex();

  useEffect(() => {
    const previous = document.title;
    document.title = `${t.pageTitle} · ${APP_NAME}`;
    return () => { document.title = previous; };
  }, []);

  return (
    <Box
      component="main"
      sx={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        bgcolor: 'background.default',
        color: 'text.primary',
        px: 2,
        pt: { xs: 9, sm: 10 },
        pb: { xs: 4, sm: 6 },
        backgroundImage: `radial-gradient(70% 45% at 50% 0%, ${alpha(theme.palette.primary.main, isDark ? 0.16 : 0.1)} 0%, transparent 100%)`,
      }}
    >
      <Box sx={{ position: 'fixed', top: 12, right: 12, zIndex: 10 }}>
        <ThemeModeSelector />
      </Box>

      <Box sx={{ width: '100%', maxWidth: 520 }}>
        <Box sx={{ display: 'flex', justifyContent: 'center', mb: 3 }}>
          <BrandLogo size={48} />
        </Box>

        <Card
          elevation={0}
          sx={{
            borderRadius: 4,
            p: { xs: 2.5, sm: 4 },
            bgcolor: alpha(theme.palette.background.paper, isDark ? 0.82 : 0.94),
            backdropFilter: 'blur(12px)',
            border: `1px solid ${alpha(isDark ? '#fff' : theme.palette.text.primary, isDark ? 0.1 : 0.08)}`,
            boxShadow: isDark
              ? `0 24px 48px ${alpha('#000', 0.45)}`
              : `0 24px 48px ${alpha(theme.palette.text.primary, 0.08)}`,
          }}
        >
          {installationId ? (
            <RemovalSurvey installationId={installationId} extensionId={extensionId} version={version} />
          ) : (
            <Header subtitle={t.subtitleNoSurvey} />
          )}

          <Box sx={{ display: 'flex', justifyContent: 'center', mt: 3 }}>
            <Tooltip title={t.reinstallTooltip} describeChild>
              <Button
                variant="outlined"
                onClick={openExtensionStore}
                startIcon={<AppIcon icon={RotateCcw} size="sm" />}
                endIcon={<AppIcon icon={ExternalLink} size="sm" />}
              >
                {t.reinstall}
              </Button>
            </Tooltip>
          </Box>
        </Card>

        <Typography sx={{ mt: 3, fontSize: '0.75rem', color: 'text.disabled', textAlign: 'center' }}>
          {t.footer(new Date().getFullYear(), APP_NAME)}
        </Typography>
      </Box>
    </Box>
  );
}

function Header({ subtitle }: { subtitle: string }) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  return (
    <Stack alignItems="center" textAlign="center" spacing={1.5}>
      <Box
        aria-hidden
        sx={{
          width: 56, height: 56, borderRadius: '50%', display: 'grid', placeItems: 'center',
          color: 'text.secondary', bgcolor: alpha(theme.palette.text.primary, isDark ? 0.1 : 0.06),
        }}
      >
        <AppIcon icon={PackageX} size="lg" />
      </Box>
      <Typography
        component="h1"
        sx={{ fontSize: { xs: '1.5rem', sm: '1.75rem' }, fontWeight: 800, lineHeight: 1.2, letterSpacing: -0.4 }}
      >
        {t.title}
      </Typography>
      <Typography color="text.secondary" sx={{ fontSize: '1rem', lineHeight: 1.55, maxWidth: 400 }}>
        {subtitle}
      </Typography>
    </Stack>
  );
}

interface SurveyProps {
  installationId: string;
  extensionId?: string;
  version?: string;
}

function RemovalSurvey({ installationId, extensionId, version }: SurveyProps) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  // Envio já feito sobrevive a reload (mesma aba): não reenvia, não reabre a pesquisa
  const [reported, setReported] = usePersistedState<boolean>(`extension.removed.reported.${installationId}`, false);
  const [sent, setSent] = usePersistedState<boolean>(`extension.removed.sent.${installationId}`, false);
  const [draft, setDraft, clearDraft] = usePersistedState<FeedbackDraft>('extension.removed.draft', EMPTY_DRAFT);
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);
  const reportStarted = useRef(false);

  useEffect(() => {
    if (reported || reportStarted.current) return;
    reportStarted.current = true;
    extensionApi.reportUninstall({ installationId, extensionId, version })
      .then(() => setReported(true))
      .catch(() => undefined);
  }, [reported, installationId, extensionId, version, setReported]);

  const toggleReason = (reason: UninstallReason) => {
    setFailed(false);
    setDraft((d) => ({
      ...d,
      reasons: d.reasons.includes(reason) ? d.reasons.filter((r) => r !== reason) : [...d.reasons, reason],
    }));
  };

  const canSend = draft.reasons.length > 0 && !sending;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSend) return;
    setSending(true);
    setFailed(false);
    try {
      const comment = draft.comment.trim();
      await extensionApi.sendUninstallFeedback({
        installationId,
        reasons: draft.reasons,
        ...(comment ? { comment: comment.slice(0, UNINSTALL_COMMENT_MAX) } : {}),
      });
      setSent(true);
      clearDraft();
    } catch {
      setFailed(true);
    } finally {
      setSending(false);
    }
  };

  if (sent) {
    return (
      <Stack alignItems="center" textAlign="center" spacing={1.5} role="status">
        <Box
          aria-hidden
          sx={{
            width: 56, height: 56, borderRadius: '50%', display: 'grid', placeItems: 'center',
            color: 'success.main', bgcolor: alpha(theme.palette.success.main, isDark ? 0.2 : 0.12),
          }}
        >
          <AppIcon icon={CircleCheck} size="lg" />
        </Box>
        <Typography component="h1" sx={{ fontSize: { xs: '1.5rem', sm: '1.75rem' }, fontWeight: 800, lineHeight: 1.2 }}>
          {t.thanksTitle}
        </Typography>
        <Typography color="text.secondary" sx={{ fontSize: '1rem', lineHeight: 1.55 }}>{t.thanksHint}</Typography>
      </Stack>
    );
  }

  return (
    <>
      <Header subtitle={t.subtitle} />
      <Box component="form" noValidate onSubmit={(e) => void handleSubmit(e)} sx={{ mt: 3.5 }}>
        <Box component="fieldset" sx={{ border: 0, m: 0, p: 0 }}>
          <Typography component="legend" sx={{ fontWeight: 700, fontSize: '0.9375rem', p: 0 }}>
            {t.reasonsLegend}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>{t.reasonsHint}</Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            {UNINSTALL_REASONS.map((reason) => {
              const selected = draft.reasons.includes(reason);
              return (
                <Chip
                  key={reason}
                  component="button"
                  type="button"
                  aria-pressed={selected}
                  clickable
                  label={t.reasons[reason]}
                  color={selected ? 'primary' : 'default'}
                  variant={selected ? 'filled' : 'outlined'}
                  icon={selected ? <AppIcon icon={Check} size="sm" /> : undefined}
                  onClick={() => toggleReason(reason)}
                  sx={{ fontWeight: 500, height: 36, borderRadius: 999, fontSize: '0.875rem' }}
                />
              );
            })}
          </Box>
        </Box>

        <TextField
          label={t.commentLabel}
          value={draft.comment}
          onChange={(e) => setDraft((d) => ({ ...d, comment: e.target.value.slice(0, UNINSTALL_COMMENT_MAX) }))}
          multiline
          minRows={3}
          maxRows={8}
          fullWidth
          inputProps={{ maxLength: UNINSTALL_COMMENT_MAX }}
          helperText={(
            <Box component="span" sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}>
              <span>{t.commentPrivacy}</span>
              <Box component="span" sx={{ flexShrink: 0, fontVariantNumeric: 'tabular-nums' }} aria-live="polite">
                {t.commentCounter(draft.comment.length, UNINSTALL_COMMENT_MAX)}
              </Box>
            </Box>
          )}
          FormHelperTextProps={{ component: 'div' } as object}
          sx={{ mt: 3 }}
        />

        {failed && <Alert severity="error" sx={{ mt: 2 }}>{t.submitFailed}</Alert>}

        <Button
              type="submit"
              variant="contained"
              size="large"
              fullWidth
              disableElevation
              disabled={!canSend}
              startIcon={sending ? <CircularProgress size={16} color="inherit" /> : <AppIcon icon={Send} size="sm" />}
              sx={{ mt: 2.5, py: 1.3, fontWeight: 700 }}
            >
              {sending ? t.submitting : t.submit}
            </Button>
        {draft.reasons.length === 0 && (
          <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1, textAlign: 'center' }}>
            {t.submitNeedsReason}
          </Typography>
        )}
      </Box>
    </>
  );
}
