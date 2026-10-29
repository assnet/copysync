import { useId, useMemo, useState, type FormEvent } from 'react';
import {
  Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, FormHelperText,
  InputAdornment, MenuItem, Radio, RadioGroup, Stack, Switch, TextField, Tooltip, Typography, alpha,
} from '@mui/material';
import { Globe, Info, Link2, Smartphone, Sparkles } from 'lucide-react';
import { AppIcon } from '@/components';
import { Blurred, useBlur } from '@/features/privacy';
import { SessionStatusChip } from '@/features/sessions/components/SessionStatusChip';
import { usePersistedState } from '@/hooks/usePersistedState';
import { linkRotationService } from '@/services/linkRotation.service';
import { linkRotationError } from '@/utils/linkRotationErrors';
import { linkRotationStrings } from '../strings';
import { finalizeSlug, normalizeSlugInput, previewUrl, slugProblem } from '../slug';
import {
  ROTATION_RANGES, ROTATION_STRATEGIES,
  type Rotation, type RotationOverview, type RotationStrategy, type UpdateRotationInput,
} from '../types';
import { ConfirmRenameDialog } from './ConfirmRenameDialog';

const t = linkRotationStrings.config;
const ts = linkRotationStrings.strategy;
const tc = linkRotationStrings.card;
const SLUG = ROTATION_RANGES.slug;
const SLUG_ERRORS = ['LINK_SLUG_TAKEN', 'LINK_SLUG_RESERVED', 'LINK_SLUG_INVALID'];

export interface RotationConfigDialogProps {
  /** Diálogo visível. */
  open: boolean;
  /** Fechar sem salvar (cancelar, ESC). O diálogo limpa o próprio rascunho antes de chamar. */
  onClose: () => void;
  /** Rodízio a editar; ausente = criação. */
  rotation?: Rotation;
  /** Overview atual: domínios ativos, sessões e limites do plano (para selects e regras). */
  overview: RotationOverview;
  /** Chamado com o rodízio devolvido pela API após criar/editar/renomear. */
  onSaved: (rotation: Rotation) => void;
  /** `PLAN_LIMIT_REACHED`: a página troca o diálogo pelo aviso de upgrade. O rascunho fica salvo. */
  onPlanLimit?: (kind: 'rotations' | 'groups', limit: number) => void;
}

/** Rascunho persistido na aba (estado de interface; o rodízio em si vem da API pelo id). */
interface Draft {
  sessionId: string;
  domainId: string;
  slug: string;
  strategy: RotationStrategy;
  title: string;
  active: boolean;
}

/** Erro da API: no campo do nome (com sugestões) ou no topo do formulário. */
interface ServerError {
  field: 'slug' | 'form';
  message: string;
  suggestions: string[];
}

function initialDraft(overview: RotationOverview, rotation?: Rotation): Draft {
  if (rotation) {
    return {
      sessionId: rotation.sessionId,
      domainId: rotation.domainId,
      slug: rotation.slug,
      strategy: rotation.strategy,
      title: rotation.title ?? '',
      active: rotation.status === 'ACTIVE',
    };
  }
  const session = overview.sessions.find((s) => s.status === 'CONNECTED') ?? overview.sessions[0];
  return { sessionId: session?.id ?? '', domainId: overview.domains[0]?.id ?? '', slug: '', strategy: 'BALANCED', title: '', active: true };
}

/**
 * Configuração do rodízio (sessão, domínio, nome com prévia, estratégia, apelido).
 * Criação: `create`. Edição: `rename` (só se nome ou domínio mudou, após `ConfirmRenameDialog`)
 * e depois `update` só com o que mudou (status, estratégia, apelido, sessão).
 */
