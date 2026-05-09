import { Box, Typography, Link, alpha, useTheme } from '@mui/material';
import LocationOnOutlinedIcon from '@mui/icons-material/LocationOnOutlined';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';

interface Props {
  /** Formato esperado: "lat,lng" ou "Nome (lat,lng)" */
  body?: string | null;
  textColor: string;
}

function parseLocation(body: string | null | undefined): { lat: number; lng: number; label: string | null } | null {
  if (!body) return null;
  // "Nome da localização (lat,lng)"
  const matchWithLabel = body.match(/^(.+?)\s*\((-?\d+\.?\d*),(-?\d+\.?\d*)\)$/);
  if (matchWithLabel) {
    return {
      lat: parseFloat(matchWithLabel[2]),
      lng: parseFloat(matchWithLabel[3]),
      label: matchWithLabel[1],
    };
  }
  // "lat,lng"
  const matchSimple = body.match(/^(-?\d+\.?\d*),(-?\d+\.?\d*)$/);
  if (matchSimple) {
    return { lat: parseFloat(matchSimple[1]), lng: parseFloat(matchSimple[2]), label: null };
  }
  return null;
}

export function LocationMessage({ body, textColor }: Props) {
  const theme = useTheme();
  const parsed = parseLocation(body);

  const mapsUrl = parsed
    ? `https://maps.google.com/maps?q=${parsed.lat},${parsed.lng}`
    : null;

  return (
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
          bgcolor: alpha(theme.palette.error.main, 0.12),
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <LocationOnOutlinedIcon sx={{ fontSize: 20, color: 'error.main' }} />
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="caption" display="block" sx={{ color: textColor, fontWeight: 600 }}>
          {parsed?.label ?? 'Localização'}
        </Typography>
        {parsed && (
          <Typography variant="caption" sx={{ color: alpha(textColor, 0.65), fontSize: 10 }}>
            {parsed.lat.toFixed(5)}, {parsed.lng.toFixed(5)}
          </Typography>
        )}
      </Box>
      {mapsUrl && (
        <Link href={mapsUrl} target="_blank" rel="noopener" sx={{ color: textColor, display: 'flex', alignItems: 'center' }}>
          <OpenInNewIcon sx={{ fontSize: 16 }} />
        </Link>
      )}
    </Box>
  );
}
