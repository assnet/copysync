import { useState } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, Divider, FormControlLabel, IconButton, MenuItem, Stack, Switch, TextField, Tooltip, Typography,
} from '@mui/material';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import RefreshIcon from '@mui/icons-material/Refresh';
import SendOutlinedIcon from '@mui/icons-material/SendOutlined';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CheckIcon from '@mui/icons-material/Check';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { SectionCard } from '@/components';
import type { OfferAudience, OfferConfigGroup, OfferItem } from '@/types/api.types';
import { offerStrings } from '../strings';
import { OFFER_AUDIENCES } from '../utils/offerConfig';
import type { OfferDraft } from '../hooks/useOfferDraft';
import { OfferChatPreview } from './OfferChatPreview';
import { OfferEditor } from './OfferEditor';

const t = offerStrings.actions;
const MAX_CHIPS = 6;

interface Props {
  offer: OfferItem;
  draft: OfferDraft;
  onField: <K extends keyof OfferDraft>(key: K, value: OfferDraft[K]) => void;
  dirty: boolean;
  textTooLong: boolean;
  missingLink: boolean;
  needsManualData: boolean;
  aiFallback: boolean;
  groups: OfferConfigGroup[];
  saving: boolean;
  regenerating: boolean;
  mentionSaving: boolean;
  /** Plano recusou "marcar todos": mostra o aviso de upgrade sob a chave. */
  mentionUnavailable: boolean;
  sending: boolean;
  imageProgress: number | null;
  /** Bloqueia o disparo (sessão desconectada, sem grupos…). */
  sendBlocked: boolean;
  onSave: () => Promise<void>;
  onDiscard: () => void;
  onRegenerate: (audience: OfferAudience) => void;
  onMentionAll: (value: boolean) => void;
  onReplaceImage: (file: File) => void;
  onSend: () => void;
}

