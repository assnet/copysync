import { Box, Typography, Link, alpha, useTheme } from '@mui/material';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import DownloadIcon from '@mui/icons-material/Download';

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

export function DocumentMessage({ mediaUrl, fileName, mimeType, body, textColor }: Props) {
  const theme = useTheme();
  const ext = getFileExtension(fileName, mimeType);
  const displayName = fileName ?? 'Documento';

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          p: 1.25,
          bgcolor: alpha(theme.palette.text.primary, 0.07),
          borderRadius: 1.5,
        }}
      >
        <Box
          sx={{
            width: 36,
            height: 36,
            borderRadius: 1,
            bgcolor: alpha(theme.palette.primary.main, 0.15),
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <DescriptionOutlinedIcon sx={{ fontSize: 20, color: 'primary.main' }} />
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography
            variant="caption"
            display="block"
            sx={{ color: textColor, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >
            {displayName}
          </Typography>
          <Typography variant="caption" sx={{ color: alpha(textColor, 0.65), fontSize: 10 }}>
            {ext}
          </Typography>
        </Box>
        {mediaUrl && (
          <Link href={mediaUrl} target="_blank" rel="noopener" download={fileName ?? true} sx={{ color: textColor, display: 'flex' }}>
            <DownloadIcon sx={{ fontSize: 18 }} />
          </Link>
        )}
      </Box>
      {body && (
        <Typography variant="body2" sx={{ color: textColor, fontSize: 13.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {body}
        </Typography>
      )}
    </Box>
  );
}
