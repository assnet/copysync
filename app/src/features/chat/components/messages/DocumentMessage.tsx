/**
 * Cartão de documento na bolha: ícone do tipo, nome em uma linha, `TIPO • tamanho` e botão de baixar.
 *
 * O corpo do cartão abre em nova aba o que o navegador exibe (PDF, imagem, texto) e baixa o resto.
 * O tamanho vem de um `HEAD` sob demanda (`useMediaFileSize`) — sem ele, o subtítulo é só o tipo.
 * Cores vêm de `textColor` (branco na bolha enviada, `text.primary` na recebida) e da paleta semântica.
 */
import { Box, ButtonBase, IconButton, Tooltip, Typography, alpha, useTheme } from '@mui/material';
import DownloadOutlinedIcon from '@mui/icons-material/DownloadOutlined';
import { chatStrings } from '../../strings';
import { formatBytesLabel } from '../../media/mediaPolicy';
import { useMediaFileSize } from '../../media/useMediaFileSize';
import { RichMessageText } from './RichMessageText';

const texts = chatStrings.documentCard;

interface Props {
  mediaUrl?: string | null;
  fileName?: string | null;
  mimeType?: string | null;
  body?: string | null;
  textColor: string;
}

export type DocumentKind = 'pdf' | 'archive' | 'doc' | 'sheet' | 'slides' | 'text' | 'image' | 'generic';

const KIND_BY_EXTENSION: Record<string, DocumentKind> = {
  pdf: 'pdf',
  zip: 'archive', rar: 'archive', '7z': 'archive', gz: 'archive', tar: 'archive', tgz: 'archive', bz2: 'archive',
  doc: 'doc', docx: 'doc', odt: 'doc', rtf: 'doc', pages: 'doc',
  xls: 'sheet', xlsx: 'sheet', csv: 'sheet', ods: 'sheet', numbers: 'sheet',
  ppt: 'slides', pptx: 'slides', odp: 'slides', key: 'slides',
  txt: 'text', md: 'text', log: 'text', json: 'text', xml: 'text',
  jpg: 'image', jpeg: 'image', png: 'image', gif: 'image', webp: 'image', svg: 'image', heic: 'image',
};

/** Extensão sem ponto, minúscula. Cai no subtipo do MIME quando o nome não tem extensão. */
export function getDocumentExtension(fileName: string, mimeType: string | null | undefined): string {
  const dot = fileName.lastIndexOf('.');
  if (dot > 0 && dot < fileName.length - 1) return fileName.slice(dot + 1).toLowerCase();
  const subtype = mimeType?.split('/')[1]?.split(';')[0]?.trim().toLowerCase() ?? '';
  return subtype === 'octet-stream' ? '' : subtype;
}

export function getDocumentKind(extension: string, mimeType: string | null | undefined): DocumentKind {
  const byExtension = KIND_BY_EXTENSION[extension];
  if (byExtension) return byExtension;
  const mime = mimeType?.toLowerCase() ?? '';
  if (mime.includes('pdf')) return 'pdf';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('text/')) return 'text';
  if (mime.includes('zip') || mime.includes('compressed')) return 'archive';
  if (mime.includes('word')) return 'doc';
  if (mime.includes('sheet') || mime.includes('excel')) return 'sheet';
  if (mime.includes('presentation') || mime.includes('powerpoint')) return 'slides';
  return 'generic';
}

/** O navegador exibe inline: abre em nova aba em vez de baixar. */
const OPENABLE_KINDS: ReadonlySet<DocumentKind> = new Set(['pdf', 'image', 'text']);

function getDisplayName(fileName: string | null | undefined, mediaUrl: string | null | undefined): string {
  if (fileName?.trim()) return fileName.trim();
  const urlName = mediaUrl?.split('/').pop()?.split('?')[0];
  if (!urlName) return texts.fallbackName;
  try {
    return decodeURIComponent(urlName);
  } catch {
    return urlName;
  }
}

/** Rótulo curto dentro do ícone: até 4 letras para caber no papel. */
function iconLabel(extension: string): string {
  return (extension || texts.unknownType).slice(0, 4).toUpperCase();
}

interface FileGlyphProps {
  label: string;
  accent: string;
  paper: string;
  edge: string;
  onAccent: string;
}

/** Folha com canto dobrado e faixa colorida com a extensão — legível nos dois modos e nas duas bolhas. */
function FileGlyph({ label, accent, paper, edge, onAccent }: FileGlyphProps) {
  return (
    <Box
      component="svg"
      viewBox="0 0 40 48"
      aria-hidden
      sx={{ width: 40, height: 48, flexShrink: 0, display: 'block' }}
    >
      <path d="M4 1.5h22l10 10v33a2.5 2.5 0 0 1-2.5 2.5h-29.5a2.5 2.5 0 0 1-2.5-2.5v-40.5a2.5 2.5 0 0 1 2.5-2.5z" fill={paper} stroke={edge} />
      <path d="M26 1.5v7.5a2.5 2.5 0 0 0 2.5 2.5h7.5" fill="none" stroke={edge} />
      <rect x="-1" y="27" width="34" height="14" rx="3" fill={accent} />
      <text
        x="16"
        y="37.2"
        textAnchor="middle"
        fontSize={label.length > 3 ? 8 : 9}
        fontWeight={800}
        fontFamily="inherit"
        letterSpacing="0.02em"
        fill={onAccent}
      >
        {label}
      </text>
    </Box>
  );
}

