import { Card, CardContent, Box, Typography, Divider, type SxProps, type Theme } from '@mui/material';
import type { ReactNode } from 'react';

interface Props {
  title?: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  noPadding?: boolean;
  sx?: SxProps<Theme>;
}

export function SectionCard({ title, subtitle, action, children, noPadding, sx }: Props) {
  return (
    <Card sx={sx}>
      {(title || action) && (
        <>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              px: 2.5,
              py: 2,
              gap: 2,
            }}
          >
            <Box>
              {title && <Typography variant="subtitle1">{title}</Typography>}
              {subtitle && (
                <Typography variant="caption" color="text.secondary">
                  {subtitle}
                </Typography>
              )}
            </Box>
            {action}
          </Box>
          <Divider />
        </>
      )}
      <CardContent sx={noPadding ? { p: '0 !important' } : undefined}>
        {children}
      </CardContent>
    </Card>
  );
}
