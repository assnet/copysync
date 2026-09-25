/**
 * Prévia do lote de anexos (design §14): item atual grande, legenda por item, miniaturas com
 * remover e "+", enviar com contagem. Cobre a área de mensagens: o pai precisa de
 * `position: relative`.
 *
 * Memória: só o item atual ganha `blob:` do arquivo inteiro (e `<video>` só para ele); as
 * miniaturas são imagens de 96 px geradas uma por vez — 30 fotos decodificadas custariam GBs.
 */
import { useEffect, useId, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import {
  Badge,
  Box,
  ButtonBase,
  IconButton,
  TextField,
  Tooltip,
  Typography,
  Unstable_TrapFocus as FocusTrap,
} from '@mui/material';
import { alpha, keyframes } from '@mui/material/styles';
import AddIcon from '@mui/icons-material/Add';
import CloseIcon from '@mui/icons-material/Close';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import InsertDriveFileOutlinedIcon from '@mui/icons-material/InsertDriveFileOutlined';
import SendIcon from '@mui/icons-material/Send';
import VideocamOutlinedIcon from '@mui/icons-material/VideocamOutlined';
import type { MediaUploadConfigDto } from '@/types/media.api.types';
import {
  classifyAttachment,
  formatBytesLabel,
  validateBatch,
  type AttachmentClassification,
  type AttachmentOrigin,
} from '../media/mediaPolicy';
import { chatStrings } from '../strings';

const texts = chatStrings.attachments;

/** Lado da miniatura gerada (px); exibida a 64 px, fica nítida em tela 1,5x. */
const THUMBNAIL_PX = 96;
/** Mesmo filtro do menu "Fotos e vídeos"; documento e arrastar/colar aceitam qualquer arquivo. */
const ACCEPT_BY_ORIGIN: Record<AttachmentOrigin, string | undefined> = {
  media: 'image/*,video/*',
  document: undefined,
  auto: undefined,
};

export interface AttachmentSendItem {
  file: File;
  caption: string;
  classification: AttachmentClassification;
}

export interface AttachmentPreviewPanelProps {
  /** Arquivos do lote. Arquivos novos que chegarem depois (ex.: soltar com a prévia aberta) entram no fim. */
  files: File[];
  origin: AttachmentOrigin;
  config: MediaUploadConfigDto;
  /** Lote na ordem das miniaturas. O pai fecha a prévia. */
  onSend: (items: AttachmentSendItem[]) => void;
  onClose: () => void;
  /** Aviso de arquivos escolhidos no "+"; a prévia já os acrescenta ao lote. */
  onAddMore?: (files: File[]) => void;
  /** Texto que já estava no campo: vira a legenda do 1º item. */
  initialCaption?: string;
}

interface DraftItem {
  id: number;
  file: File;
  origin: AttachmentOrigin;
}

interface ClassifiedItem extends DraftItem {
  classification: AttachmentClassification;
}

let itemSequence = 0;
const toDraft = (file: File, origin: AttachmentOrigin): DraftItem => ({ id: ++itemSequence, file, origin });

function extensionLabel(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot > 0 && dot < fileName.length - 1 ? fileName.slice(dot + 1).toUpperCase() : texts.document;
}

function noticeFor(classification: AttachmentClassification): { text: string; severity: 'error' | 'info' } | null {
  if (classification.blocked === 'empty') return { text: texts.emptyFile, severity: 'error' };
  if (classification.blocked === 'too_large') {
    return { text: texts.fileTooLarge(formatBytesLabel(classification.limitBytes)), severity: 'error' };
  }
  if (classification.convertedToDocument) return { text: texts.sentAsDocument, severity: 'info' };
  return null;
}

/** Recorte central quadrado em canvas de 96 px. `null` quando o navegador não consegue. */
async function renderThumbnail(file: Blob, signal: AbortSignal): Promise<Blob | null> {
  const bitmap = await createImageBitmap(file);
  try {
    if (signal.aborted) return null;
    const canvas = document.createElement('canvas');
    canvas.width = THUMBNAIL_PX;
    canvas.height = THUMBNAIL_PX;
    const context = canvas.getContext('2d');
    if (!context) return null;
    const side = Math.min(bitmap.width, bitmap.height);
    const sx = (bitmap.width - side) / 2;
    const sy = (bitmap.height - side) / 2;
    context.drawImage(bitmap, sx, sy, side, side, 0, 0, THUMBNAIL_PX, THUMBNAIL_PX);
    return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve));
  } finally {
    bitmap.close();
  }
}

