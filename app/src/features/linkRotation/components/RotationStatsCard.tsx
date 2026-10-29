import { Box, Typography } from '@mui/material';
import { linkRotationStrings } from '../strings';

const t = linkRotationStrings.stats;

export interface RotationStatsCardProps {
  /** Id do rodízio; o card busca `GET /link-rotation/:id/stats` por conta própria. */
  rotationId: string;
}

/**
 * Área de cliques do card (total, 7 dias, por grupo).
 * PLACEHOLDER da T16 — implementação completa na T19 (`design.md` §5).
 */
export function RotationStatsCard(_props: RotationStatsCardProps) {
  return (
    <Box>
      <Typography variant="overline" color="text.secondary">{t.title}</Typography>
    </Box>
  );
}