export function RotationConfigDialog({ open, onClose, rotation, overview, onSaved, onPlanLimit }: RotationConfigDialogProps) {
  const uid = useId();
  const ids = {
    title: `${uid}-title`, slugHelp: `${uid}-slug-help`, slugError: `${uid}-slug-error`,
    suggestions: `${uid}-suggestions`, strategy: `${uid}-strategy`,
  };
  const blurLink = useBlur('linkRotation.rotationLink');
  const blurSession = useBlur('linkRotation.sessionName');

  const [draft, setDraft, clearDraft] = usePersistedState<Draft>(
    `linkRotation.config.${rotation?.id ?? 'new'}`,
    () => initialDraft(overview, rotation),
    { scope: 'tab' },
  );
  // Versão do rodízio que já está salva (muda após um rename quando o update seguinte falha)
  const [baseline, setBaseline] = useState<Rotation | undefined>(rotation);
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmRename, setConfirmRename] = useState(false);
  const [serverError, setServerError] = useState<ServerError | null>(null);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    if (key === 'slug' || key === 'domainId') setServerError(null);
  };

  // Domínio atual pode ter saído da lista de ativos: continua no select para não sumir
  const domains = useMemo(() => {
    const list = [...overview.domains];
    if (baseline && !list.some((d) => d.id === baseline.domainId)) list.unshift({ id: baseline.domainId, hostname: baseline.hostname });
    return list;
  }, [overview.domains, baseline]);
  const sessionId = overview.sessions.some((s) => s.id === draft.sessionId) ? draft.sessionId : (overview.sessions[0]?.id ?? '');
  const domainId = domains.some((d) => d.id === draft.domainId) ? draft.domainId : (domains[0]?.id ?? '');
  const hostname = domains.find((d) => d.id === domainId)?.hostname ?? '';
  const session = overview.sessions.find((s) => s.id === sessionId) ?? null;

  const slug = finalizeSlug(draft.slug);
  const problem = slugProblem(slug);
  const localSlugError = submitted && problem ? (problem === 'required' ? t.slugRequired : t.slugTooShort(SLUG.min)) : null;
  const slugError = localSlugError ?? (serverError?.field === 'slug' ? serverError.message : null);
  const suggestions = serverError?.field === 'slug' ? serverError.suggestions : [];

  const renaming = baseline !== undefined && (slug !== baseline.slug || domainId !== baseline.domainId);
  const lostGroups = baseline !== undefined && sessionId !== baseline.sessionId ? baseline.groups.length : 0;
  const pausedByPlan = baseline?.status === 'PAUSED_BY_PLAN';

  const finish = (saved: Rotation) => {
    clearDraft();
    onSaved(saved);
  };

  const cancel = () => {
    if (saving) return;
    clearDraft();
    // Nome já trocado e o resto falhou: a página precisa do rodízio atualizado
    if (baseline && baseline !== rotation) onSaved(baseline);
    else onClose();
  };

  const fail = (err: unknown) => {
    const info = linkRotationError(err);
    if (info.code === 'PLAN_LIMIT_REACHED' && info.limitKind && info.limit !== null && onPlanLimit) {
      onPlanLimit(info.limitKind, info.limit);
      return;
    }
    const field = info.code && SLUG_ERRORS.includes(info.code) ? 'slug' : 'form';
    setServerError({ field, message: info.message, suggestions: info.suggestions });
  };

  const patchFor = (base: Rotation): UpdateRotationInput => {
    const patch: UpdateRotationInput = {};
    const title = draft.title.trim();
    if (draft.strategy !== base.strategy) patch.strategy = draft.strategy;
    if (title !== (base.title ?? '')) patch.title = title;
    if (sessionId !== base.sessionId) patch.sessionId = sessionId;
    if (base.status !== 'PAUSED_BY_PLAN' && draft.active !== (base.status === 'ACTIVE')) patch.status = draft.active ? 'ACTIVE' : 'PAUSED';
    return patch;
  };

  const save = async (withRename: boolean) => {
    setSaving(true);
    setServerError(null);
    try {
      if (!baseline) {
        const title = draft.title.trim();
        finish(await linkRotationService.create({ sessionId, domainId, slug, strategy: draft.strategy, ...(title ? { title } : {}) }));
        return;
      }
      let current = baseline;
      if (withRename) {
        current = await linkRotationService.rename(baseline.id, { slug, ...(domainId !== baseline.domainId ? { domainId } : {}) });
        setBaseline(current);
        setConfirmRename(false);
      }
      const patch = patchFor(current);
      if (Object.keys(patch).length === 0) {
        finish(current);
        return;
      }
      try {
        finish(await linkRotationService.update(current.id, patch));
      } catch (err) {
        if (withRename) setServerError({ field: 'form', message: t.partialSaved, suggestions: [] });
        else fail(err);
      }
    } catch (err) {
      setConfirmRename(false);
      fail(err);
    } finally {
      setSaving(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (problem || !sessionId || !domainId) return;
    if (slug !== draft.slug) set('slug', slug);
    if (renaming) setConfirmRename(true);
    else void save(false);
  };

  const describedBy = [ids.slugHelp, slugError && ids.slugError, suggestions.length > 0 && ids.suggestions].filter(Boolean).join(' ');
  const counter = (n: number, max: number) => (
    <InputAdornment position="end">
      <Typography variant="caption" color={n >= max ? 'warning.main' : 'text.secondary'}>{t.slugCounter(n, max)}</Typography>
    </InputAdornment>
  );

  return (
    <>
      <Dialog
        open={open}
        // Clique fora não descarta o rascunho; ESC e Cancelar sim
        onClose={(_, reason) => reason !== 'backdropClick' && cancel()}
        fullWidth
        maxWidth="sm"
        aria-labelledby={ids.title}
      >
        <Box component="form" noValidate onSubmit={submit}>
          <DialogTitle id={ids.title} sx={{ fontWeight: 700 }}>{baseline ? t.editTitle : t.createTitle}</DialogTitle>
          <DialogContent>
            <Stack spacing={3} sx={{ pt: 0.5 }}>
              {serverError?.field === 'form' && <Alert severity="error" role="alert">{serverError.message}</Alert>}

              {/* Nome + domínio + prévia */}
              <Box>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems="flex-start">
                  <TextField
                    autoFocus
                    fullWidth
                    required
                    label={t.slug}
                    placeholder={t.slugPlaceholder}
                    value={draft.slug}
                    onChange={(e) => set('slug', normalizeSlugInput(e.target.value))}
                    onBlur={() => slug !== draft.slug && set('slug', slug)}
                    error={Boolean(slugError)}
                    inputProps={{
                      maxLength: SLUG.max, autoCapitalize: 'none', autoCorrect: 'off', spellCheck: false,
                      'aria-describedby': describedBy, 'aria-invalid': Boolean(slugError),
                    }}
                    InputProps={{
                      startAdornment: <InputAdornment position="start"><AppIcon icon={Link2} size="sm" /></InputAdornment>,
                      endAdornment: counter(draft.slug.length, SLUG.max),
                    }}
                    sx={{ flex: 3 }}
                  />
                  <TextField
                    select
                    label={t.domain}
                    value={domainId}
                    onChange={(e) => set('domainId', e.target.value)}
                    disabled={domains.length <= 1}
                    helperText={t.domainHelp}
                    InputProps={{ startAdornment: <InputAdornment position="start"><AppIcon icon={Globe} size="sm" /></InputAdornment> }}
                    sx={{ flex: 2, width: { xs: '100%', sm: 'auto' }, minWidth: 0 }}
                  >
                    {domains.map((d) => <MenuItem key={d.id} value={d.id}>{d.hostname}</MenuItem>)}
                  </TextField>
                </Stack>
                {slugError && (
                  <FormHelperText id={ids.slugError} error role="alert" sx={{ mx: 1.75 }}>{slugError}</FormHelperText>
                )}
                <Stack direction="row" spacing={0.5} alignItems="center" sx={{ mx: 1.75, mt: 0.5 }}>
                  <FormHelperText id={ids.slugHelp} sx={{ m: 0 }}>{t.slugHelp}</FormHelperText>
                  <Tooltip title={t.slugRulesTooltip} arrow>
                    <Box component="span" tabIndex={0} aria-label={t.slugRulesTooltip} sx={{ display: 'inline-flex', color: 'text.secondary', cursor: 'help' }}>
                      <AppIcon icon={Info} size="sm" />
                    </Box>
                  </Tooltip>
                </Stack>

                {suggestions.length > 0 && (
                  <Box id={ids.suggestions} sx={{ mt: 1.5 }}>
                    <Typography variant="body2" sx={{ mb: 1 }}>{t.suggestions}</Typography>
                    <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" component="ul" sx={{ listStyle: 'none', p: 0, m: 0 }}>
                      {suggestions.map((s) => (
                        <Box component="li" key={s}>
                          <Tooltip title={t.suggestionUse(s)} arrow>
                            <Chip
                              label={s}
                              clickable
                              color="primary"
                              variant="outlined"
                              icon={<AppIcon icon={Sparkles} size="sm" />}
                              aria-label={t.suggestionUse(s)}
                              onClick={() => set('slug', s)}
                            />
                          </Tooltip>
                        </Box>
                      ))}
                    </Stack>
                  </Box>
                )}

                <Box
                  sx={(theme) => ({
                    mt: 2, px: 2, py: 1.5, borderRadius: 2,
                    border: `1px dashed ${alpha(theme.palette.primary.main, 0.45)}`,
                    bgcolor: alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.12 : 0.06),
                  })}
                >
                  <Typography variant="caption" color="text.secondary" component="p">{t.preview}</Typography>
                  <Typography data-testid="rotation-link-preview" variant="body1" aria-live="polite" sx={{ fontFamily: 'monospace', fontWeight: 600, wordBreak: 'break-all' }}>
                    <Blurred when={blurLink} inline radius={5}>{previewUrl(draft.slug || t.previewPlaceholder, hostname)}</Blurred>
                  </Typography>
                </Box>
              </Box>

              {/* Sessão */}
              <Box>
                <TextField
                  select
                  fullWidth
                  required
                  label={t.session}
                  value={sessionId}
                  onChange={(e) => set('sessionId', e.target.value)}
                  helperText={t.sessionHelp}
                  InputProps={{ startAdornment: <InputAdornment position="start"><AppIcon icon={Smartphone} size="sm" /></InputAdornment> }}
                  SelectProps={{
                    renderValue: () => <Blurred when={blurSession} inline radius={5}>{session?.name || t.sessionUntitled}</Blurred>,
                  }}
                >
                  {overview.sessions.map((s) => (
                    <MenuItem key={s.id} value={s.id} sx={{ justifyContent: 'space-between', gap: 2 }}>
                      <Blurred when={blurSession} inline radius={5}>{s.name || t.sessionUntitled}</Blurred>
                      <Tooltip title={t.sessionStatusTooltip} arrow placement="left">
                        <span><SessionStatusChip status={s.status} /></span>
                      </Tooltip>
                    </MenuItem>
                  ))}
                </TextField>
                {session && session.status !== 'CONNECTED' && (
                  <Alert severity="info" sx={{ mt: 1.5 }}>{t.sessionDisconnected}</Alert>
                )}
                {lostGroups > 0 && (
                  <Alert severity="warning" role="alert" sx={{ mt: 1.5 }}>{t.sessionChangeWarning(lostGroups)}</Alert>
                )}
              </Box>

              {/* Estratégia */}
              <Box component="fieldset" sx={{ border: 0, p: 0, m: 0, minWidth: 0 }}>
                <Typography component="legend" id={ids.strategy} variant="subtitle2" sx={{ mb: 1 }}>{t.strategy}</Typography>
                <RadioGroup
                  aria-labelledby={ids.strategy}
                  value={draft.strategy}
                  onChange={(e) => set('strategy', e.target.value as RotationStrategy)}
                  sx={{ display: 'grid', gap: 1.25, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' } }}
                >
                  {ROTATION_STRATEGIES.map((s) => {
                    const checked = draft.strategy === s;
                    const descId = `${uid}-strategy-${s}`;
                    return (
                      <Box
                        key={s}
                        component="label"
                        sx={(theme) => ({
                          display: 'flex', gap: 1, alignItems: 'flex-start', p: 1.5, pr: 2, borderRadius: 2, cursor: 'pointer',
                          border: `1px solid ${checked ? theme.palette.primary.main : theme.palette.divider}`,
                          bgcolor: checked ? alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.14 : 0.06) : 'transparent',
                          transition: theme.transitions.create(['border-color', 'background-color'], { duration: theme.transitions.duration.shorter }),
                          '&:hover': { borderColor: theme.palette.primary.main },
                          '&:focus-within': { outline: `2px solid ${alpha(theme.palette.primary.main, 0.5)}`, outlineOffset: 2 },
                        })}
                      >
                        <Radio value={s} size="small" sx={{ p: 0.25 }} inputProps={{ 'aria-describedby': descId }} />
                        <Box>
                          <Typography variant="body2" fontWeight={600}>{ts.label[s]}</Typography>
                          <Typography id={descId} variant="caption" color="text.secondary" component="p">{ts.description[s]}</Typography>
                        </Box>
                      </Box>
                    );
                  })}
                </RadioGroup>
              </Box>

              {/* Apelido */}
              <TextField
                fullWidth
                label={t.title}
                placeholder={t.titlePlaceholder}
                value={draft.title}
                onChange={(e) => set('title', e.target.value.slice(0, ROTATION_RANGES.titleMax))}
                helperText={t.titleHelp}
                inputProps={{ maxLength: ROTATION_RANGES.titleMax }}
                InputProps={{ endAdornment: counter(draft.title.length, ROTATION_RANGES.titleMax) }}
              />

              {/* Status: só na edição; pausado pelo plano não se liga daqui */}
              {baseline && (
                <Tooltip title={pausedByPlan ? tc.pausedByPlanTooltip : draft.active ? tc.statusOnTooltip : tc.statusOffTooltip} arrow placement="top-start">
                  <FormControlLabel
                    sx={{ alignSelf: 'flex-start', ml: 0 }}
                    control={<Switch checked={!pausedByPlan && draft.active} disabled={pausedByPlan} onChange={(e) => set('active', e.target.checked)} />}
                    label={t.statusLabel}
                  />
                </Tooltip>
              )}
            </Stack>
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 2.5 }}>
            <Button onClick={cancel} color="inherit" disabled={saving}>{t.cancel}</Button>
            <Button type="submit" variant="contained" disableElevation disabled={saving || !sessionId || !domainId}>
              {saving && !confirmRename ? t.saving : baseline ? t.save : t.create}
            </Button>
          </DialogActions>
        </Box>
      </Dialog>

      {baseline && (
        <ConfirmRenameDialog
          open={confirmRename}
          oldUrl={baseline.publicUrl}
          newUrl={previewUrl(slug, hostname)}
          busy={saving}
          onConfirm={() => void save(true)}
          onClose={() => setConfirmRename(false)}
        />
      )}
    </>
  );
}