/** Miniaturas geradas em sequência; revoga as de itens removidos e todas ao desmontar. */
function useImageThumbnails(files: readonly File[]): ReadonlyMap<File, string> {
  const [thumbnails, setThumbnails] = useState<ReadonlyMap<File, string>>(() => new Map());
  const urlsRef = useRef(new Map<File, string>());
  const doneRef = useRef(new Set<File>());

  useEffect(() => {
    const urls = urlsRef.current;
    for (const [file, url] of urls) {
      if (!files.includes(file)) {
        URL.revokeObjectURL(url);
        urls.delete(file);
      }
    }
    const queue = files.filter((file) => !doneRef.current.has(file));
    if (queue.length === 0 || typeof createImageBitmap !== 'function') return;

    const controller = new AbortController();
    void (async () => {
      for (const file of queue) {
        const blob = await renderThumbnail(file, controller.signal).catch(() => null);
        if (controller.signal.aborted) return;
        doneRef.current.add(file);
        if (!blob) continue;
        const url = URL.createObjectURL(blob);
        urls.set(file, url);
        setThumbnails((previous) => new Map(previous).set(file, url));
      }
    })();
    return () => controller.abort();
  }, [files]);

  useEffect(() => {
    const urls = urlsRef.current;
    return () => {
      urls.forEach((url) => URL.revokeObjectURL(url));
      urls.clear();
    };
  }, []);

  return thumbnails;
}

/** `blob:` do arquivo inteiro, só enquanto ele é o item atual. */
function useObjectUrl(file: File | null): string | null {
  const [entry, setEntry] = useState<{ file: File; url: string } | null>(null);
  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setEntry({ file, url });
    return () => URL.revokeObjectURL(url);
  }, [file]);
  return entry && entry.file === file ? entry.url : null;
}

const fadeIn = keyframes`
  from { opacity: 0; transform: scale(0.985); }
  to { opacity: 1; transform: none; }
`;

const reducedMotion = '@media (prefers-reduced-motion: reduce)';

