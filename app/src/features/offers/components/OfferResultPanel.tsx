import { useEffect, useState } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, IconButton, MenuItem, Stack, TextField, Tooltip,
} from '@mui/material';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import RefreshIcon from '@mui/icons-material/Refresh';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CheckIcon from '@mui/icons-material/Check';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import AddIcon from '@mui/icons-material/Add';
import { AppIcon, SectionCard } from '@/components';
import type { OfferAudience, OfferConfigGroup, OfferItem } from '@/types/api.types';
import { offerStrings } from '../strings';
import { AUDIENCE_ICONS, OFFER_AUDIENCES } from '../utils/offerConfig';
import type { OfferDraft } from '../hooks/useOfferDraft';
import { OfferChatPreview } from './OfferChatPreview';
import { OfferEditor } from './OfferEditor';
import { Blurred, useBlur } from '@/features/privacy';

const t = offerStrings.actions;

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
  sending: boolean;
  imageProgress: number | null;
  onSave: () => Promise<void>;
  onDiscard: () => void;
  onRegenerate: (audience: OfferAudience) => void;
  onReplaceImage: (file: File) => void;
  /** Editor aberto: o card de envio segura o disparo enquanto isso. */
  onEditingChange?: (editing: boolean) => void;
  /** "+ Novo": reabre o card de geração. */
  onNew: () => void;
  /** Motivo de "+ Novo" bloqueado (envio em andamento); null = liberado. */
  newLockedReason: string | null;
}

/** Prévia da oferta gerada: editar, gerar novamente e "+ Novo". Opções e disparo ficam no card de envio. */
export function OfferResultPanel(props: Props) {
  const {
    offer, draft, dirty, textTooLong, missingLink, needsManualData, aiFallback, groups, saving, regenerating,
    sending, imageProgress, onEditingChange, newLockedReason,
  } = props;
  // Sem dados da loja o operador precisa preencher: já abre editando.
  const [editing, setEditing] = useState(needsManualData);
  useEffect(() => { onEditingChange?.(editing); }, [editing, onEditingChange]);
  const [audience, setAudience] = useState<OfferAudience>(offer.audience);
  const blurAudience = useBlur('offers.audience');
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

  return (
    <SectionCard
      title={offerStrings.preview.title}
      action={
        <Stack direction="row" spacing={0.5} alignItems="center">
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
          <Tooltip title={newLockedReason ?? offerStrings.page.newOfferTooltip} arrow>
            <span>
              <Button
                size="small"
                variant="outlined"
                startIcon={<AddIcon />}
                disabled={newLockedReason != null}
                onClick={props.onNew}
                sx={{ ml: 0.5 }}
              >
                {offerStrings.page.newOfferShort}
              </Button>
            </span>
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
          label={<Blurred when={blurAudience} inline radius={5}>{offerStrings.preview.audience(offerStrings.audiences[offer.audience].label)}</Blurred>}
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
                sx={{ flex: 1, minWidth: 140, ...(blurAudience && { '& .MuiSelect-select': { filter: 'blur(5px)' } }) }}
              >
                {OFFER_AUDIENCES.map((key) => (
                  <MenuItem key={key} value={key} sx={{ gap: 1 }}>
                    <AppIcon icon={AUDIENCE_ICONS[key]} />
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

      </Stack>
    </SectionCard>
  );
}