export function DocumentMessage({ mediaUrl, fileName, mimeType, body, textColor }: Props) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const displayName = getDisplayName(fileName, mediaUrl);
  const extension = getDocumentExtension(displayName, mimeType);
  const kind = getDocumentKind(extension, mimeType);
  const openable = OPENABLE_KINDS.has(kind);
  const { ref, sizeBytes } = useMediaFileSize(mediaUrl);
  const sizeLabel = sizeBytes == null ? null : formatBytesLabel(sizeBytes);
  const typeLabel = extension ? extension.toUpperCase() : texts.unknownType;

  const { palette } = theme;
  const accentByKind: Record<DocumentKind, string> = {
    pdf: palette.error.main,
    archive: palette.warning.dark,
    doc: palette.info.main,
    sheet: palette.success.dark,
    slides: palette.warning.main,
    text: palette.grey[600],
    image: palette.secondary.main,
    generic: palette.grey[600],
  };
  const accent = accentByKind[kind];
  const cardBg = alpha(textColor, isDark ? 0.1 : 0.06);
  const cardHover = alpha(textColor, isDark ? 0.16 : 0.1);
  const focusRing = `2px solid ${alpha(textColor, 0.6)}`;
  const mutedText = alpha(textColor, 0.68);
  const linkProps = openable ? { target: '_blank', rel: 'noopener' } : { download: displayName };

  const bodySx = {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-start',
    textAlign: 'left',
    gap: 1.25,
    px: 1.25,
    py: 1,
    color: textColor,
    transition: 'background-color 120ms ease',
  } as const;

  const content = (
    <>
      <FileGlyph
        label={iconLabel(extension)}
        accent={accent}
        paper={isDark ? palette.grey[800] : palette.common.white}
        edge={alpha(textColor, 0.32)}
        onAccent={palette.common.white}
      />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography
          variant="body2"
          component="span"
          title={displayName}
          sx={{
            display: 'block',
            color: textColor,
            fontWeight: 500,
            lineHeight: 1.35,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {displayName}
        </Typography>
        <Typography variant="caption" component="span" sx={{ display: 'block', color: mutedText, lineHeight: 1.4, mt: 0.25 }}>
          {texts.subtitle(typeLabel, sizeLabel)}
        </Typography>
      </Box>
    </>
  );

  return (
    <Box
      ref={ref}
      sx={{ display: 'flex', flexDirection: 'column', gap: 1, width: { xs: '100%', sm: 300 }, maxWidth: '100%' }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'stretch',
          minHeight: 64,
          borderRadius: 2,
          overflow: 'hidden',
          bgcolor: cardBg,
          border: `1px solid ${alpha(textColor, isDark ? 0.14 : 0.1)}`,
        }}
      >
        {mediaUrl ? (
          <Tooltip title={openable ? texts.open : texts.download} enterDelay={600}>
            <ButtonBase
              component="a"
              href={mediaUrl}
              {...linkProps}
              aria-label={texts.label(displayName, sizeLabel)}
              sx={{ ...bodySx, '&:hover': { bgcolor: cardHover }, '&.Mui-focusVisible': { outline: focusRing, outlineOffset: -2 } }}
            >
              {content}
            </ButtonBase>
          </Tooltip>
        ) : (
          <Box role="group" aria-label={texts.label(displayName, sizeLabel)} sx={{ ...bodySx, opacity: 0.7 }}>
            {content}
          </Box>
        )}

        {mediaUrl && (
          <Box sx={{ display: 'flex', alignItems: 'center', pr: 1, pl: 0.25 }}>
            <Tooltip title={texts.download} enterDelay={600}>
              <IconButton
                component="a"
                href={mediaUrl}
                download={displayName}
                aria-label={texts.download}
                sx={{
                  width: 40,
                  height: 40,
                  color: textColor,
                  border: `1.5px solid ${alpha(textColor, 0.55)}`,
                  '&:hover': { bgcolor: cardHover, borderColor: textColor },
                  '&.Mui-focusVisible': { outline: focusRing, outlineOffset: 2 },
                }}
              >
                <DownloadOutlinedIcon sx={{ fontSize: 20 }} />
              </IconButton>
            </Tooltip>
          </Box>
        )}
      </Box>

      {body && <RichMessageText text={body} textColor={textColor} />}
    </Box>
  );
}