export function AttachmentPreviewPanel({
  files,
  origin,
  config,
  onSend,
  onClose,
  onAddMore,
  initialCaption,
}: AttachmentPreviewPanelProps) {
  const [items, setItems] = useState<DraftItem[]>(() => files.map((file) => toDraft(file, origin)));
  const [captions, setCaptions] = useState<Record<number, string>>(() =>
    items[0] && initialCaption ? { [items[0].id]: initialCaption.slice(0, config.maxCaptionLength) } : {},
  );
  const [currentId, setCurrentId] = useState<number | null>(() => items[0]?.id ?? null);
  const [failedPreviewIds, setFailedPreviewIds] = useState<ReadonlySet<number>>(() => new Set());

  // Arquivos novos no `files` (soltar com a prévia aberta) entram no fim, sem duplicar os do "+".
  const [seenFiles, setSeenFiles] = useState(files);
  if (files !== seenFiles) {
    const previous = new Set(seenFiles);
    const present = new Set(items.map((item) => item.file));
    const added = files.filter((file) => !previous.has(file) && !present.has(file)).map((f) => toDraft(f, origin));
    setSeenFiles(files);
    if (added.length > 0) {
      setItems([...items, ...added]);
      setCurrentId(added[0].id);
    }
  }

  const captionRef = useRef<HTMLTextAreaElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const thumbnailRefs = useRef(new Map<number, HTMLElement>());
  const reasonId = useId();
  const thumbnailId = useId();

  const classified = useMemo<ClassifiedItem[]>(
    () => items.map((item) => ({ ...item, classification: classifyAttachment(item.file, item.origin, config) })),
    [items, config],
  );
  const imageFiles = useMemo(
    () =>
      classified
        .filter(({ classification }) => classification.kind === 'image' && !classification.blocked)
        .map(({ file }) => file),
    [classified],
  );
  const thumbnails = useImageThumbnails(imageFiles);

  const currentIndex = Math.max(0, classified.findIndex((item) => item.id === currentId));
  const current: ClassifiedItem | undefined = classified[currentIndex];
  const showsMedia =
    !!current &&
    current.classification.kind !== 'document' &&
    !current.classification.blocked &&
    !failedPreviewIds.has(current.id);
  const mediaUrl = useObjectUrl(showsMedia ? current.file : null);

  const batch = validateBatch(classified.length, config);
  const hasBlocked = classified.some(({ classification }) => classification.blocked);
  const blockReason = !batch.ok ? texts.batchTooLarge(batch.max) : hasBlocked ? texts.removeBlockedToSend : null;
  const sendLabel = texts.sendCount(classified.length);

  useEffect(() => {
    captionRef.current?.focus();
  }, []);

  useEffect(() => {
    if (currentId === null) return;
    thumbnailRefs.current.get(currentId)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [currentId]);

  if (!current) return null;

  const notice = noticeFor(current.classification);
  const caption = captions[current.id] ?? '';

  const handleSend = () => {
    if (blockReason) return;
    onSend(
      classified.map(({ id, file, classification }) => ({
        file,
        caption: (captions[id] ?? '').trim(),
        classification,
      })),
    );
  };

  const handleCaptionKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (!event.repeat) handleSend();
  };

  const handleDialogKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    onClose();
  };

  const handleRemove = (id: number) => {
    const index = items.findIndex((item) => item.id === id);
    const remaining = items.filter((item) => item.id !== id);
    if (remaining.length === 0) {
      onClose();
      return;
    }
    setItems(remaining);
    if (id === currentId) setCurrentId(remaining[Math.min(index, remaining.length - 1)].id);
    // O botão clicado sai da tela; sem isto o foco cairia no `body`.
    captionRef.current?.focus();
  };

  const handleFilesPicked = (event: ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (picked.length === 0) return;
    const added = picked.map((file) => toDraft(file, origin));
    setItems([...items, ...added]);
    setCurrentId(added[0].id);
    onAddMore?.(picked);
  };

  const markPreviewFailed = (id: number) => setFailedPreviewIds((previous) => new Set(previous).add(id));

  return (
    <FocusTrap open disableEnforceFocus>
      <Box
        role="dialog"
        aria-modal="true"
        aria-label={texts.previewTitle}
        tabIndex={-1}
        onKeyDown={handleDialogKeyDown}
        sx={{
          position: 'absolute',
          inset: 0,
          zIndex: (theme) => theme.zIndex.appBar,
          display: 'flex',
          flexDirection: 'column',
          bgcolor: 'background.default',
          outline: 'none',
          animation: `${fadeIn} 160ms ease-out`,
          [reducedMotion]: { animation: 'none' },
        }}
      >
        {/* Cabeçalho: fechar e nome do item atual */}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            px: 1,
            minHeight: 56,
            bgcolor: 'background.paper',
            borderBottom: 1,
            borderColor: 'divider',
          }}
        >
          <Tooltip title={texts.closePreview}>
            <IconButton aria-label={texts.closePreview} onClick={onClose} sx={{ width: 40, height: 40 }}>
              <CloseIcon />
            </IconButton>
          </Tooltip>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography variant="subtitle2" noWrap component="p">
              {current.file.name}
            </Typography>
            {classified.length > 1 && (
              <Typography variant="caption" color="text.secondary" noWrap component="p">
                {texts.itemPosition(currentIndex + 1, classified.length)}
              </Typography>
            )}
          </Box>
        </Box>

        {/* Item atual em tamanho cheio */}
        <Box
          sx={{
            flex: 1,
            minHeight: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            p: { xs: 2, sm: 3 },
          }}
        >
          {showsMedia && current.classification.kind === 'image' && mediaUrl && (
            <Box
              component="img"
              key={current.id}
              src={mediaUrl}
              alt={current.file.name}
              onError={() => markPreviewFailed(current.id)}
              sx={{
                maxWidth: '100%',
                maxHeight: '100%',
                objectFit: 'contain',
                borderRadius: 1,
                boxShadow: (theme) => theme.shadows[3],
              }}
            />
          )}
          {showsMedia && current.classification.kind === 'video' && mediaUrl && (
            <Box
              component="video"
              key={current.id}
              src={mediaUrl}
              controls
              preload="metadata"
              aria-label={current.file.name}
              onError={() => markPreviewFailed(current.id)}
              sx={{ maxWidth: '100%', maxHeight: '100%', borderRadius: 1, bgcolor: 'common.black' }}
            />
          )}
          {!showsMedia && <DocumentCard file={current.file} blocked={!!current.classification.blocked} />}
        </Box>

        {/* Aviso do item atual + legenda */}
        <Box sx={{ px: { xs: 2, sm: 3 }, pb: 1.5, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
          <Box role="status" sx={{ display: 'flex', justifyContent: 'center', width: '100%', maxWidth: 720 }}>
            {notice && (
              <Box
                sx={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 0.75,
                  px: 1.25,
                  py: 0.5,
                  borderRadius: 1,
                  color: notice.severity === 'error' ? 'error.main' : 'info.main',
                  bgcolor: (theme) =>
                    alpha(notice.severity === 'error' ? theme.palette.error.main : theme.palette.info.main, 0.1),
                }}
              >
                {notice.severity === 'error' ? (
                  <ErrorOutlineIcon fontSize="small" aria-hidden />
                ) : (
                  <InfoOutlinedIcon fontSize="small" aria-hidden />
                )}
                <Typography variant="body2" component="span" sx={{ fontWeight: 500 }}>
                  {notice.text}
                </Typography>
              </Box>
            )}
          </Box>
          <TextField
            inputRef={captionRef}
            value={caption}
            onChange={(event) => setCaptions((previous) => ({ ...previous, [current.id]: event.target.value }))}
            onKeyDown={handleCaptionKeyDown}
            placeholder={texts.captionPlaceholder}
            multiline
            maxRows={4}
            fullWidth
            size="small"
            slotProps={{ htmlInput: { maxLength: config.maxCaptionLength, 'aria-label': texts.captionLabel } }}
            sx={{
              maxWidth: 720,
              '& .MuiOutlinedInput-root': { bgcolor: 'background.paper', borderRadius: 2 },
            }}
          />
        </Box>

        {/* Miniaturas, "+" e enviar */}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            px: { xs: 1.5, sm: 2 },
            py: 1,
            pb: 'calc(8px + env(safe-area-inset-bottom))',
            bgcolor: 'background.paper',
            borderTop: 1,
            borderColor: 'divider',
          }}
        >
          <Box
            component="ul"
            sx={{
              flex: 1,
              minWidth: 0,
              display: 'flex',
              alignItems: 'center',
              gap: 1.5,
              m: 0,
              px: 0.75,
              py: 1,
              listStyle: 'none',
              overflowX: 'auto',
              overscrollBehaviorX: 'contain',
            }}
          >
            {classified.map((item, index) => (
              <Box
                component="li"
                key={item.id}
                ref={(node: HTMLElement | null) => {
                  if (node) thumbnailRefs.current.set(item.id, node);
                  else thumbnailRefs.current.delete(item.id);
                }}
                sx={{ position: 'relative', flexShrink: 0 }}
              >
                <Tooltip title={item.file.name}>
                  {/* Nome falado = arquivo + posição, em dois textos atômicos (sem concatenar); o
                      texto `hidden` referenciado por `aria-labelledby` entra no nome. */}
                  <ButtonBase
                    aria-labelledby={`${thumbnailId}-${item.id}-name ${thumbnailId}-${item.id}-position`}
                    aria-current={item.id === current.id ? 'true' : undefined}
                    onClick={() => setCurrentId(item.id)}
                    sx={thumbnailSx(item.id === current.id, !!item.classification.blocked)}
                  >
                    <ThumbnailContent item={item} url={thumbnails.get(item.file)} />
                    <span id={`${thumbnailId}-${item.id}-name`} hidden>
                      {item.file.name}
                    </span>
                    <span id={`${thumbnailId}-${item.id}-position`} hidden>
                      {texts.itemPosition(index + 1, classified.length)}
                    </span>
                  </ButtonBase>
                </Tooltip>
                <Tooltip title={texts.removeItem}>
                  <IconButton
                    aria-label={texts.removeItemNamed(item.file.name)}
                    onClick={() => handleRemove(item.id)}
                    size="small"
                    sx={{
                      position: 'absolute',
                      top: -8,
                      right: -8,
                      width: 26,
                      height: 26,
                      bgcolor: 'background.paper',
                      color: 'text.secondary',
                      border: 1,
                      borderColor: 'divider',
                      boxShadow: (theme) => theme.shadows[1],
                      '&:hover': { bgcolor: 'background.paper', color: 'error.main' },
                      // Alvo de toque maior que o desenho (≈ 40 px).
                      '&::after': { content: '""', position: 'absolute', inset: -7 },
                    }}
                  >
                    <CloseIcon sx={{ fontSize: 16 }} />
                  </IconButton>
                </Tooltip>
              </Box>
            ))}
            <Box component="li" sx={{ flexShrink: 0 }}>
              <Tooltip title={texts.addMore}>
                <ButtonBase
                  aria-label={texts.addMore}
                  onClick={() => inputRef.current?.click()}
                  sx={{
                    ...thumbnailBaseSx,
                    border: '2px dashed',
                    borderColor: 'divider',
                    color: 'text.secondary',
                    '&:hover': { borderColor: 'primary.main', color: 'primary.main' },
                  }}
                >
                  <AddIcon />
                </ButtonBase>
              </Tooltip>
              <input
                ref={inputRef}
                type="file"
                multiple
                hidden
                accept={ACCEPT_BY_ORIGIN[origin]}
                aria-label={texts.addMore}
                onChange={handleFilesPicked}
              />
            </Box>
          </Box>

          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 0.5, flexShrink: 0 }}>
            <Tooltip title={blockReason ?? sendLabel}>
              <span>
                <Badge
                  badgeContent={classified.length}
                  color="secondary"
                  overlap="circular"
                  invisible={classified.length < 2}
                  slotProps={{ badge: { 'aria-hidden': true } }}
                >
                  <IconButton
                    aria-label={sendLabel}
                    aria-describedby={blockReason ? reasonId : undefined}
                    disabled={!!blockReason}
                    onClick={handleSend}
                    sx={{
                      width: 52,
                      height: 52,
                      bgcolor: 'primary.main',
                      color: 'primary.contrastText',
                      '&:hover': { bgcolor: 'primary.dark' },
                      '&.Mui-disabled': { bgcolor: 'action.disabledBackground', color: 'action.disabled' },
                    }}
                  >
                    <SendIcon />
                  </IconButton>
                </Badge>
              </span>
            </Tooltip>
          </Box>
        </Box>
        <Box role="status" sx={{ bgcolor: 'background.paper', px: 2, textAlign: 'right' }}>
          {blockReason && (
            <Typography id={reasonId} variant="caption" component="p" color="error.main" sx={{ pb: 1 }}>
              {blockReason}
            </Typography>
          )}
        </Box>
      </Box>
    </FocusTrap>
  );
}

