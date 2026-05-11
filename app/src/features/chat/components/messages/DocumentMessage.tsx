import { Box, IconButton, Tooltip, Typography, alpha, useTheme } from '@mui/material';
import ArticleOutlinedIcon from '@mui/icons-material/ArticleOutlined';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import DownloadOutlinedIcon from '@mui/icons-material/DownloadOutlined';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import PictureAsPdfOutlinedIcon from '@mui/icons-material/PictureAsPdfOutlined';
import { RichMessageText } from './RichMessageText';

interface Props {
  mediaUrl?: string | null;
  fileName?: string | null;
  mimeType?: string | null;
  body?: string | null;
  textColor: string;
}

function getFileExtension(fileName: string | null | undefined, mimeType: string | null | undefined): string {
  if (fileName) {
    const dot = fileName.lastIndexOf('.');
    if (dot !== -1) return fileName.slice(dot + 1).toUpperCase();
  }
  if (mimeType) {
    const parts = mimeType.split('/');
    return (parts[1] ?? '').toUpperCase().split(';')[0] ?? 'FILE';
  }
  return 'FILE';
}

function getDisplayName(fileName: string | null | undefined, mediaUrl: string | null | undefined): string {
  if (fileName) return fileName;
  if (!mediaUrl) return 'Documento';

  const urlName = mediaUrl.split('/').pop()?.split('?')[0];
  return urlName ? decodeURIComponent(urlName) : 'Documento';
}

function isPdfDocument(fileName: string, mimeType: string | null | undefined): boolean {
  return mimeType?.toLowerCase().includes('pdf') === true || fileName.toLowerCase().endsWith('.pdf');
}

export function DocumentMessage({ mediaUrl, fileName, mimeType, body, textColor }: Props) {
  const theme = useTheme();
  const displayName = getDisplayName(fileName, mediaUrl);
  const ext = getFileExtension(displayName, mimeType);
  const isPdf = isPdfDocument(displayName, mimeType);
  const accentColor = isPdf ? theme.palette.error.main : theme.palette.primary.main;
  const softAccent = alpha(accentColor, theme.palette.mode === 'dark' ? 0.22 : 0.12);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, width: { xs: '100%', sm: 292 }, maxWidth: '100%' }}>
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          bgcolor: alpha(theme.palette.text.primary, theme.palette.mode === 'dark' ? 0.08 : 0.05),
          border: `1px solid ${alpha(theme.palette.divider, 0.7)}`,
          borderRadius: 2,
        }}
      >
        <Box
          sx={{
            position: 'relative',
            width: '100%',
            height: 112,
            overflow: 'hidden',
            bgcolor: theme.palette.mode === 'dark' ? alpha('#ffffff', 0.08) : alpha('#000000', 0.035),
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Box
            sx={{
              position: 'absolute',
              inset: 0,
              opacity: theme.palette.mode === 'dark' ? 0.18 : 0.32,
              backgroundImage: `linear-gradient(${alpha(textColor, 0.22)} 1px, transparent 1px), linear-gradient(90deg, ${alpha(textColor, 0.18)} 1px, transparent 1px)`,
              backgroundSize: '18px 18px',
            }}
          />
          <Box
            sx={{
              position: 'relative',
              width: 78,
              height: 92,
              borderRadius: 1.5,
              bgcolor: alpha(theme.palette.background.paper, 0.94),
              boxShadow: `0 16px 35px ${alpha('#000000', 0.22)}`,
              border: `1px solid ${alpha(theme.palette.divider, 0.9)}`,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 0.75,
            }}
          >
            {isPdf ? (
              <PictureAsPdfOutlinedIcon sx={{ fontSize: 34, color: accentColor }} />
            ) : (
              <ArticleOutlinedIcon sx={{ fontSize: 34, color: accentColor }} />
            )}
            <Typography sx={{ fontSize: 10, fontWeight: 800, color: accentColor, letterSpacing: 0 }}>
              {ext}
            </Typography>
          </Box>
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, width: '100%', p: 1.25 }}>
          <Box
            sx={{
              width: 38,
              height: 38,
              borderRadius: 1.25,
              bgcolor: softAccent,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            {isPdf ? (
              <PictureAsPdfOutlinedIcon sx={{ fontSize: 21, color: accentColor }} />
            ) : (
              <DescriptionOutlinedIcon sx={{ fontSize: 21, color: accentColor }} />
            )}
          </Box>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography
              variant="caption"
              display="block"
              title={displayName}
              sx={{ color: textColor, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            >
              {displayName}
            </Typography>
            <Typography variant="caption" sx={{ color: alpha(textColor, 0.62), fontSize: 10.5 }}>
              {isPdf ? 'PDF' : ext}
            </Typography>
          </Box>
          {mediaUrl && (
            <Box sx={{ display: 'flex', gap: 0.25, flexShrink: 0 }}>
              <Tooltip title="Abrir documento">
                <IconButton
                  component="a"
                  href={mediaUrl}
                  target="_blank"
                  rel="noopener"
                  size="small"
                  sx={{ width: 28, height: 28, color: alpha(textColor, 0.82), '&:hover': { bgcolor: alpha(textColor, 0.08) } }}
                >
                  <OpenInNewIcon sx={{ fontSize: 16 }} />
                </IconButton>
              </Tooltip>
              <Tooltip title="Baixar documento">
                <IconButton
                  component="a"
                  href={mediaUrl}
                  download={fileName ?? true}
                  size="small"
                  sx={{ width: 28, height: 28, color: alpha(textColor, 0.82), '&:hover': { bgcolor: alpha(textColor, 0.08) } }}
                >
                  <DownloadOutlinedIcon sx={{ fontSize: 17 }} />
                </IconButton>
              </Tooltip>
            </Box>
          )}
        </Box>
      </Box>
      {body && (
        <RichMessageText text={body} textColor={textColor} />
      )}
    </Box>
  );
}
