import { Box, Typography, type SxProps, type Theme } from '@mui/material';
import type { ReactNode } from 'react';

interface Props {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  sx?: SxProps<Theme>;
}

export function EmptyState({ icon, title, description, action, sx }: Props) {
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        py: 10,
        px: 4,
        borderRadius: 3,
        border: '1.5px dashed',
        borderColor: 'divider',
        ...sx,
      }}
    >
      {icon && (
        <Box
          sx={{
            mb: 2,
            width: 64,
            height: 64,
            borderRadius: '50%',
            bgcolor: 'action.hover',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            '& svg': { fontSize: 32, color: 'text.disabled' },
          }}
        >
          {icon}
        </Box>
      )}
      <Typography variant="h6" color="text.secondary" gutterBottom>
        {title}
      </Typography>
      {description && (
        <Typography variant="body2" color="text.disabled" mb={3} maxWidth={360}>
          {description}
        </Typography>
      )}
      {action}
    </Box>
  );
}