/** Prévia + ações da oferta gerada: editar, gerar novamente, marcar todos e disparar. */
export function OfferResultPanel(props: Props) {
  const {
    offer, draft, dirty, textTooLong, missingLink, needsManualData, aiFallback, groups, saving, regenerating,
    mentionSaving, mentionUnavailable, sending, imageProgress, sendBlocked,
  } = props;
  // Sem dados da loja o operador precisa preencher: já abre editando.
  const [editing, setEditing] = useState(needsManualData);
  const [audience, setAudience] = useState<OfferAudience>(offer.audience);
  const [copied, setCopied] = useState(false);
  const isDraft = offer.status === 'DRAFT';
  const busy = saving || regenerating || sending || imageProgress != null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(draft.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Sem permissão de área de transferência: o texto continua visível.
    }
  };

  const shown = groups.slice(0, MAX_CHIPS);
  const rest = groups.length - shown.length;
  const untitled = offerStrings.wizard.groups.untitled;

  return (
    <SectionCard
      title={offerStrings.preview.title}
      action={
        <Stack direction="row" spacing={0.5}>
          <Tooltip title={copied ? offerStrings.preview.textCopied : offerStrings.preview.copyText}>
            <IconButton size="small" aria-label={offerStrings.preview.copyText} onClick={() => void copy()}>
              {copied ? <CheckIcon fontSize="small" color="success" /> : <ContentCopyIcon fontSize="small" />}
            </IconButton>
          </Tooltip>
          <Tooltip title={offerStrings.preview.openLink}>
            <IconButton
              size="small"
              aria-label={offerStrings.preview.openLink}
              component="a"
              href={offer.affiliateUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              <OpenInNewIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>
      }
    >
      <Stack spacing={2}>
        {aiFallback && <Alert severity="info">{offerStrings.preview.aiFallback}</Alert>}
        {!offer.attributionVerified && offer.provider !== 'SHOPEE' && (
          <Alert severity="warning">{offerStrings.editor.attributionUnverified}</Alert>
        )}

        <Box sx={{ opacity: regenerating ? 0.5 : 1, transition: 'opacity 150ms ease' }} aria-busy={regenerating}>
          <OfferChatPreview
            groupTitle={groups[0]?.title ?? null}
            groupCount={groups.length}
            imageUrl={offer.imageUrl}
            title={draft.title}
            text={draft.text}
            at={offer.updatedAt}
          />
        </Box>

        <Chip
          size="small"
          variant="outlined"
          label={offerStrings.preview.audience(offerStrings.audiences[offer.audience].label)}
          sx={{ alignSelf: 'flex-start' }}
        />

        {!isDraft && <Alert severity="info">{offerStrings.editor.locked}</Alert>}

        {isDraft && editing ? (
          <OfferEditor
            offer={offer}
            draft={draft}
            onField={props.onField}
            needsManualData={needsManualData}
            dirty={dirty}
            saving={saving}
            textTooLong={textTooLong}
            imageProgress={imageProgress}
            onSave={() => { props.onSave().then(() => setEditing(false), () => undefined); }}
            onCancel={() => { props.onDiscard(); setEditing(false); }}
            onReplaceImage={props.onReplaceImage}
          />
        ) : isDraft ? (
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
            <Tooltip title={t.editTooltip} arrow>
              <span>
                <Button variant="outlined" startIcon={<EditOutlinedIcon />} onClick={() => setEditing(true)} disabled={busy} sx={{ height: 40 }}>
                  {t.edit}
                </Button>
              </span>
            </Tooltip>
            <Box sx={{ display: 'flex', gap: 1, flex: '1 1 260px' }}>
              <TextField
                select
                size="small"
                label={t.regenerateAudience}
                value={audience}
                disabled={busy}
                onChange={(e) => setAudience(e.target.value as OfferAudience)}
                sx={{ flex: 1, minWidth: 140 }}
              >
                {OFFER_AUDIENCES.map((key) => (
                  <MenuItem key={key} value={key}>
                    <Box component="span" aria-hidden sx={{ mr: 1 }}>{offerStrings.audiences[key].emoji}</Box>
                    {offerStrings.audiences[key].label}
                  </MenuItem>
                ))}
              </TextField>
              <Tooltip title={t.regenerateTooltip} arrow>
                <span>
                  <Button
                    variant="outlined"
                    startIcon={regenerating ? <CircularProgress size={16} color="inherit" /> : <RefreshIcon />}
                    onClick={() => props.onRegenerate(audience)}
                    disabled={busy}
                    sx={{ whiteSpace: 'nowrap', height: 40 }}
                  >
                    {regenerating ? t.regenerating : t.regenerate}
                  </Button>
                </span>
              </Tooltip>
            </Box>
          </Box>
        ) : null}

        {isDraft && !editing && missingLink && <Alert severity="warning">{offerStrings.editor.missingLink}</Alert>}

        {isDraft && (
          <>
            <Divider />
            <Box>
              <FormControlLabel
                control={
                  <Switch
                    checked={offer.mentionAll}
                    disabled={mentionSaving || busy}
                    onChange={(e) => props.onMentionAll(e.target.checked)}
                  />
                }
                label={t.mentionAll}
              />
              <Typography variant="caption" color={mentionUnavailable ? 'warning.main' : 'text.secondary'} component="p" sx={{ ml: 6, mt: -0.5 }}>
                {mentionUnavailable ? t.mentionAllUnavailable : t.mentionAllHelper}
              </Typography>
            </Box>

            <Box>
              <Typography variant="caption" color="text.secondary" component="p" sx={{ mb: 0.75 }}>{t.destinations}</Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
                {shown.map((g) => <Chip key={g.conversationId} size="small" label={g.title || untitled} sx={{ maxWidth: 220 }} />)}
                {rest > 0 && (
                  <Tooltip title={groups.slice(MAX_CHIPS).map((g) => g.title || untitled).join(', ')} arrow>
                    <Chip size="small" variant="outlined" label={t.moreGroups(rest)} tabIndex={0} />
                  </Tooltip>
                )}
              </Box>
            </Box>

            <Button
              variant="contained"
              size="large"
              disableElevation
              fullWidth
              startIcon={sending ? <CircularProgress size={18} color="inherit" /> : <SendOutlinedIcon />}
              disabled={sendBlocked || busy || textTooLong || editing}
              onClick={props.onSend}
            >
              {sending
                ? offerStrings.send.sending
                : groups.length === 1 ? offerStrings.send.buttonSingle : offerStrings.send.button(groups.length)}
            </Button>
          </>
        )}
      </Stack>
    </SectionCard>
  );
}
