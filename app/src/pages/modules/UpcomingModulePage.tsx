import type { LucideIcon } from 'lucide-react';
import { Box, Chip } from '@mui/material';
import { AppIcon, EmptyState, PageHeader } from '@/components';

interface Props {
  title: string;
  subtitle: string;
  /** O que o módulo fará quando existir (do docs/produto-roadmap.md). */
  description: string;
  icon: LucideIcon;
}

/** Página de módulo ainda em desenvolvimento: dá rota e lugar no menu antes da implementação. */
export function UpcomingModulePage({ title, subtitle, description, icon }: Props) {
  return (
    <Box>
      <PageHeader title={title} subtitle={subtitle} action={<Chip label="Em desenvolvimento" size="small" variant="outlined" />} />
      <EmptyState icon={<AppIcon icon={icon} size="lg" />} title={`${title} chega em breve`} description={description} sx={{ mt: 4 }} />
    </Box>
  );
}