const thumbnailBaseSx = {
  width: 64,
  height: 64,
  borderRadius: 1,
  overflow: 'hidden',
  flexShrink: 0,
  '&.Mui-focusVisible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 },
} as const;

function thumbnailSx(selected: boolean, blocked: boolean) {
  return {
    ...thumbnailBaseSx,
    border: '2px solid',
    borderColor: blocked ? 'error.main' : selected ? 'primary.main' : 'divider',
    bgcolor: 'action.hover',
    color: 'text.secondary',
    opacity: selected ? 1 : 0.8,
    transition: 'border-color 120ms ease, opacity 120ms ease',
    '&:hover': { opacity: 1 },
    [reducedMotion]: { transition: 'none' },
  };
}

function ThumbnailContent({ item, url }: { item: ClassifiedItem; url: string | undefined }) {
  if (url) {
    return <Box component="img" src={url} alt="" sx={{ width: '100%', height: '100%', objectFit: 'cover' }} />;
  }
  const Icon = item.classification.kind === 'video' ? VideocamOutlinedIcon : InsertDriveFileOutlinedIcon;
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.25, minWidth: 0, px: 0.5 }}>
      <Icon fontSize="small" aria-hidden />
      {item.classification.kind === 'document' && (
        <Typography variant="caption" noWrap aria-hidden sx={{ fontSize: 10, fontWeight: 600, maxWidth: 56 }}>
          {extensionLabel(item.file.name)}
        </Typography>
      )}
    </Box>
  );
}

function DocumentCard({ file, blocked }: { file: File; blocked: boolean }) {
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 1.5,
        width: '100%',
        maxWidth: 360,
        px: 3,
        py: 4,
        borderRadius: 2,
        bgcolor: 'background.paper',
        border: 1,
        borderColor: blocked ? 'error.main' : 'divider',
        textAlign: 'center',
      }}
    >
      <Box
        sx={{
          display: 'grid',
          placeItems: 'center',
          width: 72,
          height: 72,
          borderRadius: 2,
          color: blocked ? 'error.main' : 'primary.main',
          bgcolor: (theme) => alpha(blocked ? theme.palette.error.main : theme.palette.primary.main, 0.1),
        }}
      >
        <InsertDriveFileOutlinedIcon sx={{ fontSize: 40 }} aria-hidden />
      </Box>
      <Typography variant="subtitle1" component="p" sx={{ wordBreak: 'break-word', maxWidth: '100%' }}>
        {file.name}
      </Typography>
      <Typography variant="body2" color="text.secondary" component="p">
        {texts.fileDetails(extensionLabel(file.name), formatBytesLabel(file.size))}
      </Typography>
    </Box>
  );
}
