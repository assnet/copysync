import { Card, CardContent, Box, Typography, Skeleton, type SxProps, type Theme } from '@mui/material';
import type { ReactNode } from 'react';

interface Props {
  label: string;
  value: number | string | null;
  icon?: ReactNode;
  accentColor?: string;
  sx?: SxProps<Theme>;
}

export function StatCard({ label, value, icon, accentColor, sx }: Props) {
  return (
    <Card
      sx={{
        height: '100%',
        position: 'relative',
        overflow: 'hidden',
        '&::before': accentColor
          ? {
              content: '""',
              position: 'absolute',
              top: 0,
              left: 0,
              width: 4,
              height: '100%',
              bgcolor: accentColor,
              borderRadius: '12px 0 0 12px',
            }
          : undefined,
        ...sx,
      }}
    >
      <CardContent sx={{ p: '20px 20px 20px 24px !important', display: 'flex', gap: 2, alignItems: 'center' }}>
        {icon && (
          <Box
            sx={{
              width: 48,
              height: 48,
              borderRadius: 3,
              bgcolor: accentColor ? `${accentColor}18` : 'action.hover',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              '& svg': { fontSize: 24, color: accentColor ?? 'text.secondary' },
            }}
          >
            {icon}
          </Box>
        )}
        <Box>
          <Typography variant="caption" color="text.secondary" fontWeight={600} textTransform="uppercase" letterSpacing={0.5}>
            {label}
          </Typography>
          {value === null ? (
            <Skeleton width={48} height={36} />
          ) : (
            <Typography variant="h4" fontWeight={800} color={accentColor ?? 'text.primary'} lineHeight={1.1}>
              {value}
            </Typography>
          )}
        </Box>
      </CardContent>
    </Card>
  );
}
